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
  audienceFor?: ReadonlyArray<{ orgId: string; serverId: string }>;
  /** MONOTONIC INTEGER. Not a timestamp — two rotations in one clock tick must be distinguishable. */
  credentialEpoch: number;
  createdAt: string;
  disabledAt?: string;
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

  // ── candidate lifecycle ─────────────────────────────────────────────────────────────────────────

  /** Claim the content and insert the candidate, or neither. */
  registerCandidate(input: {
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
    predecessorId: string;
    successor: CandidateRecord;
    inherited: readonly FindingOccurrence[];
    at: string;
    idempotency: IdempotencyKey;
  }): Promise<Applied<{ candidateId: string }>>;

  recordEvidence(input: {
    evidence: EvidenceRecord;
    idempotency: IdempotencyKey;
  }): Promise<Applied<undefined>>;

  /** One named lifecycle move, with its occurrence and any participation row it necessarily creates. */
  applyAction(input: {
    candidateId: string;
    expectedState: ReviewState;
    nextState: ReviewState;
    occurrence: TransitionOccurrence;
    addParticipant?: Participant;
    /** Set when the move releases the content claim (cancel / expire). */
    releaseClaim?: boolean;
    idempotency: IdempotencyKey;
  }): Promise<Applied<undefined>>;

  /** The verdict, its finding occurrences, and the claim disposition it implies, together or not at all. */
  applyVerdict(input: {
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
    candidateId: string;
    expectedState: ReviewState;
    occurrence: TransitionOccurrence;
    contentDigest: string;
    attestations: readonly AttestationRecord[];
    at: string;
    idempotency: IdempotencyKey;
  }): Promise<Applied<{ attestationIds: string[] }>>;

  reserveAttestation(input: {
    attestationId: string;
    lease: Lease;
    now: string;
    /** Checked inside the transaction: RELEASED and released by this attestation's candidate. */
    requireClaim: { contentDigest: string; releasedByCandidateId: string };
  }): Promise<Applied<undefined>>;

  /** Write the validated payload's digest exactly once. Never re-bound. */
  bindAttestation(input: {
    attestationId: string;
    leaseId: string;
    credentialEpoch: number;
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
    attestationId: string;
    leaseId: string;
    credentialEpoch: number;
    actionDigest: string;
    orgId: string;
    serverId: string;
    kind: AttestationKind;
    now: string;
    requireClaim: { contentDigest: string; releasedByCandidateId: string };
  }): Promise<Applied<undefined>>;

  redeemAttestation(input: {
    attestationId: string;
    leaseId: string;
    credentialEpoch: number;
    now: string;
    requireClaim: { contentDigest: string; releasedByCandidateId: string };
  }): Promise<Applied<undefined>>;

  renewLease(input: {
    attestationId: string;
    leaseId: string;
    credentialEpoch: number;
    requestedExpiresAt: string;
    now: string;
  }): Promise<Applied<{ expiresAt: string }>>;

  revokeAttestation(input: {
    attestationId: string;
    reason: string;
    now: string;
  }): Promise<Applied<undefined>>;

  resolveIndeterminate(input: {
    attestationId: string;
    reconciliation: Reconciliation;
    nextState: Extract<AttestationState, "CONSUMED" | "ABORTED">;
    now: string;
  }): Promise<Applied<undefined>>;

  // ── sweeps ──────────────────────────────────────────────────────────────────────────────────────

  /** UNBOUND attestations expire harmlessly; BOUND ones become INDETERMINATE. Never reservable again. */
  sweepAttestations(now: string): Promise<{ expired: string[]; indeterminate: string[] }>;
}

export type IdempotencyKey = {
  principalId: string;
  scope: string;
  key: string;
  /** Canonical hash of the request. A repeat with a different hash is an error, not a replay. */
  requestHash: string;
};
