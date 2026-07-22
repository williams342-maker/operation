import express from "express";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { audit } from "./audit.js";
import { requirePermission, requireRecentAuth } from "./auth.js";
import { collections } from "./db.js";
import { hashSecret, randomToken } from "./crypto.js";

export const adminEnrollmentRouter = express.Router();
adminEnrollmentRouter.use("/admin/enrollment", requirePermission("servers:enroll"));

function orgId(req: express.Request) { if (!req.orgId) throw new Error("Missing organization scope"); return req.orgId; }
function actorId(req: express.Request) { if (!req.user?._id) throw new Error("Missing user"); return req.user._id; }
function id(value: unknown) { const raw = String(value || ""); if (!ObjectId.isValid(raw)) throw new Error("Invalid enrollment id"); return new ObjectId(raw); }

const generateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  expiresInMinutes: z.number().int().positive().max(43_200).nullable(),
  maxUses: z.number().int().positive().max(10_000).nullable()
});

adminEnrollmentRouter.post("/admin/enrollment/generate", requireRecentAuth, async (req, res, next) => {
  try {
    const body = generateSchema.parse(req.body);
    const token = `owenr_${randomToken(36)}`;
    const now = new Date();
    const expiresAt = body.expiresInMinutes === null ? undefined : new Date(now.getTime() + body.expiresInMinutes * 60_000);
    const result = await collections.enrollments.insertOne({
      orgId: orgId(req), tokenHash: hashSecret(token), name: body.name, description: body.description || undefined,
      expiresAt, maxUses: body.maxUses ?? undefined, uses: 0, usage: [], createdByUserId: actorId(req), createdAt: now, updatedAt: now
    });
    await audit({ orgId: orgId(req), actorType: "user", actorId: actorId(req), action: "enrollment.create", targetType: "enrollment", targetId: result.insertedId, result: "success", requestId: req.requestId, metadata: { maxUses: body.maxUses ?? "unlimited", expiresInMinutes: body.expiresInMinutes ?? "never" } });
    res.setHeader("Cache-Control", "no-store");
    res.status(201).json({ id: result.insertedId, token, name: body.name, expiresAt, maxUses: body.maxUses });
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
