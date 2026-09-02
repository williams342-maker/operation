import { z } from "zod";
import {
  TRANSITIONS,
  candidateBindingSchema,
  participantSchema,
  reviewStates,
  verdictSchema,
  candidateDigest,
  independenceOf,
  isTransitionAllowed,
  terminalStates,
  MAX_CLOCK_SKEW_MS,
  MAX_VERDICT_AGE_MS,
  ReviewGateError,
  type CandidateBinding,
  type Participant,
  type ReviewState,
  type Verdict,
} from "./reviewGate.js";

// INTERNAL. NOT PART OF THE PACKAGE SURFACE. Do not add this module to index.ts, and do not give it a
// subpath in package.json exports.
//
// Round 3 of an independent review falsified the previous claim that removing this function from
// index.ts made it unreachable. It did not: package.json had no `exports` map, so any consumer could
// still write
//
//     import { evaluateTransition } from "@control-center/shared/dist/reviewGate.js";
//
// and call the evaluator with a fabricated state, an empty participation ledger, its own binding and
// its own verdict -- the original bypass, rebuilt through a package subpath. Not exporting a symbol
// from the index is a naming convention; the enforcement is the `exports` map in package.json, which
// makes every subpath but the root unresolvable. This file is where the evaluator lives so that the
// boundary has a name, and reviewGateBoundary.test.ts fails if either half is removed.
//
// The only legitimate caller is ReviewGateService, which loads the state, binding, ledger and digest
// from the store rather than accepting them.

/**
 * The single guarded transition. Every state change goes through here.
 *
 * WHAT THIS FUNCTION DOES NOT DO, stated because the previous version of this comment claimed otherwise
 * and an independent review caught it. It said evidence "is required for the moves that assert something
 * happened" and that a caller "must supply the digest of a recorded result". THERE IS NO EVIDENCE
 * PARAMETER HERE AND THERE NEVER WAS. The comment described a mechanism I had not built, which is the
 * most expensive kind of comment: it reads as an assurance and reviewers may believe it.
 *
 * This function decides POLICY over facts it is given. Whether those facts are real is the authoritative
 * layer's job: ReviewGateService loads the state, binding, ledger and digest from the store, and gates
 * TESTED on a recorded test execution whose digest matches the candidate's binding. If you are reading
 * this to find out whether a candidate was really tested, the answer is not in this file.
 */
export function evaluateTransition(input: {
  from: ReviewState;
  to: ReviewState;
  binding: CandidateBinding;
  boundDigest: string;
  participants: readonly Participant[];
  verdict?: Verdict;
  actorIdentity?: string;
  /** Trusted instant, supplied by the authoritative layer. Omit only in pure-policy unit tests. */
  now?: string;
}): { ok: true } | { ok: false; code: string; message: string } {
  const { from, to, boundDigest, actorIdentity } = input;

  // Parse at the boundary. TypeScript disappears at runtime, and this function is reached from routes,
  // queues and callbacks where the shapes are whatever arrived. A malformed input must become a closed
  // decision, never an exception and never a silent pass — NO_GO previously dereferenced
  // verdict.findings.length without ever having parsed the verdict.
  let binding: CandidateBinding;
  let participants: readonly Participant[];
  let verdict: Verdict | undefined;
  try {
    binding = candidateBindingSchema.parse(input.binding);
    participants = z.array(participantSchema).max(500).parse(input.participants ?? []);
    verdict = input.verdict === undefined ? undefined : verdictSchema.parse(input.verdict);
  } catch (error) {
    return {
      ok: false,
      code: "malformed_input",
      message: `input failed schema validation: ${(error as Error).message.slice(0, 300)}`,
    };
  }
  if (!reviewStates.includes(from) || !reviewStates.includes(to)) {
    return { ok: false, code: "unknown_state", message: `${from} -> ${to} names a state that does not exist` };
  }

  if (candidateDigest(binding) !== boundDigest) {
    return {
      ok: false,
      code: "candidate_identity_mismatch",
      message: "the binding does not hash to the digest this candidate was frozen under",
    };
  }
  if (!isTransitionAllowed(from, to)) {
    return { ok: false, code: "illegal_transition", message: `${from} -> ${to} is not a legal move` };
  }

  // Expiry is enforced against caller-independent time supplied by the trusted layer, not read from the
  // clock here, so a test can drive it and a route cannot dodge it.
  if (input.now !== undefined) {
    const now = Date.parse(input.now);
    if (Number.isNaN(now)) {
      return { ok: false, code: "malformed_input", message: "`now` is not a valid instant" };
    }
    if (binding.expiresAt && now > Date.parse(binding.expiresAt) && to !== "EXPIRED" && to !== "CANCELLED") {
      return { ok: false, code: "candidate_expired", message: "the candidate expired; only EXPIRED or CANCELLED remain" };
    }
    if (verdict) {
      const age = now - Date.parse(verdict.submittedAt);
      // Future-dated first. Checking only `age > MAX` let a verdict timestamped in the future produce a
      // NEGATIVE age and sail past the limit — a forged verdict could then outlive the window entirely.
      if (age < -MAX_CLOCK_SKEW_MS) {
        return { ok: false, code: "verdict_future_dated", message: "the verdict is dated in the future beyond tolerated skew" };
      }
      if (age > MAX_VERDICT_AGE_MS) {
        return { ok: false, code: "verdict_stale", message: "the verdict is older than the maximum accepted age" };
      }
    }
  }

  if (to === "GO" || to === "NO_GO") {
    if (!verdict) {
      return { ok: false, code: "verdict_required", message: `${to} requires a submitted verdict` };
    }
    if (verdict.candidateDigest !== boundDigest) {
      return {
        ok: false,
        code: "verdict_wrong_candidate",
        message: "verdict is bound to a different candidate digest",
      };
    }
    if (verdict.verdict !== to) {
      return { ok: false, code: "verdict_disagrees", message: `verdict says ${verdict.verdict}, transition says ${to}` };
    }
    // The verdict names its reviewer, but a name in a payload is a claim. Whoever calls this must say who
    // they are, authenticated, and the two must agree — otherwise an author submits a verdict naming an
    // uninvolved identity and the independence check happily evaluates the innocent party.
    if (!actorIdentity) {
      return { ok: false, code: "actor_required", message: "a terminal verdict requires an authenticated actor" };
    }
    if (actorIdentity !== verdict.reviewerIdentity) {
      return {
        ok: false,
        code: "verdict_actor_mismatch",
        message: "the authenticated actor is not the reviewer named in the verdict",
      };
    }
    const independence = independenceOf(verdict.reviewerIdentity, participants, binding.authorIdentity);
    if (!independence.independent) {
      return { ok: false, code: "reviewer_not_independent", message: independence.reason };
    }
    if (to === "NO_GO" && verdict.findings.length === 0) {
      return { ok: false, code: "no_go_without_findings", message: "NO_GO must carry at least one finding" };
    }
  }

  // READY_FOR_OWNER_DECISION is reachable only from GO, which TRANSITIONS already enforces. Restating the
  // owner boundary here as well, because this is the line the whole gate exists to hold.
  if (to === "READY_FOR_OWNER_DECISION" && from !== "GO") {
    return { ok: false, code: "owner_decision_requires_go", message: "only an independent GO reaches owner decision" };
  }

  // §H.18 — a consequential change cannot reach review without a way back. Development and test are
  // exempt: there is nothing to roll back to and demanding one would only teach people to write a
  // placeholder, which is worse than not asking.
  const consequential = binding.targetEnvironmentClass === "beta"
    || binding.targetEnvironmentClass === "staging"
    || binding.targetEnvironmentClass === "production";
  if (consequential && !binding.rollbackTargetId && (to === "FROZEN" || to === "GO")) {
    return {
      ok: false,
      code: "rollback_identity_missing",
      message: `a ${binding.targetEnvironmentClass} candidate cannot be frozen or approved without a rollback target`,
    };
  }

  if (to === "REMEDIATING" && !actorIdentity) {
    return { ok: false, code: "actor_required", message: "remediation must record who is remediating" };
  }
  return { ok: true };
}
