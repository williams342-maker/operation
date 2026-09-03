import { signWithAgentKey, verifyAgentSignature } from "./agentKeys.js";
import { payloadDigest, isTaskExpired, type TaskEnvelope, type OwnerAuthorization } from "./tasks.js";

// Privileged task types require owner authorization (a state-changing managed-server action). Read-only
// collection/inspection tasks do not.
export const privilegedTaskTypes = ["configuration.apply", "configuration.rollback", "agent.upgrade"] as const;
export function isPrivilegedTaskType(type: string): boolean {
  return (privilegedTaskTypes as readonly string[]).includes(type);
}

// Digest of the privileged ACTION — the payload EXCLUDING the ownerAuthorization field itself (so the
// signature is never inside the digest it signs). The owner signs this out-of-band; the control plane
// and the agent both recompute it from the payload. The envelope separately binds the FULL payload.
export function privilegedActionDigest(payload: unknown): string {
  const clone = { ...(payload as Record<string, unknown>) };
  delete clone.ownerAuthorization;
  return payloadDigest(clone);
}

// Canonical owner-authorization statement. Binds the target (org/server), the action (taskType +
// actionDigest), and the owner-chosen expiry + nonce — NOT the runtime task id (which does not exist
// when the owner signs offline). This authorizes ONE action against ONE target; it cannot be replayed to
// another target or reused after payload/target substitution.
export function ownerAuthorizationMessage(parts: { taskType: string; orgId: string; serverId: string; actionDigest: string; expiresAt: string; nonce: string; keyVersion: string }): string {
  return ["owner-authorization-v1", parts.keyVersion, parts.taskType, parts.orgId, parts.serverId, parts.actionDigest, parts.expiresAt, parts.nonce].join("\n");
}

// signOwnerAuthorization uses the OFFLINE owner private key (test/dev disposable keys only in this repo;
// the production owner private key is never handled here). Verification uses the owner PUBLIC key.
export function signOwnerAuthorization(ownerPrivateKeyB64: string, parts: Parameters<typeof ownerAuthorizationMessage>[0]): string {
  return signWithAgentKey(ownerPrivateKeyB64, ownerAuthorizationMessage(parts));
}

export function verifyOwnerAuthorization(ownerPublicKeyB64: string, parts: Parameters<typeof ownerAuthorizationMessage>[0], signature: string): boolean {
  return verifyAgentSignature(ownerPublicKeyB64, ownerAuthorizationMessage(parts), signature);
}

/**
 * Layer 3: the review attestation the payload must carry when an executor is ENFORCING.
 *
 * It lives inside the payload (see `reviewAuthorizationSchema` in configurationDeployment.ts), so it is
 * covered by both the owner's offline signature and the transport envelope digest. This type is only the
 * shape `authorizePrivilegedTask` checks for; the gate is what decides whether it means anything.
 */
export type ReviewAuthorizationRef = { attestationId: string; leaseId: string };

export type PrivilegedTaskDecision =
  | { authorized: true }
  | { authorized: false; reason: "envelope-invalid" | "expired" | "owner-authorization-missing" | "owner-authorization-invalid" | "review-authorization-missing" };

// A privileged task executes only if BOTH independent layers pass:
//   layer 1 — transport/envelope integrity (verifyEnvelope: the control-plane/agent transport key), and
//   layer 2 — owner authorization (the owner PUBLIC key), bound to this exact task+target+payload.
// The transport key alone can NEVER satisfy layer 2, so a compromised control-plane envelope-signing key
// cannot create or dispatch an executable privileged task. Fails closed with a specific reason.
/**
 * Layers 1 and 2, plus the layer-3 PRECONDITION.
 *
 * WHAT LAYER 3 IS NOT DOING HERE. This function is pure and synchronous; it cannot talk to the gate, and
 * it must not pretend to. What it checks is that an ENFORCING executor was handed a payload that names an
 * attestation and a lease — the presence of the thing the executor will then have to redeem for real.
 * Acquisition is a MUTATION on the gate and happens at the effect point, not here: a predicate consulted
 * before an effect is a check/use race, which is the defect that shaped this whole design.
 *
 * INERT WHEN NOT ENFORCING. `requireReviewAuthorization` defaults to false, so the existing two layers
 * behave exactly as before and adding this cannot break the path it is being added to — the same additive
 * discipline the owner-authorization layer used when it was introduced.
 */
export function authorizePrivilegedTask(input: { envelope: TaskEnvelope; payload: unknown; ownerAuthorization?: OwnerAuthorization; ownerPublicKey: string; verifyEnvelope: () => boolean; now?: number; requireReviewAuthorization?: boolean }): PrivilegedTaskDecision {
  if (!input.verifyEnvelope()) return { authorized: false, reason: "envelope-invalid" };
  if (isTaskExpired(input.envelope.expiresAt, input.now)) return { authorized: false, reason: "expired" };
  if (!input.ownerAuthorization) return { authorized: false, reason: "owner-authorization-missing" };
  const oa = input.ownerAuthorization;
  if (isTaskExpired(oa.expiresAt, input.now)) return { authorized: false, reason: "expired" };
  const ok = verifyOwnerAuthorization(input.ownerPublicKey, {
    taskType: input.envelope.taskType,
    orgId: input.envelope.orgId,
    serverId: input.envelope.serverId,
    actionDigest: privilegedActionDigest(input.payload),
    expiresAt: oa.expiresAt,
    nonce: oa.nonce,
    keyVersion: oa.keyVersion
  }, oa.signature);
  if (!ok) return { authorized: false, reason: "owner-authorization-invalid" };
  if (input.requireReviewAuthorization) {
    // Read from the PRIVILEGED SUB-PAYLOAD, which is where the schema puts it — not from the task payload
    // that wraps it. Getting this wrong here refuses every privileged task on an activated executor.
    const reference = readReviewAuthorization(privilegedSubPayload(input.envelope.taskType, input.payload));
    if (!reference) return { authorized: false, reason: "review-authorization-missing" };
  }
  return { authorized: true };
}

/**
 * Where the privileged payload for a task type lives, and the ONLY place that knows it.
 *
 * `reviewAuthorization` sits inside `configurationDeploymentPayloadSchema` and
 * `agentUpgradeManifestSchema`, not at the top of `taskPayloadSchema` — which is `.strict()` and has no
 * such field. Two separate places had independently reimplemented "find the privileged payload", and both
 * got it wrong in the same way, which is what this function exists to make impossible.
 *
 * An unknown task type returns undefined, so a new privileged type that nobody wired here is REFUSED by
 * an enforcing executor rather than applied unauthorized.
 */
export function privilegedSubPayload(taskType: string, payload: unknown): unknown {
  const candidate = payload as { configurationDeployment?: unknown; agentUpgrade?: unknown } | null | undefined;
  if (taskType === "configuration.apply" || taskType === "configuration.rollback") return candidate?.configurationDeployment;
  if (taskType === "agent.upgrade") return candidate?.agentUpgrade;
  return undefined;
}

/** The layer-3 reference carried inside the privileged payload, or null if absent or malformed. */
export function readReviewAuthorization(payload: unknown): ReviewAuthorizationRef | null {
  const candidate = (payload as { reviewAuthorization?: unknown } | null)?.reviewAuthorization;
  if (!candidate || typeof candidate !== "object") return null;
  const { attestationId, leaseId } = candidate as { attestationId?: unknown; leaseId?: unknown };
  if (typeof attestationId !== "string" || !attestationId) return null;
  if (typeof leaseId !== "string" || !leaseId) return null;
  return { attestationId, leaseId };
}
