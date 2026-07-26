import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { projectDeploymentCapabilities } from "@control-center/shared";
import { executeProjectDeployment, resetProjectDeploymentReplayForTests, safeProjectDeploymentFailure } from "../src/projectDeployment.js";

process.env.NODE_ENV = "test";
const checkpoint = "a".repeat(40);
const requested = "b".repeat(40);
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "project-deployment-"));
  const composePath = path.join(root, "compose.yml");
  const overridePath = path.join(root, "compose.staging.yml");
  fs.writeFileSync(composePath, "services:\n  web:\n    image: fixture\n");
  fs.writeFileSync(overridePath, "services:\n  web:\n    environment:\n      STAGING: true\n");
  return { root, payload: { schemaVersion: "project-deployment-v1" as const, action: "project.deploy.v1" as const, deploymentId: "123456789012", planDigest: "c".repeat(64), environmentKind: "staging" as const, protected: false as const, targetProfileId: "123456789013", targetProfileRevision: 2, repositoryRoot: root, composePath, composeOverridePaths: [overridePath], composeProject: "fixture", statelessServices: ["web"], protectedServices: ["mongo"], healthChecks: [{ id: "web", url: "https://health.example.test/ready", timeoutMs: 100 }], branch: "main", expectedCurrentRevision: checkpoint, requestedRevision: requested, automaticRollback: true as const } };
}
function gitHook(resetCalls: string[] = []) {
  return async (args: string[]) => {
    const command = args.join(" ");
    if (command === "rev-parse HEAD") return { code: 0, stdout: `${checkpoint}\n` };
    if (command === "symbolic-ref --short HEAD") return { code: 0, stdout: "main\n" };
    if (command === "status --porcelain") return { code: 0, stdout: "" };
    if (command === `rev-parse --verify ${requested}^{commit}`) return { code: 0, stdout: `${requested}\n` };
    if (command === "rev-parse HEAD^{tree}") return { code: 0, stdout: `${"d".repeat(40)}\n` };
    if (args[0] === "reset") { resetCalls.push(args[2]); return { code: 0, stdout: "" }; }
    return { code: 1, stdout: "" };
  };
}

test("executes the exact approved revision with ordered Compose files", async () => {
  resetProjectDeploymentReplayForTests(); const item = fixture(); const resets: string[] = []; const composeCalls: string[][] = [];
  const result = await executeProjectDeployment(item.payload, "deployment-nonce-1", [...projectDeploymentCapabilities], { git: gitHook(resets), compose: async (args) => { composeCalls.push(args); return { code: 0 }; }, health: async () => true, resolve: async () => ["93.184.216.34"] });
  assert.equal(result.phase, "succeeded"); assert.deepEqual(resets, [requested]); assert.equal(result.checkpointRevision, checkpoint); assert.equal(result.rollbackAttempted, false);
  assert.deepEqual(composeCalls[0].slice(0, 7), ["compose", "-f", item.payload.composePath, "-f", item.payload.composeOverridePaths[0], "-p", "fixture"]);
  assert.equal(result.healthChecksPassed, 1); assert.match(result.releaseId!, /^deploy-/); assert.match(result.artifactDigest!, /^[a-f0-9]{64}$/);
});

test("automatically restores and validates the checkpoint after activation failure", async () => {
  resetProjectDeploymentReplayForTests(); const item = fixture(); const resets: string[] = []; let composeCalls = 0;
  const result = await executeProjectDeployment(item.payload, "deployment-nonce-2", [...projectDeploymentCapabilities], { git: gitHook(resets), compose: async () => ({ code: ++composeCalls === 1 ? 1 : 0 }), health: async () => true, resolve: async () => ["93.184.216.34"] });
  assert.equal(result.phase, "rolled_back"); assert.deepEqual(resets, [requested, checkpoint]); assert.equal(result.restoredRevision, checkpoint); assert.equal(result.rollbackAttempted, true); assert.equal(result.rollbackVerified, true); assert.equal(result.failureClassification, "activation");
});

test("fails closed before mutation when repository state changed or capabilities are missing", async () => {
  resetProjectDeploymentReplayForTests(); const item = fixture();
  await assert.rejects(() => executeProjectDeployment(item.payload, "deployment-nonce-3", [], { git: gitHook(), health: async () => true }), /capabilities/);
  resetProjectDeploymentReplayForTests();
  const result = safeProjectDeploymentFailure(await executeProjectDeployment({ ...item.payload, protected: true }, "deployment-nonce-4", [...projectDeploymentCapabilities]).catch((error) => error));
  assert.equal(result.phase, "failed"); assert.equal(result.failureClassification, "schema"); assert.equal(result.rollbackAttempted, false);
});
