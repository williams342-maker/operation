import express from "express";
import { aiOrganizationSettingsUpdateSchema } from "@control-center/shared";
import { requirePermission, noStore } from "./auth.js";
import { audit } from "./audit.js";
import { collections } from "./db.js";
import { aiAssistantConfig, organizationProvider } from "./aiAssistant.js";
import { invalidateOperationalContext } from "./aiContextBuilder.js";
import { defaultAiSettings, effectiveAiSettings, usageSummary } from "./aiOperations.js";
import { providerCredential, workforceStatus } from "./aiWorkforce.js";

export const aiSettingsRouter = express.Router();
const safe = async (req: express.Request) => {
  const config = aiAssistantConfig(); const org = await collections.organizations.findOne({ _id: req.orgId! }); if (!org) return null; const settings = effectiveAiSettings(org);
  return { globalEnabled: config.enabled, settings: { ...settings, providerDataRetentionAcknowledgedBy: undefined }, allowlists: { providers: config.allowedProviders, models: config.allowedModels }, providerStatus: { configured: Boolean(organizationProvider(config, settings.provider, settings.model)), credentialPresent: Boolean(providerCredential(settings.provider || "")), provider: settings.provider || null, model: settings.model || null }, workforce: workforceStatus(config.allowedProviders, config.allowedModels), usage: await usageSummary(req.orgId!), readOnly: true, noActionsCanBeExecuted: true };
};

aiSettingsRouter.get("/org/ai-assistant", noStore, requirePermission("ai:admin"), async (req, res, next) => { try { const value = await safe(req); if (!value) return res.status(404).json({ error: "Organization not found" }); await audit({ orgId: req.orgId, actorType: "user", actorId: req.user!._id, action: "ai.settings.view", targetType: "organization", targetId: req.orgId, result: "success", requestId: req.requestId }); return res.json(value); } catch (error) { return next(error); } });

aiSettingsRouter.put("/org/ai-assistant", noStore, requirePermission("ai:admin"), async (req, res, next) => {
  try {
    const body = aiOrganizationSettingsUpdateSchema.parse(req.body); const config = aiAssistantConfig();
    if (body.provider && !config.allowedProviders.includes(body.provider)) return res.status(400).json({ error: "Provider is not allowed", code: "provider_not_allowed" });
    if (body.model && !config.allowedModels.includes(body.model)) return res.status(400).json({ error: "Model is not allowed", code: "model_not_allowed" });
    if (body.enabled && (!body.provider || !body.model)) return res.status(400).json({ error: "Provider and model are required", code: "provider_unconfigured" });
    if (body.enabled && !body.retentionAcknowledged) return res.status(400).json({ error: "Data-retention acknowledgement is required", code: "retention_acknowledgement_required" });
    const existing = await collections.organizations.findOne({ _id: req.orgId! }); if (!existing) return res.status(404).json({ error: "Organization not found" });
    const previous = effectiveAiSettings(existing); const now = new Date();
    const settings = { enabled: body.enabled, provider: body.provider || undefined, model: body.model || undefined, monthlyRequestLimit: body.monthlyRequestLimit || undefined, monthlyTokenLimit: body.monthlyTokenLimit || undefined, maximumRequestsPerUserPerHour: body.maximumRequestsPerUserPerHour, maximumRequestsPerOrganizationPerDay: body.maximumRequestsPerOrganizationPerDay, maximumConcurrentRequests: body.maximumConcurrentRequests, allowedScopeTypes: body.allowedScopeTypes, dataRetentionMode: "provider-dependent" as const, providerDataRetentionAcknowledgedAt: body.retentionAcknowledged ? previous.providerDataRetentionAcknowledgedAt || now : undefined, providerDataRetentionAcknowledgedBy: body.retentionAcknowledged ? previous.providerDataRetentionAcknowledgedBy || req.user!._id : undefined, updatedAt: now, updatedBy: req.user!._id };
    await collections.organizations.updateOne({ _id: req.orgId! }, { $set: { aiAssistant: settings, updatedAt: now } }); invalidateOperationalContext();
    const changed = [previous.provider !== settings.provider ? "provider" : "", previous.model !== settings.model ? "model" : "", previous.enabled !== settings.enabled ? "enabled" : "", "limits"].filter(Boolean).join(",");
    await audit({ orgId: req.orgId, actorType: "user", actorId: req.user!._id, action: "ai.settings.change", targetType: "organization", targetId: req.orgId, result: "success", requestId: req.requestId, metadata: { changed, enabled: settings.enabled } });
    if (previous.enabled !== settings.enabled) await audit({ orgId: req.orgId, actorType: "user", actorId: req.user!._id, action: settings.enabled ? "ai.settings.enable" : "ai.settings.disable", targetType: "organization", targetId: req.orgId, result: "success", requestId: req.requestId });
    if (!previous.providerDataRetentionAcknowledgedAt && settings.providerDataRetentionAcknowledgedAt) await audit({ orgId: req.orgId, actorType: "user", actorId: req.user!._id, action: "ai.settings.acknowledge", targetType: "organization", targetId: req.orgId, result: "success", requestId: req.requestId });
    return res.json(await safe(req));
  } catch (error) { return next(error); }
});

export { defaultAiSettings };
