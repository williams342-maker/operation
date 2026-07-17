import crypto from "node:crypto";

export type SignatureParts = {
  method: string;
  path: string;
  timestamp: string;
  nonce: string;
  body: string;
};

export function sha256(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function secretHash(secret: string, salt = "") {
  return crypto.createHash("sha256").update(`${salt}:${secret}`).digest("hex");
}

export function agentSigningKey(agentSecret: string) {
  return crypto.createHash("sha256").update(`agent-v1:${agentSecret}`).digest("hex");
}

export function canonicalRequest(parts: SignatureParts) {
  return [
    parts.method.toUpperCase(),
    parts.path,
    parts.timestamp,
    parts.nonce,
    sha256(parts.body || "")
  ].join("\n");
}

export function signRequest(secret: string, parts: SignatureParts) {
  return crypto.createHmac("sha256", secret).update(canonicalRequest(parts)).digest("hex");
}

export function timingSafeEqualHex(a: string, b: string) {
  if (!/^[a-f0-9]+$/i.test(a) || !/^[a-f0-9]+$/i.test(b)) return false;
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export function verifyRequestSignature(secret: string, parts: SignatureParts, providedSignature: string) {
  const expected = signRequest(secret, parts);
  return timingSafeEqualHex(expected, providedSignature);
}

export function isFreshTimestamp(timestamp: string, now = Date.now(), maxSkewMs = 5 * 60 * 1000) {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return false;
  return Math.abs(now - parsed) <= maxSkewMs;
}

export class NonceStore {
  private seen = new Map<string, number>();

  constructor(private ttlMs = 5 * 60 * 1000) {}

  use(scope: string, nonce: string, now = Date.now()) {
    this.prune(now);
    const key = `${scope}:${nonce}`;
    if (this.seen.has(key)) return false;
    this.seen.set(key, now + this.ttlMs);
    return true;
  }

  private prune(now: number) {
    for (const [key, expiresAt] of this.seen.entries()) {
      if (expiresAt <= now) this.seen.delete(key);
    }
  }
}
