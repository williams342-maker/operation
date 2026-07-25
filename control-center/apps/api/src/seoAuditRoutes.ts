import express from "express";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { audit } from "./audit.js";
import { noStore, requirePermission } from "./auth.js";
import { collections } from "./db.js";
import { analyzeSeoHtml } from "./seoAudit.js";
import { fetchPublicHtml, validatePublicHealthCheckUrl } from "./urlDiscovery.js";

export const seoAuditRouter = express.Router();

seoAuditRouter.get("/seo-audits", noStore, requirePermission("status:view"), async (req, res, next) => {
  try { res.json({ audits: await collections.seoAudits.find({ orgId: req.orgId! }).sort({ createdAt: -1 }).limit(50).toArray() }); } catch (error) { next(error); }
});

seoAuditRouter.post("/seo-audits", noStore, requirePermission("projects:manage"), async (req, res, next) => {
  try {
    const body = z.object({ url: z.string().trim().url().max(2048).optional(), projectId: z.string().refine(ObjectId.isValid).optional() }).refine((v) => v.url || v.projectId, "URL or project is required").parse(req.body);
    let serverId: ObjectId | undefined; let projectId: ObjectId | undefined; let target = body.url;
    if (body.projectId) {
      projectId = new ObjectId(body.projectId); const project = await collections.projects.findOne({ _id: projectId, orgId: req.orgId!, archivedAt: { $exists: false } });
      if (!project) return res.status(404).json({ error: "Project not found" });
      serverId = project.primaryServerId; const server = await collections.servers.findOne({ _id: serverId, orgId: req.orgId!, archivedAt: { $exists: false } });
      if (!server?.primaryUrl) return res.status(409).json({ error: "Project server has no public URL" }); target = server.primaryUrl;
    }
    const requestedUrl = await validatePublicHealthCheckUrl(target!); const fetched = await fetchPublicHtml(requestedUrl);
    const analysis = analyzeSeoHtml(fetched.text, fetched.response.status); const now = new Date();
    const result = await collections.seoAudits.insertOne({ orgId: req.orgId!, createdByUserId: req.user!._id, projectId, serverId, requestedUrl, finalUrl: fetched.finalUrl, httpStatus: fetched.response.status, ...analysis, createdAt: now, updatedAt: now });
    await audit({ orgId: req.orgId, actorType: "user", actorId: req.user!._id, action: "seo.audit.create", targetType: "seo_audit", targetId: result.insertedId, result: "success", requestId: req.requestId, metadata: { score: analysis.score, projectScoped: !!projectId } });
    res.status(201).json({ audit: await collections.seoAudits.findOne({ _id: result.insertedId, orgId: req.orgId! }) });
  } catch (error) { next(error); }
});
