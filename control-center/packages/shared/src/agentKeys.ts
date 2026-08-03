import crypto from "node:crypto";

// agent-v2 asymmetric credential primitives. Ed25519 for request/enrollment signing, X25519+HKDF+AES-GCM
// (ECIES sealed box) for deployment-secret delivery. Algorithms are pinned here and never negotiated by
// callers. See docs/agent-key-redesign.md. This module is inert until CONTROL_CENTER_AGENT_PROTOCOL_V2
// is enabled; it introduces no behaviour on its own.
export const agentKeyProtocolVersion = "agent-v2" as const;
const SEAL_ALGORITHM = "x25519-hkdf-sha256-aes256gcm" as const;
const HKDF_INFO = "opsworkbench-agent-deployment-seal-v2";

export type AgentKeyPairs = {
  signingPublicKey: string;
  signingPrivateKey: string;
  encryptionPublicKey: string;
  encryptionPrivateKey: string;
};

export type SealedBundle = { algorithm: typeof SEAL_ALGORITHM; ephemeralPublicKey: string; nonce: string; authTag: string; ciphertext: string };

const b64u = (buffer: Buffer) => buffer.toString("base64url");
const fromB64u = (value: string) => Buffer.from(value, "base64url");

function importPublic(keyB64: string, kind: "ed25519" | "x25519") {
  const key = crypto.createPublicKey({ key: fromB64u(keyB64), format: "der", type: "spki" });
  if (key.asymmetricKeyType !== kind) throw new Error("Unexpected public key type");
  return key;
}

function importPrivate(keyB64: string, kind: "ed25519" | "x25519") {
  const key = crypto.createPrivateKey({ key: fromB64u(keyB64), format: "der", type: "pkcs8" });
  if (key.asymmetricKeyType !== kind) throw new Error("Unexpected private key type");
  return key;
}

export function generateAgentKeyPairs(): AgentKeyPairs {
  const signing = crypto.generateKeyPairSync("ed25519");
  const encryption = crypto.generateKeyPairSync("x25519");
  return {
    signingPublicKey: b64u(signing.publicKey.export({ format: "der", type: "spki" }) as Buffer),
    signingPrivateKey: b64u(signing.privateKey.export({ format: "der", type: "pkcs8" }) as Buffer),
    encryptionPublicKey: b64u(encryption.publicKey.export({ format: "der", type: "spki" }) as Buffer),
    encryptionPrivateKey: b64u(encryption.privateKey.export({ format: "der", type: "pkcs8" }) as Buffer)
  };
}

export function signWithAgentKey(signingPrivateKeyB64: string, message: string): string {
  return b64u(crypto.sign(null, Buffer.from(message, "utf8"), importPrivate(signingPrivateKeyB64, "ed25519")));
}

export function verifyAgentSignature(signingPublicKeyB64: string, message: string, signatureB64: string): boolean {
  try {
    return crypto.verify(null, Buffer.from(message, "utf8"), importPublic(signingPublicKeyB64, "ed25519"), fromB64u(signatureB64));
  } catch {
    return false;
  }
}

// Proof-of-possession binding for enrollment: the agent proves it holds the signing private key that
// matches the public keys it is presenting, bound to the single-use enrollment token and a timestamp.
export function enrollmentProofMessage(parts: { enrollmentToken: string; signingPublicKey: string; encryptionPublicKey: string; issuedAt: string }): string {
  return ["agent-v2-enrollment", parts.enrollmentToken, parts.signingPublicKey, parts.encryptionPublicKey, parts.issuedAt].join("\n");
}

export function signEnrollmentProof(signingPrivateKeyB64: string, parts: Parameters<typeof enrollmentProofMessage>[0]): string {
  return signWithAgentKey(signingPrivateKeyB64, enrollmentProofMessage(parts));
}

export function verifyEnrollmentProof(signingPublicKeyB64: string, parts: Parameters<typeof enrollmentProofMessage>[0], signatureB64: string): boolean {
  return verifyAgentSignature(signingPublicKeyB64, enrollmentProofMessage(parts), signatureB64);
}

// Seal a deployment-secret bundle to an agent's X25519 public key (ECIES). Only the agent's private key
// can open it; the control plane stores only ciphertext + the public key.
export function sealToAgent(encryptionPublicKeyB64: string, plaintext: string): SealedBundle {
  const recipient = importPublic(encryptionPublicKeyB64, "x25519");
  const ephemeral = crypto.generateKeyPairSync("x25519");
  const shared = crypto.diffieHellman({ privateKey: ephemeral.privateKey, publicKey: recipient });
  const key = Buffer.from(crypto.hkdfSync("sha256", shared, Buffer.alloc(0), HKDF_INFO, 32));
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  key.fill(0);
  return {
    algorithm: SEAL_ALGORITHM,
    ephemeralPublicKey: b64u(ephemeral.publicKey.export({ format: "der", type: "spki" }) as Buffer),
    nonce: b64u(nonce),
    authTag: b64u(cipher.getAuthTag()),
    ciphertext: b64u(ciphertext)
  };
}

export function openSealed(encryptionPrivateKeyB64: string, bundle: SealedBundle): string {
  if (bundle.algorithm !== SEAL_ALGORITHM) throw new Error("Unsupported sealed-bundle algorithm");
  const shared = crypto.diffieHellman({ privateKey: importPrivate(encryptionPrivateKeyB64, "x25519"), publicKey: importPublic(bundle.ephemeralPublicKey, "x25519") });
  const key = Buffer.from(crypto.hkdfSync("sha256", shared, Buffer.alloc(0), HKDF_INFO, 32));
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, fromB64u(bundle.nonce));
  decipher.setAuthTag(fromB64u(bundle.authTag));
  try {
    return Buffer.concat([decipher.update(fromB64u(bundle.ciphertext)), decipher.final()]).toString("utf8");
  } finally {
    key.fill(0);
  }
}
