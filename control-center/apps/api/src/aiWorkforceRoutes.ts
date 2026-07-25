import express from "express";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { audit } from "./audit.js";
import { noStore, requirePermission } from "./auth.js";
import { aiAssistantConfig } from "./aiAssistant.js";
import { collections } from "./db.js";
import { effectiveAiSettings } from "./aiOperations.js";
import { roleAcceptsResource, routeWorkforceRole } from "./aiWorkforce.js";

export const aiWorkforceRouter = express.Router();
const resourceType = z.enum(["server", "project", "seo_audit", "website_workflow"]);
async function resourceExists(orgId: ObjectId, type: z.infer<typeof resourceType>, id: ObjectId) {
  if (type === "server") return Boolean(await collections.servers.findOne({ _id: id, orgId, archivedAt: { $exists: false } }, { projection: { _id: 1 } }));
  if (type === "project") return Boolean(await collections.projects.findOne({ _id: id, orgId, archivedAt: { $exists: false } }, { projection: { _id: 1 } }));
  if (type === "seo_audit") return Boolean(await collections.seoAudits.findOne({ _id: id, orgId }, { projection: { _id: 1 } }));
  return Boolean(await collections.websiteBuildWorkflows.findOne({ _id: id, orgId }, { projection: { _id: 1 } }));
}

aiWorkforceRouter.get("/ai-workforce/runs", noStore, requirePermission("ai:use"), async (req, res, next) => {
  try { res.json({ runs: await collections.aiWorkforceRuns.find({ orgId: req.orgId! }).sort({ createdAt: -1 }).limit(100).toArray() }); } catch (error) { next(error); }
});

aiWorkforceRouter.post("/ai-workforce/runs", noStore, requirePermission("ai:use"), async (req, res, next) => {
  try {
    const body = z.object({ roleId: z.string().min(1).max(80), resourceType, resourceId: z.string().refine(ObjectId.isValid) }).strict().parse(req.body);
    if (!roleAcceptsResource(body.roleId, body.resourceType)) return res.status(400).json({ error: "Role cannot process this resource type", code: "incompatible_workforce_resource" });
    const id = new ObjectId(body.resourceId); if (!await resourceExists(req.orgId!, body.resourceType, id)) return res.status(404).json({ error: "Resource not found" });
    const org = await collections.organizations.findOne({ _id: req.orgId! }); const config = aiAssistantConfig(); const settings = org ? effectiveAiSettings(org) : null;
    if (!config.enabled || !settings?.enabled) return res.status(503).json({ error: "AI Workforce is disabled", code: "workforce_disabled" });
    const route = routeWorkforceRole(body.roleId, config.allowedProviders, config.allowedModels); if (!route) return res.status(409).json({ error: "No configured route for this role", code: "workforce_route_unavailable" });
    const now = new Date(); const result = await collections.aiWorkforceRuns.insertOne({ orgId: req.orgId!, createdByUserId: req.user!._id, roleId: body.roleId, resourceType: body.resourceType, resourceId: id, provider: route.provider, model: route.model, state: "queued", version: 1, availableAt: now, expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000), createdAt: now, updatedAt: now });
    await audit({ orgId: req.orgId, actorType: "user", actorId: req.user!._id, action: "ai.workforce.run.create", targetType: "ai_workforce_run", targetId: result.insertedId, result: "success", requestId: req.requestId, metadata: { roleId: body.roleId, resourceType: body.resourceType, provider: route.provider, model: route.model } });
    res.status(201).json({ run: await collections.aiWorkforceRuns.findOne({ _id: result.insertedId, orgId: req.orgId! }) });
  } catch (error) { next(error); }
});

aiWorkforceRouter.post("/ai-workforce/runs/:id/cancel", noStore, requirePermission("ai:use"), async (req, res, next) => {
  try { const value = String(req.params.id); if (!ObjectId.isValid(value)) return res.status(404).json({ error: "Run not found" }); const now = new Date(); const run = await collections.aiWorkforceRuns.findOneAndUpdate({ _id: new ObjectId(value), orgId: req.orgId!, state: "queued" }, { $set: { state: "cancelled", cancelledAt: now, completedAt: now, updatedAt: now }, $inc: { version: 1 } }, { returnDocument: "after" }); if (!run) return res.status(409).json({ error: "Only queued runs can be cancelled", code: "workforce_run_not_cancellable" }); await audit({ orgId: req.orgId, actorType: "user", actorId: req.user!._id, action: "ai.workforce.run.cancel", targetType: "ai_workforce_run", targetId: run._id, result: "success", requestId: req.requestId, metadata: { roleId: run.roleId } }); res.json({ run }); } catch (error) { next(error); }
});
