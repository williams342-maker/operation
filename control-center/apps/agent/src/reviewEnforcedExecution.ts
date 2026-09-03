import { readReviewAuthorization, privilegedActionDigest } from "@control-center/shared";
import { ExecutionJournal, type JournalEntry } from "./executionJournal.js";
import type { ReviewGateClient } from "./reviewGateClient.js";

// The effect point: what happens immediately before and after a privileged action touches a host.
//
// THE ORDER HERE IS THE DESIGN, and it is worth reading as a sequence rather than as a list of checks:
//
//   1. the gate ACQUIRES  — a mutation, so exactly one delivery in the estate proceeds
//   2. the journal CLAIMS — a file, so exactly one attempt on THIS host proceeds, across restarts
//   3. the effect happens
//   4. the journal RECORDS the outcome
//   5. the gate REDEEMS
//
// Two winners are needed because two different things can go wrong. The gate stops a second delivery
// arriving from elsewhere; it cannot stop this executor applying twice across its own restart, because a
// database cannot fence a host. The journal stops that, and cannot stop anything else.
//
// Neither makes application atomic, and step 3 is deliberately not wrapped in anything that pretends
// otherwise. A crash between 3 and 4 leaves a STARTED entry with no outcome — the case a human
// reconciles, because guessing is worse than halting.

export type EnforcementRefusal = {
  refused: true;
  code: string;
  detail?: string;
};

export type Acquired = {
  refused: false;
  attestationId: string;
  leaseId: string;
  actionDigest: string;
};

export type EnforcedOutcome = Acquired | EnforcementRefusal;

const refuse = (code: string, detail?: string): EnforcementRefusal => ({ refused: true, code, detail });

/**
 * Take the right to act, from the gate and then from this host.
 *
 * The digest is computed HERE, from the payload about to be applied, with the same function layer 2
 * signs — so the gate is comparing what will actually happen against what was reviewed, rather than
 * against a value the control-center asserted.
 */
export async function acquireForEffect(input: {
  gate: ReviewGateClient;
  journal: ExecutionJournal;
  payload: unknown;
  taskType: string;
  orgId: string;
  serverId: string;
  at: string;
}): Promise<EnforcedOutcome> {
  const reference = readReviewAuthorization(input.payload);
  if (!reference) {
    return refuse("review_authorization_missing",
      "an enforcing executor requires the payload to name an attestation and a lease");
  }
  const actionDigest = privilegedActionDigest(input.payload);

  // THE GATE FIRST. It is the scarce resource and the authority: if it refuses, nothing local should be
  // written, or a refusal would poison this host's journal for an action that never had permission.
  const acquired = await input.gate.acquire({
    attestationId: reference.attestationId,
    leaseId: reference.leaseId,
    actionDigest,
    orgId: input.orgId,
    serverId: input.serverId,
    kind: input.taskType,
  });
  if (!acquired.ok) return refuse(acquired.code, acquired.detail);

  // THEN THIS HOST. The gate has now moved the attestation to EXECUTING, so if the local claim refuses,
  // the attestation is deliberately LEFT there: it will become INDETERMINATE and require reconciliation.
  // That is the honest outcome — the journal says this host may already have applied this action, and
  // nothing here is entitled to decide that it did not.
  const claim = input.journal.claim({
    actionDigest,
    attestationId: reference.attestationId,
    leaseId: reference.leaseId,
    serverId: input.serverId,
    at: input.at,
  });
  if (!claim.claimed) {
    return refuse(
      claim.reason === "already_applied" ? "already_applied_on_this_host" : "prior_attempt_unresolved",
      describeEntry(claim.entry),
    );
  }
  return { refused: false, attestationId: reference.attestationId, leaseId: reference.leaseId, actionDigest };
}

/**
 * Record what happened, then tell the gate.
 *
 * THE JOURNAL IS WRITTEN FIRST, always. It is the only durable record that this host attempted the
 * action, and it is what a reconciliation is later compared against. If the redeem then fails, the
 * attestation is left for a human — a failed redeem does not un-apply anything, and pretending it does
 * by retrying blindly would be the worst available answer.
 */
export async function recordEffect(input: {
  gate: ReviewGateClient;
  journal: ExecutionJournal;
  acquired: Acquired;
  succeeded: boolean;
  terminalPhase?: string;
  postStateDigest?: string;
  error?: string;
  at: string;
}): Promise<{ redeemed: boolean; redeemCode?: string }> {
  input.journal.complete({
    actionDigest: input.acquired.actionDigest,
    outcome: input.succeeded ? "SUCCEEDED" : "FAILED",
    terminalPhase: input.terminalPhase,
    postStateDigest: input.postStateDigest,
    error: input.error,
    at: input.at,
  });
  const redeemed = await input.gate.redeem({
    attestationId: input.acquired.attestationId,
    leaseId: input.acquired.leaseId,
  });
  return redeemed.ok ? { redeemed: true } : { redeemed: false, redeemCode: redeemed.code };
}

function describeEntry(entry: JournalEntry): string {
  return `this host recorded attempt ${entry.attempt} as ${entry.outcome} at ${entry.startedAt}` +
    (entry.finishedAt ? `, finished ${entry.finishedAt}` : ", never finished");
}
