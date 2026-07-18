import type { ObjectId } from "mongodb";
import type { AiUsageDoc, OrganizationDoc } from "./models.js";
import { collections } from "./db.js";

export const defaultAiSettings = () => ({ enabled: false, maximumRequestsPerUserPerHour: 20, maximumRequestsPerOrganizationPerDay: 200, maximumConcurrentRequests: 3, allowedScopeTypes: ["server", "application"] as Array<"server" | "application">, dataRetentionMode: "provider-dependent" as const });
export function effectiveAiSettings(org: OrganizationDoc) { return { ...defaultAiSettings(), ...org.aiAssistant }; }
const startHour = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours()));
const startDay = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
const startMonth = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
export async function usageSummary(orgId: ObjectId, now = new Date()) { const [hour, day, month, lastSuccess, lastFailure] = await Promise.all([
  collections.aiUsage.countDocuments({ orgId, createdAt: { $gte: startHour(now) } }),
  collections.aiUsage.countDocuments({ orgId, createdAt: { $gte: startDay(now) } }),
  collections.aiUsage.aggregate<{ requests: number; tokens: number }>([{ $match: { orgId, createdAt: { $gte: startMonth(now) } } }, { $group: { _id: null, requests: { $sum: 1 }, tokens: { $sum: { $add: [{ $ifNull: ["$inputTokens", 0] }, { $ifNull: ["$outputTokens", 0] }] } } } }]).next(),
  collections.aiUsage.find({ orgId, outcome: "success" }, { projection: { createdAt: 1 } }).sort({ createdAt: -1 }).limit(1).next(),
  collections.aiUsage.find({ orgId, outcome: "failure" }, { projection: { createdAt: 1, failureCategory: 1 } }).sort({ createdAt: -1 }).limit(1).next()
]); return { organizationRequestsThisHour: hour, organizationRequestsToday: day, organizationRequestsThisMonth: month?.requests || 0, tokensThisMonth: month?.tokens || 0, lastSuccessfulRequestAt: lastSuccess?.createdAt || null, lastFailureCategory: lastFailure?.failureCategory || null }; }
export async function reserveAiUsage(input: { orgId: ObjectId; userId: ObjectId; settings: ReturnType<typeof effectiveAiSettings>; provider: string; model: string; scopeType: "server" | "application"; contextBytes: number }) {
  const now = new Date(); await collections.aiUsage.deleteMany({ orgId: input.orgId, outcome: "pending", expiresAt: { $lte: now } }); const monthStart = startMonth(now); const [userHour, orgDay, month] = await Promise.all([
    collections.aiUsage.countDocuments({ orgId: input.orgId, userId: input.userId, createdAt: { $gte: startHour(now) } }),
    collections.aiUsage.countDocuments({ orgId: input.orgId, createdAt: { $gte: startDay(now) } }),
    collections.aiUsage.aggregate<{ requests: number; tokens: number }>([{ $match: { orgId: input.orgId, createdAt: { $gte: monthStart } } }, { $group: { _id: null, requests: { $sum: 1 }, tokens: { $sum: { $add: [{ $ifNull: ["$inputTokens", 0] }, { $ifNull: ["$outputTokens", 0] }] } } } }]).next()
  ]);
  const reason = userHour >= input.settings.maximumRequestsPerUserPerHour ? "user_hourly" : orgDay >= input.settings.maximumRequestsPerOrganizationPerDay ? "organization_daily" : input.settings.monthlyRequestLimit && (month?.requests || 0) >= input.settings.monthlyRequestLimit ? "organization_monthly_requests" : input.settings.monthlyTokenLimit && (month?.tokens || 0) >= input.settings.monthlyTokenLimit ? "organization_monthly_tokens" : null;
  if (reason) return { ok: false as const, reason };
  for (let concurrencySlot = 0; concurrencySlot < input.settings.maximumConcurrentRequests; concurrencySlot++) { try { const doc: AiUsageDoc = { orgId: input.orgId, userId: input.userId, provider: input.provider, model: input.model, scopeType: input.scopeType, contextBytes: input.contextBytes, outcome: "pending", concurrencySlot, createdAt: now, expiresAt: new Date(now.getTime() + 120_000) }; const result = await collections.aiUsage.insertOne(doc); return { ok: true as const, id: result.insertedId }; } catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === 11000)) throw error; } } return { ok: false as const, reason: "concurrent" };
}
export async function completeAiUsage(id: ObjectId, outcome: "success" | "failure", metadata: { durationMs: number; failureCategory?: string; inputTokens?: number; outputTokens?: number }) { await collections.aiUsage.updateOne({ _id: id }, { $set: { outcome, ...metadata, expiresAt: new Date(Date.now() + 400 * 86_400_000) }, $unset: { concurrencySlot: "" } }); }
