import { test } from "node:test";
import assert from "node:assert/strict";
import { createSign, generateKeyPairSync, type JsonWebKey } from "node:crypto";
import { verifyGoogleIdToken, __resetJwksCacheForTests, type JwksFetcher } from "../src/googleAuth.js";

const CLIENT_ID = "test-client.apps.googleusercontent.com";
const KID = "test-kid-1";
const NOW = Date.UTC(2026, 7, 7, 12, 0, 0); // fixed clock (ms)

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pubJwk = publicKey.export({ format: "jwk" }) as JsonWebKey;

const fetchJwks: JwksFetcher = async () => ({
  keys: [{ kid: KID, kty: "RSA", n: pubJwk.n as string, e: pubJwk.e as string, alg: "RS256" }]
});

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

function signToken(payloadOverrides: Record<string, unknown> = {}, header: Record<string, unknown> = {}): string {
  const h = b64url({ alg: "RS256", kid: KID, typ: "JWT", ...header });
  const payload = {
    iss: "https://accounts.google.com",
    aud: CLIENT_ID,
    sub: "1234567890",
    email: "owner@example.com",
    email_verified: true,
    name: "Owner",
    nonce: "nonce-abc",
    iat: Math.floor(NOW / 1000),
    exp: Math.floor(NOW / 1000) + 3600,
    ...payloadOverrides
  };
  const p = b64url(payload);
  const signer = createSign("RSA-SHA256");
  signer.update(`${h}.${p}`);
  signer.end();
  const sig = signer.sign(privateKey).toString("base64url");
  return `${h}.${p}.${sig}`;
}

const opts = { clientId: CLIENT_ID, nonce: "nonce-abc", now: NOW, fetchJwks };

test("valid token → verified identity", async () => {
  __resetJwksCacheForTests();
  const id = await verifyGoogleIdToken(signToken(), opts);
  assert.equal(id.email, "owner@example.com");
  assert.equal(id.emailVerified, true);
  assert.equal(id.sub, "1234567890");
});

test("email is lowercased", async () => {
  __resetJwksCacheForTests();
  const id = await verifyGoogleIdToken(signToken({ email: "Owner@Example.com" }), opts);
  assert.equal(id.email, "owner@example.com");
});

test("rejects audience mismatch", async () => {
  __resetJwksCacheForTests();
  await assert.rejects(() => verifyGoogleIdToken(signToken({ aud: "someone-else" }), opts), /Audience mismatch/);
});

test("rejects expired token", async () => {
  __resetJwksCacheForTests();
  const expired = signToken({ exp: Math.floor(NOW / 1000) - 3600 });
  await assert.rejects(() => verifyGoogleIdToken(expired, opts), /expired/);
});

test("rejects nonce mismatch (replay protection)", async () => {
  __resetJwksCacheForTests();
  await assert.rejects(() => verifyGoogleIdToken(signToken(), { ...opts, nonce: "different" }), /Nonce mismatch/);
});

test("rejects unverified email", async () => {
  __resetJwksCacheForTests();
  await assert.rejects(() => verifyGoogleIdToken(signToken({ email_verified: false }), opts), /not verified/);
});

test("rejects wrong issuer", async () => {
  __resetJwksCacheForTests();
  await assert.rejects(() => verifyGoogleIdToken(signToken({ iss: "https://evil.example" }), opts), /issuer/);
});

test("rejects tampered payload (signature invalid)", async () => {
  __resetJwksCacheForTests();
  const [h, p, s] = signToken().split(".");
  const tampered = { email: "attacker@example.com", email_verified: true, aud: CLIENT_ID, iss: "https://accounts.google.com", exp: Math.floor(NOW / 1000) + 3600, nonce: "nonce-abc", sub: "x" };
  const forged = `${h}.${Buffer.from(JSON.stringify(tampered)).toString("base64url")}.${s}`;
  await assert.rejects(() => verifyGoogleIdToken(forged, opts), /Invalid signature/);
});

test("rejects non-RS256 alg", async () => {
  __resetJwksCacheForTests();
  const token = signToken({}, { alg: "HS256" });
  await assert.rejects(() => verifyGoogleIdToken(token, opts), /algorithm/);
});

test("rejects unknown signing key", async () => {
  __resetJwksCacheForTests();
  const token = signToken({}, { kid: "unknown-kid" });
  await assert.rejects(() => verifyGoogleIdToken(token, opts), /key not found/);
});
