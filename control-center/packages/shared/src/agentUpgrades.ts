import crypto from "node:crypto";
import { z } from "zod";
import { reviewAuthorizationSchema } from "./configurationDeployment.js";
import { settingNameSchema } from "./configuration.js";

const safeId = z.string().regex(/^[A-Za-z0-9._:-]{1,160}$/);
export const upgradeStates = ["up_to_date", "upgrade_available", "upgrade_required", "manual_bootstrap_required", "incompatible", "offline", "planned", "awaiting_approval", "queued", "upgrading", "validating", "complete", "failed", "rolled_back"] as const;
export const releaseChannels = ["stable", "candidate", "preview"] as const;
export const packageTypes = ["tar", "deb", "rpm"] as const;
export const rolloutStrategies = ["canary", "sequential", "fixed_batch", "percentage_batch"] as const;
const semver = z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/);

export const agentReleaseSchema = z.object({
  id: safeId,
  version: semver,
  protocolVersion: safeId,
  minimumSourceVersion: semver,
  supportedOperatingSystems: z.array(safeId).min(1).max(30),
  supportedArchitectures: z.array(safeId).min(1).max(30),
  packageType: z.enum(packageTypes),
  channel: z.enum(releaseChannels),
  artifactUrl: z.string().url().refine((value) => new URL(value).protocol === "https:", "Artifact URL must use HTTPS"),
  artifactSha256: z.string().regex(/^[a-f0-9]{64}$/),
  artifactSizeBytes: z.number().int().positive().max(2 * 1024 * 1024 * 1024),
  artifactSignature: z.string().min(80).max(1000),
  signatureKeyId: safeId,
  manifestDigest: z.string().regex(/^[a-f0-9]{64}$/),
  manifestSignature: z.string().min(80).max(1000),
  requiredCapabilities: z.array(settingNameSchema.or(safeId)).max(100),
  upgradeFrom: z.array(semver).max(100).default([]),
  rollbackTo: z.array(semver).max(100).default([]),
  publicationStatus: z.enum(["draft", "published"]),
  revoked: z.boolean(),
  classification: z.enum(["optional", "mandatory"])
}).strict();

export const agentInventorySchema = z.object({
  serverId: z.string().min(12).max(64), name: z.string().min(1).max(255), slug: z.string().max(255).optional(), projectId: z.string().min(12).max(64).optional(), projectName: z.string().min(1).max(255).optional(), environmentKind: z.string().max(80).optional(), protected: z.boolean(), online: z.boolean(), lastHeartbeatAt: z.string().datetime().optional(), agentVersion: semver.optional(), protocolVersion: safeId.optional(), capabilities: z.array(safeId).max(100), os: safeId.optional(), architecture: safeId.optional(), packageType: z.enum(packageTypes).optional(), releaseChannel: z.enum(releaseChannels).optional(), binarySha256: z.string().regex(/^[a-f0-9]{64}$/).optional(), currentTaskId: z.string().max(64).optional(), currentUpgradeState: z.enum(upgradeStates).optional()
}).strict();

export const agentUpgradeManifestSchema = z.object({
  schemaVersion: z.literal("agent-upgrade-v1"), upgradeId: safeId, serverId: z.string().min(12).max(64), expectedAgentId: safeId, expectedCurrentVersion: semver, expectedCurrentBinarySha256: z.string().regex(/^[a-f0-9]{64}$/).optional(), targetVersion: semver, releaseId: safeId, artifactSha256: z.string().regex(/^[a-f0-9]{64}$/), artifactSignature: z.string().min(80).max(1000), signatureKeyId: safeId, releaseManifestDigest: z.string().regex(/^[a-f0-9]{64}$/), planDigest: z.string().regex(/^[a-f0-9]{64}$/), operatingSystem: safeId, architecture: safeId, packageType: z.enum(packageTypes), requiredCapabilities: z.array(safeId).max(100), expiresAt: z.string().datetime(), nonce: z.string().min(16).max(160), reviewAuthorization: reviewAuthorizationSchema.optional()
}).strict();
export const agentUpgradeResultSchema = z.object({ phase: z.enum(["queued", "upgrading", "validating", "complete", "failed", "rolled_back", "rollback_failed"]), upgradeId: safeId, targetVersion: semver.optional(), errorCategory: z.enum(["download", "digest", "signature", "package", "architecture", "disk", "restart", "heartbeat", "capabilities", "discovery", "rollback", "validation", "unknown"]).optional() }).strict();

export type AgentRelease = z.infer<typeof agentReleaseSchema>;
export type AgentInventory = z.infer<typeof agentInventorySchema>;
export type AgentUpgradeManifest = z.infer<typeof agentUpgradeManifestSchema>;
export type UpgradeState = typeof upgradeStates[number];

function tuple(value?: string) { const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(value || ""); return match ? { core: [Number(match[1]), Number(match[2]), Number(match[3])], prerelease: match[4]?.split(".") } : undefined; }
export function compareAgentVersions(left?: string, right?: string) { const a = tuple(left); const b = tuple(right); if (!a || !b) return undefined; for (let i = 0; i < 3; i += 1) if (a.core[i] !== b.core[i]) return a.core[i] < b.core[i] ? -1 : 1; if (!a.prerelease && !b.prerelease) return 0; if (!a.prerelease) return 1; if (!b.prerelease) return -1; const length = Math.max(a.prerelease.length, b.prerelease.length); for (let i = 0; i < length; i += 1) { if (a.prerelease[i] === undefined) return -1; if (b.prerelease[i] === undefined) return 1; if (a.prerelease[i] === b.prerelease[i]) continue; const leftNumeric = /^\d+$/.test(a.prerelease[i]); const rightNumeric = /^\d+$/.test(b.prerelease[i]); if (leftNumeric && rightNumeric) return Number(a.prerelease[i]) < Number(b.prerelease[i]) ? -1 : 1; if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1; return a.prerelease[i] < b.prerelease[i] ? -1 : 1; } return 0; }

const releaseArtifactSchema = z.object({
  role: z.enum(["agent_package", "artifact_signature", "bootstrap_installer", "public_key", "rollback_script", "release_catalog", "sbom", "systemd_unit"]),
  filename: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/),
  sizeBytes: z.number().int().positive().max(2 * 1024 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/)
}).strict();

export const bootstrapReleaseManifestSchema = z.object({
  schemaVersion: z.literal("opsworkbench-agent-bootstrap-v1"),
  releaseId: safeId,
  version: semver,
  protocolVersion: safeId,
  buildTimestamp: z.string().datetime(),
  sourceCommit: z.string().regex(/^[a-f0-9]{40}$/),
  supportedOperatingSystems: z.array(z.literal("linux")).length(1),
  supportedDistributions: z.array(z.enum(["debian", "ubuntu"])).min(1),
  supportedArchitectures: z.array(z.enum(["x64"])).length(1),
  packageType: z.literal("tar"),
  minimumSourceVersion: semver,
  maximumSourceVersion: semver.optional(),
  artifacts: z.array(releaseArtifactSchema).min(5).max(20),
  requiredCapabilities: z.array(safeId).min(1).max(100),
  channel: z.literal("candidate"),
  upgradeFrom: z.array(semver).min(1).max(100),
  rollbackTo: z.array(semver).min(1).max(100),
  publicationStatus: z.enum(["draft", "published"]),
  revoked: z.literal(false),
  expiresAt: z.string().datetime().optional(),
  signingKeyId: safeId,
  nonProductionOnly: z.literal(true)
}).strict().superRefine((value, context) => { const roles = new Set(value.artifacts.map((artifact) => artifact.role)); for (const required of ["agent_package", "bootstrap_installer", "rollback_script", "release_catalog", "sbom"] as const) if (!roles.has(required)) context.addIssue({ code: z.ZodIssueCode.custom, message: `Missing required artifact role: ${required}` }); if (new Set(value.artifacts.map((artifact) => artifact.filename)).size !== value.artifacts.length) context.addIssue({ code: z.ZodIssueCode.custom, message: "Duplicate artifact filename" }); if (value.maximumSourceVersion && compareAgentVersions(value.minimumSourceVersion, value.maximumSourceVersion)! > 0) context.addIssue({ code: z.ZodIssueCode.custom, message: "Minimum source version exceeds maximum source version" }); });
export type BootstrapReleaseManifest = z.infer<typeof bootstrapReleaseManifestSchema>;

export function agentReleaseManifestDigest(release: Pick<AgentRelease, "id" | "version" | "protocolVersion" | "minimumSourceVersion" | "supportedOperatingSystems" | "supportedArchitectures" | "packageType" | "channel" | "artifactUrl" | "artifactSha256" | "artifactSizeBytes" | "artifactSignature" | "signatureKeyId" | "requiredCapabilities" | "upgradeFrom" | "rollbackTo" | "classification">) {
  const canonical = { id: release.id, version: release.version, protocolVersion: release.protocolVersion, minimumSourceVersion: release.minimumSourceVersion, supportedOperatingSystems: [...release.supportedOperatingSystems].sort(), supportedArchitectures: [...release.supportedArchitectures].sort(), packageType: release.packageType, channel: release.channel, artifactUrl: release.artifactUrl, artifactSha256: release.artifactSha256, artifactSizeBytes: release.artifactSizeBytes, artifactSignature: release.artifactSignature, signatureKeyId: release.signatureKeyId, requiredCapabilities: [...release.requiredCapabilities].sort(), upgradeFrom: [...release.upgradeFrom].sort(), rollbackTo: [...release.rollbackTo].sort(), classification: release.classification };
  return crypto.createHash("sha256").update(JSON.stringify(canonical, Object.keys(canonical).sort())).digest("hex");
}

export function approvedCompatibleReleases(server: AgentInventory, releases: AgentRelease[]) {
  return releases.filter((release) => release.publicationStatus === "published" && !release.revoked && server.agentVersion && server.os && server.architecture && server.packageType && release.supportedOperatingSystems.includes(server.os) && release.supportedArchitectures.includes(server.architecture) && release.packageType === server.packageType && (!server.releaseChannel || release.channel === server.releaseChannel) && compareAgentVersions(server.agentVersion, release.minimumSourceVersion)! >= 0 && (!release.upgradeFrom.length || release.upgradeFrom.includes(server.agentVersion))).sort((a, b) => compareAgentVersions(b.version, a.version) || 0);
}

export function evaluateAgentCompatibility(server: AgentInventory, releases: AgentRelease[], requiredCapabilities: string[]) {
  const missingCapabilities = requiredCapabilities.filter((capability) => !server.capabilities.includes(capability));
  if (!server.online) return { state: "offline" as const, missingCapabilities, remoteUpgradeSupported: server.capabilities.includes("agentUpgrade"), manualBootstrapRequired: false };
  if (!server.agentVersion || !server.os || !server.architecture || !server.packageType) return { state: "manual_bootstrap_required" as const, missingCapabilities, remoteUpgradeSupported: false, manualBootstrapRequired: true };
  const compatible = approvedCompatibleReleases(server, releases); const latest = compatible[0]; const remoteUpgradeSupported = server.capabilities.includes("agentUpgrade");
  const platformReleases = releases.filter((release) => release.publicationStatus === "published" && !release.revoked && release.supportedOperatingSystems.includes(server.os!) && release.supportedArchitectures.includes(server.architecture!) && release.packageType === server.packageType && (!server.releaseChannel || release.channel === server.releaseChannel));
  const requiresIntermediateVersion = !latest && platformReleases.some((release) => compareAgentVersions(server.agentVersion, release.minimumSourceVersion)! < 0 || (release.upgradeFrom.length > 0 && !release.upgradeFrom.includes(server.agentVersion!)));
  if (!latest) return { state: requiresIntermediateVersion || !remoteUpgradeSupported ? "manual_bootstrap_required" as const : "incompatible" as const, missingCapabilities, remoteUpgradeSupported, manualBootstrapRequired: requiresIntermediateVersion || !remoteUpgradeSupported, requiresIntermediateVersion };
  const comparison = compareAgentVersions(server.agentVersion, latest.version);
  if (comparison === 0 && !missingCapabilities.length) return { state: "up_to_date" as const, missingCapabilities, latestCompatibleVersion: latest.version, latestCompatibleReleaseId: latest.id, requiredMinimumVersion: latest.minimumSourceVersion, remoteUpgradeSupported, manualBootstrapRequired: false };
  if (!remoteUpgradeSupported) return { state: "manual_bootstrap_required" as const, missingCapabilities, latestCompatibleVersion: latest.version, latestCompatibleReleaseId: latest.id, requiredMinimumVersion: latest.minimumSourceVersion, remoteUpgradeSupported, manualBootstrapRequired: true };
  return { state: latest.classification === "mandatory" || missingCapabilities.length ? "upgrade_required" as const : "upgrade_available" as const, missingCapabilities, latestCompatibleVersion: latest.version, latestCompatibleReleaseId: latest.id, requiredMinimumVersion: latest.minimumSourceVersion, remoteUpgradeSupported, manualBootstrapRequired: false, requiresIntermediateVersion: false };
}

export function canonicalUpgradePlan(input: Omit<AgentUpgradeManifest, "planDigest">) { return JSON.stringify(input, Object.keys(input).sort()); }
export function agentUpgradePlanDigest(input: Omit<AgentUpgradeManifest, "planDigest">) { return crypto.createHash("sha256").update(canonicalUpgradePlan(input)).digest("hex"); }

export const fleetRolloutSchema = z.object({ releaseId: safeId, serverIds: z.array(z.string().min(12).max(64)).min(1).max(1000), perServerPlanDigests: z.record(z.string().regex(/^[a-f0-9]{64}$/)), strategy: z.enum(rolloutStrategies), batchSize: z.number().int().positive().max(100).optional(), percentage: z.number().int().min(1).max(100).optional(), failureThreshold: z.number().int().min(0).max(100), allowedEnvironments: z.array(z.string().max(80)).min(1).max(20), expiresAt: z.string().datetime() }).strict().superRefine((value, context) => { if (new Set(value.serverIds).size !== value.serverIds.length) context.addIssue({ code: z.ZodIssueCode.custom, message: "Duplicate server in rollout" }); if (value.serverIds.some((id) => !value.perServerPlanDigests[id])) context.addIssue({ code: z.ZodIssueCode.custom, message: "Every server requires a plan digest" }); });
export function fleetRolloutDigest(input: z.infer<typeof fleetRolloutSchema>) { const parsed = fleetRolloutSchema.parse(input); return crypto.createHash("sha256").update(JSON.stringify({ ...parsed, serverIds: [...parsed.serverIds].sort(), perServerPlanDigests: Object.fromEntries(Object.entries(parsed.perServerPlanDigests).sort()) })).digest("hex"); }
export function nextRolloutAction(input: { state: "running" | "paused" | "cancelled"; completed: number; failed: number; total: number; failureThreshold: number; canaryComplete: boolean }) { if (input.state !== "running") return input.state; if (input.failed > input.failureThreshold) return "paused" as const; if (!input.canaryComplete && input.completed + input.failed > 0) return input.failed ? "paused" as const : "continue" as const; return input.completed + input.failed >= input.total ? "complete" as const : "continue" as const; }
