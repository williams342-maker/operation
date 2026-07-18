import crypto from "node:crypto";

export type EnvelopeCiphertext = { algorithm: "aes-256-gcm"; keyVersion: string; ciphertext: string; nonce: string; authTag: string; wrappedKey: string; wrapNonce: string; wrapAuthTag: string };

function masterKey() {
  const raw = process.env.CONTROL_CENTER_ENCRYPTION_KEY;
  if (!raw) {
    if (process.env.NODE_ENV === "production") throw new Error("CONTROL_CENTER_ENCRYPTION_KEY is required");
    return crypto.createHash("sha256").update("configuration-vault-development-key").digest();
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("CONTROL_CENTER_ENCRYPTION_KEY must decode to 32 bytes");
  return key;
}

function seal(key: Buffer, value: Buffer, aad: string) {
  const nonce = crypto.randomBytes(12); const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce); cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(value), cipher.final()]); return { ciphertext, nonce, authTag: cipher.getAuthTag() };
}

function open(key: Buffer, ciphertext: Buffer, nonce: Buffer, authTag: Buffer, aad: string) {
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce); decipher.setAAD(Buffer.from(aad)); decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function encryptConfigurationValue(value: string, binding: string): EnvelopeCiphertext {
  const dataKey = crypto.randomBytes(32); const data = seal(dataKey, Buffer.from(value, "utf8"), `value:${binding}`); const wrapped = seal(masterKey(), dataKey, `dek:${binding}`); dataKey.fill(0);
  return { algorithm: "aes-256-gcm", keyVersion: process.env.CONTROL_CENTER_ENCRYPTION_KEY_VERSION || "v1", ciphertext: data.ciphertext.toString("base64url"), nonce: data.nonce.toString("base64url"), authTag: data.authTag.toString("base64url"), wrappedKey: wrapped.ciphertext.toString("base64url"), wrapNonce: wrapped.nonce.toString("base64url"), wrapAuthTag: wrapped.authTag.toString("base64url") };
}

export function decryptConfigurationValue(payload: EnvelopeCiphertext, binding: string) {
  if (payload.algorithm !== "aes-256-gcm") throw new Error("Unsupported envelope algorithm");
  const dataKey = open(masterKey(), Buffer.from(payload.wrappedKey, "base64url"), Buffer.from(payload.wrapNonce, "base64url"), Buffer.from(payload.wrapAuthTag, "base64url"), `dek:${binding}`);
  try { return open(dataKey, Buffer.from(payload.ciphertext, "base64url"), Buffer.from(payload.nonce, "base64url"), Buffer.from(payload.authTag, "base64url"), `value:${binding}`).toString("utf8"); } finally { dataKey.fill(0); }
}

export function valueFingerprint(value: string, serverBinding: string) {
  return crypto.createHmac("sha256", masterKey()).update(`${serverBinding}\0${value}`).digest("base64url");
}
