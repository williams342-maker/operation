import test from "node:test";
import assert from "node:assert/strict";
import { payloadDigest, signTaskEnvelope, taskAckSchema, taskPayloadSchema, taskProtocolVersion, verifyTaskEnvelope, isTaskExpired } from "../src/tasks.js";

function envelope(payload: unknown) {
  const unsigned = {
    protocolVersion: taskProtocolVersion,
    taskId: "task-1",
    taskType: "collect.system" as const,
    orgId: "org-1",
    serverId: "server-1",
    agentId: "agent-1",
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    nonce: "nonce-123456789",
    payloadDigest: payloadDigest(payload),
    signingKeyVersion: "v1"
  };
  return { ...unsigned, signature: signTaskEnvelope("agent-key", unsigned) };
}

test("task envelope signature verifies bound task fields and payload digest", () => {
  const payload = { projects: [], httpHealthChecks: [], mongoChecks: [] };
  const signed = envelope(payload);
  assert.equal(verifyTaskEnvelope("agent-key", signed, payload), true);
  assert.equal(verifyTaskEnvelope("agent-key", { ...signed, agentId: "wrong-agent" }, payload), false);
  assert.equal(verifyTaskEnvelope("agent-key", signed, { ...payload, projects: [{ projectId: "p" }] }), false);
  assert.equal(verifyTaskEnvelope("wrong-key", signed, payload), false);
});

test("task expiry rejects stale envelopes", () => {
  assert.equal(isTaskExpired(new Date(Date.now() - 1_000).toISOString()), true);
  assert.equal(isTaskExpired(new Date(Date.now() + 60_000).toISOString()), false);
});

test("task acknowledgements reject malformed events and contradictory status fields", () => {
  assert.equal(taskAckSchema.safeParse({ taskId: "task-1", event: "succeeded" }).success, true);
  assert.equal(taskAckSchema.safeParse({ taskId: "task-1", event: "timeout" }).success, false);
  assert.equal(taskAckSchema.safeParse({ taskId: "task-1", event: "rejected" }).success, false);
  assert.equal(taskAckSchema.safeParse({ taskId: "task-1", event: "succeeded", status: "failed" }).success, false);
  assert.equal(taskAckSchema.safeParse({ taskId: "task-1" }).success, false);
});

test("agent upgrade payload accepts only a typed immutable manifest", () => {
  const unsigned = { schemaVersion: "agent-upgrade-v1" as const, upgradeId: "upgrade-123456", serverId: "server-123456", expectedAgentId: "agent-123456", expectedCurrentVersion: "1.0.0", targetVersion: "1.1.0", releaseId: "release-110", artifactSha256: "a".repeat(64), artifactSignature: "s".repeat(80), signatureKeyId: "key-1", releaseManifestDigest: "b".repeat(64), operatingSystem: "linux", architecture: "x64", packageType: "tar" as const, requiredCapabilities: ["agentUpgrade"], expiresAt: "2030-01-01T00:00:00.000Z", nonce: "nonce-1234567890123456" };
  const payload = { projects: [], httpHealthChecks: [], mongoChecks: [], agentUpgrade: { ...unsigned, planDigest: "c".repeat(64) } };
  assert.equal(taskPayloadSchema.safeParse(payload).success, true);
  assert.equal(taskPayloadSchema.safeParse({ ...payload, command: "sh" }).success, false);
  assert.equal(taskPayloadSchema.safeParse({ ...payload, agentUpgrade: { ...payload.agentUpgrade, artifactUrl: "https://unapproved.example.test/payload" } }).success, false);
});
