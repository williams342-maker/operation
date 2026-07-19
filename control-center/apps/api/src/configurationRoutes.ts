import express from "express";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { deploymentCapabilities, hasPermission, recognizeProvider, settingNameSchema, settingTypes } from "@control-center/shared";
import { audit } from "./audit.js";
import { noStore, requirePermission, requireRecentAuth } from "./auth.js";
import { collections, oid } from "./db.js";
import { encryptConfigurationValue } from "./configurationVault.js";
import { decryptConfigurationValue } from "./configurationVault.js";
import { assertApproverSeparation, assertDeploymentPolicy, encryptDeploymentValues } from "./configurationDeployment.js";
import { createTask } from "./tasks.js";
import { validatePublicHealthCheckUrl } from "./urlDiscovery.js";

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
  try { const server = await collections.servers.findOne({ _id: oid(String(req.params.serverId)), orgId: orgId(req) }, { projection: { agentCapabilities: 1, agentVersion: 1 } }); if (!server) return res.status(404).json({ error: "Server not found" }); const capabilities = server.agentCapabilities || []; res.json({ agentVersion: server.agentVersion, capabilities, writableConfiguration: deploymentCapabilities.every((item) => capabilities.includes(item)), productionDeployment: false }); } catch (error) { next(error); }
});

const targetProfileBody = z.object({ projectId: z.string(), environmentId: z.string(), serverId: z.string(), repositoryRoot: z.string().min(1).max(1024), environmentFilePath: z.string().min(1).max(1024), composePath: z.string().min(1).max(1024), composeProject: z.string().regex(/^[A-Za-z0-9._:-]{1,160}$/), statelessServices: z.array(z.string().regex(/^[A-Za-z0-9._:-]{1,160}$/)).min(1).max(30), protectedServices: z.array(z.string().regex(/^[A-Za-z0-9._:-]{1,160}$/)).max(30), healthChecks: z.array(z.object({ id: z.string().regex(/^[A-Za-z0-9._:-]{1,160}$/), url: z.string().url(), timeoutMs: z.number().int().min(100).max(30000) }).strict()).min(1).max(30) }).strict();

configurationRouter.post("/configuration/deployment-targets", noStore, requireRecentAuth, requirePermission("configuration:manage-integrations"), async (req, res, next) => {
  try {
    const body = targetProfileBody.parse(req.body); const org = orgId(req); const projectId = oid(body.projectId); const environmentId = oid(body.environmentId); const serverId = oid(body.serverId);
    const [project, environment, server] = await Promise.all([collections.projects.findOne({ _id: projectId, orgId: org, primaryServerId: serverId }), collections.configurationEnvironments.findOne({ _id: environmentId, orgId: org, projectId }), collections.servers.findOne({ _id: serverId, orgId: org })]);
    if (!project || !environment || !server) return res.status(404).json({ error: "Scoped deployment target was not found" });
    assertDeploymentPolicy({ ...body, environmentKind: environment.kind, protected: environment.protected }, server.agentCapabilities || [], server.agentVersion);
    await Promise.all(body.healthChecks.map((check) => validatePublicHealthCheckUrl(check.url)));
    const latest = await collections.configurationTargetProfiles.find({ orgId: org, projectId, environmentId }).sort({ revision: -1 }).limit(1).next(); const revision = (latest?.revision || 0) + 1; const now = new Date();
    const result = await collections.configurationTargetProfiles.insertOne({ orgId: org, projectId, environmentId, serverId, revision, repositoryRoot: body.repositoryRoot, environmentFilePath: body.environmentFilePath, composePath: body.composePath, composeProject: body.composeProject, statelessServices: body.statelessServices, protectedServices: body.protectedServices, healthChecks: body.healthChecks, enabled: true, createdByUserId: actorId(req), createdAt: now, updatedAt: now });
    res.status(201).json({ id: result.insertedId, revision, productionDeployment: false });
  } catch (error) { next(error); }
});

const planBody = z.object({ projectId: z.string(), environmentId: z.string(), targetProfileId: z.string(), versionIds: z.array(z.string()).min(1).max(250), expectedConfigurationDigest: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
configurationRouter.post("/configuration/deployment-plans", noStore, requireRecentAuth, requirePermission("configuration:deploy-non-production"), async (req, res, next) => {
  try {
    const body = planBody.parse(req.body); const org = orgId(req); const projectId = oid(body.projectId); const environmentId = oid(body.environmentId); const profile = await collections.configurationTargetProfiles.findOne({ _id: oid(body.targetProfileId), orgId: org, projectId, environmentId, enabled: true });
    if (!profile?._id) return res.status(404).json({ error: "Deployment target not found" }); const environment = await collections.configurationEnvironments.findOne({ _id: environmentId, orgId: org, projectId }); const server = await collections.servers.findOne({ _id: profile.serverId, orgId: org }); if (!environment || !server) return res.status(404).json({ error: "Scoped environment or server not found" });
    assertDeploymentPolicy({ ...profile, environmentKind: environment.kind, protected: environment.protected }, server.agentCapabilities || [], server.agentVersion);
    await Promise.all(profile.healthChecks.map((check) => validatePublicHealthCheckUrl(check.url)));
    const versionIds = body.versionIds.map(oid); const count = await collections.configurationVersions.countDocuments({ _id: { $in: versionIds }, orgId: org, projectId, environmentId, state: "pending" }); if (count !== versionIds.length) return res.status(409).json({ error: "Every selected version must be pending and organization-scoped" });
    const latest = await collections.configurationDeploymentPlans.find({ orgId: org, projectId, environmentId }).sort({ revision: -1 }).limit(1).next(); const revision = (latest?.revision || 0) + 1; const now = new Date(); const result = await collections.configurationDeploymentPlans.insertOne({ orgId: org, projectId, environmentId, serverId: profile.serverId, targetProfileId: profile._id, targetProfileRevision: profile.revision, revision, versionIds, expectedConfigurationDigest: body.expectedConfigurationDigest, state: "pending_approval", createdByUserId: actorId(req), createdAt: now, updatedAt: now });
    await audit({ orgId: org, actorType: "user", actorId: actorId(req), action: "configuration.deployment.plan", targetType: "configuration-deployment-plan", targetId: result.insertedId, result: "success", requestId: req.requestId, metadata: { revision, variableCount: versionIds.length } }); res.status(201).json({ id: result.insertedId, revision, state: "pending_approval" });
  } catch (error) { next(error); }
});

configurationRouter.post("/configuration/deployment-plans/:id/approve", noStore, requireRecentAuth, requirePermission("configuration:approve-non-production"), async (req, res, next) => {
  try {
    const org = orgId(req); const plan = await collections.configurationDeploymentPlans.findOne({ _id: oid(String(req.params.id)), orgId: org, state: "pending_approval" }); if (!plan?._id) return res.status(404).json({ error: "Pending deployment plan not found" }); assertApproverSeparation(plan.createdByUserId.toHexString(), actorId(req).toHexString());
    const [profile, environment, server, versions] = await Promise.all([collections.configurationTargetProfiles.findOne({ _id: plan.targetProfileId, orgId: org, revision: plan.targetProfileRevision, enabled: true }), collections.configurationEnvironments.findOne({ _id: plan.environmentId, orgId: org, projectId: plan.projectId }), collections.servers.findOne({ _id: plan.serverId, orgId: org }), collections.configurationVersions.find({ _id: { $in: plan.versionIds }, orgId: org, projectId: plan.projectId, environmentId: plan.environmentId, state: "pending" }).toArray()]);
    if (!profile || !environment || !server?._id || versions.length !== plan.versionIds.length) return res.status(409).json({ error: "Deployment plan is stale" }); assertDeploymentPolicy({ ...profile, environmentKind: environment.kind, protected: environment.protected }, server.agentCapabilities || [], server.agentVersion); await Promise.all(profile.healthChecks.map((check) => validatePublicHealthCheckUrl(check.url)));
    const definitions = await collections.configurationDefinitions.find({ _id: { $in: versions.map((item) => item.definitionId) }, orgId: org, projectId: plan.projectId }).toArray(); const names = new Map(definitions.map((item) => [item._id!.toHexString(), item.name])); const values: Record<string, string> = {}; const mutations = versions.map((version) => { const name = names.get(version.definitionId.toHexString()); if (!name) throw new Error("Configuration definition missing"); const valueRef = `v:${version._id!.toHexString()}`; const binding = `${org}:${version.definitionId}:${plan.environmentId}:${version.version}`; values[valueRef] = version.classification === "secret" ? decryptConfigurationValue(version.envelope!, binding) : version.publicValue!; return { name, versionId: version._id!.toHexString(), secret: version.classification === "secret", operation: "update" as const, valueRef }; });
    const deploymentId = new ObjectId(); const payload = { schemaVersion: "configuration-deployment-v1" as const, action: "configuration.apply.v1" as const, planId: plan._id.toHexString(), planRevision: plan.revision, deploymentId: deploymentId.toHexString(), environmentId: plan.environmentId.toHexString(), environmentKind: environment.kind as "staging" | "development" | "testing" | "preview" | "ci", protected: false as const, targetProfileId: profile._id.toHexString(), targetProfileRevision: profile.revision, repositoryRoot: profile.repositoryRoot, environmentFilePath: profile.environmentFilePath, composePath: profile.composePath, composeProject: profile.composeProject, statelessServices: profile.statelessServices, protectedServices: profile.protectedServices, healthChecks: profile.healthChecks, mutations, encryptedValues: encryptDeploymentValues(values, server.agentSecretHash), expectedConfigurationDigest: plan.expectedConfigurationDigest, automaticRollback: true as const };
    const task = await createTask({ orgId: org, server: server as typeof server & { _id: ObjectId }, projectId: plan.projectId, type: "configuration.apply", payload: { projects: [], httpHealthChecks: [], mongoChecks: [], configurationDeployment: payload }, idempotencyKey: `configuration-plan:${plan._id}:${plan.revision}`, createdByUserId: actorId(req), expiresAt: new Date(Date.now() + 15 * 60 * 1000) });
    Object.keys(values).forEach((key) => { values[key] = ""; delete values[key]; }); const now = new Date(); await collections.configurationDeploymentPlans.updateOne({ _id: plan._id, orgId: org, state: "pending_approval" }, { $set: { state: "queued", approvedByUserId: actorId(req), approvedAt: now, deploymentTaskId: task._id, updatedAt: now } }); await audit({ orgId: org, actorType: "user", actorId: actorId(req), action: "configuration.deployment.approve", targetType: "configuration-deployment-plan", targetId: plan._id, result: "success", requestId: req.requestId, metadata: { revision: plan.revision, variableCount: versions.length } }); res.json({ state: "queued", taskId: task._id });
  } catch (error) { next(error); }
});
