import { z } from "zod";
import {
  candidateBindingSchema,
  candidateDigest,
  evaluateTransition,
  verdictSchema,
  type CandidateBinding,
  type Participant,
  type ReviewState,
  type Verdict,
} from "./reviewGate.js";

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
  binding: CandidateBinding;
  state: ReviewState;
  participants: Participant[];
  /** Append-only. One row per accepted transition. */
  occurrences: TransitionOccurrence[];
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
  compareAndSetState(input: {
    candidateId: string;
    expectedState: ReviewState;
    nextState: ReviewState;
    occurrence: TransitionOccurrence;
    addParticipant?: Participant;
  }): Promise<boolean>;
}

export class InMemoryReviewGateStore implements ReviewGateStore {
  private readonly records = new Map<string, CandidateRecord>();

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
  }): Promise<boolean> {
    const found = this.records.get(input.candidateId);
    if (!found) return false;
    // The guard that makes concurrent transitions safe: if someone else moved the state since we read
    // it, we lose rather than overwrite.
    if (found.state !== input.expectedState) return false;
    // Occurrence ids are idempotency keys. A replayed callback must be a no-op, not a second transition.
    if (found.occurrences.some((o) => o.occurrenceId === input.occurrence.occurrenceId)) return false;
    found.state = input.nextState;
    found.occurrences.push(input.occurrence);
    if (input.addParticipant) found.participants.push(input.addParticipant);
    return true;
  }
}

/**
 * An identity the SERVER established, not a string a request supplied.
 *
 * The independent review's point stands and is worth stating without varnish: the previous version took
 * `actorIdentity: string` on every operation, so a caller could set both the actor and the verdict's
 * reviewer to the same uninvolved name and have string equality "authenticate" an assertion against
 * itself. The hole had moved one layer out, not closed.
 *
 * The brand makes a plain string unusable as a principal, so application code cannot fabricate one by
 * accident or by type assertion alone. BE CLEAR ABOUT WHAT THIS IS NOT: it is a compile-time boundary,
 * not a cryptographic one. Anything that can call `principalFromSession` can still mint a principal.
 * Real assurance needs the API layer to be the only caller — which is why the import-boundary test
 * exists, and why wiring routes through auth middleware is a prerequisite for any production claim
 * about this gate.
 */
export class TrustedPrincipal {
  /**
   * PRIVATE constructor. Application code cannot write `new TrustedPrincipal("codex")` — the compiler
   * refuses it — so an identity cannot be conjured from a request string at the call site.
   */
  private constructor(readonly identity: string) {}

  /**
   * The only way to obtain a principal. Intended for authentication middleware holding a session it has
   * already verified — never a request body, query string, or header value.
   */
  static fromSession(session: { userId: string; authenticatedAt: string }): TrustedPrincipal {
    const identity = String(session?.userId ?? "").trim();
    if (!identity) throw new Error("cannot mint a principal from an unauthenticated session");
    if (!session?.authenticatedAt) throw new Error("a principal requires an authenticated session");
    return new TrustedPrincipal(identity);
  }
}

/** Convenience wrapper; see TrustedPrincipal.fromSession. */
export function principalFromSession(session: { userId: string; authenticatedAt: string }): TrustedPrincipal {
  return TrustedPrincipal.fromSession(session);
}

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
    private readonly clock: () => string = () => new Date().toISOString(),
  ) {}

  /** Registering a candidate writes the author participation row. Nothing else may write it. */
  async createCandidate(principal: TrustedPrincipal, input: {
    candidateId: string;
    binding: CandidateBinding;
  }): Promise<ServiceResult> {
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
    const created = await this.store.create({
      candidateId: input.candidateId,
      digest: candidateDigest(binding),
      binding,
      state: "BUILT",
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

  async transition(principal: TrustedPrincipal, input: z.input<typeof intentSchema> & {
    to: ReviewState;
  }): Promise<ServiceResult> {
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

    const applied = await this.store.compareAndSetState({
      candidateId: intent.candidateId,
      expectedState: record.state,
      nextState: input.to,
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
  async submitVerdict(principal: TrustedPrincipal, input: z.input<typeof intentSchema> & { verdict: unknown }): Promise<ServiceResult> {
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
    });
    if (!applied) {
      return {
        ok: false,
        code: "state_moved_or_replayed",
        message: "the candidate changed state since it was read, or this verdict was already applied",
      };
    }
    return { ok: true, state: to };
  }
}
