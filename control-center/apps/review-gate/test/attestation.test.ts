import test from "node:test";
import assert from "node:assert/strict";
import {
  ATTESTATION_TRANSITIONS,
  BOUND_STATES,
  KINDS_REQUIRING_ROLLBACK_TARGET,
  KIND_SUBJECT,
  REQUIRED_TERMINAL_PHASE,
  UNBOUND_STATES,
  attestationIdentityDigest,
  attestationKinds,
  attestationStates,
  isLegacyIdentity,
  evaluateReconciliation,
  isAttestationTransitionAllowed,
  terminalAttestationStates,
  type AttestationRecord,
  type AttestationState,
} from "../src/attestation.js";

const dig = (c: string) => c.repeat(64).slice(0, 64);

const reconciliation = (over: Record<string, unknown> = {}) => ({
  resolvedByPrincipalId: "owner",
  resolvedAt: "2026-09-02T05:00:00.000Z",
  outcome: "APPLIED",
  journalReference: "agent-journal/2026-09-02/attempt-1",
  journaledPostStateDigest: dig("a"),
  observedHostStateDigest: dig("a"),
  terminalPhase: "succeeded",
  reason: "host reconciled against the journalled terminal result",
  ...over,
});

// ── the two load-bearing splits ──────────────────────────────────────────────────────────────────────

test("an unbound attestation may expire; a bound one may not", () => {
  // The split exists because expiry means different things either side of it. Unbound, nothing is
  // dispatched and no host can have changed, so expiry is free. Bound, a payload is named and may be in
  // flight, so the only honest outcome is INDETERMINATE.
  for (const state of UNBOUND_STATES) {
    assert.ok(isAttestationTransitionAllowed(state, "EXPIRED"),
      `${state} should be able to expire safely`);
    assert.equal(isAttestationTransitionAllowed(state, "INDETERMINATE"), false,
      `${state} has nothing in flight, so INDETERMINATE would overstate the uncertainty`);
  }
  for (const state of BOUND_STATES) {
    assert.equal(isAttestationTransitionAllowed(state, "EXPIRED"), false,
      `${state} names a payload that may be in flight; quietly expiring it would lose that`);
    assert.ok(isAttestationTransitionAllowed(state, "INDETERMINATE"),
      `${state} must be able to become INDETERMINATE`);
  }
});

test("EXECUTING cannot be revoked", () => {
  // Round 5: once the effect may be underway, a row saying REVOKED claims something the gate cannot know.
  assert.equal(isAttestationTransitionAllowed("EXECUTING", "REVOKED"), false);
  // ...but every state before it can be.
  for (const state of ["PENDING", "RESERVED_UNBOUND", "RESERVED_BOUND"] as const) {
    assert.ok(isAttestationTransitionAllowed(state, "REVOKED"), `${state} should be revocable`);
  }
});

test("nothing returns to a reservable state once bound", () => {
  // An earlier revision returned an expired lease to OPEN, which meant a second reservation could issue
  // while the first execution was still live. Reservation hands the executor everything it needs to act;
  // expiry does not take that back.
  const reservable: AttestationState[] = ["PENDING", "RESERVED_UNBOUND"];
  for (const from of [...BOUND_STATES, "INDETERMINATE"] as AttestationState[]) {
    for (const to of reservable) {
      assert.equal(isAttestationTransitionAllowed(from, to), false,
        `${from} -> ${to} would re-authorize an action that may already have happened`);
    }
  }
});

test("INDETERMINATE resolves only to CONSUMED or ABORTED, and both are terminal", () => {
  assert.deepEqual([...ATTESTATION_TRANSITIONS.INDETERMINATE].sort(), ["ABORTED", "CONSUMED"]);
  assert.deepEqual([...ATTESTATION_TRANSITIONS.ABORTED], []);
  assert.deepEqual([...ATTESTATION_TRANSITIONS.CONSUMED], []);
});

test("every state is reachable from PENDING, and the dead ends are the declared terminal ones", () => {
  const seen = new Set<AttestationState>(["PENDING"]);
  const queue: AttestationState[] = ["PENDING"];
  while (queue.length) {
    const current = queue.shift()!;
    for (const next of ATTESTATION_TRANSITIONS[current]) {
      if (!seen.has(next)) { seen.add(next); queue.push(next); }
    }
  }
  assert.deepEqual(attestationStates.filter((s) => !seen.has(s)), [],
    "a state no path reaches is dead policy");
  const noExit = attestationStates.filter((s) => ATTESTATION_TRANSITIONS[s].length === 0);
  assert.deepEqual([...noExit].sort(), [...terminalAttestationStates].sort(),
    "a state with no exit must be declared terminal, or it strands the attestation");
});

// ── kind and subject ─────────────────────────────────────────────────────────────────────────────────

test("release.publish is not a kind, because nothing is obliged to consume it", () => {
  assert.equal((attestationKinds as readonly string[]).includes("release.publish"), false);
  // The three that remain are exactly the ones authorizePrivilegedTask covers.
  assert.deepEqual([...attestationKinds].sort(),
    ["agent.upgrade", "configuration.apply", "configuration.rollback"]);
});

test("every kind maps to exactly one subject, and rollback needs a target", () => {
  for (const kind of attestationKinds) {
    assert.ok(KIND_SUBJECT[kind], `${kind} must declare which subject it may be minted from`);
  }
  assert.equal(KIND_SUBJECT["configuration.apply"], "configuration.change");
  assert.equal(KIND_SUBJECT["configuration.rollback"], "configuration.change");
  assert.equal(KIND_SUBJECT["agent.upgrade"], "agent.upgrade");
  // Both configuration kinds share a subject, which is exactly why "kind matches subject.kind" could not
  // be literal and the mapping had to be written down.
  assert.deepEqual([...KINDS_REQUIRING_ROLLBACK_TARGET], ["configuration.rollback"]);
});

// ── reconciliation evidence ──────────────────────────────────────────────────────────────────────────

test("reconciliation: two agreeing independent readings conclude APPLIED", () => {
  assert.deepEqual(evaluateReconciliation({ kind: "configuration.apply", reconciliation: reconciliation() }),
    { ok: true });
});

test("reconciliation: a fresh reading that disagrees with the journal concludes nothing", () => {
  const result = evaluateReconciliation({
    kind: "configuration.apply",
    reconciliation: reconciliation({ observedHostStateDigest: dig("b") }),
  });
  assert.equal(result.ok, false);
  assert.equal((result as { code: string }).code, "observation_disagrees_with_journal");
});

test("reconciliation: a rolled-back attempt is not an applied one", () => {
  // The phase that matters most. rolled_back does not prove the requested change remains applied — it
  // proves the opposite, and an earlier revision would have accepted it.
  const result = evaluateReconciliation({
    kind: "configuration.apply",
    reconciliation: reconciliation({ terminalPhase: "rolled_back" }),
  });
  assert.equal(result.ok, false);
  assert.equal((result as { code: string }).code, "terminal_phase_insufficient");
});

test("reconciliation: a non-terminal phase is not evidence either", () => {
  for (const phase of ["services_activating", "health_checking", "rollback_failed", "failed"]) {
    const result = evaluateReconciliation({
      kind: "agent.upgrade", reconciliation: reconciliation({ terminalPhase: phase }),
    });
    assert.equal(result.ok, false, `${phase} must not conclude APPLIED`);
    assert.equal((result as { code: string }).code, "terminal_phase_insufficient");
  }
});

test("reconciliation: NOT_APPLIED needs no post-state agreement", () => {
  // Concluding an action did NOT happen is the safe direction: it leads to ABORTED, which is terminal and
  // forces a fresh attestation. It should not be blocked by digests failing to line up.
  const result = evaluateReconciliation({
    kind: "configuration.apply",
    reconciliation: reconciliation({
      outcome: "NOT_APPLIED", terminalPhase: "failed", observedHostStateDigest: dig("c"),
    }),
  });
  assert.equal(result.ok, true);
});

test("reconciliation: a malformed record is a closed decision, never an exception", () => {
  const result = evaluateReconciliation({ kind: "configuration.apply", reconciliation: { nonsense: true } });
  assert.equal(result.ok, false);
  assert.equal((result as { code: string }).code, "malformed_input");
});

test("reconciliation: every kind declares the phase it requires", () => {
  // Derived from the kind list, so adding a kind without deciding what counts as applied fails here.
  for (const kind of attestationKinds) {
    assert.ok(REQUIRED_TERMINAL_PHASE[kind], `${kind} must declare its required terminal phase`);
    assert.notEqual(REQUIRED_TERMINAL_PHASE[kind], "rolled_back");
  }
});

// ── v2 identity ──────────────────────────────────────────────────────────────────────────────────────

const v1Record = (over: Partial<AttestationRecord> = {}): AttestationRecord => ({
  attestationId: "at-1",
  kind: "configuration.apply",
  contentDigest: dig("9"),
  candidateId: "c1",
  orgId: "org-1",
  serverId: "server-1",
  targetEnvironmentClass: "staging",
  audiencePrincipalId: "agent-1",
  nonce: "n-1",
  grantedByPrincipalId: "owner",
  grantedAt: "2026-09-02T00:00:00.000Z",
  expiresAt: "2026-09-02T06:00:00.000Z",
  state: "PENDING",
  ...over,
});
const v2Record = (over: Partial<AttestationRecord> = {}): AttestationRecord =>
  v1Record({ identitySchemaVersion: "v2", bindingPrincipalId: "binder-1", ...over });

test("an absent identity schema version means legacy v1", () => {
  assert.equal(isLegacyIdentity(v1Record()), true);
  assert.equal(isLegacyIdentity(v2Record()), false);
});

test("v1 records keep their exact v1 digest bytes forever", () => {
  // The reason bindingPrincipalId could not simply be added under the v1 marker: the same stored record
  // would then digest differently depending on which software version read it.
  // Pinned to the literal a v1 record digested to BEFORE split authority existed. If this changes, a
  // deployed record's claimed immutable identity changed underneath it, which is the whole failure the
  // separate v2 domain marker exists to prevent.
  assert.equal(attestationIdentityDigest(v1Record()),
    "513ae11dfa9f0fd588b0e6c9438120b666ae1dee2404ae4a9bfbca646e3875cb");
  // And a v1 record's digest must not depend on any v2 field.
  const withV2FieldsIgnored = v1Record({ bindingPrincipalId: "binder-1", supersedesAttestationId: "at-0" });
  assert.equal(attestationIdentityDigest(withV2FieldsIgnored), attestationIdentityDigest(v1Record()),
    "v2 fields on a record with no identitySchemaVersion must not change its v1 digest");
});

test("v1 and v2 digests are in different domains", () => {
  assert.notEqual(attestationIdentityDigest(v1Record()), attestationIdentityDigest(v2Record()),
    "the domain marker must separate them even before any field differs");
});

test("binding authority is part of v2 identity", () => {
  // Without this, two attestations assigning DIFFERENT binding authority would share one claimed
  // immutable identity.
  assert.notEqual(
    attestationIdentityDigest(v2Record({ bindingPrincipalId: "binder-1" })),
    attestationIdentityDigest(v2Record({ bindingPrincipalId: "binder-2" })),
  );
});

test("lineage is part of v2 identity, and its absence is distinguishable", () => {
  // A replacement that could be re-pointed is not a lineage.
  const none = attestationIdentityDigest(v2Record());
  const a = attestationIdentityDigest(v2Record({ supersedesAttestationId: "at-0" }));
  const b = attestationIdentityDigest(v2Record({ supersedesAttestationId: "at-9" }));
  assert.notEqual(a, b);
  assert.notEqual(none, a);
});

test("a v2 record without a binder has no identity to compute", () => {
  // Fail closed rather than digesting a placeholder, which would give a malformed record the same
  // identity as a different malformed record.
  assert.throws(
    () => attestationIdentityDigest({ ...v1Record(), identitySchemaVersion: "v2" }),
    /must carry bindingPrincipalId/,
  );
});
