import assert from "node:assert/strict";
import { authenticate, generateCredential, type AuthenticatedPrincipal } from "../src/auth.js";
import { InMemoryReviewGateStore } from "../src/memoryStore.js";
import type { Principal } from "../src/store.js";

// How a TEST obtains a principal: by authenticating, exactly like anything else.
//
// An independent review found that `AuthenticatedPrincipal.of` was public and took a caller-built
// object, so any module could mint an owner — and that the tests used precisely that route, which is why
// the suite never noticed. The factory now demands a module-private key. This helper is the replacement:
// it provisions a principal with a real credential and authenticates it.

export type Person = {
  principalId: string;
  roles?: string[];
  reviewerClasses?: string[];
  audienceFor?: Array<{ orgId: string; serverId: string }>;
  credentialEpoch?: number;
  disabledAt?: string;
};

export type Cast = {
  store: InMemoryReviewGateStore;
  who: (principalId: string) => AuthenticatedPrincipal;
  credentialFor: (principalId: string) => string;
};

/** Provision a cast into a store and resolve each of them through `authenticate`. */
export async function castOf(people: Person[], store = new InMemoryReviewGateStore()): Promise<Cast> {
  const credentials = new Map<string, string>();
  const resolved = new Map<string, AuthenticatedPrincipal>();
  for (const person of people) {
    const credential = generateCredential();
    credentials.set(person.principalId, credential);
    const principal: Omit<Principal, "credentialHash"> = {
      principalId: person.principalId,
      displayName: person.principalId,
      roles: person.roles ?? [],
      reviewerClasses: person.reviewerClasses ?? [],
      ...(person.audienceFor ? { audienceFor: person.audienceFor } : {}),
      credentialEpoch: person.credentialEpoch ?? 1,
      createdAt: "2026-09-02T00:00:00.000Z",
      ...(person.disabledAt ? { disabledAt: person.disabledAt } : {}),
    };
    store.seedPrincipal(principal, credential);
    const outcome = await authenticate(store, `Bearer ${credential}`);
    assert.equal(outcome.ok, true, `could not authenticate ${person.principalId}`);
    resolved.set(person.principalId, (outcome as { principal: AuthenticatedPrincipal }).principal);
  }
  return {
    store,
    who: (principalId) => {
      const principal = resolved.get(principalId);
      if (!principal) throw new Error(`no such test principal: ${principalId}`);
      return principal;
    },
    credentialFor: (principalId) => {
      const credential = credentials.get(principalId);
      if (!credential) throw new Error(`no such test principal: ${principalId}`);
      return credential;
    },
  };
}
