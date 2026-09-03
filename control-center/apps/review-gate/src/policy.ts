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
//   1. IDENTITY IS CONTENT. NOT the record key — `candidateId` is a caller-chosen string and always was.
//      What is a digest is the BINDING: `candidateDigest` over the whole submission, and `contentDigest`
//      over the work alone. Change the work and you have different content, so a review of the old work
//      cannot follow the code, and approval never floats with a branch name or a PR number.
//
//      This comment used to say "a candidate's id is a digest", which was false and was exactly the
//      mistake that produced round 5's CRITICAL: I kept attaching identity guarantees to the database key
//      instead of to the content. The sentence outlived the design it described.
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
/**
 * WHAT this candidate is a review OF.
 *
 * Design review round 5 found that the whole configuration-attestation rule compared against a
 * `changeDigest` that did not exist on the binding — the central comparison of the rule had no reviewed,
 * immutable operand, so it could not have been implemented as written. Adding a loose field would not
 * have been enough either: a generic code-artifact candidate could then have authorized a configuration
 * change. The discriminant is what stops that, and it is part of `contentDigest`, so it is fixed at
 * review time.
 *
 * The permitted attestation kind -> subject mappings are:
 *   configuration.apply     -> configuration.change
 *   configuration.rollback  -> configuration.change WITH rollbackTarget present
 *   agent.upgrade           -> agent.upgrade
 */
export const candidateSubjectSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("code"),
  }).strict(),
  z.object({
    kind: z.literal("configuration.change"),
    /** configurationChangeDigest() over the mutation set. The gate RECOMPUTES this from the payload. */
    changeDigest: sha256,
    environmentId: safeId,
    targetProfileId: safeId,
    targetProfileRevision: z.number().int().positive(),
    /**
     * REQUIRED for the rollback kind. Round 6 left "the target must have been RELEASED" with no named
     * operand -- an assertion about a candidate the design never identified, which is the same defect as
     * the missing changeDigest one revision earlier.
     */
    rollbackTarget: z.object({ candidateId: safeId, contentDigest: sha256 }).strict().optional(),
  }).strict(),
  z.object({
    kind: z.literal("agent.upgrade"),
    artifactSha256: sha256,
    releaseManifestDigest: sha256,
  }).strict(),
]);
export type CandidateSubject = z.infer<typeof candidateSubjectSchema>;

export const candidateBindingSchema = z.object({
  subject: candidateSubjectSchema,
  projectId: safeId,
  repository: safeId,
  baseBranch: safeId,
  baseCommit: gitOid,
  candidateCommit: gitOid,
  candidateTree: gitOid,
  patchDigest: sha256,
  /**
   * REQUIRED as of round 6. These were optional, and an independent review said twice that optional
   * artifact binding should block production use or any claim that candidate identity is complete --
   * a materially different artifact could carry the reviewed candidate's identity. Agreeing with a
   * finding twice and leaving it open is not agreeing with it.
   */
  artifactDigest: sha256,
  manifestDigest: sha256,
  dependencyLockDigests: z.array(sha256).max(50).default([]),
  testPlanVersion: safeId,
  testResultDigest: sha256,
  targetEnvironmentClass: z.enum(["development", "test", "beta", "staging", "production"]),
  authorIdentity: safeId,
  requestedReviewerClass: safeId,
  authorityRef: safeId,
  rollbackTargetId: safeId.optional(),
  createdAt: z.string().datetime(),
  /** After this instant the candidate cannot be frozen, reviewed, or approved. Part of identity. */
  expiresAt: z.string().datetime().optional(),
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
    ["artifactDigest", parsed.artifactDigest],
    ["manifestDigest", parsed.manifestDigest],
    ["dependencyLockDigests", [...parsed.dependencyLockDigests].sort().join(",")],
    ["testPlanVersion", parsed.testPlanVersion],
    ["testResultDigest", parsed.testResultDigest],
    ["targetEnvironmentClass", parsed.targetEnvironmentClass],
    ["authorIdentity", parsed.authorIdentity],
    ["requestedReviewerClass", parsed.requestedReviewerClass],
    ["authorityRef", parsed.authorityRef],
    ["rollbackTargetId", parsed.rollbackTargetId ?? ""],
    ["createdAt", parsed.createdAt],
    ["expiresAt", parsed.expiresAt ?? ""],
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

/**
 * The fields that are the WORK ITSELF, as opposed to the paperwork around it.
 *
 * WHY THIS IS A SEPARATE DIGEST. Round 5 of the independent review broke two of my claims with the same
 * observation. I said a rejected digest could never be approved, and that a successor must differ from
 * what it replaces -- and both were enforced against `candidateDigest`, which covers `createdAt`,
 * `occurrenceId`, `authorityRef`, `requestedReviewerClass` and `testResultDigest`. So changing a
 * timestamp, or simply re-running the tests on untouched code, produced a "different candidate" that had
 * never been rejected. The rejection was attached to the paperwork rather than to the work.
 *
 * `contentDigest` covers only what would have to change for the defect to be gone: the repository, the
 * commits and tree, the patch, the built artifact and its manifest, the dependency lock set, and the test
 * plan. Re-running tests does not change it. Re-freezing at a later time does not change it. Editing the
 * authority reference does not change it.
 *
 * ROUND 6 REMOVED `testPlanVersion` FROM THIS LIST, and my own test had been asserting the wrong thing.
 * A test plan label describes how the work is checked, not the work. Leaving it in meant a rejected
 * artifact could be re-presented as remediated by editing `tp-1` to `tp-2` — the identical defective
 * commit, tree, patch, artifact and manifest, laundered by a label. That is the same failure as round 5
 * in a smaller box: remediation attached to inequality of an identifier rather than to changed work.
 *
 * NOTE WHAT THIS COSTS: two candidates identical in content but targeting different environments share a
 * content digest, so a rejection in one environment blocks approval in the other. That is the direction I
 * want the error to point.
 */
const CONTENT_FIELDS = Object.freeze([
  "projectId", "repository", "baseCommit", "candidateCommit", "candidateTree",
  "patchDigest", "artifactDigest", "manifestDigest", "dependencyLockDigests",
] as const);

/**
 * The subject, canonicalised for the content digest.
 *
 * An explicit ordered join per variant, for the same reason candidateDigest uses one: JSON.stringify with
 * a key filter is nesting-unsafe. Every field of every variant appears here, so adding one to the schema
 * without adding it here is caught by the test that derives this list from the schema.
 */
function canonicalSubject(subject: CandidateSubject): string {
  const parts: string[] = ["kind", subject.kind];
  if (subject.kind === "configuration.change") {
    parts.push(
      "changeDigest", subject.changeDigest,
      "environmentId", subject.environmentId,
      "targetProfileId", subject.targetProfileId,
      "targetProfileRevision", String(subject.targetProfileRevision),
      "rollbackTargetCandidateId", subject.rollbackTarget?.candidateId ?? "",
      "rollbackTargetContentDigest", subject.rollbackTarget?.contentDigest ?? "",
    );
  } else if (subject.kind === "agent.upgrade") {
    parts.push("artifactSha256", subject.artifactSha256,
      "releaseManifestDigest", subject.releaseManifestDigest);
  }
  return parts.map((value) => `${Buffer.byteLength(value, "utf8")}|${value}`).join("|");
}

export function contentDigest(binding: CandidateBinding): string {
  const parsed = candidateBindingSchema.parse(binding);
  const value = (name: (typeof CONTENT_FIELDS)[number]): string =>
    name === "dependencyLockDigests"
      ? [...parsed.dependencyLockDigests].sort().join(",")
      : String(parsed[name]);
  const hash = crypto.createHash("sha256");
  // v2: the subject joined the content digest. A candidate reviewed as code must not be able to
  // authorize a configuration change, so the discriminant is part of identity rather than metadata.
  hash.update("content-v2|");
  hash.update(canonicalSubject(parsed.subject));
  hash.update("|");
  for (const name of CONTENT_FIELDS) {
    const v = value(name);
    hash.update(String(name.length));
    hash.update("|");
    hash.update(name);
    hash.update("|");
    hash.update(String(Buffer.byteLength(v, "utf8")));
    hash.update("|");
    hash.update(v, "utf8");
    hash.update("|");
  }
  return hash.digest("hex");
}

/**
 * The subject fields the canonical join actually covers, exported so a test can derive coverage from the
 * SCHEMA rather than from a hand-maintained list. A subject field missing from here is a field outside
 * content identity, which means it can be edited after review.
 */
export const CANONICALISED_SUBJECT_FIELDS: readonly string[] = Object.freeze([
  "changeDigest", "environmentId", "targetProfileId", "targetProfileRevision", "rollbackTarget",
  "artifactSha256", "releaseManifestDigest",
]);

/** The fields covered by contentDigest, exported so a test can prove the split is what it claims. */
export const contentFields: readonly string[] = CONTENT_FIELDS;

/** A verdict older than this is refused outright rather than silently honoured. */
export const MAX_VERDICT_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/** Tolerated clock disagreement between a reviewer's host and the gate. */
export const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

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
  /**
   * Findings from EARLIER rejections that this reviewer has confirmed are addressed.
   *
   * ROUND 8 SEPARATED CLAIMING FROM DISCHARGING. An author's `remediates` list on a successor says what
   * they believe they fixed; it is a claim, and a claim is not evidence. Only a reviewer looking at the
   * work can retire a finding, so only a verdict can do it. Anything outstanding and undischarged blocks
   * GO, which forces a reviewer to account for inherited defects rather than inherit them silently.
   */
  resolves: z.array(safeId).max(500).default([]),
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
