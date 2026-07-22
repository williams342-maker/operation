import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { BETA_STARTUP_SAFETY_FLAGS, runBetaDeploymentPreflight, serializePreflightReport, withBetaPreflightTemporaryFiles, type BetaDeploymentPreflightInput, type ImageInspection } from "../src/betaDeploymentPreflight.js";

const flags = Object.fromEntries(BETA_STARTUP_SAFETY_FLAGS.map((name) => [name, "false"]));
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "opsworkbench-beta-preflight-"));
  const env = path.join(root, ".env.beta");
  const compose = path.join(root, "compose.yml");
  const override = path.join(root, "opsworkbench-images.json");
  fs.writeFileSync(env, `APP_ENV=beta\nENVIRONMENT=beta\n${BETA_STARTUP_SAFETY_FLAGS.map((name) => `${name}=false`).join("\n")}\n`);
  fs.writeFileSync(compose, "services:\n  backend:\n    image: candidate-backend\n    environment:\n      APP_ENV: ${APP_ENV:-production}\n      ENVIRONMENT: ${ENVIRONMENT:-production}\n  frontend:\n    image: candidate-frontend\n  mongo:\n    image: mongo:7\n");
  fs.writeFileSync(override, `${JSON.stringify({ services: { backend: { image: "candidate-backend" }, frontend: { image: "candidate-frontend" } } }, null, 2)}\n`);
  const input: BetaDeploymentPreflightInput = {
    targetEnvironment: "beta", composeWorkingDirectory: root, composeProjectName: "craftersmarket",
    composeFilePath: compose, environmentFilePath: env, composeOverrideFilePath: override, authorizedBackendImage: "candidate-backend",
    authorizedFrontendImage: "candidate-frontend", rollbackBackendImage: "rollback-backend",
    rollbackFrontendImage: "rollback-frontend", authorizedServices: ["backend", "frontend"],
    allowedComposeServices: ["backend", "frontend", "mongo"], allowedHostnames: ["craftersmarketbeta.shop"],
    allowedDatabaseDestinations: [{ hostname: "mongo", databaseName: "craftersmarket" }],
  };
  const model = { name: "craftersmarket", services: {
    backend: { image: "candidate-backend", environment: { APP_ENV: "beta", ENVIRONMENT: "beta", ...flags, MONGO_URL: "mongodb://mongo:27017/craftersmarket" }, healthcheck: { test: ["CMD", "true"] }, restart: "unless-stopped" },
    frontend: { image: "candidate-frontend", environment: { REACT_APP_BACKEND_URL: "https://craftersmarketbeta.shop" }, healthcheck: { test: ["CMD", "true"] }, restart: "unless-stopped" },
    mongo: { image: "mongo:7" },
  }, networks: { default: {} }, volumes: { mongo_data: {} } };
  const images: Record<string, ImageInspection> = {
    "candidate-backend": { id: "sha256:candidate-backend", repoTags: ["candidate-backend"], revision: "candidate" },
    "candidate-frontend": { id: "sha256:candidate-frontend", repoTags: ["candidate-frontend"], revision: "candidate" },
    "rollback-backend": { id: "sha256:rollback-backend", repoTags: ["rollback-backend"] },
    "rollback-frontend": { id: "sha256:rollback-frontend", repoTags: ["rollback-frontend"] },
  };
  let calls = 0; let args: string[] = [];
  const hooks = {
    now: () => new Date("2026-07-22T00:00:00.000Z"),
    composeConfig: async (received: string[]) => { calls += 1; args = received; return { code: 0, stdout: JSON.stringify(model), stderr: "" }; },
    inspectImage: async (image: string) => images[image] || null,
  };
  return { root, env, compose, override, input, model, images, hooks, get calls() { return calls; }, get args() { return args; } };
}

test("passes with explicit beta env and stops at operator approval", async () => {
  const item = fixture(); const result = await runBetaDeploymentPreflight(item.input, item.hooks);
  assert.equal(result.status, "PASS — awaiting operator approval");
  assert.equal(item.calls, 1); assert.deepEqual(item.args.slice(0, 9), ["compose", "--project-name", "craftersmarket", "--env-file", item.env, "-f", item.compose, "-f", item.override]);
  assert.match(result.report.deploymentCommand!, /--no-build --no-deps --force-recreate 'backend' 'frontend'$/);
  assert.match(result.report.rollbackCommand!, /docker image tag 'rollback-backend' 'candidate-backend'/);
  assert.equal(result.report.mongoDbRecreation, "blocked"); assert.equal(result.report.mongoDbServiceIncluded, "no"); assert.equal(result.report.volumeRecreation, "no");
  assert.ok(Object.values(result.report.startupSafetyFlags).every((value) => value === "PASS"));
});

test("blocks the exact omitted env-file production-default regression without executing", async () => {
  const item = fixture(); item.input.environmentFilePath = "";
  assert.match(fs.readFileSync(item.compose, "utf8"), /APP_ENV: \$\{APP_ENV:-production\}/);
  const result = await runBetaDeploymentPreflight(item.input, item.hooks);
  assert.equal(result.status, "BLOCKED"); assert.equal(item.calls, 0); assert.equal(result.report.deploymentCommand, undefined); assert.equal(result.report.operatorApprovalStatus, "not-available");
});

test("blocks a wrong env file and production interpolation", async () => {
  const item = fixture(); fs.writeFileSync(item.env, `APP_ENV=production\nENVIRONMENT=production\n${BETA_STARTUP_SAFETY_FLAGS.map((name) => `${name}=false`).join("\n")}\n`);
  const result = await runBetaDeploymentPreflight(item.input, item.hooks); assert.equal(result.status, "BLOCKED"); assert.equal(item.calls, 0);
});

test("blocks missing and truthy safety flags", async () => {
  for (const mode of ["missing", "truthy"] as const) {
    const item = fixture(); const env = item.model.services.backend.environment as Record<string, string>;
    if (mode === "missing") delete env.EMAIL_JOBS_ENABLED; else env.EMAIL_JOBS_ENABLED = "true";
    const result = await runBetaDeploymentPreflight(item.input, item.hooks); assert.equal(result.status, "BLOCKED"); assert.equal(result.report.startupSafetyFlags.EMAIL_JOBS_ENABLED, "FAIL");
  }
});

test("blocks production frontend, MongoDB, and live-mode destinations", async () => {
  const cases = [
    (item: ReturnType<typeof fixture>) => { item.model.services.frontend.environment.REACT_APP_BACKEND_URL = "https://craftersmarket.org/api"; },
    (item: ReturnType<typeof fixture>) => { item.model.services.backend.environment.MONGO_URL = "mongodb+srv://prod.example.com/db"; },
    (item: ReturnType<typeof fixture>) => { item.model.services.backend.environment.STRIPE_MODE = "live"; },
  ];
  for (const mutate of cases) { const item = fixture(); mutate(item); assert.equal((await runBetaDeploymentPreflight(item.input, item.hooks)).status, "BLOCKED"); }
});

test("parses comma-delimited URL values as independent destinations", async () => {
  const item = fixture();
  (item.model.services.backend.environment as Record<string, string>).CORS_ORIGINS = "https://craftersmarketbeta.shop, https://craftersmarketbeta.shop";
  const result = await runBetaDeploymentPreflight(item.input, item.hooks);
  assert.equal(result.status, "PASS — awaiting operator approval");
  assert.equal(result.checks.some((check) => check.detail.includes("malformed")), false);
});

test("database destination requires an exact hostname and database fingerprint", async () => {
  const item = fixture();
  item.input.allowedDatabaseDestinations = [];
  const result = await runBetaDeploymentPreflight(item.input, item.hooks);
  assert.equal(result.status, "BLOCKED");
  assert.deepEqual(result.report.databaseDestination, { sourceVariable: "MONGO_URL", hostname: "mongo", databaseName: "craftersmarket", classification: "blocked" });
});

test("image override must contain exactly the two authorized image bindings", async () => {
  const item = fixture();
  fs.writeFileSync(item.override, JSON.stringify({ services: { backend: { image: "candidate-backend" }, frontend: { image: "candidate-frontend" }, mongo: { image: "mongo:7" } } }));
  const result = await runBetaDeploymentPreflight(item.input, item.hooks);
  assert.equal(result.status, "BLOCKED");
  assert.equal(item.calls, 0);
});

test("temporary image override and service env reference are always removed", async () => {
  const item = fixture();
  fs.rmSync(item.override);
  const reference = path.join(item.root, "backend", ".env");
  fs.mkdirSync(path.dirname(reference));
  item.input.serviceEnvironmentReferencePath = reference;
  const hooks = {
    createReference: (target: string, destination: string) => fs.writeFileSync(destination, target),
    readReference: (destination: string) => fs.readFileSync(destination, "utf8"),
  };
  await assert.rejects(withBetaPreflightTemporaryFiles(item.input, async () => {
    assert.equal(fs.readFileSync(reference, "utf8"), item.env);
    assert.equal(fs.existsSync(item.override), true);
    throw new Error("synthetic failure");
  }, hooks), /synthetic failure/);
  assert.equal(fs.existsSync(reference), false);
  assert.equal(fs.existsSync(item.override), false);
});

test("blocks MongoDB authorization and unexpected Compose services", async () => {
  const mongo = fixture(); mongo.input.authorizedServices.push("mongo"); assert.equal((await runBetaDeploymentPreflight(mongo.input, mongo.hooks)).status, "BLOCKED"); assert.equal(mongo.calls, 0);
  const unexpected = fixture(); (unexpected.model.services as Record<string, unknown>).worker = { image: "worker" }; assert.equal((await runBetaDeploymentPreflight(unexpected.input, unexpected.hooks)).status, "BLOCKED");
});

test("blocks missing candidate or rollback images and ambiguous image plans", async () => {
  for (const missing of ["candidate-backend", "rollback-frontend"]) {
    const item = fixture(); delete item.images[missing]; assert.equal((await runBetaDeploymentPreflight(item.input, item.hooks)).status, "BLOCKED");
  }
  const same = fixture(); same.images["rollback-backend"].id = same.images["candidate-backend"].id; assert.equal((await runBetaDeploymentPreflight(same.input, same.hooks)).status, "BLOCKED");
});

test("blocks conflicting duplicate environment definitions", async () => {
  const item = fixture(); fs.appendFileSync(item.env, "APP_ENV=production\n");
  const result = await runBetaDeploymentPreflight(item.input, item.hooks); assert.equal(result.status, "ERROR"); assert.match(result.checks.at(-1)!.detail, /duplicate/i); assert.equal(item.calls, 0);
});

test("reports are secret-free and preflight never calls a changing command", async () => {
  const item = fixture(); const secret = "synthetic-secret-value"; (item.model.services.backend.environment as Record<string, string>).MAILGUN_API_KEY = secret;
  const result = await runBetaDeploymentPreflight(item.input, item.hooks); const serialized = serializePreflightReport(result);
  assert.equal(result.status, "PASS — awaiting operator approval"); assert.equal(serialized.includes(secret), false); assert.equal(item.calls, 1);
  assert.deepEqual(item.args.slice(-3), ["config", "--format", "json"]); assert.equal(item.args.includes("up"), false); assert.equal(item.args.includes("create"), false); assert.equal(item.args.includes("restart"), false);
});

test("blocks missing compose and environment files", async () => {
  const env = fixture(); env.input.environmentFilePath = path.join(env.root, "missing.env"); assert.equal((await runBetaDeploymentPreflight(env.input, env.hooks)).status, "BLOCKED");
  const compose = fixture(); compose.input.composeFilePath = path.join(compose.root, "missing.yml"); assert.equal((await runBetaDeploymentPreflight(compose.input, compose.hooks)).status, "BLOCKED");
});
