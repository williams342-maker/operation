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

export type PrivilegedTaskDecision =
  | { authorized: true }
  | { authorized: false; reason: "envelope-invalid" | "expired" | "owner-authorization-missing" | "owner-authorization-invalid" };

// A privileged task executes only if BOTH independent layers pass:
//   layer 1 — transport/envelope integrity (verifyEnvelope: the control-plane/agent transport key), and
//   layer 2 — owner authorization (the owner PUBLIC key), bound to this exact task+target+payload.
// The transport key alone can NEVER satisfy layer 2, so a compromised control-plane envelope-signing key
// cannot create or dispatch an executable privileged task. Fails closed with a specific reason.
export function authorizePrivilegedTask(input: { envelope: TaskEnvelope; payload: unknown; ownerAuthorization?: OwnerAuthorization; ownerPublicKey: string; verifyEnvelope: () => boolean; now?: number }): PrivilegedTaskDecision {
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
  return ok ? { authorized: true } : { authorized: false, reason: "owner-authorization-invalid" };
}
