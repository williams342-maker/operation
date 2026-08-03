import express from "express";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { audit } from "./audit.js";
import { requirePermission, requireRecentAuth } from "./auth.js";
import { collections } from "./db.js";
import { hashSecret, randomToken } from "./crypto.js";
import { decryptConfigurationValue, encryptConfigurationValue, valueFingerprint } from "./configurationVault.js";
import { enrollmentBootstrapScript } from "./enrollmentBootstrap.js";

export const adminEnrollmentRouter = express.Router();
adminEnrollmentRouter.use(requirePermission("servers:enroll"));

function orgId(req: express.Request) { if (!req.orgId) throw new Error("Missing organization scope"); return req.orgId; }
function actorId(req: express.Request) { if (!req.user?._id) throw new Error("Missing user"); return req.user._id; }
function id(value: unknown) { const raw = String(value || ""); if (!ObjectId.isValid(raw)) throw new Error("Invalid enrollment id"); return new ObjectId(raw); }

const generateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  expiresInMinutes: z.number().int().positive().max(43_200).nullable(),
  maxUses: z.number().int().positive().max(10_000).nullable(),
  serverId: z.string().refine(ObjectId.isValid).optional(),
  cloudflareAccessIntegrationId: z.string().refine(ObjectId.isValid).optional()
});

const cloudflareSchema = z.object({ name: z.string().trim().min(1).max(120), clientId: z.string().trim().min(1).max(500), clientSecret: z.string().min(1).max(2000) });
function integrationBinding(org: ObjectId, integration: ObjectId, field: "client-id" | "client-secret") { return `cloudflare-access:${org.toHexString()}:${integration.toHexString()}:${field}`; }
function configuredAgentRelease() {
  const revision = process.env.CONTROL_CENTER_AGENT_REVISION || "";
  const sha256 = process.env.CONTROL_CENTER_AGENT_ARCHIVE_SHA256 || "";
  if (!/^[0-9a-f]{40}$/.test(revision) || !/^[0-9a-f]{64}$/.test(sha256)) throw new Error("The staging agent release identity is not configured");
  return { revision, sha256 };
}

adminEnrollmentRouter.get("/admin/integrations/cloudflare-access", requirePermission("configuration:manage-integrations"), async (req, res, next) => {
  try {
    const docs = await collections.cloudflareAccessIntegrations.find({ orgId: orgId(req), disabledAt: { $exists: false } }, { projection: { clientIdEnvelope: 0, clientSecretEnvelope: 0 } }).sort({ createdAt: -1 }).toArray();
    res.json({ integrations: docs.map((doc) => ({ id: doc._id, name: doc.name, configured: true, clientIdFingerprint: doc.clientIdFingerprint.slice(0, 12), updatedAt: doc.updatedAt })) });
  } catch (error) { next(error); }
});

adminEnrollmentRouter.post("/admin/integrations/cloudflare-access", requirePermission("configuration:manage-integrations"), requireRecentAuth, async (req, res, next) => {
  try {
    const body = cloudflareSchema.parse(req.body); const org = orgId(req); const existing = await collections.cloudflareAccessIntegrations.findOne({ orgId: org }); const integrationId = existing?._id || new ObjectId(); const now = new Date();
    await collections.cloudflareAccessIntegrations.updateOne({ orgId: org }, { $set: { name: body.name, clientIdEnvelope: encryptConfigurationValue(body.clientId, integrationBinding(org, integrationId, "client-id")), clientSecretEnvelope: encryptConfigurationValue(body.clientSecret, integrationBinding(org, integrationId, "client-secret")), clientIdFingerprint: valueFingerprint(body.clientId, `${org}:cloudflare-client-id`), clientSecretFingerprint: valueFingerprint(body.clientSecret, `${org}:cloudflare-client-secret`), createdByUserId: actorId(req), updatedAt: now }, $setOnInsert: { _id: integrationId, orgId: org, createdAt: now }, $unset: { disabledAt: "" } }, { upsert: true });
    await audit({ orgId: org, actorType: "user", actorId: actorId(req), action: "org.update", targetType: "cloudflare_access_integration", targetId: integrationId, result: "success", requestId: req.requestId, metadata: { operation: existing ? "replace" : "create" } });
    res.status(201).json({ id: integrationId, name: body.name, configured: true });
  } catch (error) { next(error); }
});

adminEnrollmentRouter.delete("/admin/integrations/cloudflare-access/:id", requirePermission("configuration:manage-integrations"), requireRecentAuth, async (req, res, next) => {
  try {
    const integrationId = id(req.params.id);
    const result = await collections.cloudflareAccessIntegrations.deleteOne({ _id: integrationId, orgId: orgId(req) });
    if (!result.deletedCount) return res.status(404).json({ error: "Cloudflare Access integration not found" });
    await audit({ orgId: orgId(req), actorType: "user", actorId: actorId(req), action: "org.update", targetType: "cloudflare_access_integration", targetId: integrationId, result: "success", requestId: req.requestId, metadata: { operation: "disable" } });
    res.json({ ok: true });
  } catch (error) { next(error); }
});

adminEnrollmentRouter.post("/admin/enrollment/generate", requireRecentAuth, async (req, res, next) => {
  try {
    const body = generateSchema.parse(req.body);
    const token = `owenr_${randomToken(36)}`;
    const now = new Date();
    const serverId = body.serverId ? new ObjectId(body.serverId) : undefined;
    if (serverId && !await collections.servers.findOne({ _id: serverId, orgId: orgId(req), archivedAt: { $exists: false } })) return res.status(404).json({ error: "Enrollment target not found" });
    const integrationId = body.cloudflareAccessIntegrationId ? new ObjectId(body.cloudflareAccessIntegrationId) : undefined;
    if (integrationId && !await collections.cloudflareAccessIntegrations.findOne({ _id: integrationId, orgId: orgId(req), disabledAt: { $exists: false } })) return res.status(404).json({ error: "Cloudflare Access integration not found" });
    const bootstrapDownloadToken = integrationId ? `owboot_${randomToken(36)}` : undefined;
    const expiresAt = body.expiresInMinutes === null ? undefined : new Date(now.getTime() + body.expiresInMinutes * 60_000);
    const result = await collections.enrollments.insertOne({
      orgId: orgId(req), tokenHash: hashSecret(token), name: body.name, description: body.description || undefined,
      expiresAt, maxUses: body.maxUses ?? undefined, uses: 0, usage: [], createdByUserId: actorId(req), serverId, cloudflareAccessIntegrationId: integrationId, bootstrapDownloadTokenHash: bootstrapDownloadToken ? hashSecret(bootstrapDownloadToken) : undefined, createdAt: now, updatedAt: now
    });
    await audit({ orgId: orgId(req), actorType: "user", actorId: actorId(req), action: "enrollment.create", targetType: "enrollment", targetId: result.insertedId, result: "success", requestId: req.requestId, metadata: { maxUses: body.maxUses ?? "unlimited", expiresInMinutes: body.expiresInMinutes ?? "never" } });
    res.setHeader("Cache-Control", "no-store");
    res.status(201).json({ id: result.insertedId, token, name: body.name, expiresAt, maxUses: body.maxUses, bootstrapDownloadToken });
  } catch (error) { next(error); }
});

adminEnrollmentRouter.post("/admin/enrollment/bootstrap/:id", requireRecentAuth, async (req, res, next) => {
  try {
    const enrollmentId = id(req.params.id); const body = z.object({ downloadToken: z.string().min(1), enrollmentToken: z.string().min(1) }).parse(req.body); const now = new Date(); const org = orgId(req);
    const filter = { _id: enrollmentId, orgId: org, bootstrapDownloadTokenHash: hashSecret(body.downloadToken), bootstrapDownloadedAt: { $exists: false } as const, revokedAt: { $exists: false } as const, $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gt: now } }] };
    const enrollment = await collections.enrollments.findOne(filter);
    if (!enrollment?.cloudflareAccessIntegrationId) return res.status(410).json({ error: "Bootstrap download is unavailable" });
    if (enrollment.tokenHash !== hashSecret(body.enrollmentToken)) return res.status(403).json({ error: "Bootstrap credentials do not match" });
    const integration = await collections.cloudflareAccessIntegrations.findOne({ _id: enrollment.cloudflareAccessIntegrationId, orgId: org, disabledAt: { $exists: false } });
    if (!integration) return res.status(410).json({ error: "Cloudflare Access integration is unavailable" });
    const release = configuredAgentRelease();
    const script = enrollmentBootstrapScript({ controlCenterUrl: process.env.CONTROL_CENTER_PUBLIC_URL || "https://opsworkbench.org", serverSlug: enrollment.serverId ? (await collections.servers.findOne({ _id: enrollment.serverId, orgId: org }, { projection: { slug: 1 } }))?.slug : undefined, enrollmentToken: body.enrollmentToken, cloudflareClientId: decryptConfigurationValue(integration.clientIdEnvelope, integrationBinding(org, integration._id!, "client-id")), cloudflareClientSecret: decryptConfigurationValue(integration.clientSecretEnvelope, integrationBinding(org, integration._id!, "client-secret")), agentRevision: release.revision, agentArchiveSha256: release.sha256 });
    const claimed = await collections.enrollments.updateOne(filter, { $set: { bootstrapDownloadedAt: now, updatedAt: now }, $unset: { bootstrapDownloadTokenHash: "" } });
    if (claimed.modifiedCount !== 1) return res.status(410).json({ error: "Bootstrap download is unavailable" });
    await audit({ orgId: org, actorType: "user", actorId: actorId(req), action: "enrollment.download", targetType: "enrollment", targetId: enrollmentId, result: "success", requestId: req.requestId, metadata: { format: "one-time-bootstrap" } });
    res.setHeader("Cache-Control", "no-store"); res.setHeader("Content-Type", "text/x-shellscript; charset=utf-8"); res.setHeader("Content-Disposition", `attachment; filename="opsworkbench-bootstrap-${enrollmentId.toHexString().slice(-8)}.sh"`); res.send(script);
  } catch (error) { next(error); }
});

adminEnrollmentRouter.get("/admin/enrollment", async (req, res, next) => {
  try {
    const docs = await collections.enrollments.find({ orgId: orgId(req) }, { projection: { tokenHash: 0, usage: 0 } }).sort({ createdAt: -1 }).toArray();
    const userIds = [...new Set(docs.map((doc) => String(doc.createdByUserId)))].filter(ObjectId.isValid).map((value) => new ObjectId(value));
    const serverIds = [...new Set(docs.map((doc) => String(doc.serverId)).filter(ObjectId.isValid))].map((value) => new ObjectId(value));
    const [users, servers] = await Promise.all([collections.users.find({ _id: { $in: userIds }, orgId: orgId(req) }, { projection: { name: 1, email: 1 } }).toArray(), collections.servers.find({ _id: { $in: serverIds }, orgId: orgId(req) }, { projection: { name: 1, slug: 1 } }).toArray()]);
    const userMap = new Map(users.map((user) => [String(user._id), user.name || user.email]));
    const serverMap = new Map(servers.map((server) => [String(server._id), server.slug || server.name]));
    const now = Date.now();
    res.json({ enrollments: docs.map((doc) => ({ ...doc, serverName: serverMap.get(String(doc.serverId)) || "Unassigned", createdBy: userMap.get(String(doc.createdByUserId)) || "Unknown", status: doc.revokedAt ? "revoked" : doc.expiresAt && doc.expiresAt.getTime() <= now ? "expired" : doc.maxUses !== undefined && doc.uses >= doc.maxUses ? "exhausted" : "active", usesRemaining: doc.maxUses === undefined ? null : Math.max(0, doc.maxUses - doc.uses) })) });
  } catch (error) { next(error); }
});

adminEnrollmentRouter.post("/admin/enrollment/revoke", requireRecentAuth, async (req, res, next) => {
  try {
    const enrollmentId = id(req.body?.id); const now = new Date();
    const result = await collections.enrollments.updateOne({ _id: enrollmentId, orgId: orgId(req), revokedAt: { $exists: false } }, { $set: { revokedAt: now, updatedAt: now } });
    if (!result.matchedCount) return res.status(404).json({ error: "Active enrollment token not found" });
    await audit({ orgId: orgId(req), actorType: "user", actorId: actorId(req), action: "enrollment.revoke", targetType: "enrollment", targetId: enrollmentId, result: "success", requestId: req.requestId });
    res.json({ ok: true });
  } catch (error) { next(error); }
});

adminEnrollmentRouter.delete("/admin/enrollment/:id", requireRecentAuth, async (req, res, next) => {
  try {
    const enrollmentId = id(req.params.id);
    const result = await collections.enrollments.deleteOne({ _id: enrollmentId, orgId: orgId(req), $or: [{ revokedAt: { $exists: true } }, { expiresAt: { $lte: new Date() } }] });
    if (!result.deletedCount) return res.status(409).json({ error: "Revoke or expire the token before deleting it" });
    await audit({ orgId: orgId(req), actorType: "user", actorId: actorId(req), action: "enrollment.delete", targetType: "enrollment", targetId: enrollmentId, result: "success", requestId: req.requestId });
    res.json({ ok: true });
  } catch (error) { next(error); }
});

adminEnrollmentRouter.get("/admin/enrollment/download/:id", async (req, res, next) => {
  try {
    const enrollmentId = id(req.params.id);
    const exists = await collections.enrollments.findOne({ _id: enrollmentId, orgId: orgId(req) }, { projection: { _id: 1 } });
    if (!exists) return res.status(404).json({ error: "Enrollment token not found" });
    await audit({ orgId: orgId(req), actorType: "user", actorId: actorId(req), action: "enrollment.download", targetType: "enrollment", targetId: enrollmentId, result: "denied", requestId: req.requestId, metadata: { reason: "plaintext-not-retained" } });
    res.status(410).json({ error: "The token is only downloadable once, immediately after generation" });
  } catch (error) { next(error); }
});
