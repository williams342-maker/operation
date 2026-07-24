import express from "express";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { gzipSync } from "node:zlib";
import { cloudflareOnboardingSchema, deriveWebsiteTarget, enrollmentInstallCommand, enrollmentInstallScript, isSafeHttpCheckUrl, validateConfiguredPath } from "@control-center/shared";
import { audit } from "./audit.js";
import { noStore, requirePermission, requireRecentAuth } from "./auth.js";
import { collections, oid } from "./db.js";
import { hashAgentSecret, hashPassword, hashSecret, randomToken } from "./crypto.js";
import type { UserDoc } from "./models.js";
import { discoverWebsite, websiteFailureStatus } from "./urlDiscovery.js";
import { calculateAgentStatus, publicSiteStatus } from "./serverStatus.js";
import { buildProjectOverview } from "./projectOverview.js";
import { deploymentHistoryItem, projectDeploymentHistory, projectRollbackHistory } from "./projectHistory.js";
import { safeConnectivity, storeCloudflareConnectivity } from "./connectivityVault.js";
import { passwordResetUrl, sendPasswordResetEmail } from "./passwordResetMailer.js";

export const managementRouter = express.Router();
const roles = ["Owner", "Administrator", "Developer", "Viewer"] as const;
const notArchived = { archivedAt: { $exists: false } };
const statusCheckTimes = new Map<string, number>();
function orgId(req: express.Request) { if (!req.orgId) throw new Error("Missing organization scope"); return req.orgId; }
function actorId(req: express.Request) { if (!req.user?._id) throw new Error("Missing user"); return req.user._id; }
function deny(res: express.Response, message = "Forbidden") { return res.status(403).json({ error: message }); }
async function activeOwners(org: ObjectId) { return collections.users.countDocuments({ orgId: org, role: "Owner", disabledAt: { $exists: false } }); }
function withoutPassword(user: UserDoc & { _id?: ObjectId }) { const safe = { ...user } as Partial<UserDoc> & { _id?: ObjectId }; delete safe.passwordHash; return safe; }
function requireOwner(req: express.Request, res: express.Response) { if (req.user?.role !== "Owner") { deny(res, "Owner role required"); return false; } return true; }

managementRouter.get("/org/settings", requirePermission("org:manage"), async (req, res, next) => {
  try {
    const organization = await collections.organizations.findOne({ _id: orgId(req) });
    if (!organization) return res.status(404).json({ error: "Organization not found" });
    res.json({
      organization,
      passwordResetEmail: {
        configured: Boolean(process.env.CONTROL_CENTER_PASSWORD_RESET_WEBHOOK_URL),
        guidance: "Set CONTROL_CENTER_PASSWORD_RESET_WEBHOOK_URL to send password reset links."
      }
    });
  } catch (error) { next(error); }
});

managementRouter.patch("/org/settings", requirePermission("org:manage"), async (req, res, next) => {
  try {
    const body = z.object({ name: z.string().min(2).max(120), defaultTimezone: z.string().min(1).max(80).default("UTC"), status: z.enum(["active", "suspended"]).default("active"), expectedUpdatedAt: z.string().datetime() }).parse(req.body);
    const result = await collections.organizations.findOneAndUpdate({ _id: orgId(req), updatedAt: new Date(body.expectedUpdatedAt) }, { $set: { name: body.name, defaultTimezone: body.defaultTimezone, status: body.status, updatedAt: new Date() } }, { returnDocument: "after" });
    if (!result) return res.status(409).json({ error: "Organization was modified by another request" });
    await audit({ orgId: orgId(req), actorType: "user", actorId: actorId(req), action: "org.update", targetType: "organization", targetId: orgId(req), result: "success", requestId: req.requestId });
    res.json({ organization: result });
  } catch (error) { next(error); }
});

managementRouter.get("/org/users", requirePermission("users:manage"), async (req, res, next) => {
  try {
    const q = z.object({ role: z.enum(roles).optional(), status: z.enum(["active", "inactive"]).optional() }).merge(z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25), search: z.string().optional() })).parse(req.query);
    const filter: Record<string, unknown> = { orgId: orgId(req) };
    if (q.role) filter.role = q.role;
    if (q.status === "active") filter.disabledAt = { $exists: false };
    if (q.status === "inactive") filter.disabledAt = { $exists: true };
    if (q.search) filter.$or = [{ email: { $regex: q.search, $options: "i" } }, { name: { $regex: q.search, $options: "i" } }];
    const [users, total] = await Promise.all([collections.users.find(filter, { projection: { passwordHash: 0 } }).sort({ createdAt: -1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize).toArray(), collections.users.countDocuments(filter)]);
    res.json({ users, total, page: q.page, pageSize: q.pageSize });
  } catch (error) { next(error); }
});

managementRouter.post("/org/users", noStore, requirePermission("users:manage"), async (req, res, next) => {
  try {
    const body = z.object({ email: z.string().email(), name: z.string().min(1).max(120), role: z.enum(roles), password: z.string().min(12).max(256) }).parse(req.body);
    if (body.role === "Owner" && !requireOwner(req, res)) return;
    const email = body.email.toLowerCase();
    if (await collections.users.findOne({ orgId: orgId(req), email }, { projection: { _id: 1 } })) return res.status(409).json({ error: "User already exists" });
    const now = new Date();
    const result = await collections.users.insertOne({ orgId: orgId(req), email, name: body.name, role: body.role, passwordHash: hashPassword(body.password), mustChangePassword: true, createdAt: now, updatedAt: now });
    await audit({ orgId: orgId(req), actorType: "user", actorId: actorId(req), action: "user.create", targetType: "user", targetId: result.insertedId, result: "success", requestId: req.requestId, metadata: { role: body.role, credentialMode: "admin-temporary-password" } });
    res.status(201).json({ id: result.insertedId, mustChangePassword: true });
  } catch (error) { next(error); }
});

managementRouter.patch("/org/users/:id", requirePermission("users:manage"), requireRecentAuth, async (req, res, next) => {
  try {
    const id = oid(String(req.params.id)); const org = orgId(req);
    const body = z.object({ name: z.string().min(1).max(120).optional(), role: z.enum(roles).optional(), expectedUpdatedAt: z.string().datetime() }).parse(req.body);
    const target = await collections.users.findOne({ _id: id, orgId: org }); if (!target) return res.status(404).json({ error: "User not found" });
    if (body.role) {
      if ((body.role === "Owner" || target.role === "Owner") && req.user?.role !== "Owner") return deny(res, "Only Owners can manage Owner role");
      if (String(req.user?._id) === String(id) && body.role !== target.role) return deny(res, "Users cannot change their own role");
      if (target.role === "Owner" && body.role !== "Owner" && await activeOwners(org) <= 1) return res.status(409).json({ error: "Cannot remove the final active Owner" });
    }
    const set: Record<string, unknown> = { updatedAt: new Date() }; if (body.name) set.name = body.name; if (body.role) set.role = body.role;
    const result = await collections.users.findOneAndUpdate({ _id: id, orgId: org, updatedAt: new Date(body.expectedUpdatedAt) }, { $set: set }, { returnDocument: "after" });
    if (!result) return res.status(409).json({ error: "User was modified by another request" });
    await audit({ orgId: org, actorType: "user", actorId: actorId(req), action: "user.update", targetType: "user", targetId: id, result: "success", requestId: req.requestId, metadata: body.role ? { role: body.role } : undefined });
    res.json({ user: withoutPassword(result) });
  } catch (error) { next(error); }
});

managementRouter.post("/org/users/:id/deactivate", requirePermission("users:manage"), async (req, res, next) => {
  try { const id = oid(String(req.params.id)); const org = orgId(req); const target = await collections.users.findOne({ _id: id, orgId: org }); if (!target) return res.status(404).json({ error: "User not found" }); if (target.role === "Owner" && await activeOwners(org) <= 1) return res.status(409).json({ error: "Cannot deactivate the final active Owner" }); await collections.users.updateOne({ _id: id, orgId: org }, { $set: { disabledAt: new Date(), updatedAt: new Date() } }); await collections.sessions.deleteMany({ orgId: org, userId: id }); await audit({ orgId: org, actorType: "user", actorId: actorId(req), action: "user.deactivate", targetType: "user", targetId: id, result: "success", requestId: req.requestId }); res.json({ ok: true }); } catch (error) { next(error); }
});
managementRouter.post("/org/users/:id/activate", requirePermission("users:manage"), async (req, res, next) => { try { const id = oid(String(req.params.id)); await collections.users.updateOne({ _id: id, orgId: orgId(req) }, { $unset: { disabledAt: "" }, $set: { updatedAt: new Date() } }); await audit({ orgId: orgId(req), actorType: "user", actorId: actorId(req), action: "user.activate", targetType: "user", targetId: id, result: "success", requestId: req.requestId }); res.json({ ok: true }); } catch (error) { next(error); } });
managementRouter.post("/org/users/:id/revoke-sessions", requirePermission("users:manage"), async (req, res, next) => { try { const id = oid(String(req.params.id)); const deleted = await collections.sessions.deleteMany({ orgId: orgId(req), userId: id }); await audit({ orgId: orgId(req), actorType: "user", actorId: actorId(req), action: "user.sessions.revoke", targetType: "user", targetId: id, result: "success", requestId: req.requestId }); res.json({ revoked: deleted.deletedCount }); } catch (error) { next(error); } });

managementRouter.post("/org/users/:id/reset-password", noStore, requirePermission("users:manage"), requireRecentAuth, async (req, res, next) => {
  try {
    const id = oid(String(req.params.id)); const org = orgId(req);
    const target = await collections.users.findOne({ _id: id, orgId: org, disabledAt: { $exists: false } });
    if (!target) return res.status(404).json({ error: "User not found" });
    if (target.role === "Owner" && !requireOwner(req, res)) return;
    const token = randomToken(32); const now = new Date();
    const expiresAt = new Date(now.getTime() + Number(process.env.CONTROL_CENTER_PASSWORD_RESET_TTL_MINUTES || 30) * 60_000);
    const delivery = await sendPasswordResetEmail({ email: target.email, resetUrl: passwordResetUrl(token), requestId: req.requestId });
    await collections.passwordResetTokens.updateMany({ orgId: org, userId: id, usedAt: { $exists: false } }, { $set: { usedAt: now, updatedAt: now } });
    await collections.passwordResetTokens.insertOne({ orgId: org, userId: id, tokenHash: hashSecret(token), expiresAt, deliveryStatus: delivery.status, createdAt: now, updatedAt: now });
    await audit({ orgId: org, actorType: "user", actorId: actorId(req), action: "user.password.reset", targetType: "user", targetId: id, result: delivery.status === "failed" ? "failure" : "success", requestId: req.requestId, metadata: { stage: "admin-requested", delivery: delivery.status } });
    res.json({ ok: true, delivery: delivery.status });
  } catch (error) { next(error); }
});

managementRouter.delete("/org/users/:id", requirePermission("users:manage"), requireRecentAuth, async (req, res, next) => {
  try {
    if (!requireOwner(req, res)) return;
    const id = oid(String(req.params.id)); const org = orgId(req);
    if (String(id) === String(actorId(req))) return deny(res, "Users cannot delete their own account");
    const target = await collections.users.findOne({ _id: id, orgId: org });
    if (!target) return res.status(404).json({ error: "User not found" });
    if (target.role === "Owner" && await activeOwners(org) <= 1) return res.status(409).json({ error: "Cannot delete the final active Owner" });
    await collections.users.deleteOne({ _id: id, orgId: org });
    await collections.sessions.deleteMany({ orgId: org, userId: id });
    await audit({ orgId: org, actorType: "user", actorId: actorId(req), action: "user.delete", targetType: "user", targetId: id, result: "success", requestId: req.requestId, metadata: { role: target.role } });
    res.json({ ok: true });
  } catch (error) { next(error); }
});
managementRouter.post("/servers", requirePermission("servers:manage"), async (req, res, next) => {
  try { const body = z.object({ name: z.string().min(1), slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(), hostname: z.string().min(1), allowlistedRoots: z.array(z.string()).default([]), metadata: z.record(z.string()).default({}) }).parse(req.body); const org = orgId(req); const slugBase = body.slug || body.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || body.hostname.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "server"; let slug = slugBase; let suffix = 2; while (await collections.servers.findOne({ orgId: org, slug }, { projection: { _id: 1 } })) { if (body.slug) return res.status(409).json({ error: "Server slug is already in use" }); slug = `${slugBase}-${suffix++}`; } const now = new Date(); const result = await collections.servers.insertOne({ orgId: org, name: body.name, slug, hostname: body.hostname, agentId: `manual-${randomToken(12)}`, agentSecretHash: hashAgentSecret(randomToken(48)), credentialVersion: 1, status: "offline", allowlistedRoots: body.allowlistedRoots, metadata: body.metadata, createdAt: now, updatedAt: now }); await audit({ orgId: org, actorType: "user", actorId: actorId(req), action: "server.create", targetType: "server", targetId: result.insertedId, result: "success", requestId: req.requestId, metadata: { slug } }); res.status(201).json({ id: result.insertedId, slug }); } catch (error) { next(error); }
});

managementRouter.post("/servers/discover", requirePermission("servers:manage"), async (req, res, next) => {
  try { const body = z.object({ url: z.string().min(1).max(2048) }).parse(req.body); res.json({ discovery: await discoverWebsite(body.url) }); } catch (error) { next(error); }
});

managementRouter.post("/servers/onboard", noStore, requirePermission("servers:manage"), async (req, res, next) => {
  try {
    const body = z.object({ url: z.string().min(1).max(2048), displayName: z.string().trim().min(1).max(120).optional(), slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(), environment: z.enum(["production", "staging", "development"]).default("staging"), sshHost: z.string().trim().max(255).optional(), sshUser: z.string().regex(/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/).optional(), detectedPublicIps: z.array(z.string()).max(20).default([]), expiresInMinutes: z.number().int().min(5).max(43_200).default(60), cloudflare: cloudflareOnboardingSchema.optional() }).parse(req.body);
    const derived = deriveWebsiteTarget(body.url); const org = orgId(req); const slugBase = body.slug || derived.slug;
    let target = await collections.servers.findOne({ orgId: org, archivedAt: { $exists: false }, slug: slugBase });
    if (!target) {
      const compact = slugBase.replace(/-/g, "");
      const candidates = await collections.servers.find({ orgId: org, archivedAt: { $exists: false } }).toArray();
      target = candidates.find((server) => (server.slug || "").replace(/-/g, "") === compact) || null;
    }
    const now = new Date();
    if (target?._id) {
      await collections.servers.updateOne({ _id: target._id, orgId: org }, { $set: { primaryUrl: derived.normalizedUrl, detectedPublicIps: body.detectedPublicIps, environmentKind: body.environment, metadata: { ...(target.metadata || {}), ...(body.sshHost ? { sshHost: body.sshHost } : {}), ...(body.sshUser ? { sshUser: body.sshUser } : {}) }, enrollmentStatus: "pending", agentStatus: target.lastHeartbeatAt ? "offline" : "never_connected", updatedAt: now } });
    } else {
      let slug = slugBase; let suffix = 2; while (await collections.servers.findOne({ orgId: org, slug })) slug = `${slugBase}-${suffix++}`;
      const created = await collections.servers.insertOne({ orgId: org, name: body.displayName || derived.displayName, slug, primaryUrl: derived.normalizedUrl, detectedPublicIps: body.detectedPublicIps, environmentKind: body.environment, metadata: { ...(body.sshHost ? { sshHost: body.sshHost } : {}), ...(body.sshUser ? { sshUser: body.sshUser } : {}) }, enrollmentStatus: "pending", agentStatus: "never_connected", hostname: "", agentId: `pending-${randomToken(12)}`, agentSecretHash: hashAgentSecret(randomToken(48)), credentialVersion: 0, status: "offline", allowlistedRoots: ["/srv"], createdAt: now, updatedAt: now });
      target = await collections.servers.findOne({ _id: created.insertedId, orgId: org });
    }
    if (!target?._id) throw new Error("Pending server could not be created");
    if (body.cloudflare) await storeCloudflareConnectivity(org, target._id, actorId(req), body.cloudflare);
    const token = `owenr_${randomToken(36)}`; const expiresAt = new Date(now.getTime() + body.expiresInMinutes * 60_000);
    const enrollment = await collections.enrollments.insertOne({ orgId: org, serverId: target._id, tokenHash: hashSecret(token), name: `Setup ${target.name}`, description: `URL-first onboarding for ${derived.normalizedUrl}`, expiresAt, maxUses: 1, uses: 0, usage: [], createdByUserId: actorId(req), createdAt: now, updatedAt: now });
    await audit({ orgId: org, actorType: "user", actorId: actorId(req), action: "server.create", targetType: "server", targetId: target._id, result: "success", requestId: req.requestId, metadata: { slug: target.slug || slugBase, url: derived.normalizedUrl } });
    const publicUrl = process.env.CONTROL_CENTER_PUBLIC_URL || "https://opsworkbench.org";
    res.status(201).json({ serverId: target._id, enrollmentId: enrollment.insertedId, token, expiresAt, server: { _id: target._id, name: target.name, slug: target.slug, primaryUrl: derived.normalizedUrl, enrollmentStatus: "pending" }, installCommand: enrollmentInstallCommand(token, publicUrl, target.slug), installScript: enrollmentInstallScript(token, publicUrl, target.slug) });
  } catch (error) { next(error); }
});

managementRouter.get("/servers/:id/connectivity", noStore, requirePermission("status:view"), async (req, res, next) => {
  try { const serverId = oid(String(req.params.id)); if (!await collections.servers.findOne({ _id: serverId, orgId: orgId(req), archivedAt: { $exists: false } })) return res.status(404).json({ error: "Server not found" }); const config = await collections.connectivityConfigs.findOne({ orgId: orgId(req), serverId, provider: "cloudflare" }); const telemetry = await collections.telemetry.findOne({ orgId: orgId(req), serverId }, { sort: { collectedAt: -1 }, projection: { connectivity: 1, collectedAt: 1 } }); res.json({ configuration: safeConnectivity(config), status: Array.isArray(telemetry?.connectivity) ? telemetry.connectivity[0] || null : null }); } catch (error) { next(error); }
});

managementRouter.patch("/servers/:id/connectivity/cloudflare", noStore, requirePermission("servers:manage"), requireRecentAuth, async (req, res, next) => {
  try { const serverId = oid(String(req.params.id)); if (!await collections.servers.findOne({ _id: serverId, orgId: orgId(req), archivedAt: { $exists: false } })) return res.status(404).json({ error: "Server not found" }); const body = z.object({ tunnelToken: z.string().min(16).max(8192).optional(), accessClientId: z.string().min(3).max(2048).optional(), accessClientSecret: z.string().min(8).max(8192).optional() }).refine((value) => Object.values(value).some(Boolean), "A replacement secret is required").parse(req.body); const existing = await collections.connectivityConfigs.findOne({ orgId: orgId(req), serverId, provider: "cloudflare" }); if (!existing) return res.status(404).json({ error: "Cloudflare connectivity is not configured" }); await storeCloudflareConnectivity(orgId(req), serverId, actorId(req), { enabled: existing.enabled, tunnel: { enabled: existing.tunnelEnabled, token: body.tunnelToken }, access: { enabled: existing.accessEnabled, clientId: body.accessClientId, clientSecret: body.accessClientSecret } }); const config = await collections.connectivityConfigs.findOne({ orgId: orgId(req), serverId, provider: "cloudflare" }); await audit({ orgId: orgId(req), actorType: "user", actorId: actorId(req), action: "server.update", targetType: "server", targetId: serverId, result: "success", requestId: req.requestId, metadata: { connectivityProvider: "cloudflare", replacedTunnelToken: Boolean(body.tunnelToken), replacedAccessClientId: Boolean(body.accessClientId), replacedAccessClientSecret: Boolean(body.accessClientSecret) } }); res.json({ configuration: safeConnectivity(config) }); } catch (error) { next(error); }
});

managementRouter.get("/servers/:id/onboarding-status", requirePermission("status:view"), async (req, res, next) => {
  try { const server = await collections.servers.findOne({ _id: oid(String(req.params.id)), orgId: orgId(req) }, { projection: { agentSecretHash: 0 } }); if (!server) return res.status(404).json({ error: "Server not found" }); res.json({ server }); } catch (error) { next(error); }
});

managementRouter.post("/servers/:id/check-status", requirePermission("servers:manage"), async (req, res, next) => {
  try {
    const serverId = oid(String(req.params.id)); const org = orgId(req); const key = `${org}:${serverId}`; const now = new Date();
    if (now.getTime() - (statusCheckTimes.get(key) || 0) < 5_000) return res.status(429).json({ error: "Please wait before checking this server again" });
    statusCheckTimes.set(key, now.getTime());
    const server = await collections.servers.findOne({ _id: serverId, orgId: org, ...notArchived });
    if (!server) return res.status(404).json({ error: "Server not found" });
    const agentStatus = calculateAgentStatus(server.lastHeartbeatAt, server.revokedAt, now);
    const enrollmentStatus = server.revokedAt ? "revoked" : server.enrolledAt ? "connected" : server.enrollmentStatus || "pending";
    const set: Record<string, unknown> = { agentStatus, enrollmentStatus, status: agentStatus === "online" ? "online" : agentStatus === "revoked" ? "revoked" : "offline", updatedAt: now };
    let siteError: string | undefined;
    if (server.primaryUrl) {
      set.publicSiteCheckedAt = now;
      try {
        const discovery = await discoverWebsite(server.primaryUrl);
        set.detectedPublicIps = discovery.addresses;
        set.publicSiteHttpStatus = discovery.httpStatus;
        set.publicSiteStatus = publicSiteStatus(discovery.httpStatus || 0, discovery.redirected);
      } catch (error) {
        set.publicSiteStatus = websiteFailureStatus(error);
        siteError = set.publicSiteStatus as string;
      }
    } else set.publicSiteStatus = "unknown";
    await collections.servers.updateOne({ _id: serverId, orgId: org }, { $set: set, ...(siteError ? { $unset: { publicSiteHttpStatus: "" } } : {}) });
    const updated = await collections.servers.findOne({ _id: serverId, orgId: org }, { projection: { agentSecretHash: 0 } });
    await audit({ orgId: org, actorType: "user", actorId: actorId(req), action: "server.status_checked", targetType: "server", targetId: serverId, result: "success", requestId: req.requestId, metadata: { agentStatus, siteStatus: String(set.publicSiteStatus) } });
    res.json({ server_id: serverId, primary_url: updated?.primaryUrl || null, public_site_status: updated?.publicSiteStatus || "unknown", public_site_http_status: updated?.publicSiteHttpStatus || null, public_site_checked_at: updated?.publicSiteCheckedAt || null, detected_public_ips: updated?.detectedPublicIps || [], agent_status: updated?.agentStatus, enrollment_status: updated?.enrollmentStatus, last_seen_at: updated?.lastHeartbeatAt || null, server: updated });
  } catch (error) { next(error); }
});

managementRouter.post("/servers/:id/enrollment", noStore, requirePermission("servers:enroll"), async (req, res, next) => {
  try { const serverId = oid(String(req.params.id)); const server = await collections.servers.findOne({ _id: serverId, orgId: orgId(req), archivedAt: { $exists: false } }); if (!server) return res.status(404).json({ error: "Server not found" }); const token = `owenr_${randomToken(36)}`; const now = new Date(); const expiresAt = new Date(now.getTime() + 60 * 60_000); const result = await collections.enrollments.insertOne({ orgId: orgId(req), serverId, tokenHash: hashSecret(token), name: `Setup ${server.name}`, expiresAt, maxUses: 1, uses: 0, usage: [], createdByUserId: actorId(req), createdAt: now, updatedAt: now }); await collections.servers.updateOne({ _id: serverId, orgId: orgId(req) }, { $set: { enrollmentStatus: "pending", updatedAt: now } }); const publicUrl = process.env.CONTROL_CENTER_PUBLIC_URL || "https://opsworkbench.org"; res.status(201).json({ id: result.insertedId, token, expiresAt, serverId, slug: server.slug, installCommand: enrollmentInstallCommand(token, publicUrl, server.slug), installScript: enrollmentInstallScript(token, publicUrl, server.slug) }); } catch (error) { next(error); }
});
managementRouter.get("/servers/:id", requirePermission("status:view"), async (req, res, next) => { try { const id = oid(String(req.params.id)); const org = orgId(req); const [server, projects, telemetry] = await Promise.all([collections.servers.findOne({ _id: id, orgId: org }, { projection: { agentSecretHash: 0 } }), collections.projects.find({ orgId: org, primaryServerId: id, ...notArchived }).toArray(), collections.telemetry.find({ orgId: org, serverId: id }).sort({ collectedAt: -1 }).limit(25).toArray()]); if (!server) return res.status(404).json({ error: "Server not found" }); res.json({ server, projects, telemetry }); } catch (error) { next(error); } });
managementRouter.post("/servers/:id/discovery/import", requirePermission("projects:manage"), async (req, res, next) => {
  try {
    const serverId = oid(String(req.params.id)); const org = orgId(req);
    const body = z.object({ repoPath: z.string().min(1), composePath: z.string().optional(), name: z.string().min(1).max(120), branch: z.string().max(100).optional(), remote: z.string().max(500).optional(), serviceNames: z.array(z.string()).default([]) }).parse(req.body);
    const server = await collections.servers.findOne({ _id: serverId, orgId: org, ...notArchived }); if (!server) return res.status(404).json({ error: "Server not found" });
    try { validateConfiguredPath(server.allowlistedRoots || [], body.repoPath); if (body.composePath) validateConfiguredPath(server.allowlistedRoots || [], body.composePath); } catch { return res.status(400).json({ error: "Discovered project paths must stay inside server allowlisted roots" }); }
    if (await collections.projects.findOne({ orgId: org, primaryServerId: serverId, repoPath: body.repoPath, ...notArchived })) return res.status(409).json({ error: "This application is already a managed project" });
    const base = body.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "application"; let slug = base; let suffix = 2; while (await collections.projects.findOne({ orgId: org, slug })) slug = `${base}-${suffix++}`;
    let githubRepository: string | undefined; if (body.remote && !/[\r\n]/.test(body.remote)) { try { const remote = new URL(body.remote); remote.username = ""; remote.password = ""; githubRepository = remote.hostname === "github.com" ? remote.pathname.replace(/^\//, "").replace(/\.git$/, "") : undefined; } catch { githubRepository = body.remote.match(/^git@github\.com:([^\s]+?)(?:\.git)?$/)?.[1]; } }
    const now = new Date(); const result = await collections.projects.insertOne({ orgId: org, name: body.name, slug, primaryServerId: serverId, repoPath: body.repoPath, composePath: body.composePath, githubRepository, branch: body.branch || "main", adapter: "docker-compose", serviceNames: body.serviceNames, healthCheckIds: [], mongoCheckIds: [], createdAt: now, updatedAt: now });
    await audit({ orgId: org, actorType: "user", actorId: actorId(req), action: "project.import_discovered", targetType: "project", targetId: result.insertedId, result: "success", requestId: req.requestId, metadata: { serverId: String(serverId) } }); res.status(201).json({ id: result.insertedId, slug });
  } catch (error) { next(error); }
});
managementRouter.patch("/servers/:id", requirePermission("servers:manage"), async (req, res, next) => { try { const body = z.object({ name: z.string().trim().min(1).max(120).optional(), primaryUrl: z.string().trim().min(1).max(2048).optional(), slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(), notes: z.string().max(2000).optional(), tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(), expectedUpdatedAt: z.string().datetime() }).parse(req.body); const serverId = oid(String(req.params.id)); const org = orgId(req); if (body.slug && await collections.servers.findOne({ _id: { $ne: serverId }, orgId: org, slug: body.slug, ...notArchived })) return res.status(409).json({ error: "Server slug is already in use" }); const set: Record<string, unknown> = { updatedAt: new Date() }; for (const key of ["name", "slug", "notes", "tags"] as const) if (body[key] !== undefined) set[key] = body[key]; if (body.primaryUrl !== undefined) { set.primaryUrl = deriveWebsiteTarget(body.primaryUrl).normalizedUrl; set.publicSiteStatus = "unknown"; } const result = await collections.servers.findOneAndUpdate({ _id: serverId, orgId: org, updatedAt: new Date(body.expectedUpdatedAt), ...notArchived }, { $set: set }, { returnDocument: "after", projection: { agentSecretHash: 0 } }); if (!result) return res.status(409).json({ error: "Server was modified by another request" }); await audit({ orgId: org, actorType: "user", actorId: actorId(req), action: "server.update", targetType: "server", targetId: result._id, result: "success", requestId: req.requestId }); res.json({ server: result }); } catch (error) { next(error); } });
managementRouter.delete("/servers/:id", requirePermission("servers:manage"), async (req, res, next) => {
  try {
    const body = z.object({ mode: z.enum(["remove", "purge"]).default("remove"), confirmation: z.string().optional() }).parse(req.body || {});
    const id = oid(String(req.params.id)); const org = orgId(req);
    const server = await collections.servers.findOne({ _id: id, orgId: org, ...notArchived });
    if (!server) return res.status(404).json({ error: "Server not found" });
    const pending = server.enrollmentStatus === "pending" && !server.enrolledAt;
    if (!pending && body.confirmation !== server.name && body.confirmation !== server.slug) return res.status(400).json({ error: "Type the server name or slug to confirm deletion" });
    const activeTasks = await collections.agentTasks.countDocuments({ orgId: org, serverId: id, state: { $in: ["queued", "claimed", "running"] } });
    if (activeTasks) return res.status(409).json({ error: "Cancel active tasks before deleting this server", activeTasks });
    const now = new Date();
    await audit({ orgId: org, actorType: "user", actorId: actorId(req), action: "server.delete_requested", targetType: "server", targetId: id, result: "success", requestId: req.requestId, metadata: { mode: body.mode, pending } });
    const revokedTokens = await collections.enrollments.updateMany({ orgId: org, serverId: id, revokedAt: { $exists: false }, usedAt: { $exists: false } }, { $set: { revokedAt: now, updatedAt: now } });
    if (revokedTokens.modifiedCount) await audit({ orgId: org, actorType: "user", actorId: actorId(req), action: "enrollment.tokens_revoked", targetType: "server", targetId: id, result: "success", requestId: req.requestId, metadata: { count: revokedTokens.modifiedCount } });
    await collections.connectivityConfigs.deleteMany({ orgId: org, serverId: id });
    if (pending) await collections.servers.deleteOne({ _id: id, orgId: org });
    else {
      await collections.servers.updateOne({ _id: id, orgId: org }, { $set: { archivedAt: now, revokedAt: now, enrollmentStatus: "revoked", agentStatus: "revoked", status: "revoked", updatedAt: now } });
      const detached = await collections.projects.updateMany({ orgId: org, primaryServerId: id, ...notArchived }, { $set: { detachedServerId: id, updatedAt: now }, $unset: { primaryServerId: "" } });
      if (detached.modifiedCount) await audit({ orgId: org, actorType: "user", actorId: actorId(req), action: "server.project_detached", targetType: "server", targetId: id, result: "success", requestId: req.requestId, metadata: { count: detached.modifiedCount } });
      await audit({ orgId: org, actorType: "user", actorId: actorId(req), action: "agent.credential.revoke", targetType: "server", targetId: id, result: "success", requestId: req.requestId });
    }
    if (body.mode === "purge") { await collections.telemetry.deleteMany({ orgId: org, serverId: id }); await collections.agentTaskResults.deleteMany({ orgId: org, serverId: id }); }
    await audit({ orgId: org, actorType: "user", actorId: actorId(req), action: body.mode === "purge" ? "server.purged" : "server.deleted", targetType: "server", targetId: id, result: "success", requestId: req.requestId });
    res.json({ deleted: true, server_id: id, credentials_revoked: !pending, tokens_revoked: revokedTokens.modifiedCount, mode: body.mode, pending });
  } catch (error) { next(error); }
});
managementRouter.post("/servers/:id/archive", requirePermission("servers:manage"), async (req, res, next) => { try { const id = oid(String(req.params.id)); await collections.servers.updateOne({ _id: id, orgId: orgId(req) }, { $set: { archivedAt: new Date(), status: "offline", updatedAt: new Date() } }); await audit({ orgId: orgId(req), actorType: "user", actorId: actorId(req), action: "server.archive", targetType: "server", targetId: id, result: "success", requestId: req.requestId }); res.json({ ok: true }); } catch (error) { next(error); } });
managementRouter.post("/servers/:id/revoke", requirePermission("servers:manage"), async (req, res, next) => { try { const id = oid(String(req.params.id)); await collections.servers.updateOne({ _id: id, orgId: orgId(req) }, { $set: { revokedAt: new Date(), status: "revoked", updatedAt: new Date() } }); await audit({ orgId: orgId(req), actorType: "user", actorId: actorId(req), action: "agent.credential.revoke", targetType: "server", targetId: id, result: "success", requestId: req.requestId }); res.json({ ok: true }); } catch (error) { next(error); } });
managementRouter.post("/servers/:id/rotate", noStore, requirePermission("servers:manage"), requireRecentAuth, async (req, res, next) => { try { const id = oid(String(req.params.id)); const secret = randomToken(48); const result = await collections.servers.updateOne({ _id: id, orgId: orgId(req) }, { $set: { agentSecretHash: hashAgentSecret(secret), credentialVersion: Date.now(), updatedAt: new Date() } }); if (!result.matchedCount) return res.status(404).json({ error: "Server not found" }); await audit({ orgId: orgId(req), actorType: "user", actorId: actorId(req), action: "agent.credential.rotate", targetType: "server", targetId: id, result: "success", requestId: req.requestId }); res.json({ agentSecret: secret }); } catch (error) { next(error); } });

const createProjectSchema = z.object({ name: z.string().min(1), slug: z.string().regex(/^[a-z0-9-]+$/), primaryServerId: z.string(), githubRepository: z.string().max(200).optional(), branch: z.string().max(100).default("main"), repoPath: z.string().optional(), composePath: z.string().optional(), serviceNames: z.array(z.string()).default([]), adapter: z.literal("docker-compose").default("docker-compose") });
const updateProjectSchema = createProjectSchema.partial().extend({ expectedUpdatedAt: z.string().datetime() });
async function checkProjectPaths(req: express.Request, serverId: ObjectId, repoPath?: string, composePath?: string) { const server = await collections.servers.findOne({ _id: serverId, orgId: orgId(req), ...notArchived }); if (!server) throw new Error("server"); const roots = (server as { allowlistedRoots?: string[] }).allowlistedRoots || []; if (repoPath) validateConfiguredPath(roots, repoPath); if (composePath) validateConfiguredPath(roots, composePath); }
managementRouter.post("/projects", requirePermission("projects:manage"), async (req, res, next) => { try { const body = createProjectSchema.parse(req.body); const serverId = oid(body.primaryServerId); try { await checkProjectPaths(req, serverId, body.repoPath, body.composePath); } catch { return res.status(400).json({ error: "Project paths must stay inside server allowlisted roots" }); } const now = new Date(); const result = await collections.projects.insertOne({ orgId: orgId(req), name: body.name, slug: body.slug, primaryServerId: serverId, githubRepository: body.githubRepository, branch: body.branch, repoPath: body.repoPath, composePath: body.composePath, adapter: body.adapter, serviceNames: body.serviceNames, healthCheckIds: [], mongoCheckIds: [], createdAt: now, updatedAt: now }); await audit({ orgId: orgId(req), actorType: "user", actorId: actorId(req), action: "project.create", targetType: "project", targetId: result.insertedId, result: "success", requestId: req.requestId }); res.status(201).json({ id: result.insertedId }); } catch (error) { next(error); } });
managementRouter.get("/projects/:id", requirePermission("status:view"), async (req, res, next) => { try { const id = oid(String(req.params.id)); const org = orgId(req); const project = await collections.projects.findOne({ _id: id, orgId: org }); if (!project) return res.status(404).json({ error: "Project not found" }); const [server, healthChecks, mongoChecks, telemetry] = await Promise.all([collections.servers.findOne({ _id: project.primaryServerId, orgId: org }, { projection: { agentSecretHash: 0 } }), collections.healthChecks.find({ orgId: org, projectId: id, ...notArchived }).toArray(), collections.mongoChecks.find({ orgId: org, projectId: id, ...notArchived }, { projection: { encryptedConnectionString: 0 } }).toArray(), collections.telemetry.find({ orgId: org, serverId: project.primaryServerId }).sort({ collectedAt: -1 }).limit(10).toArray()]); res.json({ project, server, healthChecks, mongoChecks, telemetry }); } catch (error) { next(error); } });
managementRouter.get("/projects/:id/overview", requirePermission("status:view"), async (req, res, next) => { try { if (!ObjectId.isValid(String(req.params.id))) return res.status(404).json({ error: "Project not found" }); const overview = await buildProjectOverview(orgId(req), new ObjectId(String(req.params.id)), req.user!.role); if (!overview) return res.status(404).json({ error: "Project not found" }); res.json(overview); } catch (error) { next(error); } });
const historyLimit = (value: unknown) => z.coerce.number().int().min(1).max(50).default(20).parse(value);
managementRouter.get("/projects/:id/deployments", noStore, requirePermission("status:view"), async (req, res, next) => { try { if (!ObjectId.isValid(String(req.params.id))) return res.status(404).json({ error: "Project not found" }); const id = new ObjectId(String(req.params.id)); const org = orgId(req); const project = await collections.projects.findOne({ _id: id, orgId: org }, { projection: { name: 1, archivedAt: 1 } }); if (!project?._id) return res.status(404).json({ error: "Project not found" }); const limit = historyLimit(req.query.limit); const history = await projectDeploymentHistory(org, id, req.user!.role, limit); res.json({ project: { id: String(project._id), name: project.name, archived: Boolean(project.archivedAt) }, ...history, limit }); } catch (error) { next(error); } });
const projectDeploymentPlanSchema = z.object({ requestedRevision: z.string().regex(/^[a-f0-9]{7,40}$/i), environment: z.enum(["staging", "preview", "testing"]) });
managementRouter.post("/projects/:id/deployments", noStore, requirePermission("projects:manage"), async (req, res, next) => { try { if (!ObjectId.isValid(String(req.params.id))) return res.status(404).json({ error: "Project not found" }); const id = new ObjectId(String(req.params.id)); const org = orgId(req); const body = projectDeploymentPlanSchema.parse(req.body); const project = await collections.projects.findOne({ _id: id, orgId: org, ...notArchived }, { projection: { name: 1, primaryServerId: 1, branch: 1 } }); if (!project?._id) return res.status(404).json({ error: "Project not found" }); const server = await collections.servers.findOne({ _id: project.primaryServerId, orgId: org, ...notArchived }, { projection: { name: 1 } }); if (!server?._id) return res.status(400).json({ error: "Project server is unavailable" }); const now = new Date(); const result = await collections.projectDeployments.insertOne({ orgId: org, projectId: id, serverId: project.primaryServerId, environment: body.environment, requestedRevision: body.requestedRevision.toLowerCase(), branch: project.branch || "main", taskId: new ObjectId(), actorId: actorId(req), status: "planned", validation: { health: "not_run", readiness: "not_run" }, rollbackAvailable: false, evidenceConfidence: "reported", auditEventIds: [], createdAt: now, updatedAt: now }); await audit({ orgId: org, actorType: "user", actorId: actorId(req), action: "project.deployment.plan", targetType: "project-deployment", targetId: result.insertedId, result: "success", requestId: req.requestId, metadata: { projectId: id.toHexString(), environment: body.environment, status: "planned" } }); const created = await collections.projectDeployments.findOne({ _id: result.insertedId, orgId: org }); if (!created) throw new Error("Deployment plan record was not created"); res.status(201).json({ deployment: deploymentHistoryItem(created, server.name, req.user!.role) }); } catch (error) { next(error); } });
managementRouter.get("/projects/:id/rollbacks", noStore, requirePermission("status:view"), async (req, res, next) => { try { if (!ObjectId.isValid(String(req.params.id))) return res.status(404).json({ error: "Project not found" }); const id = new ObjectId(String(req.params.id)); const org = orgId(req); const project = await collections.projects.findOne({ _id: id, orgId: org }, { projection: { name: 1, archivedAt: 1 } }); if (!project?._id) return res.status(404).json({ error: "Project not found" }); const limit = historyLimit(req.query.limit); const history = await projectRollbackHistory(org, id, req.user!.role, limit); res.json({ project: { id: String(project._id), name: project.name, archived: Boolean(project.archivedAt) }, ...history, limit }); } catch (error) { next(error); } });
managementRouter.patch("/projects/:id", requirePermission("projects:manage"), async (req, res, next) => { try { const body = updateProjectSchema.parse(req.body); const id = oid(String(req.params.id)); const existing = await collections.projects.findOne({ _id: id, orgId: orgId(req) }); if (!existing) return res.status(404).json({ error: "Project not found" }); const serverId = body.primaryServerId ? oid(body.primaryServerId) : existing.primaryServerId; try { await checkProjectPaths(req, serverId, body.repoPath, body.composePath); } catch { return res.status(400).json({ error: "Project paths must stay inside server allowlisted roots" }); } const set: Record<string, unknown> = { updatedAt: new Date(), primaryServerId: serverId }; for (const key of ["name", "githubRepository", "branch", "repoPath", "composePath", "serviceNames", "adapter"] as const) if (body[key] !== undefined) set[key] = body[key]; const result = await collections.projects.findOneAndUpdate({ _id: id, orgId: orgId(req), updatedAt: new Date(body.expectedUpdatedAt) }, { $set: set }, { returnDocument: "after" }); if (!result) return res.status(409).json({ error: "Project was modified by another request" }); await audit({ orgId: orgId(req), actorType: "user", actorId: actorId(req), action: "project.update", targetType: "project", targetId: id, result: "success", requestId: req.requestId }); res.json({ project: result }); } catch (error) { next(error); } });
managementRouter.post("/projects/:id/archive", requirePermission("projects:manage"), async (req, res, next) => { try { const id = oid(String(req.params.id)); await collections.projects.updateOne({ _id: id, orgId: orgId(req) }, { $set: { archivedAt: new Date(), updatedAt: new Date() } }); await audit({ orgId: orgId(req), actorType: "user", actorId: actorId(req), action: "project.archive", targetType: "project", targetId: id, result: "success", requestId: req.requestId }); res.json({ ok: true }); } catch (error) { next(error); } });

managementRouter.get("/enrollments", requirePermission("servers:enroll"), async (req, res, next) => { try { const now = new Date(); const enrollments = await collections.enrollments.find({ orgId: orgId(req) }, { projection: { tokenHash: 0 } }).sort({ createdAt: -1 }).limit(200).toArray(); res.json({ enrollments: enrollments.map((e) => ({ ...e, state: e.revokedAt ? "revoked" : e.maxUses !== undefined && e.uses >= e.maxUses ? "used" : e.expiresAt && e.expiresAt < now ? "expired" : "pending" })) }); } catch (error) { next(error); } });
managementRouter.post("/enrollments", noStore, requirePermission("servers:enroll"), requireRecentAuth, async (req, res, next) => { try { const body = z.object({ serverId: z.string().optional(), expiresInMinutes: z.number().int().min(5).max(1440).default(60) }).parse(req.body); if (body.serverId && !await collections.servers.findOne({ _id: oid(body.serverId), orgId: orgId(req) })) return res.status(400).json({ error: "Server not found" }); const token = randomToken(32); const now = new Date(); const result = await collections.enrollments.insertOne({ orgId: orgId(req), serverId: body.serverId ? oid(body.serverId) : undefined, tokenHash: hashSecret(token), name: "Legacy enrollment", expiresAt: new Date(now.getTime() + body.expiresInMinutes * 60_000), maxUses: 1, uses: 0, usage: [], createdByUserId: actorId(req), createdAt: now, updatedAt: now }); await audit({ orgId: orgId(req), actorType: "user", actorId: actorId(req), action: "enrollment.create", targetType: "enrollment", targetId: result.insertedId, result: "success", requestId: req.requestId, metadata: { expiresInMinutes: body.expiresInMinutes } }); res.status(201).json({ id: result.insertedId, token, expiresAt: new Date(now.getTime() + body.expiresInMinutes * 60_000) }); } catch (error) { next(error); } });
managementRouter.post("/enrollments/:id/revoke", requirePermission("servers:enroll"), async (req, res, next) => { try { const id = oid(String(req.params.id)); const result = await collections.enrollments.updateOne({ _id: id, orgId: orgId(req), usedAt: { $exists: false }, revokedAt: { $exists: false } }, { $set: { revokedAt: new Date(), updatedAt: new Date() } }); if (!result.matchedCount) return res.status(409).json({ error: "Enrollment cannot be revoked" }); await audit({ orgId: orgId(req), actorType: "user", actorId: actorId(req), action: "enrollment.revoke", targetType: "enrollment", targetId: id, result: "success", requestId: req.requestId }); res.json({ ok: true }); } catch (error) { next(error); } });
const healthSchema = z.object({ projectId: z.string(), name: z.string().min(1), url: z.string().url(), expectedStatus: z.number().int().min(100).max(599).default(200), timeoutMs: z.number().int().min(100).max(10000).default(5000), intervalSeconds: z.number().int().min(30).max(86400).default(300), enabled: z.boolean().default(true) });
managementRouter.get("/health-checks", requirePermission("status:view"), async (req, res, next) => { try { res.json({ healthChecks: await collections.healthChecks.find({ orgId: orgId(req), ...notArchived }).sort({ createdAt: -1 }).toArray() }); } catch (error) { next(error); } });
managementRouter.post("/health-checks", requirePermission("projects:manage"), async (req, res, next) => { try { const body = healthSchema.parse(req.body); if (!isSafeHttpCheckUrl(body.url)) return res.status(400).json({ error: "Health check URL is not allowed" }); const project = await collections.projects.findOne({ _id: oid(body.projectId), orgId: orgId(req) }); if (!project?._id) return res.status(404).json({ error: "Project not found" }); const now = new Date(); const result = await collections.healthChecks.insertOne({ orgId: orgId(req), projectId: project._id, serverId: project.primaryServerId, name: body.name, url: body.url, expectedStatus: body.expectedStatus, timeoutMs: body.timeoutMs, intervalSeconds: body.intervalSeconds, enabled: body.enabled, createdAt: now, updatedAt: now }); await collections.projects.updateOne({ _id: project._id, orgId: orgId(req) }, { $addToSet: { healthCheckIds: result.insertedId }, $set: { updatedAt: now } }); await audit({ orgId: orgId(req), actorType: "user", actorId: actorId(req), action: "health-check.create", targetType: "health-check", targetId: result.insertedId, result: "success", requestId: req.requestId }); res.status(201).json({ id: result.insertedId }); } catch (error) { next(error); } });
managementRouter.patch("/health-checks/:id", requirePermission("projects:manage"), async (req, res, next) => { try { const body = healthSchema.partial().extend({ expectedUpdatedAt: z.string().datetime() }).parse(req.body); if (body.url && !isSafeHttpCheckUrl(body.url)) return res.status(400).json({ error: "Health check URL is not allowed" }); const set = { ...body, updatedAt: new Date() } as Record<string, unknown>; delete set.expectedUpdatedAt; if (body.projectId) set.projectId = oid(body.projectId); const result = await collections.healthChecks.findOneAndUpdate({ _id: oid(String(req.params.id)), orgId: orgId(req), updatedAt: new Date(body.expectedUpdatedAt) }, { $set: set }, { returnDocument: "after" }); if (!result) return res.status(409).json({ error: "Health check was modified by another request" }); await audit({ orgId: orgId(req), actorType: "user", actorId: actorId(req), action: "health-check.update", targetType: "health-check", targetId: result._id, result: "success", requestId: req.requestId }); res.json({ healthCheck: result }); } catch (error) { next(error); } });
managementRouter.post("/health-checks/:id/archive", requirePermission("projects:manage"), async (req, res, next) => { try { const id = oid(String(req.params.id)); await collections.healthChecks.updateOne({ _id: id, orgId: orgId(req) }, { $set: { archivedAt: new Date(), updatedAt: new Date() } }); await audit({ orgId: orgId(req), actorType: "user", actorId: actorId(req), action: "health-check.archive", targetType: "health-check", targetId: id, result: "success", requestId: req.requestId }); res.json({ ok: true }); } catch (error) { next(error); } });

const mongoSchema = z.object({ projectId: z.string(), serverId: z.string().optional(), name: z.string().min(1), databaseNameHint: z.string().max(120).optional(), secretReference: z.string().min(1).max(120), enabled: z.boolean().default(true) });
function unsafeSecretRef(ref: string) { return /mongodb|:|\/|\\|@/i.test(ref); }
managementRouter.get("/mongo-checks", requirePermission("status:view"), async (req, res, next) => { try { res.json({ mongoChecks: await collections.mongoChecks.find({ orgId: orgId(req), ...notArchived }, { projection: { encryptedConnectionString: 0 } }).sort({ createdAt: -1 }).toArray() }); } catch (error) { next(error); } });
managementRouter.post("/mongo-checks", requirePermission("projects:manage"), async (req, res, next) => { try { const body = mongoSchema.parse(req.body); if (unsafeSecretRef(body.secretReference)) return res.status(400).json({ error: "Use an agent-local secret reference, not a connection string" }); const project = await collections.projects.findOne({ _id: oid(body.projectId), orgId: orgId(req) }); if (!project?._id) return res.status(404).json({ error: "Project not found" }); const serverId = body.serverId ? oid(body.serverId) : project.primaryServerId; if (!await collections.servers.findOne({ _id: serverId, orgId: orgId(req) })) return res.status(400).json({ error: "Server not found" }); const now = new Date(); const result = await collections.mongoChecks.insertOne({ orgId: orgId(req), projectId: project._id, serverId, name: body.name, databaseNameHint: body.databaseNameHint, secretLocation: "agent", secretReference: body.secretReference, enabled: body.enabled, createdAt: now, updatedAt: now }); await collections.projects.updateOne({ _id: project._id, orgId: orgId(req) }, { $addToSet: { mongoCheckIds: result.insertedId }, $set: { updatedAt: now } }); await audit({ orgId: orgId(req), actorType: "user", actorId: actorId(req), action: "mongo-check.create", targetType: "mongo-check", targetId: result.insertedId, result: "success", requestId: req.requestId }); res.status(201).json({ id: result.insertedId }); } catch (error) { next(error); } });
managementRouter.patch("/mongo-checks/:id", requirePermission("projects:manage"), async (req, res, next) => { try { const body = mongoSchema.partial().extend({ expectedUpdatedAt: z.string().datetime() }).parse(req.body); if (body.secretReference && unsafeSecretRef(body.secretReference)) return res.status(400).json({ error: "Use an agent-local secret reference, not a connection string" }); const set = { ...body, updatedAt: new Date() } as Record<string, unknown>; delete set.expectedUpdatedAt; if (body.projectId) set.projectId = oid(body.projectId); if (body.serverId) set.serverId = oid(body.serverId); const result = await collections.mongoChecks.findOneAndUpdate({ _id: oid(String(req.params.id)), orgId: orgId(req), updatedAt: new Date(body.expectedUpdatedAt) }, { $set: set }, { returnDocument: "after", projection: { encryptedConnectionString: 0 } }); if (!result) return res.status(409).json({ error: "Mongo check was modified by another request" }); await audit({ orgId: orgId(req), actorType: "user", actorId: actorId(req), action: "mongo-check.update", targetType: "mongo-check", targetId: result._id, result: "success", requestId: req.requestId }); res.json({ mongoCheck: result }); } catch (error) { next(error); } });
managementRouter.post("/mongo-checks/:id/archive", requirePermission("projects:manage"), async (req, res, next) => { try { const id = oid(String(req.params.id)); await collections.mongoChecks.updateOne({ _id: id, orgId: orgId(req) }, { $set: { archivedAt: new Date(), updatedAt: new Date() } }); await audit({ orgId: orgId(req), actorType: "user", actorId: actorId(req), action: "mongo-check.archive", targetType: "mongo-check", targetId: id, result: "success", requestId: req.requestId }); res.json({ ok: true }); } catch (error) { next(error); } });

function auditFilter(req: express.Request) { const q = z.object({ action: z.string().optional(), result: z.enum(["success", "failure", "denied"]).optional(), actor: z.string().optional(), targetType: z.string().optional(), requestId: z.string().optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25), limit: z.coerce.number().int().min(1).max(1000).default(250) }).parse(req.query); const filter: Record<string, unknown> = { orgId: orgId(req) }; for (const key of ["action", "result", "targetType", "requestId"] as const) if (q[key]) filter[key] = q[key]; if (q.actor) filter.actorId = q.actor; return { q, filter }; }
managementRouter.get("/org/audit", requirePermission("audit:view"), async (req, res, next) => { try { const { q, filter } = auditFilter(req); const [events, total] = await Promise.all([collections.auditEvents.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize).toArray(), collections.auditEvents.countDocuments(filter)]); res.json({ events, total, page: q.page, pageSize: q.pageSize }); } catch (error) { next(error); } });
managementRouter.get("/org/audit/export", noStore, requirePermission("audit:view"), async (req, res, next) => { try { const format = String(req.query.format || "json"); const { q, filter } = auditFilter(req); const events = await collections.auditEvents.find(filter).sort({ createdAt: -1 }).limit(q.limit).toArray(); await audit({ orgId: orgId(req), actorType: "user", actorId: actorId(req), action: "audit.export", targetType: "audit", result: "success", requestId: req.requestId, metadata: { format, count: events.length } }); if (format === "gzip") { const payload = events.map((event) => JSON.stringify(event)).join("\n") + "\n"; res.setHeader("Content-Type", "application/gzip"); res.setHeader("Content-Disposition", `attachment; filename="opsworkbench-audit-${new Date().toISOString().slice(0, 10)}.jsonl.gz"`); res.send(gzipSync(payload)); } else if (format === "csv") res.type("text/csv").send(["createdAt,actorType,action,targetType,targetId,result,requestId", ...events.map((e) => [e.createdAt.toISOString(), e.actorType, e.action, e.targetType || "", String(e.targetId || ""), e.result, e.requestId].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))].join("\n")); else res.json({ events }); } catch (error) { next(error); } });
managementRouter.delete("/org/audit", requirePermission("audit:manage"), async (req, res, next) => { try { const body = z.object({ confirmation: z.literal("CLEAR") }).parse(req.body); void body; const org = orgId(req); const deleted = await collections.auditEvents.deleteMany({ orgId: org }); await audit({ orgId: org, actorType: "user", actorId: actorId(req), action: "audit.clear", targetType: "audit", result: "success", requestId: req.requestId, metadata: { deletedCount: deleted.deletedCount } }); res.json({ deletedCount: deleted.deletedCount }); } catch (error) { next(error); } });




