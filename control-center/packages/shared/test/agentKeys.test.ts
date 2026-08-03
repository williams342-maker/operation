import test from "node:test";
import assert from "node:assert/strict";
import { generateAgentKeyPairs, signWithAgentKey, verifyAgentSignature, signEnrollmentProof, verifyEnrollmentProof, sealToAgent, openSealed, agentKeyProtocolVersion } from "../src/agentKeys.js";

test("generateAgentKeyPairs yields distinct ed25519 signing and x25519 encryption keys", () => {
  const keys = generateAgentKeyPairs();
  assert.equal(agentKeyProtocolVersion, "agent-v2");
  for (const value of [keys.signingPublicKey, keys.signingPrivateKey, keys.encryptionPublicKey, keys.encryptionPrivateKey]) {
    assert.ok(value.length > 0);
  }
  // Signing and encryption key material must not be reused across purposes.
  assert.notEqual(keys.signingPublicKey, keys.encryptionPublicKey);
  assert.notEqual(keys.signingPrivateKey, keys.encryptionPrivateKey);
});

test("agent signatures verify and reject tampering or the wrong key", () => {
  const a = generateAgentKeyPairs();
  const b = generateAgentKeyPairs();
  const message = "POST\n/api/agent/poll\n2026-08-02T00:00:00.000Z\nnonce\ndigest";
  const signature = signWithAgentKey(a.signingPrivateKey, message);
  assert.equal(verifyAgentSignature(a.signingPublicKey, message, signature), true);
  assert.equal(verifyAgentSignature(a.signingPublicKey, message + "x", signature), false);
  assert.equal(verifyAgentSignature(b.signingPublicKey, message, signature), false);
  assert.equal(verifyAgentSignature(a.signingPublicKey, message, "not-a-signature"), false);
});

test("enrollment proof-of-possession accepts a valid proof and rejects a forged one", () => {
  const agent = generateAgentKeyPairs();
  const attacker = generateAgentKeyPairs();
  const parts = { enrollmentToken: "owenr_token", signingPublicKey: agent.signingPublicKey, encryptionPublicKey: agent.encryptionPublicKey, issuedAt: "2026-08-02T00:00:00.000Z" };
  const proof = signEnrollmentProof(agent.signingPrivateKey, parts);
  assert.equal(verifyEnrollmentProof(agent.signingPublicKey, parts, proof), true);
  // An attacker presenting the agent's public key but signing with their own key fails PoP.
  const forged = signEnrollmentProof(attacker.signingPrivateKey, parts);
  assert.equal(verifyEnrollmentProof(agent.signingPublicKey, parts, forged), false);
  // Binding: changing any bound field invalidates the proof.
  assert.equal(verifyEnrollmentProof(agent.signingPublicKey, { ...parts, enrollmentToken: "other" }, proof), false);
});

test("sealed deployment bundle round-trips and only the intended agent can open it", () => {
  const agent = generateAgentKeyPairs();
  const other = generateAgentKeyPairs();
  const secret = JSON.stringify({ "v:1": "s3cr3t-value" });
  const bundle = sealToAgent(agent.encryptionPublicKey, secret);
  assert.equal(bundle.algorithm, "x25519-hkdf-sha256-aes256gcm");
  assert.equal(openSealed(agent.encryptionPrivateKey, bundle), secret);
  assert.throws(() => openSealed(other.encryptionPrivateKey, bundle));
});

test("openSealed rejects a tampered ciphertext and an unsupported algorithm", () => {
  const agent = generateAgentKeyPairs();
  const bundle = sealToAgent(agent.encryptionPublicKey, "payload");
  assert.throws(() => openSealed(agent.encryptionPrivateKey, { ...bundle, ciphertext: Buffer.from("tampered").toString("base64url") }));
  assert.throws(() => openSealed(agent.encryptionPrivateKey, { ...bundle, algorithm: "aes-256-cbc" as never }), /Unsupported/);
});
