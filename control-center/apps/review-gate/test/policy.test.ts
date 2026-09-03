import test from "node:test";
import assert from "node:assert/strict";
import {
  TRANSITIONS,
  candidateBindingSchema,
  candidateSubjectSchema,
  CANONICALISED_SUBJECT_FIELDS,
  type CandidateSubject,
  candidateDigest,
  contentDigest,
  contentFields,
  independenceOf,
  isTransitionAllowed,
  reviewStates,
  terminalStates,
  type CandidateBinding,
  type Participant,
  type ReviewState,
  type Verdict,
} from "../src/policy.js";
import { evaluateTransition } from "../src/policyInternal.js";

// Adversarial tests for the mandatory review gate. Numbered against the handoff's §H list so a reader can
// see which requirements are covered here and which need a durable store (noted at the bottom).
//
// These deliberately try to DEFEAT the gate rather than demonstrate the happy path. The happy path was
// never the risk: the risk is a smoke test, a caller's boolean, or a reviewer who is also the author.

const oid = (c: string) => c.repeat(40).slice(0, 40);
const dig = (c: string) => c.repeat(64).slice(0, 64);

function binding(over: Partial<CandidateBinding> = {}): CandidateBinding {
  return {
    // Every candidate now declares WHAT it is a review of. "code" is the ordinary case; the
    // configuration and agent-upgrade subjects are what an attestation binds a payload against.
    subject: { kind: "code" as const },
    projectId: "crafters-market",
    repository: "williams342-maker/operation",
    baseBranch: "main",
    baseCommit: oid("a"),
    candidateCommit: oid("b"),
    candidateTree: oid("c"),
    patchDigest: dig("1"),
    // artifactDigest and manifestDigest became REQUIRED in round 6: optional artifact binding meant a
    // materially different artifact could carry the reviewed candidate identity.
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

// A terminal verdict now requires an authenticated actor that MATCHES the reviewer named in the verdict.
// That is the CRITICAL-2 remediation: a name in a payload is a claim, not an identity. These tests
// default the actor to the verdict's reviewer so each stays about the property it names; the requirement
// itself is asserted separately below.
const go = (from: ReviewState, to: ReviewState, over: Record<string, unknown> = {}) => {
  const v = (over as { verdict?: Verdict }).verdict;
  return evaluateTransition({
    from,
    to,
    binding: binding(),
    boundDigest: candidateDigest(binding()),
    participants: authored,
    ...(v ? { actorIdentity: v.reviewerIdentity } : {}),
    ...over,
  } as Parameters<typeof evaluateTransition>[0]);
};

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

test("H5: repointing the base branch produces a DIFFERENT candidate", () => {
  // NAME CORRECTED IN ROUND 3. This test was called "moving the branch does NOT move candidate identity"
  // while its first assertion proved the opposite -- an independent review caught the contradiction. The
  // ASSERTIONS were right and the name was wrong: baseBranch IS part of the binding, so repointing a
  // candidate at a different base makes it a different candidate that must be reviewed again. That is
  // the safe direction: a GO earned against `main` cannot be carried across to `release/2026-09` by
  // editing a branch field.
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
    actorIdentity: "codex",
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

test("every state entry exists and every target names a real state", () => {
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

// ── CRITICAL-2 remediation, asserted directly ────────────────────────────────────────────────────────

test("a terminal verdict without an authenticated actor is refused", () => {
  const result = evaluateTransition({
    from: "REVIEW_IN_PROGRESS",
    to: "GO",
    binding: binding(),
    boundDigest: candidateDigest(binding()),
    participants: authored,
    verdict: verdict(),
    // actorIdentity deliberately omitted
  });
  assert.equal(result.ok, false);
  assert.equal((result as { code: string }).code, "actor_required");
});

test("a verdict naming a reviewer other than the authenticated actor is refused", () => {
  // The exact attack the independent review found: authenticate as the author, name someone innocent.
  const result = evaluateTransition({
    from: "REVIEW_IN_PROGRESS",
    to: "GO",
    binding: binding(),
    boundDigest: candidateDigest(binding()),
    participants: authored,
    verdict: verdict({ reviewerIdentity: "codex" }),
    actorIdentity: "claude",
  });
  assert.equal(result.ok, false);
  assert.equal((result as { code: string }).code, "verdict_actor_mismatch");
});

test("malformed runtime input becomes a closed decision rather than throwing", () => {
  const result = evaluateTransition({
    from: "REVIEW_IN_PROGRESS",
    to: "GO",
    binding: binding(),
    boundDigest: candidateDigest(binding()),
    participants: [{ identity: "x", role: "not-a-role", at: "nope" }],
    verdict: verdict(),
    actorIdentity: "codex",
  } as unknown as Parameters<typeof evaluateTransition>[0]);
  assert.equal(result.ok, false);
  assert.equal((result as { code: string }).code, "malformed_input");
});

// MINOR (round 3): the completeness test above was named "every state is reachable" but only checked
// table membership and target validity -- it performed no reachability analysis at all. A test whose name
// claims more than its body checks is worse than a missing test, because it stops anyone writing the real
// one. This is the real one.
test("every state is genuinely reachable from BUILT by walking the table", () => {
  const seen = new Set<ReviewState>(["BUILT"]);
  const queue: ReviewState[] = ["BUILT"];
  while (queue.length) {
    const current = queue.shift()!;
    for (const next of TRANSITIONS[current]) {
      if (!seen.has(next)) { seen.add(next); queue.push(next); }
    }
  }
  const unreachable = reviewStates.filter((s) => !seen.has(s));
  assert.deepEqual(unreachable, [],
    "a state no path can reach is dead policy: it can never be entered, so its rules never apply");
});

test("the only states without an exit are the declared terminal ones", () => {
  // The counterpart to reachability. An accidental dead end would strand a candidate forever, and would
  // look identical to a deliberate terminal state unless the two lists are compared.
  const noExit = reviewStates.filter((s) => TRANSITIONS[s].length === 0);
  assert.deepEqual([...noExit].sort(), [...terminalStates].sort(),
    "a state with no outgoing transitions must be declared terminal, or it strands the candidate");
});

// ── round-5: the content / paperwork split ───────────────────────────────────────────────────────────

test("C5-3: paperwork fields change candidate identity but NOT content identity", () => {
  // The whole of the round-5 remediation rests on this distinction, so assert it directly rather than
  // only through the service. Each of these changes the submission; none of them changes the work.
  const base = binding();
  for (const [field, value] of [
    ["createdAt", "2026-09-02T09:00:00.000Z"],
    ["occurrenceId", "occ-different"],
    ["authorityRef", "OWNER-SOMETHING-ELSE"],
    ["requestedReviewerClass", "internal"],
    ["testResultDigest", dig("8")],
    // ROUND 6 MOVED testPlanVersion HERE, from the content list below. A test plan label describes how
    // the work is checked, not the work: leaving it in content meant a rejected artifact could be
    // re-presented as remediated by editing tp-1 to tp-2, with the identical defective commit, tree,
    // patch, artifact and manifest. The previous version of this suite asserted the opposite and so
    // blessed the bypass -- which is why an independent reviewer found it and I did not.
    ["testPlanVersion", "tp-99"],
  ] as const) {
    const changed = binding({ [field]: value } as Partial<CandidateBinding>);
    assert.notEqual(candidateDigest(changed), candidateDigest(base),
      `${field} should still change the candidate's identity`);
    assert.equal(contentDigest(changed), contentDigest(base),
      `${field} must NOT change the content digest; it is paperwork, not work`);
  }
});

test("C5-3: content fields change content identity", () => {
  // The counterpart. If contentDigest ignored everything it would satisfy the test above perfectly.
  const base = contentDigest(binding());
  for (const [field, value] of [
    ["repository", "someone/else"],
    ["baseCommit", oid("9")],
    ["candidateCommit", oid("9")],
    ["candidateTree", oid("9")],
    ["patchDigest", dig("9")],
    ["artifactDigest", dig("9")],
    ["manifestDigest", dig("9")],
  ] as const) {
    assert.notEqual(contentDigest(binding({ [field]: value } as Partial<CandidateBinding>)), base,
      `${field} is part of the work and must change the content digest`);
  }
  assert.notEqual(contentDigest(binding({ dependencyLockDigests: [dig("5")] })), base,
    "the dependency lock set is part of the work");
});

test("C5-3: the content field list is exactly what the digest covers", () => {
  // Derived from the exported list rather than restating it, so adding a field to one and not the other
  // fails here instead of silently widening or narrowing what counts as a remediation.
  assert.deepEqual([...contentFields].sort(), [
    "artifactDigest", "baseCommit", "candidateCommit", "candidateTree", "dependencyLockDigests",
    "manifestDigest", "patchDigest", "projectId", "repository",
  ]);
  for (const field of ["createdAt", "occurrenceId", "authorityRef", "testResultDigest",
    "requestedReviewerClass", "baseBranch", "expiresAt", "authorIdentity", "testPlanVersion"]) {
    assert.equal(contentFields.includes(field), false,
      `${field} must stay out of the content digest, or re-submitting the same work would look new`);
  }
});

test("M2: artifact and manifest binding are mandatory, so identity covers what was built", () => {
  // Codex raised this twice as a production blocker while it stayed optional. A binding without them is
  // now simply not a binding.
  for (const missing of ["artifactDigest", "manifestDigest"] as const) {
    const incomplete = { ...binding() } as Record<string, unknown>;
    delete incomplete[missing];
    assert.throws(() => candidateBindingSchema.parse(incomplete), undefined,
      `${missing} must be required; an unbound artifact can carry a reviewed identity`);
  }
});

// ── the typed subject (design v7 §2.4) ───────────────────────────────────────────────────────────────

test("subject: a code candidate and a configuration candidate are different content", () => {
  // The point of the discriminant. Design review round 5: a generic code-artifact candidate must not be
  // able to authorize a configuration change, so the subject kind is part of identity rather than
  // metadata hanging off it.
  const code = contentDigest(binding());
  const config = contentDigest(binding({
    subject: {
      kind: "configuration.change",
      changeDigest: dig("5"),
      environmentId: "env-staging-01",
      targetProfileId: "profile-01",
      targetProfileRevision: 1,
    },
  }));
  assert.notEqual(code, config, "the subject kind must change content identity");
});

test("subject: every configuration field changes content identity", () => {
  const base = binding({
    subject: {
      kind: "configuration.change",
      changeDigest: dig("5"),
      environmentId: "env-staging-01",
      targetProfileId: "profile-01",
      targetProfileRevision: 1,
    },
  });
  const before = contentDigest(base);
  const variants: Array<Partial<Extract<CandidateSubject, { kind: "configuration.change" }>>> = [
    { changeDigest: dig("6") },
    { environmentId: "env-production-01" },
    { targetProfileId: "profile-02" },
    { targetProfileRevision: 2 },
    { rollbackTarget: { candidateId: "prior-1", contentDigest: dig("7") } },
  ];
  for (const over of variants) {
    const changed = contentDigest(binding({
      subject: { ...(base.subject as Extract<CandidateSubject, { kind: "configuration.change" }>), ...over },
    }));
    assert.notEqual(changed, before,
      `${Object.keys(over)[0]} must change content identity, or it could be edited after review`);
  }
});

test("subject: the rollback target is fixed at review time", () => {
  // Design v7: "the target must have been RELEASED" had no named operand. It has one now, and because it
  // is inside contentDigest it cannot be swapped for a different target after the review.
  const withTarget = binding({
    subject: {
      kind: "configuration.change", changeDigest: dig("5"),
      environmentId: "env-1", targetProfileId: "p-1", targetProfileRevision: 1,
      rollbackTarget: { candidateId: "prior-1", contentDigest: dig("7") },
    },
  });
  const otherTarget = binding({
    subject: {
      kind: "configuration.change", changeDigest: dig("5"),
      environmentId: "env-1", targetProfileId: "p-1", targetProfileRevision: 1,
      rollbackTarget: { candidateId: "prior-2", contentDigest: dig("8") },
    },
  });
  assert.notEqual(contentDigest(withTarget), contentDigest(otherTarget));
});

test("subject: agent upgrade binds the bytes that will be installed", () => {
  const base = binding({
    subject: { kind: "agent.upgrade", artifactSha256: dig("5"), releaseManifestDigest: dig("6") },
  });
  const before = contentDigest(base);
  assert.notEqual(contentDigest(binding({
    subject: { kind: "agent.upgrade", artifactSha256: dig("9"), releaseManifestDigest: dig("6") },
  })), before, "a different artifact is different content");
  assert.notEqual(contentDigest(binding({
    subject: { kind: "agent.upgrade", artifactSha256: dig("5"), releaseManifestDigest: dig("9") },
  })), before, "a different release manifest is different content");
});

test("subject: the canonical join covers every field the schema declares", () => {
  // Derived from the SCHEMA, not from a list I maintain by hand, so adding a field to a subject variant
  // without adding it to the canonical join fails here rather than silently leaving it out of identity.
  // A field outside contentDigest is a field that can be edited after review.
  const variants = candidateSubjectSchema.options;
  for (const variant of variants) {
    const shape = variant.shape as Record<string, unknown>;
    for (const field of Object.keys(shape)) {
      if (field === "kind") continue;
      assert.ok(
        CANONICALISED_SUBJECT_FIELDS.includes(field),
        `${field} is declared on a subject variant but is not in the canonical join, so it is not part ` +
        "of content identity",
      );
    }
  }
});
