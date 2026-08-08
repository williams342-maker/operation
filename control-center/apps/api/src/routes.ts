import express from "express";
import { z } from "zod";
import {
  agentEnrollmentRequestSchema,
  agentPollRequestSchema,
  taskAckSchema,
  DEFAULT_HEARTBEAT_STALE_SECONDS,
  isHeartbeatStale,
  retentionCutoff,
  timingSafeEqualHex,
  verifyEnrollmentV2,
  keyFingerprint,
  buildMigrationReport,
  agentRotationRequestSchema,
  verifyRotationV2,
  planKeyRotation
} from "@control-center/shared";
import { agentV2Enabled } from "./agentProtocolFlag.js";
import { audit } from "./audit.js";
import { allowExpiredLogout, clearSessionCookie, createSession, noStore, parseCookies, requireCsrf, requirePermission, requireRecentAuth, requireSession, setSessionCookie } from "./auth.js";
import { verifyGoogleIdToken, googleAuthConfig } from "./googleAuth.js";
import { requireSignedAgent } from "./agentAuth.js";
import { collections, oid, scopedFilter } from "./db.js";
import { hashAgentSecret, hashPassword, hashSecret, randomToken, verifyPassword } from "./crypto.js";
import { managementRouter } from "./managementRoutes.js";
import { taskRouter } from "./taskRoutes.js";
import { adminEnrollmentRouter } from "./adminEnrollmentRoutes.js";
import { acknowledgeTask, claimTasksForAgent, taskAuditTargetId } from "./tasks.js";
import { clearLoginThrottle, evaluateLoginThrottle, registerLoginFailure, throttleKey } from "./authThrottle.js";
import { calculateAgentStatus } from "./serverStatus.js";
import { aiAssistantRouter } from "./aiAssistantRoutes.js";
import { invalidateOperationalContext } from "./aiContextBuilder.js";
import { aiSettingsRouter } from "./aiSettingsRoutes.js";
import { internalDiagnostics, runtimeHealth } from "./runtimeReadiness.js";
import { configurationRouter } from "./configurationRoutes.js";
import { ingestConfigurationDiscovery } from "./configurationDiscovery.js";
import { agentUpgradeRouter } from "./agentUpgradeRoutes.js";
import { websiteBuilderRouter } from "./websiteBuilderRoutes.js";
import { seoAuditRouter } from "./seoAuditRoutes.js";
import { aiWorkforceRouter } from "./aiWorkforceRoutes.js";

export const router = express.Router();

function sanitizeRemoteForStorage(value?: string) {
  if (!value) return undefined;
  if (/^git@[a-z0-9.-]+:[a-z0-9._/-]+(?:\.git)?$/i.test(value)) return value;
  try { const remote = new URL(value); if (!["http:", "https:", "ssh:", "git:"].includes(remote.protocol)) return undefined; remote.search = ""; remote.hash = ""; if (["http:", "https:"].includes(remote.protocol)) { remote.username = ""; remote.password = ""; } else if (remote.username && remote.username !== "git") remote.username = "git"; return remote.toString(); } catch { return undefined; }
}

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
  if (!["manual", "invitation"].includes(process.env.CONTROL_CENTER_BOOTSTRAP_MODE || "")) return false;
  return await collections.organizations.countDocuments() === 0;
}

// The out-of-band recovery secret gates owner replacement. If it is unset, blank, too short, or a
// placeholder, owner replacement is unavailable regardless of bootstrap mode — so leaving
// CONTROL_CENTER_BOOTSTRAP_MODE=replacement on in production no longer permits an anonymous takeover.
function ownerReplacementSecret(): string | null {
  const raw = process.env.CONTROL_CENTER_OWNER_REPLACEMENT_TOKEN?.trim();
  if (!raw || raw.length < 32 || /change-me|default|example/i.test(raw)) return null;
  return raw;
}

async function ownerReplacementAvailable() {
  if (process.env.CONTROL_CENTER_BOOTSTRAP_MODE !== "replacement") return false;
  if (!ownerReplacementSecret()) return false;
  const organizations = await collections.organizations.find({ ownerReplacementCompletedAt: { $exists: false } }, { projection: { _id: 1 } }).limit(2).toArray();
  if (organizations.length !== 1) return false;
  return await collections.users.countDocuments({ orgId: organizations[0]._id, role: "Owner", disabledAt: { $exists: false } }) === 1;
}

async function singleOrganization() {
  const organizations = await collections.organizations.find({}).limit(2).toArray();
  return organizations.length === 1 ? organizations[0] : null;
}

router.get("/auth/bootstrap", noStore, async (_req, res, next) => {
  try {
    const [available, replacementAvailable] = await Promise.all([bootstrapAvailable(), ownerReplacementAvailable()]);
    res.json({ available, replacementAvailable });
  } catch (error) { next(error); }
});

router.post("/auth/owner-replacement", noStore, async (req, res, next) => {
  try {
    if (!await ownerReplacementAvailable()) {
      await audit({ actorType: "anonymous", action: "auth.denied", result: "denied", requestId: req.requestId, metadata: { reason: "owner-replacement-unavailable" } });
      return res.status(409).json({ error: "Owner replacement is unavailable" });
    }
    const parsed = z.object({ ownerEmail: z.string().email(), ownerName: z.string().min(1).max(200), password: z.string().min(12).max(256), recoveryToken: z.string().min(1).max(512) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid owner replacement request" });
    const body = parsed.data;
    // Verify the out-of-band recovery token (constant-time over fixed-length hashes) BEFORE consuming
    // the one-time claim, so an attacker without the token cannot burn the single break-glass attempt.
    const secret = ownerReplacementSecret();
    if (!secret || !timingSafeEqualHex(hashSecret(body.recoveryToken), hashSecret(secret))) {
      await audit({ actorType: "anonymous", action: "auth.denied", result: "denied", requestId: req.requestId, metadata: { reason: "owner-replacement-invalid-token" } });
      return res.status(401).json({ error: "Owner replacement is unavailable" });
    }
    const org = await singleOrganization();
    if (org?.ownerReplacementCompletedAt) return res.status(409).json({ error: "Owner replacement is unavailable" });
    if (!org?._id) return res.status(404).json({ error: "Organization not found" });
    const owners = await collections.users.find({ orgId: org._id, role: "Owner", disabledAt: { $exists: false } }).limit(2).toArray();
    if (owners.length !== 1 || !owners[0]._id) return res.status(409).json({ error: "Owner replacement is unavailable" });
    const duplicateEmail = await collections.users.findOne({ orgId: org._id, email: body.ownerEmail.toLowerCase(), _id: { $ne: owners[0]._id } }, { projection: { _id: 1 } });
    if (duplicateEmail) return res.status(409).json({ error: "Email is already assigned to another user" });
    const now = new Date();
    const claimed = await collections.organizations.updateOne({ _id: org._id, ownerReplacementCompletedAt: { $exists: false } }, { $set: { ownerReplacementCompletedAt: now, updatedAt: now } });
    if (claimed.modifiedCount !== 1) return res.status(409).json({ error: "Owner replacement is unavailable" });
    await collections.users.updateOne({ _id: owners[0]._id, orgId: org._id }, { $set: { email: body.ownerEmail.toLowerCase(), name: body.ownerName, passwordHash: hashPassword(body.password), updatedAt: now }, $unset: { disabledAt: "", inviteIssuedAt: "", mustChangePassword: "" } });
    await collections.sessions.deleteMany({ orgId: org._id });
    const user = await collections.users.findOne({ _id: owners[0]._id, orgId: org._id });
    if (!user) throw new Error("Replaced owner is unavailable");
    const session = await createSession(user);
    setSessionCookie(res, session.sessionToken);
    await audit({ orgId: org._id, actorType: "system", action: "user.password.change", targetType: "user", targetId: user._id, result: "success", requestId: req.requestId, metadata: { oneTimeOwnerReplacement: true } });
    res.status(201).json({ csrfToken: session.csrfToken, user: { id: user._id, email: user.email, name: user.name, role: user.role }, organization: { id: org._id, name: org.name, slug: org.slug } });
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
    const body = z.object({ organizationSlug: z.string().optional(), email: z.string().email(), password: z.string() }).parse(req.body);
    const throttle = throttleKey(body.organizationSlug, body.email);
    const status = await evaluateLoginThrottle(throttle);
    if (status.locked) {
      await audit({ actorType: "anonymous", action: "auth.login", result: "denied", requestId: req.requestId, metadata: { email: body.email.toLowerCase(), reason: "account-locked" } });
      res.setHeader("Retry-After", String(status.retryAfterSeconds));
      return res.status(429).json({ error: "Too many failed attempts. Try again later.", code: "ACCOUNT_LOCKED", retryAfterSeconds: status.retryAfterSeconds });
    }
    const org = body.organizationSlug
      ? await collections.organizations.findOne({ slug: body.organizationSlug })
      : await singleOrganization();
    const user = org?._id ? await collections.users.findOne({ orgId: org._id, email: body.email.toLowerCase(), disabledAt: { $exists: false } }) : null;
    if (!org?._id || !user?._id || !verifyPassword(body.password, user.passwordHash)) {
      const failure = await registerLoginFailure(throttle);
      await audit({ orgId: org?._id, actorType: "anonymous", action: "auth.login", result: "failure", requestId: req.requestId, metadata: { email: body.email.toLowerCase(), failures: failure.failures } });
      return res.status(401).json({ error: "Invalid credentials" });
    }
    await clearLoginThrottle(throttle);
    const session = await createSession(user);
    setSessionCookie(res, session.sessionToken);
    await audit({ orgId: org._id, actorType: "user", actorId: user._id, action: "auth.login", result: "success", requestId: req.requestId });
    res.json({ csrfToken: session.csrfToken, user: { id: user._id, email: user.email, name: user.name, role: user.role }, organization: { id: org._id, name: org.name, slug: org.slug } });
  } catch (error) { next(error); }
});

// --- Google sign-in (primary). Verified Google identity → existing-user
//     allowlist → same secure session as password login. No client secret in
//     the browser; magic-link/password remain as fallbacks. ---
router.get("/auth/google/start", noStore, async (_req, res, next) => {
  try {
    const cfg = googleAuthConfig();
    if (!cfg.enabled) return res.json({ enabled: false });
    const nonce = randomToken(24);
    res.cookie("cc_google_nonce", nonce, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production" || process.env.CONTROL_CENTER_SECURE_COOKIES === "true",
      sameSite: "lax",
      maxAge: 5 * 60 * 1000,
      path: "/"
    });
    res.json({ enabled: true, clientId: cfg.clientId, nonce });
  } catch (error) { next(error); }
});

router.post("/auth/google", noStore, async (req, res, next) => {
  try {
    const cfg = googleAuthConfig();
    if (!cfg.enabled) return res.status(404).json({ error: "Google sign-in is not configured" });
    const body = z.object({ credential: z.string().min(10).max(8192) }).safeParse(req.body);
    if (!body.success) return res.status(400).json({ error: "Invalid Google sign-in request" });
    const nonce = parseCookies(req.headers.cookie).cc_google_nonce || null;
    res.clearCookie("cc_google_nonce", { path: "/" });

    let identity;
    try {
      identity = await verifyGoogleIdToken(body.data.credential, { clientId: cfg.clientId, nonce });
    } catch {
      await audit({ actorType: "anonymous", action: "auth.login", result: "failure", requestId: req.requestId, metadata: { method: "google", reason: "verify-failed" } });
      return res.status(401).json({ error: "Google sign-in failed" });
    }

    // Authorization: the verified Google email MUST map to an existing, enabled
    // user in the org. A Google account with no matching user is DENIED — the
    // users collection is the allowlist. Identity (Google) ≠ authorization (us).
    const org = await singleOrganization();
    const user = org?._id
      ? await collections.users.findOne({ orgId: org._id, email: identity.email, disabledAt: { $exists: false } })
      : null;
    if (!org?._id || !user?._id) {
      await audit({ orgId: org?._id, actorType: "anonymous", action: "auth.login", result: "denied", requestId: req.requestId, metadata: { email: identity.email, method: "google", reason: "not-authorized" } });
      return res.status(403).json({ error: "This Google account is not authorized for the Control Panel" });
    }

    const session = await createSession(user);
    setSessionCookie(res, session.sessionToken);
    await audit({ orgId: org._id, actorType: "user", actorId: user._id, action: "auth.login", result: "success", requestId: req.requestId, metadata: { method: "google" } });
    res.json({ csrfToken: session.csrfToken, user: { id: user._id, email: user.email, name: user.name, role: user.role }, organization: { id: org._id, name: org.name, slug: org.slug } });
  } catch (error) { next(error); }
});

router.use("/auth/logout", noStore, allowExpiredLogout, requireSession, requireCsrf);
router.post("/auth/logout", async (req, res, next) => {
  try {
    if (req.sessionId && req.orgId) await collections.sessions.deleteOne({ _id: req.sessionId, orgId: req.orgId });
    await audit({ orgId: req.orgId, actorType: "user", actorId: req.user?._id, action: "auth.logout", result: "success", requestId: req.requestId });
    clearSessionCookie(res);
    res.json({ ok: true });
  } catch (error) { next(error); }
});

router.use("/auth/reauthenticate", requireSession, requireCsrf);
router.post("/auth/reauthenticate", noStore, async (req, res, next) => {
  try {
    const body = z.object({ password: z.string().min(1) }).parse(req.body);
    if (!req.user || !req.sessionId || !req.orgId || !verifyPassword(body.password, req.user.passwordHash)) {
      await audit({
        orgId: req.orgId,
        actorType: req.user ? "user" : "anonymous",
        actorId: req.user?._id,
        action: "auth.denied",
        result: "denied",
        requestId: req.requestId,
        metadata: { reason: "reauthentication-failed" }
      });
      return res.status(403).json({ error: "Password confirmation failed", code: "REAUTHENTICATION_FAILED" });
    }
    const now = new Date();
    await collections.sessions.updateOne(
      { _id: req.sessionId, orgId: req.orgId, userId: req.user._id },
      { $set: { authenticatedAt: now, lastSeenAt: now, updatedAt: now } }
    );
    await audit({ orgId: req.orgId, actorType: "user", actorId: req.user._id, action: "auth.login", result: "success", requestId: req.requestId, metadata: { reauthentication: true } });
    res.json({ ok: true });
  } catch (error) { next(error); }
});

router.use("/auth/change-password", noStore, requireSession, requireCsrf);
router.post("/auth/change-password", async (req, res, next) => {
  try {
    const body = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(12).max(256) }).parse(req.body);
    if (!req.user || !req.sessionId || !req.orgId || !verifyPassword(body.currentPassword, req.user.passwordHash)) {
      await audit({ orgId: req.orgId, actorType: req.user ? "user" : "anonymous", actorId: req.user?._id, action: "auth.denied", result: "denied", requestId: req.requestId, metadata: { reason: "password-change-failed" } });
      return res.status(403).json({ error: "Current password is incorrect", code: "PASSWORD_CHANGE_FAILED" });
    }
    const now = new Date();
    await collections.users.updateOne({ _id: req.user._id, orgId: req.orgId }, { $set: { passwordHash: hashPassword(body.newPassword), updatedAt: now }, $unset: { mustChangePassword: "", inviteIssuedAt: "" } });
    await collections.sessions.deleteMany({ orgId: req.orgId, userId: req.user._id, _id: { $ne: req.sessionId } });
    await audit({ orgId: req.orgId, actorType: "user", actorId: req.user._id, action: "user.password.change", targetType: "user", targetId: req.user._id, result: "success", requestId: req.requestId });
    res.json({ ok: true });
  } catch (error) { next(error); }
});
router.use("/me", requireSession);
router.get("/me", (req, res) => {
  res.json({ user: { id: req.user!._id, email: req.user!.email, name: req.user!.name, role: req.user!.role }, orgId: req.orgId });
});

function serverSlug(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "server";
}

function compactServerIdentity(value: string) {
  return serverSlug(value).replace(/-/g, "");
}

router.post("/agent/enroll", noStore, async (req, res, next) => {
  try {
    const body = agentEnrollmentRequestSchema.parse(req.body);
    // agent-v2 enrollment: validate proof-of-possession BEFORE consuming the one-time token, so a
    // forged/expired/downgraded request cannot burn a valid enrollment token. Fails closed when the
    // flag is off (no silent downgrade to v1 for an agent that presented v2 keys).
    const wantsV2 = Boolean(body.signingPublicKey || body.encryptionPublicKey || body.enrollmentProof);
    if (wantsV2) {
      if (!agentV2Enabled()) {
        await audit({ actorType: "anonymous", action: "enrollment.failure", result: "failure", requestId: req.requestId, metadata: { reason: "v2-disabled" } });
        return res.status(400).json({ error: "agent-v2 protocol is not enabled" });
      }
      const check = verifyEnrollmentV2({ enrollmentToken: body.enrollmentToken, signingPublicKey: body.signingPublicKey || "", encryptionPublicKey: body.encryptionPublicKey || "", issuedAt: body.enrollmentIssuedAt || "", protocolVersion: body.protocolVersion || "", proof: body.enrollmentProof || "" });
      if (!check.valid) {
        await audit({ actorType: "anonymous", action: "enrollment.failure", result: "failure", requestId: req.requestId, metadata: { reason: `v2-${check.reason}` } });
        return res.status(401).json({ error: "Invalid agent-v2 enrollment" });
      }
    }
    const tokenHash = hashSecret(body.enrollmentToken);
    const tokenRecord = await collections.enrollments.findOne({ tokenHash }, { projection: { _id: 1, orgId: 1, serverId: 1 } });
    if (!tokenRecord?._id) {
      await audit({ actorType: "anonymous", action: "enrollment.failure", result: "failure", requestId: req.requestId, metadata: { reason: "invalid-token" } });
      return res.status(401).json({ error: "Invalid enrollment token" });
    }
    const boundTarget = tokenRecord.serverId
      ? await collections.servers.findOne({ _id: tokenRecord.serverId, orgId: tokenRecord.orgId, archivedAt: { $exists: false } })
      : null;
    if (tokenRecord.serverId && !boundTarget) return res.status(409).json({ error: "Enrollment target is unavailable" });
    if (boundTarget?.machineId && body.machineId && boundTarget.machineId !== body.machineId) {
      return res.status(409).json({ error: "Enrollment target belongs to a different machine identity" });
    }
    const now = new Date();
    const enrollment = await collections.enrollments.findOneAndUpdate({
      _id: tokenRecord._id,
      revokedAt: { $exists: false },
      $and: [
        { $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gt: now } }] },
        { $or: [{ maxUses: { $exists: false } }, { $expr: { $lt: [{ $ifNull: ["$uses", 0] }, "$maxUses"] } }] }
      ]
    }, { $inc: { uses: 1 }, $set: { usedAt: now, updatedAt: now } }, { returnDocument: "after" });
    if (!enrollment?._id) {
      await audit({ actorType: "anonymous", action: "enrollment.failure", result: "failure", requestId: req.requestId, metadata: { reason: "invalid-or-expired" } });
      return res.status(401).json({ error: "Invalid enrollment token" });
    }
    const agentSecret = randomToken(48);
    const agentId = randomToken(18);
    const identity: Array<Record<string, string>> = [{ hostname: body.hostname }, { slug: serverSlug(body.hostname) }];
    if (body.machineId) identity.unshift({ machineId: body.machineId });
    if (body.agentInstallationId) identity.splice(body.machineId ? 1 : 0, 0, { agentInstallationId: body.agentInstallationId });
    if (body.displayName) identity.push({ slug: serverSlug(body.displayName) });
    if (body.requestedSlug) identity.push({ slug: body.requestedSlug });
    let existing = boundTarget || await collections.servers.findOne({ orgId: enrollment.orgId, archivedAt: { $exists: false }, $or: identity });
    if (!existing) {
      const compact = compactServerIdentity(body.requestedSlug || body.displayName || body.hostname);
      const legacyCandidates = await collections.servers.find({ orgId: enrollment.orgId, archivedAt: { $exists: false } }).toArray();
      existing = legacyCandidates.find((server) => compactServerIdentity(server.slug || server.hostname) === compact) || null;
    }
    // Fresh v2 enrollment: store PUBLIC keys + fingerprints, mark keyProtocolVersion/migrationState v2.
    // agentSecretHash is set to a hash of a discarded random secret so the legacy field stays populated
    // but v1 auth is impossible (the agent never receives that secret and uses its Ed25519 key instead).
    const v2Fields = wantsV2 ? { keyProtocolVersion: "agent-v2" as const, migrationState: "v2" as const, signingPublicKey: body.signingPublicKey!, encryptionPublicKey: body.encryptionPublicKey!, signingKeyFingerprint: keyFingerprint(body.signingPublicKey!), encryptionKeyFingerprint: keyFingerprint(body.encryptionPublicKey!) } : {};
    const serverFields = { hostname: body.hostname, ...v2Fields, legacyCredentialUsable: !wantsV2, ...(body.machineId ? { machineId: body.machineId } : {}), ...(body.agentInstallationId ? { agentInstallationId: body.agentInstallationId } : {}), ...(body.primaryIp ? { primaryIp: body.primaryIp } : {}), ...(body.privateIp ? { privateIp: body.privateIp } : {}), ...(body.osName ? { osName: body.osName } : {}), ...(body.osVersion ? { osVersion: body.osVersion } : {}), ...(body.kernelVersion ? { kernelVersion: body.kernelVersion } : {}), ...(body.architecture ? { architecture: body.architecture } : {}), ...(body.cpuModel ? { cpuModel: body.cpuModel } : {}), ...(body.cpuCoreCount ? { cpuCoreCount: body.cpuCoreCount } : {}), ...(body.memoryBytes !== undefined ? { memoryBytes: body.memoryBytes } : {}), ...(body.diskBytes !== undefined ? { diskBytes: body.diskBytes } : {}), agentId, agentSecretHash: hashAgentSecret(agentSecret), credentialVersion: (existing?.credentialVersion || 0) + 1, enrollmentStatus: "connected" as const, agentStatus: "online" as const, status: "online" as const, lastHeartbeatAt: now, firstHeartbeatAt: existing?.firstHeartbeatAt || now, enrolledAt: now, agentVersion: body.agentVersion, agentProtocolVersion: body.protocolVersion, agentPackageType: body.packageType, agentReleaseChannel: body.releaseChannel, agentBinarySha256: body.binarySha256, agentCapabilities: body.capabilities, updatedAt: now };
    let serverId;
    if (existing?._id) {
      serverId = existing._id;
      await collections.servers.updateOne({ _id: serverId, orgId: enrollment.orgId }, { $set: serverFields, $unset: { revokedAt: "" } });
    } else {
      let slug = serverSlug(body.displayName || body.hostname);
      if (await collections.servers.findOne({ orgId: enrollment.orgId, slug })) slug = `${slug}-${randomToken(4).toLowerCase()}`;
      const created = await collections.servers.insertOne({ orgId: enrollment.orgId, name: body.displayName || body.hostname, slug, allowlistedRoots: ["/srv"], ...serverFields, createdAt: now });
      serverId = created.insertedId;
    }
    await collections.enrollments.updateOne({ _id: enrollment._id, orgId: enrollment.orgId }, { $set: { usedByAgentId: serverId, updatedAt: now }, $push: { usage: { usedAt: now, serverId, agentId, hostname: body.hostname } } });
    await audit({ orgId: enrollment.orgId, actorType: "agent", actorId: agentId, action: "enrollment.use", targetType: "enrollment", targetId: enrollment._id, result: "success", requestId: req.requestId, metadata: { hostname: body.hostname, uses: enrollment.uses ?? 1 } });
    await audit({ orgId: enrollment.orgId, actorType: "agent", actorId: agentId, action: "enrollment.success", targetType: "server", targetId: serverId, result: "success", requestId: req.requestId, metadata: { merge: Boolean(existing), preservedSlug: existing?.slug || null } });
    // v2 agents authenticate with their own private key, so no secret is returned. v1 keeps returning
    // the agent secret (issued once, never persisted in plaintext).
    res.status(201).json(wantsV2 ? { agentId, serverId, keyProtocolVersion: "agent-v2", pollIntervalSeconds: 30 } : { agentId, agentSecret, serverId, pollIntervalSeconds: 30 });
  } catch (error) { next(error); }
});

// Self-service v2 key rotation. The agent is already authenticated with its CURRENT credential
// (requireSignedAgent) and proves possession of the NEW signing key. The update is atomic and guarded
// by credentialVersion so a concurrent/interrupted rotation fails closed (409, safe to retry).
router.post("/agent/rotate-keys", requireSignedAgent, async (req, res, next) => {
  try {
    const server = req.agentServer!;
    if (!agentV2Enabled()) return res.status(400).json({ error: "agent-v2 protocol is not enabled" });
    const body = agentRotationRequestSchema.parse(req.body);
    const check = verifyRotationV2({ agentId: server.agentId, signingPublicKey: body.signingPublicKey, encryptionPublicKey: body.encryptionPublicKey, issuedAt: body.issuedAt, protocolVersion: body.protocolVersion, proof: body.proof });
    if (!check.valid) {
      await audit({ orgId: server.orgId, actorType: "agent", actorId: server.agentId, action: "agent.credential.rotate", targetType: "server", targetId: server._id, result: "failure", requestId: req.requestId, metadata: { reason: `v2-${check.reason}` } });
      return res.status(401).json({ error: "Invalid key rotation" });
    }
    const plan = planKeyRotation(server, { signingPublicKey: body.signingPublicKey, encryptionPublicKey: body.encryptionPublicKey, now: new Date() });
    const updated = await collections.servers.updateOne({ _id: server._id, orgId: server.orgId, credentialVersion: server.credentialVersion }, { $set: plan });
    if (updated.modifiedCount !== 1) {
      await audit({ orgId: server.orgId, actorType: "agent", actorId: server.agentId, action: "agent.credential.rotate", targetType: "server", targetId: server._id, result: "failure", requestId: req.requestId, metadata: { reason: "superseded" } });
      return res.status(409).json({ error: "Rotation superseded by a concurrent update; retry" });
    }
    await audit({ orgId: server.orgId, actorType: "agent", actorId: server.agentId, action: "agent.credential.rotate", targetType: "server", targetId: server._id, result: "success", requestId: req.requestId, metadata: { migrationState: plan.migrationState, credentialVersion: plan.credentialVersion, signingKeyFingerprint: plan.signingKeyFingerprint } });
    res.json({ keyProtocolVersion: "agent-v2", migrationState: plan.migrationState, credentialVersion: plan.credentialVersion });
  } catch (error) { next(error); }
});

router.post("/agent/poll", requireSignedAgent, async (req, res, next) => {
  try {
    const server = req.agentServer!;
    const body = agentPollRequestSchema.parse(req.body);
    const discovery = body.discovery ? { ...body.discovery, repositories: body.discovery.repositories.map((repository) => ({ ...repository, remote: sanitizeRemoteForStorage(repository.remote) })) } : undefined;
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
      discovery,
      httpHealth: body.httpHealth || [],
      mongo: body.mongo || [],
      expiresAt,
      createdAt: now,
      updatedAt: now
    };
    await collections.telemetry.insertOne(telemetry);
    if (discovery?.settings.length) await ingestConfigurationDiscovery(server, discovery.settings, req.requestId);
    await collections.servers.updateOne({ _id: server._id, orgId: server.orgId }, {
      $set: {
        status: "online",
        agentStatus: "online",
        enrollmentStatus: "connected",
        lastHeartbeatAt: now,
        agentVersion: body.heartbeat.agentVersion,
        agentProtocolVersion: body.heartbeat.protocolVersion,
        agentPackageType: body.heartbeat.packageType,
        agentReleaseChannel: body.heartbeat.releaseChannel,
        agentBinarySha256: body.heartbeat.binarySha256,
        ...(body.heartbeat.capabilities ? { agentCapabilities: body.heartbeat.capabilities } : {}),
        currentState: {
          metrics: body.metrics,
          docker: body.docker || [],
          compose: body.compose || [],
          git: body.git || [],
          discovery,
          httpHealth: body.httpHealth || [],
          mongo: body.mongo || [],
          collectedAt: new Date(body.heartbeat.collectedAt)
        },
        updatedAt: now
      }
    });
    invalidateOperationalContext(server._id.toHexString());
    noStore(req, res, () => undefined);
    const claimed = await claimTasksForAgent(server);
    await Promise.all(claimed.map((task) => audit({ orgId: server.orgId, actorType: "agent", actorId: server.agentId, action: "task.claim", targetType: "agent_task", targetId: taskAuditTargetId(task._id), result: "success", requestId: req.requestId, metadata: { type: task.type } })));
    res.json({ serverId: server._id.toHexString(), tasks: claimed.map((task) => ({ envelope: task.envelope, payload: task.payload })) });
  } catch (error) { next(error); }
});

router.post("/agent/tasks/ack", requireSignedAgent, noStore, async (req, res, next) => {
  try {
    const body = taskAckSchema.parse(req.body);
    const result = await acknowledgeTask(req.agentServer!, body);
    if (result.status === 200 && result.shouldAudit !== false) {
      const action = body.event === "started" ? "task.start" : body.event === "progress" ? "task.progress" : body.event === "succeeded" || body.event === "failed" ? "task.complete" : "task.claim";
      await audit({ orgId: req.agentServer!.orgId, actorType: "agent", actorId: req.agentServer!.agentId, action, targetType: "agent_task", targetId: taskAuditTargetId(body.taskId), result: body.event === "failed" ? "failure" : "success", requestId: req.requestId, metadata: result.auditMetadata });
    }
    res.status(result.status).json(result.body);
  } catch (error) { next(error); }
});

router.use(requireSession, requireCsrf);
router.get("/system/health", requirePermission("status:view"), async (req, res) => res.json(await runtimeHealth(req.orgId)));
router.get("/system/diagnostics", requirePermission("audit:view"), async (req, res) => res.json(await internalDiagnostics(req.orgId)));
router.use(adminEnrollmentRouter);
router.use(aiAssistantRouter);
router.use(aiSettingsRouter);
router.use(configurationRouter);
router.use(agentUpgradeRouter);
router.use(websiteBuilderRouter);
router.use(seoAuditRouter);
router.use(aiWorkforceRouter);
router.use(managementRouter);
router.use(taskRouter);

router.get("/overview", requirePermission("status:view"), async (req, res, next) => {
  try {
    const orgId = requireOrg(req);
    const [servers, projects, audits] = await Promise.all([
      collections.servers.find({ orgId, archivedAt: { $exists: false } }).toArray(),
      collections.projects.find({ orgId, archivedAt: { $exists: false } }).toArray(),
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
    const servers = await collections.servers.find({ orgId, archivedAt: { $exists: false } }, { projection: { agentSecretHash: 0 } }).sort({ createdAt: -1 }).toArray();
    const now = new Date();
    res.json({ servers: servers.map((server) => { const agentStatus = calculateAgentStatus(server.lastHeartbeatAt, server.revokedAt, now); return { ...server, agentStatus, status: agentStatus === "online" ? "online" : agentStatus === "revoked" ? "revoked" : "offline" }; }) });
  } catch (error) { next(error); }
});

router.get("/servers/migration-status", noStore, requirePermission("status:view"), async (req, res, next) => {
  try {
    const orgId = requireOrg(req);
    // Project OUT the legacy secret hash and raw public keys; the report is built from fingerprints/
    // state/version only, so no key material or secret can appear in the observability output.
    const servers = await collections.servers.find({ orgId, archivedAt: { $exists: false } }, { projection: { agentSecretHash: 0, signingPublicKey: 0, encryptionPublicKey: 0 } }).sort({ createdAt: -1 }).toArray();
    res.json(buildMigrationReport(servers.map((server) => ({ ...server, id: server._id.toHexString() }))));
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
