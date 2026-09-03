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
  KINDS_REQUIRING_ROLLBACK_TARGET,
  KIND_SUBJECT,
  attestationKinds,
  evaluateReconciliation,
  reconciliationSchema,
  type AttestationKind,
  type AttestationRecord,
} from "./attestation.js";
import { AuthenticatedPrincipal } from "./auth.js";
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

  constructor(store: ReviewGateStore, options: { clock?: () => string; ids?: () => string } = {}) {
    this.#store = store;
    this.#clock = options.clock ?? (() => new Date().toISOString());
    this.#ids = options.ids ?? (() => crypto.randomUUID());
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
      audiencePrincipalId: string; expiresAt: string }>,
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
      minted.push({
        attestationId: this.#ids(),
        kind: request.kind,
        contentDigest: record.contentDigest,
        candidateId: record.candidateId,
        orgId: request.orgId,
        serverId: request.serverId,
        targetEnvironmentClass: record.binding.targetEnvironmentClass,
        audiencePrincipalId: request.audiencePrincipalId,
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
    if (record.audiencePrincipalId !== principal.principalId) {
      return no("wrong_audience", "this attestation names a different executor");
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

  async acquire(principal: AuthenticatedPrincipal, input: {
    attestationId: string;
    leaseId: string;
    actionDigest: string;
    orgId: string;
    serverId: string;
    kind: AttestationKind;
  }): Promise<AttestationResult> {
    const unissued = notIssued(principal);
    if (unissued) return unissued;
    const record = await this.#store.loadAttestation(input.attestationId);
    if (!record) return no("unknown_attestation", "no such attestation");
    const result = await this.#store.acquireAttestation({
      acting: { principalId: principal.principalId, credentialEpoch: principal.credentialEpoch },
      attestationId: input.attestationId,
      leaseId: input.leaseId,
      actionDigest: input.actionDigest,
      orgId: input.orgId,
      serverId: input.serverId,
      kind: input.kind,
      now: this.#clock(),
      requireClaim: {
        contentDigest: record.contentDigest,
        releasedByCandidateId: record.candidateId,
      },
    });
    if (!result.applied) return no(result.code, result.code);
    return yes();
  }

  async redeem(principal: AuthenticatedPrincipal, input: {
    attestationId: string;
    leaseId: string;
  }): Promise<AttestationResult> {
    const unissued = notIssued(principal);
    if (unissued) return unissued;
    const record = await this.#store.loadAttestation(input.attestationId);
    if (!record) return no("unknown_attestation", "no such attestation");
    const result = await this.#store.redeemAttestation({
      acting: { principalId: principal.principalId, credentialEpoch: principal.credentialEpoch },
      attestationId: input.attestationId,
      leaseId: input.leaseId,
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
    const result = await this.#store.resolveIndeterminate({
      acting: { principalId: principal.principalId, credentialEpoch: principal.credentialEpoch },
      attestationId: input.attestationId,
      reconciliation,
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
