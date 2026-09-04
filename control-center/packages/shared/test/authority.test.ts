import test from "node:test";
import assert from "node:assert/strict";
import {
  assertCapability,
  assertPaidExecutionAuthorised,
  authorityGrades,
  capabilities,
  capabilityClassification,
  deriveChildEnvelope,
  gradeOf,
  gradesHeld,
  hasCapability,
  issueRootEnvelope,
  parseUntrustedEnvelopeRef,
  type AuthorityEnvelope,
} from "../src/authority.js";
import { classifyExecution } from "../src/billing.js";

const T0 = Date.parse("2026-09-03T00:00:00.000Z");
const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

function root(caps: string[], overrides: Partial<Parameters<typeof issueRootEnvelope>[0]> = {}): AuthorityEnvelope {
  return issueRootEnvelope({
    envelopeId: "env-root",
    subjectId: "owner",
    capabilities: caps,
    issuedAt: iso(T0),
    expiresAt: iso(T0 + 8 * HOUR),
    ...overrides,
  });
}
function child(parent: AuthorityEnvelope, caps: string[], overrides: Record<string, unknown> = {}) {
  return deriveChildEnvelope(parent, {
    envelopeId: "env-child",
    subjectId: "agent-1",
    capabilities: caps,
    issuedAt: iso(T0),
    expiresAt: iso(T0 + 4 * HOUR),
    ...overrides,
  });
}

test("every capability is graded, and the list is DERIVED from the table", () => {
  for (const capability of capabilities) {
    assert.ok(authorityGrades.includes(gradeOf(capability)), `${capability} has no valid grade`);
  }
  assert.deepEqual([...capabilities].sort(), Object.keys(capabilityClassification).sort());
});

test("the five separately-gated authority classes never collapse into one another", () => {
  // §12: holding one grade is never evidence for another. The failure this prevents is a single
  // `admin` bit that carries deployment, credential issuance and destruction at once.
  const deployer = root(["production.deploy"]);
  assert.deepEqual(gradesHeld(deployer), ["production"]);
  for (const other of ["credential.issue", "credential.rotate", "operation.destructive", "execution.paid"]) {
    assert.equal(hasCapability(deployer, other, T0), false, `production.deploy must not imply ${other}`);
  }
  // And ordinary work is not reported as a gated grade at all.
  assert.deepEqual(gradesHeld(root(["engineering.inspect", "engineering.test"])), []);
});

test("a child may hold fewer capabilities than its parent", () => {
  const parent = root(["engineering.inspect", "engineering.implement", "production.deploy"]);
  const derived = child(parent, ["engineering.inspect"]);
  assert.deepEqual(derived.capabilities, ["engineering.inspect"]);
  assert.equal(derived.parentEnvelopeId, "env-root");
});

test("a child cannot hold a capability its parent lacks, and the refusal names it", () => {
  const parent = root(["engineering.inspect"]);
  assert.throws(
    () => child(parent, ["engineering.inspect", "production.deploy"]),
    (error: Error) => /exceeds its parent/.test(error.message) && /production\.deploy/.test(error.message),
  );
});

test("every gated capability is individually refused when the parent lacks it", () => {
  // Loop rather than spot-check: a future capability added to the table is covered the day it appears.
  const bare = root(["engineering.inspect"]);
  for (const capability of capabilities) {
    if (capability === "engineering.inspect") continue;
    assert.throws(() => child(bare, [capability]), /exceeds its parent/, `${capability} was not refused`);
  }
});

test("a grandchild cannot recover authority its parent gave up", () => {
  // The property that makes delegation safe across a chain rather than one hop.
  const grandparent = root(["engineering.inspect", "production.deploy"]);
  const parent = child(grandparent, ["engineering.inspect"]);
  assert.throws(
    () => deriveChildEnvelope(parent, {
      envelopeId: "env-grandchild",
      subjectId: "agent-2",
      capabilities: ["production.deploy"],
      issuedAt: iso(T0),
      expiresAt: iso(T0 + HOUR),
    }),
    /exceeds its parent/,
  );
});

test("a child cannot outlive its parent", () => {
  const parent = root(["engineering.inspect"]);
  assert.throws(
    () => child(parent, ["engineering.inspect"], { expiresAt: iso(T0 + 9 * HOUR) }),
    /outlives its parent/,
  );
});

test("an unknown capability is refused everywhere, not treated as absent", () => {
  assert.throws(() => root(["production.deploy!"]), /unknown capability/);
  assert.throws(() => gradeOf("engineering.deploy"), /Unknown capability/);
  // A typo in a guard must fail loudly rather than silently protecting nothing.
  assert.throws(() => assertCapability(root(["production.deploy"]), "production.delpoy", T0), /Unknown capability/);
});

test("an expired envelope authorises nothing, including work already in flight", () => {
  const envelope = root(["production.deploy"]);
  assert.doesNotThrow(() => assertCapability(envelope, "production.deploy", T0 + HOUR));
  assert.throws(() => assertCapability(envelope, "production.deploy", T0 + 8 * HOUR), /expired/);
  assert.equal(hasCapability(envelope, "production.deploy", T0 + 9 * HOUR), false);
});

test("an envelope is frozen, so a holder cannot append to its own capabilities", () => {
  const envelope = root(["engineering.inspect"]);
  assert.throws(() => {
    (envelope.capabilities as string[]).push("production.deploy");
  }, TypeError);
  assert.throws(() => {
    (envelope as { envelopeId: string }).envelopeId = "env-other";
  }, TypeError);
});

test("duplicate capabilities are refused rather than silently deduplicated", () => {
  assert.throws(() => root(["engineering.inspect", "engineering.inspect"]), /more than once/);
});

test("a child must have its own identity", () => {
  const parent = root(["engineering.inspect"]);
  assert.throws(() => child(parent, ["engineering.inspect"], { envelopeId: "env-root" }), /own identity/);
});

test("what an agent sends is a REFERENCE; its claimed capabilities are discarded, not validated", () => {
  const claimed = parseUntrustedEnvelopeRef({
    envelopeId: "env-child",
    capabilities: ["production.deploy", "credential.issue"],
    expiresAt: iso(T0 + 999 * HOUR),
  });
  assert.deepEqual(claimed, { envelopeId: "env-child" });
  assert.equal("capabilities" in claimed, false);
  assert.throws(() => parseUntrustedEnvelopeRef({ capabilities: ["production.deploy"] }), /string envelopeId/);
  assert.throws(() => parseUntrustedEnvelopeRef(null), /must be an object/);
  assert.throws(() => parseUntrustedEnvelopeRef("env-child"), /must be an object/);
});

test("paid execution needs BOTH a chargeable classification and the paying capability", () => {
  const billable = classifyExecution("build.website_artifact");
  const qa = classifyExecution("qa.regression");
  const payer = root(["execution.paid"]);
  const nonPayer = root(["engineering.implement"]);

  // Both yes.
  assert.doesNotThrow(() => assertPaidExecutionAuthorised(payer, billable, 25, T0));
  // Right actor, wrong work: an owner-grade envelope still cannot bill for the platform's own QA.
  assert.throws(() => assertPaidExecutionAuthorised(payer, qa, 25, T0), /Refusing to charge/);
  // Right work, wrong actor: billable, but this envelope was never delegated the authority to charge.
  assert.throws(() => assertPaidExecutionAuthorised(nonPayer, billable, 25, T0), /does not hold execution\.paid/);
  // A zero charge needs neither, and is the state everything currently sits in.
  assert.doesNotThrow(() => assertPaidExecutionAuthorised(nonPayer, qa, 0, T0));
});

test("an envelope must expire after it is issued", () => {
  assert.throws(() => root([], { expiresAt: iso(T0) }), /expire after it is issued/);
  assert.throws(() => root([], { issuedAt: "not-a-date" }), /not a valid instant/);
});
