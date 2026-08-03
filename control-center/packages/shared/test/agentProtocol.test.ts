import test from "node:test";
import assert from "node:assert/strict";
import { agentProtocolVersions, agentProtocolVersionSchema, defaultAgentProtocolVersion, nextMigrationState, acceptedSchemes, describeAgentCredential, verifyEnrollmentV2 } from "../src/agentProtocol.js";
import { generateAgentKeyPairs, keyFingerprint, signEnrollmentProof } from "../src/agentKeys.js";

const NOW = Date.parse("2026-08-03T00:00:00.000Z");
function validV2Request(overrides: Partial<Parameters<typeof verifyEnrollmentV2>[0]> = {}) {
  const keys = generateAgentKeyPairs();
  const base = { enrollmentToken: "owenr_token_value_at_least_32_chars_xx", signingPublicKey: keys.signingPublicKey, encryptionPublicKey: keys.encryptionPublicKey, issuedAt: new Date(NOW).toISOString(), protocolVersion: "agent-v2" };
  const request = { ...base, ...overrides };
  const proof = overrides.proof ?? signEnrollmentProof(keys.signingPrivateKey, { enrollmentToken: request.enrollmentToken, signingPublicKey: request.signingPublicKey, encryptionPublicKey: request.encryptionPublicKey, issuedAt: request.issuedAt, protocolVersion: request.protocolVersion });
  return { request: { ...request, proof }, keys };
}

test("protocol versions are pinned and parse strictly", () => {
  assert.deepEqual([...agentProtocolVersions], ["agent-v1", "agent-v2"]);
  assert.equal(defaultAgentProtocolVersion, "agent-v1");
  assert.equal(agentProtocolVersionSchema.parse("agent-v2"), "agent-v2");
  assert.throws(() => agentProtocolVersionSchema.parse("agent-v3"));
});

test("migration state machine allows only legal transitions", () => {
  assert.equal(nextMigrationState("legacy", "begin"), "dual");
  assert.equal(nextMigrationState("dual", "begin"), "dual"); // idempotent
  assert.equal(nextMigrationState("dual", "complete"), "v2");
  assert.equal(nextMigrationState("v2", "complete"), "v2"); // idempotent
  assert.equal(nextMigrationState("v2", "rollback"), "dual");
  assert.equal(nextMigrationState("dual", "rollback"), "legacy");
  assert.equal(nextMigrationState("legacy", "rollback"), "legacy"); // idempotent
  // Illegal transitions fail closed.
  assert.throws(() => nextMigrationState("legacy", "complete"), /Cannot complete/);
  assert.throws(() => nextMigrationState("v2", "begin"), /Cannot begin/);
});

test("acceptedSchemes reflects the dual-accept window", () => {
  assert.deepEqual(acceptedSchemes("legacy"), ["agent-v1"]);
  assert.deepEqual(acceptedSchemes("dual"), ["agent-v1", "agent-v2"]);
  assert.deepEqual(acceptedSchemes("v2"), ["agent-v2"]);
});

test("keyFingerprint is one-way, stable, and distinct per key", () => {
  const a = generateAgentKeyPairs();
  const b = generateAgentKeyPairs();
  const fa = keyFingerprint(a.signingPublicKey);
  assert.match(fa, /^[a-f0-9]{64}$/);
  assert.equal(fa, keyFingerprint(a.signingPublicKey)); // stable
  assert.notEqual(fa, keyFingerprint(a.encryptionPublicKey)); // distinct per key
  assert.notEqual(fa, keyFingerprint(b.signingPublicKey));
  assert.notEqual(fa, a.signingPublicKey); // not the key itself
});

test("verifyEnrollmentV2 accepts a valid, fresh, well-formed request", () => {
  const { request } = validV2Request();
  assert.deepEqual(verifyEnrollmentV2(request, NOW), { valid: true });
});

test("verifyEnrollmentV2 rejects downgrade, key-reuse, expiry, malformed, and forgery", () => {
  // downgrade: protocolVersion not agent-v2
  assert.equal(verifyEnrollmentV2(validV2Request({ protocolVersion: "agent-v1" }).request, NOW).valid, false);
  assert.equal((verifyEnrollmentV2(validV2Request({ protocolVersion: "agent-v1" }).request, NOW) as { reason: string }).reason, "downgrade");
  // key reuse: same key for signing + encryption
  const reuse = validV2Request();
  const reused = { ...reuse.request, encryptionPublicKey: reuse.request.signingPublicKey };
  assert.equal((verifyEnrollmentV2(reused, NOW) as { reason: string }).reason, "key-reuse");
  // expired: issuedAt outside the skew window
  assert.equal((verifyEnrollmentV2(validV2Request({ issuedAt: new Date(NOW - 30 * 60 * 1000).toISOString() }).request, NOW) as { reason: string }).reason, "expired");
  // malformed: missing a key
  assert.equal((verifyEnrollmentV2({ ...validV2Request().request, signingPublicKey: "" }, NOW) as { reason: string }).reason, "malformed");
  // forged: proof signed by a different key / tampered token
  const forged = validV2Request();
  const attacker = generateAgentKeyPairs();
  const forgedProof = signEnrollmentProof(attacker.signingPrivateKey, { enrollmentToken: forged.request.enrollmentToken, signingPublicKey: forged.request.signingPublicKey, encryptionPublicKey: forged.request.encryptionPublicKey, issuedAt: forged.request.issuedAt, protocolVersion: forged.request.protocolVersion });
  assert.equal((verifyEnrollmentV2({ ...forged.request, proof: forgedProof }, NOW) as { reason: string }).reason, "forged");
  // forged via token substitution (breaks the binding)
  assert.equal((verifyEnrollmentV2({ ...forged.request, enrollmentToken: "different-token-value-at-least-32ch" }, NOW) as { reason: string }).reason, "forged");
});

test("describeAgentCredential is audit-safe and defaults a legacy server", () => {
  const legacy = describeAgentCredential({ agentSecretHash: "SECRET-NEVER-EXPOSED", credentialVersion: 1 } as never);
  assert.equal(legacy.keyProtocolVersion, "agent-v1");
  assert.equal(legacy.migrationState, "legacy");
  assert.equal(legacy.signingKeyFingerprint, null);
  assert.equal(legacy.revoked, false);
  // The audit view must never carry secret material or raw keys.
  const serialized = JSON.stringify(legacy);
  assert.equal(serialized.includes("SECRET-NEVER-EXPOSED"), false);
  assert.equal(Object.keys(legacy).some((k) => /secret|private|publicKey/i.test(k)), false);

  const keys = generateAgentKeyPairs();
  const v2 = describeAgentCredential({ keyProtocolVersion: "agent-v2", migrationState: "dual", signingKeyFingerprint: keyFingerprint(keys.signingPublicKey), encryptionKeyFingerprint: keyFingerprint(keys.encryptionPublicKey), credentialVersion: 2, revokedKeyFingerprints: ["deadbeef"] });
  assert.equal(v2.keyProtocolVersion, "agent-v2");
  assert.equal(v2.migrationState, "dual");
  assert.match(v2.signingKeyFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(v2.revokedKeyCount, 1);
});
