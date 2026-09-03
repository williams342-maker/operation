import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryReviewGateStore } from "../src/memoryStore.js";
import { runStoreConformance } from "./storeConformance.js";

// The in-memory reference against the shared contract. The same suite runs against Mongo in
// mongoStore.test.ts, so the two implementations cannot quietly diverge on what they enforce.
runStoreConformance("in-memory", async () => {
  const store = new InMemoryReviewGateStore();
  return {
    store,
    // Seeded under a throwaway credential. These cases authenticate nothing; they need the principal
    // RECORD, because credential-sensitive store methods re-read it inside their transaction.
    seedPrincipal: async (principal) => {
      const { credentialHash: _ignored, ...rest } = principal;
      store.seedPrincipal(rest, "credential-for-" + principal.principalId);
    },
    dispose: async () => {},
  };
});

test("in-memory: there is no method meaning 'put this candidate in that state'", () => {
  // The structural point of the port, asserted by NAME. A general-purpose compareAndSetState that writes
  // whatever nextState it is handed is a policy-free lifecycle mutation, and adding a convenient setter
  // later is exactly how this went wrong three times.
  const surface = Object.getOwnPropertyNames(InMemoryReviewGateStore.prototype);
  for (const forbidden of ["compareAndSetState", "setState", "create", "update", "write"]) {
    assert.equal(surface.includes(forbidden), false,
      `${forbidden} is a policy-free primitive; the port must not offer one`);
  }
  assert.ok(surface.includes("applyVerdict") && surface.includes("acquireAttestation"),
    "the port should be named for operations");
});
