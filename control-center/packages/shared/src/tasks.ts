import crypto from "node:crypto";
import { z } from "zod";
import { sha256, timingSafeEqualHex } from "./signing.js";
import { signWithAgentKey, verifyAgentSignature } from "./agentKeys.js";
import { configurationDeploymentPayloadSchema } from "./configurationDeployment.js";
import { agentUpgradeManifestSchema } from "./agentUpgrades.js";

export const taskProtocolVersion = "task-v1";
export const taskStates = ["queued", "claimed", "running", "succeeded", "failed", "expired", "cancelled"] as const;
/**
 * Every task type, WITH its authorization class. One table, because two lists drift.
 *
 * An independent review found the drift was fail-OPEN: `taskTypes` and `privilegedTaskTypes` were
 * maintained separately, so a developer adding a new mutating type to the first and forgetting the second
 * got a task that skipped BOTH the owner signature and the review gate — and nothing failed, because
 * "not privileged" is indistinguishable from "not yet classified" when the classification is a second
 * list you can forget to edit.
 *
 * Here a type does not exist until it is classified. Omitting an entry does not produce an unprivileged
 * task; it produces a task type the envelope schema rejects.
 *
 * `privileged` means: it changes a managed host, so it requires the owner's offline signature (layer 2)
 * and, on an activated executor, an acquired review attestation (layer 3). `read` means it collects or
 * inspects and changes nothing. When in doubt the answer is `privileged` — the cost of being wrong that
 * way is an authorization step nobody needed, and the cost of being wrong the other way is this finding.
 */
export const taskTypeClassification = {
  "collect.system": "read",
  "inspect.docker": "read",
  "inspect.compose": "read",
  "inspect.git": "read",
  "check.http": "read",
  "check.mongo": "read",
  "collect.telemetry": "read",
  "configuration.apply": "privileged",
  "configuration.rollback": "privileged",
  "agent.upgrade": "privileged",
} as const satisfies Record<string, "read" | "privileged">;

export const taskTypes = Object.keys(taskTypeClassification) as unknown as
  readonly (keyof typeof taskTypeClassification)[] & [string, ...string[]];

// Owner authorization: an offline-owner Ed25519 signature carried alongside a privileged task. This is
// the SECOND, independent trust layer — separate from the control-plane transport/envelope key — and is
// verified with the owner PUBLIC key. See docs/agent-key-redesign.md (two trust layers).
export const ownerAuthorizationSchema = z.object({ signature: z.string().min(32).max(512), issuedAt: z.string().datetime(), expiresAt: z.string().datetime(), nonce: z.string().min(8).max(128), keyVersion: z.string().max(40) }).strict();
export type OwnerAuthorization = z.infer<typeof ownerAuthorizationSchema>;

export const taskPayloadSchema = z.object({
  projects: z.array(z.object({ projectId: z.string(), repoPath: z.string().optional(), composePath: z.string().optional() })).default([]),
  ownerAuthorization: ownerAuthorizationSchema.optional(),
  httpHealthChecks: z.array(z.object({ id: z.string(), url: z.string().url(), timeoutMs: z.number().int().min(100).max(30000) })).default([]),
  mongoChecks: z.array(z.object({ id: z.string(), databaseNameHint: z.string().optional() })).default([]),
  configurationDeployment: configurationDeploymentPayloadSchema.optional(),
  agentUpgrade: agentUpgradeManifestSchema.optional()
}).strict().default({});

export const taskEnvelopeSchema = z.object({
  protocolVersion: z.literal(taskProtocolVersion),
  taskId: z.string(),
  taskType: z.enum(taskTypes),
  orgId: z.string(),
  serverId: z.string(),
  agentId: z.string(),
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  nonce: z.string().min(12),
  payloadDigest: z.string().regex(/^[a-f0-9]{64}$/),
  signingKeyVersion: z.string().min(1),
  signature: z.string().regex(/^[a-f0-9]{64}$/)
});

export const taskAckSchema = z.object({
  taskId: z.string(),
  event: z.enum(["claimed", "started", "progress", "succeeded", "failed"]),
  message: z.string().max(500).optional(),
  progress: z.number().min(0).max(100).optional(),
  result: z.unknown().optional()
}).strict();

export type TaskType = z.infer<typeof taskEnvelopeSchema>["taskType"];
export type TaskEnvelope = z.infer<typeof taskEnvelopeSchema>;
export type TaskPayload = z.infer<typeof taskPayloadSchema>;
export type TaskAck = z.infer<typeof taskAckSchema>;

export function payloadDigest(payload: unknown) {
  return sha256(JSON.stringify(payload ?? {}));
}

export function taskSigningBase(envelope: Omit<TaskEnvelope, "signature">) {
  return [
    envelope.protocolVersion,
    envelope.taskId,
    envelope.taskType,
    envelope.orgId,
    envelope.serverId,
    envelope.agentId,
    envelope.issuedAt,
    envelope.expiresAt,
    envelope.nonce,
    envelope.payloadDigest,
    envelope.signingKeyVersion
  ].join("\n");
}

export function signTaskEnvelope(signingSecret: string, envelope: Omit<TaskEnvelope, "signature">) {
  return crypto.createHmac("sha256", signingSecret).update(taskSigningBase(envelope)).digest("hex");
}

export function verifyTaskEnvelope(signingSecret: string, envelope: TaskEnvelope, payload: unknown) {
  if (payloadDigest(payload) !== envelope.payloadDigest) return false;
  const unsigned = { ...envelope };
  delete (unsigned as Partial<TaskEnvelope>).signature;
  const expected = signTaskEnvelope(signingSecret, unsigned);
  return timingSafeEqualHex(expected, envelope.signature);
}

// agent-v2 task envelope: signed by the CONTROL-PLANE Ed25519 key and verified by the agent with the
// control-plane PUBLIC key (no agent-keyed HMAC). The "agent-v2" suffix binds the scheme so a v2
// envelope can never be cross-verified against the v1 HMAC path (downgrade/confusion prevention). All
// target bindings (task/org/server/agent/expiry/nonce/payloadDigest) come from taskSigningBase. This is
// only the TRANSPORT layer; privileged tasks additionally require the independent owner-authorization
// layer (see ownerAuthorization.ts) — the transport key alone can never authorize a privileged action.
function taskSigningBaseV2(envelope: Omit<TaskEnvelope, "signature">) {
  return `${taskSigningBase(envelope)}\nagent-v2`;
}

export function signTaskEnvelopeV2(controlPlanePrivateKeyB64: string, envelope: Omit<TaskEnvelope, "signature">) {
  return signWithAgentKey(controlPlanePrivateKeyB64, taskSigningBaseV2(envelope));
}

export function verifyTaskEnvelopeV2(controlPlanePublicKeyB64: string, envelope: TaskEnvelope, payload: unknown) {
  if (payloadDigest(payload) !== envelope.payloadDigest) return false;
  const unsigned = { ...envelope };
  delete (unsigned as Partial<TaskEnvelope>).signature;
  return verifyAgentSignature(controlPlanePublicKeyB64, taskSigningBaseV2(unsigned), envelope.signature);
}

export function isTaskExpired(expiresAt: string, now = Date.now()) {
  const parsed = Date.parse(expiresAt);
  return !Number.isFinite(parsed) || parsed <= now;
}
