import { createPublicKey, createVerify } from "node:crypto";
import { request } from "undici";

/**
 * Google Identity Services ID-token verification — dependency-free.
 *
 * Uses `undici` (already a dependency) to fetch Google's JWKS and Node's crypto
 * to verify the RS256 signature, then validates issuer / audience / expiry /
 * nonce / email_verified. No client secret is involved (the browser uses only
 * the public client_id), and nothing here trusts a claim without a verified
 * signature. Fail-closed: any check that cannot pass throws.
 */
const GOOGLE_JWKS_URI = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);
const JWKS_TTL_MS = 60 * 60 * 1000;
const CLOCK_SKEW_SEC = 60;

type Jwk = { kid: string; n: string; e: string; kty: string; alg?: string };
export type JwksFetcher = () => Promise<{ keys: Jwk[] }>;

let jwksCache: { keys: Jwk[]; fetchedAt: number } | null = null;

async function defaultFetchJwks(): Promise<{ keys: Jwk[] }> {
  const res = await request(GOOGLE_JWKS_URI, { method: "GET" });
  if (res.statusCode !== 200) throw new Error(`JWKS fetch failed (${res.statusCode})`);
  return (await res.body.json()) as { keys: Jwk[] };
}

async function resolveKey(kid: string, fetchJwks: JwksFetcher): Promise<Jwk> {
  const fresh = jwksCache && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS;
  if (!fresh) {
    const j = await fetchJwks();
    jwksCache = { keys: j.keys || [], fetchedAt: Date.now() };
  }
  let key = jwksCache!.keys.find((k) => k.kid === kid);
  if (!key) {
    // Key rotation: refetch once on a cache miss before giving up.
    const j = await fetchJwks();
    jwksCache = { keys: j.keys || [], fetchedAt: Date.now() };
    key = jwksCache.keys.find((k) => k.kid === kid);
  }
  if (!key) throw new Error("Signing key not found");
  return key;
}

function b64url(part: string): Buffer {
  return Buffer.from(part, "base64url");
}

export type GoogleIdentity = {
  email: string;
  emailVerified: true;
  sub: string;
  name?: string;
};

export type VerifyOptions = {
  clientId: string;
  nonce?: string | null;
  now?: number; // ms epoch, for tests
  fetchJwks?: JwksFetcher;
};

export async function verifyGoogleIdToken(
  idToken: string,
  opts: VerifyOptions
): Promise<GoogleIdentity> {
  if (!opts.clientId) throw new Error("Google client id not configured");
  const fetchJwks = opts.fetchJwks || defaultFetchJwks;
  const nowSec = (opts.now ?? Date.now()) / 1000;

  const parts = (idToken || "").split(".");
  if (parts.length !== 3) throw new Error("Malformed token");
  const [h64, p64, s64] = parts;

  const header = JSON.parse(b64url(h64).toString("utf8"));
  if (header.alg !== "RS256") throw new Error("Unexpected token algorithm");
  if (!header.kid) throw new Error("Missing key id");

  const jwk = await resolveKey(header.kid, fetchJwks);
  const pub = createPublicKey({ key: { kty: "RSA", n: jwk.n, e: jwk.e }, format: "jwk" });
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${h64}.${p64}`);
  verifier.end();
  if (!verifier.verify(pub, b64url(s64))) throw new Error("Invalid signature");

  const payload = JSON.parse(b64url(p64).toString("utf8"));
  if (!GOOGLE_ISSUERS.has(payload.iss)) throw new Error("Invalid issuer");
  if (payload.aud !== opts.clientId) throw new Error("Audience mismatch");
  if (typeof payload.exp !== "number" || payload.exp + CLOCK_SKEW_SEC < nowSec) {
    throw new Error("Token expired");
  }
  if (typeof payload.iat === "number" && payload.iat - CLOCK_SKEW_SEC > nowSec) {
    throw new Error("Token issued in the future");
  }
  if (opts.nonce != null) {
    if (!payload.nonce || payload.nonce !== opts.nonce) throw new Error("Nonce mismatch");
  }
  const emailVerified = payload.email_verified === true || payload.email_verified === "true";
  if (!emailVerified) throw new Error("Email not verified by Google");
  if (!payload.email || typeof payload.email !== "string") throw new Error("No email in token");

  return {
    email: payload.email.toLowerCase(),
    emailVerified: true,
    sub: String(payload.sub),
    name: typeof payload.name === "string" ? payload.name : undefined
  };
}

/** Config validation helper (non-throwing): reports whether Google sign-in is
 *  enabled and whether the configured client id looks well-formed. */
export function googleAuthConfig() {
  const clientId = (process.env.GOOGLE_OAUTH_CLIENT_ID || "").trim();
  const enabled = clientId.length > 0;
  const wellFormed = !enabled || clientId.endsWith(".apps.googleusercontent.com");
  return { enabled, clientId, wellFormed };
}

/** Reset the in-process JWKS cache (tests only). */
export function __resetJwksCacheForTests() {
  jwksCache = null;
}
