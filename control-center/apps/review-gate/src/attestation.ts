import crypto from "node:crypto";
import { z } from "zod";

// The release attestation: layer 3 of the authorization stack.
//
// WHAT THIS IS NOT. It is not the owner's authorization. `docs/agent-key-redesign.md` §8 defines two
// layers that both already hold for privileged actions — a transport envelope signature, and an OFFLINE
// OWNER Ed25519 signature over `taskType · org · server · actionDigest · expiry · nonce` whose private key
// never touches OpsWorkbench. Design review round 2 caught me proposing to put a bearer-authenticated
// HTTP endpoint in that signature's place, which would have been a security regression dressed as an
// improvement. Neither existing layer is replaced. An attestation answers only:
//
//     "did this content pass independent review, and is that review still valid for this exact action?"
//
// and `authorizePrivilegedTask()` requires all three, any one failing refusing.

const safeId = z.string().regex(/^[A-Za-z0-9._:/-]{1,200}$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);

/** The protected actions. `release.publish` is deliberately absent — see attestationKinds below. */
export const attestationKinds = [
  "configuration.apply",
  "configuration.rollback",
  "agent.upgrade",
] as const;
export type AttestationKind = (typeof attestationKinds)[number];

/**
 * Which candidate subject each kind may be minted from.
 *
 * Stated as data rather than a comment because "kind matches subject.kind" cannot be literal: both
 * configuration kinds map to one subject. Design review round 6 caught that.
 *
 * `release.publish` is absent from `attestationKinds` entirely. It appeared in an earlier revision as a
 * kind with no enforcement point, since `authorizePrivilegedTask()` covers only these three — and an
 * attestation nothing is obliged to consume is decoration.
 */
export const KIND_SUBJECT: Readonly<Record<AttestationKind, "configuration.change" | "agent.upgrade">> =
  Object.freeze({
    "configuration.apply": "configuration.change",
    "configuration.rollback": "configuration.change",
    "agent.upgrade": "agent.upgrade",
  });

/**
 * The execution VERB each kind pins, or `null` where the payload carries no verb.
 *
 * Stated as data for the same reason as `KIND_SUBJECT`: "kind matches the payload" cannot be literal.
 * Both configuration kinds map to ONE subject and ONE payload schema, and that schema admits
 * `configuration.apply.v1` and `configuration.rollback.v1` alike — so subject checking and change-set
 * digests, which both configuration kinds share, cannot tell an apply from a rollback.
 *
 * WITHOUT THIS, LAYER 3 DID NOT PIN WHICH OPERATION IS PERFORMED. A rollback payload bound cleanly to an
 * apply attestation and the reverse: `validatePayload` never looked at `action`, and acquire's kind check
 * compares the CALLER-SUPPLIED kind against the record, never against the bound payload. The gate claimed
 * to bind "which reviewed change is applied" while leaving the verb free.
 *
 * `agent.upgrade` is `null` because its payload is an upgrade manifest with no verb to pin — the
 * artifact digest and release manifest digest are what identify the operation there. Total over
 * `AttestationKind` on purpose: a new kind cannot be added without deciding this.
 */
export const KIND_REQUIRED_ACTION: Readonly<Record<AttestationKind, string | null>> = Object.freeze({
  "configuration.apply": "configuration.apply.v1",
  "configuration.rollback": "configuration.rollback.v1",
  "agent.upgrade": null,
});

/** Kinds that additionally require the subject to name a rollback target. */
export const KINDS_REQUIRING_ROLLBACK_TARGET: readonly AttestationKind[] =
  Object.freeze(["configuration.rollback"]);

export const attestationStates = [
  "PENDING",
  "RESERVED_UNBOUND",
  "RESERVED_BOUND",
  "EXECUTING",
  "CONSUMED",
  "REVOKED",
  "EXPIRED",
  "INDETERMINATE",
  "ABORTED",
] as const;
export type AttestationState = (typeof attestationStates)[number];

/**
 * The attestation lifecycle.
 *
 * TWO SPLITS IN HERE ARE LOAD-BEARING, and both come from findings rather than from design taste.
 *
 * 1. UNBOUND vs BOUND. An attestation is minted with no payload and no `actionDigest`; binding supplies
 *    them. Round 4 found the previous shape circular — the payload had to contain ids that did not exist
 *    until after the payload was digested, a sequence with no valid execution order. The split also
 *    decides what expiry means: an UNBOUND attestation authorizes no specific payload, so expiring it is
 *    safe and abandoning it is free. A BOUND one names a payload that may already be in flight.
 *
 * 2. BOUND vs EXECUTING. Round 5 found that checking authorization and then mutating a host is a
 *    check/use race: two deliveries both observe RESERVED_BOUND, both pass, BOTH MUTATE THE HOST, and
 *    only one wins the final write. The compare-and-set was protecting the bookkeeping instead of the
 *    effect. EXECUTING is acquired atomically BEFORE the mutation, so exactly one caller proceeds.
 */
export const ATTESTATION_TRANSITIONS:
  Readonly<Record<AttestationState, readonly AttestationState[]>> = Object.freeze({
    PENDING: ["RESERVED_UNBOUND", "REVOKED", "EXPIRED"],
    RESERVED_UNBOUND: ["RESERVED_BOUND", "REVOKED", "EXPIRED"],
    RESERVED_BOUND: ["EXECUTING", "REVOKED", "INDETERMINATE"],
    // NOT revocable. Once the effect may be underway, a row claiming it was stopped would be a lie; the
    // honest outcome is INDETERMINATE.
    EXECUTING: ["CONSUMED", "INDETERMINATE"],
    INDETERMINATE: ["CONSUMED", "ABORTED"],
    CONSUMED: [],
    REVOKED: [],
    EXPIRED: [],
    ABORTED: [],
  });

/** States in which nothing is bound, so expiry and abandonment cost nothing. */
export const UNBOUND_STATES: readonly AttestationState[] =
  Object.freeze(["PENDING", "RESERVED_UNBOUND"]);

/** States in which a payload is named and may be in flight, so expiry must be INDETERMINATE. */
export const BOUND_STATES: readonly AttestationState[] =
  Object.freeze(["RESERVED_BOUND", "EXECUTING"]);

export const terminalAttestationStates: readonly AttestationState[] =
  Object.freeze(["CONSUMED", "REVOKED", "EXPIRED", "ABORTED"]);

export function isAttestationTransitionAllowed(from: AttestationState, to: AttestationState): boolean {
  return (ATTESTATION_TRANSITIONS[from] ?? []).includes(to);
}

export const leaseSchema = z.object({
  leaseId: safeId,
  holderPrincipalId: safeId,
  /**
   * The principal's credential epoch when the lease was taken. A MONOTONIC INTEGER, not a timestamp:
   * design review round 5 pointed out that two rotations inside one clock tick are indistinguishable by
   * timestamp, and clock adjustment moves one backwards.
   */
  credentialEpoch: z.number().int().nonnegative(),
  expiresAt: z.string().datetime(),
}).strict();
export type Lease = z.infer<typeof leaseSchema>;

export const reconciliationSchema = z.object({
  resolvedByPrincipalId: safeId,
  resolvedAt: z.string().datetime(),
  outcome: z.enum(["APPLIED", "NOT_APPLIED"]),
  /** The immutable, executor-authenticated journal entry consulted. */
  journalReference: z.string().min(1).max(500),
  /** The digest the ORIGINAL attempt journaled as its terminal result. */
  journaledPostStateDigest: sha256,
  /** A FRESH reading taken at reconciliation time. Must equal the journaled one to conclude APPLIED. */
  observedHostStateDigest: sha256,
  /** The terminal phase the original attempt reached, e.g. "succeeded". */
  terminalPhase: z.string().min(1).max(80),
  reason: z.string().min(1).max(2000),
}).strict();
export type Reconciliation = z.infer<typeof reconciliationSchema>;

export type AttestationRecord = {
  attestationId: string;
  /**
   * ABSENT MEANS LEGACY v1. The discriminator the previous revision of this design forgot to specify:
   * it declared a v1/v2 policy while `AttestationRecord` carried no field that could tell them apart, so
   * the policy had nothing to execute against.
   *
   * Every mint path writes `"v2"`. v1 records are refused by reserve, bind, acquire, execution extension
   * and redeem, and remain available to revoke, the expiry sweep, read/audit and reconciliation. They are
   * NEVER rewritten or migrated in place -- an immutable identity that can be rewritten was never
   * immutable. Where a replacement is wanted the owner mints a new v2 attestation and points
   * `supersedesAttestationId` at the old one.
   */
  identitySchemaVersion?: "v2";
  kind: AttestationKind;
  contentDigest: string;
  candidateId: string;
  orgId: string;
  serverId: string;
  targetEnvironmentClass: string;
  audiencePrincipalId: string;
  /**
   * Who may reserve and bind. REQUIRED on v2, absent on legacy v1.
   *
   * Distinct from `audiencePrincipalId` and never defaulted to it: that default reproduces exactly the
   * unexecutable protocol this split exists to fix, in which the executor would have to bind a payload
   * the control plane has not yet dispatched to it.
   */
  bindingPrincipalId?: string;
  /**
   * Optional lineage: the v1-or-v2 attestation this one replaces. Owner-supplied at mint, store-validated
   * against the referenced record's candidate, content digest, org and server, immutable once set, and
   * covered by the identity digest -- a replacement that could be re-pointed is not a lineage.
   */
  supersedesAttestationId?: string;
  nonce: string;
  grantedByPrincipalId: string;
  grantedAt: string;
  /** The attestation's OWN validity, distinct from any lease's. */
  expiresAt: string;
  state: AttestationState;
  /** Absent until bind; written exactly once; never re-bound. */
  actionDigest?: string;
  /**
   * Recorded at BIND, read from the canonical principal row inside the same transaction.
   *
   * `binderIncarnation` is the ACQUIRE-TIME EQUALITY TEST. Not the credential epoch -- comparing that
   * would invalidate on ordinary rotation, contradicting the policy that rotation preserves completed
   * bindings. And not present enabled/disabled status -- a principal disabled after bind and later
   * re-enabled is presently enabled, so a status-only check would accept exactly the bindings that
   * disablement was meant to invalidate.
   */
  binderIncarnation?: number;
  /** AUDIT AND ENUMERATION ONLY. Deliberately not an acquire predicate; see `binderIncarnation`. */
  binderCredentialEpoch?: number;

  /** Written at ACQUIRE, in the same transaction as the state transition. */
  executingPrincipalId?: string;
  /**
   * ENFORCED, not an audit note: execution extension requires `acting.credentialEpoch` to equal this.
   * That equality is the whole mechanism by which rotation refuses extension while still permitting
   * redeem -- "requires the current credential" would permit both, since after a rotation the new
   * credential IS current.
   */
  executingCredentialEpoch?: number;
  acquiredAt?: string;
  /** Monotonic: an extension may only move this later, and never past the absolute bound. */
  executionDeadline?: string;
  /**
   * A VERIFIER, never the token. The attempt token's plaintext exists in exactly two places -- the local
   * value inside the acquire handler, and the single successful acquire response.
   */
  attemptTokenVerifier?: string;
  lease?: Lease;
  reconciliation?: Reconciliation;
  consumedAt?: string;
  revokedAt?: string;
  revokedReason?: string;
  indeterminateAt?: string;
  indeterminateReason?: string;
  abortedAt?: string;
};

/**
 * The phase an action must have reached for a reconciliation to conclude it was applied.
 *
 * `rolled_back` is deliberately NOT here for any kind. Design review round 6: it does not prove the
 * requested change remains applied — it proves the opposite. A failed automatic rollback is likewise not
 * evidence of application.
 */
export const REQUIRED_TERMINAL_PHASE: Readonly<Record<AttestationKind, string>> = Object.freeze({
  "configuration.apply": "succeeded",
  "configuration.rollback": "succeeded",
  "agent.upgrade": "succeeded",
});

export type Decision = { ok: true } | { ok: false; code: string; message: string };

const OK: Decision = { ok: true };
const no = (code: string, message: string): Decision => ({ ok: false, code, message });

/**
 * Whether a reconciliation may conclude APPLIED and move INDETERMINATE -> CONSUMED.
 *
 * An owner asserting "APPLIED" is NOT evidence, and an earlier revision treated audit metadata as though
 * it were. What makes this checkable is that two independent readings must agree: the digest the original
 * attempt journaled as its terminal result, and a fresh observation taken now. Comparing an observation
 * to itself proves nothing, which is what the previous rule accidentally permitted.
 */
export function evaluateReconciliation(input: {
  kind: AttestationKind;
  reconciliation: unknown;
}): Decision {
  let record: Reconciliation;
  try {
    record = reconciliationSchema.parse(input.reconciliation);
  } catch (error) {
    return no("malformed_input", (error as Error).message.slice(0, 300));
  }
  if (record.outcome === "NOT_APPLIED") return OK;

  const required = REQUIRED_TERMINAL_PHASE[input.kind];
  if (record.terminalPhase !== required) {
    return no(
      "terminal_phase_insufficient",
      `concluding APPLIED requires the original attempt to have reached "${required}"; ` +
      `it reached "${record.terminalPhase}"`,
    );
  }
  if (record.observedHostStateDigest !== record.journaledPostStateDigest) {
    return no(
      "observation_disagrees_with_journal",
      "the state observed now does not match what the original attempt journaled, so the action " +
      "cannot be concluded to have been applied",
    );
  }
  return OK;
}

/** Digest over an attestation's immutable identity. Not authority — provenance, for audit and lineage. */
/** Absent `identitySchemaVersion` means a record minted before the split existed. */
export function isLegacyIdentity(record: Pick<AttestationRecord, "identitySchemaVersion">): boolean {
  return record.identitySchemaVersion === undefined;
}

/**
 * `bindingPrincipalId` MUST be in this digest: without it, two attestations assigning different binding
 * authority would share one claimed immutable identity.
 *
 * It must NOT be added under the existing `attestation-v1|` domain marker, or the same v1 record would
 * digest differently depending on software version. v1 records therefore keep their exact v1 bytes
 * forever, and v2 gets its own marker and its own field list.
 *
 * `supersedesAttestationId` is included only when present. The encoding is length-prefixed on both the
 * field name and the value, so an omitted field cannot be forged by any value of another field.
 */
export function attestationIdentityDigest(record: AttestationRecord): string {
  const legacy = isLegacyIdentity(record);
  if (!legacy && !record.bindingPrincipalId) {
    // Fail closed rather than digesting a placeholder: a v2 record without a binder has no identity to
    // compute, and substituting "" would give it the same digest as a different malformed record.
    throw new Error("a v2 attestation must carry bindingPrincipalId");
  }
  const fields: Array<[string, string]> = [
    ["kind", record.kind],
    ["contentDigest", record.contentDigest],
    ["candidateId", record.candidateId],
    ["orgId", record.orgId],
    ["serverId", record.serverId],
    ["targetEnvironmentClass", record.targetEnvironmentClass],
    ["audiencePrincipalId", record.audiencePrincipalId],
    ["nonce", record.nonce],
    ["expiresAt", record.expiresAt],
  ];
  if (!legacy) {
    fields.push(["bindingPrincipalId", record.bindingPrincipalId!]);
    if (record.supersedesAttestationId !== undefined) {
      fields.push(["supersedesAttestationId", record.supersedesAttestationId]);
    }
  }
  const hash = crypto.createHash("sha256");
  hash.update(legacy ? "attestation-v1|" : "attestation-v2|");
  for (const [name, value] of fields) {
    hash.update(`${name.length}|${name}|${Buffer.byteLength(value, "utf8")}|${value}|`);
  }
  return hash.digest("hex");
}
