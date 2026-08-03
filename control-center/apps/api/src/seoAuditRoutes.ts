import express from "express";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { audit } from "./audit.js";
import { noStore, requirePermission } from "./auth.js";
import { collections } from "./db.js";
import { analyzeSeoHtml, extractSameOriginLinks, siteFindings } from "./seoAudit.js";
import { fetchPublicHtml, validatePublicHealthCheckUrl } from "./urlDiscovery.js";

export const seoAuditRouter = express.Router();

seoAuditRouter.get("/seo-audits", noStore, requirePermission("status:view"), async (req, res, next) => {
  try { res.json({ audits: await collections.seoAudits.find({ orgId: req.orgId! }).sort({ createdAt: -1 }).limit(50).toArray() }); } catch (error) { next(error); }
});

seoAuditRouter.post("/seo-audits", noStore, requirePermission("projects:manage"), async (req, res, next) => {
  try {
    const body = z.object({ url: z.string().trim().url().max(2048).optional(), projectId: z.string().refine(ObjectId.isValid).optional(), pageLimit: z.number().int().min(1).max(10).default(10) }).refine((v) => v.url || v.projectId, "URL or project is required").parse(req.body);
    let serverId: ObjectId | undefined; let projectId: ObjectId | undefined; let target = body.url;
    if (body.projectId) {
      projectId = new ObjectId(body.projectId); const project = await collections.projects.findOne({ _id: projectId, orgId: req.orgId!, archivedAt: { $exists: false } });
      if (!project) return res.status(404).json({ error: "Project not found" });
      serverId = project.primaryServerId; const server = await collections.servers.findOne({ _id: serverId, orgId: req.orgId!, archivedAt: { $exists: false } });
      if (!server?.primaryUrl) return res.status(409).json({ error: "Project server has no public URL" }); target = server.primaryUrl;
    }
    const requestedUrl = await validatePublicHealthCheckUrl(target!); const origin = new URL(requestedUrl).origin; const queue = [requestedUrl]; const discovered = new Set(queue); const pages = [];
    try {
      const sitemap = await fetchPublicHtml(`${origin}/sitemap.xml`);
      for (const match of sitemap.text.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)) { const link = new URL(match[1].trim(), origin); if (link.origin === origin && !discovered.has(link.toString()) && discovered.size < 50) { discovered.add(link.toString()); queue.push(link.toString()); } }
    } catch { /* sitemap discovery is optional */ }
    while (queue.length && pages.length < body.pageLimit) {
      const url = queue.shift()!;
      try {
        const fetched = await fetchPublicHtml(url); const analysis = analyzeSeoHtml(fetched.text, fetched.response.status);
        pages.push({ url: fetched.finalUrl, httpStatus: fetched.response.status, ...analysis });
        for (const link of extractSameOriginLinks(fetched.text, fetched.finalUrl)) if (new URL(link).origin === origin && !discovered.has(link) && discovered.size < 50) { discovered.add(link); queue.push(link); }
      } catch { pages.push({ url, httpStatus: 0, ...analyzeSeoHtml("", 0) }); }
    }
    const first = pages[0]; const aggregate = siteFindings(pages); const score = Math.round(pages.reduce((sum, page) => sum + page.score, 0) / pages.length) - aggregate.filter((item) => item.severity !== "pass").length * 3; const now = new Date();
    const result = await collections.seoAudits.insertOne({ orgId: req.orgId!, createdByUserId: req.user!._id, projectId, serverId, requestedUrl, finalUrl: first.url, httpStatus: first.httpStatus, score: Math.max(0, score), findings: aggregate, pageTitle: first.pageTitle, metaDescription: first.metaDescription, pages, pagesCrawled: pages.length, pagesDiscovered: discovered.size, createdAt: now, updatedAt: now });
    await audit({ orgId: req.orgId, actorType: "user", actorId: req.user!._id, action: "seo.audit.create", targetType: "seo_audit", targetId: result.insertedId, result: "success", requestId: req.requestId, metadata: { score: Math.max(0, score), projectScoped: !!projectId, pagesCrawled: pages.length } });
    res.status(201).json({ audit: await collections.seoAudits.findOne({ _id: result.insertedId, orgId: req.orgId! }) });
  } catch (error) { next(error); }
});
