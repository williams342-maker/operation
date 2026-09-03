import crypto from "node:crypto";
import { z } from "zod";
import { ACTIONS, BLOCKING_SEVERITIES, SUPERSEDABLE, type ReviewAction } from "./actions.js";
import type { AuthenticatedPrincipal } from "./auth.js";
import {
  candidateBindingSchema,
  candidateDigest,
  contentDigest,
  independenceOf,
  verdictSchema,
  type CandidateBinding,
  type ReviewState,
} from "./policy.js";
import type {
  CandidateRecord,
  FindingOccurrence,
  IdempotencyKey,
  ReviewGateStore,
  StoredVerdict,
} from "./store.js";

// The authoritative boundary.
//
// A CALLER SUPPLIES INTENT. EVERYTHING ELSE IS LOADED OR DERIVED:
//
//   current state              loaded from the store, never accepted
//   candidate binding + digest loaded from the store, never accepted
//   participation ledger       loaded, and written by the operations that create it
//   actor identity             resolved by the gate from a credential (auth.ts), never from a payload
//   reviewer authority         a fact in the gate's database, never a claim in a request
//   the transition             DERIVED from a named action, never named by the caller
//
// The last line is the one that took longest to get right. Every earlier revision let the caller name the
// state it wanted, which is one step from letting it declare the state it is in.

/** Which budget an occurrence is charged to. Review work is never a customer debit. */
export const billingClasses = [
  "CUSTOMER_VALUE_WORK",
  "INTERNAL_QA_TEST",
  "INTERNAL_REVIEW",
  "INTERNAL_DEFECT_REMEDIATION",
  "INTERNAL_RELEASE_VERIFICATION",
  "OWNER_APPROVED_SCOPE_CHANGE",
  "NON_BILLABLE_FAILURE_RECOVERY",
] as const;
export type BillingClass = (typeof billingClasses)[number];

export const nonBillableClasses: readonly BillingClass[] = Object.freeze([
  "INTERNAL_QA_TEST",
  "INTERNAL_REVIEW",
  "INTERNAL_DEFECT_REMEDIATION",
  "INTERNAL_RELEASE_VERIFICATION",
  "NON_BILLABLE_FAILURE_RECOVERY",
]);

export function isCustomerBillable(billingClass: BillingClass): boolean {
  return !nonBillableClasses.includes(billingClass);
}

export type ServiceResult =
  | { ok: true; state: ReviewState }
  | { ok: false; code: string; message: string };

const fail = (code: string, message: string): ServiceResult => ({ ok: false, code, message });

// NOTE the absence of an identity field, a state field, and a participants field. None of them is
// request data; there is no shape here a caller could use to describe its own position.
const intentSchema = z.object({
  candidateId: z.string().min(1).max(200),
  idempotencyKey: z.string().min(1).max(200),
  billingClass: z.enum(billingClasses),
});

/**
 * Every blocking finding a candidate still owes an answer for.
 *
 * Findings ACCUMULATE and are removed only by a reviewer discharging them, and the replay is CAUSAL: a
 * discharge applies to what is outstanding when it happens. An earlier version deleted every id ever
 * mentioned in any verdict's `resolves` in a second pass, so a resolution could precede the finding it
 * discharged — a tombstone laid for a defect that did not exist yet.
 *
 * Identity is the gate-generated OCCURRENCE id, never the reviewer's label, so a reused label cannot
 * conflate unrelated defects across verdicts or lineage.
 */
export function outstandingFindings(record: CandidateRecord): readonly FindingOccurrence[] {
  const raised = new Map<string, FindingOccurrence>();
  for (const finding of record.inherited ?? []) raised.set(finding.occurrenceId, finding);
  for (const verdict of record.verdicts) {
    if (verdict.verdict === "NO_GO") {
      for (const finding of verdict.findings) {
        if (BLOCKING_SEVERITIES.includes(finding.severity)) raised.set(finding.occurrenceId, finding);
      }
    }
    for (const id of verdict.resolves) raised.delete(id);
  }
  return [...raised.values()];
}

export class ReviewGateService {
  // Runtime-private. `private readonly` compiles to an ordinary property, so `(service as any).store`
  // handed the store back and the whole gate could be driven around it.
  readonly #store: ReviewGateStore;
  readonly #clock: () => string;
  readonly #ids: () => string;

  constructor(store: ReviewGateStore, options: {
    clock?: () => string;
    ids?: () => string;
  } = {}) {
    this.#store = store;
    this.#clock = options.clock ?? (() => new Date().toISOString());
    this.#ids = options.ids ?? (() => crypto.randomUUID());
  }

  #idem(principal: AuthenticatedPrincipal, scope: string, key: string, request: unknown): IdempotencyKey {
    return {
      principalId: principal.principalId,
      scope,
      key,
      requestHash: crypto.createHash("sha256").update(JSON.stringify(request) ?? "").digest("hex"),
    };
  }

  // ── registration ────────────────────────────────────────────────────────────────────────────────

  async createCandidate(principal: AuthenticatedPrincipal, input: {
    candidateId: string;
    binding: CandidateBinding;
    idempotencyKey: string;
  }): Promise<ServiceResult> {
    let binding: CandidateBinding;
    try {
      binding = candidateBindingSchema.parse(input.binding);
    } catch (error) {
      return fail("malformed_input", (error as Error).message.slice(0, 300));
    }
    if (binding.authorIdentity !== principal.principalId) {
      return fail("author_actor_mismatch",
        "the binding names a different author than the authenticated actor");
    }
    const now = this.#clock();
    const result = await this.#store.registerCandidate({
      record: {
        candidateId: input.candidateId,
        digest: candidateDigest(binding),
        contentDigest: contentDigest(binding),
        binding,
        state: "BUILT",
        participants: [{ identity: binding.authorIdentity, role: "author", at: now }],
        occurrences: [],
        verdicts: [],
      },
      idempotency: this.#idem(principal, "register", input.idempotencyKey, input),
    });
    if (!result.applied) return fail(result.code, describe(result.code));
    return { ok: true, state: "BUILT" };
  }

  async createSuccessor(principal: AuthenticatedPrincipal, input: {
    candidateId: string;
    supersedes: string;
    binding: CandidateBinding;
    remediates?: readonly string[];
    idempotencyKey: string;
  }): Promise<ServiceResult> {
    const prior = await this.#store.loadCandidate(input.supersedes);
    if (!prior) return fail("unknown_candidate", "no such prior candidate");
    let binding: CandidateBinding;
    try {
      binding = candidateBindingSchema.parse(input.binding);
    } catch (error) {
      return fail("malformed_input", (error as Error).message.slice(0, 300));
    }
    if (binding.authorIdentity !== principal.principalId) {
      return fail("author_actor_mismatch", "the binding names a different author");
    }
    if (contentDigest(binding) === prior.contentDigest) {
      return fail("successor_identical",
        "a successor must change the work; new paperwork over identical content is not a remediation");
    }
    if (binding.projectId !== prior.binding.projectId
      || binding.repository !== prior.binding.repository) {
      return fail("successor_lineage_mismatch",
        "a successor must belong to the same project and repository as what it replaces");
    }
    if (!SUPERSEDABLE.includes(prior.state)) {
      return fail("prior_not_supersedable",
        `a candidate in ${prior.state} is not awaiting remediation; nothing to supersede`);
    }
    // Only the party RESPONSIBLE for the work may replace it. "Any participant" was too wide: a reviewer
    // is a participant, and letting a reviewer author the replacement launders independence.
    const responsible = new Set<string>([
      prior.binding.authorIdentity,
      ...prior.participants.filter((p) => p.role === "remediator").map((p) => p.identity),
    ]);
    if (!responsible.has(principal.principalId)) {
      return fail("successor_actor_uninvolved",
        "only the author of the rejected candidate, or a recorded remediator, may replace it");
    }

    const blocking = outstandingFindings(prior);
    const claimed = new Set(input.remediates ?? []);
    const unaddressed = blocking.filter((f) => !claimed.has(f.occurrenceId));
    if (unaddressed.length > 0) {
      return fail("findings_unaddressed",
        "a successor must address every CRITICAL and MAJOR finding of the rejection it replaces; " +
        `outstanding: ${unaddressed.map((f) => f.occurrenceId).join(", ")}`);
    }
    const invented = [...claimed].filter((id) => !blocking.some((f) => f.occurrenceId === id));
    if (invented.length > 0) {
      return fail("findings_unknown", `no such finding on the predecessor: ${invented.join(", ")}`);
    }

    const now = this.#clock();
    const result = await this.#store.createSuccessor({
      predecessorId: input.supersedes,
      successor: {
        candidateId: input.candidateId,
        digest: candidateDigest(binding),
        contentDigest: contentDigest(binding),
        binding,
        state: "BUILT",
        supersedes: input.supersedes,
        remediates: [...claimed],
        participants: [{ identity: binding.authorIdentity, role: "author", at: now }],
        occurrences: [],
        verdicts: [],
      },
      // Carried forward, NOT discharged. The author has said which of these they addressed; a reviewer
      // still has to agree before any of them stops blocking.
      inherited: blocking,
      at: now,
      idempotency: this.#idem(principal, "successor", input.idempotencyKey, input),
    });
    if (!result.applied) return fail(result.code, describe(result.code));
    return { ok: true, state: "BUILT" };
  }

  // ── evidence ────────────────────────────────────────────────────────────────────────────────────

  async recordTestExecution(principal: AuthenticatedPrincipal, input: z.input<typeof intentSchema> & {
    evidenceId: string;
    resultDigest: string;
    runnerIdentity: string;
    runReference: string;
  }): Promise<ServiceResult> {
    let intent: z.infer<typeof intentSchema>;
    try {
      intent = intentSchema.parse(input);
      z.string().regex(/^[a-f0-9]{64}$/).parse(input.resultDigest);
      z.string().min(1).max(200).parse(input.evidenceId);
      z.string().min(1).max(200).parse(input.runnerIdentity);
      z.string().min(1).max(500).parse(input.runReference);
    } catch (error) {
      return fail("malformed_input", (error as Error).message.slice(0, 300));
    }
    if (isCustomerBillable(intent.billingClass)) {
      return fail("billing_class_not_internal", "recording a test run is internal cost");
    }
    if (!principal.hasRole("ci")) {
      return fail("role_required", "recording a test execution requires the ci role");
    }
    const record = await this.#store.loadCandidate(intent.candidateId);
    if (!record) return fail("unknown_candidate", "no such candidate");

    // SEPARATION OF DUTIES. The author invented the testResultDigest; letting them also record evidence
    // for it is self-attestation with an extra step. NOT provenance — a CI identity is still an
    // authenticated caller making an assertion, and nothing here verifies a test ran.
    if (principal.principalId === record.binding.authorIdentity) {
      return fail("evidence_actor_is_author", "the author of a candidate cannot record its test evidence");
    }
    const result = await this.#store.recordEvidence({
      evidence: {
        evidenceId: input.evidenceId,
        candidateId: intent.candidateId,
        resultDigest: input.resultDigest,
        runnerIdentity: input.runnerIdentity,
        runReference: input.runReference,
        contentDigest: record.contentDigest,
        recordedBy: principal.principalId,
        at: this.#clock(),
      },
      idempotency: this.#idem(principal, "evidence", input.idempotencyKey, input),
    });
    if (!result.applied) return fail(result.code, describe(result.code));
    return { ok: true, state: record.state };
  }

  // ── named lifecycle actions ─────────────────────────────────────────────────────────────────────

  async performAction(principal: AuthenticatedPrincipal, input: z.input<typeof intentSchema> & {
    action: ReviewAction;
  }): Promise<ServiceResult> {
    let intent: z.infer<typeof intentSchema>;
    try {
      intent = intentSchema.parse(input);
    } catch (error) {
      return fail("malformed_input", (error as Error).message.slice(0, 300));
    }
    const rule = ACTIONS[input.action];
    if (!rule) return fail("unknown_action", "no such action");
    if (isCustomerBillable(intent.billingClass)) {
      return fail("billing_class_not_internal",
        `review-gate work must not be customer-billable; got ${intent.billingClass}`);
    }
    const record = await this.#store.loadCandidate(intent.candidateId);
    if (!record) return fail("unknown_candidate", "no such candidate");
    if (!rule.from.includes(record.state)) {
      return fail("illegal_transition", `${input.action} is not legal from ${record.state}`);
    }
    if (rule.role && !principal.hasRole(rule.role)) {
      return fail("role_required", `${input.action} requires the ${rule.role} role`);
    }
    if (rule.refuseAuthor && principal.principalId === record.binding.authorIdentity) {
      return fail("evidence_actor_is_author", "the author of a candidate cannot attest its tests");
    }
    // A rule with no relationships is authorized by its role alone. That is only ever the CI actions:
    // a build runner is not a participant in a candidate and does not become one by attesting a run.
    if (rule.who && !this.#satisfiesRelationship(principal, record, rule.who)) {
      return fail("actor_not_authorized",
        `${input.action} requires one of: ${rule.who.join(", ")}`);
    }

    // Evidence gates TESTED, and it is checked AFTER the authorization above so a caller is told the
    // first thing wrong with the request rather than the last thing added to it.
    if (rule.to === "TESTED") {
      const gate = await this.#evidenceGate(record);
      if (gate) return gate;
    }

    const now = this.#clock();
    // The store derives the transition, the participation row, the claimant record and the claim
    // release from the ACTION. This service no longer passes a destination, because a port that accepts
    // one is the round-8 primitive under another name -- a holder could request any graph-legal change
    // while also choosing the audit identity and whether to release the content claim.
    const result = await this.#store.applyAction({
      candidateId: intent.candidateId,
      action: input.action,
      actorIdentity: principal.principalId,
      billingClass: intent.billingClass,
      at: now,
      occurrenceId: this.#ids(),
      idempotency: this.#idem(principal, `action:${input.action}`, input.idempotencyKey, input),
    });
    if (!result.applied) return fail(result.code, describe(result.code));
    return { ok: true, state: rule.to };
  }

  #satisfiesRelationship(
    principal: AuthenticatedPrincipal,
    record: CandidateRecord,
    who: readonly string[],
  ): boolean {
    const isAuthor = record.binding.authorIdentity === principal.principalId;
    const isParticipant = isAuthor
      || record.participants.some((p) => p.identity === principal.principalId);
    for (const relationship of who) {
      if (relationship === "author" && isAuthor) return true;
      if (relationship === "participant" && isParticipant) return true;
      if (relationship === "owner" && principal.hasRole("owner")) return true;
      if (relationship === "remediator"
        && record.participants.some((p) =>
          p.identity === principal.principalId && p.role === "remediator")) return true;
      // The RECORDED claimant, not merely someone with a reviewer row. A reviewer row appears only
      // after a verdict, so before one this is the only way to identify who is reviewing.
      if (relationship === "claiming-reviewer"
        && record.claimedByPrincipalId === principal.principalId) return true;
      if (relationship === "unconflicted-reviewer") {
        // The single stranger entry point, and it is narrow: the class the CANDIDATE asked for, held by
        // someone with no prior participation. It grants no role, so it cannot be used to enrol.
        if (!isParticipant
          && principal.holdsReviewerClass(record.binding.requestedReviewerClass)) return true;
      }
    }
    return false;
  }

  async #evidenceGate(record: CandidateRecord): Promise<ServiceResult | null> {
    const evidence = await this.#store.loadEvidence(record.candidateId);
    const matching = evidence.filter((e) => e.resultDigest === record.binding.testResultDigest);
    if (matching.length === 0) {
      return fail("no_test_evidence",
        "no recorded test execution matches the digest this candidate is bound to");
    }
    const lastRemediation = [...record.occurrences]
      .filter((o) => o.to === "REMEDIATING")
      .map((o) => Date.parse(o.at))
      .sort((a, b) => b - a)[0];
    // Strictly after. `>=` let evidence recorded in the same millisecond as the remediation count as
    // following it, which a fixed test clock reproduces trivially.
    if (lastRemediation !== undefined && !matching.some((e) => Date.parse(e.at) > lastRemediation)) {
      return fail("stale_test_evidence",
        "a retest must be evidenced by a run recorded after the remediation it follows");
    }
    return null;
  }

  // ── verdicts ────────────────────────────────────────────────────────────────────────────────────

  async submitVerdict(principal: AuthenticatedPrincipal, input: z.input<typeof intentSchema> & {
    verdict: unknown;
  }): Promise<ServiceResult> {
    let intent: z.infer<typeof intentSchema>;
    let verdict: z.infer<typeof verdictSchema>;
    try {
      intent = intentSchema.parse(input);
      verdict = verdictSchema.parse(input.verdict);
    } catch (error) {
      return fail("malformed_input", (error as Error).message.slice(0, 300));
    }
    if (intent.billingClass !== "INTERNAL_REVIEW") {
      return fail("billing_class_not_review", "a verdict is INTERNAL_REVIEW work");
    }
    const record = await this.#store.loadCandidate(intent.candidateId);
    if (!record) return fail("unknown_candidate", "no such candidate");
    if (record.state !== "REVIEW_IN_PROGRESS") {
      return fail("illegal_transition", `a verdict is not legal from ${record.state}`);
    }
    // The class the CANDIDATE requested, not one the reviewer claims. This field was parsed and never
    // consulted for several rounds, so a candidate could ask for an independent reviewer and be approved
    // by whoever turned up without a conflicting participation record.
    if (!principal.holdsReviewerClass(record.binding.requestedReviewerClass)) {
      return fail("reviewer_class_not_held",
        `this candidate requested a ${record.binding.requestedReviewerClass} reviewer`);
    }
    if (verdict.reviewerIdentity !== principal.principalId) {
      return fail("verdict_actor_mismatch",
        "the verdict names a different reviewer than the authenticated actor");
    }
    // THE RECORDED CLAIMANT, and only them. Requiring merely "a reviewer holding the class" would let
    // a reviewer who never claimed the review submit its verdict, and would let a participant who also
    // happens to hold the reviewer role do so -- both of which bypass independence before it is checked.
    if (record.claimedByPrincipalId !== principal.principalId) {
      return fail("verdict_actor_not_claimant",
        "only the reviewer who claimed this review may submit its verdict");
    }
    if (verdict.candidateDigest !== record.digest) {
      return fail("candidate_identity_mismatch", "the verdict is for a different candidate");
    }
    const independence = independenceOf(principal.principalId, record.participants,
      record.binding.authorIdentity);
    if (!independence.independent) {
      return fail("reviewer_not_independent", independence.reason);
    }

    const outstanding = outstandingFindings(record);
    const outstandingIds = new Set(outstanding.map((f) => f.occurrenceId));
    const raisedHere = verdict.findings.map((f) => ({
      // The gate generates the occurrence id. The reviewer's label survives for display only, so a reused
      // label cannot conflate unrelated defects.
      occurrenceId: this.#ids(),
      label: f.id,
      severity: f.severity,
      summary: f.summary,
      raisedInVerdictId: "",
    }));
    const selfDischarged = verdict.resolves.filter((id) => raisedHere.some((f) => f.occurrenceId === id));
    if (selfDischarged.length > 0) {
      return fail("verdict_resolves_own_finding",
        `a verdict cannot raise and discharge the same finding: ${selfDischarged.join(", ")}`);
    }
    const notOutstanding = verdict.resolves.filter((id) => !outstandingIds.has(id));
    if (notOutstanding.length > 0) {
      return fail("resolves_unknown_finding",
        "a discharge must name a finding that is currently outstanding on this candidate; " +
        `not outstanding: ${notOutstanding.join(", ")}`);
    }

    const to: ReviewState = verdict.verdict === "GO" ? "GO" : "NO_GO";
    if (to === "GO") {
      const owed = outstanding.filter((f) => !verdict.resolves.includes(f.occurrenceId));
      if (owed.length > 0) {
        return fail("findings_outstanding",
          "cannot approve while findings remain undischarged; resolve them explicitly in the verdict: " +
          owed.map((f) => f.occurrenceId).join(", "));
      }
    }
    if (to === "NO_GO" && verdict.findings.length === 0) {
      return fail("findings_required", "a rejection must say why");
    }

    const now = this.#clock();
    const verdictId = this.#ids();
    const stored: StoredVerdict = {
      verdictId,
      reviewerIdentity: principal.principalId,
      verdict: verdict.verdict,
      findings: raisedHere.map((f) => ({ ...f, raisedInVerdictId: verdictId })),
      resolves: [...verdict.resolves],
      submittedAt: verdict.submittedAt,
      at: now,
    };
    const result = await this.#store.applyVerdict({
      candidateId: intent.candidateId,
      expectedState: record.state,
      nextState: to,
      occurrence: {
        occurrenceId: this.#ids(),
        from: record.state,
        to,
        actorIdentity: principal.principalId,
        billingClass: intent.billingClass,
        at: now,
      },
      verdict: stored,
      addParticipant: { identity: principal.principalId, role: "reviewer", at: now },
      // Re-checked at COMMIT, not merely when this method looked.
      requireContentNotRejected: to === "GO" ? record.contentDigest : undefined,
      rejectContent: to === "NO_GO" ? record.contentDigest : undefined,
      idempotency: this.#idem(principal, "verdict", input.idempotencyKey, input),
    });
    if (!result.applied) return fail(result.code, describe(result.code));
    return { ok: true, state: to };
  }
}

/** Store refusal codes carry no prose; the service supplies it so callers get one vocabulary. */
function describe(code: string): string {
  const messages: Record<string, string> = {
    candidate_exists: "candidate id already registered",
    content_already_live: "another live candidate already carries this exact work",
    content_already_rejected: "this exact content was rejected; remediation must change the work",
    content_already_released: "this content was already released; a change produces a different digest",
    record_not_initial: "a candidate begins at BUILT with nothing behind it",
    state_moved: "the candidate changed state since it was read",
    occurrence_replayed: "this occurrence was already applied",
    illegal_transition: "that move is not legal from the current state",
    candidate_superseded: "this candidate has been replaced by a successor",
    evidence_replayed: "that evidence id was already recorded",
    idempotent_replay: "this request was already applied",
    idempotency_key_reused: "that idempotency key was used for a different request",
    unknown_predecessor: "no such prior candidate",
    predecessor_already_superseded: "that candidate has already been replaced",
    successor_identical: "a successor must change the work",
    claim_not_held: "this candidate does not hold that content claim",
  };
  return messages[code] ?? code;
}
