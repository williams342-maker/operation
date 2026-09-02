import test from "node:test";
import assert from "node:assert/strict";
import { candidateDigest, type CandidateBinding } from "../src/reviewGate.js";
import {
  InMemoryReviewGateStore,
  ReviewGateService,
  isCustomerBillable,
  nonBillableClasses,
  principalFromSession,
} from "../src/reviewGateService.js";

// Identity is no longer request data. A test must mint a principal the way middleware would.
const who = (id: string) => principalFromSession({ userId: id, authenticatedAt: "2026-09-02T00:00:00.000Z" });

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
  const svc = new ReviewGateService(store, () => "2026-09-02T02:00:00.000Z");
  await svc.createCandidate(who("claude"), { candidateId: "c1", binding: binding() });
  if (state) {
    const path: Array<[string, string]> = [
      ["TESTED", "t1"], ["FROZEN", "t2"], ["REVIEW_REQUESTED", "t3"], ["REVIEW_IN_PROGRESS", "t4"],
    ];
    for (const [to, occ] of path) {
      await svc.transition(who("claude"), {
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

test("CRITICAL-1: a caller cannot supply an empty participation ledger", async () => {
  const { svc } = await seeded("REVIEW_IN_PROGRESS");
  // The author tries to approve, which previously worked by passing participants: [].
  // There is no participants parameter; the ledger is loaded, and it already holds the author row
  // written by createCandidate.
  const result = await svc.submitVerdict(who("claude"), {
    candidateId: "c1", occurrenceId: "x2", billingClass: "INTERNAL_REVIEW",
    verdict: {
      candidateDigest: candidateDigest(binding()), reviewerIdentity: "claude",
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
  const { svc } = await seeded("REVIEW_IN_PROGRESS");
  // The exact attack from the review: authenticate as the author, name "codex" in the payload. The
  // independence check would then evaluate the innocent identity and pass.
  const result = await svc.submitVerdict(who("claude"), {
    candidateId: "c1", occurrenceId: "x3", billingClass: "INTERNAL_REVIEW",
    verdict: {
      candidateDigest: candidateDigest(binding()), reviewerIdentity: "codex",
      verdict: "GO", findings: [], submittedAt: "2026-09-02T01:00:00.000Z",
    },
  });
  assert.equal(result.ok, false);
  assert.equal((result as { code: string }).code, "verdict_actor_mismatch");
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
  const svc = new ReviewGateService(store, () => "2026-09-03T00:00:00.000Z");
  const b = binding({ expiresAt: "2026-09-02T12:00:00.000Z" });
  await svc.createCandidate(who("claude"), { candidateId: "c2", binding: b });
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
  const svc = new ReviewGateService(store);
  const result = await svc.createCandidate(who("claude"), {
    candidateId: "c3", binding: binding({ authorIdentity: "someone-else" }),
  });
  assert.equal(result.ok, false);
  assert.equal((result as { code: string }).code, "author_actor_mismatch");
});
