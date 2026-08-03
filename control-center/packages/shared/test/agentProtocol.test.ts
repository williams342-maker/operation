import test from "node:test";
import assert from "node:assert/strict";
import { agentProtocolVersions, agentProtocolVersionSchema, defaultAgentProtocolVersion, nextMigrationState, acceptedSchemes, describeAgentCredential } from "../src/agentProtocol.js";
import { generateAgentKeyPairs, keyFingerprint } from "../src/agentKeys.js";

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
