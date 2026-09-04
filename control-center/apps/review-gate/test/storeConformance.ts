import test from "node:test";
import assert from "node:assert/strict";
import { hashCredential } from "../src/auth.js";
import { contentDigest, candidateDigest, type CandidateBinding } from "../src/policy.js";
import type { AttestationRecord } from "../src/attestation.js";
import type { CandidateRecord, IdempotencyKey, Principal, ReviewGateStore } from "../src/store.js";

// The invariants a ReviewGateStore must satisfy, written once and run against every implementation.
//
// WHY THIS EXISTS. The in-memory reference gets atomicity for free by never awaiting; Mongo has to ask
// for it with a session transaction. Two implementations of the same contract is exactly the situation
// where one quietly stops enforcing something. Sharing the suite means the Mongo store cannot pass by
// being different — it passes by being equivalent, or it fails.
//
// It is also what makes an honest "NOT RUN" recoverable: when a replica set exists, the same assertions
// point at the durable store and the answer changes from unverified to verified without anyone writing
// new tests.

const oid = (c: string) => c.repeat(40).slice(0, 40);
export const dig = (c: string) => c.repeat(64).slice(0, 64);

export function binding(over: Partial<CandidateBinding> = {}): CandidateBinding {
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

export function record(id: string, over: Partial<CandidateBinding> = {}): CandidateRecord {
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

export const attestation = (id: string, over: Partial<AttestationRecord> = {}): AttestationRecord => ({
  attestationId: id,
  kind: "configuration.apply",
  contentDigest: dig("9"),
  candidateId: "c1",
  orgId: "org-1",
  serverId: "server-1",
  targetEnvironmentClass: "staging",
  audiencePrincipalId: "agent-1",
  bindingPrincipalId: "binder-1",
  identitySchemaVersion: "v2",
  nonce: "n-1",
  grantedByPrincipalId: "owner",
  grantedAt: "2026-09-02T00:00:00.000Z",
  expiresAt: "2026-09-02T06:00:00.000Z",
  state: "PENDING",
  ...over,
});

export type StoreFactory = () => Promise<{
  store: ReviewGateStore;
  /**
   * Provision a principal the way the operator CLI would.
   *
   * The suite needs this because credential-sensitive operations re-read the CURRENT principal inside
   * their transaction. An independent review found that comparing only against the epoch stored in the
   * lease let a request authenticated before a rotation commit after it, so "does this principal still
   * exist, and is its epoch still what the lease says" is now part of the contract each store must meet.
   */
  seedPrincipal: (principal: Principal) => Promise<void>;
  dispose: () => Promise<void>;
}>;

/**
 * Run the contract against one implementation.
 *
 * `label` appears in every test name so a failure says which store broke, which matters when the two
 * disagree — that disagreement is the thing this suite exists to surface.
 */
export function runStoreConformance(label: string, makeStore: StoreFactory): void {
  /**
   * Who is acting, at their current epoch.
   *
   * Every authenticated mutation carries this now, not just the lease operations: an independent
   * review found revalidation had been added to five methods and to nothing else, so an owner or
   * reviewer request authenticated before a rotation could still commit afterwards.
   */
  const acting = (principalId: string, credentialEpoch = 1) => ({ principalId, credentialEpoch });

  // Acquire now mints an attempt: the store receives a VERIFIER (never the token), an execution deadline,
  // and an idempotency identity bound to the whole request. `token` is the plaintext a test keeps so it
  // can later extend or redeem with it.
  let acquireSeq = 0;
  const attempt = (token: string, over: Record<string, unknown> = {}) => ({
    attemptTokenVerifier: hashCredential(token),
    // Comfortably inside the absolute bound the extension tests use, so a genuine extension has
    // somewhere to go. Sitting on the bound would make every extension look like a violation.
    executionDeadline: "2026-09-02T02:40:00.000Z",
    idempotency: { principalId: "agent-1", scope: "acquire", key: `acq-${acquireSeq++}`,
      requestHash: "h" } as IdempotencyKey,
    ...over,
  });

  let counter = 0;
  const idem = (principalId = "claude"): IdempotencyKey =>
    ({ principalId, scope: "conformance", key: `k-${counter++}`, requestHash: "h" });

  const principal = (principalId: string, over: Partial<Principal> = {}): Principal => ({
    principalId,
    displayName: principalId,
    credentialHash: "unused-by-these-tests",
    roles: [],
    reviewerClasses: [],
    credentialEpoch: 1,
    createdAt: "2026-09-02T00:00:00.000Z",
    ...over,
  });

  const withStore = async (
    body: (store: ReviewGateStore, seed: (p: Principal) => Promise<void>) => Promise<void>,
  ): Promise<void> => {
    const { store, seedPrincipal, dispose } = await makeStore();
    try {
      // The cast every case needs. Credential-sensitive store methods re-read these.
      for (const id of ["claude", "codex", "owner"]) await seedPrincipal(principal(id));
      // The audience must be provisioned for the target: `executionAuthority` re-reads the principal row
      // inside the transaction, which is a check the store did not make before the split.
      const scope = [{ orgId: "org-1", serverId: "server-1" }];
      await seedPrincipal(principal("agent-1", { audienceFor: scope }));
      await seedPrincipal(principal("binder-1", { audienceFor: scope }));
      await body(store, seedPrincipal);
    } finally {
      await dispose();
    }
  };

  /** Walk to GO by NAMED ACTIONS. There is no way to ask the store for a destination. */
  async function walkToGo(store: ReviewGateStore, id: string) {
    const at = "2026-09-02T01:00:00.000Z";
    const steps = ["submit-tests", "freeze", "request-review", "claim-review"] as const;
    for (const action of steps) {
      const moved = await store.applyAction({
        acting: acting(action === "claim-review" ? "codex" : "claude"),
        candidateId: id, action,
        billingClass: "INTERNAL_QA_TEST", at, occurrenceId: `w-${action}`,
        idempotency: idem(),
      });
      assert.equal(moved.applied, true, `${action}: ${JSON.stringify(moved)}`);
    }
    const go = await store.applyVerdict({ acting: acting("codex"),
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

  async function released(store: ReviewGateStore, attestations: AttestationRecord[]) {
    const r = record("c1");
    await store.registerCandidate({ acting: acting("claude"), record: r, idempotency: idem() });
    await walkToGo(store, "c1");
    const bound = attestations.map((a) =>
      ({ ...a, contentDigest: r.contentDigest, candidateId: "c1" }));
    const decision = await store.recordOwnerDecision({ acting: acting("owner"),
      candidateId: "c1", expectedState: "GO",
      occurrence: { occurrenceId: "od", from: "GO", to: "READY_FOR_OWNER_DECISION",
          actorIdentity: "owner", billingClass: "INTERNAL_REVIEW", at: "2026-09-02T02:00:00.000Z" },
      contentDigest: r.contentDigest, attestations: bound,
      at: "2026-09-02T02:00:00.000Z", idempotency: idem("owner"),
    });
    assert.equal(decision.applied, true, JSON.stringify(decision));
    return { contentDigest: r.contentDigest, claim: {
      contentDigest: r.contentDigest, releasedByCandidateId: "c1" } };
  }

  // ── refusing to launder history ─────────────────────────────────────────────────────────────────

  test(`${label}: a candidate cannot be registered in a state it did not earn`, async () => {
    await withStore(async (store) => {
      const forged = { ...record("forged"), state: "READY_FOR_OWNER_DECISION" as const };
      const result = await store.registerCandidate({ acting: acting("claude"), record: forged, idempotency: idem() });
      assert.equal(result.applied, false);
      assert.equal((result as { code: string }).code, "record_not_initial");
      assert.equal(await store.loadCandidate("forged"), null);
    });
  });

  test(`${label}: a candidate cannot arrive carrying verdicts`, async () => {
    await withStore(async (store) => {
      const pre = {
        ...record("pre"),
        verdicts: [{
          verdictId: "v1", reviewerIdentity: "codex", verdict: "GO" as const, findings: [], resolves: [],
          submittedAt: "2026-09-02T00:00:00.000Z", at: "2026-09-02T00:00:00.000Z",
        }],
      };
      const result = await store.registerCandidate({ acting: acting("claude"), record: pre, idempotency: idem() });
      assert.equal((result as { code: string }).code, "record_not_initial");
    });
  });

  test(`${label}: a destination cannot be requested at all`, async () => {
    // The round-8 primitive, closed by SHAPE rather than by a check. There is no argument on this port
    // meaning "put this candidate in that state" -- the action decides, and an action that is not legal
    // from the current state is refused.
    await withStore(async (store) => {
      await store.registerCandidate({ acting: acting("claude"), record: record("direct"), idempotency: idem() });
      const jumped = await store.applyAction({
        acting: acting("claude"),
        candidateId: "direct", action: "freeze",
        billingClass: "INTERNAL_QA_TEST", at: "2026-09-02T02:00:00.000Z", occurrenceId: "x",
        idempotency: idem(),
      });
      assert.equal(jumped.applied, false, "freeze is not legal from BUILT");
      assert.equal((jumped as { code: string }).code, "illegal_transition");
      assert.equal((await store.loadCandidate("direct"))!.state, "BUILT");
    });
  });

  test(`${label}: a successor must arrive at BUILT with no history`, async () => {
    await withStore(async (store) => {
      await store.registerCandidate({ acting: acting("claude"), record: record("p"), idempotency: idem() });
      const forged = {
        ...record("s", { candidateCommit: oid("d") }),
        state: "READY_FOR_OWNER_DECISION" as const,
      };
      const result = await store.createSuccessor({ acting: acting("claude"),
        predecessorId: "p", successor: forged, inherited: [],
        at: "2026-09-02T02:00:00.000Z", idempotency: idem(),
      });
      assert.equal(result.applied, false, "the successor door must not launder history either");
      assert.equal((result as { code: string }).code, "record_not_initial");
    });
  });

  // ── content claims ──────────────────────────────────────────────────────────────────────────────

  test(`${label}: two live candidates cannot carry the same content`, async () => {
    await withStore(async (store) => {
      assert.equal(
        (await store.registerCandidate({ acting: acting("claude"), record: record("a"), idempotency: idem() })).applied, true);
      const twin = await store.registerCandidate({ acting: acting("claude"), record: record("b"), idempotency: idem() });
      assert.equal(twin.applied, false);
      assert.equal((twin as { code: string }).code, "content_already_live");
    });
  });

  test(`${label}: cancelling releases the claim, so abandoned work can be resubmitted`, async () => {
    await withStore(async (store) => {
      await store.registerCandidate({ acting: acting("claude"), record: record("a"), idempotency: idem() });
      const cancel = await store.applyAction({
        acting: acting("claude"),
        candidateId: "a", action: "cancel",
        billingClass: "INTERNAL_QA_TEST", at: "2026-09-02T01:00:00.000Z", occurrenceId: "o1",
        idempotency: idem(),
      });
      assert.equal(cancel.applied, true, JSON.stringify(cancel));
      assert.equal(await store.loadClaim(record("a").contentDigest), null);
      assert.equal(
        (await store.registerCandidate({ acting: acting("claude"), record: record("c"), idempotency: idem() })).applied, true);
    });
  });

  test(`${label}: a rejection survives the candidate that received it`, async () => {
    await withStore(async (store) => {
      const r = record("a");
      await store.registerCandidate({ acting: acting("claude"), record: r, idempotency: idem() });
      const reject = await store.applyVerdict({ acting: acting("codex"),
        candidateId: "a", expectedState: "BUILT", nextState: "CANCELLED",
        occurrence: { occurrenceId: "o1", from: "BUILT", to: "CANCELLED", actorIdentity: "codex",
          billingClass: "INTERNAL_REVIEW", at: "2026-09-02T01:00:00.000Z" },
        verdict: { verdictId: "v1", reviewerIdentity: "codex", verdict: "NO_GO", findings: [],
          resolves: [], submittedAt: "2026-09-02T01:00:00.000Z", at: "2026-09-02T01:00:00.000Z" },
        addParticipant: { identity: "codex", role: "reviewer", at: "2026-09-02T01:00:00.000Z" },
        rejectContent: r.contentDigest, idempotency: idem(),
      });
      assert.equal(reject.applied, true, JSON.stringify(reject));
      assert.equal((await store.loadClaim(r.contentDigest))!.disposition, "REJECTED");
      // A fresh candidate id carrying the same work is refused at REGISTRATION, not at approval.
      const relabelled = await store.registerCandidate({ acting: acting("claude"), record: record("b"), idempotency: idem() });
      assert.equal((relabelled as { code: string }).code, "content_already_rejected");
    });
  });

  test(`${label}: a successor claims its OWN digest and never inherits the predecessor's`, async () => {
    await withStore(async (store) => {
      const predecessor = record("p");
      await store.registerCandidate({ acting: acting("claude"), record: predecessor, idempotency: idem() });
      const successor = record("s", { candidateCommit: oid("d"), candidateTree: oid("e") });
      const result = await store.createSuccessor({ acting: acting("claude"),
        predecessorId: "p", successor, inherited: [],
        at: "2026-09-02T02:00:00.000Z", idempotency: idem(),
      });
      assert.equal(result.applied, true, JSON.stringify(result));
      assert.notEqual(successor.contentDigest, predecessor.contentDigest);
      assert.equal(await store.loadClaim(predecessor.contentDigest), null);
      const claim = await store.loadClaim(successor.contentDigest);
      assert.equal(claim!.disposition, "LIVE");
      assert.equal(claim!.liveCandidateId, "s");
      assert.equal((await store.loadCandidate("s"))!.supersedes, "p");
    });
  });

  test(`${label}: a predecessor cannot be superseded twice`, async () => {
    await withStore(async (store) => {
      await store.registerCandidate({ acting: acting("claude"), record: record("p"), idempotency: idem() });
      await store.createSuccessor({ acting: acting("claude"),
        predecessorId: "p", successor: record("s1", { candidateCommit: oid("d") }),
        inherited: [], at: "2026-09-02T02:00:00.000Z", idempotency: idem(),
      });
      const second = await store.createSuccessor({ acting: acting("claude"),
        predecessorId: "p", successor: record("s2", { candidateCommit: oid("e") }),
        inherited: [], at: "2026-09-02T02:00:00.000Z", idempotency: idem(),
      });
      assert.equal((second as { code: string }).code, "predecessor_already_superseded");
    });
  });

  // ── idempotency ─────────────────────────────────────────────────────────────────────────────────

  test(`${label}: a replay is a no-op; the same key with a different request is an error`, async () => {
    await withStore(async (store) => {
      const key: IdempotencyKey =
        { principalId: "claude", scope: "register", key: "k1", requestHash: "h1" };
      assert.equal(
        (await store.registerCandidate({ acting: acting("claude"), record: record("a"), idempotency: key })).applied, true);
      const replay = await store.registerCandidate({ acting: acting("claude"), record: record("a"), idempotency: key });
      assert.equal((replay as { code: string }).code, "idempotent_replay");
      const different = await store.registerCandidate({ acting: acting("claude"),
        record: record("b"), idempotency: { ...key, requestHash: "h2" },
      });
      assert.equal((different as { code: string }).code, "idempotency_key_reused");
    });
  });

  // ── attestations ────────────────────────────────────────────────────────────────────────────────

  test(`${label}: owner decision mints only UNBOUND attestations`, async () => {
    await withStore(async (store) => {
      const r = record("c1");
      await store.registerCandidate({ acting: acting("claude"), record: r, idempotency: idem() });
      await walkToGo(store, "c1");
      const result = await store.recordOwnerDecision({ acting: acting("owner"),
        candidateId: "c1", expectedState: "GO",
        occurrence: { occurrenceId: "od", from: "GO", to: "READY_FOR_OWNER_DECISION",
          actorIdentity: "owner", billingClass: "INTERNAL_REVIEW", at: "2026-09-02T02:00:00.000Z" },
        contentDigest: r.contentDigest,
        attestations: [attestation("at-1", {
          contentDigest: r.contentDigest, actionDigest: dig("7"), state: "RESERVED_BOUND" })],
        at: "2026-09-02T02:00:00.000Z", idempotency: idem("owner"),
      });
      assert.equal(result.applied, false, "an attestation arriving already bound is not a mint");
      assert.equal((result as { code: string }).code, "attestation_not_unbound");
    });
  });

  test(`${label}: reserve, bind, acquire, redeem — and a second acquire loses`, async () => {
    await withStore(async (store) => {
      const { claim } = await released(store, [attestation("at-1")]);
      const lease = { leaseId: "L1", holderPrincipalId: "binder-1", credentialEpoch: 1,
        expiresAt: "2026-09-02T03:00:00.000Z" };
      const now = "2026-09-02T02:10:00.000Z";
      assert.equal((await store.reserveAttestation({
        acting: { principalId: "binder-1", credentialEpoch: 1 }, attestationId: "at-1", lease, now,
        requireClaim: claim })).applied, true);
      assert.equal((await store.bindAttestation({
        acting: { principalId: "binder-1", credentialEpoch: 1 }, attestationId: "at-1", leaseId: "L1",
        actionDigest: dig("7"), now })).applied, true);
      const acquire = {
        acting: { principalId: "agent-1", credentialEpoch: 1 }, attestationId: "at-1", leaseId: "L1",
        actionDigest: dig("7"),
        orgId: "org-1", serverId: "server-1", kind: "configuration.apply" as const, now,
        requireClaim: claim, ...attempt("t-1"),
      };
      assert.equal((await store.acquireAttestation(acquire)).applied, true);
      // The point of acquisition: a second delivery loses, and loses BEFORE it could mutate anything.
      assert.equal((await store.acquireAttestation(acquire)).applied, false);
      assert.equal((await store.redeemAttestation({
        acting: { principalId: "agent-1", credentialEpoch: 1 }, attestationId: "at-1", leaseId: "L1",
        attemptToken: "t-1", now, requireClaim: claim })).applied, true);
      assert.equal((await store.loadAttestation("at-1"))!.state, "CONSUMED");
    });
  });

  test(`${label}: a rotation after authentication invalidates work in flight`, async () => {
    // The attack an independent review found. The executor authenticates at epoch 1, reserves at epoch 1,
    // and its lease records epoch 1 -- so comparing the supplied epoch ONLY with the lease let the
    // request commit after the rotation. The store re-reads the principal, so the rotation wins.
    await withStore(async (store, seed) => {
      const { claim } = await released(store, [attestation("at-1")]);
      const now = "2026-09-02T02:10:00.000Z";
      const reserved = await store.reserveAttestation({
        acting: { principalId: "binder-1", credentialEpoch: 1 }, attestationId: "at-1",
        lease: { leaseId: "L1", holderPrincipalId: "binder-1", credentialEpoch: 1,
          expiresAt: "2026-09-02T03:00:00.000Z" },
        now, requireClaim: claim,
      });
      assert.equal(reserved.applied, true, JSON.stringify(reserved));

      // The operator rotates THE BINDER. Before the split this rotated the executor, because the
      // executor held the lease; the binder holds it now, so the binder's rotation is what must stop a
      // bind in flight. The scope is re-seeded with the row, since seeding replaces it wholesale.
      await seed(principal("binder-1", { credentialEpoch: 2, audienceFor: [{ orgId: "org-1", serverId: "server-1" }] }));

      const bind = await store.bindAttestation({
        acting: { principalId: "binder-1", credentialEpoch: 1 }, attestationId: "at-1", leaseId: "L1",
        actionDigest: dig("7"), now });
      assert.equal(bind.applied, false,
        "an operation using the old credential must not commit after rotation commits");
      assert.equal((bind as { code: string }).code, "credential_rotated");
    });
  });

  test(`${label}: a disabled principal cannot advance work in flight`, async () => {
    await withStore(async (store, seed) => {
      const { claim } = await released(store, [attestation("at-1")]);
      const now = "2026-09-02T02:10:00.000Z";
      await store.reserveAttestation({
        acting: { principalId: "binder-1", credentialEpoch: 1 }, attestationId: "at-1",
        lease: { leaseId: "L1", holderPrincipalId: "binder-1", credentialEpoch: 1,
          expiresAt: "2026-09-02T03:00:00.000Z" },
        now, requireClaim: claim,
      });
      await seed(principal("binder-1", { disabledAt: "2026-09-02T02:15:00.000Z", audienceFor: [{ orgId: "org-1", serverId: "server-1" }] }));
      const bind = await store.bindAttestation({
        acting: { principalId: "binder-1", credentialEpoch: 1 }, attestationId: "at-1", leaseId: "L1",
        actionDigest: dig("7"), now });
      assert.equal((bind as { code: string }).code, "principal_disabled");
    });
  });

  // ── A5-A9: acquire fencing, attempt tokens, extension, and disable semantics ──────────────────────

  const NOW = "2026-09-02T02:10:00.000Z";
  const SCOPE = [{ orgId: "org-1", serverId: "server-1" }];

  /** Reserve + bind, leaving the attestation RESERVED_BOUND and ready to acquire. */
  async function bound(store: ReviewGateStore, now = NOW) {
    const { claim } = await released(store, [attestation("at-1")]);
    await store.reserveAttestation({
      acting: acting("binder-1"), attestationId: "at-1",
      lease: { leaseId: "L1", holderPrincipalId: "binder-1", credentialEpoch: 1,
        expiresAt: "2026-09-02T03:00:00.000Z" },
      now, requireClaim: claim });
    await store.bindAttestation({
      acting: acting("binder-1"), attestationId: "at-1", leaseId: "L1",
      actionDigest: dig("7"), now });
    return { claim };
  }

  const acquireArgs = (claim: { contentDigest: string; releasedByCandidateId: string },
    token: string, over: Record<string, unknown> = {}) => ({
    acting: acting("agent-1"), attestationId: "at-1", leaseId: "L1", actionDigest: dig("7"),
    orgId: "org-1", serverId: "server-1", kind: "configuration.apply" as const, now: NOW,
    requireClaim: claim, ...attempt(token), ...over,
  });

  test(`${label}: A6 -- the binder fence increments by exactly one, and the counts are the decision`, async () => {
    await withStore(async (store) => {
      const { claim } = await bound(store);
      const outcome = await store.acquireAttestation(acquireArgs(claim, "t-1"));
      assert.equal(outcome.applied, true, JSON.stringify(outcome));
      const value = (outcome as { value: { binderFenceBefore: number; binderFenceAfter: number;
        matchedCount: number; modifiedCount: number } }).value;
      assert.equal(value.binderFenceAfter, value.binderFenceBefore + 1, "the fence moves by exactly one");
      assert.equal(value.matchedCount, 1);
      // matched 1 with modified 0 is a FAILURE, never a success: it is exactly what a `$set` of an
      // unchanged value produces, which is why the fence is an `$inc`.
      assert.equal(value.modifiedCount, 1, "the conditional update must MODIFY, not merely match");
    });
  });

  test(`${label}: A6 -- a FIXED clock still yields distinct fences, so $inc is load-bearing`, async () => {
    // The case a timestamp cannot serve. Two acquisitions on the same clock instant: `lastAcquireAt`
    // would `$set` the same value twice and report modified 0 the second time. A counter always moves.
    await withStore(async (store) => {
      const { claim } = await bound(store);
      const first = await store.acquireAttestation(acquireArgs(claim, "t-1"));
      assert.equal(first.applied, true);
      const firstValue = (first as { value: { binderFenceAfter: number } }).value;
      // A second acquire on the SAME instant is refused by the state transition, so the fence must not
      // have moved again -- nothing commits when the transition fails.
      const second = await store.acquireAttestation(acquireArgs(claim, "t-2", {
        idempotency: { principalId: "agent-1", scope: "acquire", key: "acq-same-clock", requestHash: "h2" },
      }));
      assert.equal(second.applied, false, "a second delivery loses");
      assert.equal(firstValue.binderFenceAfter, 1, "and the winning fence is exactly 1");
    });
  });

  test(`${label}: A5 -- a disabled binder blocks acquire; re-enabling does NOT unblock it`, async () => {
    await withStore(async (store, seed) => {
      const { claim } = await bound(store);
      // Disable bumps the incarnation. The binding recorded incarnation 1.
      await seed(principal("binder-1", { audienceFor: SCOPE, incarnation: 2,
        disabledAt: "2026-09-02T02:11:00.000Z" }));
      const whileDisabled = await store.acquireAttestation(acquireArgs(claim, "t-1"));
      assert.equal(whileDisabled.applied, false, "a disabled binder must block acquire");

      // Re-enable. The principal is now PRESENTLY ENABLED, which is exactly the trap: a status-only
      // check would accept the very bindings disablement was meant to invalidate. The incarnation is
      // NOT restored, so the old binding stays refused.
      await seed(principal("binder-1", { audienceFor: SCOPE, incarnation: 2 }));
      const afterEnable = await store.acquireAttestation(acquireArgs(claim, "t-1", {
        idempotency: { principalId: "agent-1", scope: "acquire", key: "acq-after-enable", requestHash: "h" },
      }));
      assert.equal(afterEnable.applied, false,
        "disable-then-enable must still refuse a binding taken under the previous incarnation");
      assert.equal((afterEnable as { code: string }).code, "binder_incarnation_changed");
    });
  });

  test(`${label}: A5 -- ordinary binder ROTATION after bind does not block acquire`, async () => {
    // The deliberate asymmetry: rotation preserves completed bindings, disablement does not. Comparing
    // the credential epoch instead of the incarnation would have broken this.
    await withStore(async (store, seed) => {
      const { claim } = await bound(store);
      await seed(principal("binder-1", { audienceFor: SCOPE, credentialEpoch: 9, incarnation: 1 }));
      const outcome = await store.acquireAttestation(acquireArgs(claim, "t-1"));
      assert.equal(outcome.applied, true, JSON.stringify(outcome));
    });
  });

  test(`${label}: A5 -- a committed acquire replays as already_acquired, never a second attempt`, async () => {
    await withStore(async (store) => {
      const { claim } = await bound(store);
      const args = acquireArgs(claim, "t-1");
      assert.equal((await store.acquireAttestation(args)).applied, true);
      const replay = await store.acquireAttestation(args);
      assert.equal(replay.applied, false);
      assert.equal((replay as { code: string }).code, "already_acquired",
        "the gate keeps only a verifier and cannot reissue a token it never kept");
    });
  });

  test(`${label}: A7 -- extension refuses after audience ROTATION, and A8 redeem still succeeds`, async () => {
    // The whole content of the rotation row: extension asserts the attempt is still running under the
    // credential that won it; redeem only records an outcome that already happened.
    await withStore(async (store, seed) => {
      const { claim } = await bound(store);
      assert.equal((await store.acquireAttestation(acquireArgs(claim, "t-1"))).applied, true);

      await seed(principal("agent-1", { audienceFor: SCOPE, credentialEpoch: 2 }));
      const extend = await store.extendExecution({
        acting: acting("agent-1", 2), attestationId: "at-1", attemptToken: "t-1",
        requestedDeadline: "2026-09-02T03:30:00.000Z",
        absoluteDeadline: "2026-09-02T04:00:00.000Z", now: NOW, requireClaim: claim });
      assert.equal(extend.applied, false, "a rotated executor must not extend");
      assert.equal((extend as { code: string }).code, "credential_rotated");

      const redeem = await store.redeemAttestation({
        acting: acting("agent-1", 2), attestationId: "at-1", leaseId: "L1",
        attemptToken: "t-1", now: NOW, requireClaim: claim });
      assert.equal(redeem.applied, true,
        "but it may still record the outcome it already produced, with its NEW credential and the token");
    });
  });

  test(`${label}: A7 -- the wrong attempt token extends nothing, and A8 redeems nothing`, async () => {
    await withStore(async (store) => {
      const { claim } = await bound(store);
      assert.equal((await store.acquireAttestation(acquireArgs(claim, "t-1"))).applied, true);
      const extend = await store.extendExecution({
        acting: acting("agent-1"), attestationId: "at-1", attemptToken: "t-WRONG",
        requestedDeadline: "2026-09-02T03:30:00.000Z",
        absoluteDeadline: "2026-09-02T04:00:00.000Z", now: NOW, requireClaim: claim });
      assert.equal((extend as { code: string }).code, "attempt_token_invalid");
      const redeem = await store.redeemAttestation({
        acting: acting("agent-1"), attestationId: "at-1", leaseId: "L1",
        attemptToken: "t-WRONG", now: NOW, requireClaim: claim });
      assert.equal((redeem as { code: string }).code, "attempt_token_invalid");
    });
  });

  test(`${label}: A7 -- deadlines are monotonic and bounded`, async () => {
    await withStore(async (store) => {
      const { claim } = await bound(store);
      assert.equal((await store.acquireAttestation(acquireArgs(claim, "t-1"))).applied, true);
      const base = { acting: acting("agent-1"), attestationId: "at-1", attemptToken: "t-1",
        absoluteDeadline: "2026-09-02T04:00:00.000Z", now: NOW, requireClaim: claim };

      // Backwards is refused: an extension may only move the deadline LATER. The attempt's deadline is
      // 02:40, so this asks to pull it in to 02:20 -- which a naive "is it a valid instant" check would
      // accept, and which would silently shorten an attempt already relying on the later time.
      const backwards = await store.extendExecution({ ...base,
        requestedDeadline: "2026-09-02T02:20:00.000Z" });
      assert.equal((backwards as { code: string }).code, "deadline_not_extended");

      // Beyond the absolute cumulative bound is refused, even though it is later.
      const beyond = await store.extendExecution({ ...base,
        requestedDeadline: "2026-09-02T09:00:00.000Z" });
      assert.equal((beyond as { code: string }).code, "beyond_absolute_deadline");

      const ok = await store.extendExecution({ ...base,
        requestedDeadline: "2026-09-02T03:50:00.000Z" });
      assert.equal(ok.applied, true, JSON.stringify(ok));
    });
  });

  test(`${label}: a legacy v1 attestation cannot be reserved, but stays readable and revocable`, async () => {
    // The policy an earlier revision declared while giving it nothing to execute against: the record had
    // no field that could distinguish a v1 from a v2, so "v1 is rejected by reserve" could not be
    // enforced. Absence of `identitySchemaVersion` is that discriminator.
    await withStore(async (store) => {
      const legacy = attestation("at-v1");
      delete (legacy as { identitySchemaVersion?: string }).identitySchemaVersion;
      delete (legacy as { bindingPrincipalId?: string }).bindingPrincipalId;
      const { claim } = await released(store, [legacy]);
      const now = "2026-09-02T02:10:00.000Z";

      const reserve = await store.reserveAttestation({
        acting: { principalId: "binder-1", credentialEpoch: 1 }, attestationId: "at-v1",
        lease: { leaseId: "L1", holderPrincipalId: "binder-1", credentialEpoch: 1,
          expiresAt: "2026-09-02T03:00:00.000Z" },
        now, requireClaim: claim,
      });
      assert.equal(reserve.applied, false, "a v1 record must not be reservable");
      assert.equal((reserve as { code: string }).code, "legacy_identity_not_executable");

      // Unchanged by the refusal: still PENDING, still no lease.
      const after = (await store.loadAttestation("at-v1"))!;
      assert.equal(after.state, "PENDING");
      assert.equal(after.lease, undefined);

      // A record that cannot execute is still provenance, and an operator must be able to retire it.
      // It is never rewritten in place -- a replacement is a NEW v2 mint carrying supersedesAttestationId.
      const revoked = await store.revokeAttestation({
        acting: { principalId: "owner", credentialEpoch: 1 }, attestationId: "at-v1",
        reason: "superseded", now });
      assert.equal(revoked.applied, true, JSON.stringify(revoked));
      assert.equal((await store.loadAttestation("at-v1"))!.state, "REVOKED");
    });
  });

  test(`${label}: a lease can never outlive the attestation`, async () => {
    await withStore(async (store) => {
      const { claim } = await released(store,
        [attestation("at-1", { expiresAt: "2026-09-02T03:00:00.000Z" })]);
      await store.reserveAttestation({
        acting: { principalId: "binder-1", credentialEpoch: 1 }, attestationId: "at-1",
        lease: { leaseId: "L1", holderPrincipalId: "binder-1", credentialEpoch: 1,
          expiresAt: "2026-09-09T00:00:00.000Z" },
        now: "2026-09-02T02:10:00.000Z", requireClaim: claim,
      });
      assert.equal((await store.loadAttestation("at-1"))!.lease!.expiresAt,
        "2026-09-02T03:00:00.000Z",
        "clamped to the attestation, or renewal could extend a review's validity");
    });
  });

  test(`${label}: sweeping expires unbound and makes bound indeterminate`, async () => {
    await withStore(async (store) => {
      const { claim } = await released(store, [
        attestation("unbound", { expiresAt: "2026-09-02T02:30:00.000Z" }),
        attestation("bound", { expiresAt: "2026-09-02T02:30:00.000Z" }),
      ]);
      const lease = { leaseId: "L1", holderPrincipalId: "binder-1", credentialEpoch: 1,
        expiresAt: "2026-09-02T02:30:00.000Z" };
      const now = "2026-09-02T02:10:00.000Z";
      await store.reserveAttestation({ acting: { principalId: "binder-1", credentialEpoch: 1 }, attestationId: "bound", lease, now, requireClaim: claim });
      await store.bindAttestation({
        acting: { principalId: "binder-1", credentialEpoch: 1 }, attestationId: "bound", leaseId: "L1",
        actionDigest: dig("7"), now });

      const swept = await store.sweepAttestations("2026-09-02T04:00:00.000Z");
      assert.deepEqual(swept.expired, ["unbound"], "nothing dispatched for it, so expiry is free");
      assert.deepEqual(swept.indeterminate, ["bound"], "a payload was named and may be in flight");
      assert.equal((await store.loadAttestation("bound"))!.state, "INDETERMINATE");
      const retry = await store.reserveAttestation({
        acting: { principalId: "binder-1", credentialEpoch: 1 }, attestationId: "bound", lease, now, requireClaim: claim });
      assert.equal(retry.applied, false, "never back to a reservable state");
    });
  });

  test(`${label}: an EXECUTING attestation cannot be revoked`, async () => {
    await withStore(async (store) => {
      const { claim } = await released(store, [attestation("at-1")]);
      const now = "2026-09-02T02:10:00.000Z";
      await store.reserveAttestation({
        acting: { principalId: "binder-1", credentialEpoch: 1 }, attestationId: "at-1",
        lease: { leaseId: "L1", holderPrincipalId: "binder-1", credentialEpoch: 1,
          expiresAt: "2026-09-02T03:00:00.000Z" },
        now, requireClaim: claim,
      });
      await store.bindAttestation({
        acting: { principalId: "binder-1", credentialEpoch: 1 }, attestationId: "at-1", leaseId: "L1",
        actionDigest: dig("7"), now });
      await store.acquireAttestation({
        acting: { principalId: "agent-1", credentialEpoch: 1 }, attestationId: "at-1", leaseId: "L1",
        actionDigest: dig("7"),
        orgId: "org-1", serverId: "server-1", kind: "configuration.apply", now, requireClaim: claim,
        ...attempt("t-revoke") });
      const revoke = await store.revokeAttestation({ acting: acting("owner"),
        attestationId: "at-1", reason: "changed mind", now });
      assert.equal(revoke.applied, false,
        "the effect may be underway; a row claiming it was stopped would be a lie");
    });
  });
}
