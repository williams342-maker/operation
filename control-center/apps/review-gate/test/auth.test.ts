import test from "node:test";
import assert from "node:assert/strict";
import {
  AuthenticatedPrincipal,
  authenticate,
  credentialIndex,
  generateCredential,
  hashCredential,
  verifyCredential,
} from "../src/auth.js";
import type { Principal } from "../src/store.js";

function principal(over: Partial<Principal> = {}): Principal {
  return {
    principalId: "codex",
    displayName: "Codex",
    credentialHash: "",
    reviewerClasses: ["independent"],
    roles: ["reviewer"],
    credentialEpoch: 1,
    createdAt: "2026-09-02T00:00:00.000Z",
    ...over,
  };
}

/**
 * A store that resolves exactly one credential.
 *
 * The gate looks a principal up by an unsalted INDEX over the credential, then authenticates against
 * the salted hash. Both steps matter, so the stub reproduces both rather than short-circuiting one.
 */
function storeFor(credential: string, over: Partial<Principal> = {}) {
  const stored = hashCredential(credential);
  return {
    loadPrincipalByCredentialHash: async (hash: string) =>
      hash === credentialIndex(credential)
        ? { ...principal(over), credentialHash: over.credentialHash ?? stored }
        : null,
  } as never;
}

// ── the credential itself ────────────────────────────────────────────────────────────────────────────

test("a stored credential does not contain the credential", () => {
  const credential = generateCredential();
  const stored = hashCredential(credential);
  assert.equal(stored.includes(credential), false, "the hash must not embed the secret");
  assert.ok(stored.startsWith("scrypt$"), "the KDF and its parameters are recorded with the hash");
  assert.ok(verifyCredential(credential, stored));
  assert.equal(verifyCredential(credential + "x", stored), false);
});

test("two hashes of the same credential differ, and both verify", () => {
  // Salted, so a stolen database does not reveal that two principals share a credential.
  const credential = generateCredential();
  const a = hashCredential(credential);
  const b = hashCredential(credential);
  assert.notEqual(a, b);
  assert.ok(verifyCredential(credential, a) && verifyCredential(credential, b));
});

test("a malformed stored hash is refused rather than throwing", () => {
  for (const stored of ["", "nonsense", "scrypt$1$2$3", "argon2$x$y$z$w$v", "scrypt$a$b$c$d$e"]) {
    assert.equal(verifyCredential("anything", stored), false, `${stored} must not authenticate`);
  }
});

test("generated credentials are high entropy and distinguishable", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 64; i++) seen.add(generateCredential());
  assert.equal(seen.size, 64);
  assert.ok(generateCredential().length > 40);
});

// ── authentication ───────────────────────────────────────────────────────────────────────────────────

test("a valid credential resolves to the principal the GATE holds", async () => {
  // The whole point: what this caller may do is a fact in the gate's database, not a field in a request.
  const credential = generateCredential();
  const outcome = await authenticate(storeFor(credential), `Bearer ${credential}`);
  assert.equal(outcome.ok, true);
  const who = (outcome as { principal: AuthenticatedPrincipal }).principal;
  assert.equal(who.principalId, "codex");
  assert.ok(who.holdsReviewerClass("independent"));
  assert.equal(who.holdsReviewerClass("owner-appointed"), false);
  assert.ok(who.hasRole("reviewer"));
  assert.equal(who.hasRole("owner"), false);
});

test("a caller cannot name itself, a reviewer, or a reviewer class", async () => {
  // Rounds 1 and 5 in one test. The request carries a credential and nothing else about identity; there
  // is no parameter on this surface that a request body could become.
  const credential = generateCredential();
  const outcome = await authenticate(storeFor(credential), `Bearer ${credential}`);
  assert.equal(outcome.ok, true);
  const who = (outcome as { principal: AuthenticatedPrincipal }).principal;
  // No setter exists for any of it.
  const mutable = who as unknown as Record<string, unknown>;
  for (const field of ["principalId", "roles", "reviewerClasses", "credentialEpoch"]) {
    const descriptor = Object.getOwnPropertyDescriptor(who, field);
    assert.equal(descriptor?.writable !== true || Object.isFrozen(mutable[field] as object), true,
      `${field} must not be caller-assignable`);
  }
  assert.ok(Object.isFrozen(who.roles) && Object.isFrozen(who.reviewerClasses));
});

test("AuthenticatedPrincipal cannot be constructed by a route", () => {
  // Not a TypeScript-only guarantee this time: the class is not exported anywhere a route reaches as a
  // constructible value, and `of` takes a Principal that only the store can produce.
  const Ctor = AuthenticatedPrincipal as unknown as { new (...args: unknown[]): unknown };
  assert.throws(() => new Ctor("mallory", ["owner"], ["independent"], 1, []),
    /cannot be constructed/, "a route must not be able to mint an owner");
  assert.throws(() => new Ctor(Symbol("guess"), "mallory", ["owner"], [], 1, []),
    /cannot be constructed/, "and a guessed symbol must not work either");
});

test("an unknown credential and a wrong credential are indistinguishable to the caller", async () => {
  const credential = generateCredential();
  // A principal exists at this index, but the stored hash is of a DIFFERENT credential.
  const store = storeFor(credential, { credentialHash: hashCredential("other") });
  const wrong = await authenticate(store, `Bearer ${credential}`);
  const unknown = await authenticate(store, "Bearer rgc_nothing");
  assert.equal(wrong.ok, false);
  assert.equal(unknown.ok, false);
  assert.equal((wrong as { code: string }).code, (unknown as { code: string }).code,
    "the distinction belongs in the gate's logs, not in a response");
});

test("a disabled principal does not authenticate", async () => {
  const credential = generateCredential();
  const store = storeFor(credential, { disabledAt: "2026-09-02T00:00:00.000Z" });
  const outcome = await authenticate(store, `Bearer ${credential}`);
  assert.equal(outcome.ok, false);
  assert.equal((outcome as { code: string }).code, "principal_disabled");
});

test("a missing or malformed authorization header is refused", async () => {
  const store = { loadPrincipalByCredentialHash: async () => null } as never;
  for (const header of [undefined, "", "Bearer", "Basic abc", "rgc_bare", "Bearer a b"]) {
    const outcome = await authenticate(store, header);
    assert.equal(outcome.ok, false, `${JSON.stringify(header)} must not authenticate`);
  }
});

test("an executor may only act on targets it was provisioned for", async () => {
  const credential = generateCredential();
  const store = storeFor(credential, {
    principalId: "agent-1", roles: ["executor"], reviewerClasses: [],
    targetScopes: [{ orgId: "org-1", serverId: "server-1" }],
  });
  const outcome = await authenticate(store, `Bearer ${credential}`);
  const who = (outcome as { principal: AuthenticatedPrincipal }).principal;
  assert.ok(who.mayActOn("org-1", "server-1"));
  assert.equal(who.mayActOn("org-1", "server-2"), false, "a different host is a different target");
  assert.equal(who.mayActOn("org-2", "server-1"), false, "a different org is a different target");
});
