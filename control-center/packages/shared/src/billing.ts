/**
 * Billing classification for platform execution.
 *
 * THE RULE THIS ENFORCES: a customer must never spend credits to find out whether code the platform
 * produced is correct. QA, review, certification, the remediation caused by a failed review, the retest
 * after that remediation, and proving an export can actually be restored are all the platform's own
 * correctness work. The customer did not ask for the defect.
 *
 * STATE OF THE WORLD WHEN THIS WAS WRITTEN, stated plainly because it decides the design: there is no
 * debit path in this codebase. No balance, no ledger, no quota, no invoice. `actualCredits` exists on the
 * website-build workflow and is only ever written as the literal `0`; `estimatedCredits` is a number
 * shown to a human. So this module does not fix an active leak — it fixes the ORDER in which the pieces
 * arrive. The classification lands before the mechanism that could charge, which means the first debit
 * path anyone writes has to come through `assertChargeable` and cannot be written without one.
 *
 * ONE TABLE, for the reason `taskTypeClassification` gives in `tasks.ts`: two lists drift, and the drift
 * is fail-open. There it opened an authorization hole; here it would open into the customer's wallet. A
 * kind does not exist until it is classified — omitting an entry does not produce a free execution or a
 * billable one, it produces a kind every function here refuses.
 */

export const billingClasses = ["zero_credit", "customer_billable"] as const;
export type BillingClass = (typeof billingClasses)[number];

/**
 * Every execution kind, WITH its billing class.
 *
 * `zero_credit` covers the platform proving its own work: §7's list, plus §8's deployment-free preflight,
 * which happens entirely before anything touches the customer's server and therefore before any
 * customer-value boundary.
 *
 * `customer_billable` begins only at that boundary — the artifact the customer asked for, and putting it
 * on their server. When in doubt the answer is `zero_credit`: being wrong that way costs the platform
 * money it should have spent anyway, and being wrong the other way charges someone for our own bug.
 */
export const executionBillingClassification = {
  "qa.smoke": "zero_credit",
  "qa.regression": "zero_credit",
  "qa.focused_test": "zero_credit",
  "review.independent": "zero_credit",
  "review.certification": "zero_credit",
  "remediation.qa_failure": "zero_credit",
  "remediation.review_finding": "zero_credit",
  "retest.after_remediation": "zero_credit",
  "preflight.deployment_free": "zero_credit",
  "export.generate": "zero_credit",
  "export.verify_restore": "zero_credit",
  "build.website_artifact": "customer_billable",
  "deploy.customer_server": "customer_billable",
} as const satisfies Record<string, BillingClass>;

export type ExecutionKind = keyof typeof executionBillingClassification;

/** DERIVED from the table above, never maintained beside it. */
export const executionKinds = Object.keys(executionBillingClassification) as ExecutionKind[];

export function isExecutionKind(kind: string): kind is ExecutionKind {
  return Object.prototype.hasOwnProperty.call(executionBillingClassification, kind);
}

/**
 * The billing class of a kind. Throws on anything unclassified rather than assuming.
 *
 * "Unclassified" must not resolve to `zero_credit` either. Silently free looks harmless and is not: it
 * would let a genuinely billable path ship unclassified and unnoticed, and the platform would discover
 * the misclassification from its own margin rather than from a failing test.
 */
export function billingClassFor(kind: string): BillingClass {
  if (!isExecutionKind(kind)) {
    throw new Error(`Unclassified execution kind: ${JSON.stringify(kind)}. Add it to executionBillingClassification.`);
  }
  return executionBillingClassification[kind];
}

/** DERIVED, so it cannot disagree with the table. */
export function isZeroCreditKind(kind: string): boolean {
  return billingClassFor(kind) === "zero_credit";
}

/** The billing-bearing fields of an execution record. Structural, so callers need not import a doc type. */
export type BillableExecution = { executionKind: string; billingClass: BillingClass };

/**
 * Stamp a new execution record. The class is derived at creation and is immutable from then on — see
 * `assertBillingClassUnchanged`.
 */
export function classifyExecution(kind: string): { executionKind: ExecutionKind; billingClass: BillingClass } {
  const billingClass = billingClassFor(kind);
  // `billingClassFor` throws unless the kind is in the table, so by here the narrowing is sound. The
  // return type is narrower than `BillableExecution` on purpose: a record being CREATED must carry a
  // known kind, while a record being READ BACK may carry anything the database holds.
  return { executionKind: kind as ExecutionKind, billingClass };
}

/**
 * THE SERVER-SIDE ENFORCEMENT POINT. Every debit must pass through here.
 *
 * Charging requires BOTH the class recorded on the execution and the class the table gives today to say
 * `customer_billable`. That intersection is deliberate and asymmetric:
 *
 *   - reclassifying a kind to `zero_credit` stops charges immediately, including on records already
 *     stamped `customer_billable` — the fix takes effect without a migration;
 *   - reclassifying a kind to `customer_billable` does NOT retroactively make old zero-credit records
 *     chargeable, because the record's own stamp still refuses.
 *
 * A change of policy can therefore only ever forgive a charge, never introduce one after the fact.
 */
export function assertChargeable(execution: BillableExecution, creditsDelta: number): void {
  if (!Number.isFinite(creditsDelta)) {
    throw new Error(`Credit delta must be a finite number, received ${JSON.stringify(creditsDelta)}.`);
  }
  if (creditsDelta < 0) {
    // Refunds are a separate operation with separate authority. Letting a negative delta through here
    // would make this function a credit-granting primitive by accident.
    throw new Error(`Credit delta must not be negative, received ${creditsDelta}. Refunds are not a charge.`);
  }
  // Zero is always allowed and is not a charge. Every current caller passes zero; that is the point.
  if (creditsDelta === 0) return;

  const current = billingClassFor(execution.executionKind);
  if (execution.billingClass !== "customer_billable" || current !== "customer_billable") {
    throw new Error(
      `Refusing to charge ${creditsDelta} credit(s) to a ${execution.billingClass} execution ` +
        `(${execution.executionKind}, currently classified ${current}). ` +
        `Platform QA, review, remediation, retest, certification and export verification are zero-credit.`,
    );
  }
}

/**
 * The class is immutable for the life of the execution record.
 *
 * Enforced on the write path rather than trusted, because "immutable" that is only a comment is a field
 * anyone can `$set`. An update that carries a different class is refused outright rather than merged.
 */
export function assertBillingClassUnchanged(recorded: BillableExecution, incoming: Partial<BillableExecution>): void {
  if (incoming.executionKind !== undefined && incoming.executionKind !== recorded.executionKind) {
    throw new Error(
      `Execution kind is immutable: ${recorded.executionKind} cannot become ${incoming.executionKind}. ` +
        `A different kind of work is a different execution record.`,
    );
  }
  if (incoming.billingClass !== undefined && incoming.billingClass !== recorded.billingClass) {
    throw new Error(
      `Billing class is immutable: ${recorded.billingClass} cannot become ${incoming.billingClass}.`,
    );
  }
}
