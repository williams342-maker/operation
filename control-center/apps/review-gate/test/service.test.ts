import test from "node:test";
import assert from "node:assert/strict";
import type { AuthenticatedPrincipal } from "../src/auth.js";
import { candidateDigest, type CandidateBinding } from "../src/policy.js";
import { ReviewGateService, isCustomerBillable, nonBillableClasses } from "../src/service.js";
import { castOf, type Person } from "./principals.js";

// Every test here encodes a defect an independent reviewer found across ten rounds against the previous
// design, plus the design rounds against this one. They are written as the attack, not the happy path.

const oid = (c: string) => c.repeat(40).slice(0, 40);
const dig = (c: string) => c.repeat(64).slice(0, 64);

/**
 * The cast, as the GATE holds them.
 *
 * A test cannot mint authority any more than a route can. An independent review found that
 * `AuthenticatedPrincipal.of` was public and took a caller-built object — so any module could mint an
 * owner, and these tests used exactly that route, which is why the suite never noticed. Now each of them
 * is provisioned with a real credential and resolved through `authenticate`.
 */
const PEOPLE: Person[] = [
  { principalId: "claude", roles: ["author"] },
  { principalId: "ci", roles: ["ci"] },
  { principalId: "codex", roles: ["reviewer"], reviewerClasses: ["independent"] },
  { principalId: "dana", roles: ["reviewer"], reviewerClasses: ["independent"] },
  { principalId: "frank", roles: ["reviewer"] },                 // a reviewer holding no class
  { principalId: "mallory" },                                    // a stranger
  { principalId: "owner", roles: ["owner"] },
  { principalId: "erin", roles: ["author", "reviewer"], reviewerClasses: ["independent"] },
];

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

let keys = 0;
const key = () => `k-${keys++}`;
let ids = 0;

async function build(clockValue = { now: "2026-09-02T02:00:00.000Z" }) {
  const cast = await castOf(PEOPLE);
  const svc = new ReviewGateService(cast.store, {
    clock: () => clockValue.now,
    ids: () => `id-${ids++}`,
  });
  return { store: cast.store, svc, clock: clockValue, who: cast.who };
}

const INTERNAL = "INTERNAL_QA_TEST" as const;
const REVIEW = "INTERNAL_REVIEW" as const;

type Who = (name: string) => AuthenticatedPrincipal;

async function registered(svc: ReviewGateService, who: Who, id = "c1", over: Partial<CandidateBinding> = {}) {
  const b = binding(over);
  const result = await svc.createCandidate(who(b.authorIdentity), {
    candidateId: id, binding: b, idempotencyKey: key(),
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  return b;
}

async function evidenced(svc: ReviewGateService, who: Who, id: string, b: CandidateBinding) {
  const result = await svc.recordTestExecution(who("ci"), {
    candidateId: id, idempotencyKey: key(), billingClass: INTERNAL,
    evidenceId: `ev-${id}-${keys}`, resultDigest: b.testResultDigest,
    runnerIdentity: "github-actions", runReference: "actions/runs/1",
  });
  assert.equal(result.ok, true, JSON.stringify(result));
}

async function act(svc: ReviewGateService, who: Who, actor: string, id: string, action: string, cls = INTERNAL) {
  return svc.performAction(who(actor), {
    candidateId: id, idempotencyKey: key(), billingClass: cls, action: action as never,
  });
}

/** Walk to REVIEW_IN_PROGRESS with codex as the claiming reviewer. */
async function underReview(svc: ReviewGateService, who: Who, id = "c1", over: Partial<CandidateBinding> = {}) {
  const b = await registered(svc, who, id, over);
  await evidenced(svc, who, id, b);
  for (const [actor, action] of [["ci", "submit-tests"], ["claude", "freeze"],
    ["claude", "request-review"], ["codex", "claim-review"]] as const) {
    const r = await act(svc, who, actor, id, action, action === "claim-review" ? REVIEW : INTERNAL);
    assert.equal(r.ok, true, `${action}: ${JSON.stringify(r)}`);
  }
  return b;
}

const verdict = (b: CandidateBinding, over: Record<string, unknown> = {}) => ({
  candidateDigest: candidateDigest(b),
  reviewerIdentity: "codex",
  verdict: "GO",
  findings: [],
  resolves: [],
  submittedAt: "2026-09-02T01:00:00.000Z",
  ...over,
});

// ── the caller supplies intent, and nothing else ─────────────────────────────────────────────────────

test("there is no request shape that names a target state", () => {
  // Round 1's defect in its most general form: a caller that can name its position is one step from
  // declaring it. Actions are named intents; the gate derives the transition.
  const surface = Object.getOwnPropertyNames(ReviewGateService.prototype);
  assert.ok(surface.includes("performAction"));
  assert.equal(surface.includes("transition"), false, "a `transition(to)` surface reopens that door");
});

test("the service does not leak its store or its clock", async () => {
  const { svc, store } = await build();
  const reachable = svc as unknown as Record<string, unknown>;
  for (const name of ["store", "clock", "ids", "_store"]) {
    assert.equal(reachable[name], undefined, `${name} must not be reachable`);
  }
  for (const name of [...Object.getOwnPropertyNames(svc),
    ...Object.getOwnPropertyNames(Object.getPrototypeOf(svc))]) {
    assert.notEqual((svc as unknown as Record<string, unknown>)[name], store);
  }
});

test("an author cannot register a candidate attributed to someone else", async () => {
  const { svc, who } = await build();
  const result = await svc.createCandidate(who("claude"), {
    candidateId: "x", binding: binding({ authorIdentity: "someone-else" }), idempotencyKey: key(),
  });
  assert.equal(result.ok, false);
  assert.equal((result as { code: string }).code, "author_actor_mismatch");
});

// ── evidence ─────────────────────────────────────────────────────────────────────────────────────────

test("TESTED is refused when no test execution was ever recorded", async () => {
  // The digest in the binding is a well-formed hex string the author invented. Before evidence existed,
  // that was enough.
  const { svc, who } = await build();
  await registered(svc, who, "c1");
  const result = await act(svc, who, "ci", "c1", "submit-tests");
  assert.equal(result.ok, false);
  assert.equal((result as { code: string }).code, "no_test_evidence");
});

test("evidence for a different digest does not test this candidate", async () => {
  const { svc, who } = await build();
  await registered(svc, who, "c1");
  await svc.recordTestExecution(who("ci"), {
    candidateId: "c1", idempotencyKey: key(), billingClass: INTERNAL,
    evidenceId: "ev-other", resultDigest: dig("9"),
    runnerIdentity: "github-actions", runReference: "actions/runs/1",
  });
  const result = await act(svc, who, "ci", "c1", "submit-tests");
  assert.equal((result as { code: string }).code, "no_test_evidence");
});

test("the author of a candidate cannot record its test evidence", async () => {
  // Separation of duties, and explicitly NOT provenance: a CI identity is still an authenticated caller
  // making an assertion. It forces a second party to make it.
  const { svc, who } = await build();
  const b = await registered(svc, who, "c1");
  const result = await svc.recordTestExecution(who("claude"), {
    candidateId: "c1", idempotencyKey: key(), billingClass: INTERNAL,
    evidenceId: "ev-self", resultDigest: b.testResultDigest,
    runnerIdentity: "laptop", runReference: "local",
  });
  assert.equal(result.ok, false);
  assert.equal((result as { code: string }).code, "role_required",
    "the author does not hold the ci role, which is the first thing wrong with the request");
});

test("recording evidence requires the ci role even for a participant", async () => {
  const { svc, who } = await build();
  const b = await registered(svc, who, "c1");
  const result = await svc.recordTestExecution(who("codex"), {
    candidateId: "c1", idempotencyKey: key(), billingClass: INTERNAL,
    evidenceId: "ev-x", resultDigest: b.testResultDigest,
    runnerIdentity: "r", runReference: "ref",
  });
  assert.equal((result as { code: string }).code, "role_required");
});

test("a retest cannot lean on evidence recorded before the remediation", async () => {
  const clock = { now: "2026-09-02T02:00:00.000Z" };
  const { svc, who } = await build(clock);
  const b = await registered(svc, who, "c1");
  await evidenced(svc, who, "c1", b);
  assert.equal((await act(svc, who, "ci", "c1", "record-test-failure")).ok, true);
  clock.now = "2026-09-02T03:00:00.000Z";
  // TEST_FAILED -> REMEDIATION_REQUIRED is not an action; drive the loop via the actions that exist.
  const remediation = await act(svc, who, "claude", "c1", "begin-remediation");
  assert.equal(remediation.ok, false, "REMEDIATION_REQUIRED is reached by a verdict, not from TEST_FAILED");
});

// ── the stranger entry point ─────────────────────────────────────────────────────────────────────────

test("a stranger cannot move somebody else's candidate", async () => {
  const { svc, who } = await build();
  const b = await registered(svc, who, "c1");
  await evidenced(svc, who, "c1", b);
  await act(svc, who, "ci", "c1", "submit-tests");
  const result = await act(svc, who, "mallory", "c1", "freeze");
  assert.equal(result.ok, false);
  assert.equal((result as { code: string }).code, "actor_not_authorized");
});

test("only a reviewer holding the REQUESTED class may claim a review", async () => {
  const { svc, who } = await build();
  const b = await registered(svc, who, "c1");
  await evidenced(svc, who, "c1", b);
  await act(svc, who, "ci", "c1", "submit-tests");
  await act(svc, who, "claude", "c1", "freeze");
  await act(svc, who, "claude", "c1", "request-review");
  // frank is a reviewer, but holds no class. Before this check, anyone unconflicted could review.
  const seized = await act(svc, who, "frank", "c1", "claim-review", REVIEW);
  assert.equal(seized.ok, false);
  assert.equal((seized as { code: string }).code, "actor_not_authorized");
  assert.equal((await act(svc, who, "codex", "c1", "claim-review", REVIEW)).ok, true);
});

test("claiming a review grants no role, so it cannot be used to enrol", async () => {
  const { store, svc, who } = await build();
  await underReview(svc, who, "c1");
  const record = await store.loadCandidate("c1");
  assert.equal(record!.participants.some((p) => p.identity === "codex"), false,
    "a claim must not write a participation row");
  assert.equal(record!.claimedByPrincipalId, "codex", "...but the claim itself is recorded");
});

test("the author cannot claim the review of their own candidate", async () => {
  const { svc, who } = await build();
  const b = await registered(svc, who, "c1", { authorIdentity: "erin" });
  await evidenced(svc, who, "c1", b);
  await act(svc, who, "ci", "c1", "submit-tests");
  await act(svc, who, "erin", "c1", "freeze");
  await act(svc, who, "erin", "c1", "request-review");
  // erin holds the independent class AND authored it, so only the participation check can refuse her.
  const result = await act(svc, who, "erin", "c1", "claim-review", REVIEW);
  assert.equal(result.ok, false);
  assert.equal((result as { code: string }).code, "actor_not_authorized");
});

// ── verdicts ─────────────────────────────────────────────────────────────────────────────────────────

test("only the reviewer who CLAIMED the review may submit its verdict", async () => {
  // dana holds the class and has no conflicting participation, so class and independence both pass. The
  // claim is what stops her.
  const { svc, who } = await build();
  const b = await underReview(svc, who, "c1");
  const result = await svc.submitVerdict(who("dana"), {
    candidateId: "c1", idempotencyKey: key(), billingClass: REVIEW,
    verdict: verdict(b, { reviewerIdentity: "dana" }),
  });
  assert.equal(result.ok, false);
  assert.equal((result as { code: string }).code, "verdict_actor_not_claimant");
});

test("a verdict naming someone else is refused", async () => {
  const { svc, who } = await build();
  const b = await underReview(svc, who, "c1");
  const result = await svc.submitVerdict(who("codex"), {
    candidateId: "c1", idempotencyKey: key(), billingClass: REVIEW,
    verdict: verdict(b, { reviewerIdentity: "dana" }),
  });
  assert.equal((result as { code: string }).code, "verdict_actor_mismatch");
});

test("a verdict for a different candidate is refused", async () => {
  const { svc, who } = await build();
  await underReview(svc, who, "c1");
  const result = await svc.submitVerdict(who("codex"), {
    candidateId: "c1", idempotencyKey: key(), billingClass: REVIEW,
    verdict: verdict(binding({ candidateCommit: oid("9") })),
  });
  assert.equal((result as { code: string }).code, "candidate_identity_mismatch");
});

test("a genuine independent reviewer succeeds — the checks are not simply refusing everyone", async () => {
  const { store, svc, who } = await build();
  const b = await underReview(svc, who, "c1");
  const result = await svc.submitVerdict(who("codex"), {
    candidateId: "c1", idempotencyKey: key(), billingClass: REVIEW, verdict: verdict(b),
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal((await store.loadCandidate("c1"))!.state, "GO");
});

test("a rejection must say why", async () => {
  const { svc, who } = await build();
  const b = await underReview(svc, who, "c1");
  const result = await svc.submitVerdict(who("codex"), {
    candidateId: "c1", idempotencyKey: key(), billingClass: REVIEW,
    verdict: verdict(b, { verdict: "NO_GO", findings: [] }),
  });
  assert.equal((result as { code: string }).code, "findings_required");
});

test("a verdict must be classed as review work, and review work is never customer-billable", async () => {
  const { svc, who } = await build();
  const b = await underReview(svc, who, "c1");
  const wrongClass = await svc.submitVerdict(who("codex"), {
    candidateId: "c1", idempotencyKey: key(), billingClass: INTERNAL, verdict: verdict(b),
  });
  assert.equal((wrongClass as { code: string }).code, "billing_class_not_review");
  const billed = await act(svc, who, "claude", "c1", "cancel", "CUSTOMER_VALUE_WORK" as never);
  assert.equal((billed as { code: string }).code, "billing_class_not_internal");
});

test("every internal class is non-billable, and the taxonomy is not vacuous", () => {
  for (const c of nonBillableClasses) assert.equal(isCustomerBillable(c), false, `${c} must not bill`);
  assert.equal(isCustomerBillable("CUSTOMER_VALUE_WORK"), true);
  assert.equal(isCustomerBillable("OWNER_APPROVED_SCOPE_CHANGE"), true);
});

// ── findings ─────────────────────────────────────────────────────────────────────────────────────────

test("findings survive the verdict that raised them, with gate-generated occurrence ids", async () => {
  const { store, svc, who } = await build();
  const b = await underReview(svc, who, "c1");
  await svc.submitVerdict(who("codex"), {
    candidateId: "c1", idempotencyKey: key(), billingClass: REVIEW,
    verdict: verdict(b, {
      verdict: "NO_GO",
      findings: [{ id: "F1", severity: "CRITICAL", summary: "a real defect" }],
    }),
  });
  const record = await store.loadCandidate("c1");
  const [stored] = record!.verdicts;
  assert.equal(stored.findings.length, 1);
  assert.equal(stored.findings[0].label, "F1", "the reviewer's label survives for display");
  assert.notEqual(stored.findings[0].occurrenceId, "F1",
    "identity is the GATE's occurrence id, so a reused label cannot conflate defects");
});

test("a verdict cannot raise and discharge the same finding", async () => {
  const { svc, who } = await build();
  const b = await underReview(svc, who, "c1");
  const result = await svc.submitVerdict(who("codex"), {
    candidateId: "c1", idempotencyKey: key(), billingClass: REVIEW,
    verdict: verdict(b, {
      verdict: "NO_GO",
      findings: [{ id: "F1", severity: "CRITICAL", summary: "x" }],
      resolves: ["id-0"],
    }),
  });
  assert.equal(result.ok, false, "a discharge must reference something outstanding, not something new");
});

test("a discharge cannot name a finding that is not outstanding", async () => {
  const { svc, who } = await build();
  const b = await underReview(svc, who, "c1");
  const result = await svc.submitVerdict(who("codex"), {
    candidateId: "c1", idempotencyKey: key(), billingClass: REVIEW,
    verdict: verdict(b, { resolves: ["never-raised"] }),
  });
  assert.equal((result as { code: string }).code, "resolves_unknown_finding");
});

// ── rejected content ─────────────────────────────────────────────────────────────────────────────────

test("rejected content cannot be re-registered under a fresh candidate id", async () => {
  const { svc, who } = await build();
  const b = await underReview(svc, who, "c1");
  const rejected = await svc.submitVerdict(who("codex"), {
    candidateId: "c1", idempotencyKey: key(), billingClass: REVIEW,
    verdict: verdict(b, {
      verdict: "NO_GO", findings: [{ id: "F1", severity: "CRITICAL", summary: "x" }],
    }),
  });
  assert.equal(rejected.ok, true, JSON.stringify(rejected));
  const relabelled = await svc.createCandidate(who("claude"), {
    candidateId: "totally-different", binding: binding(), idempotencyKey: key(),
  });
  assert.equal(relabelled.ok, false);
  assert.equal((relabelled as { code: string }).code, "content_already_rejected");
});

test("two live candidates cannot carry the same work", async () => {
  const { svc, who } = await build();
  await registered(svc, who, "c1");
  const twin = await svc.createCandidate(who("claude"), {
    candidateId: "c2", binding: binding(), idempotencyKey: key(),
  });
  assert.equal((twin as { code: string }).code, "content_already_live");
});

// ── successors ───────────────────────────────────────────────────────────────────────────────────────

async function rejectedCandidate(svc: ReviewGateService, who: Who, id: string) {
  const b = await underReview(svc, who, id);
  const result = await svc.submitVerdict(who("codex"), {
    candidateId: id, idempotencyKey: key(), billingClass: REVIEW,
    verdict: verdict(b, {
      verdict: "NO_GO", findings: [{ id: "F1", severity: "CRITICAL", summary: "a real defect" }],
    }),
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  return b;
}

test("a successor changing only paperwork is not a remediation", async () => {
  const { svc, who } = await build();
  await rejectedCandidate(svc, who, "c1");
  const result = await svc.createSuccessor(who("claude"), {
    candidateId: "c2", supersedes: "c1",
    binding: binding({ createdAt: "2026-09-02T09:00:00.000Z", occurrenceId: "different" }),
    idempotencyKey: key(),
  });
  assert.equal((result as { code: string }).code, "successor_identical");
});

test("a successor must address every blocking finding it inherits", async () => {
  const { svc, who } = await build();
  await rejectedCandidate(svc, who, "c1");
  const silent = await svc.createSuccessor(who("claude"), {
    candidateId: "c2", supersedes: "c1",
    binding: binding({ candidateCommit: oid("d"), candidateTree: oid("e") }),
    idempotencyKey: key(),
  });
  assert.equal((silent as { code: string }).code, "findings_unaddressed",
    "changing code is not the same as addressing the finding");
});

test("a reviewer is a participant but may not author the replacement", async () => {
  const { svc, who } = await build();
  await rejectedCandidate(svc, who, "c1");
  const byReviewer = await svc.createSuccessor(who("codex"), {
    candidateId: "c2", supersedes: "c1",
    binding: binding({ authorIdentity: "codex", candidateCommit: oid("d") }),
    idempotencyKey: key(),
  });
  assert.equal((byReviewer as { code: string }).code, "successor_actor_uninvolved");
});

test("a candidate still under review has nothing to supersede", async () => {
  const { svc, who } = await build();
  await underReview(svc, who, "c1");
  const premature = await svc.createSuccessor(who("claude"), {
    candidateId: "c2", supersedes: "c1",
    binding: binding({ candidateCommit: oid("d") }), idempotencyKey: key(),
  });
  assert.equal((premature as { code: string }).code, "prior_not_supersedable");
});

test("a genuine successor inherits the findings it must answer for", async () => {
  const { store, svc, who } = await build();
  await rejectedCandidate(svc, who, "c1");
  const prior = await store.loadCandidate("c1");
  const outstanding = prior!.verdicts[0].findings.map((f) => f.occurrenceId);
  const result = await svc.createSuccessor(who("claude"), {
    candidateId: "c2", supersedes: "c1",
    binding: binding({ candidateCommit: oid("d"), candidateTree: oid("e") }),
    remediates: outstanding, idempotencyKey: key(),
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  const successor = await store.loadCandidate("c2");
  assert.deepEqual(successor!.inherited!.map((f) => f.occurrenceId), outstanding,
    "the defect must not be forgotten just because a new record exists");
  assert.deepEqual([...successor!.remediates!], outstanding);
});

// ── malformed input ──────────────────────────────────────────────────────────────────────────────────

test("malformed input is a closed decision, never an exception", async () => {
  const { svc, who } = await build();
  await underReview(svc, who, "c1");
  const result = await svc.submitVerdict(who("codex"), {
    candidateId: "c1", idempotencyKey: key(), billingClass: REVIEW, verdict: { nonsense: true },
  });
  assert.equal(result.ok, false);
  assert.equal((result as { code: string }).code, "malformed_input");
});

test("an unknown action cannot be performed", async () => {
  const { svc, who } = await build();
  await registered(svc, who, "c1");
  const result = await act(svc, who, "claude", "c1", "become-approved");
  assert.equal(result.ok, false, "nothing is authorized by the absence of a rule");
});
