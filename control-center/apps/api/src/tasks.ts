import crypto from "node:crypto";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { agentUpgradeResultSchema, deploymentProgressSchema, payloadDigest, signTaskEnvelope, taskPayloadSchema, taskProtocolVersion, taskTypes, type TaskEnvelope, type TaskPayload, type TaskType } from "@control-center/shared";
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

export function safeTaskSummary(type: string, message: unknown, result: unknown, event: "succeeded" | "failed" = "failed") {
  if (type === "configuration.apply" || type === "configuration.rollback" || type === "agent.upgrade") {
    if (event === "succeeded") return `${type === "agent.upgrade" ? "Agent upgrade" : "Configuration deployment"} completed successfully`;
    const category = result && typeof result === "object" && typeof (result as Record<string, unknown>).errorCategory === "string" ? (result as Record<string, unknown>).errorCategory : "unknown";
    return `${type === "agent.upgrade" ? "Agent upgrade" : "Configuration deployment"} failed (${String(category).replace(/[^a-z_]/g, "").slice(0, 32) || "unknown"})`;
  }
  const sanitized = sanitizeResult(typeof message === "string" ? message : event === "succeeded" ? "Task completed successfully" : "Task failed");
  return [...String(sanitized)].map((character) => { const code = character.charCodeAt(0); return code < 32 || code === 127 ? " " : character; }).join("").replace(/\s+/g, " ").slice(0, 500);
}

export async function createTask(input: { orgId: ObjectId; server: ServerDoc & { _id: ObjectId }; projectId?: ObjectId; type: TaskType; payload: TaskPayload; idempotencyKey: string; createdByUserId?: ObjectId; availableAt?: Date; expiresAt?: Date }) {
  const registry = taskRegistry[input.type];
  if (!registry) throw new Error("Unsupported task type");
  const payload = registry.payload.parse(input.payload);
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
    return { ...doc, _id: result.insertedId };
  } catch (error) {
    const existing = await collections.agentTasks.findOne({ orgId: input.orgId, idempotencyKey: input.idempotencyKey });
    if (existing) return existing;
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

export function buildEnvelope(task: AgentTaskDoc & { _id: ObjectId }, server: ServerDoc & { _id: ObjectId }): TaskEnvelope {
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
    signingKeyVersion: task.signingKeyVersion
  };
  return { ...unsigned, signature: signTaskEnvelope(server.agentSecretHash, unsigned) };
}

export async function acknowledgeTask(server: ServerDoc & { _id: ObjectId }, body: { taskId: string; event: "claimed" | "started" | "progress" | "succeeded" | "failed"; message?: string; progress?: number; result?: unknown }) {
  const id = new ObjectId(body.taskId);
  const task = await collections.agentTasks.findOne({ _id: id, orgId: server.orgId, serverId: server._id, agentId: server.agentId });
  if (!task) return { status: 404, body: { error: "Task not found" } };
  const now = new Date();
  if (task.state === "cancelled" || task.state === "expired") return { status: 409, body: { error: "Task is no longer active" } };
  if (task.expiresAt <= now) {
    await collections.agentTasks.updateOne({ _id: id, state: { $ne: "expired" } }, { $set: { state: "expired", completedAt: now, updatedAt: now }, $inc: { version: 1 } });
    return { status: 409, body: { error: "Task expired" } };
  }
  const set: Record<string, unknown> = { updatedAt: now };
  let nextState = task.state;
  if (body.event === "started") { nextState = "running"; set.startedAt = task.startedAt || now; }
  if (body.event === "progress") { set.progress = body.progress ?? task.progress ?? 0; }
  if (body.event === "succeeded" || body.event === "failed") {
    if (task.type === "configuration.apply" || task.type === "configuration.rollback") deploymentProgressSchema.parse(body.result);
    if (task.type === "agent.upgrade") agentUpgradeResultSchema.parse(body.result);
    nextState = body.event;
    set.completedAt = now;
    set.result = ensureBounded(body.result ?? {});
    set.resultSummary = safeTaskSummary(task.type, body.message, set.result, body.event);
    await collections.agentTaskResults.updateOne({ orgId: task.orgId, taskId: id }, { $setOnInsert: { orgId: task.orgId, taskId: id, serverId: task.serverId, projectId: task.projectId, agentId: task.agentId, state: nextState, result: set.result, completedAt: now, expiresAt: task.historyExpiresAt, createdAt: now, updatedAt: now } }, { upsert: true });
  }
  set.state = nextState;
  await collections.agentTasks.updateOne({ _id: id, orgId: server.orgId }, { $set: set, $inc: { version: 1 } });
  if (task.type === "agent.upgrade" && body.event === "progress") { const upgrade = agentUpgradeResultSchema.parse(body.result); const state = upgrade.phase === "queued" ? "queued" : upgrade.phase === "upgrading" ? "upgrading" : "validating"; await collections.agentUpgradePlans.updateOne({ orgId: task.orgId, taskId: id }, { $set: { state, updatedAt: now } }); await collections.servers.updateOne({ _id: server._id, orgId: server.orgId }, { $set: { upgradeState: state, updatedAt: now } }); }
  if (task.type === "agent.upgrade" && (body.event === "succeeded" || body.event === "failed")) { const upgrade = agentUpgradeResultSchema.parse(set.result); const state = upgrade.phase === "complete" ? "complete" : upgrade.phase === "rolled_back" ? "rolled_back" : "failed"; await collections.agentUpgradePlans.updateOne({ orgId: task.orgId, taskId: id }, { $set: { state, failureCategory: upgrade.errorCategory, rollbackState: upgrade.phase.startsWith("rollback") ? upgrade.phase : undefined, updatedAt: now } }); await collections.servers.updateOne({ _id: server._id, orgId: server.orgId }, { $set: { upgradeState: state, updatedAt: now } }); }
  invalidateOperationalContext(server._id.toHexString());
  if (task.projectId) invalidateOperationalContext(task.projectId.toHexString());
  const deployment = task.type === "configuration.apply" || task.type === "configuration.rollback" ? deploymentProgressSchema.safeParse(set.result) : undefined;
  return { status: 200, body: { ok: true }, auditMetadata: deployment?.success ? { phase: deployment.data.phase, deploymentErrorCategory: deployment.data.deploymentErrorCategory || "none", rollbackErrorCategory: deployment.data.rollbackErrorCategory || "none" } : undefined };
}

export const createTaskSchema = z.object({
  serverId: z.string(),
  projectId: z.string().optional(),
  type: z.enum(taskTypes),
  payload: taskPayloadSchema.optional(),
  idempotencyKey: z.string().min(8).max(160).optional(),
  expiresInSeconds: z.number().int().min(30).max(3600).default(600)
});




