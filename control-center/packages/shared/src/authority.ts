/**
 * Capability envelopes: what an actor may do, and the rule that it can only ever be less.
 *
 * §12 of the master brief: "Authority is capability-based and subset-only: a child task/agent cannot
 * grant itself more authority than its parent envelope." §16: "No autonomous agent may expand its own
 * authority."
 *
 * WHERE THIS SITS AMONG THE LAYERS THAT ALREADY EXIST, because adding a fourth notion of "allowed" to a
 * system with three is how authority becomes unreviewable:
 *
 *   - `rbac.ts` answers "what may this HUMAN do", by role. Coarse, durable, per-user.
 *   - `ownerAuthorization.ts` answers "did the offline owner sign THIS action", per privileged task.
 *   - the review gate answers "has this candidate been independently reviewed", per candidate.
 *   - this module answers "what is the CEILING on this actor's authority, and did it inherit that
 *     ceiling legitimately" — per delegation, across a chain of agents and tasks.
 *
 * None of those subsumes this one. A role is not a ceiling: it does not shrink when an owner delegates a
 * narrow task to an agent that then spawns a narrower one. That shrinking is the whole subject here.
 *
 * THE ONE PROPERTY EVERYTHING ELSE SERVES: authority only ever narrows. There is deliberately no
 * function in this module that returns an envelope with a capability its parent lacked, and no
 * parameter anywhere that widens one. Escalation is not rejected by a check that could be forgotten; it
 * is unrepresentable.
 */

import { assertChargeable, type BillableExecution } from "./billing.js";

/**
 * The separately-gated authority classes §12 names, plus the ordinary engineering work that needs none
 * of them.
 *
 * "Separately represented" is the requirement, and it is a real constraint rather than bookkeeping: the
 * failure it exists to prevent is one `admin: true` bit that happens to carry deployment, credential
 * issuance and destructive power at once, so that granting an agent the right to restart a service also
 * silently grants it the right to mint credentials. These grades never collapse into each other, and no
 * function here treats holding one as evidence for another.
 */
export const authorityGrades = ["ordinary", "paid", "destructive", "production", "credential"] as const;
export type AuthorityGrade = (typeof authorityGrades)[number];

/**
 * Every capability, WITH its grade. One table — the reason is written out in `tasks.ts`: two lists
 * drift, and the drift is fail-open. A capability does not exist until it is graded.
 */
export const capabilityClassification = {
  "engineering.inspect": "ordinary",
  "engineering.implement": "ordinary",
  "engineering.test": "ordinary",
  "review.request": "ordinary",
  "review.verdict": "ordinary",
  "execution.paid": "paid",
  "operation.destructive": "destructive",
  "production.deploy": "production",
  "production.credentials": "production",
  "credential.issue": "credential",
  "credential.rotate": "credential",
} as const satisfies Record<string, AuthorityGrade>;

export type Capability = keyof typeof capabilityClassification;

/** DERIVED from the table, never maintained beside it. */
export const capabilities = Object.keys(capabilityClassification) as Capability[];

export function isCapability(value: string): value is Capability {
  return Object.prototype.hasOwnProperty.call(capabilityClassification, value);
}

export function gradeOf(capability: string): AuthorityGrade {
  if (!isCapability(capability)) {
    throw new Error(`Unknown capability: ${JSON.stringify(capability)}. Add it to capabilityClassification.`);
  }
  return capabilityClassification[capability];
}

/**
 * An issued envelope.
 *
 * `capabilities` is the CEILING, not a request: holding the envelope means every listed capability was
 * present in the parent at derivation time and has not expired since.
 */
export type AuthorityEnvelope = {
  readonly envelopeId: string;
  /** `null` only for a root envelope, which no derivation can produce. */
  readonly parentEnvelopeId: string | null;
  readonly subjectId: string;
  readonly capabilities: readonly Capability[];
  readonly issuedAt: string;
  readonly expiresAt: string;
};

function parseInstant(value: string, field: string): number {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error(`${field} is not a valid instant: ${JSON.stringify(value)}`);
  return ms;
}

function assertGradedAndUnique(list: readonly string[], field: string): readonly Capability[] {
  const seen = new Set<string>();
  for (const item of list) {
    if (!isCapability(item)) {
      throw new Error(`${field} contains an unknown capability: ${JSON.stringify(item)}`);
    }
    if (seen.has(item)) throw new Error(`${field} lists ${item} more than once`);
    seen.add(item);
  }
  return [...list] as Capability[];
}

/**
 * Issue a ROOT envelope. There is no parent to bound it, so this is the one place authority can enter
 * the system, and it must never be reachable from request data.
 *
 * Call it only where the grant is already established by something outside this module — an owner
 * decision, a signed configuration. `deriveChildEnvelope` is the only other way to obtain an envelope,
 * and it can only narrow.
 */
export function issueRootEnvelope(input: {
  envelopeId: string;
  subjectId: string;
  capabilities: readonly string[];
  issuedAt: string;
  expiresAt: string;
}): AuthorityEnvelope {
  const issuedAt = parseInstant(input.issuedAt, "issuedAt");
  const expiresAt = parseInstant(input.expiresAt, "expiresAt");
  if (expiresAt <= issuedAt) throw new Error("An envelope must expire after it is issued");
  if (!input.envelopeId) throw new Error("envelopeId is required");
  if (!input.subjectId) throw new Error("subjectId is required");
  return Object.freeze({
    envelopeId: input.envelopeId,
    parentEnvelopeId: null,
    subjectId: input.subjectId,
    capabilities: Object.freeze(assertGradedAndUnique(input.capabilities, "capabilities")),
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
  });
}

/**
 * Derive a child envelope. SUBSET-ONLY, and the only delegation path.
 *
 * Every refusal names the specific capability, because "authority mismatch" without the offending
 * capability sends whoever reads the log back to diff two lists by hand.
 *
 * Note what is absent: no `force`, no `additionalCapabilities`, no merge with a second envelope. A
 * caller that wants the child to hold something the parent lacks has no argument to pass.
 */
export function deriveChildEnvelope(
  parent: AuthorityEnvelope,
  request: { envelopeId: string; subjectId: string; capabilities: readonly string[]; issuedAt: string; expiresAt: string },
): AuthorityEnvelope {
  const requested = assertGradedAndUnique(request.capabilities, "capabilities");

  const escalations = requested.filter((capability) => !parent.capabilities.includes(capability));
  if (escalations.length > 0) {
    throw new Error(
      `Refusing to derive an envelope that exceeds its parent. ` +
        `Parent ${parent.envelopeId} does not hold: ${escalations.join(", ")}. ` +
        `A child may hold fewer capabilities than its parent, never more.`,
    );
  }

  const issuedAt = parseInstant(request.issuedAt, "issuedAt");
  const expiresAt = parseInstant(request.expiresAt, "expiresAt");
  if (expiresAt <= issuedAt) throw new Error("An envelope must expire after it is issued");

  // Time is authority too. A child outliving its parent would let a delegation survive the grant it came
  // from, which is escalation with extra steps.
  const parentExpiry = parseInstant(parent.expiresAt, "parent.expiresAt");
  if (expiresAt > parentExpiry) {
    throw new Error(
      `Refusing to derive an envelope that outlives its parent: ` +
        `child expires ${request.expiresAt}, parent ${parent.expiresAt}.`,
    );
  }
  if (!request.envelopeId) throw new Error("envelopeId is required");
  if (request.envelopeId === parent.envelopeId) {
    throw new Error("A child envelope must have its own identity, distinct from its parent's");
  }
  if (!request.subjectId) throw new Error("subjectId is required");

  return Object.freeze({
    envelopeId: request.envelopeId,
    parentEnvelopeId: parent.envelopeId,
    subjectId: request.subjectId,
    capabilities: Object.freeze(requested),
    issuedAt: request.issuedAt,
    expiresAt: request.expiresAt,
  });
}

/**
 * FAIL-CLOSED (§3): an expired envelope, an unknown capability, or a capability the envelope does not
 * hold all stop the transition. There is no "warn and continue" path.
 */
export function assertCapability(envelope: AuthorityEnvelope, capability: string, now: number = Date.now()): void {
  // Throws on an unknown capability rather than reporting it as "not held". A typo'd capability name
  // must fail loudly at the call site; reporting it as merely absent would let a guard silently
  // protect nothing while reading as though it protected something.
  gradeOf(capability);
  const required = capability as Capability;
  const expiresAt = parseInstant(envelope.expiresAt, "expiresAt");
  if (now >= expiresAt) {
    throw new Error(
      `Envelope ${envelope.envelopeId} expired at ${envelope.expiresAt}; refusing ${capability}. ` +
        `An expired envelope authorises nothing, including work already in flight.`,
    );
  }
  if (!envelope.capabilities.includes(required)) {
    throw new Error(
      `Envelope ${envelope.envelopeId} does not hold ${capability} ` +
        `(holds: ${envelope.capabilities.join(", ") || "nothing"}).`,
    );
  }
}

export function hasCapability(envelope: AuthorityEnvelope, capability: string, now: number = Date.now()): boolean {
  try {
    assertCapability(envelope, capability, now);
    return true;
  } catch {
    return false;
  }
}

/** The separately-gated grades this envelope actually carries. `ordinary` is not reported as a grade. */
export function gradesHeld(envelope: AuthorityEnvelope): AuthorityGrade[] {
  const grades = new Set<AuthorityGrade>();
  for (const capability of envelope.capabilities) {
    const grade = gradeOf(capability);
    if (grade !== "ordinary") grades.add(grade);
  }
  return [...grades];
}

/**
 * A reference to an envelope, as it arrives from an agent.
 *
 * THIS IS THE ANTI-SELF-EXPANSION BOUNDARY, and it is a type rather than a check because a check gets
 * skipped. An agent sends the ID of the envelope it believes it holds; it does not send the envelope.
 * The server resolves that ID against its own store and uses what IT holds. Nothing an agent can put on
 * the wire is an `AuthorityEnvelope`, so there is no code path where a request's own claim about its
 * capabilities is consulted.
 *
 * The failure this prevents is the obvious one: an agent that reports `capabilities: ["production.deploy"]`
 * and is believed.
 */
export type UntrustedEnvelopeRef = { readonly envelopeId: string };

export function parseUntrustedEnvelopeRef(value: unknown): UntrustedEnvelopeRef {
  if (typeof value !== "object" || value === null) throw new Error("Envelope reference must be an object");
  const id = (value as Record<string, unknown>).envelopeId;
  if (typeof id !== "string" || id.length === 0) throw new Error("Envelope reference must carry a string envelopeId");
  // Deliberately drops every other field. If the caller sent `capabilities`, it is discarded here rather
  // than validated, because validating it would imply it could ever be used.
  return Object.freeze({ envelopeId: id });
}

/**
 * Paid execution asks two independent questions, and needs both answered yes.
 *
 * `assertChargeable` (P0-3) asks whether THIS WORK may be charged at all — QA, review and remediation
 * never may, regardless of who is asking. `execution.paid` asks whether THIS ACTOR may charge. Neither
 * implies the other: an owner-grade envelope still cannot bill a customer for the platform's own QA, and
 * a genuinely billable build still cannot be charged by an agent that was never delegated the authority.
 */
export function assertPaidExecutionAuthorised(
  envelope: AuthorityEnvelope,
  execution: BillableExecution,
  creditsDelta: number,
  now: number = Date.now(),
): void {
  assertChargeable(execution, creditsDelta);
  if (creditsDelta > 0) assertCapability(envelope, "execution.paid", now);
}
