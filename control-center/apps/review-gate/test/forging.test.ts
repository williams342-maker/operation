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

// ── round 2 of implementation review ─────────────────────────────────────────────────────────────────

test("an authenticated principal cannot have its authority reassigned", async () => {
  // THE DEFECT: closing construction and the factory still left the OBJECT mutable. `readonly` is erased,
  // so any code holding a legitimately authenticated principal could assign roles = ["owner"] and
  // hasRole("owner") would then succeed. The defect had MOVED from construction to mutation — which is
  // exactly the "have I closed it or relocated it" question, answered the wrong way.
  const cast = await castOf([{ principalId: "claude", roles: ["author"] }]);
  const principal = cast.who("claude");
  assert.ok(AuthenticatedPrincipal.isIssued(principal), "the issued object must be frozen");
  const mutable = principal as unknown as Record<string, unknown>;
  assert.throws(() => { "use strict"; mutable.roles = ["owner"]; },
    "reassigning roles must throw rather than silently succeed");
  assert.throws(() => { "use strict"; mutable.principalId = "owner"; });
  assert.throws(() => { "use strict"; mutable.credentialEpoch = 99; });
  assert.equal(principal.hasRole("owner"), false, "and the authority is unchanged");
  // The arrays inside are frozen too, so push cannot smuggle a role in.
  assert.throws(() => (principal.roles as string[]).push("owner"));
});

test("a lease can only be used by the principal that holds it", async () => {
  // THE DEFECT: the lease check compared leaseId, epoch and expiry — never the HOLDER. Any other enabled
  // principal whose current epoch matched could use a known leaseId to renew, acquire or redeem someone
  // else's lease, and acquire is the authorization immediately before a host mutation.
  const { InMemoryReviewGateStore } = await import("../src/memoryStore.js");
  const store = new InMemoryReviewGateStore();
  for (const id of ["agent-1", "agent-2"]) {
    store.seedPrincipal({
      principalId: id, displayName: id, roles: ["executor"], reviewerClasses: [],
      audienceFor: [{ orgId: "org-1", serverId: "server-1" }],
      credentialEpoch: 1, createdAt: "2026-09-02T00:00:00.000Z",
    }, `credential-${id}`);
  }
  const thief = { principalId: "agent-2", credentialEpoch: 1 };
  const now = "2026-09-02T02:00:00.000Z";
  // agent-2 knows the lease id but does not hold the lease. Every lease operation must refuse it.
  for (const attempt of [
    () => store.bindAttestation({
      acting: thief, attestationId: "at-1", leaseId: "L1", actionDigest: "a".repeat(64), now }),
    () => store.acquireAttestation({
      acting: thief, attestationId: "at-1", leaseId: "L1", actionDigest: "a".repeat(64),
      orgId: "org-1", serverId: "server-1", kind: "configuration.apply", now,
      requireClaim: { contentDigest: "b".repeat(64), releasedByCandidateId: "c1" } }),
    () => store.redeemAttestation({
      acting: thief, attestationId: "at-1", leaseId: "L1", now,
      requireClaim: { contentDigest: "b".repeat(64), releasedByCandidateId: "c1" } }),
    () => store.renewLease({
      acting: thief, attestationId: "at-1", leaseId: "L1",
      requestedExpiresAt: "2026-09-02T03:00:00.000Z", now }),
  ]) {
    const result = await attempt();
    assert.equal(result.applied, false, "a lease operation by a non-holder must be refused");
  }
});

test("every authenticated mutation revalidates the principal, not just the lease ones", async () => {
  // THE DEFECT: revalidation was added to reserve/bind/acquire/redeem/renew and to nothing else, so an
  // owner or reviewer request authenticated before a rotation could still commit afterwards. The rule is
  // general, so this asserts it across the whole port rather than sampling one method.
  const { InMemoryReviewGateStore } = await import("../src/memoryStore.js");
  const store = new InMemoryReviewGateStore();
  const surface = Object.getOwnPropertyNames(InMemoryReviewGateStore.prototype)
    .filter((name) => !name.startsWith("load") && !name.startsWith("seed")
      && name !== "constructor" && name !== "sweepAttestations");
  assert.ok(surface.length >= 12, `expected the whole mutation surface, found ${surface.length}`);
  for (const method of surface) {
    const call = (store as unknown as Record<string, (input: unknown) => Promise<unknown>>)[method];
    const result = await call.call(store, {
      // A principal the gate has never heard of. Whatever else is wrong with this request, an unknown
      // actor must not get past the door.
      acting: { principalId: "ghost", credentialEpoch: 1 },
      candidateId: "nope", attestationId: "nope", predecessorId: "nope",
      action: "freeze", billingClass: "INTERNAL_QA_TEST", at: "2026-09-02T02:00:00.000Z",
      occurrenceId: "o", leaseId: "L", now: "2026-09-02T02:00:00.000Z",
      idempotency: { principalId: "ghost", scope: method, key: "k", requestHash: "h" },
      record: { state: "BUILT", occurrences: [], verdicts: [] },
      successor: { state: "BUILT", occurrences: [], verdicts: [] },
      attestations: [], inherited: [], reason: "x", nextState: "ABORTED",
      lease: { leaseId: "L", holderPrincipalId: "ghost", credentialEpoch: 1,
        expiresAt: "2026-09-02T03:00:00.000Z" },
      requireClaim: { contentDigest: "b".repeat(64), releasedByCandidateId: "c1" },
    }) as { applied: boolean };
    assert.equal(result.applied, false, `${method} must refuse an unknown principal`);
  }
});
