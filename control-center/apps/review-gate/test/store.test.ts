import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryReviewGateStore } from "../src/memoryStore.js";
import { contentDigest, candidateDigest, type CandidateBinding } from "../src/policy.js";
import type { AttestationRecord } from "../src/attestation.js";
import type { CandidateRecord, IdempotencyKey } from "../src/store.js";

const oid = (c: string) => c.repeat(40).slice(0, 40);
const dig = (c: string) => c.repeat(64).slice(0, 64);

function binding(over: Partial<CandidateBinding> = {}): CandidateBinding {
  return {
    subject: { kind: "code" },
    projectId: "crafters-market",
    repository: "williams342-maker/operation",
    baseBranch: "main",
    baseCommit: oid("a"),
    candidateCommit: oid("b"),
    candidateTree: oid("c"),
    patchDigest: dig("1"),
    artifactDigest: dig("3"),
    manifestDigest: dig("4"),
    dependencyLockDigests: [],
    testPlanVersion: "tp-1",
    testResultDigest: dig("2"),
    targetEnvironmentClass: "test",
    authorIdentity: "claude",
    requestedReviewerClass: "independent",
    authorityRef: "OWNER-2026-09-02",
    createdAt: "2026-09-02T00:00:00.000Z",
    occurrenceId: "occ-seed",
    ...over,
  } as CandidateBinding;
}

function record(id: string, over: Partial<CandidateBinding> = {}): CandidateRecord {
  const b = binding(over);
  return {
    candidateId: id,
    digest: candidateDigest(b),
    contentDigest: contentDigest(b),
    binding: b,
    state: "BUILT",
    participants: [{ identity: b.authorIdentity, role: "author", at: "2026-09-02T00:00:00.000Z" }],
    occurrences: [],
    verdicts: [],
  };
}

let counter = 0;
const idem = (principalId = "claude"): IdempotencyKey =>
  ({ principalId, scope: "test", key: `k-${counter++}`, requestHash: "h" });

const attestation = (id: string, over: Partial<AttestationRecord> = {}): AttestationRecord => ({
  attestationId: id,
  kind: "configuration.apply",
  contentDigest: dig("9"),
  candidateId: "c1",
  orgId: "org-1",
  serverId: "server-1",
  targetEnvironmentClass: "staging",
  audiencePrincipalId: "agent-1",
  nonce: "n-1",
  grantedByPrincipalId: "owner",
  grantedAt: "2026-09-02T00:00:00.000Z",
  expiresAt: "2026-09-02T06:00:00.000Z",
  state: "PENDING",
  ...over,
});

// ── the store refuses to launder history ─────────────────────────────────────────────────────────────

test("a candidate cannot be registered in a state it did not earn", async () => {
  // Design review round 8: create() used to accept a caller-built record including its state, so a record
  // could be written straight into READY_FOR_OWNER_DECISION with no test, no review and no verdict.
  const store = new InMemoryReviewGateStore();
  const forged = { ...record("forged"), state: "READY_FOR_OWNER_DECISION" as const };
  const result = await store.registerCandidate({ record: forged, idempotency: idem() });
  assert.equal(result.applied, false);
  assert.equal((result as { code: string }).code, "record_not_initial");
  assert.equal(await store.loadCandidate("forged"), null);
});

test("a candidate cannot arrive carrying verdicts", async () => {
  const store = new InMemoryReviewGateStore();
  const pre = {
    ...record("pre"),
    verdicts: [{
      verdictId: "v1", reviewerIdentity: "codex", verdict: "GO" as const,
      findings: [], resolves: [], submittedAt: "2026-09-02T00:00:00.000Z", at: "2026-09-02T00:00:00.000Z",
    }],
  };
  const result = await store.registerCandidate({ record: pre, idempotency: idem() });
  assert.equal(result.applied, false);
  assert.equal((result as { code: string }).code, "record_not_initial");
});

test("there is no method that means 'put this candidate in that state'", () => {
  // The structural point of the port. Round 8's bypass was a general-purpose compareAndSetState that
  // wrote whatever nextState it was handed; every method here is named for an operation instead, so a
  // policy-free lifecycle jump cannot be expressed at all.
  const surface = Object.getOwnPropertyNames(InMemoryReviewGateStore.prototype);
  for (const forbidden of ["compareAndSetState", "setState", "create", "update", "write"]) {
    assert.equal(surface.includes(forbidden), false,
      `${forbidden} is a policy-free primitive; the port must not offer one`);
  }
  assert.ok(surface.includes("applyVerdict") && surface.includes("acquireAttestation"),
    "the port should be named for operations");
});

// ── content claims ───────────────────────────────────────────────────────────────────────────────────

test("two live candidates cannot carry the same content", async () => {
  const store = new InMemoryReviewGateStore();
  assert.equal((await store.registerCandidate({ record: record("a"), idempotency: idem() })).applied, true);
  const twin = await store.registerCandidate({ record: record("b"), idempotency: idem() });
  assert.equal(twin.applied, false);
  assert.equal((twin as { code: string }).code, "content_already_live");
});

test("cancelling releases the claim; a rejected claim is never released", async () => {
  const store = new InMemoryReviewGateStore();
  await store.registerCandidate({ record: record("a"), idempotency: idem() });
  const cancel = await store.applyAction({
    candidateId: "a", expectedState: "BUILT", nextState: "CANCELLED",
    occurrence: { occurrenceId: "o1", from: "BUILT", to: "CANCELLED", actorIdentity: "claude",
      billingClass: "INTERNAL_QA_TEST", at: "2026-09-02T01:00:00.000Z" },
    releaseClaim: true, idempotency: idem(),
  });
  assert.equal(cancel.applied, true);
  assert.equal(await store.loadClaim(record("a").contentDigest), null, "the claim is released");
  // ...and the same content may be registered again, because abandoning work must not bar it forever.
  assert.equal((await store.registerCandidate({ record: record("c"), idempotency: idem() })).applied, true);
});

test("a rejection survives the candidate that received it", async () => {
  const store = new InMemoryReviewGateStore();
  const r = record("a");
  await store.registerCandidate({ record: r, idempotency: idem() });
  const reject = await store.applyVerdict({
    candidateId: "a", expectedState: "BUILT", nextState: "CANCELLED",
    occurrence: { occurrenceId: "o1", from: "BUILT", to: "CANCELLED", actorIdentity: "codex",
      billingClass: "INTERNAL_REVIEW", at: "2026-09-02T01:00:00.000Z" },
    verdict: { verdictId: "v1", reviewerIdentity: "codex", verdict: "NO_GO", findings: [], resolves: [],
      submittedAt: "2026-09-02T01:00:00.000Z", at: "2026-09-02T01:00:00.000Z" },
    addParticipant: { identity: "codex", role: "reviewer", at: "2026-09-02T01:00:00.000Z" },
    rejectContent: r.contentDigest, idempotency: idem(),
  });
  assert.equal(reject.applied, true);
  const claim = await store.loadClaim(r.contentDigest);
  assert.equal(claim!.disposition, "REJECTED");
  // A fresh candidate id carrying the same work is refused at REGISTRATION, not at approval.
  const relabelled = await store.registerCandidate({ record: record("b"), idempotency: idem() });
  assert.equal(relabelled.applied, false);
  assert.equal((relabelled as { code: string }).code, "content_already_rejected");
});

test("a successor claims its OWN digest and never inherits the predecessor's document", async () => {
  // Design review round 6: modelling this as a transfer on one claim document is incoherent, because the
  // differing digest is exactly what makes it a successor.
  const store = new InMemoryReviewGateStore();
  const predecessor = record("p");
  await store.registerCandidate({ record: predecessor, idempotency: idem() });
  const successor = record("s", { candidateCommit: oid("d"), candidateTree: oid("e") });
  const result = await store.createSuccessor({
    predecessorId: "p", successor, inherited: [], at: "2026-09-02T02:00:00.000Z", idempotency: idem(),
  });
  assert.equal(result.applied, true, JSON.stringify(result));
  assert.notEqual(successor.contentDigest, predecessor.contentDigest);
  assert.equal(await store.loadClaim(predecessor.contentDigest), null,
    "the predecessor released its own digest");
  const claim = await store.loadClaim(successor.contentDigest);
  assert.equal(claim!.disposition, "LIVE");
  assert.equal(claim!.liveCandidateId, "s");
  assert.equal((await store.loadCandidate("s"))!.supersedes, "p");
});

test("a predecessor cannot be superseded twice", async () => {
  const store = new InMemoryReviewGateStore();
  await store.registerCandidate({ record: record("p"), idempotency: idem() });
  await store.createSuccessor({
    predecessorId: "p", successor: record("s1", { candidateCommit: oid("d") }),
    inherited: [], at: "2026-09-02T02:00:00.000Z", idempotency: idem(),
  });
  const second = await store.createSuccessor({
    predecessorId: "p", successor: record("s2", { candidateCommit: oid("e") }),
    inherited: [], at: "2026-09-02T02:00:00.000Z", idempotency: idem(),
  });
  assert.equal(second.applied, false);
  assert.equal((second as { code: string }).code, "predecessor_already_superseded");
});

// ── idempotency ──────────────────────────────────────────────────────────────────────────────────────

test("a replayed key is a no-op; the same key with a different request is an error", async () => {
  const store = new InMemoryReviewGateStore();
  const key: IdempotencyKey = { principalId: "claude", scope: "register", key: "k1", requestHash: "h1" };
  assert.equal((await store.registerCandidate({ record: record("a"), idempotency: key })).applied, true);
  const replay = await store.registerCandidate({ record: record("a"), idempotency: key });
  assert.equal((replay as { code: string }).code, "idempotent_replay");
  const different = await store.registerCandidate({
    record: record("b"), idempotency: { ...key, requestHash: "h2" },
  });
  assert.equal((different as { code: string }).code, "idempotency_key_reused",
    "reusing a key for a different request must not return an unrelated result");
});

// ── attestations ─────────────────────────────────────────────────────────────────────────────────────

/** Walk a candidate to GO through legal moves. The store refuses jumps, which is the point of it. */
async function walkToGo(store: InMemoryReviewGateStore, id: string) {
  const at = "2026-09-02T01:00:00.000Z";
  const steps: Array<[string, string]> = [
    ["BUILT", "TESTED"], ["TESTED", "FROZEN"], ["FROZEN", "REVIEW_REQUESTED"],
    ["REVIEW_REQUESTED", "REVIEW_IN_PROGRESS"],
  ];
  for (const [from, to] of steps) {
    const moved = await store.applyAction({
      candidateId: id, expectedState: from as never, nextState: to as never,
      occurrence: { occurrenceId: "w-" + to, from: from as never, to: to as never,
        actorIdentity: "claude", billingClass: "INTERNAL_QA_TEST", at },
      idempotency: idem(),
    });
    assert.equal(moved.applied, true, from + " -> " + to + ": " + JSON.stringify(moved));
  }
  const go = await store.applyVerdict({
    candidateId: id, expectedState: "REVIEW_IN_PROGRESS", nextState: "GO",
    occurrence: { occurrenceId: "w-GO", from: "REVIEW_IN_PROGRESS", to: "GO",
      actorIdentity: "codex", billingClass: "INTERNAL_REVIEW", at },
    verdict: { verdictId: "v1", reviewerIdentity: "codex", verdict: "GO", findings: [], resolves: [],
      submittedAt: at, at },
    addParticipant: { identity: "codex", role: "reviewer", at },
    idempotency: idem("codex"),
  });
  assert.equal(go.applied, true, JSON.stringify(go));
}

async function released(store: InMemoryReviewGateStore, attestations: AttestationRecord[]) {
  const r = record("c1");
  await store.registerCandidate({ record: r, idempotency: idem() });
  await walkToGo(store, "c1");
  const bound = attestations.map((a) => ({ ...a, contentDigest: r.contentDigest, candidateId: "c1" }));
  const decision = await store.recordOwnerDecision({
    candidateId: "c1", expectedState: "GO",
    occurrence: { occurrenceId: "od", from: "GO", to: "READY_FOR_OWNER_DECISION",
      actorIdentity: "owner", billingClass: "INTERNAL_REVIEW", at: "2026-09-02T02:00:00.000Z" },
    contentDigest: r.contentDigest, attestations: bound,
    at: "2026-09-02T02:00:00.000Z", idempotency: idem("owner"),
  });
  return { contentDigest: r.contentDigest, decision };
}

test("owner decision mints only UNBOUND attestations", async () => {
  const store = new InMemoryReviewGateStore();
  const pre = attestation("at-1", { actionDigest: dig("7"), state: "RESERVED_BOUND" });
  const r = record("c1");
  await store.registerCandidate({ record: r, idempotency: idem() });
  await walkToGo(store, "c1");
  const result = await store.recordOwnerDecision({
    candidateId: "c1", expectedState: "GO",
    occurrence: { occurrenceId: "od", from: "GO", to: "READY_FOR_OWNER_DECISION",
      actorIdentity: "owner", billingClass: "INTERNAL_REVIEW", at: "2026-09-02T02:00:00.000Z" },
    contentDigest: r.contentDigest,
    attestations: [{ ...pre, contentDigest: r.contentDigest }],
    at: "2026-09-02T02:00:00.000Z", idempotency: idem("owner"),
  });
  assert.equal(result.applied, false, "an attestation arriving already bound is not a mint");
  assert.equal((result as { code: string }).code, "attestation_not_unbound");
});

test("the full attestation path: reserve, bind, acquire, redeem", async () => {
  const store = new InMemoryReviewGateStore();
  const { decision } = await released(store, [attestation("at-1")]);
  assert.equal(decision.applied, true, JSON.stringify(decision));
  const claim = { contentDigest: (await store.loadAttestation("at-1"))!.contentDigest,
    releasedByCandidateId: "c1" };
  const lease = { leaseId: "L1", holderPrincipalId: "agent-1", credentialEpoch: 3,
    expiresAt: "2026-09-02T03:00:00.000Z" };
  const now = "2026-09-02T02:10:00.000Z";

  assert.equal((await store.reserveAttestation({
    attestationId: "at-1", lease, now, requireClaim: claim })).applied, true);
  assert.equal((await store.loadAttestation("at-1"))!.state, "RESERVED_UNBOUND");

  assert.equal((await store.bindAttestation({
    attestationId: "at-1", leaseId: "L1", credentialEpoch: 3, actionDigest: dig("7"), now })).applied, true);
  assert.equal((await store.loadAttestation("at-1"))!.actionDigest, dig("7"));

  const acquire = {
    attestationId: "at-1", leaseId: "L1", credentialEpoch: 3, actionDigest: dig("7"),
    orgId: "org-1", serverId: "server-1", kind: "configuration.apply" as const, now, requireClaim: claim,
  };
  assert.equal((await store.acquireAttestation(acquire)).applied, true);
  // THE POINT OF ACQUISITION: a second delivery loses, and loses BEFORE it could mutate anything.
  const second = await store.acquireAttestation(acquire);
  assert.equal(second.applied, false);
  assert.equal((second as { code: string }).code, "attestation_state");

  assert.equal((await store.redeemAttestation({
    attestationId: "at-1", leaseId: "L1", credentialEpoch: 3, now, requireClaim: claim })).applied, true);
  assert.equal((await store.loadAttestation("at-1"))!.state, "CONSUMED");
});

test("a rotated credential invalidates work in flight", async () => {
  const store = new InMemoryReviewGateStore();
  await released(store, [attestation("at-1")]);
  const claim = { contentDigest: (await store.loadAttestation("at-1"))!.contentDigest,
    releasedByCandidateId: "c1" };
  const now = "2026-09-02T02:10:00.000Z";
  await store.reserveAttestation({
    attestationId: "at-1",
    lease: { leaseId: "L1", holderPrincipalId: "agent-1", credentialEpoch: 3,
      expiresAt: "2026-09-02T03:00:00.000Z" },
    now, requireClaim: claim,
  });
  // The executor comes back with a NEWER epoch: its credential was rotated after it reserved.
  const bind = await store.bindAttestation({
    attestationId: "at-1", leaseId: "L1", credentialEpoch: 4, actionDigest: dig("7"), now });
  assert.equal(bind.applied, false);
  assert.equal((bind as { code: string }).code, "credential_rotated");
});

test("a lease can never outlive the attestation it belongs to", async () => {
  const store = new InMemoryReviewGateStore();
  await released(store, [attestation("at-1", { expiresAt: "2026-09-02T03:00:00.000Z" })]);
  const claim = { contentDigest: (await store.loadAttestation("at-1"))!.contentDigest,
    releasedByCandidateId: "c1" };
  await store.reserveAttestation({
    attestationId: "at-1",
    // asks for far longer than the attestation is valid for
    lease: { leaseId: "L1", holderPrincipalId: "agent-1", credentialEpoch: 1,
      expiresAt: "2026-09-09T00:00:00.000Z" },
    now: "2026-09-02T02:10:00.000Z", requireClaim: claim,
  });
  assert.equal((await store.loadAttestation("at-1"))!.lease!.expiresAt, "2026-09-02T03:00:00.000Z",
    "the lease is clamped to the attestation, or renewal could extend a review's validity");
});

test("sweeping: unbound expires, bound becomes indeterminate", async () => {
  const store = new InMemoryReviewGateStore();
  await released(store, [
    attestation("unbound", { expiresAt: "2026-09-02T02:30:00.000Z" }),
    attestation("bound", { expiresAt: "2026-09-02T02:30:00.000Z" }),
  ]);
  const claim = { contentDigest: (await store.loadAttestation("bound"))!.contentDigest,
    releasedByCandidateId: "c1" };
  const lease = { leaseId: "L1", holderPrincipalId: "agent-1", credentialEpoch: 1,
    expiresAt: "2026-09-02T02:30:00.000Z" };
  const now = "2026-09-02T02:10:00.000Z";
  await store.reserveAttestation({ attestationId: "bound", lease, now, requireClaim: claim });
  await store.bindAttestation({
    attestationId: "bound", leaseId: "L1", credentialEpoch: 1, actionDigest: dig("7"), now });

  const swept = await store.sweepAttestations("2026-09-02T04:00:00.000Z");
  assert.deepEqual(swept.expired, ["unbound"], "nothing was dispatched for it, so expiry is free");
  assert.deepEqual(swept.indeterminate, ["bound"], "a payload was named and may be in flight");
  // And neither returns to a reservable state.
  assert.equal((await store.loadAttestation("bound"))!.state, "INDETERMINATE");
  const retry = await store.reserveAttestation({ attestationId: "bound", lease, now, requireClaim: claim });
  assert.equal(retry.applied, false);
});

test("an EXECUTING attestation cannot be revoked", async () => {
  const store = new InMemoryReviewGateStore();
  await released(store, [attestation("at-1")]);
  const claim = { contentDigest: (await store.loadAttestation("at-1"))!.contentDigest,
    releasedByCandidateId: "c1" };
  const now = "2026-09-02T02:10:00.000Z";
  await store.reserveAttestation({
    attestationId: "at-1",
    lease: { leaseId: "L1", holderPrincipalId: "agent-1", credentialEpoch: 1,
      expiresAt: "2026-09-02T03:00:00.000Z" },
    now, requireClaim: claim,
  });
  await store.bindAttestation({
    attestationId: "at-1", leaseId: "L1", credentialEpoch: 1, actionDigest: dig("7"), now });
  await store.acquireAttestation({
    attestationId: "at-1", leaseId: "L1", credentialEpoch: 1, actionDigest: dig("7"),
    orgId: "org-1", serverId: "server-1", kind: "configuration.apply", now, requireClaim: claim });

  const revoke = await store.revokeAttestation({ attestationId: "at-1", reason: "changed mind", now });
  assert.equal(revoke.applied, false,
    "the effect may already be underway; a row claiming it was stopped would be a lie");
  assert.equal((revoke as { code: string }).code, "attestation_state");
});
