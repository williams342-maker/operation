import { ObjectId } from "mongodb";
import { collections } from "./db.js";

export const CREDIT_UNIT = Object.freeze({ version: "usd-micros-v1", currency: "USD", microsPerCredit: 1_000 });
export const DEFAULT_WARNING_THRESHOLDS = [50, 75, 90, 100] as const;
export const MAX_CREDITS = Number.MAX_SAFE_INTEGER;

export class CreditBlockedError extends Error {
  constructor(public code: string, message: string, public status = 409) { super(message); }
}

export function checkedCredits(value: number, field = "credits") {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_CREDITS) throw new CreditBlockedError("invalid_credit_value", `${field} must be a non-negative safe integer`, 400);
  return value;
}

export function microsToCredits(micros: number) {
  if (!Number.isSafeInteger(micros) || micros < 0) throw new CreditBlockedError("invalid_cost", "Cost must be a non-negative safe integer", 400);
  return Math.ceil(micros / CREDIT_UNIT.microsPerCredit);
}

export function estimatePrice(inputUnits: number, outputUnits: number, price: { inputCostMicrosPerMillion: number; outputCostMicrosPerMillion: number }) {
  checkedCredits(inputUnits, "inputUnits"); checkedCredits(outputUnits, "outputUnits");
  const micros = Math.ceil(inputUnits * price.inputCostMicrosPerMillion / 1_000_000) + Math.ceil(outputUnits * price.outputCostMicrosPerMillion / 1_000_000);
  if (!Number.isSafeInteger(micros)) throw new CreditBlockedError("estimate_overflow", "Estimated cost is too large", 400);
  return { estimatedCostMicros: micros, estimatedCredits: microsToCredits(micros) };
}

export function periodBounds(now: Date, timezone: string, period: "day" | "month") {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const y = get("year"), m = get("month"), d = period === "day" ? get("day") : 1;
  const offsetAt = (date: Date) => {
    const zoned = new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "longOffset" }).formatToParts(date).find((p) => p.type === "timeZoneName")?.value || "GMT+00:00";
    const match = zoned.match(/GMT([+-])(\d{2}):(\d{2})/); if (!match) return 0;
    return (match[1] === "+" ? 1 : -1) * (Number(match[2]) * 60 + Number(match[3]));
  };
  const localToUtc = (year: number, month: number, day: number) => { const rough = new Date(Date.UTC(year, month - 1, day)); return new Date(rough.getTime() - offsetAt(rough) * 60_000); };
  const start = localToUtc(y, m, d); const end = period === "day" ? localToUtc(y, m, d + 1) : localToUtc(y, m + 1, 1);
  return { start, end, key: period === "day" ? `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}` : `${y}-${String(m).padStart(2,"0")}` };
}

async function accountFor(orgId: ObjectId) {
  const account = await collections.creditAccounts.findOne({ orgId });
  if (!account) throw new CreditBlockedError("paid_ai_not_configured", "Paid AI is not configured for this organization");
  return account;
}

export async function recordDeterministicUsage(input: { orgId: ObjectId; userId: ObjectId; idempotencyKey: string; operationType: string; projectId?: ObjectId; workflowId?: ObjectId }) {
  const now = new Date();
  await collections.creditUsageRequests.updateOne({ orgId: input.orgId, idempotencyKey: input.idempotencyKey }, { $setOnInsert: { ...input, provider: "deterministic", model: "deterministic-v1", status: "succeeded", estimatedInputUnits: 0, estimatedOutputUnits: 0, estimatedCredits: 0, reservedCredits: 0, actualCredits: 0, estimatedCostMicros: 0, actualCostMicros: 0, currency: CREDIT_UNIT.currency, startedAt: now, completedAt: now } }, { upsert: true });
}

export async function evaluateAndReserve(input: { orgId: ObjectId; userId: ObjectId; idempotencyKey: string; provider: string; model: string; operationType: string; estimatedCredits: number; estimatedCostMicros: number; estimatedInputUnits: number; estimatedOutputUnits: number; pricingVersion: string; projectId?: ObjectId; workflowId?: ObjectId }) {
  checkedCredits(input.estimatedCredits, "estimatedCredits");
  const existing = await collections.creditUsageRequests.findOne({ orgId: input.orgId, idempotencyKey: input.idempotencyKey });
  if (existing) return existing;
  const account = await accountFor(input.orgId);
  if (account.status !== "active") throw new CreditBlockedError("ai_temporarily_paused", `Paid AI account is ${account.status}`);
  const control = await collections.creditEmergencyControls.findOne({ orgId: input.orgId });
  if (!control || !control.globalAiEnabled || !control.organizationAiEnabled) throw new CreditBlockedError("ai_temporarily_paused", "Paid AI is temporarily paused");
  if (control.providerEnabled[input.provider] === false) throw new CreditBlockedError("provider_disabled", "Provider is disabled");
  if (control.modelEnabled[`${input.provider}/${input.model}`] === false) throw new CreditBlockedError("model_disabled", "Model is disabled");
  if (input.projectId && control.projectEnabled[input.projectId.toHexString()] === false) throw new CreditBlockedError("project_paused", "Project AI is paused");
  const policies = await collections.creditBudgetPolicies.find({ orgId: input.orgId, enabled: true }).toArray();
  const perRequest = policies.filter((p) => p.policyType === "per_request" && (!p.provider || p.provider === input.provider) && (!p.model || p.model === input.model));
  const ceiling = perRequest.length ? Math.min(...perRequest.map((p) => p.limitCredits)) : undefined;
  if (ceiling !== undefined && input.estimatedCredits > ceiling) throw new CreditBlockedError("per_request_limit_exceeded", "Request exceeds the per-request limit");
  const org = await collections.organizations.findOne({ _id: input.orgId }); const timezone = org?.defaultTimezone || "America/Los_Angeles";
  for (const policy of policies.filter((p) => p.policyType !== "per_request")) {
    if (policy.projectId && (!input.projectId || !policy.projectId.equals(input.projectId))) continue;
    if (policy.userId && !policy.userId.equals(input.userId)) continue;
    if (policy.provider && policy.provider !== input.provider) continue;
    if (policy.model && policy.model !== input.model) continue;
    const requestFilter: any = { orgId: input.orgId, status: { $in: ["reserved", "running", "succeeded", "reconciled", "unknown"] } };
    if (policy.projectId) requestFilter.projectId = policy.projectId; if (policy.userId) requestFilter.userId = policy.userId; if (policy.provider || policy.policyType.startsWith("provider_")) requestFilter.provider = policy.provider || input.provider; if (policy.model) requestFilter.model = policy.model;
    if (policy.period === "day" || policy.period === "month") { const bounds = periodBounds(new Date(), timezone, policy.period); requestFilter.startedAt = { $gte: bounds.start, $lt: bounds.end }; }
    const totals = await collections.creditUsageRequests.aggregate([{ $match: requestFilter }, { $group: { _id: null, used: { $sum: { $ifNull: ["$actualCredits", 0] } }, reserved: { $sum: { $cond: [{ $in: ["$status", ["reserved", "running", "unknown"]] }, "$reservedCredits", 0] } } } }]).toArray();
    const committed = (totals[0]?.used || 0) + (totals[0]?.reserved || 0);
    if (policy.hardLimit && committed + input.estimatedCredits > policy.limitCredits) {
      const code = policy.policyType === "per_project" ? "project_budget_reached" : policy.policyType.includes("daily") ? "daily_budget_reached" : policy.policyType.includes("monthly") ? "monthly_budget_reached" : "budget_reached";
      throw new CreditBlockedError(code, policy.policyType === "per_project" ? "Project budget reached" : policy.policyType.includes("daily") ? "Daily budget reached" : "Monthly budget reached");
    }
  }
  const now = new Date();
  const request = { ...input, status: "estimated" as const, reservedCredits: 0, currency: CREDIT_UNIT.currency, startedAt: now };
  try { await collections.creditUsageRequests.insertOne(request); } catch (error: any) { if (error?.code === 11000) return (await collections.creditUsageRequests.findOne({ orgId: input.orgId, idempotencyKey: input.idempotencyKey }))!; throw error; }
  const updated = await collections.creditAccounts.findOneAndUpdate({ _id: account._id, orgId: input.orgId, status: "active", cachedAvailableCredits: { $gte: input.estimatedCredits } }, { $inc: { cachedAvailableCredits: -input.estimatedCredits, cachedReservedCredits: input.estimatedCredits }, $set: { updatedAt: now } }, { returnDocument: "after" });
  if (!updated) { await collections.creditUsageRequests.updateOne({ orgId: input.orgId, idempotencyKey: input.idempotencyKey }, { $set: { status: "failed", failedAt: now, failureCode: "insufficient_credits", failureMessage: "Insufficient credits" } }); throw new CreditBlockedError("insufficient_credits", "Insufficient credits"); }
  const requestDoc = await collections.creditUsageRequests.findOneAndUpdate({ orgId: input.orgId, idempotencyKey: input.idempotencyKey }, { $set: { status: "reserved", reservedCredits: input.estimatedCredits } }, { returnDocument: "after" });
  try { await collections.creditLedger.insertOne({ orgId: input.orgId, creditAccountId: account._id!, projectId: input.projectId, workflowId: input.workflowId, userId: input.userId, requestId: requestDoc!._id, idempotencyKey: input.idempotencyKey, entryKey: `${input.idempotencyKey}:reservation`, provider: input.provider, model: input.model, entryType: "reservation", creditDelta: 0, reservedCreditDelta: input.estimatedCredits, estimatedCredits: input.estimatedCredits, estimatedCostMicros: input.estimatedCostMicros, currency: CREDIT_UNIT.currency, status: "posted", balanceAfter: updated.cachedAvailableCredits + updated.cachedReservedCredits, createdAt: now, createdBy: input.userId }); }
  catch (error) { await collections.creditAccounts.updateOne({ _id: account._id, orgId: input.orgId }, { $inc: { cachedAvailableCredits: input.estimatedCredits, cachedReservedCredits: -input.estimatedCredits } }); await collections.creditUsageRequests.updateOne({ _id: requestDoc!._id }, { $set: { status: "failed", failedAt: now, failureCode: "reservation_write_failed" } }); throw error; }
  return requestDoc!;
}

export async function settleUsage(orgId: ObjectId, idempotencyKey: string, actualCredits: number, actualCostMicros: number, actualInputUnits = 0, actualOutputUnits = 0, providerRequestId?: string) {
  checkedCredits(actualCredits, "actualCredits"); checkedCredits(actualCostMicros, "actualCostMicros");
  const request = await collections.creditUsageRequests.findOne({ orgId, idempotencyKey });
  if (!request) throw new CreditBlockedError("request_not_found", "Usage request not found", 404);
  if (["succeeded", "reconciled"].includes(request.status)) return request;
  if (request.status !== "reserved" && request.status !== "running" && request.status !== "unknown") throw new CreditBlockedError("request_not_reserved", "Usage request is not reservable");
  const account = await accountFor(orgId); const release = request.reservedCredits - actualCredits; const now = new Date();
  const updated = await collections.creditAccounts.findOneAndUpdate({ _id: account._id, orgId, cachedReservedCredits: { $gte: request.reservedCredits } }, { $inc: { cachedReservedCredits: -request.reservedCredits, cachedAvailableCredits: release }, $set: { updatedAt: now, ...(release < 0 ? { status: "blocked", reviewReason: "actual_usage_exceeded_reservation" } : {}) } }, { returnDocument: "after" });
  if (!updated) throw new CreditBlockedError("settlement_conflict", "Settlement could not be applied", 409);
  await collections.creditLedger.insertMany([
    { orgId, creditAccountId: account._id!, projectId: request.projectId, workflowId: request.workflowId, userId: request.userId, requestId: request._id, idempotencyKey, entryKey: `${idempotencyKey}:usage`, provider: request.provider, model: request.model, entryType: "usage", creditDelta: -actualCredits, reservedCreditDelta: 0, estimatedCredits: request.estimatedCredits, actualCredits, estimatedCostMicros: request.estimatedCostMicros, actualCostMicros, currency: request.currency, status: "posted", balanceAfter: updated.cachedAvailableCredits + updated.cachedReservedCredits, createdAt: now, settledAt: now, createdBy: "system" },
    { orgId, creditAccountId: account._id!, projectId: request.projectId, workflowId: request.workflowId, userId: request.userId, requestId: request._id, idempotencyKey, entryKey: `${idempotencyKey}:release`, provider: request.provider, model: request.model, entryType: "reservation_release", creditDelta: 0, reservedCreditDelta: -request.reservedCredits, estimatedCredits: request.estimatedCredits, actualCredits, currency: request.currency, status: "posted", createdAt: now, settledAt: now, createdBy: "system", metadata: { unusedCreditsReleased: Math.max(0, release), estimationVariance: actualCredits - request.estimatedCredits } }
  ], { ordered: true });
  return collections.creditUsageRequests.findOneAndUpdate({ _id: request._id, orgId }, { $set: { status: release < 0 ? "reconciled" : "succeeded", actualCredits, actualCostMicros, actualInputUnits, actualOutputUnits, providerRequestId, completedAt: now } }, { returnDocument: "after" });
}

export async function failUsage(orgId: ObjectId, idempotencyKey: string, failureCode: string, failureMessage: string, billingUnknown = false) {
  const request = await collections.creditUsageRequests.findOne({ orgId, idempotencyKey }); if (!request) return null;
  if (billingUnknown) return collections.creditUsageRequests.findOneAndUpdate({ _id: request._id }, { $set: { status: "unknown", failureCode, failureMessage } }, { returnDocument: "after" });
  if (request.reservedCredits > 0 && ["reserved", "running"].includes(request.status)) {
    const account = await accountFor(orgId); const now = new Date();
    await collections.creditAccounts.updateOne({ _id: account._id, orgId, cachedReservedCredits: { $gte: request.reservedCredits } }, { $inc: { cachedReservedCredits: -request.reservedCredits, cachedAvailableCredits: request.reservedCredits }, $set: { updatedAt: now } });
    await collections.creditLedger.updateOne({ orgId, entryKey: `${idempotencyKey}:failure-release` }, { $setOnInsert: { orgId, creditAccountId: account._id!, requestId: request._id, userId: request.userId, idempotencyKey, entryKey: `${idempotencyKey}:failure-release`, provider: request.provider, model: request.model, entryType: "reservation_release", creditDelta: 0, reservedCreditDelta: -request.reservedCredits, currency: request.currency, status: "posted", reason: failureCode, createdAt: now, createdBy: "system" } }, { upsert: true });
  }
  return collections.creditUsageRequests.findOneAndUpdate({ _id: request._id }, { $set: { status: "failed", failedAt: new Date(), failureCode, failureMessage } }, { returnDocument: "after" });
}
