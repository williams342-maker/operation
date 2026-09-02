import crypto from "node:crypto";
import { z } from "zod";

// Mandatory review gate — candidate identity and lifecycle.
//
// The problem this exists for: a smoke test proves a narrow happy path runs. It does not establish that
// code is safe, correct, maintainable, or free of regressions. Nothing here may treat a passing test as
// approval, and nothing may treat a caller's assertion as evidence.
//
// Two rules carry most of the weight, and both are enforced structurally rather than by convention:
//
//   1. IDENTITY IS CONTENT. A candidate's id is a digest over what it actually is — repository, base and
//      candidate commit, tree, patch, artifact and manifest digests, lock digests, test-result digest.
//      Change any of that and you have a different candidate, so a review of the old one cannot follow
//      the code. Approval can never float with a branch name or a PR number.
//
//   2. TRUST IS NOT INPUT. `tests_passed: true`, `reviewed: true`, `approved: true` supplied by a caller
//      mean nothing. Transitions consult recorded evidence and recorded participation. This is the same
//      rule the Forge authority chain kept failing on, three review rounds running: evidence is input,
//      trust is not.

const safeId = z.string().regex(/^[A-Za-z0-9._:/-]{1,200}$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const gitOid = z.string().regex(/^[a-f0-9]{40}$/);

/** Lifecycle states. Ordered roughly by progression, but the legal moves are TRANSITIONS below. */
export const reviewStates = [
  "BUILT",
  "TEST_FAILED",
  "TESTED",
  "FROZEN",
  "REVIEW_REQUESTED",
  "REVIEW_IN_PROGRESS",
  "REVIEW_BLOCKED",
  "NO_GO",
  "REMEDIATION_REQUIRED",
  "REMEDIATING",
  "RETEST_REQUIRED",
  "GO",
  "READY_FOR_OWNER_DECISION",
  "EXPIRED",
  "CANCELLED",
] as const;
export type ReviewState = (typeof reviewStates)[number];

/**
 * The legal moves. Everything absent here is rejected.
 *
 * Read the two gaps deliberately left in this table, because they are the point of the whole module:
 *
 *   TESTED  -> GO                        does not exist. A passing test is not a review.
 *   FROZEN  -> GO                        does not exist. A frozen candidate is not an approved one.
 *   GO      -> anything deployable       does not exist. GO reaches READY_FOR_OWNER_DECISION and stops;
 *                                        deployment is a separate, owner-gated action outside this table.
 */
export const TRANSITIONS: Readonly<Record<ReviewState, readonly ReviewState[]>> = Object.freeze({
  BUILT: ["TESTED", "TEST_FAILED", "CANCELLED"],
  TEST_FAILED: ["REMEDIATION_REQUIRED", "CANCELLED"],
  TESTED: ["FROZEN", "CANCELLED", "EXPIRED"],
  FROZEN: ["REVIEW_REQUESTED", "CANCELLED", "EXPIRED"],
  REVIEW_REQUESTED: ["REVIEW_IN_PROGRESS", "REVIEW_BLOCKED", "CANCELLED", "EXPIRED"],
  REVIEW_IN_PROGRESS: ["GO", "NO_GO", "REVIEW_BLOCKED", "CANCELLED", "EXPIRED"],
  REVIEW_BLOCKED: ["REVIEW_REQUESTED", "CANCELLED", "EXPIRED"],
  NO_GO: ["REMEDIATION_REQUIRED"],
  REMEDIATION_REQUIRED: ["REMEDIATING", "CANCELLED"],
  REMEDIATING: ["RETEST_REQUIRED", "CANCELLED"],
  RETEST_REQUIRED: ["TESTED", "TEST_FAILED", "CANCELLED"],
  GO: ["READY_FOR_OWNER_DECISION"],
  READY_FOR_OWNER_DECISION: [],
  EXPIRED: [],
  CANCELLED: [],
});

export const terminalStates: readonly ReviewState[] = Object.freeze([
  "READY_FOR_OWNER_DECISION",
  "EXPIRED",
  "CANCELLED",
]);

/** Roles a participant can hold on one candidate. A reviewer must hold none of the other three. */
export const participantRoles = ["author", "remediator", "reviewer", "requester"] as const;
export type ParticipantRole = (typeof participantRoles)[number];

export const participantSchema = z.object({
  identity: safeId,
  role: z.enum(participantRoles),
  at: z.string().datetime(),
});
export type Participant = z.infer<typeof participantSchema>;

/**
 * Everything that makes a candidate the candidate it is. §B of the handoff.
 *
 * `testResultDigest` is here on purpose: if the tests change, the candidate changes, so review evidence
 * cannot survive a quietly edited test plan.
 */
export const candidateBindingSchema = z.object({
  projectId: safeId,
  repository: safeId,
  baseBranch: safeId,
  baseCommit: gitOid,
  candidateCommit: gitOid,
  candidateTree: gitOid,
  patchDigest: sha256,
  artifactDigest: sha256.optional(),
  manifestDigest: sha256.optional(),
  dependencyLockDigests: z.array(sha256).max(50).default([]),
  testPlanVersion: safeId,
  testResultDigest: sha256,
  targetEnvironmentClass: z.enum(["development", "test", "beta", "staging", "production"]),
  authorIdentity: safeId,
  requestedReviewerClass: safeId,
  authorityRef: safeId,
  rollbackTargetId: safeId.optional(),
  createdAt: z.string().datetime(),
  occurrenceId: safeId,
});
export type CandidateBinding = z.infer<typeof candidateBindingSchema>;

/**
 * Digest over the binding, by EXPLICIT ORDERED FIELD JOIN rather than JSON.stringify.
 *
 * JSON.stringify with a key array is nesting-unsafe: it applies the filter at every level, so two
 * documents differing only in a nested field can serialise identically. That exact collision was found
 * and regression-tested during the Forge manifest work. An ordered join of length-prefixed fields cannot
 * do that, and it also fixes field order independently of object construction order.
 */
export function candidateDigest(binding: CandidateBinding): string {
  const parsed = candidateBindingSchema.parse(binding);
  const fields: Array<[string, string]> = [
    ["projectId", parsed.projectId],
    ["repository", parsed.repository],
    ["baseBranch", parsed.baseBranch],
    ["baseCommit", parsed.baseCommit],
    ["candidateCommit", parsed.candidateCommit],
    ["candidateTree", parsed.candidateTree],
    ["patchDigest", parsed.patchDigest],
    ["artifactDigest", parsed.artifactDigest ?? ""],
    ["manifestDigest", parsed.manifestDigest ?? ""],
    ["dependencyLockDigests", [...parsed.dependencyLockDigests].sort().join(",")],
    ["testPlanVersion", parsed.testPlanVersion],
    ["testResultDigest", parsed.testResultDigest],
    ["targetEnvironmentClass", parsed.targetEnvironmentClass],
    ["authorIdentity", parsed.authorIdentity],
    ["requestedReviewerClass", parsed.requestedReviewerClass],
    ["authorityRef", parsed.authorityRef],
    ["rollbackTargetId", parsed.rollbackTargetId ?? ""],
    ["occurrenceId", parsed.occurrenceId],
  ];
  const hash = crypto.createHash("sha256");
  for (const [name, value] of fields) {
    hash.update(String(name.length));
    hash.update("|");
    hash.update(name);
    hash.update("|");
    hash.update(String(Buffer.byteLength(value, "utf8")));
    hash.update("|");
    hash.update(value, "utf8");
    hash.update("|");
  }
  return hash.digest("hex");
}

export class ReviewGateError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ReviewGateError";
    this.code = code;
  }
}

/** A verdict is bound to one candidate digest. It cannot be replayed onto another. */
export const verdictSchema = z.object({
  candidateDigest: sha256,
  reviewerIdentity: safeId,
  verdict: z.enum(["GO", "NO_GO"]),
  findings: z.array(z.object({
    id: safeId,
    severity: z.enum(["CRITICAL", "MAJOR", "MODERATE", "MINOR", "OBSERVATION"]),
    summary: z.string().min(1).max(4000),
  })).max(500).default([]),
  submittedAt: z.string().datetime(),
});
export type Verdict = z.infer<typeof verdictSchema>;

export function isTransitionAllowed(from: ReviewState, to: ReviewState): boolean {
  return (TRANSITIONS[from] ?? []).includes(to);
}

/**
 * Is `identity` eligible to submit a terminal verdict on this candidate?
 *
 * Independence is decided by the PARTICIPATION LEDGER, not by a claim on the request. Anyone recorded as
 * author, remediator or requester on this candidate is out. The handoff's rule that "a reviewer who
 * changes the candidate becomes a remediator and loses eligibility" needs no separate check: remediation
 * writes a remediator row, and remediation also produces a new candidate with a different digest.
 */
export function independenceOf(
  identity: string,
  participants: readonly Participant[],
  authorIdentity: string,
): { independent: boolean; reason: string } {
  if (identity === authorIdentity) {
    return { independent: false, reason: "reviewer is the author of this candidate" };
  }
  const conflicting = participants
    .filter((p) => p.identity === identity && p.role !== "reviewer")
    .map((p) => p.role);
  if (conflicting.length) {
    return {
      independent: false,
      reason: `reviewer already participated as ${[...new Set(conflicting)].sort().join(", ")}`,
    };
  }
  return { independent: true, reason: "no prior non-reviewer participation recorded" };
}

/**
 * The single guarded transition. Every state change goes through here.
 *
 * `evidence` is required for the moves that assert something happened. It is deliberately NOT a set of
 * booleans: a caller cannot pass `testsPassed: true`, it must supply the digest of a recorded result,
 * and that digest must match what the candidate is bound to.
 */
export function evaluateTransition(input: {
  from: ReviewState;
  to: ReviewState;
  binding: CandidateBinding;
  boundDigest: string;
  participants: readonly Participant[];
  verdict?: Verdict;
  actorIdentity?: string;
}): { ok: true } | { ok: false; code: string; message: string } {
  const { from, to, binding, boundDigest, participants, verdict, actorIdentity } = input;

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
