import crypto from "node:crypto";
import { z } from "zod";
import {
  agentUpgradeManifestSchema,
  configurationChangeDigest,
  configurationDeploymentPayloadSchema,
  privilegedActionDigest,
  reviewAuthorizationSchema,
} from "@control-center/shared";
import {
  isLegacyIdentity,
  KINDS_REQUIRING_ROLLBACK_TARGET,
  KIND_REQUIRED_ACTION,
  KIND_SUBJECT,
  attestationKinds,
  evaluateReconciliation,
  reconciliationSchema,
  type AttestationKind,
  type AttestationRecord,
} from "./attestation.js";
import { AuthenticatedPrincipal, generateCredential, hashCredential } from "./auth.js";
import type { CandidateSubject } from "./policy.js";
import type { ReviewGateStore } from "./store.js";

// Layer 3: the attestation side of the gate.
//
// WHAT THIS IS NOT. It is not the owner's authorization. `docs/agent-key-redesign.md` §8 defines two
// layers that already hold — a transport envelope signature, and an OFFLINE OWNER Ed25519 signature whose
// private key never touches OpsWorkbench. Neither is replaced. `owner-decision` here records that the
// owner accepted the REVIEW OUTCOME; execution authority remains the offline signature.

export type AttestationResult =
  | { ok: true; value?: unknown }
  | { ok: false; code: string; message: string };

const no = (code: string, message: string): AttestationResult => ({ ok: false, code, message });

/**
 * The cumulative execution bound. `absoluteDeadline = min(acquiredAt + this, attestation.expiresAt)`.
 *
 * "Repeat until attestation expiry" is available only as an explicit choice, never the default: an
 * attempt that can extend indefinitely is a lease with extra steps.
 */
/**
 * TWO WINDOWS, AND THEY MUST DIFFER. An independent review found they did not.
 *
 * `MAX_EXECUTION_MS` is the ABSOLUTE cumulative cap on one attempt. `INITIAL_EXECUTION_MS` is the
 * window acquire grants up front. Both were the same constant, and both were applied to the same
 * `now`, so the deadline acquire issued was already the absolute bound -- and extension, which must
 * request something strictly later than the current deadline and no later than the absolute one, had
 * no value it could legally ask for. Every extension against the real service was refused as
 * `deadline_not_extended` or `beyond_absolute_deadline`, whatever the executor did.
 *
 * The route, the store method, the client and the keeper were all correct and all unreachable. The
 * unit test that passed did so against a permissive stub; nothing exercised acquire and extend
 * together through the real service, which is the only place the two constants meet.
 */
const MAX_EXECUTION_MS = 30 * 60_000;
const INITIAL_EXECUTION_MS = 10 * 60_000;

/**
 * The initial window is a DEPLOYMENT TUNABLE, and the collapse above is the reason it is validated here
 * rather than merely documented.
 *
 * Deployments differ in how long a privileged effect legitimately takes, and the right first window for
 * a fleet whose deployments settle in seconds is not the right one for a fleet whose deployments take
 * twenty minutes. What must NOT differ is the relationship between the two windows: if the initial
 * window reaches the absolute cap, there is no value extension can legally request and the extension
 * path is dead — silently, and only observably as `deadline_not_extended` at the far end of a real
 * execution. That is exactly the defect an independent review found when both constants were equal.
 *
 * So the constructor refuses the collapse instead of trusting the operator not to configure it. The
 * absolute cap stays a constant: it is the bound the whole design rests on, and making it adjustable
 * would let a deployment grant an attempt more cumulative time than the model was reviewed for.
 */
function checkedInitialExecutionMs(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("initialExecutionMs must be a positive number of milliseconds");
  }
  if (value >= MAX_EXECUTION_MS) {
    throw new Error(
      `initialExecutionMs (${value}) must be strictly less than the absolute execution cap ` +
      `(${MAX_EXECUTION_MS}); an initial window that reaches the cap leaves extension nothing to ask for`,
    );
  }
  return value;
}

/**
 * v1 records cannot execute, and are never migrated.
 *
 * Refused by reserve, bind, acquire, execution extension and redeem. Deliberately NOT refused by revoke,
 * the expiry sweep, read/audit or reconciliation: a record that cannot execute is still provenance, and
 * an operator must be able to revoke and reconcile it. Where a replacement is wanted the owner mints a
 * fresh v2 attestation carrying `supersedesAttestationId`, because rewriting an identity in place would
 * mean it was never immutable.
 */
const refuseLegacy = (record: Pick<AttestationRecord, "identitySchemaVersion">): AttestationResult | null =>
  isLegacyIdentity(record)
    ? no("legacy_identity_not_executable",
        "this attestation predates split authority and cannot be reserved, bound, acquired, extended or redeemed; mint a v2 replacement")
    : null;
const yes = (value?: unknown): AttestationResult => ({ ok: true, value });

/** Refuse anything that is not a principal this process issued. See service.ts for why. */
function notIssued(principal: AuthenticatedPrincipal): AttestationResult | null {
  return AuthenticatedPrincipal.isIssued(principal)
    ? null
    : no("principal_not_issued", "this principal was not issued by authenticate()");
}

const LEASE_MAX_SECONDS = 15 * 60;

/**
 * The action payload the gate validates and digests.
 *
 * `reviewAuthorization` carries the ids, and it is INSIDE the payload deliberately: that puts it under
 * the envelope digest and the owner's signature with no separate hashing rule. It is not circular,
 * because binding happens after both ids exist — an earlier design computed the digest at MINT time,
 * which required the payload to contain ids that did not exist yet.
 */
// The schema lives in @control-center/shared beside the payload it belongs to, so the gate, the owner
// signer, the API and the executor all hash the same structure. Re-declaring it here would be four
// copies of one contract.
export { reviewAuthorizationSchema };

export class AttestationService {
  readonly #store: ReviewGateStore;
  readonly #clock: () => string;
  readonly #ids: () => string;
  readonly #initialExecutionMs: number;

  constructor(store: ReviewGateStore, options: {
    clock?: () => string;
    ids?: () => string;
    /** The window acquire grants up front. See `checkedInitialExecutionMs`. */
    initialExecutionMs?: number;
  } = {}) {
    this.#store = store;
    this.#clock = options.clock ?? (() => new Date().toISOString());
    this.#ids = options.ids ?? (() => crypto.randomUUID());
    this.#initialExecutionMs = checkedInitialExecutionMs(options.initialExecutionMs ?? INITIAL_EXECUTION_MS);
  }

  /** What acquire will grant, before clamping to the attestation's own validity. Read-only. */
  get initialExecutionMs(): number {
    return this.#initialExecutionMs;
  }

  #idem(principal: AuthenticatedPrincipal, scope: string, key: string, request: unknown) {
    return {
      principalId: principal.principalId,
      scope,
      key,
      requestHash: crypto.createHash("sha256").update(JSON.stringify(request) ?? "").digest("hex"),
    };
  }

  // ── owner decision: mint UNBOUND attestations ───────────────────────────────────────────────────

  async recordOwnerDecision(principal: AuthenticatedPrincipal, input: {
    candidateId: string;
    idempotencyKey: string;
    attestations: ReadonlyArray<{
      kind: AttestationKind;
      orgId: string;
      serverId: string;
      audiencePrincipalId: string;
      bindingPrincipalId: string;
      supersedesAttestationId?: string;
      expiresAt: string;
    }>;
  }): Promise<AttestationResult> {
    const unissued = notIssued(principal);
    if (unissued) return unissued;
    if (!principal.hasRole("owner")) {
      return no("role_required", "only the owner may accept a review outcome");
    }
    const record = await this.#store.loadCandidate(input.candidateId);
    if (!record) return no("unknown_candidate", "no such candidate");
    if (record.state !== "GO") {
      return no("illegal_transition", `an owner decision is not legal from ${record.state}`);
    }
    const checked = await this.#checkKinds(record, input.attestations, principal.principalId);
    if (!checked.ok) return checked;
    const minted = (checked.value as { minted: AttestationRecord[] }).minted;
    const now = this.#clock();

    const result = await this.#store.recordOwnerDecision({
      acting: { principalId: principal.principalId, credentialEpoch: principal.credentialEpoch },
      candidateId: input.candidateId,
      expectedState: "GO",
      occurrence: {
        occurrenceId: this.#ids(),
        from: "GO",
        to: "READY_FOR_OWNER_DECISION",
        actorIdentity: principal.principalId,
        billingClass: "INTERNAL_RELEASE_VERIFICATION",
        at: now,
      },
      contentDigest: record.contentDigest,
      attestations: minted,
      at: now,
      idempotency: this.#idem(principal, "owner-decision", input.idempotencyKey, input),
    });
    if (!result.applied) return no(result.code, result.code);
    return yes({ attestationIds: result.value.attestationIds });
  }

  /**
   * The kind, subject and rollback-target rules, shared by owner-decision and further minting.
   *
   * One implementation rather than two, because an independent review of the previous design found the
   * same rule expressed differently in two places and only one of them enforced.
   */
  async #checkKinds(
    record: { contentDigest: string; candidateId: string; binding: { subject: unknown;
      targetEnvironmentClass: string } },
    requests: ReadonlyArray<{ kind: AttestationKind; orgId: string; serverId: string;
      audiencePrincipalId: string; bindingPrincipalId: string; supersedesAttestationId?: string;
      expiresAt: string }>,
    grantedBy: string,
  ): Promise<AttestationResult> {
    const subject = record.binding.subject as CandidateSubject;
    const now = this.#clock();
    const minted: AttestationRecord[] = [];
    for (const request of requests) {
      if (!(attestationKinds as readonly string[]).includes(request.kind)) {
        return no("unknown_kind", `${request.kind} is not a protected action this gate attests`);
      }
      // A code candidate cannot authorize a configuration change: the discriminant is part of identity.
      if (KIND_SUBJECT[request.kind] !== subject.kind) {
        return no("subject_kind_mismatch",
          `${request.kind} may only be minted from a ${KIND_SUBJECT[request.kind]} candidate; ` +
          `this one is ${subject.kind}`);
      }
      if (KINDS_REQUIRING_ROLLBACK_TARGET.includes(request.kind)
        && !(subject.kind === "configuration.change" && subject.rollbackTarget)) {
        return no("rollback_target_required",
          "a rollback attestation requires the candidate to name the target it restores");
      }
      // The rollback target must itself have been reviewed and released. It is part of contentDigest, so
      // it was fixed at review time and cannot be swapped now.
      if (subject.kind === "configuration.change" && subject.rollbackTarget) {
        const targetClaim = await this.#store.loadClaim(subject.rollbackTarget.contentDigest);
        if (targetClaim?.disposition !== "RELEASED"
          || targetClaim.releasedByCandidateId !== subject.rollbackTarget.candidateId) {
          return no("rollback_target_not_released",
            "you may not roll back to content that was never reviewed and released");
        }
      }
      // SPLIT AUTHORITY, REQUIRED AND EXPLICIT. Not defaulted to the audience: that default is the
      // unexecutable protocol this design exists to remove, where the executor must bind a payload the
      // control plane has not sent it yet.
      if (!request.bindingPrincipalId) {
        return no("binding_principal_required",
          "a v2 attestation must name the principal that may reserve and bind");
      }
      if (request.bindingPrincipalId === request.audiencePrincipalId) {
        return no("binding_principal_not_distinct",
          "the binder and the audience must be different principals; binding and executing are separate authorities");
      }

      // Lineage, validated against the referenced record rather than trusted. A replacement that could
      // point anywhere is not a lineage.
      if (request.supersedesAttestationId !== undefined) {
        const superseded = await this.#store.loadAttestation(request.supersedesAttestationId);
        if (!superseded) {
          return no("superseded_attestation_unknown",
            "supersedesAttestationId does not reference an existing attestation");
        }
        if (superseded.candidateId !== record.candidateId
          || superseded.contentDigest !== record.contentDigest
          || superseded.orgId !== request.orgId
          || superseded.serverId !== request.serverId) {
          return no("superseded_attestation_mismatch",
            "a replacement must supersede an attestation for the same candidate, content, org and server");
        }
      }

      minted.push({
        attestationId: this.#ids(),
        // Every mint path writes v2. Absence is what marks a legacy record, so this is never omitted.
        identitySchemaVersion: "v2",
        kind: request.kind,
        contentDigest: record.contentDigest,
        candidateId: record.candidateId,
        orgId: request.orgId,
        serverId: request.serverId,
        targetEnvironmentClass: record.binding.targetEnvironmentClass,
        audiencePrincipalId: request.audiencePrincipalId,
        bindingPrincipalId: request.bindingPrincipalId,
        ...(request.supersedesAttestationId !== undefined
          ? { supersedesAttestationId: request.supersedesAttestationId } : {}),
        nonce: this.#ids(),
        grantedByPrincipalId: grantedBy,
        grantedAt: now,
        expiresAt: request.expiresAt,
        state: "PENDING",
        // NO actionDigest. Minting is unbound; binding supplies it.
      });
    }
    return yes({ minted });
  }

  // ── reserve ─────────────────────────────────────────────────────────────────────────────────────

  async reserve(principal: AuthenticatedPrincipal, input: {
    attestationId: string;
    leaseSeconds: number;
  }): Promise<AttestationResult> {
    const unissued = notIssued(principal);
    if (unissued) return unissued;
    const record = await this.#store.loadAttestation(input.attestationId);
    if (!record) return no("unknown_attestation", "no such attestation");
    const legacy = refuseLegacy(record);
    if (legacy) return legacy;
    // THE BINDER RESERVES, NOT THE AUDIENCE. Before the split this compared the audience, which made
    // §2.6 unexecutable: the executor would have had to reserve and bind a payload the control plane had
    // not yet dispatched to it. The audience is refused here explicitly rather than by omission.
    if (record.bindingPrincipalId !== principal.principalId) {
      return no("wrong_binder", "this attestation names a different binding principal");
    }
    if (!principal.mayActOn(record.orgId, record.serverId)) {
      return no("target_not_provisioned", "this executor is not provisioned for that target");
    }
    const seconds = Math.min(Math.max(1, Math.floor(input.leaseSeconds)), LEASE_MAX_SECONDS);
    const now = this.#clock();
    const lease = {
      leaseId: this.#ids(),
      holderPrincipalId: principal.principalId,
      // The epoch AT RESERVE, stamped into the lease. The store additionally re-reads the CURRENT
      // principal on every later step, so a rotation after this point invalidates the lease rather than
      // silently permitting work authorized to a credential that no longer exists.
      credentialEpoch: principal.credentialEpoch,
      expiresAt: new Date(Date.parse(now) + seconds * 1000).toISOString(),
    };
    const result = await this.#store.reserveAttestation({
      acting: { principalId: principal.principalId, credentialEpoch: principal.credentialEpoch },
      attestationId: input.attestationId,
      lease,
      now,
      requireClaim: {
        contentDigest: record.contentDigest,
        releasedByCandidateId: record.candidateId,
      },
    });
    if (!result.applied) return no(result.code, result.code);
    // The CLAMPED expiry, read back from the store. Returning the requested one gave the caller a false
    // validity window: the store bounds a lease to the attestation, so what was asked for is not what
    // was granted.
    const stored = await this.#store.loadAttestation(input.attestationId);
    return yes({ leaseId: lease.leaseId, expiresAt: stored?.lease?.expiresAt ?? lease.expiresAt });
  }

  // ── bind: validate the payload, compute the digest ──────────────────────────────────────────────

  /**
   * THE GATE COMPUTES `actionDigest`; IT NEVER ACCEPTS ONE.
   *
   * And it validates the payload against the reviewed candidate's subject, because otherwise an
   * attestation could truthfully identify reviewed content A while authorizing a payload that deploys
   * something else. Adjacency is not a relationship.
   */
  async bind(principal: AuthenticatedPrincipal, input: {
    attestationId: string;
    leaseId: string;
    payload: unknown;
  }): Promise<AttestationResult> {
    const unissued = notIssued(principal);
    if (unissued) return unissued;
    const record = await this.#store.loadAttestation(input.attestationId);
    if (!record) return no("unknown_attestation", "no such attestation");
    const legacyBind = refuseLegacy(record);
    if (legacyBind) return legacyBind;
    // Only the lease holder binds, and only the binder can hold a lease, so this restricts binding to the
    // binder without needing a second comparison that could disagree with reserve's.
    if (record.lease?.holderPrincipalId !== principal.principalId) {
      return no("not_lease_holder", "only the lease holder may bind a payload");
    }
    const candidate = await this.#store.loadCandidate(record.candidateId);
    if (!candidate) return no("unknown_candidate", "the attestation's candidate is gone");

    const validation = validatePayload(
      record.kind, candidate.binding.subject as CandidateSubject, input.payload);
    if (!validation.ok) return validation;

    // The ids must be in the payload the owner will sign, so layer 1 covers them and they cannot be
    // swapped in transit.
    const authorization = reviewAuthorizationSchema.safeParse(
      (input.payload as { reviewAuthorization?: unknown }).reviewAuthorization);
    if (!authorization.success) {
      return no("review_authorization_missing",
        "the payload must carry reviewAuthorization { attestationId, leaseId }");
    }
    if (authorization.data.attestationId !== input.attestationId
      || authorization.data.leaseId !== input.leaseId) {
      return no("review_authorization_mismatch",
        "the payload names a different attestation or lease than this request");
    }

    // The same function layer 2 uses, which already excludes the signature field so the digest cannot
    // recurse. Computed here, never supplied.
    const actionDigest = privilegedActionDigest(input.payload);
    const result = await this.#store.bindAttestation({
      acting: { principalId: principal.principalId, credentialEpoch: principal.credentialEpoch },
      attestationId: input.attestationId,
      leaseId: input.leaseId,
      actionDigest,
      now: this.#clock(),
    });
    if (!result.applied) return no(result.code, result.code);
    return yes({ actionDigest });
  }

  // ── acquire: take execution BEFORE the host is mutated ──────────────────────────────────────────

  /**
   * THE ATTEMPT TOKEN'S PLAINTEXT EXISTS IN EXACTLY TWO PLACES: the local `attemptToken` below, and the
   * single successful response this returns. It is structurally confined rather than excluded by a list,
   * because an exclusion list is only as complete as its author.
   *
   * It must never enter an AttestationRecord, a generic operation result, an exception, a tracing
   * attribute, a request/response logger, an idempotency record, a metrics label or a diagnostic dump.
   * The store receives only a verifier. The lease id's mistake was being public; repeating it here would
   * waste the mechanism.
   *
   * Acquire is SINGLE-DELIVERY. A retry of a committed acquire returns `already_acquired` and no token,
   * because verifier-only storage means the gate cannot reproduce a token it never kept. Losing the
   * response loses the attempt, which becomes INDETERMINATE for reconciliation -- the honest outcome.
   */
  async acquire(principal: AuthenticatedPrincipal, input: {
    attestationId: string;
    leaseId: string;
    actionDigest: string;
    orgId: string;
    serverId: string;
    kind: AttestationKind;
    idempotencyKey: string;
    requestHash: string;
  }): Promise<AttestationResult> {
    const unissued = notIssued(principal);
    if (unissued) return unissued;
    const record = await this.#store.loadAttestation(input.attestationId);
    if (!record) return no("unknown_attestation", "no such attestation");
    const legacyAcquire = refuseLegacy(record);
    if (legacyAcquire) return legacyAcquire;
    // The other half of the split: whoever binds may not execute. Checked here as well as in the store
    // so the refusal names the reason rather than surfacing as a generic transition failure.
    if (record.audiencePrincipalId !== principal.principalId) {
      return no("wrong_audience", "only the audience may acquire execution; binding authority does not execute");
    }
    const now = this.#clock();
    // Bounded by the attestation's own validity: an attempt may never outlive the authorization. The
    // INITIAL window, deliberately shorter than the absolute cap, so a long execution has somewhere to
    // extend to. A short-lived attestation still clamps below both.
    const deadline = Math.min(
      Date.parse(now) + this.#initialExecutionMs,
      Date.parse(record.expiresAt),
    );
    if (deadline <= Date.parse(now)) return no("attestation_expired", "attestation_expired");
    const attemptToken = generateCredential();
    const result = await this.#store.acquireAttestation({
      acting: { principalId: principal.principalId, credentialEpoch: principal.credentialEpoch },
      attestationId: input.attestationId,
      leaseId: input.leaseId,
      actionDigest: input.actionDigest,
      orgId: input.orgId,
      serverId: input.serverId,
      kind: input.kind,
      now,
      requireClaim: {
        contentDigest: record.contentDigest,
        releasedByCandidateId: record.candidateId,
      },
      // The store gets a VERIFIER, never the token.
      attemptTokenVerifier: hashCredential(attemptToken),
      executionDeadline: new Date(deadline).toISOString(),
      idempotency: {
        principalId: principal.principalId,
        scope: "acquire",
        key: input.idempotencyKey,
        // Bound to this attestation, lease and digest -- not merely to the shared principal identity,
        // which every process of that executor has.
        requestHash: input.requestHash,
      },
    });
    if (!result.applied) return no(result.code, result.code);
    // The one and only place the plaintext leaves this method.
    return yes({ attemptToken, executionDeadline: new Date(deadline).toISOString() });
  }

  /**
   * Extend a live attempt. NOT the pre-acquire lease renewal: that preserves the binder's allocation,
   * this asserts the acquired attempt is still running.
   */
  async extendExecution(principal: AuthenticatedPrincipal, input: {
    attestationId: string;
    attemptToken: string;
    requestedDeadline: string;
  }): Promise<AttestationResult> {
    const unissued = notIssued(principal);
    if (unissued) return unissued;
    const record = await this.#store.loadAttestation(input.attestationId);
    if (!record) return no("unknown_attestation", "no such attestation");
    const legacy = refuseLegacy(record);
    if (legacy) return legacy;
    if (record.audiencePrincipalId !== principal.principalId) {
      return no("wrong_audience", "only the audience may extend the execution it acquired");
    }
    const absolute = Math.min(
      Date.parse(record.acquiredAt ?? this.#clock()) + MAX_EXECUTION_MS,
      Date.parse(record.expiresAt),
    );
    const result = await this.#store.extendExecution({
      acting: { principalId: principal.principalId, credentialEpoch: principal.credentialEpoch },
      attestationId: input.attestationId,
      attemptToken: input.attemptToken,
      requestedDeadline: input.requestedDeadline,
      absoluteDeadline: new Date(absolute).toISOString(),
      now: this.#clock(),
      requireClaim: {
        contentDigest: record.contentDigest,
        releasedByCandidateId: record.candidateId,
      },
    });
    if (!result.applied) return no(result.code, result.code);
    // The extension NEVER returns or persists plaintext token material -- only the new deadline.
    return yes({ executionDeadline: result.value.executionDeadline });
  }

  async redeem(principal: AuthenticatedPrincipal, input: {
    attestationId: string;
    leaseId: string;
    attemptToken: string;
  }): Promise<AttestationResult> {
    const unissued = notIssued(principal);
    if (unissued) return unissued;
    const record = await this.#store.loadAttestation(input.attestationId);
    if (!record) return no("unknown_attestation", "no such attestation");
    const legacyRedeem = refuseLegacy(record);
    if (legacyRedeem) return legacyRedeem;
    if (record.audiencePrincipalId !== principal.principalId) {
      return no("wrong_audience", "only the audience may redeem the execution it acquired");
    }
    const result = await this.#store.redeemAttestation({
      acting: { principalId: principal.principalId, credentialEpoch: principal.credentialEpoch },
      attestationId: input.attestationId,
      leaseId: input.leaseId,
      attemptToken: input.attemptToken,
      now: this.#clock(),
      requireClaim: {
        contentDigest: record.contentDigest,
        releasedByCandidateId: record.candidateId,
      },
    });
    if (!result.applied) return no(result.code, result.code);
    return yes();
  }

  /** Extend a lease without changing its holder or reviving an expired one. */
  async renew(principal: AuthenticatedPrincipal, input: {
    attestationId: string;
    leaseId: string;
    leaseSeconds: number;
  }): Promise<AttestationResult> {
    const unissued = notIssued(principal);
    if (unissued) return unissued;
    // Renewal did not load the record before, so it could neither refuse a legacy identity nor say who
    // owns the lease it is extending.
    const record = await this.#store.loadAttestation(input.attestationId);
    if (!record) return no("unknown_attestation", "no such attestation");
    const legacyRenew = refuseLegacy(record);
    if (legacyRenew) return legacyRenew;
    if (record.bindingPrincipalId !== principal.principalId) {
      return no("wrong_binder", "only the binder may renew a pre-acquire lease");
    }
    const seconds = Math.min(Math.max(1, Math.floor(input.leaseSeconds)), LEASE_MAX_SECONDS);
    const now = this.#clock();
    const result = await this.#store.renewLease({
      acting: { principalId: principal.principalId, credentialEpoch: principal.credentialEpoch },
      attestationId: input.attestationId,
      leaseId: input.leaseId,
      requestedExpiresAt: new Date(Date.parse(now) + seconds * 1000).toISOString(),
      now,
    });
    if (!result.applied) return no(result.code, result.code);
    return yes({ expiresAt: result.value.expiresAt });
  }

  /**
   * Mint a further attestation from content that is already RELEASED.
   *
   * A second target, or a second protected action, for work whose review is already complete. The same
   * subject and rollback-target rules apply, and it is minted UNBOUND like any other.
   */
  async mintFurther(principal: AuthenticatedPrincipal, input: {
    candidateId: string;
    idempotencyKey: string;
    attestations: ReadonlyArray<{
      kind: AttestationKind;
      orgId: string;
      serverId: string;
      audiencePrincipalId: string;
      bindingPrincipalId: string;
      supersedesAttestationId?: string;
      expiresAt: string;
    }>;
  }): Promise<AttestationResult> {
    const unissued = notIssued(principal);
    if (unissued) return unissued;
    if (!principal.hasRole("owner")) {
      return no("role_required", "only the owner may mint an attestation");
    }
    const record = await this.#store.loadCandidate(input.candidateId);
    if (!record) return no("unknown_candidate", "no such candidate");
    const claim = await this.#store.loadClaim(record.contentDigest);
    if (claim?.disposition !== "RELEASED" || claim.releasedByCandidateId !== record.candidateId) {
      return no("claim_not_released", "further attestations require content that is already released");
    }
    const checked = await this.#checkKinds(record, input.attestations, principal.principalId);
    if (!checked.ok) return checked;
    const result = await this.#store.mintAttestations({
      acting: { principalId: principal.principalId, credentialEpoch: principal.credentialEpoch },
      candidateId: input.candidateId,
      attestations: (checked.value as { minted: AttestationRecord[] }).minted,
      idempotency: this.#idem(principal, "mint-further", input.idempotencyKey, input),
    });
    if (!result.applied) return no(result.code, result.code);
    return yes({ attestationIds: result.value.attestationIds });
  }

  async revoke(principal: AuthenticatedPrincipal, input: {
    attestationId: string;
    reason: string;
  }): Promise<AttestationResult> {
    const unissued = notIssued(principal);
    if (unissued) return unissued;
    if (!principal.hasRole("owner")) {
      return no("role_required", "only the owner may revoke an attestation");
    }
    const result = await this.#store.revokeAttestation({
      acting: { principalId: principal.principalId, credentialEpoch: principal.credentialEpoch },
      attestationId: input.attestationId,
      reason: input.reason,
      now: this.#clock(),
    });
    if (!result.applied) return no(result.code, result.code);
    return yes();
  }

  /**
   * Leave INDETERMINATE, with evidence.
   *
   * An owner asserting "it was applied" is not evidence. Concluding APPLIED requires the original
   * attempt's journaled terminal result and a fresh observation to agree; concluding NOT_APPLIED is the
   * safe direction and leads to a terminal ABORTED that is never reopened.
   */
  async resolveIndeterminate(principal: AuthenticatedPrincipal, input: {
    attestationId: string;
    reconciliation: unknown;
  }): Promise<AttestationResult> {
    const unissued = notIssued(principal);
    if (unissued) return unissued;
    if (!principal.hasRole("owner")) {
      return no("role_required", "only the owner may resolve an indeterminate attestation");
    }
    const record = await this.#store.loadAttestation(input.attestationId);
    if (!record) return no("unknown_attestation", "no such attestation");
    let reconciliation: z.infer<typeof reconciliationSchema>;
    try {
      reconciliation = reconciliationSchema.parse(input.reconciliation);
    } catch (error) {
      return no("malformed_input", (error as Error).message.slice(0, 300));
    }
    const decision = evaluateReconciliation({ kind: record.kind, reconciliation });
    if (!decision.ok) return no(decision.code, decision.message);
    // ATTRIBUTION COMES FROM THE AUTHENTICATED PRINCIPAL, NOT THE CALLER. `resolvedByPrincipalId` was
    // caller-supplied and never compared to the acting owner, so a reconciliation could name anyone as
    // having resolved it -- in the one record whose entire purpose is to say who decided what happened
    // to an execution nobody can otherwise account for.
    //
    // A caller-supplied value that disagrees is REFUSED rather than silently overwritten: quietly
    // replacing it would hide that a client believed something false about who was resolving.
    if (reconciliation.resolvedByPrincipalId !== undefined
      && reconciliation.resolvedByPrincipalId !== principal.principalId) {
      return no("reconciliation_actor_mismatch",
        "resolvedByPrincipalId is taken from the authenticated owner and cannot be supplied as someone else");
    }
    const attributed = { ...reconciliation, resolvedByPrincipalId: principal.principalId };
    const result = await this.#store.resolveIndeterminate({
      acting: { principalId: principal.principalId, credentialEpoch: principal.credentialEpoch },
      attestationId: input.attestationId,
      reconciliation: attributed,
      nextState: reconciliation.outcome === "APPLIED" ? "CONSUMED" : "ABORTED",
      now: this.#clock(),
    });
    if (!result.applied) return no(result.code, result.code);
    return yes();
  }
}

/**
 * Per-kind payload validation, against the schemas as they ACTUALLY are.
 *
 * An earlier design required "the payload's configuration digest equals artifactDigest and its manifest
 * digest equals manifestDigest". The real configuration payload has NO manifest digest, and its
 * `expectedConfigurationDigest` describes the state expected BEFORE the change — a concurrency
 * precondition, not the content being deployed. Binding review to it would have asserted something false
 * while looking rigorous.
 */
export function validatePayload(
  kind: AttestationKind, subject: CandidateSubject, payload: unknown,
): AttestationResult {
  if (kind === "agent.upgrade") {
    if (subject.kind !== "agent.upgrade") return no("subject_kind_mismatch", "wrong subject");
    const parsed = agentUpgradeManifestSchema.safeParse(payload);
    if (!parsed.success) return no("malformed_payload", parsed.error.message.slice(0, 300));
    if (parsed.data.artifactSha256 !== subject.artifactSha256) {
      return no("payload_not_reviewed_content",
        "the payload installs a different artifact than the one reviewed");
    }
    if (parsed.data.releaseManifestDigest !== subject.releaseManifestDigest) {
      return no("payload_not_reviewed_content",
        "the payload names a different release manifest than the one reviewed");
    }
    return yes();
  }

  if (subject.kind !== "configuration.change") return no("subject_kind_mismatch", "wrong subject");
  const parsed = configurationDeploymentPayloadSchema.safeParse(payload);
  if (!parsed.success) return no("malformed_payload", parsed.error.message.slice(0, 300));

  // THE VERB, before anything else about the content. Both configuration kinds share one subject, one
  // payload schema and one change-set digest, so every check below this line passes identically for an
  // apply and for a rollback of the same change set. This is the only thing that separates them.
  const requiredAction = KIND_REQUIRED_ACTION[kind];
  if (requiredAction !== null && parsed.data.action !== requiredAction) {
    return no("payload_not_reviewed_action",
      `a ${kind} attestation cannot authorize a ${parsed.data.action} payload`);
  }

  // The reviewed thing is the CHANGE SET, and the repository already has a canonical digest over exactly
  // it. Recomputed here rather than trusted.
  const recomputed = configurationChangeDigest(parsed.data.mutations);
  if (recomputed !== subject.changeDigest) {
    return no("payload_not_reviewed_content",
      "the payload applies a different change set than the one reviewed");
  }
  if (parsed.data.environmentId !== subject.environmentId
    || parsed.data.targetProfileId !== subject.targetProfileId
    || parsed.data.targetProfileRevision !== subject.targetProfileRevision) {
    return no("payload_not_reviewed_target",
      "the payload redirects the reviewed change at a different environment or profile");
  }
  // WHAT THIS DELIBERATELY DOES NOT ASSERT: encryptedValues/sealedValues are ciphertext sealed to the
  // agent's key. The gate binds WHICH variables change, how, and to which immutable versionId. It does
  // not and cannot assert what plaintext the agent will receive; that is in the residual trust list.
  return yes();
}
