import test from "node:test";
import assert from "node:assert/strict";
import { agentProtocolVersions, agentProtocolVersionSchema, defaultAgentProtocolVersion, nextMigrationState, acceptedSchemes, describeAgentCredential, verifyEnrollmentV2, planKeyRotation, planKeyRevocation, isFingerprintRevoked, planMigrationComplete, planMigrationRollback, summarizeFleetMigration, buildMigrationReport, verifyRotationV2, evaluateFlagOffSafety, assertFlagOffRollbackSafe } from "../src/agentProtocol.js";
import { generateAgentKeyPairs, keyFingerprint, signEnrollmentProof, signRotationProof } from "../src/agentKeys.js";

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

test("planKeyRotation registers new keys, supersedes+revokes old fingerprints, and opens dual from legacy", () => {
  const now = new Date(NOW);
  const first = generateAgentKeyPairs();
  const legacy = { keyProtocolVersion: "agent-v2", migrationState: "legacy", credentialVersion: 3, signingKeyFingerprint: keyFingerprint(first.signingPublicKey), encryptionKeyFingerprint: keyFingerprint(first.encryptionPublicKey) };
  const next = generateAgentKeyPairs();
  const plan = planKeyRotation(legacy, { signingPublicKey: next.signingPublicKey, encryptionPublicKey: next.encryptionPublicKey, now });
  assert.equal(plan.migrationState, "dual");
  assert.equal(plan.credentialVersion, 4);
  assert.equal(plan.signingKeyFingerprint, keyFingerprint(next.signingPublicKey));
  assert.equal(plan.previousSigningKeyFingerprint, keyFingerprint(first.signingPublicKey));
  // Superseded keys are revoked so a rolled-over (stale) key cannot authenticate again.
  assert.ok(plan.revokedKeyFingerprints.includes(keyFingerprint(first.signingPublicKey)));
  assert.ok(plan.revokedKeyFingerprints.includes(keyFingerprint(first.encryptionPublicKey)));
  // Rotating an already-v2 agent keeps v2; key reuse rejected.
  assert.equal(planKeyRotation({ ...legacy, migrationState: "v2" }, { signingPublicKey: next.signingPublicKey, encryptionPublicKey: next.encryptionPublicKey, now }).migrationState, "v2");
  assert.throws(() => planKeyRotation(legacy, { signingPublicKey: next.signingPublicKey, encryptionPublicKey: next.signingPublicKey, now }));
});

test("revocation and stale-key detection fail closed", () => {
  const keys = generateAgentKeyPairs();
  const server = { migrationState: "v2", signingKeyFingerprint: keyFingerprint(keys.signingPublicKey), encryptionKeyFingerprint: keyFingerprint(keys.encryptionPublicKey) };
  const revocation = planKeyRevocation(server, new Date(NOW));
  assert.ok(revocation.revokedAt instanceof Date);
  assert.ok(revocation.revokedKeyFingerprints.includes(keyFingerprint(keys.signingPublicKey)));
  // A revoked record rejects any fingerprint; an explicit revoked fingerprint is rejected even without revokedAt.
  assert.equal(isFingerprintRevoked({ revokedAt: new Date(NOW) }, "anything"), true);
  assert.equal(isFingerprintRevoked({ revokedKeyFingerprints: ["stale-fp"] }, "stale-fp"), true);
  assert.equal(isFingerprintRevoked({ revokedKeyFingerprints: ["stale-fp"] }, "current-fp"), false);
});

test("migration complete/rollback and fleet summary", () => {
  assert.equal(planMigrationComplete({ migrationState: "dual" }).migrationState, "v2");
  assert.equal(planMigrationRollback({ migrationState: "v2" }).migrationState, "dual");
  const fleet = summarizeFleetMigration([{ migrationState: "legacy" }, { migrationState: "dual" }, { migrationState: "v2" }, { migrationState: "v2" }, {}]);
  assert.deepEqual(fleet, { total: 5, legacy: 2, dual: 1, v2: 2 });
});

test("buildMigrationReport is audit-safe (fingerprints only) and reports fleet + per-agent status", () => {
  const keys = generateAgentKeyPairs();
  const report = buildMigrationReport([
    { id: "s1", hostname: "legacy-host", agentSecretHash: "SECRET-HASH-NEVER-EXPOSED" } as never,
    { id: "s2", hostname: "v2-host", keyProtocolVersion: "agent-v2", migrationState: "v2", signingKeyFingerprint: keyFingerprint(keys.signingPublicKey), encryptionKeyFingerprint: keyFingerprint(keys.encryptionPublicKey), signingPublicKey: keys.signingPublicKey } as never
  ]);
  assert.deepEqual(report.fleet, { total: 2, legacy: 1, dual: 0, v2: 1 });
  assert.equal(report.agents[0].keyProtocolVersion, "agent-v1");
  assert.equal(report.agents[1].migrationState, "v2");
  // No secret hash and no raw public key may appear anywhere in the serialized report.
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes("SECRET-HASH-NEVER-EXPOSED"), false);
  assert.equal(serialized.includes(keys.signingPublicKey), false);
  assert.equal(serialized.includes(keys.signingPrivateKey), false);
});

test("verifyRotationV2 requires a valid PoP by the NEW key bound to the agent id", () => {
  const now = NOW;
  const keys = generateAgentKeyPairs();
  const base = { agentId: "agent-xyz", signingPublicKey: keys.signingPublicKey, encryptionPublicKey: keys.encryptionPublicKey, issuedAt: new Date(now).toISOString(), protocolVersion: "agent-v2" };
  const proof = signRotationProof(keys.signingPrivateKey, base);
  assert.deepEqual(verifyRotationV2({ ...base, proof }, now), { valid: true });
  // Proof by a different (attacker) key fails.
  const attacker = generateAgentKeyPairs();
  assert.equal((verifyRotationV2({ ...base, proof: signRotationProof(attacker.signingPrivateKey, base) }, now) as { reason: string }).reason, "forged");
  // Binding to agentId: reusing a proof for another agent fails.
  assert.equal((verifyRotationV2({ ...base, agentId: "other-agent", proof }, now) as { reason: string }).reason, "forged");
  // Downgrade / key-reuse / expiry fail closed.
  assert.equal((verifyRotationV2({ ...base, proof, protocolVersion: "agent-v1" }, now) as { reason: string }).reason, "downgrade");
  assert.equal((verifyRotationV2({ ...base, encryptionPublicKey: keys.signingPublicKey, proof }, now) as { reason: string }).reason, "key-reuse");
  assert.equal((verifyRotationV2({ ...base, proof, issuedAt: new Date(now - 30 * 60 * 1000).toISOString() }, now) as { reason: string }).reason, "expired");
});

test("evaluateFlagOffSafety refuses a v1-only state that would strand v2-only agents", () => {
  // All agents retain a usable v1 credential (legacy, or migrated-with-fallback) → safe to disable v2.
  assert.equal(evaluateFlagOffSafety([
    { id: "a", hostname: "legacy", migrationState: "legacy", legacyCredentialUsable: true },
    { id: "b", hostname: "dual-with-v1", migrationState: "dual", legacyCredentialUsable: true }
  ]).safe, true);
  // A fresh-v2 agent (no usable v1) → unsafe; a dual agent whose v1 was invalidated → unsafe.
  const unsafe = evaluateFlagOffSafety([
    { id: "c", hostname: "fresh-v2", keyProtocolVersion: "agent-v2", migrationState: "v2", legacyCredentialUsable: false },
    { id: "d", hostname: "dual-no-v1", migrationState: "dual", legacyCredentialUsable: false },
    { id: "e", hostname: "revoked-v2", migrationState: "v2", legacyCredentialUsable: false, revokedAt: new Date(0) }
  ]);
  assert.equal(unsafe.safe, false);
  assert.equal(unsafe.strandedAgents.length, 2); // the revoked one is not counted (inactive)
  assert.ok(assertRollbackThrows(() => assertFlagOffRollbackSafe([{ id: "c", hostname: "fresh-v2", keyProtocolVersion: "agent-v2", migrationState: "v2", legacyCredentialUsable: false }])));
  // A pure fresh-v2-free fleet with all v1 fallbacks does not throw.
  assertFlagOffRollbackSafe([{ id: "a", hostname: "legacy", migrationState: "legacy", legacyCredentialUsable: true }]);
});

function assertRollbackThrows(fn: () => void): boolean {
  try { fn(); return false; } catch { return true; }
}
