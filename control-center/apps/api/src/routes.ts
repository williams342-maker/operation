import express from "express";
import { z } from "zod";
import {
  agentEnrollmentRequestSchema,
  agentPollRequestSchema,
  DEFAULT_HEARTBEAT_STALE_SECONDS,
  isHeartbeatStale,
  retentionCutoff
} from "@control-center/shared";
import { audit } from "./audit.js";
import { createSession, noStore, requireCsrf, requirePermission, requireRecentAuth, requireSession, setSessionCookie } from "./auth.js";
import { requireSignedAgent } from "./agentAuth.js";
import { collections, oid, scopedFilter } from "./db.js";
import { hashAgentSecret, hashPassword, hashSecret, randomToken, verifyPassword } from "./crypto.js";

export const router = express.Router();

function requireOrg(req: express.Request) {
  if (!req.orgId) throw new Error("Missing organization scope");
  return req.orgId;
}

const bootstrapSchema = z.object({
  organizationName: z.string().min(2),
  organizationSlug: z.string().regex(/^[a-z0-9-]+$/),
  ownerEmail: z.string().email(),
  ownerName: z.string().min(1),
  password: z.string().min(12)
});

async function bootstrapAvailable() {
  if (process.env.CONTROL_CENTER_BOOTSTRAP_MODE === "disabled") return false;
  return await collections.organizations.countDocuments() === 0;
}

router.get("/auth/bootstrap", noStore, async (_req, res, next) => {
  try {
    res.json({ available: await bootstrapAvailable() });
  } catch (error) { next(error); }
});

router.post("/auth/bootstrap", noStore, async (req, res, next) => {
  try {
    if (process.env.CONTROL_CENTER_BOOTSTRAP_MODE === "disabled") {
      await audit({ actorType: "anonymous", action: "auth.denied", result: "denied", requestId: req.requestId, metadata: { reason: "bootstrap-disabled" } });
      return res.status(403).json({ error: "Bootstrap is disabled" });
    }
    const existing = await collections.organizations.countDocuments();
    if (existing > 0) {
      await audit({ actorType: "anonymous", action: "auth.denied", result: "denied", requestId: req.requestId, metadata: { reason: "bootstrap-completed" } });
      return res.status(409).json({ error: "Bootstrap already completed" });
    }
    const parsed = bootstrapSchema.safeParse(req.body);
    if (!parsed.success) {
      await audit({ actorType: "anonymous", action: "auth.denied", result: "failure", requestId: req.requestId, metadata: { reason: "validation" } });
      return res.status(400).json({ error: "Invalid bootstrap request" });
    }
    const body = parsed.data;
    const now = new Date();
    const orgResult = await collections.organizations.insertOne({ name: body.organizationName, slug: body.organizationSlug, createdAt: now, updatedAt: now });
    const userResult = await collections.users.insertOne({
      orgId: orgResult.insertedId,
      email: body.ownerEmail.toLowerCase(),
      name: body.ownerName,
      role: "Owner",
      passwordHash: hashPassword(body.password),
      createdAt: now,
      updatedAt: now
    });
    await audit({ orgId: orgResult.insertedId, actorType: "system", action: "auth.login", targetType: "user", targetId: userResult.insertedId, result: "success", requestId: req.requestId, metadata: { bootstrap: true } });
    res.status(201).json({ organizationId: orgResult.insertedId, userId: userResult.insertedId });
  } catch (error) { next(error); }
});

router.post("/auth/login", noStore, async (req, res, next) => {
  try {
    const body = z.object({ organizationSlug: z.string(), email: z.string().email(), password: z.string() }).parse(req.body);
    const org = await collections.organizations.findOne({ slug: body.organizationSlug });
    const user = org?._id ? await collections.users.findOne({ orgId: org._id, email: body.email.toLowerCase(), disabledAt: { $exists: false } }) : null;
    if (!org?._id || !user?._id || !verifyPassword(body.password, user.passwordHash)) {
      await audit({ orgId: org?._id, actorType: "anonymous", action: "auth.login", result: "failure", requestId: req.requestId, metadata: { email: body.email.toLowerCase() } });
      return res.status(401).json({ error: "Invalid credentials" });
    }
    const session = await createSession(user);
    setSessionCookie(res, session.sessionId);
    await audit({ orgId: org._id, actorType: "user", actorId: user._id, action: "auth.login", result: "success", requestId: req.requestId });
    res.json({ csrfToken: session.csrfToken, user: { id: user._id, email: user.email, name: user.name, role: user.role }, organization: { id: org._id, name: org.name, slug: org.slug } });
  } catch (error) { next(error); }
});

router.use("/auth/logout", requireSession, requireCsrf);
router.post("/auth/logout", async (req, res, next) => {
  try {
    if (req.sessionId && req.orgId) await collections.sessions.deleteOne({ _id: req.sessionId, orgId: req.orgId });
    await audit({ orgId: req.orgId, actorType: "user", actorId: req.user?._id, action: "auth.logout", result: "success", requestId: req.requestId });
    res.clearCookie("cc_session");
    res.json({ ok: true });
  } catch (error) { next(error); }
});

router.use("/me", requireSession);
router.get("/me", (req, res) => {
  res.json({ user: { id: req.user!._id, email: req.user!.email, name: req.user!.name, role: req.user!.role }, orgId: req.orgId });
});

router.use("/org", requireSession, requireCsrf);
router.get("/org/audit", requirePermission("audit:view"), async (req, res, next) => {
  try {
    const events = await collections.auditEvents.find({ orgId: requireOrg(req) }).sort({ createdAt: -1 }).limit(200).toArray();
    res.json({ events });
  } catch (error) { next(error); }
});

router.post("/org/users", requirePermission("users:manage"), async (req, res, next) => {
  try {
    const body = z.object({ email: z.string().email(), name: z.string().min(1), role: z.enum(["Owner", "Administrator", "Developer", "Viewer"]), password: z.string().min(12) }).parse(req.body);
    const now = new Date();
    const result = await collections.users.insertOne({ orgId: requireOrg(req), email: body.email.toLowerCase(), name: body.name, role: body.role, passwordHash: hashPassword(body.password), createdAt: now, updatedAt: now });
    res.status(201).json({ id: result.insertedId });
  } catch (error) { next(error); }
});

router.use("/enrollments", requireSession, requireCsrf);
router.post("/enrollments", noStore, requirePermission("servers:enroll"), async (req, res, next) => {
  try {
    const body = z.object({ expiresInMinutes: z.number().int().min(5).max(1440).default(60) }).parse(req.body);
    const token = randomToken(32);
    const now = new Date();
    const result = await collections.enrollments.insertOne({
      orgId: requireOrg(req),
      tokenHash: hashSecret(token),
      expiresAt: new Date(now.getTime() + body.expiresInMinutes * 60 * 1000),
      createdByUserId: req.user!._id!,
      createdAt: now,
      updatedAt: now
    });
    await audit({ orgId: req.orgId, actorType: "user", actorId: req.user!._id, action: "enrollment.create", targetType: "enrollment", targetId: result.insertedId, result: "success", requestId: req.requestId });
    res.status(201).json({ id: result.insertedId, token, expiresAt: new Date(now.getTime() + body.expiresInMinutes * 60 * 1000) });
  } catch (error) { next(error); }
});

router.post("/agent/enroll", noStore, async (req, res, next) => {
  try {
    const body = agentEnrollmentRequestSchema.parse(req.body);
    const tokenHash = hashSecret(body.enrollmentToken);
    const enrollment = await collections.enrollments.findOneAndUpdate({ tokenHash, expiresAt: { $gt: new Date() }, usedAt: { $exists: false } }, { $set: { usedAt: new Date(), updatedAt: new Date() } }, { returnDocument: "after" });
    if (!enrollment?._id) {
      await audit({ actorType: "anonymous", action: "enrollment.failure", result: "failure", requestId: req.requestId, metadata: { reason: "invalid-or-expired" } });
      return res.status(401).json({ error: "Invalid enrollment token" });
    }
    const agentSecret = randomToken(48);
    const agentId = randomToken(18);
    const now = new Date();
    const serverResult = await collections.servers.insertOne({
      orgId: enrollment.orgId,
      name: body.hostname,
      hostname: body.hostname,
      agentId,
      agentSecretHash: hashAgentSecret(agentSecret),
      credentialVersion: 1,
      status: "online",
      lastHeartbeatAt: now,
      agentVersion: body.agentVersion,
      createdAt: now,
      updatedAt: now
    });
    await collections.enrollments.updateOne({ _id: enrollment._id, orgId: enrollment.orgId }, { $set: { usedByAgentId: serverResult.insertedId, updatedAt: now } });
    await audit({ orgId: enrollment.orgId, actorType: "agent", actorId: agentId, action: "enrollment.success", targetType: "server", targetId: serverResult.insertedId, result: "success", requestId: req.requestId });
    res.status(201).json({ agentId, agentSecret, serverId: serverResult.insertedId, pollIntervalSeconds: 30 });
  } catch (error) { next(error); }
});

router.post("/agent/poll", requireSignedAgent, async (req, res, next) => {
  try {
    const server = req.agentServer!;
    const body = agentPollRequestSchema.parse(req.body);
    const now = new Date();
    const collectedAt = new Date(body.heartbeat.collectedAt);
    if (collectedAt.getTime() > now.getTime() + 60_000) return res.status(400).json({ error: "Future-dated telemetry rejected" });
    const expiresAt = retentionCutoff(new Date(now.getTime() + 28 * 24 * 60 * 60 * 1000), 14);
    const telemetry = {
      orgId: server.orgId,
      serverId: server._id,
      collectedAt,
      agentVersion: body.heartbeat.agentVersion,
      metrics: body.metrics,
      docker: body.docker || [],
      compose: body.compose || [],
      git: body.git || [],
      httpHealth: body.httpHealth || [],
      mongo: body.mongo || [],
      expiresAt,
      createdAt: now,
      updatedAt: now
    };
    await collections.telemetry.insertOne(telemetry);
    await collections.servers.updateOne({ _id: server._id, orgId: server.orgId }, {
      $set: {
        status: "online",
        lastHeartbeatAt: now,
        agentVersion: body.heartbeat.agentVersion,
        currentState: {
          metrics: body.metrics,
          docker: body.docker || [],
          compose: body.compose || [],
          git: body.git || [],
          httpHealth: body.httpHealth || [],
          mongo: body.mongo || [],
          collectedAt: new Date(body.heartbeat.collectedAt)
        },
        updatedAt: now
      }
    });
    const projects = await collections.projects.find({ orgId: server.orgId, primaryServerId: server._id }).toArray();
    const healthChecks = await collections.healthChecks.find({ orgId: server.orgId, serverId: server._id, enabled: true }).toArray();
    const mongoChecks = await collections.mongoChecks.find({ orgId: server.orgId, serverId: server._id, enabled: true }).toArray();
    res.json({
      tasks: [{
        id: `collect-${Date.now()}`,
        kind: "collect",
        config: {
          projects: projects.map((project) => ({ projectId: project._id!.toHexString(), repoPath: project.repoPath, composePath: project.composePath })),
          httpHealthChecks: healthChecks.map((check) => ({ id: check._id!.toHexString(), url: check.url, timeoutMs: check.timeoutMs })),
          mongoChecks: mongoChecks.map((check) => ({ id: check._id!.toHexString(), databaseNameHint: check.databaseNameHint }))
        }
      }]
    });
  } catch (error) { next(error); }
});

router.use(requireSession, requireCsrf);

router.get("/overview", requirePermission("status:view"), async (req, res, next) => {
  try {
    const orgId = requireOrg(req);
    const [servers, projects, audits] = await Promise.all([
      collections.servers.find({ orgId }).toArray(),
      collections.projects.find({ orgId }).toArray(),
      collections.auditEvents.find({ orgId }).sort({ createdAt: -1 }).limit(20).toArray()
    ]);
    const now = new Date();
    await Promise.all(servers.filter((s) => isHeartbeatStale(s.lastHeartbeatAt, now, DEFAULT_HEARTBEAT_STALE_SECONDS) && s.status !== "revoked").map((s) =>
      collections.servers.updateOne({ _id: s._id, orgId }, { $set: { status: "offline", updatedAt: now } })
    ));
    res.json({ serverCount: servers.length, projectCount: projects.length, onlineServers: servers.filter((s) => !isHeartbeatStale(s.lastHeartbeatAt, now)).length, recentAudit: audits });
  } catch (error) { next(error); }
});

router.get("/servers", requirePermission("status:view"), async (req, res, next) => {
  try {
    const orgId = requireOrg(req);
    const servers = await collections.servers.find({ orgId }, { projection: { agentSecretHash: 0 } }).sort({ createdAt: -1 }).toArray();
    res.json({ servers });
  } catch (error) { next(error); }
});

router.post("/servers/:id/revoke", requirePermission("servers:manage"), async (req, res, next) => {
  try {
    const orgId = requireOrg(req);
    const id = oid(String(req.params.id));
    await collections.servers.updateOne({ _id: id, orgId }, { $set: { revokedAt: new Date(), status: "revoked", updatedAt: new Date() } });
    await audit({ orgId, actorType: "user", actorId: req.user!._id, action: "agent.credential.revoke", targetType: "server", targetId: id, result: "success", requestId: req.requestId });
    res.json({ ok: true });
  } catch (error) { next(error); }
});

router.post("/servers/:id/rotate", noStore, requirePermission("servers:manage"), requireRecentAuth, async (req, res, next) => {
  try {
    const orgId = requireOrg(req);
    const id = oid(String(req.params.id));
    const secret = randomToken(48);
    const result = await collections.servers.updateOne({ _id: id, orgId }, { $set: { agentSecretHash: hashAgentSecret(secret), credentialVersion: Date.now(), updatedAt: new Date() } });
    if (!result.matchedCount) return res.status(404).json({ error: "Server not found" });
    await audit({ orgId, actorType: "user", actorId: req.user!._id, action: "agent.credential.rotate", targetType: "server", targetId: id, result: "success", requestId: req.requestId });
    res.json({ agentSecret: secret });
  } catch (error) { next(error); }
});

router.get("/projects", requirePermission("status:view"), async (req, res, next) => {
  try { res.json({ projects: await collections.projects.find(scopedFilter(requireOrg(req))).sort({ createdAt: -1 }).toArray() }); } catch (error) { next(error); }
});

router.post("/projects", requirePermission("projects:manage"), async (req, res, next) => {
  try {
    const body = z.object({
      name: z.string().min(1),
      slug: z.string().regex(/^[a-z0-9-]+$/),
      primaryServerId: z.string(),
      repoPath: z.string().optional(),
      composePath: z.string().optional()
    }).parse(req.body);
    const orgId = requireOrg(req);
    const serverId = oid(body.primaryServerId);
    const server = await collections.servers.findOne({ _id: serverId, orgId });
    if (!server) return res.status(400).json({ error: "Primary server not found in organization" });
    const now = new Date();
    const result = await collections.projects.insertOne({ orgId, name: body.name, slug: body.slug, primaryServerId: serverId, repoPath: body.repoPath, composePath: body.composePath, healthCheckIds: [], mongoCheckIds: [], createdAt: now, updatedAt: now });
    await audit({ orgId, actorType: "user", actorId: req.user!._id, action: "project.create", targetType: "project", targetId: result.insertedId, result: "success", requestId: req.requestId });
    res.status(201).json({ id: result.insertedId });
  } catch (error) { next(error); }
});

router.get("/projects/:id/status", requirePermission("status:view"), async (req, res, next) => {
  try {
    const orgId = requireOrg(req);
    const project = await collections.projects.findOne({ _id: oid(String(req.params.id)), orgId });
    if (!project) return res.status(404).json({ error: "Project not found" });
    const server = await collections.servers.findOne({ _id: project.primaryServerId, orgId }, { projection: { agentSecretHash: 0 } });
    const telemetry = await collections.telemetry.find({ orgId, serverId: project.primaryServerId }).sort({ collectedAt: -1 }).limit(50).toArray();
    res.json({ project, server, telemetry });
  } catch (error) { next(error); }
});

router.post("/projects/:id/health-checks", requirePermission("projects:manage"), async (req, res, next) => {
  try {
    const body = z.object({ name: z.string(), url: z.string().url(), timeoutMs: z.number().int().min(100).max(30000).default(5000) }).parse(req.body);
    const orgId = requireOrg(req);
    const project = await collections.projects.findOne({ _id: oid(String(req.params.id)), orgId });
    if (!project?._id) return res.status(404).json({ error: "Project not found" });
    const now = new Date();
    const result = await collections.healthChecks.insertOne({ orgId, projectId: project._id, serverId: project.primaryServerId, name: body.name, url: body.url, timeoutMs: body.timeoutMs, enabled: true, createdAt: now, updatedAt: now });
    await collections.projects.updateOne({ _id: project._id, orgId }, { $push: { healthCheckIds: result.insertedId }, $set: { updatedAt: now } });
    res.status(201).json({ id: result.insertedId });
  } catch (error) { next(error); }
});

router.post("/projects/:id/mongo-checks", requirePermission("projects:manage"), async (req, res, next) => {
  try {
    const body = z.object({ name: z.string(), databaseNameHint: z.string().optional(), secretLocation: z.enum(["agent", "api-encrypted"]).default("agent") }).parse(req.body);
    const orgId = requireOrg(req);
    const project = await collections.projects.findOne({ _id: oid(String(req.params.id)), orgId });
    if (!project?._id) return res.status(404).json({ error: "Project not found" });
    const now = new Date();
    const result = await collections.mongoChecks.insertOne({ orgId, projectId: project._id, serverId: project.primaryServerId, name: body.name, databaseNameHint: body.databaseNameHint, secretLocation: body.secretLocation, enabled: true, createdAt: now, updatedAt: now });
    await collections.projects.updateOne({ _id: project._id, orgId }, { $push: { mongoCheckIds: result.insertedId }, $set: { updatedAt: now } });
    res.status(201).json({ id: result.insertedId });
  } catch (error) { next(error); }
});
