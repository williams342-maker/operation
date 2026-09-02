import test from "node:test";
import assert from "node:assert/strict";
import { candidateDigest, type CandidateBinding } from "../src/reviewGate.js";
import {
  InMemoryReviewGateStore,
  ReviewGateService,
  TrustedPrincipal,
  isCustomerBillable,
  nonBillableClasses,
  type SessionAuthenticator,
} from "../src/reviewGateService.js";

// Identity is neither request data nor a principal the caller builds. Operations take an opaque PROOF,
// and the service mints the principal through the authenticator the application injected. This test
// authenticator stands in for that application; note that it is the only thing here that decides who
// anyone is, which is the point of the third round of this design.
/**
 * Identities the application grants the "independent" review authority.
 *
 * Deliberately NOT everyone: round 7 found that requestedReviewerClass was parsed and never enforced, so
 * a test harness that granted the class to all identities would make the new check vacuous -- and this
 * suite has twice shipped an assertion that certified a hole rather than catching one.
 */
const INDEPENDENT_REVIEWERS = new Set(["codex", "dana", "erin"]);

const auth: SessionAuthenticator = {
  authenticate(proof) {
    const id = (proof as { userId?: unknown } | null)?.userId;
    if (typeof id !== "string" || !id.trim()) return null;
    const identity = id.trim();
    return {
      identity,
      reviewerClasses: INDEPENDENT_REVIEWERS.has(identity) ? ["independent"] : [],
    };
  },
};

/** A proof the test authenticator accepts. NOT a principal -- there is no principal argument any more. */
const who = (id: string) => ({ userId: id, authenticatedAt: "2026-09-02T00:00:00.000Z" });

// Remediation evidence for the independent review of candidate 311506ce.
//
// Codex found two CRITICALs: every authoritative fact was supplied by the caller, and reviewer identity
// was an unsigned assertion. These tests exist to prove those specific attacks now fail — so each one is
// written as the attack, not as the happy path.

const oid = (c: string) => c.repeat(40).slice(0, 40);
const dig = (c: string) => c.repeat(64).slice(0, 64);

function binding(over: Partial<CandidateBinding> = {}): CandidateBinding {
  return {
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
  };
}

async function seeded(state?: string) {
  const store = new InMemoryReviewGateStore();
  const svc = new ReviewGateService(store, auth, () => "2026-09-02T02:00:00.000Z");
  await svc.createCandidate(who("claude"), { candidateId: "c1", binding: binding() });
  // TESTED is gated on a recorded test execution, so seeding has to record one. That this helper had to
  // change at all is the round-4 finding in miniature: before it, every test walked into TESTED by
  // asserting it.
  await svc.recordTestExecution(who("ci"), {
    candidateId: "c1", occurrenceId: "seed-ev", billingClass: "INTERNAL_QA_TEST",
    evidenceId: "ev-seed", resultDigest: dig("2"),
    runnerIdentity: "ci-runner", runReference: "run/ev-seed",
  });
  if (state) {
    const path: Array<[string, string]> = [
      ["TESTED", "t1"], ["FROZEN", "t2"], ["REVIEW_REQUESTED", "t3"], ["REVIEW_IN_PROGRESS", "t4"],
    ];
    for (const [to, occ] of path) {
      // REVIEW_IN_PROGRESS is the reviewer claiming the review, so it is codex who makes that move.
      const actor = to === "REVIEW_IN_PROGRESS" ? "codex" : "claude";
      await svc.transition(who(actor), {
    candidateId: "c1", occurrenceId: occ,
        billingClass: "INTERNAL_QA_TEST", to: to as never,
      });
      if (to === state) break;
    }
  }
  return { store, svc };
}

// ── CRITICAL 1 — the caller cannot supply the authoritative facts ────────────────────────────────────

test("CRITICAL-1: a caller cannot claim its own current state", async () => {
  const { svc } = await seeded();
  // The candidate is BUILT. The old evaluator would have accepted `from: "REVIEW_IN_PROGRESS"`.
  // The service has no such parameter at all, so the attack cannot even be expressed: asking to go
  // straight to GO is judged against the STORED state.
  const result = await svc.submitVerdict(who("codex"), {
    candidateId: "c1", occurrenceId: "x1", billingClass: "INTERNAL_REVIEW",
    verdict: {
      candidateDigest: candidateDigest(binding()), reviewerIdentity: "codex",
      verdict: "GO", findings: [], submittedAt: "2026-09-02T01:00:00.000Z",
    },
  });
  assert.equal(result.ok, false);
  assert.equal((result as { code: string }).code, "illegal_transition");
});

/**
 * A candidate authored by someone who ALSO holds the independent reviewer class.
 *
 * Round 7 added a reviewer-class check that fires before the independence check, so an ordinary author
 * is now refused for not holding the class -- which would let the independence assertions below pass for
 * the wrong reason. "erin" holds the class AND authors this candidate, so independence is the only thing
 * left that can refuse her.
 */
async function authoredByAReviewer(id: string) {
  const store = new InMemoryReviewGateStore();
  const svc = new ReviewGateService(store, auth, () => "2026-09-02T02:00:00.000Z");
  const b = binding({ authorIdentity: "erin", candidateCommit: oid("f"), candidateTree: oid("f") });
  await svc.createCandidate(who("erin"), { candidateId: id, binding: b });
  await svc.recordTestExecution(who("ci"), {
    candidateId: id, occurrenceId: "ev", billingClass: "INTERNAL_QA_TEST",
    evidenceId: `ev-${id}`, resultDigest: b.testResultDigest,
    runnerIdentity: "ci-runner", runReference: `run/${id}`,
  });
  for (const [to, occ] of [["TESTED", "1"], ["FROZEN", "2"], ["REVIEW_REQUESTED", "3"]] as const) {
    const r = await svc.transition(who("erin"), {
      candidateId: id, occurrenceId: occ, billingClass: "INTERNAL_QA_TEST", to: to as never });
    assert.equal(r.ok, true, `${to}: ${JSON.stringify(r)}`);
  }
  const claimed = await svc.transition(who("erin"), {
    candidateId: id, occurrenceId: "4", billingClass: "INTERNAL_REVIEW", to: "REVIEW_IN_PROGRESS" });
  assert.equal(claimed.ok, true, `claim: ${JSON.stringify(claimed)}`);
  return { store, svc, binding: b };
}

test("CRITICAL-1: a caller cannot supply an empty participation ledger", async () => {
  const { svc, binding: b } = await authoredByAReviewer("c1e");
  // The author tries to approve, which previously worked by passing participants: [].
  // There is no participants parameter; the ledger is loaded, and it already holds the author row
  // written by createCandidate. She holds the reviewer class, so ONLY independence can stop her.
  const result = await svc.submitVerdict(who("erin"), {
    candidateId: "c1e", occurrenceId: "x2", billingClass: "INTERNAL_REVIEW",
    verdict: {
      candidateDigest: candidateDigest(b), reviewerIdentity: "erin",
      verdict: "GO", findings: [], submittedAt: "2026-09-02T01:00:00.000Z",
    },
  });
  assert.equal(result.ok, false);
  assert.equal((result as { code: string }).code, "reviewer_not_independent");
});

test("CRITICAL-1: the ledger is written by the operations, not by the caller", async () => {
  const { store, svc } = await seeded("REVIEW_IN_PROGRESS");
  const record = await store.load("c1");
  assert.ok(record);
  // author from createCandidate, requester from the REVIEW_REQUESTED transition. Both were written by
  // the operations themselves — the caller never named a role. That the requester row appears at all is
  // the C3 remediation working: roles are derived from what was done, not chosen by the doer.
  assert.deepEqual(
    record!.participants.map((p) => [p.identity, p.role]),
    [["claude", "author"], ["claude", "requester"]],
    "the operations must write participation themselves",
  );
});

// ── CRITICAL 2 — reviewer identity is bound to the authenticated actor ───────────────────────────────

test("CRITICAL-2: an author cannot submit a verdict naming an uninvolved reviewer", async () => {
  const { svc, binding: b } = await authoredByAReviewer("c2e");
  // The exact attack from round 1: authenticate as the author, name someone else in the payload, and the
  // independence check evaluates the innocent identity. Again erin holds the class, so the refusal below
  // is the actor/verdict binding doing the work rather than the class check short-circuiting it.
  const result = await svc.submitVerdict(who("erin"), {
    candidateId: "c2e", occurrenceId: "x3", billingClass: "INTERNAL_REVIEW",
    verdict: {
      candidateDigest: candidateDigest(b), reviewerIdentity: "codex",
      verdict: "GO", findings: [], submittedAt: "2026-09-02T01:00:00.000Z",
    },
  });
  assert.equal(result.ok, false);
  assert.equal((result as { code: string }).code, "verdict_actor_mismatch");
});

test("round 7: a reviewer without the requested class cannot issue the verdict", async () => {
  // requestedReviewerClass was parsed and never consulted until round 7. "frank" is authenticated, has no
  // conflicting participation, and would previously have been accepted as the independent reviewer.
  const { svc } = await seeded("REVIEW_IN_PROGRESS");
  const result = await svc.submitVerdict(who("frank"), {
    candidateId: "c1", occurrenceId: "fx", billingClass: "INTERNAL_REVIEW",
    verdict: {
      candidateDigest: candidateDigest(binding()), reviewerIdentity: "frank",
      verdict: "GO", findings: [], submittedAt: "2026-09-02T01:00:00.000Z",
    },
  });
  assert.equal(result.ok, false);
  assert.equal((result as { code: string }).code, "reviewer_class_not_held");
});

test("round 7: a stranger without the class cannot seize a requested review", async () => {
  const store = new InMemoryReviewGateStore();
  const svc = new ReviewGateService(store, auth, () => "2026-09-02T02:00:00.000Z");
  const b = binding();
  await svc.createCandidate(who("claude"), { candidateId: "seize", binding: b });
  await svc.recordTestExecution(who("ci"), {
    candidateId: "seize", occurrenceId: "ev", billingClass: "INTERNAL_QA_TEST",
    evidenceId: "ev-seize", resultDigest: b.testResultDigest,
    runnerIdentity: "ci-runner", runReference: "run/seize",
  });
  for (const [to, occ] of [["TESTED", "1"], ["FROZEN", "2"], ["REVIEW_REQUESTED", "3"]] as const) {
    await svc.transition(who("claude"), {
      candidateId: "seize", occurrenceId: occ, billingClass: "INTERNAL_QA_TEST", to: to as never });
  }
  const seized = await svc.transition(who("frank"), {
    candidateId: "seize", occurrenceId: "s", billingClass: "INTERNAL_REVIEW", to: "REVIEW_IN_PROGRESS" });
  assert.equal(seized.ok, false, "the stranger entry point is for requested reviewers, not for anyone");
  assert.equal((seized as { code: string }).code, "reviewer_class_not_held");
});

test("a genuine independent reviewer still succeeds — the fix is not merely refusing everything", async () => {
  const { store, svc } = await seeded("REVIEW_IN_PROGRESS");
  const result = await svc.submitVerdict(who("codex"), {
    candidateId: "c1", occurrenceId: "x4", billingClass: "INTERNAL_REVIEW",
    verdict: {
      candidateDigest: candidateDigest(binding()), reviewerIdentity: "codex",
      verdict: "GO", findings: [], submittedAt: "2026-09-02T01:30:00.000Z",
    },
  });
  assert.equal(result.ok, true);
  const record = await store.load("c1");
  assert.equal(record!.state, "GO");
  assert.ok(record!.participants.some((p) => p.identity === "codex" && p.role === "reviewer"),
    "submitting a verdict must record reviewer participation");
});

// ── §H.12 / §H.17 — idempotency and concurrency, now testable because a store exists ─────────────────

test("H12: a replayed occurrence id is a no-op, not a second transition", async () => {
  const { store, svc } = await seeded();
  const first = await svc.transition(who("claude"), {
    candidateId: "c1", occurrenceId: "dup", billingClass: "INTERNAL_QA_TEST", to: "TESTED",
  });
  assert.equal(first.ok, true);
  const replay = await svc.transition(who("claude"), {
    candidateId: "c1", occurrenceId: "dup", billingClass: "INTERNAL_QA_TEST", to: "FROZEN",
  });
  assert.equal(replay.ok, false);
  assert.equal((replay as { code: string }).code, "state_moved_or_replayed");
  const record = await store.load("c1");
  assert.equal(record!.occurrences.length, 1, "the replay must not append a second occurrence");
});

test("H17: two racing transitions from the same read cannot both apply", async () => {
  const { store, svc } = await seeded();
  const [a, b] = await Promise.all([
    svc.transition(who("claude"), {
    candidateId: "c1", occurrenceId: "r1", billingClass: "INTERNAL_QA_TEST", to: "TESTED" }),
    svc.transition(who("claude"), {
    candidateId: "c1", occurrenceId: "r2", billingClass: "INTERNAL_QA_TEST", to: "TEST_FAILED" }),
  ]);
  assert.equal([a.ok, b.ok].filter(Boolean).length, 1, "exactly one of the two must win");
  const record = await store.load("c1");
  assert.equal(record!.occurrences.length, 1);
});

// ── the (1) handoff's cost principle, enforced at the boundary ───────────────────────────────────────

test("review-gate work cannot be charged to the customer", async () => {
  const { svc } = await seeded();
  const result = await svc.transition(who("claude"), {
    candidateId: "c1", occurrenceId: "b1",
    billingClass: "CUSTOMER_VALUE_WORK", to: "TESTED",
  });
  assert.equal(result.ok, false);
  assert.equal((result as { code: string }).code, "billing_class_not_internal");
});

test("every internal class is non-billable, and the taxonomy is not vacuous", () => {
  for (const c of nonBillableClasses) assert.equal(isCustomerBillable(c), false, `${c} must not bill`);
  assert.equal(isCustomerBillable("CUSTOMER_VALUE_WORK"), true, "the billable class must still bill");
  assert.equal(isCustomerBillable("OWNER_APPROVED_SCOPE_CHANGE"), true);
});

test("a verdict must be classed as review work", async () => {
  const { svc } = await seeded("REVIEW_IN_PROGRESS");
  const result = await svc.submitVerdict(who("codex"), {
    candidateId: "c1", occurrenceId: "b2", billingClass: "INTERNAL_QA_TEST",
    verdict: {
      candidateDigest: candidateDigest(binding()), reviewerIdentity: "codex",
      verdict: "GO", findings: [], submittedAt: "2026-09-02T01:30:00.000Z",
    },
  });
  assert.equal(result.ok, false);
  assert.equal((result as { code: string }).code, "billing_class_not_review");
});

// ── other remediated findings ────────────────────────────────────────────────────────────────────────

test("MAJOR: createdAt now participates in candidate identity", () => {
  assert.notEqual(
    candidateDigest(binding({ createdAt: "2026-09-02T00:00:00.000Z" })),
    candidateDigest(binding({ createdAt: "2026-09-02T00:00:01.000Z" })),
  );
});

test("MODERATE: an expired candidate cannot be advanced", async () => {
  const store = new InMemoryReviewGateStore();
  const svc = new ReviewGateService(store, auth, () => "2026-09-03T00:00:00.000Z");
  const b = binding({ expiresAt: "2026-09-02T12:00:00.000Z" });
  await svc.createCandidate(who("claude"), { candidateId: "c2", binding: b });
  // Evidence is recorded, so this test proves expiry refuses the move -- not that evidence was missing.
  await svc.recordTestExecution(who("ci"), {
    candidateId: "c2", occurrenceId: "ev-exp", billingClass: "INTERNAL_QA_TEST",
    evidenceId: "ev-c2", resultDigest: dig("2"),
    runnerIdentity: "ci-runner", runReference: "run/ev-c2",
  });
  const result = await svc.transition(who("claude"), {
    candidateId: "c2", occurrenceId: "e1", billingClass: "INTERNAL_QA_TEST", to: "TESTED",
  });
  assert.equal(result.ok, false);
  assert.equal((result as { code: string }).code, "candidate_expired");
});

test("MODERATE: malformed input is a closed decision, never an exception", async () => {
  const { svc } = await seeded("REVIEW_IN_PROGRESS");
  const result = await svc.submitVerdict(who("codex"), {
    candidateId: "c1", occurrenceId: "m1", billingClass: "INTERNAL_REVIEW",
    verdict: { nonsense: true },
  });
  assert.equal(result.ok, false);
  assert.equal((result as { code: string }).code, "malformed_input");
});

test("an author cannot register a candidate attributed to someone else", async () => {
  const store = new InMemoryReviewGateStore();
  const svc = new ReviewGateService(store, auth);
  const result = await svc.createCandidate(who("claude"), {
    candidateId: "c3", binding: binding({ authorIdentity: "someone-else" }),
  });
  assert.equal(result.ok, false);
  assert.equal((result as { code: string }).code, "author_actor_mismatch");
});

// ── round-3 findings ─────────────────────────────────────────────────────────────────────────────────

// MODERATE-1. Round 3 found that the C3 remediation had no end-to-end attack test: the earlier test only
// checked that a requester row gets written. That is evidence about bookkeeping, not about the bypass.
// This walks the entire loop and ends on the move the bypass existed to permit.
test("C3 end-to-end: a reviewer who remediates cannot then approve their own remediation", async () => {
  const store = new InMemoryReviewGateStore();
  // A MOVING CLOCK, because a fixed one hid a real defect. Round 5 found that "evidence recorded after
  // the remediation" was implemented with >=, so a run recorded in the same millisecond as the
  // REMEDIATING transition counted as following it -- which is exactly what a fixed test clock produces.
  // The comparison is strict now, and this test advances time like the real thing would.
  let now = "2026-09-02T02:00:00.000Z";
  const svc = new ReviewGateService(store, auth, () => now);
  await svc.createCandidate(who("claude"), { candidateId: "c9", binding: binding() });
  await svc.recordTestExecution(who("ci"), {
    candidateId: "c9", occurrenceId: "ev0", billingClass: "INTERNAL_QA_TEST",
    evidenceId: "ev-c9-1", resultDigest: dig("2"),
    runnerIdentity: "ci-runner", runReference: "run/ev-c9-1",
  });

  const step = async (to: string, id: string, actor = "claude") => {
    const r = await svc.transition(who(actor), {
      candidateId: "c9", occurrenceId: id, billingClass: "INTERNAL_QA_TEST", to: to as never,
    });
    assert.equal(r.ok, true, `${to} should have applied: ${JSON.stringify(r)}`);
  };

  for (const [to, id] of [["TESTED", "s1"], ["FROZEN", "s2"], ["REVIEW_REQUESTED", "s3"]] as const) {
    await step(to, id);
  }
  await step("REVIEW_IN_PROGRESS", "s4", "codex");

  // codex reviews honestly and rejects.
  const nogo = await svc.submitVerdict(who("codex"), {
    candidateId: "c9", occurrenceId: "s5", billingClass: "INTERNAL_REVIEW",
    verdict: {
      candidateDigest: candidateDigest(binding()), reviewerIdentity: "codex", verdict: "NO_GO",
      findings: [{ id: "C1", severity: "CRITICAL", summary: "a real defect" }],
      submittedAt: "2026-09-02T01:00:00.000Z",
    },
  });
  assert.equal(nogo.ok, true, `NO_GO should have applied: ${JSON.stringify(nogo)}`);

  // codex now fixes it themselves. THIS is where the round-2 bypass lived: the caller chose whether to
  // record the role, so codex simply did not, and stayed "reviewer only" in the ledger.
  await step("REMEDIATION_REQUIRED", "s6", "codex");
  await step("REMEDIATING", "s7", "codex");
  await step("RETEST_REQUIRED", "s8", "codex");
  now = "2026-09-02T04:00:00.000Z";
  // The retest needs its own evidence: the run recorded before the remediation no longer counts.
  await svc.recordTestExecution(who("ci"), {
    candidateId: "c9", occurrenceId: "ev1", billingClass: "INTERNAL_QA_TEST",
    evidenceId: "ev-c9-2", resultDigest: dig("2"),
    runnerIdentity: "ci-runner", runReference: "run/ev-c9-2",
  });
  await step("TESTED", "s9", "codex");
  await step("FROZEN", "s10", "codex");
  await step("REVIEW_REQUESTED", "s11", "codex");
  await step("REVIEW_IN_PROGRESS", "s12", "codex");


  const record = await store.load("c9");
  assert.ok(record!.participants.some((p) => p.identity === "codex" && p.role === "remediator"),
    "the REMEDIATING move must have written a remediator row without being asked to");

  // and now the payoff: codex approves the work codex fixed.
  const selfApproval = await svc.submitVerdict(who("codex"), {
    candidateId: "c9", occurrenceId: "s13", billingClass: "INTERNAL_REVIEW",
    verdict: {
      candidateDigest: candidateDigest(binding()), reviewerIdentity: "codex", verdict: "GO",
      findings: [], submittedAt: "2026-09-02T01:45:00.000Z",
    },
  });
  assert.equal(selfApproval.ok, false, "a remediator must not be able to approve their own remediation");
  // ROUND 4 CHANGED WHICH GUARD FIRES FIRST, and the honest thing is to assert what actually stops it.
  // A rejected digest can no longer reach GO at all, so this walk is refused before independence is
  // even consulted. Both guards are real; this path now meets the stricter one first. Independence is
  // asserted on its own in "an author cannot submit a verdict naming an uninvolved reviewer" and in the
  // ledger test above, so nothing is left uncovered by the change.
  assert.equal((selfApproval as { code: string }).code, "content_already_rejected");
});

// CRITICAL-2 (round 3). Identity used to be a principal the caller constructed, and the package exported
// the minting function, so a consumer could mint the uninvolved reviewer named in the verdict. Operations
// now take an opaque proof and the service mints through the injected authenticator.
test("C2: a structurally identical fake principal is rejected at runtime", async () => {
  const { svc } = await seeded("REVIEW_IN_PROGRESS");
  // The forgery that used to work in plain JavaScript, and through a TypeScript `as` assertion.
  const forged = { identity: "codex" };
  const result = await svc.submitVerdict(forged, {
    candidateId: "c1", occurrenceId: "f1", billingClass: "INTERNAL_REVIEW",
    verdict: {
      candidateDigest: candidateDigest(binding()), reviewerIdentity: "codex",
      verdict: "GO", findings: [], submittedAt: "2026-09-02T01:30:00.000Z",
    },
  });
  assert.equal(result.ok, false);
  assert.equal((result as { code: string }).code, "unauthenticated");
});

test("C2: only this module can mint a principal, and the brand proves it", () => {
  const real = TrustedPrincipal.mint(auth, { userId: "codex" });
  assert.ok(real && TrustedPrincipal.isTrusted(real), "a minted principal must carry the brand");
  // Object.create defeats a naive `instanceof`-only check; the WeakSet is what catches it.
  const lookalike = Object.create(TrustedPrincipal.prototype);
  Object.defineProperty(lookalike, "identity", { value: "codex" });
  assert.equal(lookalike instanceof TrustedPrincipal, true, "the look-alike does pass instanceof");
  assert.equal(TrustedPrincipal.isTrusted(lookalike), false, "...and must still fail the brand check");
});

test("C2: an authenticator that throws denies rather than authenticating by accident", async () => {
  const hostile: SessionAuthenticator = { authenticate() { throw new Error("session store down"); } };
  const svc = new ReviewGateService(new InMemoryReviewGateStore(), hostile);
  const result = await svc.createCandidate(who("claude"), { candidateId: "c8", binding: binding() });
  assert.equal(result.ok, false);
  assert.equal((result as { code: string }).code, "unauthenticated");
});

test("C2: an empty or unrecognised proof establishes no identity", async () => {
  const { svc } = await seeded();
  for (const proof of [null, undefined, {}, { userId: "" }, { userId: "   " }, "codex", 42]) {
    const result = await svc.transition(proof, {
      candidateId: "c1", occurrenceId: `u-${String(proof)}`, billingClass: "INTERNAL_QA_TEST", to: "TESTED",
    });
    assert.equal(result.ok, false, `proof ${JSON.stringify(proof)} must not authenticate`);
    assert.equal((result as { code: string }).code, "unauthenticated");
  }
});

// MINOR (round 3): the future-dated verdict correction had no regression test, only an implementation.
test("MO1: a future-dated verdict is refused rather than counted as freshly submitted", async () => {
  const { svc } = await seeded("REVIEW_IN_PROGRESS");
  const result = await svc.submitVerdict(who("codex"), {
    candidateId: "c1", occurrenceId: "fut", billingClass: "INTERNAL_REVIEW",
    verdict: {
      candidateDigest: candidateDigest(binding()), reviewerIdentity: "codex", verdict: "GO",
      findings: [], submittedAt: "2026-09-05T00:00:00.000Z", // clock reads 02:00 on the 2nd
    },
  });
  assert.equal(result.ok, false, "a verdict from the future must not pass the staleness check");
});

test("MO1: a verdict inside the clock-skew allowance is still accepted", async () => {
  const { svc } = await seeded("REVIEW_IN_PROGRESS");
  // Two minutes ahead of the 02:00 clock: within the five-minute allowance, so the fix must not have
  // turned skew tolerance into a blanket refusal.
  const result = await svc.submitVerdict(who("codex"), {
    candidateId: "c1", occurrenceId: "skew", billingClass: "INTERNAL_REVIEW",
    verdict: {
      candidateDigest: candidateDigest(binding()), reviewerIdentity: "codex", verdict: "GO",
      findings: [], submittedAt: "2026-09-02T02:02:00.000Z",
    },
  });
  assert.equal(result.ok, true, `modest skew must still be accepted: ${JSON.stringify(result)}`);
});

// ── round-4 CRITICAL: TESTED was an assertion, not a recorded fact ────────────────────────────────────

test("C4: BUILT -> TESTED is refused when no test execution was ever recorded", async () => {
  const store = new InMemoryReviewGateStore();
  const svc = new ReviewGateService(store, auth, () => "2026-09-02T02:00:00.000Z");
  // A binding whose testResultDigest is a perfectly well-formed 64-character hex string that the author
  // simply invented. Before round 4 this reached TESTED, because nothing compared it to anything.
  await svc.createCandidate(who("claude"), { candidateId: "e1", binding: binding() });
  const result = await svc.transition(who("claude"), {
    candidateId: "e1", occurrenceId: "x", billingClass: "INTERNAL_QA_TEST", to: "TESTED",
  });
  assert.equal(result.ok, false, "an invented digest must not carry a candidate into TESTED");
  assert.equal((result as { code: string }).code, "no_test_evidence");
});

test("C4: evidence for a DIFFERENT digest does not test this candidate", async () => {
  const store = new InMemoryReviewGateStore();
  const svc = new ReviewGateService(store, auth, () => "2026-09-02T02:00:00.000Z");
  await svc.createCandidate(who("claude"), { candidateId: "e2", binding: binding() });
  // A real recorded run — of something else. The gate must not accept "a test happened" as "this
  // candidate was tested".
  await svc.recordTestExecution(who("ci"), {
    candidateId: "e2", occurrenceId: "ev", billingClass: "INTERNAL_QA_TEST",
    evidenceId: "ev-other", resultDigest: dig("9"),
    runnerIdentity: "ci-runner", runReference: "run/ev-other",
  });
  const result = await svc.transition(who("claude"), {
    candidateId: "e2", occurrenceId: "x", billingClass: "INTERNAL_QA_TEST", to: "TESTED",
  });
  assert.equal(result.ok, false);
  assert.equal((result as { code: string }).code, "no_test_evidence");
});

test("C4: recorded evidence for the bound digest does let the candidate reach TESTED", async () => {
  // The counterpart. A gate that refused everything would satisfy the two tests above.
  const store = new InMemoryReviewGateStore();
  const svc = new ReviewGateService(store, auth, () => "2026-09-02T02:00:00.000Z");
  await svc.createCandidate(who("claude"), { candidateId: "e3", binding: binding() });
  await svc.recordTestExecution(who("ci"), {
    candidateId: "e3", occurrenceId: "ev", billingClass: "INTERNAL_QA_TEST",
    evidenceId: "ev-e3", resultDigest: dig("2"),
    runnerIdentity: "ci-runner", runReference: "run/ev-e3",
  });
  const result = await svc.transition(who("claude"), {
    candidateId: "e3", occurrenceId: "x", billingClass: "INTERNAL_QA_TEST", to: "TESTED",
  });
  assert.equal(result.ok, true, `matching evidence must permit TESTED: ${JSON.stringify(result)}`);
});

test("C4: a replayed evidence id is refused rather than counted twice", async () => {
  const store = new InMemoryReviewGateStore();
  const svc = new ReviewGateService(store, auth, () => "2026-09-02T02:00:00.000Z");
  await svc.createCandidate(who("claude"), { candidateId: "e4", binding: binding() });
  const once = { candidateId: "e4", occurrenceId: "ev", billingClass: "INTERNAL_QA_TEST" as const,
    evidenceId: "ev-dup", resultDigest: dig("2"),
    runnerIdentity: "ci-runner", runReference: "run/dup" };
  assert.equal((await svc.recordTestExecution(who("ci"), once)).ok, true);
  const replay = await svc.recordTestExecution(who("ci"), once);
  assert.equal(replay.ok, false);
  assert.equal((replay as { code: string }).code, "evidence_replayed");
});

// ── round-4 CRITICAL: a rejected candidate could be re-approved unchanged ─────────────────────────────

test("C4/C5: rejected CONTENT can never reach GO, even from a second reviewer", async () => {
  // The payoff step of the round-4 attack. The first reviewer rejects; the loop is walked without a line
  // of code changing; a DIFFERENT, genuinely independent reviewer approves the identical content.
  const store = new InMemoryReviewGateStore();
  let now = "2026-09-02T02:00:00.000Z";
  const svc = new ReviewGateService(store, auth, () => now);
  await svc.createCandidate(who("claude"), { candidateId: "r1", binding: binding() });
  await svc.recordTestExecution(who("ci"), {
    candidateId: "r1", occurrenceId: "ev", billingClass: "INTERNAL_QA_TEST",
    evidenceId: "ev-r1", resultDigest: dig("2"),
    runnerIdentity: "ci-runner", runReference: "run/ev-r1",
  });
  for (const [to, id] of [["TESTED", "a"], ["FROZEN", "b"], ["REVIEW_REQUESTED", "c"],
    ["REVIEW_IN_PROGRESS", "d"]] as const) {
    const r = await svc.transition(who(to === "REVIEW_IN_PROGRESS" ? "codex" : "claude"), {
      candidateId: "r1", occurrenceId: id, billingClass: "INTERNAL_QA_TEST", to: to as never });
    assert.equal(r.ok, true, `${to}: ${JSON.stringify(r)}`);
  }
  const rejected = await svc.submitVerdict(who("codex"), {
    candidateId: "r1", occurrenceId: "v1", billingClass: "INTERNAL_REVIEW",
    verdict: {
      candidateDigest: candidateDigest(binding()), reviewerIdentity: "codex", verdict: "NO_GO",
      findings: [{ id: "F1", severity: "CRITICAL", summary: "a real defect" }],
      submittedAt: "2026-09-02T01:00:00.000Z",
    },
  });
  assert.equal(rejected.ok, true);

  // walk back round without changing anything
  for (const [to, id] of [["REMEDIATION_REQUIRED", "e"], ["REMEDIATING", "f"],
    ["RETEST_REQUIRED", "g"]] as const) {
    const r = await svc.transition(who("claude"), {
      candidateId: "r1", occurrenceId: id, billingClass: "INTERNAL_QA_TEST", to: to as never });
    assert.equal(r.ok, true, `${to}: ${JSON.stringify(r)}`);
  }
  now = "2026-09-02T04:00:00.000Z";
  await svc.recordTestExecution(who("ci"), {
    candidateId: "r1", occurrenceId: "ev2", billingClass: "INTERNAL_QA_TEST",
    evidenceId: "ev-r1-2", resultDigest: dig("2"),
    runnerIdentity: "ci-runner", runReference: "run/ev-r1-2",
  });
  for (const [to, id] of [["TESTED", "h"], ["FROZEN", "i"], ["REVIEW_REQUESTED", "j"],
    ["REVIEW_IN_PROGRESS", "k"]] as const) {
    const r = await svc.transition(who(to === "REVIEW_IN_PROGRESS" ? "codex" : "claude"), {
      candidateId: "r1", occurrenceId: id, billingClass: "INTERNAL_QA_TEST", to: to as never });
    assert.equal(r.ok, true, `${to}: ${JSON.stringify(r)}`);
  }
  // "dana" has no prior participation at all, so independence alone cannot stop this one.
  const reApproval = await svc.submitVerdict(who("dana"), {
    candidateId: "r1", occurrenceId: "v2", billingClass: "INTERNAL_REVIEW",
    verdict: {
      candidateDigest: candidateDigest(binding()), reviewerIdentity: "dana", verdict: "GO",
      findings: [], submittedAt: "2026-09-02T01:50:00.000Z",
    },
  });
  assert.equal(reApproval.ok, false, "identical content that was rejected must not be approvable");
  assert.equal((reApproval as { code: string }).code, "content_already_rejected");
});

test("C4: a retest cannot lean on evidence recorded before the remediation", async () => {
  const store = new InMemoryReviewGateStore();
  let now = "2026-09-02T02:00:00.000Z";
  const svc = new ReviewGateService(store, auth, () => now);
  await svc.createCandidate(who("claude"), { candidateId: "r2", binding: binding() });
  await svc.recordTestExecution(who("ci"), {
    candidateId: "r2", occurrenceId: "ev", billingClass: "INTERNAL_QA_TEST",
    evidenceId: "ev-r2", resultDigest: dig("2"),
    runnerIdentity: "ci-runner", runReference: "run/ev-r2",
  });
  const go = async (to: string, id: string) => {
    const r = await svc.transition(who("claude"), {
      candidateId: "r2", occurrenceId: id, billingClass: "INTERNAL_QA_TEST", to: to as never });
    assert.equal(r.ok, true, `${to}: ${JSON.stringify(r)}`);
  };
  await go("TEST_FAILED", "a");
  now = "2026-09-02T03:00:00.000Z";
  await go("REMEDIATION_REQUIRED", "b");
  await go("REMEDIATING", "c");
  await go("RETEST_REQUIRED", "d");
  // The only evidence on file predates the remediation, so it cannot evidence the retest.
  const stale = await svc.transition(who("claude"), {
    candidateId: "r2", occurrenceId: "e", billingClass: "INTERNAL_QA_TEST", to: "TESTED",
  });
  assert.equal(stale.ok, false);
  assert.equal((stale as { code: string }).code, "stale_test_evidence");
});

// ── successors: the legitimate way out of a NO_GO ─────────────────────────────────────────────────────

/** Drive a candidate all the way to a genuine NO_GO, which is the only honest starting point for a successor. */
async function rejected(id: string, over: Partial<CandidateBinding> = {}) {
  const store = new InMemoryReviewGateStore();
  const svc = new ReviewGateService(store, auth, () => "2026-09-02T02:00:00.000Z");
  const b = binding(over);
  await svc.createCandidate(who("claude"), { candidateId: id, binding: b });
  await svc.recordTestExecution(who("ci"), {
    candidateId: id, occurrenceId: "ev", billingClass: "INTERNAL_QA_TEST",
    evidenceId: `ev-${id}`, resultDigest: b.testResultDigest,
    runnerIdentity: "ci-runner", runReference: `run/${id}`,
  });
  for (const [to, occ] of [["TESTED", "p1"], ["FROZEN", "p2"], ["REVIEW_REQUESTED", "p3"],
    ["REVIEW_IN_PROGRESS", "p4"]] as const) {
    const r = await svc.transition(who(to === "REVIEW_IN_PROGRESS" ? "codex" : "claude"), {
      candidateId: id, occurrenceId: occ, billingClass: "INTERNAL_QA_TEST", to: to as never });
    assert.equal(r.ok, true, `${to}: ${JSON.stringify(r)}`);
  }
  const verdict = await svc.submitVerdict(who("codex"), {
    candidateId: id, occurrenceId: "p5", billingClass: "INTERNAL_REVIEW",
    verdict: {
      candidateDigest: candidateDigest(b), reviewerIdentity: "codex", verdict: "NO_GO",
      findings: [{ id: "F1", severity: "CRITICAL", summary: "a real defect" }],
      submittedAt: "2026-09-02T01:00:00.000Z",
    },
  });
  assert.equal(verdict.ok, true, `NO_GO: ${JSON.stringify(verdict)}`);
  return { store, svc, binding: b };
}

test("C5-3: a successor changing only paperwork is not a remediation", async () => {
  const { svc } = await rejected("s1");
  // The round-5 attack: identical work, a different createdAt and occurrenceId. candidateDigest differs,
  // so the previous implementation accepted this as a new candidate with no rejection history.
  const paperworkOnly = await svc.createSuccessor(who("claude"), {
    candidateId: "s2", supersedes: "s1",
    binding: binding({ createdAt: "2026-09-02T09:00:00.000Z", occurrenceId: "occ-different" }),
  });
  assert.equal(paperworkOnly.ok, false, "a new timestamp is not a fix");
  assert.equal((paperworkOnly as { code: string }).code, "successor_identical");
});

test("C5-3: re-running the tests on untouched code is not a remediation either", async () => {
  const { svc } = await rejected("s1b");
  // testResultDigest is part of candidateDigest but NOT of contentDigest, precisely so that this fails.
  const rerun = await svc.createSuccessor(who("claude"), {
    candidateId: "s2b", supersedes: "s1b", binding: binding({ testResultDigest: dig("8") }),
  });
  assert.equal(rerun.ok, false, "a green re-run of the same code does not remediate anything");
  assert.equal((rerun as { code: string }).code, "successor_identical");
});

test("C5-2: rejected content cannot be re-registered under a fresh candidate id", async () => {
  // The round-5 CRITICAL in its simplest form: skip the successor API entirely and just register the
  // same binding again under a new id. The old rejection lived in one record's occurrence history, so
  // the new record had none.
  const { svc } = await rejected("s1c");
  const relabelled = await svc.createCandidate(who("claude"), {
    candidateId: "totally-different-id", binding: binding(),
  });
  assert.equal(relabelled.ok, false, "a new candidate id must not launder rejected content");
  assert.equal((relabelled as { code: string }).code, "content_already_rejected");
});

test("M5-1: a stranger cannot claim to supersede someone else's candidate", async () => {
  const { svc } = await rejected("s1d");
  const stranger = await svc.createSuccessor(who("mallory"), {
    candidateId: "s2d", supersedes: "s1d",
    binding: binding({ authorIdentity: "mallory", candidateCommit: oid("e") }),
  });
  assert.equal(stranger.ok, false, "only a participant may register a successor");
  assert.equal((stranger as { code: string }).code, "successor_actor_uninvolved");
});

test("M5-1: a successor must stay within the same project and repository", async () => {
  const { svc } = await rejected("s1e");
  const elsewhere = await svc.createSuccessor(who("claude"), {
    candidateId: "s2e", supersedes: "s1e",
    binding: binding({ candidateCommit: oid("e"), repository: "someone-else/other-repo" }),
  });
  assert.equal(elsewhere.ok, false);
  assert.equal((elsewhere as { code: string }).code, "successor_lineage_mismatch");
});

test("M5-1: a candidate still under review has nothing to supersede", async () => {
  const store = new InMemoryReviewGateStore();
  const svc = new ReviewGateService(store, auth, () => "2026-09-02T02:00:00.000Z");
  await svc.createCandidate(who("claude"), { candidateId: "live", binding: binding() });
  const premature = await svc.createSuccessor(who("claude"), {
    candidateId: "live2", supersedes: "live", binding: binding({ candidateCommit: oid("e") }),
  });
  assert.equal(premature.ok, false, "BUILT is not awaiting remediation");
  assert.equal((premature as { code: string }).code, "prior_not_supersedable");
});

test("C4: a genuine successor is registered and records what it replaces", async () => {
  // The counterpart to all six refusals above. Real remediation -- a different commit and tree -- must
  // still work, or the gate has simply become a wall.
  const { store, svc } = await rejected("s3");
  const fixed = binding({ candidateCommit: oid("d"), candidateTree: oid("e"), testResultDigest: dig("7") });
  const successor = await svc.createSuccessor(who("claude"), {
    candidateId: "s4", supersedes: "s3", binding: fixed, remediates: ["F1"],
  });
  assert.equal(successor.ok, true, `a changed candidate must register: ${JSON.stringify(successor)}`);
  const record = await store.load("s4");
  assert.equal(record!.supersedes, "s3", "lineage must be recorded, not left to a commit message");
  assert.notEqual(record!.digest, (await store.load("s3"))!.digest);
  assert.equal(record!.state, "BUILT", "a successor starts at the beginning; it inherits no progress");
});


// ── round-5: evidence is separated from authorship, though still not provenance ───────────────────────

test("C5-1: the author of a candidate cannot record its test evidence", async () => {
  // Round 5's CRITICAL: the author invents a testResultDigest, then records evidence for that same
  // invented value. Persistence had been added; provenance had not. This does not add provenance either
  // -- it forces a SECOND authenticated party to make the assertion, which is separation of duties.
  const store = new InMemoryReviewGateStore();
  const svc = new ReviewGateService(store, auth, () => "2026-09-02T02:00:00.000Z");
  await svc.createCandidate(who("claude"), { candidateId: "sd1", binding: binding() });
  const selfAttested = await svc.recordTestExecution(who("claude"), {
    candidateId: "sd1", occurrenceId: "ev", billingClass: "INTERNAL_QA_TEST",
    evidenceId: "ev-self", resultDigest: dig("2"),
    runnerIdentity: "ci-runner", runReference: "run/1",
  });
  assert.equal(selfAttested.ok, false, "self-attested evidence must be refused");
  assert.equal((selfAttested as { code: string }).code, "evidence_actor_is_author");
});

test("C5-1: evidence must name where the run happened", async () => {
  const store = new InMemoryReviewGateStore();
  const svc = new ReviewGateService(store, auth, () => "2026-09-02T02:00:00.000Z");
  await svc.createCandidate(who("claude"), { candidateId: "sd2", binding: binding() });
  for (const missing of ["runnerIdentity", "runReference"] as const) {
    const input: Record<string, unknown> = {
      candidateId: "sd2", occurrenceId: "ev-" + missing, billingClass: "INTERNAL_QA_TEST",
      evidenceId: "ev-" + missing, resultDigest: dig("2"),
      runnerIdentity: "ci-runner", runReference: "run/1",
    };
    delete input[missing];
    const result = await svc.recordTestExecution(who("ci"), input as never);
    assert.equal(result.ok, false, missing + " must be required");
    assert.equal((result as { code: string }).code, "malformed_input");
  }
});

test("C5-1: a recorded run names the runner, the run and the content it applies to", async () => {
  // The counterpart, and the honest limit of this fix: what is stored is an assertion by an
  // authenticated second party, with a reference someone can go and check. It is not a signed result.
  const store = new InMemoryReviewGateStore();
  const svc = new ReviewGateService(store, auth, () => "2026-09-02T02:00:00.000Z");
  await svc.createCandidate(who("claude"), { candidateId: "sd3", binding: binding() });
  const ok = await svc.recordTestExecution(who("ci"), {
    candidateId: "sd3", occurrenceId: "ev", billingClass: "INTERNAL_QA_TEST",
    evidenceId: "ev-sd3", resultDigest: dig("2"),
    runnerIdentity: "github-actions", runReference: "actions/runs/12345",
  });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  const [record] = await store.loadEvidence("sd3");
  assert.equal(record.runnerIdentity, "github-actions");
  assert.equal(record.runReference, "actions/runs/12345");
  assert.equal(record.recordedBy, "ci");
  assert.notEqual(record.recordedBy, binding().authorIdentity, "the recorder is not the author");
  assert.equal(record.contentDigest, (await store.load("sd3"))!.contentDigest,
    "evidence is pinned to the content it was recorded against");
});

// ── round-6 findings ─────────────────────────────────────────────────────────────────────────────────

/** Drive a candidate to REVIEW_IN_PROGRESS on its own store, so two can be raced against each other. */
async function ready(store: InMemoryReviewGateStore, svc: ReviewGateService, id: string,
                     b = binding()) {
  await svc.createCandidate(who("claude"), { candidateId: id, binding: b });
  await svc.recordTestExecution(who("ci"), {
    candidateId: id, occurrenceId: `ev-${id}`, billingClass: "INTERNAL_QA_TEST",
    evidenceId: `evid-${id}`, resultDigest: b.testResultDigest,
    runnerIdentity: "ci-runner", runReference: `run/${id}`,
  });
  for (const [to, occ] of [["TESTED", "1"], ["FROZEN", "2"], ["REVIEW_REQUESTED", "3"],
    ["REVIEW_IN_PROGRESS", "4"]] as const) {
    const r = await svc.transition(who(to === "REVIEW_IN_PROGRESS" ? "codex" : "claude"), {
      candidateId: id, occurrenceId: `${id}-${occ}`, billingClass: "INTERNAL_QA_TEST", to: to as never });
    assert.equal(r.ok, true, `${id} ${to}: ${JSON.stringify(r)}`);
  }
}

test("C7: a second live candidate cannot carry content that is already live", async () => {
  // ROUND 7's CRITICAL, and it is why these tests changed shape. The previous version raced a GO on one
  // twin against a NO_GO on its identical twin, and asserted that the late owner transition failed. Codex
  // pointed out the ordering that assertion missed: move the approved twin to READY_FOR_OWNER_DECISION
  // FIRST, then reject the other. That state is terminal, so nothing could revoke it -- the same work
  // ended up permanently awaiting the owner AND recorded as rejected.
  //
  // Per-operation atomicity cannot fix that: it establishes ordering, it cannot make a later fact undo an
  // earlier terminal decision. So the contradiction is now PREVENTED rather than resolved. Twins cannot
  // both be live, so there is no second record from which to disagree.
  const store = new InMemoryReviewGateStore();
  const svc = new ReviewGateService(store, auth, () => "2026-09-02T02:00:00.000Z");
  const shared = binding();
  await ready(store, svc, "twinA", shared);
  const twin = await svc.createCandidate(who("claude"), { candidateId: "twinB", binding: shared });
  assert.equal(twin.ok, false, "the twin that made the contradiction possible cannot be registered");
  assert.equal((twin as { code: string }).code, "content_already_live");
});

test("C7: the ordering Codex identified is now unreachable, not merely refused", async () => {
  // Walk the attack as far as it can still go: approve, advance to owner decision, then try to set up
  // the rejecting twin. The setup itself is what fails, which is stronger than catching it at the end.
  const store = new InMemoryReviewGateStore();
  const svc = new ReviewGateService(store, auth, () => "2026-09-02T02:00:00.000Z");
  const shared = binding();
  await ready(store, svc, "ownA", shared);
  const approved = await svc.submitVerdict(who("codex"), {
    candidateId: "ownA", occurrenceId: "v", billingClass: "INTERNAL_REVIEW",
    verdict: {
      candidateDigest: candidateDigest(shared), reviewerIdentity: "codex", verdict: "GO",
      findings: [], submittedAt: "2026-09-02T01:00:00.000Z",
    },
  });
  assert.equal(approved.ok, true, JSON.stringify(approved));
  const owner = await svc.transition(who("claude"), {
    candidateId: "ownA", occurrenceId: "own", billingClass: "INTERNAL_QA_TEST",
    to: "READY_FOR_OWNER_DECISION",
  });
  assert.equal(owner.ok, true, `the honest path must still work: ${JSON.stringify(owner)}`);
  assert.equal((await store.load("ownA"))!.state, "READY_FOR_OWNER_DECISION");

  // Now the step the previous design allowed: register the twin that would reject the same content.
  const rejecter = await svc.createCandidate(who("claude"), { candidateId: "ownB", binding: shared });
  assert.equal(rejecter.ok, false,
    "content awaiting the owner must not be re-registerable, or a later NO_GO would contradict it");
  assert.equal((rejecter as { code: string }).code, "content_already_live");
});

test("C7: cancelling releases the content claim, so abandoned work can be resubmitted", async () => {
  // The counterpart. If holding the claim forever were the rule, cancelling a candidate would
  // permanently bar its content, and the gate would be a trap rather than a control.
  const store = new InMemoryReviewGateStore();
  const svc = new ReviewGateService(store, auth, () => "2026-09-02T02:00:00.000Z");
  const b = binding();
  await svc.createCandidate(who("claude"), { candidateId: "relA", binding: b });
  const blocked = await svc.createCandidate(who("claude"), { candidateId: "relB", binding: b });
  assert.equal(blocked.ok, false, "while relA is live the content is claimed");

  const cancelled = await svc.transition(who("claude"), {
    candidateId: "relA", occurrenceId: "c", billingClass: "INTERNAL_QA_TEST", to: "CANCELLED" });
  assert.equal(cancelled.ok, true, JSON.stringify(cancelled));
  const retry = await svc.createCandidate(who("claude"), { candidateId: "relB", binding: b });
  assert.equal(retry.ok, true, `cancelling must release the claim: ${JSON.stringify(retry)}`);
});

test("C7: a rejection still bars the content even though NO_GO releases nothing", async () => {
  // CANCELLED and EXPIRED release the claim; NO_GO does not need to, because the rejection ledger takes
  // over. Both mechanisms are needed and this proves the handover between them.
  const { svc } = await rejected("barA");
  const retry = await svc.createCandidate(who("claude"), { candidateId: "barB", binding: binding() });
  assert.equal(retry.ok, false);
  assert.equal((retry as { code: string }).code, "content_already_rejected");
});

test("C6-2: editing the test plan label is not a remediation", async () => {
  // The round-6 CRITICAL: testPlanVersion used to count as work, so tp-1 -> tp-2 laundered an identical
  // defective artifact through the successor check.
  const { svc } = await rejected("tp1");
  const relabelled = await svc.createSuccessor(who("claude"), {
    candidateId: "tp2", supersedes: "tp1", binding: binding({ testPlanVersion: "tp-2" }),
  });
  assert.equal(relabelled.ok, false, "a different test plan label is not different work");
  assert.equal((relabelled as { code: string }).code, "successor_identical");
});

test("M6-1: a stranger cannot self-enrol as a participant and then supersede", async () => {
  // The loophole was mine: the REVIEW_REQUESTED transition writes a requester row for whoever performs
  // it, and any authenticated identity could perform it. So a stranger self-enrolled, cancelled the
  // candidate, and superseded it -- entirely through legal moves.
  const store = new InMemoryReviewGateStore();
  const svc = new ReviewGateService(store, auth, () => "2026-09-02T02:00:00.000Z");
  await svc.createCandidate(who("claude"), { candidateId: "own1", binding: binding() });
  const enrol = await svc.transition(who("mallory"), {
    candidateId: "own1", occurrenceId: "m1", billingClass: "INTERNAL_QA_TEST", to: "TESTED",
  });
  assert.equal(enrol.ok, false, "a stranger must not be able to move somebody else's candidate");
  assert.equal((enrol as { code: string }).code, "actor_not_participant");
  const record = await store.load("own1");
  assert.equal(record!.participants.some((p) => p.identity === "mallory"), false,
    "and must not have written themselves into the ledger by trying");
});

test("M6-1: only the author or a recorded remediator may replace a rejected candidate", async () => {
  const { store, svc } = await rejected("resp1");
  // codex reviewed it, so codex IS a participant -- but a reviewer is not the party responsible for
  // the work, and letting a reviewer author the replacement is how independence gets laundered.
  assert.ok((await store.load("resp1"))!.participants.some((p) => p.identity === "codex"),
    "the premise: codex is a participant on this candidate");
  const byReviewer = await svc.createSuccessor(who("codex"), {
    candidateId: "resp2", supersedes: "resp1",
    binding: binding({ authorIdentity: "codex", candidateCommit: oid("e") }),
  });
  assert.equal(byReviewer.ok, false, "a reviewer is a participant but not the responsible party");
  assert.equal((byReviewer as { code: string }).code, "successor_actor_uninvolved");
});

test("M6-1: an independent reviewer can still claim a review they have no prior link to", async () => {
  // The counterpart. Requiring participation to move a candidate would break the one case where a
  // stranger legitimately arrives: an independent reviewer picking up REVIEW_REQUESTED.
  const store = new InMemoryReviewGateStore();
  const svc = new ReviewGateService(store, auth, () => "2026-09-02T02:00:00.000Z");
  const b = binding();
  await svc.createCandidate(who("claude"), { candidateId: "claim1", binding: b });
  await svc.recordTestExecution(who("ci"), {
    candidateId: "claim1", occurrenceId: "ev", billingClass: "INTERNAL_QA_TEST",
    evidenceId: "ev-claim1", resultDigest: b.testResultDigest,
    runnerIdentity: "ci-runner", runReference: "run/claim1",
  });
  for (const [to, occ] of [["TESTED", "1"], ["FROZEN", "2"], ["REVIEW_REQUESTED", "3"]] as const) {
    const r = await svc.transition(who("claude"), {
      candidateId: "claim1", occurrenceId: occ, billingClass: "INTERNAL_QA_TEST", to: to as never });
    assert.equal(r.ok, true, `${to}: ${JSON.stringify(r)}`);
  }
  const claimed = await svc.transition(who("codex"), {
    candidateId: "claim1", occurrenceId: "claim", billingClass: "INTERNAL_REVIEW",
    to: "REVIEW_IN_PROGRESS",
  });
  assert.equal(claimed.ok, true, `a reviewer must be able to claim a review: ${JSON.stringify(claimed)}`);
  const record = await store.load("claim1");
  assert.equal(record!.participants.some((p) => p.identity === "codex"), false,
    "claiming a review grants no role, so it cannot be used to enrol");
});

// ── round-7 MAJOR: remediation now has to answer the findings, not just differ ────────────────────────

test("C7: findings survive the verdict that raised them", async () => {
  // The system used to evaluate a verdict, commit its transition, and discard its content. You cannot
  // establish that a finding was addressed if you did not keep the finding -- which is why three rounds
  // of digest comparison kept failing to express "remediated".
  const { store } = await rejected("keep1");
  const record = await store.load("keep1");
  assert.equal(record!.verdicts.length, 1, "the verdict must be on the record");
  const [stored] = record!.verdicts;
  assert.equal(stored.verdict, "NO_GO");
  assert.equal(stored.reviewerIdentity, "codex");
  assert.deepEqual(stored.findings.map((f) => f.id), ["F1"]);
  assert.equal(stored.findings[0].severity, "CRITICAL");
});

test("C7: a successor must address every blocking finding it inherits", async () => {
  const { svc } = await rejected("addr1");
  const silent = await svc.createSuccessor(who("claude"), {
    candidateId: "addr2", supersedes: "addr1",
    binding: binding({ candidateCommit: oid("d"), candidateTree: oid("e") }),
    // remediates omitted entirely: real code change, no claim about what it fixes
  });
  assert.equal(silent.ok, false, "changing code is not the same as addressing the finding");
  assert.equal((silent as { code: string }).code, "findings_unaddressed");
});

test("C7: a successor cannot claim to have fixed a finding that was never raised", async () => {
  const { svc } = await rejected("inv1");
  const invented = await svc.createSuccessor(who("claude"), {
    candidateId: "inv2", supersedes: "inv1",
    binding: binding({ candidateCommit: oid("d"), candidateTree: oid("e") }),
    remediates: ["F1", "F-DOES-NOT-EXIST"],
  });
  assert.equal(invented.ok, false, "a remediation claim must reference a real finding");
  assert.equal((invented as { code: string }).code, "findings_unknown");
});

test("C7: the remediation claim is recorded, not merely checked and forgotten", async () => {
  const { store, svc } = await rejected("rec1");
  const ok = await svc.createSuccessor(who("claude"), {
    candidateId: "rec2", supersedes: "rec1",
    binding: binding({ candidateCommit: oid("d"), candidateTree: oid("e") }),
    remediates: ["F1"],
  });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  const record = await store.load("rec2");
  assert.deepEqual([...record!.remediates!], ["F1"],
    "what a successor claims to fix is part of the lineage, not a transient argument");
  assert.equal(record!.supersedes, "rec1");
});

test("C7: an OBSERVATION does not block a successor, but a MAJOR does", async () => {
  // The severity split has to be real in both directions, or it is just a list.
  const store = new InMemoryReviewGateStore();
  const svc = new ReviewGateService(store, auth, () => "2026-09-02T02:00:00.000Z");
  const b = binding({ candidateCommit: oid("7"), candidateTree: oid("7") });
  await svc.createCandidate(who("claude"), { candidateId: "sev1", binding: b });
  await svc.recordTestExecution(who("ci"), {
    candidateId: "sev1", occurrenceId: "ev", billingClass: "INTERNAL_QA_TEST",
    evidenceId: "ev-sev1", resultDigest: b.testResultDigest,
    runnerIdentity: "ci-runner", runReference: "run/sev1",
  });
  for (const [to, occ] of [["TESTED", "1"], ["FROZEN", "2"], ["REVIEW_REQUESTED", "3"]] as const) {
    await svc.transition(who("claude"), {
      candidateId: "sev1", occurrenceId: occ, billingClass: "INTERNAL_QA_TEST", to: to as never });
  }
  await svc.transition(who("codex"), {
    candidateId: "sev1", occurrenceId: "4", billingClass: "INTERNAL_REVIEW", to: "REVIEW_IN_PROGRESS" });
  await svc.submitVerdict(who("codex"), {
    candidateId: "sev1", occurrenceId: "v", billingClass: "INTERNAL_REVIEW",
    verdict: {
      candidateDigest: candidateDigest(b), reviewerIdentity: "codex", verdict: "NO_GO",
      findings: [
        { id: "BIG", severity: "MAJOR", summary: "must be addressed" },
        { id: "NIT", severity: "OBSERVATION", summary: "worth noting only" },
      ],
      submittedAt: "2026-09-02T01:00:00.000Z",
    },
  });
  const addressingOnlyTheMajor = await svc.createSuccessor(who("claude"), {
    candidateId: "sev2", supersedes: "sev1",
    binding: binding({ candidateCommit: oid("8"), candidateTree: oid("8") }),
    remediates: ["BIG"],
  });
  assert.equal(addressingOnlyTheMajor.ok, true,
    `an OBSERVATION must not block a successor: ${JSON.stringify(addressingOnlyTheMajor)}`);
});
