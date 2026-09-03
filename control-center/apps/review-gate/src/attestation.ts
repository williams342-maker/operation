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
  kind: AttestationKind;
  contentDigest: string;
  candidateId: string;
  orgId: string;
  serverId: string;
  targetEnvironmentClass: string;
  audiencePrincipalId: string;
  nonce: string;
  grantedByPrincipalId: string;
  grantedAt: string;
  /** The attestation's OWN validity, distinct from any lease's. */
  expiresAt: string;
  state: AttestationState;
  /** Absent until bind; written exactly once; never re-bound. */
  actionDigest?: string;
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
export function attestationIdentityDigest(record: AttestationRecord): string {
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
  const hash = crypto.createHash("sha256");
  hash.update("attestation-v1|");
  for (const [name, value] of fields) {
    hash.update(`${name.length}|${name}|${Buffer.byteLength(value, "utf8")}|${value}|`);
  }
  return hash.digest("hex");
}
