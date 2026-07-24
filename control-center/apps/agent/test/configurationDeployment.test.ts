import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { deploymentCapabilities } from "@control-center/shared";
import { applyEnvironmentMutations, configurationDigest, executeConfigurationDeployment, parseEnvironment, resetReplayStateForTests, safeConfigurationFailureProgress, shouldApplyOwnershipChange } from "../src/configurationDeployment.js";

process.env.NODE_ENV = "test";
function encryptDeploymentValues(values: Record<string, string>, signingKey: string) { const key = crypto.createHash("sha256").update(`configuration-deployment:${signingKey}`).digest(); const nonce = crypto.randomBytes(12); const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce); const ciphertext = Buffer.concat([cipher.update(JSON.stringify(values)), cipher.final()]); return { algorithm: "aes-256-gcm" as const, ciphertext: ciphertext.toString("base64"), nonce: nonce.toString("base64"), authTag: cipher.getAuthTag().toString("base64"), keyVersion: "agent-signing-v1" }; }
function fixture() { const root = fs.mkdtempSync(path.join(os.tmpdir(), "control-center-deploy-")); const env = path.join(root, ".env.staging"); const compose = path.join(root, "compose.yml"); fs.writeFileSync(env, "PUBLIC=value\n"); fs.writeFileSync(compose, "services:\n  web:\n    image: fixture\n"); const key = "agent-key"; return { root, env, compose, key, payload: { schemaVersion: "configuration-deployment-v1" as const, action: "configuration.apply.v1" as const, planId: "123456789012", planRevision: 1, deploymentId: crypto.randomUUID(), environmentId: "123456789014", environmentKind: "testing" as const, protected: false as const, targetProfileId: "123456789015", targetProfileRevision: 1, repositoryRoot: root, environmentFilePath: env, composePath: compose, composeProject: "fixture", statelessServices: ["web"], protectedServices: ["mongo"], healthChecks: [{ id: "web", url: "https://health.example.test/healthz", timeoutMs: 100 }], mutations: [{ name: "TOKEN", versionId: "123456789016", secret: true, operation: "rotate" as const, valueRef: "v:1" }], encryptedValues: encryptDeploymentValues({ "v:1": "fixture-value" }, key), expectedConfigurationDigest: configurationDigest("PUBLIC=value\n"), automaticRollback: true as const } }; }
const safeNetwork = { resolve: async () => ["93.184.216.34"] };
test("parser rejects injection, duplicate names, and invalid names", () => { assert.throws(() => parseEnvironment("A=ok\nBAD LINE\n")); assert.throws(() => parseEnvironment("A=1\nA=2\n")); assert.throws(() => parseEnvironment("lower=bad\n")); });
test("typed mutations preserve comments and blank lines while supporting add, replace, disable, and remove", () => { const source = "# retained\nA=one\n\nB=two\n"; const result = applyEnvironmentMutations(source, [{ name: "A", versionId: "123456789012", secret: false, operation: "update", valueRef: "a" }, { name: "B", versionId: "123456789013", secret: false, operation: "disable" }, { name: "C", versionId: "123456789014", secret: true, operation: "add", valueRef: "c" }], { a: "changed", c: "secret-value" }); assert.equal(result, "# retained\nA=changed\n\n\nC=secret-value\n"); });
test("parser rejects multiline, CR injection, NUL, and oversized values", () => { assert.throws(() => parseEnvironment("A=ok\rBAD=two\n")); assert.throws(() => parseEnvironment("A=bad\0value\n")); assert.throws(() => parseEnvironment(`A=${"x".repeat(16 * 1024 + 1)}\n`)); });
test("safe failure progress reports bounded configuration categories", () => {
  const cases = [
    ["Expected configuration version mismatch", "parsing"],
    ["Replay rejected", "replay"],
    ["Agent version must be stable", "version"],
    ["Target escapes repository root", "path"],
    ["Symlink target rejected", "symlink"],
    ["Mount-boundary target rejected", "mount"],
    ["Incomplete deployment capabilities", "capability"],
    ["docker compose exited", "activation"],
    ["Health check target rejected", "health"],
    ["secret-value-never-echoed", "unknown"]
  ] as const;
  for (const [message, expected] of cases) {
    const result = safeConfigurationFailureProgress(new Error(message));
    assert.equal(result.phase, "failed");
    assert.equal(result.errorCategory, expected);
    assert.equal(result.failureStage, "unknown");
    assert.equal(JSON.stringify(result).includes(message), false);
    assert.deepEqual(result.services, []);
    assert.equal(result.changedVariables, 0);
  }
});
test("safe failure progress reports bounded pre-write stages", async () => {
  resetReplayStateForTests();
  const version = fixture();
  await assert.rejects(async () => {
    try { await executeConfigurationDeployment(version.payload, version.key, "stage-version", [...deploymentCapabilities], "0.1.0-beta.1", safeNetwork); }
    catch (error) { const progress = safeConfigurationFailureProgress(error); assert.equal(progress.errorCategory, "version"); assert.equal(progress.failureStage, "version"); throw error; }
  }, /version/);
  const digest = fixture();
  digest.payload.expectedConfigurationDigest = "b".repeat(64);
  await assert.rejects(async () => {
    try { await executeConfigurationDeployment(digest.payload, digest.key, "stage-digest", [...deploymentCapabilities], "0.1.0", safeNetwork); }
    catch (error) { const progress = safeConfigurationFailureProgress(error); assert.equal(progress.errorCategory, "parsing"); assert.equal(progress.failureStage, "digest_guard"); throw error; }
  }, /version mismatch/);
  const privateTarget = fixture();
  privateTarget.payload.healthChecks[0].url = "http://169.254.169.254/latest/meta-data";
  await assert.rejects(async () => {
    try { await executeConfigurationDeployment(privateTarget.payload, privateTarget.key, "stage-health", [...deploymentCapabilities], "0.1.0", safeNetwork); }
    catch (error) { const progress = safeConfigurationFailureProgress(error); assert.equal(progress.errorCategory, "health"); assert.equal(progress.failureStage, "health_preflight"); throw error; }
  }, /Health check/);
});
test("ownership preservation is safe for root and same-owner non-root agents", () => {
  if (process.platform === "win32") {
    assert.equal(shouldApplyOwnershipChange(1, 1), false);
    return;
  }
  const uid = process.getuid?.();
  const gid = process.getgid?.();
  assert.equal(typeof uid, "number");
  assert.equal(typeof gid, "number");
  assert.equal(shouldApplyOwnershipChange(uid!, gid!), false);
  if (uid === 0) assert.equal(shouldApplyOwnershipChange(uid! + 1, gid!), true);
  else assert.throws(() => shouldApplyOwnershipChange(uid! + 1, gid!), /ownership/);
});
test("agent applies atomically and preserves backup", async () => { resetReplayStateForTests(); const item = fixture(); const result = await executeConfigurationDeployment(item.payload, item.key, "unique-nonce-001", [...deploymentCapabilities], "0.1.0", { ...safeNetwork, compose: async () => ({ code: 0 }), health: async () => true }); assert.equal(result.phase, "succeeded"); assert.match(fs.readFileSync(item.env, "utf8"), /TOKEN=fixture-value/); assert.equal(fs.existsSync(path.join(item.root, result.backupId!)), true); });
test("agent activation uses bounded local-build compose flags", async () => {
  resetReplayStateForTests();
  const item = fixture();
  const calls: string[][] = [];
  const result = await executeConfigurationDeployment(item.payload, item.key, "local-build-compose-flags", [...deploymentCapabilities], "0.1.0", {
    ...safeNetwork,
    compose: async (args) => { calls.push(args); return { code: 0 }; },
    health: async () => true
  });
  assert.equal(result.phase, "succeeded");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 14), ["compose", "-f", item.compose, "-p", "fixture", "up", "-d", "--no-deps", "--force-recreate", "--build", "--pull", "never", "--quiet-build", "--quiet-pull"]);
  assert.deepEqual(calls[0].slice(14), ["web"]);
});
test("agent waits for delayed health before declaring success", async () => { resetReplayStateForTests(); const item = fixture(); let checks = 0; const result = await executeConfigurationDeployment(item.payload, item.key, "unique-nonce-002", [...deploymentCapabilities], "0.1.0", { ...safeNetwork, compose: async () => ({ code: 0 }), health: async () => ++checks > 1, healthRetryIntervalMs: 0 }); assert.equal(result.phase, "succeeded"); assert.equal(result.healthChecksPassed, 1); assert.equal(checks, 2); });
test("agent rolls back and revalidates health", async () => { resetReplayStateForTests(); const item = fixture(); let composeCalls = 0; const result = await executeConfigurationDeployment(item.payload, item.key, "unique-nonce-rollback", [...deploymentCapabilities], "0.1.0", { ...safeNetwork, compose: async () => { composeCalls += 1; return { code: 0 }; }, health: async () => composeCalls > 1, healthRetryWindowMs: 1, healthRetryIntervalMs: 0 }); assert.equal(result.phase, "rolled_back"); assert.equal(result.healthChecksPassed, 1); assert.equal(fs.readFileSync(item.env, "utf8"), "PUBLIC=value\n"); });
test("agent distinguishes rollback activation and health failures", async () => { resetReplayStateForTests(); const activation = fixture(); let composeCalls = 0; const activationResult = await executeConfigurationDeployment(activation.payload, activation.key, "rollback-activation", [...deploymentCapabilities], "0.1.0", { ...safeNetwork, compose: async () => ({ code: ++composeCalls === 1 ? 1 : 2 }), health: async () => true }); assert.equal(activationResult.phase, "rollback_failed"); assert.equal(activationResult.rollbackErrorCategory, "activation"); resetReplayStateForTests(); const health = fixture(); const healthResult = await executeConfigurationDeployment(health.payload, health.key, "rollback-health", [...deploymentCapabilities], "0.1.0", { ...safeNetwork, compose: async () => ({ code: 0 }), health: async () => false, healthRetryWindowMs: 1, healthRetryIntervalMs: 0 }); assert.equal(healthResult.phase, "rollback_failed"); assert.equal(healthResult.rollbackErrorCategory, "health"); });
test("agent rejects a redirect to a private target and rolls back safely", async () => { resetReplayStateForTests(); const item = fixture(); const originalFetch = globalThis.fetch; let calls = 0; globalThis.fetch = (async () => ++calls === 1 ? new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } }) : new Response(null, { status: 200 })) as typeof fetch; try { const result = await executeConfigurationDeployment(item.payload, item.key, "redirect-private", [...deploymentCapabilities], "0.1.0", { ...safeNetwork, compose: async () => ({ code: 0 }) }); assert.equal(result.phase, "rolled_back"); assert.equal(fs.readFileSync(item.env, "utf8"), "PUBLIC=value\n"); } finally { globalThis.fetch = originalFetch; } });
test("agent rejects replay and expected-version mismatch", async () => { resetReplayStateForTests(); const item = fixture(); await executeConfigurationDeployment(item.payload, item.key, "unique-nonce-003", [...deploymentCapabilities], "0.1.0", { ...safeNetwork, compose: async () => ({ code: 0 }), health: async () => true }); await assert.rejects(() => executeConfigurationDeployment(item.payload, item.key, "unique-nonce-003", [...deploymentCapabilities], "0.1.0", { ...safeNetwork, compose: async () => ({ code: 0 }), health: async () => true }), /Replay/); const other = fixture(); other.payload.expectedConfigurationDigest = "b".repeat(64); await assert.rejects(() => executeConfigurationDeployment(other.payload, other.key, "unique-nonce-004", [...deploymentCapabilities], "0.1.0", safeNetwork), /version mismatch/); });
test("agent independently rejects production, incomplete capability, version, SSRF, escape, and symlink", async () => { resetReplayStateForTests(); const a = fixture(); await assert.rejects(() => executeConfigurationDeployment({ ...a.payload, environmentKind: "production" } as never, a.key, "nonce-production", [...deploymentCapabilities], "0.1.0", safeNetwork)); const b = fixture(); await assert.rejects(() => executeConfigurationDeployment(b.payload, b.key, "nonce-capability", ["environmentFileWrite"], "0.1.0", safeNetwork)); await assert.rejects(() => executeConfigurationDeployment(b.payload, b.key, "nonce-version", [...deploymentCapabilities], "0.1.0-beta.1", safeNetwork), /version/); const privateTarget = fixture(); privateTarget.payload.healthChecks[0].url = "http://169.254.169.254/latest/meta-data"; await assert.rejects(() => executeConfigurationDeployment(privateTarget.payload, privateTarget.key, "nonce-ssrf", [...deploymentCapabilities], "0.1.0", safeNetwork), /Health check/); const c = fixture(); await assert.rejects(() => executeConfigurationDeployment({ ...c.payload, environmentFilePath: path.join(c.root, "..", ".env") }, c.key, "nonce-escape", [...deploymentCapabilities], "0.1.0", safeNetwork)); const d = fixture(); const linked = path.join(d.root, "linked.env"); try { fs.symlinkSync(d.env, linked); await assert.rejects(() => executeConfigurationDeployment({ ...d.payload, environmentFilePath: linked }, d.key, "nonce-symlink", [...deploymentCapabilities], "0.1.0", safeNetwork)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error; } });
test("disposable Docker Compose project activates through fixed arguments", { skip: process.env.CONTROL_CENTER_RUN_DOCKER_DEPLOYMENT_TESTS !== "true" }, async () => { resetReplayStateForTests(); const item = fixture(); fs.writeFileSync(item.compose, "services:\n  web:\n    image: busybox:1.36\n    command: [\"sh\", \"-c\", \"sleep 60\"]\n"); try { const result = await executeConfigurationDeployment(item.payload, item.key, "docker-disposable-nonce", [...deploymentCapabilities], "0.1.0", { ...safeNetwork, health: async () => true }); assert.equal(result.phase, "succeeded"); const output = execFileSync("docker", ["compose", "-f", item.compose, "-p", "fixture", "ps", "--status", "running", "--services"], { encoding: "utf8" }); assert.match(output, /web/); } finally { try { execFileSync("docker", ["compose", "-f", item.compose, "-p", "fixture", "down", "--volumes", "--remove-orphans"]); } catch { /* disposable cleanup best effort */ } } });
