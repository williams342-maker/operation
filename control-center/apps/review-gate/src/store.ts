import type { ReviewAction } from "./actions.js";
import type { CandidateBinding, Participant, ReviewState } from "./policy.js";
import type { AttestationKind, AttestationRecord, AttestationState, Lease, Reconciliation }
  from "./attestation.js";

// The persistence port.
//
// WHY THE SHAPE CHANGED. The previous store exposed `create(record)` and
// `compareAndSetState({expectedState, nextState})` — general-purpose primitives that write whatever they
// are given. An independent review pointed out that this is a policy-free lifecycle mutation: anyone
// holding the store could walk BUILT -> ... -> READY_FOR_OWNER_DECISION with no evidence, no reviewer, and
// no verdict. Removing the class from a package index did not help, because the service handed the same
// object out through a property, and then handed its write capability to a caller-supplied wrapper.
//
// So there are no primitives here. EVERY METHOD IS ONE TRANSACTION WITH ONE POSTCONDITION, named for the
// operation it performs. There is no method that means "put this candidate in that state", so no caller —
// however it obtained the store — can express one.
//
// The service still enforces policy (independence, evidence, findings, reviewer class). The store enforces
// the STRUCTURAL invariants that policy cannot: claim uniqueness, monotonic rejection, compare-and-set,
// idempotency, and the attestation state machine.

export type CandidateRecord = {
  candidateId: string;
  digest: string;
  contentDigest: string;
  binding: CandidateBinding;
  state: ReviewState;
  supersedes?: string;
  supersededAt?: string;
  remediates?: readonly string[];
  inherited?: ReadonlyArray<FindingOccurrence>;
  /**
   * The reviewer who claimed this review.
   *
   * Recorded SEPARATELY from participation, because claiming must grant no role -- an earlier design
   * wrote a requester row for whoever performed the move, and a stranger used that to self-enrol,
   * cancel the candidate and supersede it, entirely through legal moves. This field lets the verdict
   * require the recorded claimant without that move conferring anything.
   */
  claimedByPrincipalId?: string;
  participants: Participant[];
  occurrences: TransitionOccurrence[];
  verdicts: StoredVerdict[];
};

/**
 * A finding with a GATE-GENERATED occurrence id.
 *
 * Design v7 §8.5: discharge used to reference the reviewer's chosen label, so two candidates reusing an id
 * for unrelated defects conflated them. The label survives for display; identity is the occurrence.
 */
export type FindingOccurrence = {
  occurrenceId: string;
  label: string;
  severity: string;
  summary: string;
  raisedInVerdictId: string;
};

export type StoredVerdict = {
  verdictId: string;
  reviewerIdentity: string;
  verdict: "GO" | "NO_GO";
  findings: readonly FindingOccurrence[];
  /** Occurrence ids this reviewer discharged. Only a verdict can discharge. */
  resolves: readonly string[];
  submittedAt: string;
  at: string;
};

export type TransitionOccurrence = {
  occurrenceId: string;
  from: ReviewState;
  to: ReviewState;
  actorIdentity: string;
  billingClass: string;
  at: string;
};

export type EvidenceRecord = {
  evidenceId: string;
  candidateId: string;
  resultDigest: string;
  runnerIdentity: string;
  runReference: string;
  contentDigest: string;
  recordedBy: string;
  at: string;
};

export type ClaimDisposition = "LIVE" | "RELEASED" | "REJECTED";

export type ContentClaim = {
  contentDigest: string;
  disposition: ClaimDisposition;
  liveCandidateId?: string;
  releasedByCandidateId?: string;
  rejectedByCandidateId?: string;
  releasedAt?: string;
  rejectedAt?: string;
};

export type Principal = {
  principalId: string;
  displayName: string;
  credentialHash: string;
  reviewerClasses: readonly string[];
  roles: readonly string[];
  /**
   * The targets this principal may act on. Named for the SCOPE, not for one of the roles that uses it:
   * the checklist requires role-neutral naming here and `audienceFor` was neither -- the same field
   * scopes binders, who are not an audience of anything.
   */
  targetScopes?: ReadonlyArray<{ orgId: string; serverId: string }>;
  /**
   * @deprecated The pre-rename spelling. Still READ, because rows written before the rename carry it
   * and dropping it would silently unscope every existing principal.
   *
   * That failure would be CLOSED, not open -- an empty scope list refuses every target rather than
   * granting one, so nothing would have been exposed. I described it the other way round and an
   * independent review corrected me; the reason to keep reading the field is that a fleet of principals
   * refusing every host is an outage, not that it would have been a hole. Never written.
   */
  audienceFor?: ReadonlyArray<{ orgId: string; serverId: string }>;
  /** MONOTONIC INTEGER. Not a timestamp — two rotations in one clock tick must be distinguishable. */
  credentialEpoch: number;
  /**
   * MONOTONIC. Incremented on DISABLE only, never on rotation. Absent is read as 1, so rows provisioned
   * before this field existed behave as a first incarnation rather than failing closed on every acquire.
   *
   * Disable-then-re-enable therefore invalidates bindings taken under the previous incarnation, while an
   * ordinary rotation leaves them alone. That asymmetry is the policy, not an accident of the encoding.
   */
  incarnation?: number;
  /**
   * THE CONFLICT PRIMITIVE for acquire, and it must be `$inc` rather than a timestamp.
   *
   * Acquire conditionally updates this row filtered on `{ disabledAt: null, incarnation }`; the matched
   * and modified counts ARE the decision. A `$set` of a timestamp is not equivalent: two acquisitions can
   * read the same clock, a fixed test clock reproduces one exactly, clock regression can rewrite it, and
   * MongoDB reports `matchedCount: 1, modifiedCount: 0` when `$set` writes a value already present. A
   * monotonic counter always modifies.
   *
   * On the canonical principal row deliberately -- serialising against disablement only works if both
   * operations contend on the same authoritative write target. Absent is read as 0.
   */
  acquireFence?: number;
  createdAt: string;
  disabledAt?: string;
};

/**
 * Who is acting, and the epoch their credential had when they authenticated.
 *
 * EVERY authenticated mutation carries this, not just the lease operations. An independent review found
 * revalidation had been added to reserve/bind/acquire/redeem/renew and to nothing else, so an owner or
 * reviewer request authenticated before a rotation or a disablement could still commit afterwards. The
 * design's rule is general: no operation using an old credential commits after rotation commits.
 *
 * It also removes the caller's freedom to choose an audit identity. `applyAction` used to take
 * `actorIdentity` separately, so the store contract permitted recording the occurrence, the
 * participation row and the claimant under a name unrelated to whoever was acting.
 */
export type Acting = {
  principalId: string;
  credentialEpoch: number;
};

/** What every store method returns: applied, or refused with a reason the caller can act on. */
export type Applied<T = undefined> =
  | { applied: true; value: T }
  | { applied: false; code: string };

export const refused = (code: string): Applied<never> => ({ applied: false, code });
export const applied = <T>(value: T): Applied<T> => ({ applied: true, value });

/**
 * The transaction boundaries of design v7 §8.3, one method each.
 *
 * A Mongo implementation runs each of these in a session transaction and REQUIRES A REPLICA SET. The
 * in-memory reference satisfies them by never awaiting mid-operation.
 */
export interface ReviewGateStore {
  // ── reads ───────────────────────────────────────────────────────────────────────────────────────
  loadCandidate(candidateId: string): Promise<CandidateRecord | null>;
  loadEvidence(candidateId: string): Promise<EvidenceRecord[]>;
  loadClaim(contentDigest: string): Promise<ContentClaim | null>;
  loadAttestation(attestationId: string): Promise<AttestationRecord | null>;
  loadPrincipalByCredentialHash(hash: string): Promise<Principal | null>;
  loadPrincipalById(principalId: string): Promise<Principal | null>;

  // ── candidate lifecycle ─────────────────────────────────────────────────────────────────────────

  /** Claim the content and insert the candidate, or neither. */
  registerCandidate(input: {
    acting: Acting;
    record: CandidateRecord;
    idempotency: IdempotencyKey;
  }): Promise<Applied<{ candidateId: string }>>;

  /**
   * Two claim documents in one transaction: the predecessor releases its own digest (or keeps a REJECTED
   * one, which is monotonic), and the successor claims its different digest.
   *
   * A review round found the previous version modelled this as a transfer on ONE document — incoherent,
   * because the differing digest is exactly what makes it a successor.
   */
  createSuccessor(input: {
    acting: Acting;
    predecessorId: string;
    /** Must arrive at BUILT with no history, exactly like a registration. */
    successor: CandidateRecord;
    inherited: readonly FindingOccurrence[];
    at: string;
    idempotency: IdempotencyKey;
  }): Promise<Applied<{ candidateId: string }>>;

  recordEvidence(input: {
    acting: Acting;
    evidence: EvidenceRecord;
    idempotency: IdempotencyKey;
  }): Promise<Applied<undefined>>;

  /**
   * One NAMED lifecycle action. The store derives the transition, the participation row, the claimant
   * record and the claim release from the action itself.
   *
   * IT USED TO TAKE `expectedState` AND `nextState`, and an independent review was right that this was
   * the round-8 primitive under another name: a holder could request any graph-legal state change while
   * also choosing the audit identity, the participation row, the claimant assignment and whether to
   * release the content claim. Checking the transition graph does not make something a named operation.
   *
   * Now the ONLY thing a caller supplies is which action, from ACTIONS. There is no argument that means
   * "put this candidate in that state".
   */
  applyAction(input: {
    acting: Acting;
    candidateId: string;
    action: ReviewAction;
    billingClass: string;
    at: string;
    occurrenceId: string;
    idempotency: IdempotencyKey;
  }): Promise<Applied<undefined>>;

  /** The verdict, its finding occurrences, and the claim disposition it implies, together or not at all. */
  applyVerdict(input: {
    acting: Acting;
    candidateId: string;
    expectedState: ReviewState;
    nextState: ReviewState;
    occurrence: TransitionOccurrence;
    verdict: StoredVerdict;
    addParticipant: Participant;
    /** GO requires the claim to still be un-rejected AT COMMIT, not merely when the caller looked. */
    requireContentNotRejected?: string;
    /** NO_GO writes the rejection in the same step that commits it. */
    rejectContent?: string;
    idempotency: IdempotencyKey;
  }): Promise<Applied<undefined>>;

  // ── owner decision and attestations ─────────────────────────────────────────────────────────────

  /**
   * Accept the review outcome: claim -> RELEASED, and mint UNBOUND attestations.
   *
   * No payload and no actionDigest here. Binding those at mint is what made an earlier revision circular.
   */
  recordOwnerDecision(input: {
    acting: Acting;
    candidateId: string;
    expectedState: ReviewState;
    occurrence: TransitionOccurrence;
    contentDigest: string;
    attestations: readonly AttestationRecord[];
    at: string;
    idempotency: IdempotencyKey;
  }): Promise<Applied<{ attestationIds: string[] }>>;

  /**
   * Every credential-sensitive method takes the ACTING PRINCIPAL'S ID, not just an epoch the caller
   * captured at authentication time.
   *
   * An independent review found that comparing the supplied epoch only with the epoch stored in the
   * lease let a request authenticated before a rotation commit after it: lease epoch 1 equals supplied
   * epoch 1, and the rotation to epoch 2 was never consulted. The design rule is that no operation using
   * the old credential may commit after rotation commits, so the CURRENT principal is read inside the
   * same transaction as the mutation.
   */
  /** Mint further attestations from content that is already RELEASED. */
  /**
   * Mint further attestations from content that is already RELEASED.
   *
   * The store checks that precondition itself. It used to validate only that the attestations were
   * unbound and trust the service's earlier read — a named operation that does not enforce its own
   * documented postcondition is a comment, not a contract.
   */
  mintAttestations(input: {
    acting: Acting;
    candidateId: string;
    attestations: readonly AttestationRecord[];
    idempotency: IdempotencyKey;
  }): Promise<Applied<{ attestationIds: string[] }>>;

  reserveAttestation(input: {
    acting: Acting;
    attestationId: string;
    lease: Lease;
    now: string;
    /** Checked inside the transaction: RELEASED and released by this attestation's candidate. */
    requireClaim: { contentDigest: string; releasedByCandidateId: string };
  }): Promise<Applied<undefined>>;

  /** Write the validated payload's digest exactly once. Never re-bound. */
  bindAttestation(input: {
    acting: Acting;
    attestationId: string;
    leaseId: string;
    actionDigest: string;
    now: string;
  }): Promise<Applied<undefined>>;

  /**
   * Take execution BEFORE the host is mutated. Exactly one caller wins.
   *
   * This is a mutation, not a query, and that is the whole point: a predicate the executor consults and
   * then acts on is a check/use race by construction.
   */
  acquireAttestation(input: {
    acting: Acting;
    attestationId: string;
    leaseId: string;
    actionDigest: string;
    orgId: string;
    serverId: string;
    kind: AttestationKind;
    now: string;
    requireClaim: { contentDigest: string; releasedByCandidateId: string };
    /**
     * A VERIFIER of the attempt token. The caller mints the token, keeps the plaintext in exactly one
     * local variable, and hands the store only this. The store never receives or stores the plaintext.
     */
    attemptTokenVerifier: string;
    /** `min(acquiredAt + configuredMaximumExecutionDuration, attestation.expiresAt)` is the caller's. */
    executionDeadline: string;
    /**
     * Bound to the acting principal, this attestation, the lease, the action digest and a hash of the
     * whole request -- NOT the shared principal identity, which every process of that executor has.
     */
    idempotency: IdempotencyKey;
  }): Promise<Applied<AcquireOutcome>>;

  /**
   * Extend a live attempt. NOT the pre-acquire lease renewal: the two assert different things, and
   * reusing the lease operation was the mistake round 5 caught.
   */
  extendExecution(input: {
    acting: Acting;
    attestationId: string;
    /** Verified in constant time against the stored verifier. */
    attemptToken: string;
    requestedDeadline: string;
    /** Absolute cumulative bound; the store refuses beyond it. */
    absoluteDeadline: string;
    now: string;
    requireClaim: { contentDigest: string; releasedByCandidateId: string };
  }): Promise<Applied<{ executionDeadline: string }>>;

  redeemAttestation(input: {
    acting: Acting;
    attestationId: string;
    leaseId: string;
    /** Verified in constant time. Redeem needs the CURRENT credential plus this -- see AcquireOutcome. */
    attemptToken: string;
    now: string;
    requireClaim: { contentDigest: string; releasedByCandidateId: string };
  }): Promise<Applied<undefined>>;

  renewLease(input: {
    acting: Acting;
    attestationId: string;
    leaseId: string;
    requestedExpiresAt: string;
    now: string;
  }): Promise<Applied<{ expiresAt: string }>>;

  revokeAttestation(input: {
    acting: Acting;
    attestationId: string;
    reason: string;
    now: string;
  }): Promise<Applied<undefined>>;

  resolveIndeterminate(input: {
    acting: Acting;
    attestationId: string;
    reconciliation: Reconciliation;
    nextState: Extract<AttestationState, "CONSUMED" | "ABORTED">;
    now: string;
  }): Promise<Applied<undefined>>;

  // ── sweeps ──────────────────────────────────────────────────────────────────────────────────────

  /** UNBOUND attestations expire harmlessly; BOUND ones become INDETERMINATE. Never reservable again. */
  sweepAttestations(now: string): Promise<{ expired: string[]; indeterminate: string[] }>;
}

/**
 * What acquire observed, so both stores expose the SAME decision.
 *
 * The Mongo store's conditional binder-row update reports driver counts; the memory store has none, so it
 * reports the equivalent. `matchedCount === 1 && modifiedCount === 0` is a FAILURE, never a success --
 * that is precisely what a `$set` of an unchanged timestamp produces, which is why the fence is an
 * `$inc`. Tests assert all four fields rather than inferring them.
 */
export type AcquireOutcome = {
  binderFenceBefore: number;
  binderFenceAfter: number;
  matchedCount: number;
  modifiedCount: number;
};

export type IdempotencyKey = {
  principalId: string;
  scope: string;
  key: string;
  /** Canonical hash of the request. A repeat with a different hash is an error, not a replay. */
  requestHash: string;
};
