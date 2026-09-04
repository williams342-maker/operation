import { randomUUID } from "node:crypto";
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
  /**
   * SINGLE-DELIVERY SECRET. Held in memory for the life of the attempt and required to extend or redeem.
   * Never journalled, never logged, never included in a report: the gate keeps only a verifier, so a
   * durable copy here would defeat the reason for that.
   */
  attemptToken: string;
  executionDeadline: string;
};

export type EnforcedOutcome = Acquired | EnforcementRefusal;

const refuse = (code: string, detail?: string): EnforcementRefusal => ({ refused: true, code, detail });

/**
 * How long before the deadline to ask for more time, and how much more to ask for.
 *
 * The margin has to exceed a plausible round trip to the gate plus a retry, or the extension lands
 * after the deadline it was meant to move.
 */
const EXTENSION_MARGIN_MS = 5 * 60_000;
const EXTENSION_INCREMENT_MS = 15 * 60_000;

export type ExecutionKeeper = {
  /**
   * Stop extending, and WAIT for any request already in flight.
   *
   * Clearing the timer alone was not enough: once `tick()` had called the gate there was nothing to
   * cancel, so a request carrying the attempt token could still be in the air while settlement and
   * redeem ran. An independent review found that race. The keeper's life now genuinely ends before
   * the attempt's does.
   */
  stop: () => Promise<void>;
  /** Extensions the gate actually granted. */
  granted: () => number;
  /** Why the keeper stopped asking, if it did. */
  refusal: () => string | undefined;
  /** The deadline currently in force — the gate's answer, never this executor's request. */
  deadline: () => string;
};

/**
 * Hold a long execution's authorization open while the effect runs.
 *
 * THIS DID NOT EXIST. An independent review found the checklist's extension step untested; it was in
 * fact UNIMPLEMENTED on this side. The gate had a route, the store had a method and the client had a
 * caller — and nothing in the executor ever invoked any of them. `executionDeadline` was carried out
 * of `acquire`, put in a field, and never read. An execution that outran its window simply ran on with
 * an authorization that had lapsed, and nobody found out until redeem.
 *
 * The deadline tracked here is the one the GATE returned, not the one this executor asked for: the gate
 * clamps to the attestation's validity and to an absolute cumulative bound, so a keeper that trusted
 * its own request would reschedule against time it had never been given.
 *
 * A REFUSED EXTENSION DOES NOT ABORT THE EFFECT, and that is a deliberate choice rather than an
 * oversight. By the time this runs the host is already being changed; interrupting a deployment part
 * way through is a worse outcome than finishing it and settling honestly. So the keeper stops asking,
 * records why, and lets the effect complete.
 *
 * WHAT THAT DOES NOT MEAN is that the overrun is then accepted. An earlier version of this comment
 * claimed redeem does not require an unexpired deadline; the checklist says the opposite, and redeem
 * did not check it either — so an effect that outran its window settled as CONSUMED and work performed
 * outside its authorized window was recorded as authorized. Redeem now refuses with
 * `execution_deadline_passed`, the attestation stays EXECUTING and becomes INDETERMINATE, and a human
 * reconciles it. Finishing the effect and refusing to certify it are not in tension: one is about the
 * host, the other about the record.
 */
export function keepExecutionAlive(input: {
  gate: Pick<ReviewGateClient, "extendExecution">;
  acquired: Acquired;
  marginMs?: number;
  incrementMs?: number;
}): ExecutionKeeper {
  const marginMs = input.marginMs ?? EXTENSION_MARGIN_MS;
  const incrementMs = input.incrementMs ?? EXTENSION_INCREMENT_MS;
  let deadline = input.acquired.executionDeadline;
  let granted = 0;
  let refusal: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  // The extension currently in flight, if any. `stop()` awaits it.
  let pending: Promise<void> | undefined;

  const schedule = () => {
    if (stopped) return;
    const delay = Math.max(0, Date.parse(deadline) - Date.now() - marginMs);
    timer = setTimeout(() => { pending = tick(); }, delay);
    // Never a reason for the process to stay alive: this timer exists only for the life of an effect
    // that something else is awaiting.
    timer.unref?.();
  };

  const tick = async () => {
    if (stopped) return;
    const requested = new Date(Date.now() + incrementMs).toISOString();
    const outcome = await input.gate.extendExecution({
      attestationId: input.acquired.attestationId,
      // The single-delivery token, from memory. It is the proof this is the winning attempt.
      attemptToken: input.acquired.attemptToken,
      requestedDeadline: requested,
    }).catch((error: Error) => ({ ok: false as const, code: "gate_unreachable", detail: error.message }));
    if (stopped) return;
    if (!outcome.ok) {
      // One refusal ends it. Asking again would either repeat a permanent answer — a rotated
      // credential, a spent attestation — or hammer a gate that is already unreachable.
      refusal = outcome.code;
      return;
    }
    granted += 1;
    deadline = outcome.executionDeadline;
    schedule();
  };

  schedule();
  return {
    stop: async () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      // Whatever it returns, and whatever it throws: this is a shutdown, not a result.
      await pending?.catch(() => undefined);
    },
    granted: () => granted,
    refusal: () => refusal,
    deadline: () => deadline,
  };
}

/**
 * Take the right to act, from the gate and then from this host.
 *
 * WHICH OBJECT GETS DIGESTED, because the first version of this file got it wrong and every test I wrote
 * agreed with me. `payload` here must be the PRIVILEGED SUB-PAYLOAD — `taskPayload.configurationDeployment`
 * or `taskPayload.agentUpgrade` — not the task payload that wraps it. That is the object the gate
 * validated against the reviewed subject and digested at bind, and it is the object that carries
 * `reviewAuthorization`. Handing this function the outer task payload produces a digest the gate has
 * never seen and a reference it cannot find, so an activated executor refuses every privileged task.
 * It fails closed, so it is not an opening — but it makes enforcement unusable, which is worse than it
 * sounds: the way that gets "fixed" in a hurry is by turning enforcement off.
 *
 * NOTE A REAL ASYMMETRY, flagged rather than smoothed over: layer 2 signs
 * `privilegedActionDigest(taskPayload)` while the gate binds `privilegedActionDigest(subPayload)`. Two
 * different scopes for one action. Both are computed, never asserted, and neither is weakened by the
 * other — but whether they should be the same scope is a question for the next review, not something to
 * decide by picking whichever makes the code shorter.
 */
export async function acquireForEffect(input: {
  gate: ReviewGateClient;
  /** The PRIVILEGED SUB-PAYLOAD the gate bound — not the task payload. See above. */
  payload: unknown;
  journal: ExecutionJournal;
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
    // PER ATTEMPT, high-entropy, and generated here rather than derived from the task: a key derived
    // from stable task fields would make an honest retry after a lost response look like the same
    // request identity, which is precisely the case that must return `already_acquired`.
    idempotencyKey: randomUUID(),
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
  // The token travels in memory, in the returned value, and nowhere else. It is deliberately NOT passed
  // to `journal.claim` above: the journal is durable, and a durable copy of a single-delivery secret
  // would undo the reason it is verifier-only at the gate.
  return {
    refused: false,
    attestationId: reference.attestationId,
    leaseId: reference.leaseId,
    actionDigest,
    attemptToken: acquired.attemptToken,
    executionDeadline: acquired.executionDeadline,
  };
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
    // Redeem needs the CURRENT credential plus this token, and deliberately NOT the epoch recorded at
    // acquire: a rotated executor may still record an outcome it already produced. Extension is the
    // operation that refuses after rotation.
    attemptToken: input.acquired.attemptToken,
  });
  return redeemed.ok ? { redeemed: true } : { redeemed: false, redeemCode: redeemed.code };
}

function describeEntry(entry: JournalEntry): string {
  return `this host recorded attempt ${entry.attempt} as ${entry.outcome} at ${entry.startedAt}` +
    (entry.finishedAt ? `, finished ${entry.finishedAt}` : ", never finished");
}
