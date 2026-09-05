import { signWithAgentKey, verifyAgentSignature } from "./agentKeys.js";
import { payloadDigest, isTaskExpired, taskTypeClassification, type TaskEnvelope, type OwnerAuthorization } from "./tasks.js";
import { configurationDeploymentPayloadSchema } from "./configurationDeployment.js";
import { agentUpgradeManifestSchema } from "./agentUpgrades.js";

// Privileged task types require owner authorization (a state-changing managed-server action) and, on an
// activated executor, an acquired review attestation. Read-only collection/inspection tasks do not.
//
// DERIVED, not maintained. This used to be a second hand-written list beside `taskTypes`, which an
// independent review showed was fail-open: a new mutating type added to one list and missing from the
// other skipped both authorization layers silently. There is now one table and this reads it.
export const privilegedTaskTypes = Object.entries(taskTypeClassification)
  .filter(([, classification]) => classification === "privileged")
  .map(([type]) => type) as readonly string[];

export function isPrivilegedTaskType(type: string): boolean {
  return (taskTypeClassification as Record<string, string | undefined>)[type] === "privileged";
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

/**
 * The privileged sub-payload as the GATE will see it: located by task type, then parsed, so the key
 * order is the schema's.
 *
 * THIS IS THE ONE A BINDER MUST USE. The gate digests the sub-payload -- `configurationDeployment` or
 * `agentUpgrade` -- not the task payload that wraps it, and it digests the parsed form. A binder that
 * hands the gate a hand-built object with the same fields in a different order binds a digest the
 * executor will never reproduce, and every acquire is refused `action_digest_mismatch` with nothing
 * naming the reason. See the serialization contract on `payloadDigest`.
 *
 * Returns undefined for a task type with no privileged payload, exactly as `privilegedSubPayload` does,
 * so an unwired type is refused rather than silently signed.
 */
export function privilegedSubPayloadForSigning(taskType: string, payload: unknown): unknown {
  const schema = privilegedSubPayloadSchema(taskType);
  if (!schema) return undefined;
  const sub = privilegedSubPayload(taskType, payload);
  if (sub === undefined) return undefined;
  // `.parse`, not `.safeParse`: a signing tool handed something unparseable wants the reason, and an
  // authorization signed over an invalid payload is one nothing will ever accept.
  return schema.parse(sub);
}

/** The schema a privileged sub-payload must satisfy for this task type; undefined if unwired. */
export function privilegedSubPayloadSchema(taskType: string) {
  if (taskType === "configuration.apply" || taskType === "configuration.rollback") {
    return configurationDeploymentPayloadSchema;
  }
  if (taskType === "agent.upgrade") return agentUpgradeManifestSchema;
  return undefined;
}

/**
 * A privileged sub-payload in the form EVERYTHING digests: parsed, so the key order is the schema's.
 * `undefined` for an unwired task type or a payload the schema refuses.
 *
 * THE EXECUTOR'S HALF OF THE SERIALIZATION CONTRACT. The gate binds the digest of ITS parse; an
 * executor that digested the bytes it happened to receive would agree only while whoever dispatched the
 * task also parsed. The real control plane does -- `createTask` stores `registry.payload.parse(...)` --
 * but making the agreement depend on that is an unstated assumption about a component on the other side
 * of a trust boundary. Both sides canonicalising makes it hold unconditionally.
 *
 * Refusing rather than throwing, because the caller is an enforcing executor deciding whether it may
 * act: an unparseable privileged payload must become a clean refusal, not an exception that the poll
 * loop turns into a fabricated deployment failure.
 */
export function canonicalPrivilegedPayload(taskType: string, subPayload: unknown): unknown {
  const schema = privilegedSubPayloadSchema(taskType);
  if (!schema) return undefined;
  const parsed = schema.safeParse(subPayload);
  return parsed.success ? parsed.data : undefined;
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
