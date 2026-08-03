import test from "node:test";
import assert from "node:assert/strict";
import { signTaskEnvelopeV2, verifyTaskEnvelopeV2, signTaskEnvelope, verifyTaskEnvelope, payloadDigest, type TaskEnvelope } from "../src/tasks.js";
import { generateAgentKeyPairs } from "../src/agentKeys.js";

const payload = { projects: [], httpHealthChecks: [], mongoChecks: [] };
function unsignedEnvelope(overrides: Partial<Omit<TaskEnvelope, "signature">> = {}): Omit<TaskEnvelope, "signature"> {
  return {
    protocolVersion: "task-v1",
    taskId: "task-1",
    taskType: "collect.system",
    orgId: "org-1",
    serverId: "server-1",
    agentId: "agent-1",
    issuedAt: "2026-08-03T00:00:00.000Z",
    expiresAt: "2026-08-03T01:00:00.000Z",
    nonce: "nonce-1",
    payloadDigest: payloadDigest(payload),
    signingKeyVersion: "cp-ed25519-v1",
    ...overrides
  };
}

test("v2 control-plane task envelope round-trips and rejects tampering", () => {
  const cp = generateAgentKeyPairs();
  const unsigned = unsignedEnvelope();
  const envelope: TaskEnvelope = { ...unsigned, signature: signTaskEnvelopeV2(cp.signingPrivateKey, unsigned) };
  assert.equal(verifyTaskEnvelopeV2(cp.signingPublicKey, envelope, payload), true);
  // Payload substitution
  assert.equal(verifyTaskEnvelopeV2(cp.signingPublicKey, envelope, { projects: [{ projectId: "x" }], httpHealthChecks: [], mongoChecks: [] }), false);
  // Cross-agent / cross-target rebinding
  for (const field of ["agentId", "serverId", "taskId", "orgId", "expiresAt", "nonce"] as const) {
    assert.equal(verifyTaskEnvelopeV2(cp.signingPublicKey, { ...envelope, [field]: "tampered" }, payload), false, `${field} tamper must fail`);
  }
  // Wrong control-plane key
  assert.equal(verifyTaskEnvelopeV2(generateAgentKeyPairs().signingPublicKey, envelope, payload), false);
});

test("v2 and v1 envelopes cannot be cross-verified (downgrade/confusion prevention)", () => {
  const cp = generateAgentKeyPairs();
  const unsigned = unsignedEnvelope();
  const v2: TaskEnvelope = { ...unsigned, signature: signTaskEnvelopeV2(cp.signingPrivateKey, unsigned) };
  // A v2 (Ed25519) envelope must not pass the v1 HMAC verifier under any secret.
  assert.equal(verifyTaskEnvelope("any-hmac-secret", v2, payload), false);
  // A v1 (HMAC) envelope must not pass the v2 Ed25519 verifier.
  const v1: TaskEnvelope = { ...unsigned, signingKeyVersion: "v1", signature: signTaskEnvelope("hmac-secret", { ...unsigned, signingKeyVersion: "v1" }) };
  assert.equal(verifyTaskEnvelopeV2(cp.signingPublicKey, v1, payload), false);
});
