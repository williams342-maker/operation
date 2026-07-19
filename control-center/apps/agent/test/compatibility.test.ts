import assert from "node:assert/strict";
import test from "node:test";
import { agentPollRequestSchema } from "@control-center/shared";
import { agentConfigSchema } from "../src/config.js";

test("existing agent configuration survives upgrade parsing", () => {
  const before = { controlCenterUrl: "https://opsworkbench.org", installationId: "install-1", requestedSlug: "example-app", agentId: "agent-1", agentSecret: "secret-value", agentVersion: "0.1.0", allowedRoots: ["/srv/example-app"], pollIntervalSeconds: 30, mongoChecks: {} };
  assert.deepEqual(agentConfigSchema.parse(before), before);
});

test("old heartbeat remains compatible with the new API schema", () => {
  assert.equal(agentPollRequestSchema.safeParse({ heartbeat: { collectedAt: new Date().toISOString(), agentVersion: "0.1.0" } }).success, true);
});

test("new discovery fields are optional for rolling upgrades", () => {
  const heartbeat = { heartbeat: { collectedAt: new Date().toISOString(), agentVersion: "0.2.0" }, metrics: { collectedAt: new Date().toISOString(), agentVersion: "0.2.0", uptimeSeconds: 1, cpu: { loadPercent: 1, cores: 1 }, memory: { totalBytes: 1, usedBytes: 0 }, disk: [] } };
  assert.equal(agentPollRequestSchema.safeParse(heartbeat).success, true);
});
