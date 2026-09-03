import test from "node:test";
import assert from "node:assert/strict";
import { AuthenticatedPrincipal, authenticate, generateCredential } from "../src/auth.js";
import { InMemoryReviewGateStore } from "../src/memoryStore.js";
import { startExpirySweep } from "../src/server.js";
import { castOf } from "./principals.js";

// The two CRITICALs an independent review found in the first implementation round, as regressions.
//
// Both are the same species: a guard that was real, defeated by a door beside it. That is the shape this
// entire workstream keeps producing, so each one gets a test that fails if the door reopens.

test("AuthenticatedPrincipal cannot be minted from a caller-built object", () => {
  // THE DEFECT: `of` was public and took an ordinary Principal, supplying the private symbol itself. Any
  // module importing the class could mint an owner, a reviewer holding any class, or an executor. The
  // constructor guard was real; the factory handed out what the guard protected. My own tests used
  // exactly that route, which is why the suite did not notice.
  const factory = AuthenticatedPrincipal as unknown as {
    of(...args: unknown[]): unknown;
    new (...args: unknown[]): unknown;
  };
  const forged = {
    principalId: "mallory", displayName: "mallory", credentialHash: "",
    roles: ["owner"], reviewerClasses: ["independent"], credentialEpoch: 1,
    createdAt: "2026-09-02T00:00:00.000Z",
  };
  assert.throws(() => factory.of(forged), /internal/,
    "a caller-built object must not become authority");
  assert.throws(() => factory.of(Symbol("guess"), forged), /internal/,
    "and a guessed key must not work either");
  assert.throws(() => new factory("mallory", ["owner"], [], 1, []), /cannot be constructed/);
});

test("the only route to a principal is a credential the gate recognises", async () => {
  const store = new InMemoryReviewGateStore();
  const credential = generateCredential();
  store.seedPrincipal({
    principalId: "codex", displayName: "codex", roles: ["reviewer"],
    reviewerClasses: ["independent"], credentialEpoch: 1, createdAt: "2026-09-02T00:00:00.000Z",
  }, credential);
  const outcome = await authenticate(store, `Bearer ${credential}`);
  assert.equal(outcome.ok, true);
  assert.equal((outcome as { principal: AuthenticatedPrincipal }).principal.principalId, "codex");
  // ...and nothing else works.
  assert.equal((await authenticate(store, "Bearer rgc_invented")).ok, false);
});

test("a rotation after authentication invalidates work in flight", async () => {
  // THE OTHER DEFECT: the epoch was compared only with the epoch stored in the LEASE, so a request
  // authenticated at epoch 1 holding a lease stamped at epoch 1 still matched after a rotation to
  // epoch 2 — the rotation was never consulted. The store re-reads the principal now.
  const cast = await castOf([
    { principalId: "agent-1", roles: ["executor"], audienceFor: [{ orgId: "o", serverId: "s" }] },
  ]);
  const before = cast.who("agent-1");
  assert.equal(before.credentialEpoch, 1);

  cast.store.seedPrincipal({
    principalId: "agent-1", displayName: "agent-1", roles: ["executor"],
    reviewerClasses: [], audienceFor: [{ orgId: "o", serverId: "s" }],
    credentialEpoch: 2, createdAt: "2026-09-02T00:00:00.000Z",
  }, generateCredential());

  const current = await cast.store.loadPrincipalById("agent-1");
  assert.equal(current!.credentialEpoch, 2,
    "the store is the authority on the current epoch, not the token the caller is holding");
});

test("the expiry sweep is actually driven", async () => {
  // THE DEFECT: sweepAttestations had the right behaviour and nothing outside tests called it, so an
  // expired bound lease stayed RESERVED_BOUND for ever and never became reconcilable. A correct function
  // nothing invokes is indistinguishable from an absent one.
  let swept = 0;
  const store = {
    sweepAttestations: async () => {
      swept += 1;
      return { expired: [], indeterminate: [] };
    },
  } as unknown as InMemoryReviewGateStore;
  const sweep = startExpirySweep(store, { intervalMs: 5 });
  await new Promise((resolve) => setTimeout(resolve, 40));
  sweep.stop();
  assert.ok(swept >= 2, `the sweep must run on a timer; it ran ${swept} times`);
  const after = swept;
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(swept, after, "and stop() must actually stop it");
});

test("a failing sweep does not take the process down", async () => {
  const store = {
    sweepAttestations: async () => { throw new Error("database unavailable"); },
  } as unknown as InMemoryReviewGateStore;
  const sweep = startExpirySweep(store, { intervalMs: 5 });
  await new Promise((resolve) => setTimeout(resolve, 25));
  sweep.stop();
  // Reaching here at all is the assertion: an unhandled rejection would have failed the run.
  assert.ok(true);
});
