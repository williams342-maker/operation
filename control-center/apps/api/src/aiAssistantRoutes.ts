import express from "express";
import { ObjectId } from "mongodb";
import { aiAssistantRequestSchema } from "@control-center/shared";
import { audit } from "./audit.js";
import { requirePermission, noStore } from "./auth.js";
import { collections } from "./db.js";
import { aiAssistantConfig, assistantSystemPrompt, callProvider, organizationProvider, questionDigest } from "./aiAssistant.js";
import { buildAiContext, sanitizeOperationalContext } from "./aiContextBuilder.js";
import { deterministicRecommendations } from "./operationalIntelligence.js";
import { completeAiUsage, effectiveAiSettings, reserveAiUsage } from "./aiOperations.js";

export const aiAssistantRouter = express.Router();
const notArchived = { archivedAt: { $exists: false } };
function truncateContext(value: unknown, maxBytes: number) {
  const candidate = JSON.parse(JSON.stringify(value)) as Record<string, any>; let serialized = JSON.stringify(candidate);
  if (Buffer.byteLength(serialized) <= maxBytes) return { serialized, truncated: false };
  for (const key of ["timeline", "relatedIncidents", "evidence", "likelyCauses", "recommendedSteps"] as const) {
    const rows = candidate[key]; if (!Array.isArray(rows)) continue;
    while (rows.length && Buffer.byteLength(serialized) > maxBytes) { rows.pop(); serialized = JSON.stringify(candidate); }
  }
  if (Buffer.byteLength(serialized) > maxBytes && Array.isArray(candidate.snapshot?.sections)) { while (candidate.snapshot.sections.length && Buffer.byteLength(serialized) > maxBytes) { candidate.snapshot.sections.pop(); serialized = JSON.stringify(candidate); } }
  if (Buffer.byteLength(serialized) > maxBytes) serialized = JSON.stringify({ warning: "Structured context exceeded the configured byte limit", snapshot: { scope: candidate.snapshot?.scope, rejectedSections: candidate.snapshot?.rejectedSections || [] }, evidence: [] });
  return { serialized, truncated: true };
}

aiAssistantRouter.get("/ai-assistant/status", noStore, requirePermission("ai:use"), async (req, res) => { const config = aiAssistantConfig(); const org = await collections.organizations.findOne({ _id: req.orgId! }); const settings = org ? effectiveAiSettings(org) : null; const provider = settings ? organizationProvider(config, settings.provider, settings.model) : null; res.json({ enabled: Boolean(config.enabled && settings?.enabled), globalEnabled: config.enabled, organizationEnabled: Boolean(settings?.enabled), configured: Boolean(provider), provider: settings?.provider || null, model: settings?.model || null, readOnly: true }); });

aiAssistantRouter.post("/ai-assistant/analyze", noStore, requirePermission("ai:use"), async (req, res) => {
  const started = Date.now(); const config = aiAssistantConfig(); let provider; let usageId: ObjectId | undefined; let scopeType = "unknown"; let scopeId = "unknown"; let categories: string[] = []; let bytes = 0; let redactions: Record<string, number> = {};
  try {
    if (!config.enabled) { if (req.orgId && req.user) await audit({ orgId: req.orgId, actorType: "user", actorId: req.user._id, action: "ai.assistant.failure", targetType: "assistant", result: "failure", requestId: req.requestId, metadata: { reason: "disabled" } }); return res.status(503).json({ error: "AI Assistant is disabled", code: "assistant_disabled" }); }
    const org = req.orgId ? await collections.organizations.findOne({ _id: req.orgId }) : null; const settings = org ? effectiveAiSettings(org) : null;
    if (!settings?.enabled) return res.status(503).json({ error: "AI Assistant is disabled for this organization", code: "organization_assistant_disabled" });
    provider = organizationProvider(config, settings.provider, settings.model);
    if (!provider) { if (req.orgId && req.user) await audit({ orgId: req.orgId, actorType: "user", actorId: req.user._id, action: "ai.assistant.failure", targetType: "assistant", result: "failure", requestId: req.requestId, metadata: { reason: "unconfigured" } }); return res.status(503).json({ error: "AI Assistant provider is not configured", code: "assistant_unconfigured" }); }
    const body = aiAssistantRequestSchema.parse(req.body); scopeType = body.scope.type; scopeId = body.scope.id;
    if (!req.orgId || !req.user || !ObjectId.isValid(scopeId)) return res.status(404).json({ error: "Resource not found", code: "resource_not_found" });
    if (!settings.allowedScopeTypes.includes(scopeType as "server" | "application")) return res.status(403).json({ error: "AI analysis is not allowed for this resource type", code: "scope_not_allowed" });
    let server; let project;
    if (scopeType === "server") server = await collections.servers.findOne({ _id: new ObjectId(scopeId), orgId: req.orgId, ...notArchived }, { projection: { agentSecretHash: 0, metadata: 0 } });
    else { project = await collections.projects.findOne({ _id: new ObjectId(scopeId), orgId: req.orgId, ...notArchived }); if (project) server = await collections.servers.findOne({ _id: project.primaryServerId, orgId: req.orgId, ...notArchived }, { projection: { agentSecretHash: 0, metadata: 0 } }); }
    if (!server || (scopeType === "application" && !project)) { await audit({ orgId: req.orgId, actorType: "user", actorId: req.user._id, action: "ai.assistant.failure", targetType: scopeType, result: "denied", requestId: req.requestId, metadata: { reason: "resource-not-found" } }); return res.status(404).json({ error: "Resource not found", code: "resource_not_found" }); }
    const intelligence = await buildAiContext({ orgId: req.orgId, userId: req.user._id, scopeType: scopeType as "server" | "application", scopeId, server, project: project || undefined, options: body.contextOptions });
    const recommendations = deterministicRecommendations(intelligence.likelyCauses, intelligence.evidence);
    const sanitized = sanitizeOperationalContext({ snapshot: intelligence.snapshot, evidence: intelligence.evidence, likelyCauses: intelligence.likelyCauses, recommendedSteps: recommendations, confidence: intelligence.confidence, timeline: intelligence.timeline, relatedIncidents: intelligence.relatedIncidents, deploymentImpact: intelligence.deploymentImpact, ciAnalysis: intelligence.ciAnalysis }); redactions = sanitized.counts;
    const bounded = truncateContext(sanitized.value, config.maxContextBytes); bytes = Buffer.byteLength(bounded.serialized); categories = intelligence.snapshot.sections.map((section) => section.key); categories.push(...intelligence.snapshot.rejectedSections.map((section) => `${section.key}_${section.reason}`)); if (bounded.truncated) categories.push("truncated");
    const reservation = await reserveAiUsage({ orgId: req.orgId, userId: req.user._id, settings, provider: provider.name, model: provider.model, scopeType: scopeType as "server" | "application", contextBytes: bytes }); if (!reservation.ok) { await audit({ orgId: req.orgId, actorType: "user", actorId: req.user._id, action: "ai.assistant.rate_limited", targetType: scopeType, targetId: scopeId, result: "denied", requestId: req.requestId, metadata: { reason: reservation.reason } }); return res.status(429).json({ error: "AI Assistant usage limit reached", code: "assistant_rate_limited", limit: reservation.reason, retryable: true }); } usageId = reservation.id;
    const question = sanitizeOperationalContext(body.question);
    const result = await callProvider(provider, { system: assistantSystemPrompt, context: bounded.serialized, question: String(question.value), maxOutputTokens: config.maxOutputTokens }, config.timeoutMs);
    const response = { ...result, confidence: intelligence.confidence, likelyCauses: intelligence.likelyCauses, recommendedSteps: recommendations, evidence: intelligence.evidence, timeline: intelligence.timeline, relatedIncidents: intelligence.relatedIncidents, generatedAt: new Date().toISOString(), executedActions: [] as never[] };
    await completeAiUsage(usageId, "success", { durationMs: Date.now() - started, inputTokens: provider.lastUsage?.inputTokens, outputTokens: provider.lastUsage?.outputTokens });
    await audit({ orgId: req.orgId, actorType: "user", actorId: req.user._id, action: "ai.assistant.analyze", targetType: scopeType, targetId: scopeId, result: "success", requestId: req.requestId, metadata: { provider: provider.name, model: provider.model, categories: categories.join(","), contextBytes: bytes, durationMs: Date.now() - started, responseStatus: result.status, redactionCount: Object.values(redactions).reduce((a, b) => a + b, 0), questionDigest: questionDigest(body.question), contextCache: intelligence.cache } });
    return res.json({ result: response, operational: { rejectedSections: intelligence.snapshot.rejectedSections, deploymentImpact: intelligence.deploymentImpact, ciAnalysis: intelligence.ciAnalysis }, metadata: { contextCategories: categories, contextBytes: bytes, redactions, contextCache: intelligence.cache, noActionsExecuted: true } });
  } catch (error) { const category = error instanceof Error && error.name === "AbortError" ? "timeout" : error instanceof Error && (error.message.startsWith("provider_") || error instanceof TypeError) ? "provider" : "invalid_response"; if (usageId) await completeAiUsage(usageId, "failure", { durationMs: Date.now() - started, failureCategory: category }); if (req.orgId && req.user) await audit({ orgId: req.orgId, actorType: "user", actorId: req.user._id, action: "ai.assistant.failure", targetType: scopeType, targetId: scopeId, result: "failure", requestId: req.requestId, metadata: { reason: category, durationMs: Date.now() - started, contextBytes: bytes, categories: categories.join(","), redactionCount: Object.values(redactions).reduce((a, b) => a + b, 0) } }); if (category === "timeout") return res.status(504).json({ error: "AI provider timed out", code: "provider_timeout" }); if (category === "provider") return res.status(502).json({ error: "AI provider request failed", code: "provider_failure" }); return res.status(502).json({ error: "AI provider returned an invalid response", code: "invalid_provider_response" }); }
});
