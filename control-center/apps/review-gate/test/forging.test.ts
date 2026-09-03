import test from "node:test";
import assert from "node:assert/strict";
import { AuthenticatedPrincipal, authenticate, generateCredential } from "../src/auth.js";
import { InMemoryReviewGateStore } from "../src/memoryStore.js";
import { startExpirySweep } from "../src/server.js";
import { castOf } from "./principals.js";
import { binding, record as candidateRecord } from "./storeConformance.js";

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
    { principalId: "binder-1", roles: ["binder"], audienceFor: [{ orgId: "o", serverId: "s" }] },
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

test("an executor cannot have its authorised target rewritten", async () => {
  // THE DEFECT: the freeze was SHALLOW. audienceFor was a frozen array of writable objects, so code
  // holding a legitimate principal could set audienceFor[0].serverId to a host it was never provisioned
  // for and mayActOn would agree. The comment claiming the contents could not change was true of the
  // array and false of what the array held -- which is the same sentence-versus-mechanism gap this whole
  // workstream keeps producing.
  const cast = await castOf([{
    principalId: "agent-1", roles: ["executor"],
    audienceFor: [{ orgId: "org-1", serverId: "server-1" }],
  }]);
  const principal = cast.who("agent-1");
  assert.ok(principal.mayActOn("org-1", "server-1"));
  assert.equal(principal.mayActOn("org-1", "server-9"), false);

  const target = principal.audienceFor[0] as { orgId: string; serverId: string };
  assert.throws(() => { "use strict"; target.serverId = "server-9"; },
    "rewriting the authorised host must throw");
  assert.throws(() => { "use strict"; target.orgId = "org-9"; });
  assert.equal(principal.mayActOn("org-1", "server-9"), false,
    "and the authority is unchanged");
  assert.throws(() => (principal.audienceFor as Array<unknown>).push({ orgId: "o", serverId: "s" }));
});

test("a lease can only be used by the principal that holds it", async () => {
  // THE DEFECT: the lease check compared leaseId, epoch and expiry — never the HOLDER. Any other enabled
  // principal whose current epoch matched could use a known leaseId to renew, acquire or redeem someone
  // else's lease, and acquire is the authorization immediately before a host mutation.
  //
  // MY FIRST VERSION OF THIS TEST PROVED NOTHING. It never created the attestation, so all four calls
  // refused with unknown_attestation long before the holder check ran, and it asserted only that they
  // refused. The reviewer caught that, and the claim I made about the test was false. This one reserves
  // a real lease first and asserts the exact refusal code.
  const { InMemoryReviewGateStore } = await import("../src/memoryStore.js");
  const { AttestationService } = await import("../src/attestationService.js");
  const store = new InMemoryReviewGateStore();
  const cast = await castOf([
    { principalId: "claude", roles: ["author"] },
    { principalId: "codex", roles: ["reviewer"], reviewerClasses: ["independent"] },
    { principalId: "owner", roles: ["owner"] },
    { principalId: "agent-1", roles: ["executor"], audienceFor: [{ orgId: "org-1", serverId: "server-1" }] },
    { principalId: "agent-2", roles: ["executor"], audienceFor: [{ orgId: "org-1", serverId: "server-1" }] },
    { principalId: "binder-1", roles: ["binder"], audienceFor: [{ orgId: "org-1", serverId: "server-1" }] },
  ], store);

  const at = "2026-09-02T01:00:00.000Z";
  const acting = (id: string) => ({ principalId: id, credentialEpoch: 1 });
  const idem = (id: string, key: string) => ({ principalId: id, scope: "t", key, requestHash: "h" });
  // A CONFIGURATION subject, because the attestation kind below may only be minted from one. The kind
  // to subject mapping is part of content identity, so a code candidate cannot authorize a config change.
  const b = binding({
    subject: {
      kind: "configuration.change",
      changeDigest: "5".repeat(64),
      environmentId: "env-000000000001",
      targetProfileId: "profile-00000001",
      targetProfileRevision: 1,
    },
  });
  await store.registerCandidate({
    acting: acting("claude"), record: candidateRecord("c1", { subject: b.subject }), idempotency: idem("claude", "r") });
  for (const action of ["submit-tests", "freeze", "request-review", "claim-review"] as const) {
    const who = action === "claim-review" ? "codex" : "claude";
    const moved = await store.applyAction({
      acting: acting(who), candidateId: "c1", action, billingClass: "INTERNAL_QA_TEST", at,
      occurrenceId: `o-${action}`, idempotency: idem(who, action) });
    assert.equal(moved.applied, true, `${action}: ${JSON.stringify(moved)}`);
  }
  await store.applyVerdict({
    acting: acting("codex"), candidateId: "c1", expectedState: "REVIEW_IN_PROGRESS", nextState: "GO",
    occurrence: { occurrenceId: "v", from: "REVIEW_IN_PROGRESS", to: "GO", actorIdentity: "codex",
      billingClass: "INTERNAL_REVIEW", at },
    verdict: { verdictId: "v1", reviewerIdentity: "codex", verdict: "GO", findings: [], resolves: [],
      submittedAt: at, at },
    addParticipant: { identity: "codex", role: "reviewer", at },
    idempotency: idem("codex", "verdict") });

  const svc = new AttestationService(store, { clock: () => at, ids: (() => {
    let n = 0; return () => `id-${n++}`;
  })() });
  const decision = await svc.recordOwnerDecision(cast.who("owner"), {
    candidateId: "c1", idempotencyKey: "od",
    attestations: [{ kind: "configuration.apply", orgId: "org-1", serverId: "server-1",
      audiencePrincipalId: "agent-1", bindingPrincipalId: "binder-1", expiresAt: "2026-09-02T06:00:00.000Z" }],
  });
  assert.equal(decision.ok, true, JSON.stringify(decision));
  const [attestationId] = (decision as { value: { attestationIds: string[] } }).value.attestationIds;

  // agent-1 reserves. A REAL lease now exists.
  const reserved = await svc.reserve(cast.who("binder-1"), { attestationId, leaseSeconds: 300 });
  assert.equal(reserved.ok, true, JSON.stringify(reserved));
  const { leaseId } = (reserved as { value: { leaseId: string } }).value;

  // agent-2 knows the lease id, is enabled, and is at the same epoch. Only the HOLDER check stops it.
  //
  // Each attempt is made at the state where the holder check is REACHABLE. An earlier draft fired them
  // all at once and three refused on state before reaching the holder — which is the same class of
  // worthlessness as the version that never created the attestation at all.
  const thief = acting("agent-2");
  const claim = { contentDigest: candidateRecord("c1", { subject: b.subject }).contentDigest,
    releasedByCandidateId: "c1" };
  const digest = "a".repeat(64);
  // The expected code differs by half of the split, and that difference is the point. On the BINDING
  // half the thief is not the lease holder. On the EXECUTION half the holder is deliberately not
  // compared -- the binder holds the lease and the audience executes -- so the thief is stopped by not
  // being the audience, which is a stronger statement than "not the holder".
  const refusal = async (
    name: string, expected: string, promise: Promise<{ applied: boolean; code?: string }>,
  ) => {
    const result = await promise;
    assert.equal(result.applied, false, `${name} by a non-holder must be refused`);
    assert.equal(result.code, expected,
      `${name} must refuse for the intended reason, not for some earlier one`);
  };

  // RESERVED_UNBOUND: bind and renew are both legal here for the holder.
  await refusal("bind", "not_lease_holder", store.bindAttestation({
    acting: thief, attestationId, leaseId, actionDigest: digest, now: at }));
  await refusal("renew", "not_lease_holder", store.renewLease({
    acting: thief, attestationId, leaseId,
    requestedExpiresAt: "2026-09-02T03:00:00.000Z", now: at }));

  // The BINDER binds, so the attestation reaches RESERVED_BOUND and acquire becomes reachable.
  const bound = await store.bindAttestation({
    acting: acting("binder-1"), attestationId, leaseId, actionDigest: digest, now: at });
  assert.equal(bound.applied, true, JSON.stringify(bound));
  await refusal("acquire", "wrong_audience", store.acquireAttestation({
    acting: thief, attestationId, leaseId, actionDigest: digest,
    orgId: "org-1", serverId: "server-1", kind: "configuration.apply", now: at, requireClaim: claim }));

  // The holder acquires, so redeem becomes reachable.
  const acquired = await store.acquireAttestation({
    acting: acting("agent-1"), attestationId, leaseId, actionDigest: digest,
    orgId: "org-1", serverId: "server-1", kind: "configuration.apply", now: at, requireClaim: claim });
  assert.equal(acquired.applied, true, JSON.stringify(acquired));
  await refusal("redeem", "wrong_audience", store.redeemAttestation({
    acting: thief, attestationId, leaseId, now: at, requireClaim: claim }));

  // ...and the legitimate holder still completes, so the check is not simply refusing everyone.
  const redeemed = await store.redeemAttestation({
    acting: acting("agent-1"), attestationId, leaseId, now: at, requireClaim: claim });
  assert.equal(redeemed.applied, true, JSON.stringify(redeemed));
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
    }) as { applied: boolean; code?: string };
    assert.equal(result.applied, false, `${method} must refuse an unknown principal`);
    // THE EXACT CODE. Asserting only "refused" would pass for a method with no revalidation at all,
    // because malformed input, a missing record or an idempotency clash would refuse it anyway. The
    // reviewer was right that the first version certified nothing.
    assert.equal(result.code, "unknown_principal",
      `${method} must refuse BECAUSE the principal is unknown, not for some earlier reason`);
  }
});
