import assert from "node:assert/strict";
import test from "node:test";
import { agentPollRequestSchema } from "@control-center/shared";
import { agentConfigSchema } from "../src/config.js";

test("existing agent configuration survives upgrade parsing", () => {
  const before = { controlCenterUrl: "https://opsworkbench.org", installationId: "install-1", requestedSlug: "synthetic-host", agentId: "agent-1", agentSecret: "synthetic-placeholder", agentVersion: "0.1.0", allowedRoots: ["/srv/example"], pollIntervalSeconds: 30, mongoChecks: {} };
  const parsed = agentConfigSchema.parse(before);
  assert.equal(parsed.agentId, before.agentId); assert.equal(parsed.agentSecret, before.agentSecret); assert.deepEqual(parsed.allowedRoots, before.allowedRoots);
  assert.equal(parsed.serverId, ""); assert.equal(parsed.protocolVersion, "task-v1"); assert.equal(parsed.packageType, "tar"); assert.equal(parsed.releaseChannel, "stable");
});

test("old heartbeat remains compatible with the new API schema", () => {
  assert.equal(agentPollRequestSchema.safeParse({ heartbeat: { collectedAt: new Date().toISOString(), agentVersion: "0.1.0" } }).success, true);
});

test("new discovery fields are optional for rolling upgrades", () => {
  const heartbeat = { heartbeat: { collectedAt: new Date().toISOString(), agentVersion: "0.2.0" }, metrics: { collectedAt: new Date().toISOString(), agentVersion: "0.2.0", uptimeSeconds: 1, cpu: { loadPercent: 1, cores: 1 }, memory: { totalBytes: 1, usedBytes: 0 }, disk: [] } };
  assert.equal(agentPollRequestSchema.safeParse(heartbeat).success, true);
});
