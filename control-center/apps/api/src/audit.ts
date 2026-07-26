import type { ObjectId } from "mongodb";
import type { AuditAction, AuditResult } from "@control-center/shared";
import { collections } from "./db.js";
import { invalidateOperationalContext } from "./aiContextBuilder.js";

function isSensitiveKey(key: string) {
  return /secret|token|password|credential|key|signature|cookie|authorization|auth|mongo|uri|url/i.test(key);
}

function redactValue(value: string | number | boolean | null) {
  if (typeof value !== "string") return value;
  if (/mongodb(\+srv)?:\/\//i.test(value)) return "[redacted]";
  if (/bearer\s+/i.test(value)) return "[redacted]";
  if (value.length > 80 && /^[A-Za-z0-9._~+/=-]+$/.test(value)) return "[redacted]";
  return value;
}

export async function audit(input: {
  orgId?: ObjectId;
  actorType: "user" | "agent" | "system" | "anonymous";
  actorId?: ObjectId | string;
  action: AuditAction;
  targetType?: string;
  targetId?: ObjectId | string;
  result: AuditResult;
  requestId: string;
  dedupeKey?: string;
  metadata?: Record<string, string | number | boolean | null>;
}) {
  const safeMetadata: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(input.metadata || {})) {
    if (isSensitiveKey(key)) continue;
    safeMetadata[key] = redactValue(value);
  }
  try {
    const result = await collections.auditEvents.insertOne({
      ...input,
      metadata: safeMetadata,
      createdAt: new Date()
    });
    if (/^(health-check|mongo-check|task\.complete|ai\.settings|deployment|rollback)/.test(input.action)) invalidateOperationalContext();
    return result.insertedId;
  } catch (error) {
    if (input.dedupeKey && (error as { code?: number }).code === 11000) return;
    throw error;
  }
}
