import crypto from "node:crypto";
import { agentSigningKey, secretHash as sharedSecretHash } from "@control-center/shared";

const sessionSecret = process.env.CONTROL_CENTER_SESSION_SECRET || "dev-session-secret-change-me";
const csrfSecret = process.env.CONTROL_CENTER_CSRF_SECRET || "dev-csrf-secret-change-me";
const KEY_VERSION = "v1";

function requireSecret(name: string, minLength = 32) {
  const value = process.env[name];
  if (!value || value.length < minLength || /change-me|default|example/i.test(value)) {
    throw new Error(`${name} must be explicitly set to a non-default value of at least ${minLength} characters in production`);
  }
}

function requireHttpsUrl(name: string) {
  const raw = process.env[name];
  if (!raw) throw new Error(`${name} is required in production`);
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new Error(`${name} must use https in production`);
  return url;
}

function requireNonProductionMongoUrl() {
  const raw = process.env.MONGO_URL;
  if (!raw) throw new Error("MONGO_URL is required in production");
  const url = new URL(raw);
  const host = url.hostname.toLowerCase();
  const dbName = url.pathname.replace(/^\//, "").toLowerCase();
  const blockedHosts = ["cluster0.uxetngu.mongodb.net", "craftersmarket.org", "craftersmarketbeta.shop"];
  const blockedDb = /(^|[-_])(prod|production|live)([-_]|$)|crafters_market_dev|craftersmarket$/;
  if (blockedHosts.some((blocked) => host.includes(blocked))) throw new Error("MONGO_URL points at a blocked production-like host");
  if (!dbName || blockedDb.test(dbName)) throw new Error("MONGO_URL must use a non-production control-center database name");
}

export function validateRuntimeSecrets() {
  if (process.env.NODE_ENV === "production") {
    requireSecret("CONTROL_CENTER_SESSION_SECRET");
    requireSecret("CONTROL_CENTER_CSRF_SECRET");
    encryptionKey();
    const publicUrl = requireHttpsUrl("CONTROL_CENTER_PUBLIC_URL");
    const webOrigin = requireHttpsUrl("CONTROL_CENTER_WEB_ORIGIN");
    if (publicUrl.origin !== webOrigin.origin) throw new Error("CONTROL_CENTER_PUBLIC_URL and CONTROL_CENTER_WEB_ORIGIN must share the same origin in production");
    if (process.env.CONTROL_CENTER_SECURE_COOKIES !== "true") throw new Error("CONTROL_CENTER_SECURE_COOKIES=true is required in production");
    if (!process.env.CONTROL_CENTER_TRUST_PROXY) throw new Error("CONTROL_CENTER_TRUST_PROXY is required in production");
    if (!process.env.CONTROL_CENTER_BOOTSTRAP_MODE || !["manual", "invitation", "replacement", "disabled"].includes(process.env.CONTROL_CENTER_BOOTSTRAP_MODE)) {
      throw new Error("CONTROL_CENTER_BOOTSTRAP_MODE must be manual, invitation, replacement, or disabled in production");
    }
    requireNonProductionMongoUrl();
  }
}

function encryptionKey() {
  const raw = process.env.CONTROL_CENTER_ENCRYPTION_KEY;
  if (!raw) {
    const env = process.env.NODE_ENV;
    // Fail closed for any explicitly-named deployed environment (production, staging, preview, ci, ...).
    // Only an unset NODE_ENV (local dev) or an explicit development/test build may fall back to a
    // source-derivable key, so a mislabelled staging host can never seal real secrets under a public key.
    if (env && env !== "development" && env !== "test") {
      throw new Error("CONTROL_CENTER_ENCRYPTION_KEY is required outside local development and test");
    }
    return crypto.createHash("sha256").update("dev-encryption-key-change-me").digest();
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("CONTROL_CENTER_ENCRYPTION_KEY must decode to exactly 32 bytes");
  return key;
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function hashSecret(secret: string) {
  return sharedSecretHash(secret, sessionSecret);
}

export function hashCsrfToken(secret: string) {
  return sharedSecretHash(secret, csrfSecret);
}

export function hashAgentSecret(agentSecret: string) {
  return agentSigningKey(agentSecret);
}

const PBKDF2_ITERATIONS = 600_000;
const LEGACY_PBKDF2_ITERATIONS = 120_000;

function pbkdf2Hex(password: string, salt: string, iterations: number) {
  return crypto.pbkdf2Sync(password, salt, iterations, 32, "sha256").toString("hex");
}

export function hashPassword(password: string, salt = crypto.randomBytes(16).toString("hex"), iterations = PBKDF2_ITERATIONS) {
  return `pbkdf2$${iterations}$${salt}$${pbkdf2Hex(password, salt, iterations)}`;
}

export function verifyPassword(password: string, stored: string) {
  const parts = stored.split("$");
  let iterations: number;
  let salt: string;
  let expected: string;
  if (parts[0] !== "pbkdf2") return false;
  if (parts.length === 4) { iterations = Number(parts[1]); salt = parts[2]; expected = parts[3]; }
  else if (parts.length === 3) { iterations = LEGACY_PBKDF2_ITERATIONS; salt = parts[1]; expected = parts[2]; }
  else return false;
  if (!Number.isInteger(iterations) || iterations < 1 || !salt || !expected) return false;
  const actual = Buffer.from(pbkdf2Hex(password, salt, iterations), "hex");
  const target = Buffer.from(expected, "hex");
  if (actual.length !== target.length) return false;
  return crypto.timingSafeEqual(actual, target);
}

export function encryptSecret(secret: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${KEY_VERSION}.${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptSecret(payload: string) {
  const [version, ivRaw, tagRaw, encryptedRaw] = payload.split(".");
  if (version !== KEY_VERSION) throw new Error("Unsupported ciphertext key version");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivRaw, "base64url"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedRaw, "base64url")), decipher.final()]).toString("utf8");
}
