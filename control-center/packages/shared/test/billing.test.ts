import test from "node:test";
import assert from "node:assert/strict";
import {
  assertBillingClassUnchanged,
  assertChargeable,
  billingClassFor,
  billingClasses,
  classifyExecution,
  executionBillingClassification,
  executionKinds,
  isExecutionKind,
  isZeroCreditKind,
  type BillableExecution,
} from "../src/billing.js";

// The §7 list, written out here independently of the source table. If someone reclassifies one of these
// to customer_billable, this test fails and names it — which is the point: the rule is not "whatever the
// table currently says", it is a commitment about specific activities.
const MUST_BE_ZERO_CREDIT = [
  "qa.smoke",
  "qa.regression",
  "qa.focused_test",
  "review.independent",
  "review.certification",
  "remediation.qa_failure",
  "remediation.review_finding",
  "retest.after_remediation",
  "preflight.deployment_free",
  "export.generate",
  "export.verify_restore",
];

test("platform QA, review, remediation, retest, certification and export verification are zero-credit", () => {
  for (const kind of MUST_BE_ZERO_CREDIT) {
    assert.equal(billingClassFor(kind), "zero_credit", `${kind} must never be customer-billable`);
  }
});

test("an execution kind cannot exist without a billing classification", () => {
  for (const kind of executionKinds) {
    assert.ok(billingClasses.includes(executionBillingClassification[kind]), `${kind} has no valid class`);
  }
  // The list is DERIVED, not a second list that can drift from the table.
  assert.deepEqual([...executionKinds].sort(), Object.keys(executionBillingClassification).sort());
});

test("an unclassified kind is refused, not silently billed and not silently free", () => {
  assert.equal(isExecutionKind("qa.invented"), false);
  assert.throws(() => billingClassFor("qa.invented"), /Unclassified execution kind/);
  assert.throws(() => isZeroCreditKind("qa.invented"), /Unclassified execution kind/);
  // Specifically NOT treated as free: a billable path shipping unclassified must fail loudly.
  assert.throws(() => classifyExecution(""), /Unclassified execution kind/);
});

test("isZeroCreditKind is DERIVED from the table, not a second list", () => {
  for (const kind of executionKinds) {
    assert.equal(isZeroCreditKind(kind), executionBillingClassification[kind] === "zero_credit", kind);
  }
});

test("a zero-credit execution refuses to be charged", () => {
  const qa = classifyExecution("qa.regression");
  assert.deepEqual(qa, { executionKind: "qa.regression", billingClass: "zero_credit" });
  assert.throws(() => assertChargeable(qa, 1), /Refusing to charge/);
  assert.throws(() => assertChargeable(qa, 25), /zero-credit/);
});

test("a charge of zero is always allowed and is not a charge", () => {
  assert.doesNotThrow(() => assertChargeable(classifyExecution("qa.smoke"), 0));
  assert.doesNotThrow(() => assertChargeable(classifyExecution("build.website_artifact"), 0));
});

test("a customer-billable execution may be charged", () => {
  const build = classifyExecution("build.website_artifact");
  assert.equal(build.billingClass, "customer_billable");
  assert.doesNotThrow(() => assertChargeable(build, 25));
});

test("a forged billing class on the record does not buy a charge", () => {
  // The record claims billable; the table says the work is QA. The intersection refuses.
  const forged: BillableExecution = { executionKind: "review.certification", billingClass: "customer_billable" };
  assert.throws(() => assertChargeable(forged, 10), /Refusing to charge/);
});

test("a stale zero-credit stamp still refuses even if the kind is billable today", () => {
  // The asymmetry: policy change can forgive a charge, never introduce one after the fact.
  const stale: BillableExecution = { executionKind: "build.website_artifact", billingClass: "zero_credit" };
  assert.throws(() => assertChargeable(stale, 10), /Refusing to charge/);
});

test("credit deltas must be finite and non-negative", () => {
  const build = classifyExecution("build.website_artifact");
  assert.throws(() => assertChargeable(build, Number.NaN), /finite number/);
  assert.throws(() => assertChargeable(build, Number.POSITIVE_INFINITY), /finite number/);
  // A negative delta would make this a credit-granting primitive by accident.
  assert.throws(() => assertChargeable(build, -5), /must not be negative/);
});

test("billing class and execution kind are immutable on the record", () => {
  const qa = classifyExecution("qa.smoke");
  assert.throws(() => assertBillingClassUnchanged(qa, { billingClass: "customer_billable" }), /immutable/);
  assert.throws(() => assertBillingClassUnchanged(qa, { executionKind: "build.website_artifact" }), /immutable/);
  // An update that does not touch either field is fine.
  assert.doesNotThrow(() => assertBillingClassUnchanged(qa, {}));
  assert.doesNotThrow(() => assertBillingClassUnchanged(qa, { executionKind: "qa.smoke", billingClass: "zero_credit" }));
});
