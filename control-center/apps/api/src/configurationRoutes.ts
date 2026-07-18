import express from "express";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { hasPermission, recognizeProvider, settingNameSchema, settingTypes } from "@control-center/shared";
import { audit } from "./audit.js";
import { noStore, requirePermission, requireRecentAuth } from "./auth.js";
import { collections, oid } from "./db.js";
import { encryptConfigurationValue } from "./configurationVault.js";

export const configurationRouter = express.Router();
const environmentKinds = ["production", "staging", "development", "testing", "preview", "ci", "custom"] as const;

function orgId(req: express.Request) { if (!req.orgId) throw new Error("Organization scope required"); return req.orgId; }
function actorId(req: express.Request) { if (!req.user?._id) throw new Error("User required"); return req.user._id; }
function safeDefinition(row: Record<string, unknown>) { const { envelope, publicValue, ...safe } = row; void envelope; void publicValue; return safe; }

configurationRouter.get("/configuration/environments", requirePermission("configuration:view"), async (req, res, next) => {
  try { res.json({ environments: await collections.configurationEnvironments.find({ orgId: orgId(req) }).sort({ name: 1 }).toArray() }); } catch (error) { next(error); }
});

configurationRouter.post("/configuration/environments", requirePermission("configuration:manage-integrations"), async (req, res, next) => {
  try {
    const body = z.object({ projectId: z.string(), name: z.string().trim().min(1).max(80), kind: z.enum(environmentKinds), protected: z.boolean().default(false) }).parse(req.body);
    const projectId = oid(body.projectId); if (!await collections.projects.findOne({ _id: projectId, orgId: orgId(req) })) return res.status(404).json({ error: "Project not found" });
    const now = new Date(); const result = await collections.configurationEnvironments.insertOne({ orgId: orgId(req), projectId, name: body.name, kind: body.kind, protected: body.protected, createdAt: now, updatedAt: now });
    res.status(201).json({ id: result.insertedId });
  } catch (error) { next(error); }
});

configurationRouter.get("/configuration/definitions", requirePermission("configuration:view"), async (req, res, next) => {
  try {
    const projectId = String(req.query.projectId || ""); if (!ObjectId.isValid(projectId)) return res.status(400).json({ error: "projectId is required" });
    const org = orgId(req); if (!await collections.projects.findOne({ _id: oid(projectId), orgId: org })) return res.status(404).json({ error: "Project not found" });
    const definitions = await collections.configurationDefinitions.find({ orgId: org, projectId: oid(projectId) }).sort({ name: 1 }).toArray();
    const versions = await collections.configurationVersions.find({ orgId: org, projectId: oid(projectId) }, { projection: { envelope: 0, publicValue: 0, fingerprint: 0 } }).sort({ createdAt: -1 }).toArray();
    res.json({ definitions, versions: versions.map((row) => safeDefinition(row as unknown as Record<string, unknown>)) });
  } catch (error) { next(error); }
});

configurationRouter.post("/configuration/definitions", requirePermission("configuration:manage-integrations"), async (req, res, next) => {
  try {
    const body = z.object({ projectId: z.string(), applicationPath: z.string().max(1024).optional(), name: settingNameSchema, description: z.string().max(1000).optional(), type: z.enum(settingTypes), secret: z.boolean(), required: z.boolean().default(false), provider: z.string().max(120).optional(), usage: z.enum(["runtime", "build", "worker", "scheduler", "proxy", "unknown"]).default("unknown"), services: z.array(z.string().max(255)).max(30).default([]), authoritativePath: z.string().max(1024).optional() }).parse(req.body);
    if (body.type === "secret" && !body.secret) return res.status(400).json({ error: "Secret type must be classified as secret" });
    const projectId = oid(body.projectId); if (!await collections.projects.findOne({ _id: projectId, orgId: orgId(req) })) return res.status(404).json({ error: "Project not found" });
    const now = new Date(); const result = await collections.configurationDefinitions.insertOne({ orgId: orgId(req), projectId, applicationPath: body.applicationPath, name: body.name, description: body.description, type: body.type, secret: body.secret, required: body.required, provider: body.provider || recognizeProvider(body.name), usage: body.usage, services: body.services, sources: ["manual"], sourcePaths: [], authoritativePath: body.authoritativePath, status: "missing", discovered: false, createdAt: now, updatedAt: now });
    await audit({ orgId: orgId(req), actorType: "user", actorId: actorId(req), action: "configuration.definition.create", targetType: "configuration-definition", targetId: result.insertedId, result: "success", requestId: req.requestId, metadata: { variable: body.name, secret: body.secret } });
    res.status(201).json({ id: result.insertedId });
  } catch (error) { next(error); }
});

const versionBody = z.object({ environmentId: z.string(), serverId: z.string().optional(), service: z.string().max(255).optional(), value: z.string().min(1).max(65536), changeReason: z.string().trim().min(4).max(1000) });

configurationRouter.post("/configuration/definitions/:id/versions", noStore, requireRecentAuth, async (req, res, next) => {
  try {
    const org = orgId(req); const definition = await collections.configurationDefinitions.findOne({ _id: oid(String(req.params.id)), orgId: org }); if (!definition?._id) return res.status(404).json({ error: "Definition not found" });
    const permission = definition.secret ? (definition.activeVersion ? "secrets:replace" : "secrets:create") : "configuration:edit-public";
    if (!hasPermission(req.user!.role, permission)) return res.status(403).json({ error: "Insufficient permission" });
    const body = versionBody.parse(req.body); const environment = await collections.configurationEnvironments.findOne({ _id: oid(body.environmentId), orgId: org, projectId: definition.projectId }); if (!environment?._id) return res.status(404).json({ error: "Environment not found" });
    if (body.serverId) {
      const project = await collections.projects.findOne({ _id: definition.projectId, orgId: org, primaryServerId: oid(body.serverId), archivedAt: { $exists: false } });
      if (!project) return res.status(404).json({ error: "Server is not assigned to this project" });
    }
    if (definition.type === "url") { try { new URL(body.value); } catch { return res.status(400).json({ error: "Invalid URL value" }); } }
    if (definition.type === "boolean" && !/^(true|false)$/i.test(body.value)) return res.status(400).json({ error: "Boolean value must be true or false" });
    if (definition.type === "integer" && !/^-?\d+$/.test(body.value)) return res.status(400).json({ error: "Integer value is invalid" });
    if (definition.type === "json") { try { JSON.parse(body.value); } catch { return res.status(400).json({ error: "JSON value is invalid" }); } }
    const latest = await collections.configurationVersions.find({ orgId: org, definitionId: definition._id, environmentId: environment._id }).sort({ version: -1 }).limit(1).next(); const version = (latest?.version || 0) + 1; const binding = `${org}:${definition._id}:${environment._id}:${version}`; const now = new Date();
    const record = { orgId: org, definitionId: definition._id, projectId: definition.projectId, environmentId: environment._id, serverId: body.serverId ? oid(body.serverId) : undefined, service: body.service, version, classification: definition.secret ? "secret" as const : "public" as const, ...(definition.secret ? { envelope: encryptConfigurationValue(body.value, binding), masked: "••••••••" } : { publicValue: body.value, masked: body.value }), state: "pending" as const, changeReason: body.changeReason, createdByUserId: actorId(req), validationState: "unverified" as const, createdAt: now, updatedAt: now };
    const result = await collections.configurationVersions.insertOne(record); await collections.configurationDefinitions.updateOne({ _id: definition._id, orgId: org }, { $set: { activeVersion: version, status: "pending", updatedAt: now } });
    await audit({ orgId: org, actorType: "user", actorId: actorId(req), action: "configuration.version.create", targetType: "configuration-version", targetId: result.insertedId, result: "success", requestId: req.requestId, metadata: { variable: definition.name, version, secret: definition.secret, environment: environment.name } });
    res.status(201).json({ id: result.insertedId, version, masked: record.masked, state: record.state });
  } catch (error) { next(error); }
});

configurationRouter.get("/configuration/capabilities/:serverId", requirePermission("configuration:view"), async (req, res, next) => {
  try { const server = await collections.servers.findOne({ _id: oid(String(req.params.serverId)), orgId: orgId(req) }, { projection: { agentCapabilities: 1, agentVersion: 1 } }); if (!server) return res.status(404).json({ error: "Server not found" }); res.json({ agentVersion: server.agentVersion, capabilities: server.agentCapabilities || [], writableConfiguration: false }); } catch (error) { next(error); }
});
