import express from "express";
import rateLimit from "express-rate-limit";
import { ObjectId } from "mongodb";
import { seoAuditRequestSchema } from "@control-center/shared";
import { audit } from "./audit.js";
import { noStore, requirePermission } from "./auth.js";
import { collections } from "./db.js";
import type { SeoAuditDoc } from "./models.js";
import { runSeoAudit } from "./seoAudit.js";

export const seoRouter = express.Router();
const scanLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: true, legacyHeaders: false });
const live = { archivedAt: { $exists: false } };

const responseAudit = (item: SeoAuditDoc) => ({
  id: item._id?.toHexString(), revision: item.revision, targetUrl: item.targetUrl, finalUrl: item.finalUrl,
  keywords: item.keywords, score: item.score, categoryScores: item.categoryScores, evidence: item.evidence,
  findings: item.findings, pages: item.pages || [], crawl: item.crawl || null, createdAt: item.createdAt.toISOString()
});

async function context(orgId: ObjectId, rawId: string) {
  if (!ObjectId.isValid(rawId)) return null;
  const projectId = new ObjectId(rawId);
  const project = await collections.projects.findOne({ _id: projectId, orgId, ...live }, { projection: { name: 1, slug: 1, primaryServerId: 1 } });
  if (!project?._id) return null;
  const [check, server] = await Promise.all([
    collections.healthChecks.findOne({ orgId, projectId, enabled: true, ...live }, { sort: { _id: 1 }, projection: { url: 1, name: 1 } }),
    collections.servers.findOne({ _id: project.primaryServerId, orgId, ...live }, { projection: { primaryUrl: 1 } })
  ]);
  const targetUrl = server?.primaryUrl || (check?.url ? new URL("/", check.url).toString() : undefined);
  return { projectId, project, targetUrl, targetSource: server?.primaryUrl ? "server-primary-url" : check ? `health-check-origin:${check.name}` : null };
}

seoRouter.get("/projects/:id/seo", noStore, requirePermission("seo:view"), async (req, res, next) => {
  try {
    if (!req.orgId) return res.status(404).json({ error: "Project not found" });
    const found = await context(req.orgId, String(req.params.id));
    if (!found) return res.status(404).json({ error: "Project not found" });
    const audits = await collections.seoAudits.find({ orgId: req.orgId, projectId: found.projectId }).sort({ revision: -1 }).limit(20).toArray();
    res.json({
      project: { id: found.projectId.toHexString(), name: found.project.name, slug: found.project.slug },
      target: found.targetUrl ? { available: true, url: found.targetUrl, source: found.targetSource } : { available: false, url: null, source: null },
      audit: audits[0] ? responseAudit(audits[0]) : null,
      history: audits.map((item) => ({ id: item._id?.toHexString(), revision: item.revision, score: item.score, createdAt: item.createdAt.toISOString() })),
      capabilities: { readOnlyScan: true, multiPageCrawl: true, maximumPages: 25, automaticChanges: false, keywordResearch: false, coreWebVitals: false },
      boundary: "SEO audits collect bounded public-page evidence only. They never modify content, deploy, publish, change DNS, or bypass release approval."
    });
  } catch (error) { next(error); }
});

seoRouter.post("/projects/:id/seo/audits", noStore, scanLimiter, requirePermission("seo:scan"), async (req, res, next) => {
  try {
    if (!req.orgId || !req.user) return res.status(404).json({ error: "Project not found" });
    const body = seoAuditRequestSchema.parse(req.body);
    const found = await context(req.orgId, String(req.params.id));
    if (!found) return res.status(404).json({ error: "Project not found" });
    if (!found.targetUrl) return res.status(409).json({ error: "Register an enabled public HTTP health check or server primary URL before scanning", code: "seo_target_unavailable" });
    const result = await runSeoAudit(found.targetUrl, body.keywords, body.maxPages);
    const latest = await collections.seoAudits.findOne({ orgId: req.orgId, projectId: found.projectId }, { sort: { revision: -1 }, projection: { revision: 1 } });
    const now = new Date();
    let inserted;
    try { inserted = await collections.seoAudits.insertOne({ orgId: req.orgId, projectId: found.projectId, revision: (latest?.revision || 0) + 1, targetUrl: found.targetUrl, finalUrl: result.evidence.finalUrl, keywords: body.keywords, score: result.score, categoryScores: result.categoryScores, evidence: { ...result.evidence }, findings: result.findings, pages: result.pages, crawl: result.crawl, createdByUserId: req.user._id, createdAt: now, updatedAt: now }); }
    catch (error) { if ((error as { code?: number }).code === 11000) return res.status(409).json({ error: "Another audit completed concurrently. Run the audit again.", code: "seo_revision_conflict" }); throw error; }
    const item = await collections.seoAudits.findOne({ _id: inserted.insertedId, orgId: req.orgId });
    if (!item) throw new Error("SEO audit result was not saved");
    await audit({ orgId: req.orgId, actorType: "user", actorId: req.user._id, action: "seo.audit.run", targetType: "seo-audit", targetId: inserted.insertedId, result: "success", requestId: req.requestId, metadata: { projectId: found.projectId.toHexString(), revision: item.revision, score: item.score, pagesAudited: item.crawl?.pagesAudited || 1, targetSource: found.targetSource || "unavailable" } });
    res.status(201).json({ audit: responseAudit(item) });
  } catch (error) {
    if (req.orgId && req.user) await audit({ orgId: req.orgId, actorType: "user", actorId: req.user._id, action: "seo.audit.failure", targetType: "project", targetId: String(req.params.id), result: "failure", requestId: req.requestId, metadata: { reason: error instanceof Error ? error.name : "scan_failed" } });
    next(error);
  }
});
