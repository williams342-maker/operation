import test from "node:test";
import assert from "node:assert/strict";
import { payloadDigest, signTaskEnvelope, taskProtocolVersion, verifyTaskEnvelope, isTaskExpired } from "../src/tasks.js";

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
