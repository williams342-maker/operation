import test from "node:test";
import assert from "node:assert/strict";
import { authorizePrivilegedTask, signOwnerAuthorization, privilegedActionDigest, isPrivilegedTaskType, privilegedTaskTypes } from "../src/ownerAuthorization.js";
import { generateAgentKeyPairs } from "../src/agentKeys.js";
import { payloadDigest, taskTypes, taskTypeClassification, taskEnvelopeSchema, type TaskEnvelope, type OwnerAuthorization } from "../src/tasks.js";

// Disposable dev owner keypair (Ed25519). The production owner private key is never handled in-repo.
const owner = generateAgentKeyPairs();
const ownerPublicKey = owner.signingPublicKey;
const NOW = Date.parse("2026-08-03T00:00:00.000Z");
const HOUR = 3600_000;
const payload = { projects: [], httpHealthChecks: [], mongoChecks: [], configurationDeployment: { planId: "plan-1", revision: 3 } };

function envelope(overrides: Partial<TaskEnvelope> = {}): TaskEnvelope {
  return { protocolVersion: "task-v1", taskId: "task-1", taskType: "configuration.apply", orgId: "org-1", serverId: "server-1", agentId: "agent-1", issuedAt: new Date(NOW).toISOString(), expiresAt: new Date(NOW + HOUR).toISOString(), nonce: "envelope-nonce", payloadDigest: payloadDigest(payload), signingKeyVersion: "cp-ed25519-v1", signature: "transport-signature", ...overrides };
}
function ownerAuth(env: TaskEnvelope, p: unknown, opts: { expiresAt?: string; nonce?: string; keyVersion?: string; signWith?: string; actionPayload?: unknown } = {}): OwnerAuthorization {
  const expiresAt = opts.expiresAt ?? new Date(NOW + HOUR).toISOString();
  const nonce = opts.nonce ?? "owner-nonce-1";
  const keyVersion = opts.keyVersion ?? "owner-v1";
  const signature = signOwnerAuthorization(opts.signWith ?? owner.signingPrivateKey, { taskType: env.taskType, orgId: env.orgId, serverId: env.serverId, actionDigest: privilegedActionDigest(opts.actionPayload ?? p), expiresAt, nonce, keyVersion });
  return { signature, issuedAt: new Date(NOW).toISOString(), expiresAt, nonce, keyVersion };
}
const reason = (d: ReturnType<typeof authorizePrivilegedTask>) => (d as { reason: string }).reason;

test("isPrivilegedTaskType marks state-changing managed-server actions only", () => {
  for (const t of ["configuration.apply", "configuration.rollback", "agent.upgrade"]) assert.equal(isPrivilegedTaskType(t), true);
  for (const t of ["collect.system", "check.http", "inspect.docker"]) assert.equal(isPrivilegedTaskType(t), false);
});

test("privileged task needs BOTH a valid transport envelope AND owner authorization", () => {
  const env = envelope();
  assert.deepEqual(authorizePrivilegedTask({ envelope: env, payload, ownerAuthorization: ownerAuth(env, payload), ownerPublicKey, verifyEnvelope: () => true, now: NOW }), { authorized: true });
  // (1)/(4): valid envelope (control-plane key) but NO owner authorization → rejected. The transport key alone cannot authorize.
  assert.equal(reason(authorizePrivilegedTask({ envelope: env, payload, ownerPublicKey, verifyEnvelope: () => true, now: NOW })), "owner-authorization-missing");
  // (2): valid envelope + owner signature by the WRONG key → rejected.
  assert.equal(reason(authorizePrivilegedTask({ envelope: env, payload, ownerAuthorization: ownerAuth(env, payload, { signWith: generateAgentKeyPairs().signingPrivateKey }), ownerPublicKey, verifyEnvelope: () => true, now: NOW })), "owner-authorization-invalid");
  // (3)/(8b): valid owner authorization but INVALID/revoked transport envelope key → rejected.
  assert.equal(reason(authorizePrivilegedTask({ envelope: env, payload, ownerAuthorization: ownerAuth(env, payload), ownerPublicKey, verifyEnvelope: () => false, now: NOW })), "envelope-invalid");
});

test("substitution, replay, expiry, and key-version mismatch all fail closed", () => {
  const env = envelope();
  const oa = ownerAuth(env, payload);
  // (5a) payload substitution → actionDigest changes → invalid
  assert.equal(reason(authorizePrivilegedTask({ envelope: env, payload: { ...payload, configurationDeployment: { planId: "EVIL", revision: 99 } }, ownerAuthorization: oa, ownerPublicKey, verifyEnvelope: () => true, now: NOW })), "owner-authorization-invalid");
  // (5b/5c/6) target / action / cross-agent substitution: changing the envelope's bound fields breaks the owner binding
  for (const field of ["serverId", "orgId", "taskType"] as const) {
    assert.equal(reason(authorizePrivilegedTask({ envelope: envelope({ [field]: "SUBSTITUTED" }), payload, ownerAuthorization: oa, ownerPublicKey, verifyEnvelope: () => true, now: NOW })), "owner-authorization-invalid");
  }
  // (5d) expired owner authorization (signed with a past expiry) → rejected
  assert.equal(reason(authorizePrivilegedTask({ envelope: env, payload, ownerAuthorization: ownerAuth(env, payload, { expiresAt: new Date(NOW - HOUR).toISOString() }), ownerPublicKey, verifyEnvelope: () => true, now: NOW })), "expired");
  // (7) task/action replay: an authorization minted for a DIFFERENT action cannot authorize this one
  const otherAction = ownerAuth(env, payload, { actionPayload: { ...payload, configurationDeployment: { planId: "other", revision: 1 } } });
  assert.equal(reason(authorizePrivilegedTask({ envelope: env, payload, ownerAuthorization: otherAction, ownerPublicKey, verifyEnvelope: () => true, now: NOW })), "owner-authorization-invalid");
  // (8a) key-version mismatch (tamper keyVersion after signing) → binding breaks → invalid
  assert.equal(reason(authorizePrivilegedTask({ envelope: env, payload, ownerAuthorization: { ...oa, keyVersion: "owner-v2" }, ownerPublicKey, verifyEnvelope: () => true, now: NOW })), "owner-authorization-invalid");
});

// ── one table, because two lists drift ─────────────────────────────────────────────────────────────

test("a task type cannot exist without an authorization classification", () => {
  // An independent review found that `taskTypes` and `privilegedTaskTypes` were maintained separately,
  // and that the drift was fail-OPEN: a new mutating type added to the first and forgotten in the second
  // skipped BOTH the owner signature and the review gate, silently, because "not privileged" and "not yet
  // classified" were the same answer.
  assert.deepEqual([...taskTypes].sort(), Object.keys(taskTypeClassification).sort());
  for (const type of taskTypes) {
    assert.ok(["read", "privileged"].includes(taskTypeClassification[type]),
      `${type} has no authorization classification`);
  }
});

test("isPrivilegedTaskType is DERIVED from that table, not a second list", () => {
  for (const [type, classification] of Object.entries(taskTypeClassification)) {
    assert.equal(isPrivilegedTaskType(type), classification === "privileged", type);
  }
  assert.deepEqual([...privilegedTaskTypes].sort(),
    Object.entries(taskTypeClassification).filter(([, c]) => c === "privileged").map(([t]) => t).sort());
  // The three that change a managed host, and nothing else.
  assert.deepEqual([...privilegedTaskTypes].sort(),
    ["agent.upgrade", "configuration.apply", "configuration.rollback"]);
});

test("an UNCLASSIFIED task type is refused at the protocol boundary", () => {
  // The remaining way to add a mutating effect without classifying it is to invent a type that is in
  // neither. The envelope schema rejects it, so it never reaches an executor at all.
  for (const invented of ["configuration.purge", "host.exec", "agent.downgrade", ""]) {
    assert.equal(isPrivilegedTaskType(invented), false, "unclassified is not privileged...");
    const parsed = taskEnvelopeSchema.safeParse({
      protocolVersion: "task-v1", taskId: "t-1", taskType: invented, orgId: "o", serverId: "s",
      agentId: "a", issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      nonce: "nonce-nonce-nonce", payloadDigest: "a".repeat(64), signingKeyVersion: "cp-ed25519-v1",
      signature: "x".repeat(64),
    });
    // ...so it had better not be dispatchable either.
    assert.equal(parsed.success, false, `${invented} must not parse as a task envelope`);
  }
});
