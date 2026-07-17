import crypto from "node:crypto";
import { z } from "zod";
import { sha256, timingSafeEqualHex } from "./signing.js";

export const taskProtocolVersion = "task-v1";
export const taskStates = ["queued", "claimed", "running", "succeeded", "failed", "expired", "cancelled"] as const;
export const taskTypes = ["collect.system", "inspect.docker", "inspect.compose", "inspect.git", "check.http", "check.mongo", "collect.telemetry"] as const;

export const taskPayloadSchema = z.object({
  projects: z.array(z.object({ projectId: z.string(), repoPath: z.string().optional(), composePath: z.string().optional() })).default([]),
  httpHealthChecks: z.array(z.object({ id: z.string(), url: z.string().url(), timeoutMs: z.number().int().min(100).max(30000) })).default([]),
  mongoChecks: z.array(z.object({ id: z.string(), databaseNameHint: z.string().optional() })).default([])
}).default({});

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
});

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

export function isTaskExpired(expiresAt: string, now = Date.now()) {
  const parsed = Date.parse(expiresAt);
  return !Number.isFinite(parsed) || parsed <= now;
}
