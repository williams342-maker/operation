import type { ReviewState } from "./policy.js";

// The authorization matrix of design v7 §7, as data.
//
// WHY NAMED ACTIONS AND NOT A TARGET STATE. Every earlier revision let the caller name the state it
// wanted to move to. That kept the caller involved in deciding its own position in the lifecycle, which
// is one step away from letting it declare that position — the defect the first review round found. Here
// a caller names an INTENT; the gate derives the transition. There is no request shape that means
// "put me in REVIEW_IN_PROGRESS".
//
// Nothing is authorized by the absence of a rule: an action with no row cannot be performed.

export const reviewActions = [
  "submit-tests",
  "record-test-failure",
  "freeze",
  "request-review",
  "claim-review",
  "block-review",
  "begin-remediation",
  "submit-retest-request",
  "cancel",
] as const;
export type ReviewAction = (typeof reviewActions)[number];

/** Who may perform an action, relative to the candidate. */
export type Relationship =
  /** The binding's author. */
  | "author"
  /** Author, or anyone already in the participation ledger. */
  | "participant"
  /** The recorded remediator. */
  | "remediator"
  /**
   * A reviewer holding the requested class who is NOT a participant. The single stranger entry point,
   * and it grants no role — self-enrolment through it was a real defect.
   */
  | "unconflicted-reviewer"
  /** The reviewer recorded as having claimed this review. */
  | "claiming-reviewer"
  /** The owner principal. */
  | "owner";

export type ActionRule = {
  /** States the action may be performed from. */
  from: readonly ReviewState[];
  to: ReviewState;
  /**
   * Any one of these relationships suffices.
   *
   * OMITTED means the `role` below is the whole authorization, which is deliberate for the CI actions:
   * a build runner is not a PARTICIPANT in a candidate and never becomes one. Requiring both was my
   * mistake and the suite caught it -- CI could not attest tests for anything, which would have been
   * discovered the first time the gate was wired to anything real.
   */
  who?: readonly Relationship[];
  /** The role the principal must hold, if any. */
  role?: "ci" | "owner";
  /**
   * The participation row this action necessarily writes. Derived from the move, never supplied.
   *
   * `request-review` and `claim-review` deliberately grant NOTHING: an earlier design wrote a requester
   * row for whoever performed the move, so a stranger self-enrolled, cancelled the candidate and
   * superseded it, entirely through legal moves.
   */
  grants?: "remediator";
  /**
   * Whether this action records the actor as the claiming reviewer.
   *
   * Deliberately NOT `grants`: claiming a review must confer no participation, or the stranger entry
   * point becomes a self-enrolment path. The claim is recorded so the verdict can require it, and
   * nothing else reads it.
   */
  recordsClaim?: true;
  /** Whether the action releases the content claim. */
  releasesClaim?: boolean;
  /** Whether the actor must NOT be the candidate's author. */
  refuseAuthor?: boolean;
};

export const ACTIONS: Readonly<Record<ReviewAction, ActionRule>> = Object.freeze({
  // Evidence is recorded by CI, and NOT by the author. Losing this rule while redesigning was caught in
  // design review; it is stated here so it cannot be dropped silently again.
  "submit-tests": {
    from: ["BUILT", "RETEST_REQUIRED"], to: "TESTED", role: "ci", refuseAuthor: true,
  },
  "record-test-failure": {
    from: ["BUILT", "RETEST_REQUIRED"], to: "TEST_FAILED", role: "ci", refuseAuthor: true,
  },
  "freeze": { from: ["TESTED"], to: "FROZEN", who: ["author", "participant"] },
  "request-review": {
    from: ["FROZEN", "REVIEW_BLOCKED"], to: "REVIEW_REQUESTED", who: ["author", "participant"],
  },
  "claim-review": {
    from: ["REVIEW_REQUESTED"], to: "REVIEW_IN_PROGRESS", who: ["unconflicted-reviewer"],
    recordsClaim: true,
  },
  "block-review": {
    // REVIEW_IN_PROGRESS only. An earlier revision allowed this from REVIEW_REQUESTED, where no claimant
    // exists — an unreachable branch that read as a rule.
    from: ["REVIEW_IN_PROGRESS"], to: "REVIEW_BLOCKED", who: ["claiming-reviewer"],
  },
  "begin-remediation": {
    from: ["REMEDIATION_REQUIRED"], to: "REMEDIATING", who: ["author", "participant"],
    grants: "remediator",
  },
  "submit-retest-request": {
    from: ["REMEDIATING"], to: "RETEST_REQUIRED", who: ["remediator"],
  },
  "cancel": {
    from: ["BUILT", "TEST_FAILED", "TESTED", "FROZEN", "REVIEW_REQUESTED", "REVIEW_IN_PROGRESS",
      "REVIEW_BLOCKED", "NO_GO", "REMEDIATION_REQUIRED", "REMEDIATING", "RETEST_REQUIRED"],
    to: "CANCELLED", who: ["author", "owner"], releasesClaim: true,
  },
});

/** States from which a candidate may legitimately be replaced. */
export const SUPERSEDABLE: readonly ReviewState[] = Object.freeze([
  "NO_GO", "REMEDIATION_REQUIRED", "REMEDIATING", "TEST_FAILED", "CANCELLED", "EXPIRED",
]);

/** Severities a successor cannot simply decline to address. */
export const BLOCKING_SEVERITIES: readonly string[] = Object.freeze(["CRITICAL", "MAJOR"]);
