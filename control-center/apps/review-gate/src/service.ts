import { z } from "zod";
import {
  candidateBindingSchema,
  candidateDigest,
  isTransitionAllowed,
  contentDigest,
  verdictSchema,
  type CandidateBinding,
  type Participant,
  type ReviewState,
  type Verdict,
} from "./policy.js";
import { evaluateTransition } from "./policyInternal.js";

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
  /** Finding ids from the predecessor that this candidate claims to address. See createSuccessor. */
  remediates?: readonly string[];
  /**
   * Blocking findings carried over from the candidate this one replaces, still undischarged.
   *
   * Without this a successor started with a clean sheet, so the defect that caused the rejection was
   * forgotten the moment a new record existed.
   */
  inherited?: ReadonlyArray<{ id: string; severity: string; summary: string }>;
  /** Append-only. Every verdict ever recorded against this candidate, findings included. */
  verdicts: StoredVerdict[];
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

/**
 * A verdict as recorded, findings included.
 *
 * Round 7: the objective this workstream exists to serve includes findings and remediation, and the
 * system was DISCARDING the findings. A verdict was evaluated, its transition committed, and its content
 * dropped -- so "was this remediated?" could only ever be answered by comparing digests, which is what
 * rounds 5, 6 and 7 each broke in a different way. You cannot establish that a finding was addressed if
 * you did not keep the finding.
 */
export type StoredVerdict = {
  reviewerIdentity: string;
  verdict: "GO" | "NO_GO";
  findings: ReadonlyArray<{ id: string; severity: string; summary: string }>;
  /** Earlier findings this reviewer confirmed are addressed. Only a verdict can discharge a finding. */
  resolves: readonly string[];
  submittedAt: string;
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
  create(capability: StoreWriteCapability, record: CandidateRecord): Promise<boolean>;
  /** Append-only. Returns false if the evidence id was already used, so a replay cannot double-count. */
  recordEvidence(capability: StoreWriteCapability, record: EvidenceRecord): Promise<boolean>;
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
   * The candidate id currently holding this content, if any is still live.
   *
   * ROUND 7's CRITICAL, and it could not be fixed by tightening atomicity. READY_FOR_OWNER_DECISION is
   * terminal, so once identical content reached it, a later NO_GO on a twin recorded a rejection that
   * nothing could act on: the same work was simultaneously rejected and awaiting the owner. Per-operation
   * atomicity establishes ordering; it cannot make a later fact revoke an earlier terminal decision.
   *
   * So the contradiction is prevented rather than resolved: AT MOST ONE LIVE CANDIDATE MAY CARRY A GIVEN
   * CONTENT DIGEST. Two twins can no longer exist to disagree about. CANCELLED and EXPIRED release the
   * claim, because abandoning work should not permanently bar re-submitting it.
   */
  findLiveByContent(contentDigest: string): Promise<string | null>;
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
  compareAndSetState(capability: StoreWriteCapability, input: {
    candidateId: string;
    expectedState: ReviewState;
    nextState: ReviewState;
    occurrence: TransitionOccurrence;
    addParticipant?: Participant;
    requireContentNotRejected?: string;
    recordRejectionOfContent?: string;
    addVerdict?: StoredVerdict;
  }): Promise<boolean>;
}

export class InMemoryReviewGateStore implements ReviewGateStore {
  private readonly records = new Map<string, CandidateRecord>();
  private readonly evidence = new Map<string, EvidenceRecord[]>();
  private readonly rejected = new Map<string, { candidateId: string; at: string }>();

  async isContentRejected(digest: string): Promise<boolean> {
    return this.rejected.has(digest);
  }

  async findLiveByContent(digest: string): Promise<string | null> {
    for (const record of this.records.values()) {
      if (record.contentDigest === digest && !RELEASES_CONTENT.includes(record.state)) {
        return record.candidateId;
      }
    }
    return null;
  }

  // NOTE the absence of a standalone recordRejection. It existed until round 6 and is deliberately gone:
  // a second, non-atomic way to write the rejection ledger is a way to write it at the wrong moment.
  // Rejections are now written only by compareAndSetState, in the same step that commits the NO_GO.

  async recordEvidence(capability: StoreWriteCapability, record: EvidenceRecord): Promise<boolean> {
    if (capability !== WRITE) return false;
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

  async create(capability: StoreWriteCapability, record: CandidateRecord): Promise<boolean> {
    // Not "who are you" but "what do you hold". A caller that reached this object by any route still
    // cannot write without the capability, and the capability cannot be constructed outside this module.
    if (capability !== WRITE) return false;
    // DEFENCE IN DEPTH, added in round 8. Removing this class from the package index stops a consumer
    // obtaining it, but the application implements or holds a store either way, and `create` used to
    // accept a caller-built record INCLUDING ITS STATE -- so a fabricated record could be written
    // straight into READY_FOR_OWNER_DECISION with no test, no freeze, no review and no verdict.
    //
    // A candidate begins at BUILT with nothing behind it. A store that accepts anything else is being
    // asked to launder history, and refuses.
    if (record.state !== "BUILT") return false;
    if (record.occurrences.length > 0 || record.verdicts.length > 0) return false;
    if (this.records.has(record.candidateId)) return false;
    // Checked HERE rather than in the service, so the check and the write cannot interleave. Two
    // concurrent registrations of the same content must not both succeed; the loser sees false.
    for (const existing of this.records.values()) {
      if (existing.contentDigest === record.contentDigest
        && !RELEASES_CONTENT.includes(existing.state)) return false;
    }
    if (this.rejected.has(record.contentDigest)) return false;
    this.records.set(record.candidateId, structuredClone(record));
    return true;
  }

  async compareAndSetState(capability: StoreWriteCapability, input: {
    candidateId: string;
    expectedState: ReviewState;
    nextState: ReviewState;
    occurrence: TransitionOccurrence;
    addParticipant?: Participant;
    requireContentNotRejected?: string;
    recordRejectionOfContent?: string;
    addVerdict?: StoredVerdict;
  }): Promise<boolean> {
    if (capability !== WRITE) return false;
    // Everything below runs without an await, so it is one atomic step against this store. That is the
    // contract the interface states, and the reason the rejection check moved in here.
    const found = this.records.get(input.candidateId);
    if (!found) return false;
    // ROUND 8: this method used to assign any nextState it was handed, so anyone holding the store could
    // walk BUILT straight to READY_FOR_OWNER_DECISION. The service checks the transition table before
    // calling; the store now checks it again, because a guard that only exists in the caller is a
    // convention. This does NOT make the store safe to drive directly -- it enforces no evidence, no
    // independence and no reviewer class -- it only removes the cheapest way to forge a decision.
    if (!isTransitionAllowed(input.expectedState, input.nextState)) return false;
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
    if (input.addVerdict) found.verdicts.push(structuredClone(input.addVerdict));
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
  /**
   * Verify a caller-supplied proof and return the identity it establishes, or null if it establishes
   * none. `reviewerClasses` are the review authorities the application grants that identity.
   *
   * ROUND 7: `requestedReviewerClass` sat in the binding, was parsed, and was then never consulted --
   * so a candidate could ask for an "independent" reviewer and be approved by anyone at all who happened
   * to have no conflicting participation. A field that records a requirement and never enforces it is
   * worse than no field, because it reads like a control.
   */
  authenticate(proof: unknown): { identity: string; reviewerClasses?: readonly string[] } | null;
}

const MINTED = new WeakSet<object>();

/**
 * The right to perform an authoritative write.
 *
 * ROUND 9 CHANGED THE APPROACH RATHER THAN PATCHING IT AGAIN. The reviewer's judgement was that the
 * defect rate was not converging because the design kept treating TypeScript visibility, export
 * selection and interfaces as security boundaries when they are packaging mechanisms. Three rounds
 * running, the fix for "the primitive is reachable" was to stop exporting the primitive -- and each time
 * it stayed reachable by another route. Round 8 removed the store from the package index; round 9 pointed
 * out that `private readonly store` emits an ordinary property, so `(service as any).store` handed it
 * straight back.
 *
 * So the store's mutators no longer trust their caller's identity at all. They require an instance of
 * this class, which has a private constructor and is never exported as a value. The module holds the only
 * one. Reaching the store object is now insufficient: you also need something you cannot construct.
 *
 * WHAT THIS IS NOT. An application implementing ReviewGateStore against its own database can obviously
 * write to that database directly -- it owns it. This boundary governs code holding THIS package's
 * objects, and the durable store must enforce its own invariants regardless. That is stated in the store
 * contract and remains open as H.16.
 */
const CAPABILITY_KEY: unique symbol = Symbol("review-gate.store-write");

export class StoreWriteCapability {
  constructor(key: symbol) {
    // NOT `private constructor`. I wrote it that way first and MY OWN TEST CAUGHT IT: TypeScript
    // privacy is erased, so `new StoreWriteCapability()` succeeded at runtime and the capability was
    // free to anyone. That is the identical mistake this class exists to stop -- compile-time visibility
    // standing in for a runtime boundary -- reproduced inside the fix for it, which is the fourth time
    // in this workstream. The key is a module-private symbol, so the throw below is real.
    if (key !== CAPABILITY_KEY) {
      throw new Error("StoreWriteCapability cannot be constructed; it is held only by ReviewGateService");
    }
  }
}

// The only instance, and it is not exported. A consumer can name the type, and can neither build one nor
// reach this binding.
const WRITE = new StoreWriteCapability(CAPABILITY_KEY);

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
  private constructor(
    readonly identity: string,
    readonly reviewerClasses: readonly string[] = [],
  ) {}

  /**
   * INTERNAL. Deliberately not reachable from the package index, which exports this class as a TYPE
   * ONLY -- so external code has no value binding to call a static on. Minting is the service’s job.
   */
  static mint(authenticator: SessionAuthenticator, proof: unknown): TrustedPrincipal | null {
    let established: { identity: string; reviewerClasses?: readonly string[] } | null = null;
    try {
      established = authenticator.authenticate(proof);
    } catch {
      return null; // an authenticator that throws denies; it never authenticates by accident
    }
    const identity = String(established?.identity ?? "").trim();
    if (!identity) return null;
    const classes = Array.isArray(established?.reviewerClasses)
      ? established!.reviewerClasses!.map((c) => String(c).trim()).filter(Boolean)
      : [];
    const principal = new TrustedPrincipal(identity, Object.freeze(classes));
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
/**
 * States in which a candidate no longer holds its content claim.
 *
 * NOT the same list as terminalStates: READY_FOR_OWNER_DECISION is terminal but very much still holds
 * its content -- that is the whole point of round 7's finding. NO_GO releases the record but the
 * rejection ledger takes over, so the content stays barred by a different mechanism.
 */
const RELEASES_CONTENT: readonly ReviewState[] = Object.freeze(["CANCELLED", "EXPIRED"]);

/** Severities a successor cannot simply decline to address. */
const BLOCKING_SEVERITIES: readonly string[] = Object.freeze(["CRITICAL", "MAJOR"]);

/**
 * Every blocking finding this candidate still owes an answer for.
 *
 * ROUND 8 REPLACED THE PREVIOUS VERSION, WHICH LOOKED ONLY AT THE LATEST REJECTION. I had reasoned that
 * an earlier finding was "either fixed, or raised again". Codex showed that nothing enforced either
 * branch, and the laundering path was trivial: take a rejected candidate round the remediation loop,
 * collect a SECOND NO_GO carrying only a MINOR finding, and the latest rejection now has no blocking
 * findings at all. The CRITICAL from the first rejection simply evaporated. My comment asserted an
 * invariant the code did not have -- the same mistake, in the same shape, for the eighth time.
 *
 * Findings now ACCUMULATE and are only removed by a reviewer discharging them:
 *   - every CRITICAL and MAJOR from every NO_GO on this record, plus
 *   - whatever this candidate inherited from the one it replaces,
 *   - minus the ids a reviewer has explicitly `resolves`-ed in any verdict here.
 *
 * An author's `remediates` claim is deliberately NOT subtracted. Claiming is not discharging.
 */
function outstandingFindings(record: CandidateRecord):
  ReadonlyArray<{ id: string; severity: string; summary: string }> {
  const raised = new Map<string, { id: string; severity: string; summary: string }>();
  for (const finding of record.inherited ?? []) raised.set(finding.id, finding);
  // ROUND 9 MADE THIS PASS CAUSAL. The previous version accumulated every finding and then, in a SECOND
  // pass, deleted every id ever mentioned in any verdict's `resolves`. Order did not matter, so a
  // resolution could precede the finding it discharged: submit `resolves: ["FUTURE"]` before FUTURE
  // exists, and when a later NO_GO raises it as a CRITICAL the stale tombstone erases it on arrival. A
  // single verdict could even raise and resolve the same finding in one breath. `resolves` was a
  // timeless tombstone, and I had described it as a discharge.
  //
  // Verdicts are replayed IN ORDER, and a discharge only applies to what is outstanding when it happens.
  for (const verdict of record.verdicts) {
    if (verdict.verdict === "NO_GO") {
      for (const finding of verdict.findings) {
        if (BLOCKING_SEVERITIES.includes(finding.severity)) raised.set(finding.id, finding);
      }
    }
    // Applied AFTER this verdict's own findings are recorded, which is why submitVerdict separately
    // refuses a verdict that resolves what it raises: without that, this ordering would permit it.
    for (const id of verdict.resolves ?? []) raised.delete(id);
  }
  return [...raised.values()];
}

/** What is outstanding BEFORE a given verdict is applied. Used to validate that verdict's discharges. */
function outstandingBefore(record: CandidateRecord): ReadonlySet<string> {
  return new Set(outstandingFindings(record).map((f) => f.id));
}

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
  // ECMAScript private fields, not TypeScript `private`. Round 9: `private readonly store` compiles to an
  // ordinary property, so `(service as any).store` returned the live store and the whole gate could be
  // driven around. `#` is enforced by the runtime -- there is no cast that reaches it.
  readonly #store: ReviewGateStore;
  readonly #authenticator: SessionAuthenticator;
  readonly #clock: () => string;

  constructor(
    store: ReviewGateStore,
    authenticator: SessionAuthenticator,
    clock: () => string = () => new Date().toISOString(),
  ) {
    this.#store = store;
    this.#authenticator = authenticator;
    this.#clock = clock;
  }

  /**
   * Every operation starts here. The caller hands over a proof, never an identity and never a principal:
   * there is no argument on this surface that a request body could become.
   */
  private principal(proof: unknown): TrustedPrincipal | null {
    const minted = TrustedPrincipal.mint(this.#authenticator, proof);
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
    const now = this.#clock();
    // Round 5's attack was to re-register rejected content under a fresh candidateId. Refusing it at
    // registration is better than refusing it at approval: the author finds out now, not after a reviewer
    // has spent time on it.
    if (await this.#store.isContentRejected(contentDigest(binding))) {
      return {
        ok: false,
        code: "content_already_rejected",
        message: "this exact content was rejected; register a successor that changes it",
      };
    }
    const created = await this.#store.create(WRITE, {
      candidateId: input.candidateId,
      digest: candidateDigest(binding),
      contentDigest: contentDigest(binding),
      binding,
      state: "BUILT",
      participants: [{ identity: binding.authorIdentity, role: "author", at: now }],
      occurrences: [],
      verdicts: [],
    });
    if (!created) {
      // The store refuses for three reasons and they are worth distinguishing for the caller, so ask it
      // which one applies. The refusal itself already happened atomically; this is only diagnosis.
      const live = await this.#store.findLiveByContent(contentDigest(binding));
      if (live) {
        return {
          ok: false,
          code: "content_already_live",
          message: `candidate ${live} already carries this exact work; at most one may be live at a time`,
        };
      }
      return { ok: false, code: "candidate_exists", message: "candidate id already registered" };
    }
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
    const record = await this.#store.load(intent.candidateId);
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
    const written = await this.#store.recordEvidence(WRITE, {
      evidenceId: input.evidenceId,
      candidateId: intent.candidateId,
      resultDigest: input.resultDigest,
      runnerIdentity: input.runnerIdentity,
      runReference: input.runReference,
      contentDigest: record.contentDigest,
      recordedBy: principal.identity,
      at: this.#clock(),
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
    /** Finding ids from the predecessor's rejection that this candidate addresses. */
    remediates?: readonly string[];
  }): Promise<ServiceResult> {
    const principal = this.principal(proof);
    if (!principal) return UNAUTHENTICATED;
    const prior = await this.#store.load(input.supersedes);
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
    if (await this.#store.isContentRejected(contentDigest(binding))) {
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
    // ROUND 7's MAJOR, which Codex said should block further certification work and I agree did.
    // "Remediated" was `contentDigest(new) !== contentDigest(prior)`: ANY genuine code change let a
    // successor through, whether or not it touched the defect that was found. Rounds 5, 6 and 7 each
    // broke a different version of that same shortcut. The findings are now kept, and a successor has to
    // say which of them it addresses.
    const blocking = [...outstandingFindings(prior)];
    const claimed = new Set(input.remediates ?? []);
    const unaddressed = blocking.filter((f) => !claimed.has(f.id));
    if (unaddressed.length > 0) {
      return {
        ok: false,
        code: "findings_unaddressed",
        message:
          "a successor must address every CRITICAL and MAJOR finding of the rejection it replaces; " +
          `outstanding: ${unaddressed.map((f) => f.id).join(", ")}`,
      };
    }
    const invented = [...claimed].filter((id) => !blocking.some((f) => f.id === id));
    if (invented.length > 0) {
      return {
        ok: false,
        code: "findings_unknown",
        message: `no such finding on the predecessor: ${invented.join(", ")}`,
      };
    }
    const now = this.#clock();
    const created = await this.#store.create(WRITE, {
      candidateId: input.candidateId,
      digest: candidateDigest(binding),
      contentDigest: contentDigest(binding),
      binding,
      state: "BUILT",
      supersedes: input.supersedes,
      remediates: [...claimed],
      // Carried forward, not discharged. The author has said which of these they addressed; a reviewer
      // still has to agree before any of them stops blocking.
      inherited: blocking,
      participants: [{ identity: binding.authorIdentity, role: "author", at: now }],
      occurrences: [],
      verdicts: [],
    });
    if (!created) {
      const live = await this.#store.findLiveByContent(contentDigest(binding));
      if (live) {
        return {
          ok: false,
          code: "content_already_live",
          message: `candidate ${live} already carries this exact work; at most one may be live at a time`,
        };
      }
      return { ok: false, code: "candidate_exists", message: "candidate id already registered" };
    }
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
    const record = await this.#store.load(intent.candidateId);
    if (!record) return { ok: false, code: "unknown_candidate", message: "no such candidate" };

    // ROUND 6, M6-1 at its source. Any authenticated identity could move anybody's candidate, which is
    // how a stranger wrote themselves into the participation ledger. Participation is now a prerequisite
    // for moving a candidate rather than a side effect of having moved it.
    //
    // THE ONE EXCEPTION is a reviewer picking up a review: REVIEW_REQUESTED -> REVIEW_IN_PROGRESS is how
    // an independent party legitimately arrives at a candidate they have no prior connection to. That
    // move grants no role, and the independence check still governs the verdict that follows.
    const claimingReview = record.state === "REVIEW_REQUESTED" && input.to === "REVIEW_IN_PROGRESS";
    if (claimingReview && !principal.reviewerClasses.includes(record.binding.requestedReviewerClass)) {
      // ROUND 7: the stranger entry point was open to ANY authenticated identity, so it could be used to
      // seize a review the candidate never asked that party to perform. It is now open only to identities
      // the application says hold the class the candidate requested.
      return {
        ok: false,
        code: "reviewer_class_not_held",
        message: `this candidate requested a ${record.binding.requestedReviewerClass} reviewer`,
      };
    }
    const known = record.participants.some((x) => x.identity === principal.identity)
      || record.binding.authorIdentity === principal.identity;
    if (!known && !claimingReview) {
      return {
        ok: false,
        code: "actor_not_participant",
        message: "only a participant in this candidate may move it, or a reviewer claiming the review",
      };
    }

    const now = this.#clock();
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
      const evidence = await this.#store.loadEvidence(intent.candidateId);
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

    const applied = await this.#store.compareAndSetState(WRITE, {
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
    const record = await this.#store.load(intent.candidateId);
    if (!record) return { ok: false, code: "unknown_candidate", message: "no such candidate" };

    // ROUND 7: requestedReviewerClass was parsed into the binding and then never consulted, so a
    // candidate could ask for an independent reviewer and be approved by whoever turned up without a
    // conflicting participation record. A field that states a requirement and never enforces it reads
    // like a control and is not one.
    if (!principal.reviewerClasses.includes(record.binding.requestedReviewerClass)) {
      return {
        ok: false,
        code: "reviewer_class_not_held",
        message:
          `this candidate requested a ${record.binding.requestedReviewerClass} reviewer; ` +
          "the authenticated actor does not hold that class",
      };
    }

    // ROUND 9, C9-2. A discharge has to reference a finding that is actually outstanding at the moment it
    // is made. Two refusals, and the second is the shorter attack: a NO_GO carrying CRITICAL F1 together
    // with resolves: ["F1"] used to erase its own finding immediately.
    const outstandingNow = outstandingBefore(record);
    const raisedHere = new Set(verdict.findings.map((f) => f.id));
    const selfDischarged = verdict.resolves.filter((id) => raisedHere.has(id));
    if (selfDischarged.length > 0) {
      return {
        ok: false,
        code: "verdict_resolves_own_finding",
        message: `a verdict cannot raise and discharge the same finding: ${selfDischarged.join(", ")}`,
      };
    }
    const notOutstanding = verdict.resolves.filter((id) => !outstandingNow.has(id));
    if (notOutstanding.length > 0) {
      return {
        ok: false,
        code: "resolves_unknown_finding",
        message:
          "a discharge must name a finding that is currently outstanding on this candidate; " +
          `not outstanding: ${notOutstanding.join(", ")}`,
      };
    }

    const to: ReviewState = verdict.verdict === "GO" ? "GO" : "NO_GO";
    if (to === "GO" && await this.#store.isContentRejected(record.contentDigest)) {
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

    // ORDER MATTERS AND IT IS DELIBERATE. The content-rejection check runs first because it is the more
    // fundamental refusal: this work was rejected, full stop. Undischarged findings are the narrower
    // reason, and a caller should be told the fundamental one when both apply.
    if (to === "GO") {
      // ROUND 8. A successor inherits the blocking findings of what it replaces, and only a reviewer can
      // retire them. Approving therefore means accounting for every one: either this verdict resolves it,
      // or an earlier verdict on this record did. Silence is not agreement.
      const owed = outstandingFindings(record).filter((f) => !verdict.resolves.includes(f.id));
      if (owed.length > 0) {
        return {
          ok: false,
          code: "findings_outstanding",
          message:
            "cannot approve while findings remain undischarged; resolve them explicitly in the verdict: " +
            owed.map((f) => f.id).join(", "),
        };
      }
    }
    const now = this.#clock();
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

    const applied = await this.#store.compareAndSetState(WRITE, {
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
      // Kept, not discarded. A rejection whose findings are thrown away cannot be shown to have been
      // remediated by anything, which is what forced three rounds of digest-comparison workarounds.
      addVerdict: {
        reviewerIdentity: principal.identity,
        verdict: verdict.verdict,
        findings: verdict.findings,
        resolves: verdict.resolves,
        submittedAt: verdict.submittedAt,
        at: now,
      },
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
