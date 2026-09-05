import test from "node:test";
import assert from "node:assert/strict";
import { agentConfigSchema } from "../src/config.js";
import { generateAgentKeyPairs, signTaskEnvelopeV2, payloadDigest, signOwnerAuthorization, privilegedActionDigest } from "@control-center/shared";

// agent.ts is the agent entrypoint (guards main() on NODE_ENV==="test"). Set it before dynamically
// importing so importing verifyTask does not launch the agent poll loop.
process.env.NODE_ENV = "test";
const { verifyTask, validateForgeRuntimeIdentity } = await import("../src/agent.js");

// Staging key model: the agent receives ONLY public keys — the control-plane transport public key and
// the owner public key. The control-plane task-signing private key and the owner private key are never
// given to an agent. (Ed25519 keypairs here are disposable test keys.)
const cp = generateAgentKeyPairs();
const owner = generateAgentKeyPairs();
const config = agentConfigSchema.parse({ controlCenterUrl: "https://cc.test", agentId: "agent-1", agentSecret: "unused-legacy-secret", keyProtocolVersion: "agent-v2", controlPlanePublicKey: cp.signingPublicKey, ownerPublicKey: owner.signingPublicKey });

function privilegedTask(opts: { ownerAuth?: "valid" | "missing" | "forged" } = { ownerAuth: "valid" }) {
  const core = { projects: [], httpHealthChecks: [], mongoChecks: [], configurationDeployment: { planId: "plan-1" } };
  const nonce = "owner-nonce-1"; const keyVersion = "owner-v1"; const expiresAt = new Date(Date.now() + 3600_000).toISOString();
  const signer = opts.ownerAuth === "forged" ? generateAgentKeyPairs().signingPrivateKey : owner.signingPrivateKey;
  const signature = signOwnerAuthorization(signer, { taskType: "configuration.apply", orgId: "org-1", serverId: "server-1", actionDigest: privilegedActionDigest(core), expiresAt, nonce, keyVersion });
  const payload = opts.ownerAuth === "missing" ? core : { ...core, ownerAuthorization: { signature, issuedAt: new Date().toISOString(), expiresAt, nonce, keyVersion } };
  const unsigned = { protocolVersion: "task-v1" as const, taskId: "task-1", taskType: "configuration.apply" as const, orgId: "org-1", serverId: "server-1", agentId: "agent-1", issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3600_000).toISOString(), nonce: "envelope-nonce", payloadDigest: payloadDigest(payload), signingKeyVersion: "cp-ed25519-v1" };
  return { envelope: { ...unsigned, signature: signTaskEnvelopeV2(cp.signingPrivateKey, unsigned) }, payload };
}

test("agent requires an independent owner authorization to execute a privileged task", () => {
  verifyTask(config, privilegedTask({ ownerAuth: "valid" }) as never); // both layers valid → no throw
  assert.throws(() => verifyTask(config, privilegedTask({ ownerAuth: "missing" }) as never), /owner-authorization-missing/);
  assert.throws(() => verifyTask(config, privilegedTask({ ownerAuth: "forged" }) as never), /owner-authorization-invalid/);
});

test("agent config carries only PUBLIC control-plane and owner keys — never their private keys", () => {
  const keys = Object.keys(agentConfigSchema.shape);
  assert.ok(keys.includes("controlPlanePublicKey") && keys.includes("ownerPublicKey"));
  // No field exists for the control-plane task-signing private key or the owner private key.
  assert.equal(keys.some((k) => /taskSigningPrivate|ownerPrivate|controlPlanePrivate/i.test(k)), false);
  // The ONLY private keys an agent holds are its OWN credential keys.
  assert.deepEqual(keys.filter((k) => /privateKey/i.test(k)).sort(), ["encryptionPrivateKey", "signingPrivateKey"]);
});

test("agent startup binds the enrolled target to validated Forge security material", () => {
  const enrolled = agentConfigSchema.parse({ ...config, orgId: "org-1", serverId: "server-1" });
  const load = () => ({ identity: { orgId: "org-1", serverId: "server-1" }, trustedRoot: {}, reviewGateCaPath: "/fixed/ca.pem" }) as never;
  assert.doesNotThrow(() => validateForgeRuntimeIdentity(enrolled, load));
  assert.throws(() => validateForgeRuntimeIdentity(enrolled, () => ({ identity: { orgId: "other", serverId: "server-1" } }) as never), /does not match/);
});
