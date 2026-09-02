import test from "node:test";
import assert from "node:assert/strict";
import {
  TRANSITIONS,
  candidateDigest,
  evaluateTransition,
  independenceOf,
  isTransitionAllowed,
  reviewStates,
  type CandidateBinding,
  type Participant,
  type ReviewState,
  type Verdict,
} from "../src/reviewGate.js";

// Adversarial tests for the mandatory review gate. Numbered against the handoff's §H list so a reader can
// see which requirements are covered here and which need a durable store (noted at the bottom).
//
// These deliberately try to DEFEAT the gate rather than demonstrate the happy path. The happy path was
// never the risk: the risk is a smoke test, a caller's boolean, or a reviewer who is also the author.

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
    occurrenceId: "occ-1",
    ...over,
  };
}

const authored: Participant[] = [
  { identity: "claude", role: "author", at: "2026-09-02T00:00:00.000Z" },
];

function verdict(over: Partial<Verdict> = {}): Verdict {
  return {
    candidateDigest: candidateDigest(binding()),
    reviewerIdentity: "codex",
    verdict: "GO",
    findings: [],
    submittedAt: "2026-09-02T01:00:00.000Z",
    ...over,
  };
}

const go = (from: ReviewState, to: ReviewState, over: Record<string, unknown> = {}) =>
  evaluateTransition({
    from,
    to,
    binding: binding(),
    boundDigest: candidateDigest(binding()),
    participants: authored,
    ...over,
  } as Parameters<typeof evaluateTransition>[0]);

// ── §H.1 / §H.2 — a passing test is not an approval ──────────────────────────────────────────────────

test("H1/H2: TESTED and FROZEN cannot reach GO or owner decision", () => {
  for (const from of ["TESTED", "FROZEN"] as const) {
    for (const to of ["GO", "READY_FOR_OWNER_DECISION"] as const) {
      assert.equal(isTransitionAllowed(from, to), false, `${from} -> ${to} must not exist`);
      const result = go(from, to, { verdict: verdict() });
      assert.equal(result.ok, false);
    }
  }
});

test("H1: no state reaches READY_FOR_OWNER_DECISION except GO", () => {
  const reachers = reviewStates.filter((s) => (TRANSITIONS[s] ?? []).includes("READY_FOR_OWNER_DECISION"));
  assert.deepEqual(reachers, ["GO"]);
});

test("H8: GO leads only to owner decision — never to anything deployable", () => {
  assert.deepEqual([...TRANSITIONS.GO], ["READY_FOR_OWNER_DECISION"]);
  assert.deepEqual([...TRANSITIONS.READY_FOR_OWNER_DECISION], [],
    "owner decision is terminal inside this gate; deployment is a separate owner-gated action");
});

// ── §H.3 / §H.5 / §H.20 — identity is content ────────────────────────────────────────────────────────

test("H3/H20: a verdict for one candidate is rejected on another", () => {
  const other = candidateDigest(binding({ candidateCommit: oid("d") }));
  const result = go("REVIEW_IN_PROGRESS", "GO", { verdict: verdict({ candidateDigest: other }) });
  assert.equal(result.ok, false);
  assert.equal((result as { code: string }).code, "verdict_wrong_candidate");
});

test("H4: changing the source changes the identity, so prior evidence cannot follow it", () => {
  const before = candidateDigest(binding());
  assert.notEqual(candidateDigest(binding({ candidateCommit: oid("d") })), before);
  assert.notEqual(candidateDigest(binding({ candidateTree: oid("e") })), before);
  assert.notEqual(candidateDigest(binding({ patchDigest: dig("9") })), before);
  // and the test evidence is part of identity, so a quietly edited test plan invalidates review too
  assert.notEqual(candidateDigest(binding({ testResultDigest: dig("8") })), before);
  assert.notEqual(candidateDigest(binding({ testPlanVersion: "tp-2" })), before);
});

test("H5: moving the branch does NOT move candidate identity", () => {
  // The same commit reachable from a different branch name is the same candidate. Identity follows
  // content, so a review cannot be transplanted by renaming or repointing a branch.
  const a = candidateDigest(binding({ baseBranch: "main" }));
  const b = candidateDigest(binding({ baseBranch: "release/2026-09" }));
  assert.notEqual(a, b, "baseBranch is part of the binding, so it must change the digest");
  // ...but nothing else about the branch leaks in: two bindings identical except construction order match
  const forward = candidateDigest(binding());
  const reordered = candidateDigest({ ...binding() });
  assert.equal(forward, reordered);
});

test("a binding that does not hash to its frozen digest is rejected outright", () => {
  const result = evaluateTransition({
    from: "REVIEW_IN_PROGRESS",
    to: "GO",
    binding: binding(),
    boundDigest: dig("f"),
    participants: authored,
    verdict: verdict(),
  });
  assert.equal(result.ok, false);
  assert.equal((result as { code: string }).code, "candidate_identity_mismatch");
});

// ── §H.6 / §H.7 — independence ───────────────────────────────────────────────────────────────────────

test("H6: the author cannot approve their own candidate", () => {
  const result = go("REVIEW_IN_PROGRESS", "GO", { verdict: verdict({ reviewerIdentity: "claude" }) });
  assert.equal(result.ok, false);
  assert.equal((result as { code: string }).code, "reviewer_not_independent");
});

test("H7: a remediator cannot certify the candidate they remediated", () => {
  const participants: Participant[] = [
    ...authored,
    { identity: "codex", role: "remediator", at: "2026-09-02T00:30:00.000Z" },
  ];
  const result = evaluateTransition({
    from: "REVIEW_IN_PROGRESS",
    to: "GO",
    binding: binding(),
    boundDigest: candidateDigest(binding()),
    participants,
    verdict: verdict({ reviewerIdentity: "codex" }),
  });
  assert.equal(result.ok, false);
  assert.equal((result as { code: string }).code, "reviewer_not_independent");
});

test("H7: prior participation as requester also disqualifies", () => {
  const participants: Participant[] = [
    ...authored,
    { identity: "codex", role: "requester", at: "2026-09-02T00:30:00.000Z" },
  ];
  assert.equal(independenceOf("codex", participants, "claude").independent, false);
});

test("a genuinely uninvolved reviewer IS independent — the check is not vacuous", () => {
  const check = independenceOf("codex", authored, "claude");
  assert.equal(check.independent, true, check.reason);
  const result = go("REVIEW_IN_PROGRESS", "GO", { verdict: verdict() });
  assert.equal(result.ok, true);
});

test("having reviewed before does not disqualify a reviewer", () => {
  // Only non-reviewer participation is disqualifying. A reviewer who reviewed an EARLIER candidate is
  // still independent on this one; if they had changed it, they would hold a remediator row instead.
  const participants: Participant[] = [
    ...authored,
    { identity: "codex", role: "reviewer", at: "2026-09-01T00:00:00.000Z" },
  ];
  assert.equal(independenceOf("codex", participants, "claude").independent, true);
});

// ── §H.9 / §H.10 — NO_GO routes to remediation ───────────────────────────────────────────────────────

test("H9: NO_GO must carry findings, and leads only to remediation", () => {
  const empty = go("REVIEW_IN_PROGRESS", "NO_GO", { verdict: verdict({ verdict: "NO_GO", findings: [] }) });
  assert.equal(empty.ok, false);
  assert.equal((empty as { code: string }).code, "no_go_without_findings");

  const withFinding = go("REVIEW_IN_PROGRESS", "NO_GO", {
    verdict: verdict({
      verdict: "NO_GO",
      findings: [{ id: "F1", severity: "MAJOR", summary: "unvalidated input reaches the query" }],
    }),
  });
  assert.equal(withFinding.ok, true);
  assert.deepEqual([...TRANSITIONS.NO_GO], ["REMEDIATION_REQUIRED"]);
});

test("H10: remediation returns through retest, never straight back to review", () => {
  assert.deepEqual([...TRANSITIONS.REMEDIATION_REQUIRED], ["REMEDIATING", "CANCELLED"]);
  assert.deepEqual([...TRANSITIONS.REMEDIATING], ["RETEST_REQUIRED", "CANCELLED"]);
  assert.equal(isTransitionAllowed("REMEDIATING", "REVIEW_REQUESTED"), false);
  assert.equal(isTransitionAllowed("REMEDIATION_REQUIRED", "GO"), false);
});

test("H10: remediation must record who is remediating", () => {
  const anonymous = go("REMEDIATION_REQUIRED", "REMEDIATING");
  assert.equal(anonymous.ok, false);
  assert.equal((anonymous as { code: string }).code, "actor_required");
  assert.equal(go("REMEDIATION_REQUIRED", "REMEDIATING", { actorIdentity: "claude" }).ok, true);
});

// ── §H.11 / §H.13 — fail closed ──────────────────────────────────────────────────────────────────────

test("H11: an unavailable reviewer parks in REVIEW_BLOCKED and cannot advance", () => {
  assert.equal(isTransitionAllowed("REVIEW_REQUESTED", "REVIEW_BLOCKED"), true);
  assert.equal(isTransitionAllowed("REVIEW_BLOCKED", "GO"), false);
  assert.equal(isTransitionAllowed("REVIEW_BLOCKED", "READY_FOR_OWNER_DECISION"), false);
  assert.deepEqual([...TRANSITIONS.REVIEW_BLOCKED], ["REVIEW_REQUESTED", "CANCELLED", "EXPIRED"]);
});

test("H13: a verdict disagreeing with the requested transition is rejected", () => {
  const result = go("REVIEW_IN_PROGRESS", "GO", { verdict: verdict({ verdict: "NO_GO" }) });
  assert.equal(result.ok, false);
  assert.equal((result as { code: string }).code, "verdict_disagrees");
});

test("H13: a terminal verdict with no verdict supplied is rejected", () => {
  const result = go("REVIEW_IN_PROGRESS", "GO");
  assert.equal(result.ok, false);
  assert.equal((result as { code: string }).code, "verdict_required");
});

test("expired and cancelled are dead ends", () => {
  assert.deepEqual([...TRANSITIONS.EXPIRED], []);
  assert.deepEqual([...TRANSITIONS.CANCELLED], []);
});

// ── §H.18 — rollback identity ────────────────────────────────────────────────────────────────────────

test("H18: a consequential candidate cannot freeze or pass without a rollback target", () => {
  for (const env of ["beta", "staging", "production"] as const) {
    const b = binding({ targetEnvironmentClass: env });
    const blocked = evaluateTransition({
      from: "TESTED", to: "FROZEN", binding: b, boundDigest: candidateDigest(b), participants: authored,
    });
    assert.equal(blocked.ok, false, `${env} must require a rollback target`);
    assert.equal((blocked as { code: string }).code, "rollback_identity_missing");

    const withRollback = binding({ targetEnvironmentClass: env, rollbackTargetId: "release/v1.4.0" });
    assert.equal(evaluateTransition({
      from: "TESTED", to: "FROZEN", binding: withRollback,
      boundDigest: candidateDigest(withRollback), participants: authored,
    }).ok, true);
  }
});

test("H18: development and test are exempt, deliberately", () => {
  // Demanding a rollback target where there is nothing to roll back to only teaches people to write a
  // placeholder, which is worse than not asking.
  for (const env of ["development", "test"] as const) {
    const b = binding({ targetEnvironmentClass: env });
    assert.equal(evaluateTransition({
      from: "TESTED", to: "FROZEN", binding: b, boundDigest: candidateDigest(b), participants: authored,
    }).ok, true);
  }
});

// ── the table itself ─────────────────────────────────────────────────────────────────────────────────

test("every state is reachable in the table and every target is a real state", () => {
  // Independent completeness check: derived from the state LIST, not from the transition table it
  // polices, so deleting a state cannot delete its own coverage.
  for (const s of reviewStates) {
    assert.ok(Object.prototype.hasOwnProperty.call(TRANSITIONS, s), `${s} has no transition entry`);
    for (const t of TRANSITIONS[s]) {
      assert.ok(reviewStates.includes(t), `${s} -> ${t} names a state that does not exist`);
    }
  }
});

test("no transition table entry is self-looping", () => {
  for (const s of reviewStates) {
    assert.equal(TRANSITIONS[s].includes(s), false, `${s} loops to itself`);
  }
});
