import { z } from "zod";
import {
  candidateBindingSchema,
  candidateDigest,
  contentDigest,
  verdictSchema,
  type CandidateBinding,
  type Participant,
  type ReviewState,
  type Verdict,
} from "./reviewGate.js";
import { evaluateTransition } from "./reviewGateInternal.js";

// The authoritative boundary for the review gate.
//
// WHY THIS EXISTS. An independent review of the first candidate found that `evaluateTransition` accepted
// the current state, the participation ledger, the candidate binding AND the verdict from its caller. It
// authenticated none of them. A caller could therefore synthesise the entire safety argument:
//
//     evaluateTransition({ from: "REVIEW_IN_PROGRESS", to: "GO", participants: [], verdict: { ... } })
//
// returned ok, and the next call could claim `from: "GO"` and reach READY_FOR_OWNER_DECISION. The
// transition table could not repair that, because the caller also supplied the position in the table.
// The module claimed "trust is not input" while taking every authoritative fact as input.
//
// The rule this file enforces: A CALLER SUPPLIES INTENT AND IDENTITY. EVERYTHING ELSE IS LOADED.
//
//   - current state              loaded from the store, never accepted
//   - candidate binding + digest loaded from the store, never accepted
//   - participation ledger       loaded from the store, and written by the operations that create it
//   - actor identity             taken from authenticated context, never from the payload
//   - reviewer identity          must equal the authenticated actor (checked in the policy layer too)
//
// `evaluateTransition` remains as the pure policy function, and is now an INTERNAL detail. Routes must
// call this service. A route that reaches for the evaluator directly is reintroducing the hole.

/** Which budget an occurrence is charged to. Customer-facing debits are only ever CUSTOMER_VALUE_WORK. */
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

/** Classes that must never produce a customer debit. Everything review-related lives here. */
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

export type CandidateRecord = {
  candidateId: string;
  digest: string;
  /** Identity of the WORK, as opposed to identity of the submission. See contentDigest. */
  contentDigest: string;
  binding: CandidateBinding;
  state: ReviewState;
  /** Set when this candidate exists to replace one that was rejected. See createSuccessor. */
  supersedes?: string;
  participants: Participant[];
  /** Append-only. One row per accepted transition. */
  occurrences: TransitionOccurrence[];
};

/**
 * A recorded test execution.
 *
 * WHY THIS TYPE EXISTS. Round 4 of the independent review found that the evaluator's own documentation
 * claimed a caller "must supply the digest of a recorded result", while no recorded result existed
 * anywhere in the system. `testResultDigest` was a syntactically valid 64-character string in the
 * binding and nothing else: an author could invent one, move BUILT -> TESTED, and the gate treated it as
 * a tested candidate. The claim was documentation of a mechanism I had not built.
 *
 * An evidence record is that mechanism. It is written by its own operation, carries who recorded it and
 * when, and the digest in it must match what the candidate is bound to before TESTED is reachable.
 */
export type EvidenceRecord = {
  evidenceId: string;
  candidateId: string;
  /** Must equal the candidate binding's testResultDigest, or it is evidence about something else. */
  resultDigest: string;
  /**
   * Where the run happened. Round 5 was right that persistence is not provenance: without a runner
   * identity and a run reference, a stored digest is an authenticated caller assertion that has been
   * written down. This does not make it cryptographic -- see the note on recordTestExecution -- but it
   * does mean the record names something outside itself that can be checked by a human or a later job.
   */
  runnerIdentity: string;
  runReference: string;
  contentDigest: string;
  recordedBy: string;
  at: string;
};

export type TransitionOccurrence = {
  occurrenceId: string;
  from: ReviewState;
  to: ReviewState;
  actorIdentity: string;
  billingClass: BillingClass;
  at: string;
};

/**
 * What a durable store must provide. The Mongo implementation is not in this candidate; the in-memory
 * reference below exists so the boundary can be exercised and its concurrency semantics asserted.
 *
 * `compareAndSetState` is the load-bearing method: it must apply only if the state is still what the
 * caller read, so two racing transitions cannot both succeed.
 */
export interface ReviewGateStore {
  load(candidateId: string): Promise<CandidateRecord | null>;
  create(record: CandidateRecord): Promise<boolean>;
  /** Append-only. Returns false if the evidence id was already used, so a replay cannot double-count. */
  recordEvidence(record: EvidenceRecord): Promise<boolean>;
  loadEvidence(candidateId: string): Promise<EvidenceRecord[]>;
  /**
   * Has THIS CONTENT ever been rejected, on any candidate record?
   *
   * Round 5's second CRITICAL: rejection was scoped to one record's occurrence history, so registering
   * the identical binding under a new candidateId produced a record with no rejection history that could
   * be approved. The rejection has to outlive the record it was issued against, which means the store
   * has to answer this question across all of them.
   */
  isContentRejected(contentDigest: string): Promise<boolean>;
  /**
   * Apply a transition if and only if the state is still what the caller read.
   *
   * ROUND 6 WIDENED THIS CONTRACT, because a compare-and-set that only guards state is not enough. The
   * rejection check, the transition and the ledger write used to be three separate calls, so two records
   * carrying identical content could both read "not rejected", then one commit GO while the other
   * committed NO_GO. Identical content ended up simultaneously rejected and ready for owner decision.
   *
   * An implementation MUST perform all of the following in one atomic step, or return false:
   *   - the state still equals expectedState, and the occurrence id is unused;
   *   - if `requireContentNotRejected` is set, that content has no rejection recorded;
   *   - if `recordRejectionOfContent` is set, that rejection is written as part of the same step.
   *
   * The in-memory implementation below is synchronous, so it satisfies this trivially. A Mongo
   * implementation needs a transaction or a single conditional update; this comment is the contract it
   * has to meet, and §H.16 remains open precisely because that implementation does not exist yet.
   */
  compareAndSetState(input: {
    candidateId: string;
    expectedState: ReviewState;
    nextState: ReviewState;
    occurrence: TransitionOccurrence;
    addParticipant?: Participant;
    requireContentNotRejected?: string;
    recordRejectionOfContent?: string;
  }): Promise<boolean>;
}

export class InMemoryReviewGateStore implements ReviewGateStore {
  private readonly records = new Map<string, CandidateRecord>();
  private readonly evidence = new Map<string, EvidenceRecord[]>();
  private readonly rejected = new Map<string, { candidateId: string; at: string }>();

  async isContentRejected(digest: string): Promise<boolean> {
    return this.rejected.has(digest);
  }

  // NOTE the absence of a standalone recordRejection. It existed until round 6 and is deliberately gone:
  // a second, non-atomic way to write the rejection ledger is a way to write it at the wrong moment.
  // Rejections are now written only by compareAndSetState, in the same step that commits the NO_GO.

  async recordEvidence(record: EvidenceRecord): Promise<boolean> {
    const all = [...this.evidence.values()].flat();
    if (all.some((e) => e.evidenceId === record.evidenceId)) return false;
    const forCandidate = this.evidence.get(record.candidateId) ?? [];
    forCandidate.push(structuredClone(record));
    this.evidence.set(record.candidateId, forCandidate);
    return true;
  }

  async loadEvidence(candidateId: string): Promise<EvidenceRecord[]> {
    return structuredClone(this.evidence.get(candidateId) ?? []);
  }

  async load(candidateId: string): Promise<CandidateRecord | null> {
    const found = this.records.get(candidateId);
    return found ? structuredClone(found) : null;
  }

  async create(record: CandidateRecord): Promise<boolean> {
    if (this.records.has(record.candidateId)) return false;
    this.records.set(record.candidateId, structuredClone(record));
    return true;
  }

  async compareAndSetState(input: {
    candidateId: string;
    expectedState: ReviewState;
    nextState: ReviewState;
    occurrence: TransitionOccurrence;
    addParticipant?: Participant;
    requireContentNotRejected?: string;
    recordRejectionOfContent?: string;
  }): Promise<boolean> {
    // Everything below runs without an await, so it is one atomic step against this store. That is the
    // contract the interface states, and the reason the rejection check moved in here.
    const found = this.records.get(input.candidateId);
    if (!found) return false;
    // The guard that makes concurrent transitions safe: if someone else moved the state since we read
    // it, we lose rather than overwrite.
    if (found.state !== input.expectedState) return false;
    // Occurrence ids are idempotency keys. A replayed callback must be a no-op, not a second transition.
    if (found.occurrences.some((o) => o.occurrenceId === input.occurrence.occurrenceId)) return false;
    // Re-checked HERE, not before the call: a rejection committed by a concurrent verdict between the
    // caller's check and this write must lose the race, not slip through it.
    if (input.requireContentNotRejected && this.rejected.has(input.requireContentNotRejected)) return false;
    found.state = input.nextState;
    found.occurrences.push(input.occurrence);
    if (input.addParticipant) found.participants.push(input.addParticipant);
    if (input.recordRejectionOfContent && !this.rejected.has(input.recordRejectionOfContent)) {
      this.rejected.set(input.recordRejectionOfContent, {
        candidateId: input.candidateId,
        at: input.occurrence.at,
      });
    }
    return true;
  }
}

/**
 * Where the application authentication system becomes the root of trust.
 *
 * The shared package cannot verify a session; it has no session store, no key, and no request context.
 * Pretending otherwise is what produced the last two findings. So the seam is explicit: the application
 * supplies an authenticator at construction, and everything the gate believes about identity comes back
 * through it.
 */
export interface SessionAuthenticator {
  /** Verify a caller-supplied proof and return the identity it establishes, or null if it establishes none. */
  authenticate(proof: unknown): { identity: string } | null;
}

const MINTED = new WeakSet<object>();

/**
 * An identity the SERVER established, not a string a request supplied.
 *
 * THE HISTORY MATTERS, because this is the third design. Round 1 took `actorIdentity: string` on every
 * operation, so a caller set both the actor and the verdict’s reviewer to the same uninvolved name and
 * string equality “authenticated” an assertion against itself. Round 2 replaced it with a private
 * constructor -- and an independent review falsified that too: `principalFromSession` was exported from
 * the package index, so any consumer could mint `codex` at will, and a plain `{ identity: "codex" }`
 * satisfied the type structurally. The private constructor stopped `new`, and nothing else.
 *
 * TWO CHANGES CLOSE IT, and neither is a comment:
 *
 *   1. NO OPERATION ACCEPTS A PRINCIPAL. The service takes an opaque `proof` and mints the principal
 *      itself through its injected authenticator, so there is no principal argument left to forge.
 *   2. A RUNTIME BRAND. Instances are recorded in a module-private WeakSet, so a structurally identical
 *      object -- from JavaScript, or from a TypeScript `as` assertion -- fails `isTrusted`.
 *
 * WHAT THIS STILL IS NOT. Whoever supplies the authenticator defines identity. That is the correct trust
 * root, but it means the gate is exactly as sound as the application’s authentication, and this package
 * cannot make that claim on its behalf. It is no longer a claim the package makes falsely.
 */
export class TrustedPrincipal {
  private constructor(readonly identity: string) {}

  /**
   * INTERNAL. Deliberately not reachable from the package index, which exports this class as a TYPE
   * ONLY -- so external code has no value binding to call a static on. Minting is the service’s job.
   */
  static mint(authenticator: SessionAuthenticator, proof: unknown): TrustedPrincipal | null {
    let established: { identity: string } | null = null;
    try {
      established = authenticator.authenticate(proof);
    } catch {
      return null; // an authenticator that throws denies; it never authenticates by accident
    }
    const identity = String(established?.identity ?? "").trim();
    if (!identity) return null;
    const principal = new TrustedPrincipal(identity);
    MINTED.add(principal);
    return principal;
  }

  /** True only for an instance this module minted. Defeats a structural look-alike. */
  static isTrusted(value: unknown): value is TrustedPrincipal {
    return value instanceof TrustedPrincipal && MINTED.has(value as object);
  }
}

/** A denied proof is a closed decision like any other, never an exception across the boundary. */
const UNAUTHENTICATED = Object.freeze({
  ok: false as const,
  code: "unauthenticated",
  message: "the supplied proof did not establish an identity",
});

/**
 * States from which a candidate can legitimately be replaced.
 *
 * A candidate still moving through review has nothing to supersede yet, and one that already reached
 * READY_FOR_OWNER_DECISION is the owner's to decide on -- quietly replacing it would take that decision
 * away. TEST_FAILED is included because a build that never passed its tests is exactly the case where a
 * successor is the right answer.
 */
const SUPERSEDABLE: readonly ReviewState[] = Object.freeze([
  "NO_GO", "REMEDIATION_REQUIRED", "REMEDIATING", "TEST_FAILED", "CANCELLED", "EXPIRED",
]);

export type ServiceResult =
  | { ok: true; state: ReviewState }
  | { ok: false; code: string; message: string };

// NOTE the absence of an identity field. Identity is not request data; it arrives as a TrustedPrincipal
// argument that a request string cannot become.
const intentSchema = z.object({
  candidateId: z.string().min(1).max(200),
  occurrenceId: z.string().min(1).max(200),
  billingClass: z.enum(billingClasses),
});

export class ReviewGateService {
  constructor(
    private readonly store: ReviewGateStore,
    private readonly authenticator: SessionAuthenticator,
    private readonly clock: () => string = () => new Date().toISOString(),
  ) {}

  /**
   * Every operation starts here. The caller hands over a proof, never an identity and never a principal:
   * there is no argument on this surface that a request body could become.
   */
  private principal(proof: unknown): TrustedPrincipal | null {
    const minted = TrustedPrincipal.mint(this.authenticator, proof);
    return minted && TrustedPrincipal.isTrusted(minted) ? minted : null;
  }

  /** Registering a candidate writes the author participation row. Nothing else may write it. */
  async createCandidate(proof: unknown, input: {
    candidateId: string;
    binding: CandidateBinding;
  }): Promise<ServiceResult> {
    const principal = this.principal(proof);
    if (!principal) return UNAUTHENTICATED;
    let binding: CandidateBinding;
    try {
      binding = candidateBindingSchema.parse(input.binding);
    } catch (error) {
      return { ok: false, code: "malformed_input", message: (error as Error).message.slice(0, 300) };
    }
    if (binding.authorIdentity !== principal.identity) {
      return {
        ok: false,
        code: "author_actor_mismatch",
        message: "the binding names a different author than the authenticated actor",
      };
    }
    const now = this.clock();
    // Round 5's attack was to re-register rejected content under a fresh candidateId. Refusing it at
    // registration is better than refusing it at approval: the author finds out now, not after a reviewer
    // has spent time on it.
    if (await this.store.isContentRejected(contentDigest(binding))) {
      return {
        ok: false,
        code: "content_already_rejected",
        message: "this exact content was rejected; register a successor that changes it",
      };
    }
    const created = await this.store.create({
      candidateId: input.candidateId,
      digest: candidateDigest(binding),
      contentDigest: contentDigest(binding),
      binding,
      state: "BUILT",
      participants: [{ identity: binding.authorIdentity, role: "author", at: now }],
      occurrences: [],
    });
    if (!created) return { ok: false, code: "candidate_exists", message: "candidate id already registered" };
    return { ok: true, state: "BUILT" };
  }

  /**
   * Record that a test run happened. Its own operation, because evidence is a fact to be written down
   * before it can be relied on -- not an adjective a transition request applies to itself.
   */
  async recordTestExecution(proof: unknown, input: z.input<typeof intentSchema> & {
    evidenceId: string;
    resultDigest: string;
    runnerIdentity: string;
    runReference: string;
  }): Promise<ServiceResult> {
    const principal = this.principal(proof);
    if (!principal) return UNAUTHENTICATED;
    let intent: z.infer<typeof intentSchema>;
    try {
      intent = intentSchema.parse(input);
      z.string().regex(/^[a-f0-9]{64}$/).parse(input.resultDigest);
      z.string().min(1).max(200).parse(input.evidenceId);
      z.string().min(1).max(200).parse(input.runnerIdentity);
      z.string().min(1).max(500).parse(input.runReference);
    } catch (error) {
      return { ok: false, code: "malformed_input", message: (error as Error).message.slice(0, 300) };
    }
    if (isCustomerBillable(intent.billingClass)) {
      return { ok: false, code: "billing_class_not_internal", message: "recording a test run is internal cost" };
    }
    const record = await this.store.load(intent.candidateId);
    if (!record) return { ok: false, code: "unknown_candidate", message: "no such candidate" };

    // SEPARATION OF DUTIES ON EVIDENCE. Round 5 showed the author could invent a testResultDigest and
    // then record evidence for that same invented value -- self-attestation with an extra step. The
    // author of a candidate may no longer be the party that records its test evidence.
    //
    // BE PRECISE ABOUT WHAT THIS BUYS. It is separation of duties, NOT provenance. A CI identity is still
    // an authenticated caller making an assertion; nothing here verifies a test ran. Real provenance
    // needs signed execution results, which needs key material I am not authorised to create. That is a
    // genuine owner-authority boundary and it is recorded as one in the handoff rather than papered over.
    if (principal.identity === record.binding.authorIdentity) {
      return {
        ok: false,
        code: "evidence_actor_is_author",
        message: "the author of a candidate cannot record its test evidence",
      };
    }
    const written = await this.store.recordEvidence({
      evidenceId: input.evidenceId,
      candidateId: intent.candidateId,
      resultDigest: input.resultDigest,
      runnerIdentity: input.runnerIdentity,
      runReference: input.runReference,
      contentDigest: record.contentDigest,
      recordedBy: principal.identity,
      at: this.clock(),
    });
    if (!written) {
      return { ok: false, code: "evidence_replayed", message: "that evidence id was already recorded" };
    }
    return { ok: true, state: record.state };
  }

  /**
   * Register a candidate that replaces a rejected one.
   *
   * Round 4 showed why this has to exist. The state table cycles REMEDIATING -> RETEST_REQUIRED ->
   * TESTED on the SAME record, which changes neither the binding nor the digest -- so a candidate could
   * be rejected, walk the loop without a line of code changing, and be approved by a second reviewer for
   * the exact content the first one rejected. Remediation that changes nothing is not remediation.
   *
   * A successor is therefore a NEW candidate with a DIFFERENT digest, linked to what it replaces.
   */
  async createSuccessor(proof: unknown, input: {
    candidateId: string;
    supersedes: string;
    binding: CandidateBinding;
  }): Promise<ServiceResult> {
    const principal = this.principal(proof);
    if (!principal) return UNAUTHENTICATED;
    const prior = await this.store.load(input.supersedes);
    if (!prior) return { ok: false, code: "unknown_candidate", message: "no such prior candidate" };
    let binding: CandidateBinding;
    try {
      binding = candidateBindingSchema.parse(input.binding);
    } catch (error) {
      return { ok: false, code: "malformed_input", message: (error as Error).message.slice(0, 300) };
    }
    // ROUND 5, C5-3. This compared candidateDigest, which covers createdAt, occurrenceId, authorityRef,
    // requestedReviewerClass and testResultDigest. So bumping a timestamp -- or simply re-running the
    // tests on untouched code -- produced a "different" candidate and laundered the rejection. The
    // comparison has to be against the WORK, which is what contentDigest is for.
    if (contentDigest(binding) === prior.contentDigest) {
      return {
        ok: false,
        code: "successor_identical",
        message: "a successor must change the work; new paperwork over identical content is not a remediation",
      };
    }
    // ...and the new content must not itself be something already rejected elsewhere.
    if (await this.store.isContentRejected(contentDigest(binding))) {
      return {
        ok: false,
        code: "content_already_rejected",
        message: "this content was rejected on another candidate; it cannot be reintroduced as a successor",
      };
    }
    if (binding.authorIdentity !== principal.identity) {
      return { ok: false, code: "author_actor_mismatch", message: "the binding names a different author" };
    }
    // ROUND 5, M5-1. Anyone authenticated could claim to supersede anybody's unrelated candidate. Three
    // things now have to hold, and none of them was checked before.
    if (binding.projectId !== prior.binding.projectId || binding.repository !== prior.binding.repository) {
      return {
        ok: false,
        code: "successor_lineage_mismatch",
        message: "a successor must belong to the same project and repository as what it replaces",
      };
    }
    if (!SUPERSEDABLE.includes(prior.state)) {
      return {
        ok: false,
        code: "prior_not_supersedable",
        message: `a candidate in ${prior.state} is not awaiting remediation; nothing to supersede`,
      };
    }
    // ROUND 6, M6-1. "Any participant" was too wide, and I had created the loophole myself: the
    // REVIEW_REQUESTED transition writes a requester row for whoever performs it, and any authenticated
    // identity could perform it. So a stranger self-enrolled as a participant, cancelled the candidate,
    // and superseded it -- entirely through legal moves. Only the party responsible for the work may
    // replace it.
    const responsible = new Set<string>([
      prior.binding.authorIdentity,
      ...prior.participants.filter((x) => x.role === "remediator").map((x) => x.identity),
    ]);
    if (!responsible.has(principal.identity)) {
      return {
        ok: false,
        code: "successor_actor_uninvolved",
        message: "only the author of the rejected candidate, or a recorded remediator, may replace it",
      };
    }
    const now = this.clock();
    const created = await this.store.create({
      candidateId: input.candidateId,
      digest: candidateDigest(binding),
      contentDigest: contentDigest(binding),
      binding,
      state: "BUILT",
      supersedes: input.supersedes,
      participants: [{ identity: binding.authorIdentity, role: "author", at: now }],
      occurrences: [],
    });
    if (!created) return { ok: false, code: "candidate_exists", message: "candidate id already registered" };
    return { ok: true, state: "BUILT" };
  }

  /**
   * Every non-verdict move. The caller says where it wants to go and who it is; it does not get to say
   * where it currently is.
   */
  /**
   * Which participation a transition necessarily creates. Derived from the move, never supplied.
   *
   * The previous version let the CALLER pass `addRole`, which an independent review found to be a
   * complete independence bypass: a reviewer could issue NO_GO, walk the candidate through
   * REMEDIATING while omitting the role, and then approve their own remediation, because the ledger
   * still showed them as reviewer only. Roles a participant earns are a property of what they did.
   */
  private static roleFor(to: ReviewState): Participant["role"] | undefined {
    if (to === "REMEDIATING") return "remediator";
    if (to === "REVIEW_REQUESTED") return "requester";
    return undefined;
  }

  async transition(proof: unknown, input: z.input<typeof intentSchema> & {
    to: ReviewState;
  }): Promise<ServiceResult> {
    const principal = this.principal(proof);
    if (!principal) return UNAUTHENTICATED;
    let intent: z.infer<typeof intentSchema>;
    try {
      intent = intentSchema.parse(input);
    } catch (error) {
      return { ok: false, code: "malformed_input", message: (error as Error).message.slice(0, 300) };
    }
    if (isCustomerBillable(intent.billingClass)) {
      // Review, testing and remediation are internal cost. A transition asking to be charged to the
      // customer is refused here rather than being caught later in a report.
      return {
        ok: false,
        code: "billing_class_not_internal",
        message: `review-gate work must not be customer-billable; got ${intent.billingClass}`,
      };
    }
    const record = await this.store.load(intent.candidateId);
    if (!record) return { ok: false, code: "unknown_candidate", message: "no such candidate" };

    // ROUND 6, M6-1 at its source. Any authenticated identity could move anybody's candidate, which is
    // how a stranger wrote themselves into the participation ledger. Participation is now a prerequisite
    // for moving a candidate rather than a side effect of having moved it.
    //
    // THE ONE EXCEPTION is a reviewer picking up a review: REVIEW_REQUESTED -> REVIEW_IN_PROGRESS is how
    // an independent party legitimately arrives at a candidate they have no prior connection to. That
    // move grants no role, and the independence check still governs the verdict that follows.
    const claimingReview = record.state === "REVIEW_REQUESTED" && input.to === "REVIEW_IN_PROGRESS";
    const known = record.participants.some((x) => x.identity === principal.identity)
      || record.binding.authorIdentity === principal.identity;
    if (!known && !claimingReview) {
      return {
        ok: false,
        code: "actor_not_participant",
        message: "only a participant in this candidate may move it, or a reviewer claiming the review",
      };
    }

    const now = this.clock();
    const decision = evaluateTransition({
      from: record.state,
      to: input.to,
      binding: record.binding,
      boundDigest: record.digest,
      participants: record.participants,
      actorIdentity: principal.identity,
      now,
    });
    if (!decision.ok) return decision;

    if (input.to === "TESTED") {
      // ROUND 4's CRITICAL. Before this check, TESTED was reachable by asserting it: the binding carried
      // a testResultDigest that nothing had ever compared to a recorded run. The digest must now belong
      // to evidence somebody wrote down, and -- for a retest after remediation -- to evidence written
      // AFTER the remediation, so a stale record cannot be re-presented as a fresh result.
      //
      // THE ORDER MATTERS AND I GOT IT WRONG FIRST. Running this before the policy evaluation made
      // "no evidence" shadow "expired" and "illegal move", so a candidate that was refused for a more
      // fundamental reason reported the evidence gap instead. A caller should be told the first thing
      // that is wrong with the request, not the last thing I happened to add.
      const evidence = await this.store.loadEvidence(intent.candidateId);
      const matching = evidence.filter((e) => e.resultDigest === record.binding.testResultDigest);
      if (matching.length === 0) {
        return {
          ok: false,
          code: "no_test_evidence",
          message: "no recorded test execution matches the digest this candidate is bound to",
        };
      }
      const lastRemediation = [...record.occurrences]
        .filter((o) => o.to === "REMEDIATING")
        .map((o) => Date.parse(o.at))
        .sort((a, b) => b - a)[0];
      // ROUND 5, MODERATE: this was `>=`, so evidence recorded in the same millisecond as the
      // REMEDIATING transition counted as being after it -- trivially reproducible under the fixed clock
      // the tests inject. "After" now means after.
      if (lastRemediation !== undefined && !matching.some((e) => Date.parse(e.at) > lastRemediation)) {
        return {
          ok: false,
          code: "stale_test_evidence",
          message: "a retest must be evidenced by a run recorded after the remediation it follows",
        };
      }
    }

    const applied = await this.store.compareAndSetState({
      candidateId: intent.candidateId,
      expectedState: record.state,
      nextState: input.to,
      // ROUND 6: GO -> READY_FOR_OWNER_DECISION went through the ordinary transition path and never
      // re-consulted the rejection ledger, so a GO that beat a concurrent NO_GO on identical content
      // could still carry it to the owner. The last step before an owner sees it re-checks.
      requireContentNotRejected: input.to === "READY_FOR_OWNER_DECISION" ? record.contentDigest : undefined,
      occurrence: {
        occurrenceId: intent.occurrenceId,
        from: record.state,
        to: input.to,
        actorIdentity: principal.identity,
        billingClass: intent.billingClass,
        at: now,
      },
      addParticipant: (() => {
        const role = ReviewGateService.roleFor(input.to);
        return role ? { identity: principal.identity, role, at: now } : undefined;
      })(),
    });
    if (!applied) {
      return {
        ok: false,
        code: "state_moved_or_replayed",
        message: "the candidate changed state since it was read, or this occurrence was already applied",
      };
    }
    return { ok: true, state: input.to };
  }

  /**
   * A terminal verdict. The reviewer identity is the AUTHENTICATED ACTOR — a verdict body naming someone
   * else is refused by the policy layer. Independence is decided against the stored ledger, which the
   * caller cannot supply, truncate, or empty.
   */
  async submitVerdict(proof: unknown, input: z.input<typeof intentSchema> & { verdict: unknown }): Promise<ServiceResult> {
    const principal = this.principal(proof);
    if (!principal) return UNAUTHENTICATED;
    let intent: z.infer<typeof intentSchema>;
    let verdict: Verdict;
    try {
      intent = intentSchema.parse(input);
      verdict = verdictSchema.parse(input.verdict);
    } catch (error) {
      return { ok: false, code: "malformed_input", message: (error as Error).message.slice(0, 300) };
    }
    if (intent.billingClass !== "INTERNAL_REVIEW") {
      return { ok: false, code: "billing_class_not_review", message: "a verdict is INTERNAL_REVIEW work" };
    }
    const record = await this.store.load(intent.candidateId);
    if (!record) return { ok: false, code: "unknown_candidate", message: "no such candidate" };

    const to: ReviewState = verdict.verdict === "GO" ? "GO" : "NO_GO";
    if (to === "GO" && await this.store.isContentRejected(record.contentDigest)) {
      // ROUND 4, the payoff step of the attack: a candidate is rejected, walks the remediation loop
      // without changing, and a DIFFERENT independent reviewer approves the identical content. The
      // binding is immutable, so a NO_GO on this record is a NO_GO on this digest, and it stays one.
      // Legitimate remediation produces a successor candidate with a different digest; see
      // createSuccessor.
      return {
        ok: false,
        code: "content_already_rejected",
        message: "this exact content was rejected; remediation must change the work, not the paperwork",
      };
    }
    const now = this.clock();
    const decision = evaluateTransition({
      from: record.state,
      to,
      binding: record.binding,
      boundDigest: record.digest,
      participants: record.participants,
      verdict,
      actorIdentity: principal.identity,
      now,
    });
    if (!decision.ok) return decision;

    const applied = await this.store.compareAndSetState({
      candidateId: intent.candidateId,
      expectedState: record.state,
      nextState: to,
      occurrence: {
        occurrenceId: intent.occurrenceId,
        from: record.state,
        to,
        actorIdentity: principal.identity,
        billingClass: intent.billingClass,
        at: now,
      },
      addParticipant: { identity: principal.identity, role: "reviewer", at: now },
      // ROUND 6, C6-1. These two fields are why the CAS contract had to widen. Approving re-checks the
      // rejection ledger INSIDE the same atomic step that commits GO, and rejecting writes the ledger
      // inside the step that commits NO_GO. Previously the check, the commit and the write were three
      // calls, so two records with identical content could both read "not rejected", then one commit GO
      // while the other committed NO_GO -- the same work simultaneously rejected and ready for the owner.
      requireContentNotRejected: to === "GO" ? record.contentDigest : undefined,
      recordRejectionOfContent: to === "NO_GO" ? record.contentDigest : undefined,
    });
    if (!applied) {
      return {
        ok: false,
        code: "state_moved_or_replayed",
        message:
          "the candidate changed state since it was read, this verdict was already applied, " +
          "or its content was rejected concurrently",
      };
    }
    return { ok: true, state: to };
  }
}
