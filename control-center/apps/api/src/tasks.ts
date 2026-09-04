import crypto from "node:crypto";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { agentUpgradeResultSchema, deploymentProgressSchema, payloadDigest, signTaskEnvelope, signTaskEnvelopeV2, taskPayloadSchema, taskProtocolVersion, taskTypes, isPrivilegedTaskType, isTaskExpired, verifyOwnerAuthorization, privilegedActionDigest, type TaskEnvelope, type TaskPayload, type TaskType } from "@control-center/shared";
import { agentV2Enabled } from "./agentProtocolFlag.js";
import { collections } from "./db.js";
import type { AgentTaskDoc, ServerDoc } from "./models.js";
import { invalidateOperationalContext } from "./aiContextBuilder.js";

const maxResultBytes = 32_000;
const taskRetentionMs = 14 * 24 * 60 * 60 * 1000;
const defaultExpiryMs = 10 * 60 * 1000;

export const taskRegistry: Record<TaskType, { timeoutMs: number; outputCapBytes: number; permission: "tasks:run"; payload: typeof taskPayloadSchema }> = Object.fromEntries(
  taskTypes.map((type) => [type, { timeoutMs: type === "check.http" || type === "check.mongo" ? 30_000 : 20_000, outputCapBytes: maxResultBytes, permission: "tasks:run" as const, payload: taskPayloadSchema }])
) as Record<TaskType, { timeoutMs: number; outputCapBytes: number; permission: "tasks:run"; payload: typeof taskPayloadSchema }>;

export function isConfigurationMutationTask(type: TaskType) { return type === "configuration.apply" || type === "configuration.rollback"; }

/** Agent-task audit targets are canonical lowercase ObjectId hex strings. */
export function taskAuditTargetId(id: ObjectId | string) { return typeof id === "string" ? new ObjectId(id).toHexString() : id.toHexString(); }

export function taskSigningKeyVersion() {
  return process.env.CONTROL_CENTER_TASK_SIGNING_KEY_VERSION || "v1";
}

export function sanitizeResult(value: unknown): unknown {
  const secretKey = /(authorization|cookie|token|secret|password|signature|uri|connection|string)/i;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeResult(item));
  if (value && typeof value === "object") {
    const safe: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      safe[key] = secretKey.test(key) ? "[redacted]" : sanitizeResult(child);
    }
    return safe;
  }
  if (typeof value === "string") {
    return value
      .replace(/mongodb(?:\+srv)?:\/\/[^\s"']+/gi, "mongodb://[redacted]")
      .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
      .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[redacted]@")
      .replace(/([?&][A-Za-z0-9_.~-]+)=([^&#\s]*)/g, "$1=[redacted]")
      .replace(/\b([A-Z][A-Z0-9_]{1,127})=([^\s]*)/g, "$1=[redacted]")
      .replace(/\b(token|secret|password|credential|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]");
  }
  return value;
}

export function ensureBounded(value: unknown) {
  const sanitized = sanitizeResult(value);
  const size = Buffer.byteLength(JSON.stringify(sanitized));
  if (size > maxResultBytes) throw new Error("Task result exceeds output cap");
  return sanitized;
}

export function safeTaskSummary(type: string, outcome: "succeeded" | "failed", message: unknown, result: unknown) {
  if (outcome === "failed" && (type === "configuration.apply" || type === "configuration.rollback" || type === "agent.upgrade")) {
    const category = result && typeof result === "object" && typeof (result as Record<string, unknown>).errorCategory === "string" ? (result as Record<string, unknown>).errorCategory : "unknown";
    return `${type === "agent.upgrade" ? "Agent upgrade" : "Configuration deployment"} failed (${String(category).replace(/[^a-z_]/g, "").slice(0, 32) || "unknown"})`;
  }
  const fallback = outcome === "succeeded" ? "Task completed successfully" : "Task failed";
  const oppositeFallback = outcome === "succeeded" ? "Task failed" : "Task completed successfully";
  const sanitized = sanitizeResult(typeof message === "string" && message.trim() ? message : fallback);
  const bounded = [...String(sanitized)].map((character) => { const code = character.charCodeAt(0); return code < 32 || code === 127 ? " " : character; }).join("").replace(/\s+/g, " ").trim().slice(0, 500);
  // Only normalize the protocol's reserved opposite fallback. Arbitrary agent text
  // is never classified as success or failure; the explicit terminal event is authoritative.
  return bounded.toLowerCase() === oppositeFallback.toLowerCase() ? fallback : bounded || fallback;
}

export function taskSummaryForState(state: AgentTaskDoc["state"], storedSummary: unknown) {
  const terminalFallbacks = { succeeded: "Task completed successfully", failed: "Task failed", expired: "Task expired", cancelled: "Task cancelled" } as const;
  if (!(state in terminalFallbacks)) return undefined;
  const fallback = terminalFallbacks[state as keyof typeof terminalFallbacks];
  if (state === "expired" || state === "cancelled") return fallback;
  if (typeof storedSummary !== "string" || !storedSummary.trim()) return fallback;
  const opposite = state === "succeeded" ? terminalFallbacks.failed : terminalFallbacks.succeeded;
  return storedSummary.trim().toLowerCase() === opposite.toLowerCase() ? fallback : storedSummary.trim();
}

export async function createTask(input: { orgId: ObjectId; server: ServerDoc & { _id: ObjectId }; projectId?: ObjectId; type: TaskType; payload: TaskPayload; idempotencyKey: string; createdByUserId?: ObjectId; availableAt?: Date; expiresAt?: Date }) {
  const registry = taskRegistry[input.type];
  if (!registry) throw new Error("Unsupported task type");
  const payload = registry.payload.parse(input.payload);
  // Layer 2 boundary at the control plane: a privileged task cannot be created without a valid owner
  // authorization once an owner public key is configured. The transport/envelope key cannot satisfy
  // this. Inert until CONTROL_CENTER_OWNER_PUBLIC_KEY is set (today's RBAC/approval boundary stands).
  const ownerKey = process.env.CONTROL_CENTER_OWNER_PUBLIC_KEY?.trim();
  if (isPrivilegedTaskType(input.type) && ownerKey) {
    const oa = payload.ownerAuthorization;
    if (!oa) throw new Error("Owner authorization required for privileged task");
    if (isTaskExpired(oa.expiresAt)) throw new Error("Owner authorization expired");
    const ok = verifyOwnerAuthorization(ownerKey, { taskType: input.type, orgId: input.orgId.toHexString(), serverId: input.server._id.toHexString(), actionDigest: privilegedActionDigest(payload), expiresAt: oa.expiresAt, nonce: oa.nonce, keyVersion: oa.keyVersion }, oa.signature);
    if (!ok) throw new Error("Owner authorization invalid");
  }
  const now = new Date();
  const doc: AgentTaskDoc = {
    orgId: input.orgId,
    serverId: input.server._id,
    projectId: input.projectId,
    agentId: input.server.agentId,
    type: input.type,
    state: "queued",
    payload,
    idempotencyKey: input.idempotencyKey,
    nonce: crypto.randomBytes(18).toString("base64url"),
    signingKeyVersion: taskSigningKeyVersion(),
    version: 1,
    createdByUserId: input.createdByUserId,
    availableAt: input.availableAt || now,
    expiresAt: input.expiresAt || new Date(now.getTime() + defaultExpiryMs),
    historyExpiresAt: new Date(now.getTime() + taskRetentionMs),
    createdAt: now,
    updatedAt: now
  };
  try {
    const result = await collections.agentTasks.insertOne(doc);
    invalidateOperationalContext(input.server._id.toHexString());
    if (input.projectId) invalidateOperationalContext(input.projectId.toHexString());
    return { ...doc, _id: result.insertedId, auditCreation: true as const };
  } catch (error) {
    const existing = await collections.agentTasks.findOne({ orgId: input.orgId, idempotencyKey: input.idempotencyKey });
    if (existing) return { ...existing, auditCreation: false as const };
    throw error;
  }
}

export async function claimTasksForAgent(server: ServerDoc & { _id: ObjectId }, limit = 2) {
  const now = new Date();
  await collections.agentTasks.updateMany({ orgId: server.orgId, agentId: server.agentId, state: { $in: ["queued", "claimed", "running"] }, expiresAt: { $lte: now } }, { $set: { state: "expired", completedAt: now, updatedAt: now }, $inc: { version: 1 } });
  const claimed: Array<AgentTaskDoc & { _id: ObjectId; envelope: TaskEnvelope }> = [];
  for (let i = 0; i < limit; i += 1) {
    const task = await collections.agentTasks.findOneAndUpdate(
      { orgId: server.orgId, serverId: server._id, agentId: server.agentId, state: "queued", availableAt: { $lte: now }, expiresAt: { $gt: now } },
      { $set: { state: "claimed", claimedAt: now, updatedAt: now }, $inc: { version: 1 } },
      { sort: { availableAt: 1, createdAt: 1 }, returnDocument: "after" }
    );
    if (!task?._id) break;
    claimed.push({ ...task, envelope: buildEnvelope(task, server) });
  }
  return claimed;
}

// Control-plane Ed25519 private key (base64url PKCS8) used to sign v2 task envelopes. Agents verify
// with the corresponding public key delivered in their bootstrap. Absent ⇒ v2 signing unavailable.
export function controlPlaneTaskSigningKey(): string | undefined {
  return process.env.CONTROL_CENTER_TASK_SIGNING_PRIVATE_KEY?.trim() || undefined;
}

export function buildEnvelope(task: AgentTaskDoc & { _id: ObjectId }, server: ServerDoc & { _id: ObjectId }): TaskEnvelope {
  // Use v2 (control-plane-signed) envelopes only for v2-enrolled servers when the flag is on and a
  // control-plane signing key is configured; otherwise keep the legacy agent-keyed HMAC. The
  // signingKeyVersion is bound into the signature and tells the agent which verification path to use.
  const useV2 = agentV2Enabled() && server.keyProtocolVersion === "agent-v2" && Boolean(controlPlaneTaskSigningKey());
  const unsigned: Omit<TaskEnvelope, "signature"> = {
    protocolVersion: taskProtocolVersion,
    taskId: task._id.toHexString(),
    taskType: task.type as TaskType,
    orgId: task.orgId.toHexString(),
    serverId: task.serverId.toHexString(),
    agentId: server.agentId,
    issuedAt: new Date().toISOString(),
    expiresAt: task.expiresAt.toISOString(),
    nonce: task.nonce,
    payloadDigest: payloadDigest(task.payload),
    signingKeyVersion: useV2 ? "cp-ed25519-v1" : task.signingKeyVersion
  };
  return { ...unsigned, signature: useV2 ? signTaskEnvelopeV2(controlPlaneTaskSigningKey()!, unsigned) : signTaskEnvelope(server.agentSecretHash, unsigned) };
}

export async function acknowledgeTask(server: ServerDoc & { _id: ObjectId }, body: { taskId: string; event: "claimed" | "started" | "progress" | "succeeded" | "failed"; message?: string; progress?: number; result?: unknown }) {
  const id = new ObjectId(body.taskId);
  const task = await collections.agentTasks.findOne({ _id: id, orgId: server.orgId, serverId: server._id, agentId: server.agentId });
  if (!task) return { status: 404, body: { error: "Task not found" } };
  const now = new Date();
  if (task.state === "cancelled" || task.state === "expired") return { status: 409, body: { error: "Task is no longer active" } };
  if (task.state === "succeeded" || task.state === "failed") {
    if (body.event === task.state) return { status: 200, body: { ok: true }, shouldAudit: false };
    return { status: 409, body: { error: "Task already has a different terminal state" } };
  }
  // The atomic queued -> claimed database transition in claimTasksForAgent is
  // authoritative. The agent acknowledgement confirms receipt but must not
  // mutate the task or emit a second claim audit event.
  if (body.event === "claimed") {
    if (task.state !== "claimed") return { status: 409, body: { error: "Task is not awaiting claim acknowledgement" } };
    return { status: 200, body: { ok: true }, shouldAudit: false };
  }
  if (task.expiresAt <= now) {
    await collections.agentTasks.updateOne({ _id: id, state: { $ne: "expired" } }, { $set: { state: "expired", completedAt: now, updatedAt: now }, $inc: { version: 1 } });
    return { status: 409, body: { error: "Task expired" } };
  }
  const set: Record<string, unknown> = { updatedAt: now };
  let nextState: AgentTaskDoc["state"] = task.state;
  if (body.event === "started") { nextState = "running"; set.startedAt = task.startedAt || now; }
  if (body.event === "progress") { set.progress = body.progress ?? task.progress ?? 0; }
  if (body.event === "succeeded" || body.event === "failed") {
    if (task.type === "configuration.apply" || task.type === "configuration.rollback") deploymentProgressSchema.parse(body.result);
    if (task.type === "agent.upgrade") agentUpgradeResultSchema.parse(body.result);
    nextState = body.event;
    set.completedAt = now;
    set.result = ensureBounded(body.result ?? {});
    set.resultSummary = safeTaskSummary(task.type, body.event, body.message, set.result);
    await collections.agentTaskResults.updateOne({ orgId: task.orgId, taskId: id }, { $setOnInsert: { orgId: task.orgId, taskId: id, serverId: task.serverId, projectId: task.projectId, agentId: task.agentId, state: nextState, result: set.result, completedAt: now, expiresAt: task.historyExpiresAt, createdAt: now, updatedAt: now } }, { upsert: true });
  }
  set.state = nextState;
  await collections.agentTasks.updateOne({ _id: id, orgId: server.orgId }, { $set: set, $inc: { version: 1 } });
  if (task.type === "agent.upgrade" && body.event === "progress") { const upgrade = agentUpgradeResultSchema.parse(body.result); const state = upgrade.phase === "queued" ? "queued" : upgrade.phase === "upgrading" ? "upgrading" : "validating"; await collections.agentUpgradePlans.updateOne({ orgId: task.orgId, taskId: id }, { $set: { state, updatedAt: now } }); await collections.servers.updateOne({ _id: server._id, orgId: server.orgId }, { $set: { upgradeState: state, updatedAt: now } }); }
  if (task.type === "agent.upgrade" && (body.event === "succeeded" || body.event === "failed")) { const upgrade = agentUpgradeResultSchema.parse(set.result); const state = upgrade.phase === "complete" ? "complete" : upgrade.phase === "rolled_back" ? "rolled_back" : "failed"; await collections.agentUpgradePlans.updateOne({ orgId: task.orgId, taskId: id }, { $set: { state, failureCategory: upgrade.errorCategory, rollbackState: upgrade.phase.startsWith("rollback") ? upgrade.phase : undefined, updatedAt: now } }); await collections.servers.updateOne({ _id: server._id, orgId: server.orgId }, { $set: { upgradeState: state, updatedAt: now } }); }
  invalidateOperationalContext(server._id.toHexString());
  if (task.projectId) invalidateOperationalContext(task.projectId.toHexString());
  const deployment = task.type === "configuration.apply" || task.type === "configuration.rollback" ? deploymentProgressSchema.safeParse(set.result) : undefined;
  // `errorCategory` and `reviewGate` are carried here as well as in the stored result, because an audit
  // entry is read on its own. Without them a gate REFUSAL and an ordinary deployment failure produce
  // the same audit line -- a failed phase and no category -- and the one event that says "this executor
  // was refused permission" is the one an operator most needs to find by querying the audit log.
  // `deploymentErrorCategory` is a different field and does not cover it: refusals set `errorCategory`.
  return { status: 200, body: { ok: true }, auditMetadata: deployment?.success ? {
    phase: deployment.data.phase,
    deploymentErrorCategory: deployment.data.deploymentErrorCategory || "none",
    rollbackErrorCategory: deployment.data.rollbackErrorCategory || "none",
    errorCategory: deployment.data.errorCategory || "none",
    reviewGate: deployment.data.reviewGate || "none"
  } : undefined };
}

export const createTaskSchema = z.object({
  serverId: z.string(),
  projectId: z.string().optional(),
  type: z.enum(taskTypes),
  payload: taskPayloadSchema.optional(),
  idempotencyKey: z.string().min(8).max(160).optional(),
  expiresInSeconds: z.number().int().min(30).max(3600).default(600)
});




