import { z } from "zod";
import { connectivityStatusSchema } from "./connectivity.js";
import { discoveredSettingSchema } from "./configuration.js";

export const objectIdSchema = z.string().min(12).max(64);

export const agentEnrollmentRequestSchema = z.object({
  enrollmentToken: z.string().min(32),
  hostname: z.string().min(1).max(255),
  requestedSlug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
  machineId: z.string().trim().min(1).max(255).optional(),
  agentInstallationId: z.string().trim().min(1).max(255).optional(),
  displayName: z.string().trim().min(1).max(255).optional(),
  primaryIp: z.string().trim().min(1).max(64).optional(),
  privateIp: z.string().trim().min(1).max(64).optional(),
  osName: z.string().trim().min(1).max(120).optional(),
  osVersion: z.string().trim().min(1).max(120).optional(),
  kernelVersion: z.string().trim().min(1).max(120).optional(),
  architecture: z.string().trim().min(1).max(64).optional(),
  cpuModel: z.string().trim().min(1).max(255).optional(),
  cpuCoreCount: z.number().int().positive().max(4096).optional(),
  memoryBytes: z.number().int().nonnegative().optional(),
  diskBytes: z.number().int().nonnegative().optional(),
  agentVersion: z.string().min(1).max(64),
  protocolVersion: z.string().max(64).optional(),
  packageType: z.enum(["tar", "deb", "rpm"]).optional(),
  releaseChannel: z.enum(["stable", "candidate", "preview"]).optional(),
  binarySha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  capabilities: z.array(z.enum(["system", "docker", "compose", "git", "http", "mongo", "environmentDiscovery", "configurationFingerprinting", "encryptedSecretDelivery", "environmentFileWrite", "dockerComposeActivation", "systemdActivation", "configurationValidation", "configurationRollback", "agentUpgrade", "upgradeManifestHandoff"])).default([])
});

export const agentEnrollmentResponseSchema = z.object({
  agentId: z.string(),
  agentSecret: z.string(),
  serverId: z.string(),
  pollIntervalSeconds: z.number().int().min(10).max(3600)
});

export const dockerServiceSchema = z.object({
  name: z.string().max(255),
  image: z.string().max(512).optional(),
  state: z.string().max(128),
  status: z.string().max(512).optional()
});

export const composeServiceSchema = z.object({
  projectName: z.string().max(255),
  service: z.string().max(255),
  state: z.string().max(128),
  configPath: z.string().max(1024).optional()
});

export const gitStatusSchema = z.object({
  projectId: objectIdSchema,
  branch: z.string().optional(),
  commit: z.string().optional(),
  dirty: z.boolean().optional(),
  collectedAt: z.string().datetime()
});

export const httpHealthResultSchema = z.object({
  healthCheckId: objectIdSchema,
  success: z.boolean(),
  statusCode: z.number().int().optional(),
  latencyMs: z.number().nonnegative().optional(),
  errorCategory: z.enum(["dns", "timeout", "tls", "http", "network", "unknown"]).optional(),
  checkedAt: z.string().datetime()
});

export const mongoCheckResultSchema = z.object({
  mongoCheckId: objectIdSchema,
  success: z.boolean(),
  latencyMs: z.number().nonnegative().optional(),
  databaseName: z.string().optional(),
  errorCategory: z.enum(["auth", "network", "timeout", "configuration", "unknown"]).optional(),
  checkedAt: z.string().datetime()
});

export const serverMetricsSchema = z.object({
  collectedAt: z.string().datetime(),
  agentVersion: z.string().min(1),
  uptimeSeconds: z.number().nonnegative(),
  cpu: z.object({
    loadPercent: z.number().min(0).max(100),
    cores: z.number().int().positive(),
    loadAverage: z.tuple([z.number().nonnegative(), z.number().nonnegative(), z.number().nonnegative()]).optional()
  }),
  memory: z.object({
    totalBytes: z.number().nonnegative(),
    usedBytes: z.number().nonnegative()
  }),
  disk: z.array(z.object({
    mount: z.string().max(1024),
    totalBytes: z.number().nonnegative(),
    usedBytes: z.number().nonnegative()
  })).max(100),
  network: z.object({ receivedBytes: z.number().nonnegative(), transmittedBytes: z.number().nonnegative() }).optional()
});

export const applicationDiscoverySchema = z.object({
  collectedAt: z.string().datetime(),
  dockerInstalled: z.boolean(),
  composeProjects: z.array(z.object({ name: z.string().max(255), configPath: z.string().max(1024), services: z.array(z.string().max(255)).max(250) })).max(100),
  repositories: z.array(z.object({ path: z.string().max(1024), branch: z.string().max(255).optional(), commit: z.string().max(64).optional(), remote: z.string().max(2048).optional(), dirty: z.boolean().optional() })).max(100),
  applications: z.array(z.object({ path: z.string().max(1024), type: z.enum(["node", "python", "dotnet"]), name: z.string().max(256) })).max(250),
  settings: z.array(discoveredSettingSchema).max(1000).default([]),
  nginxInstalled: z.boolean(),
  warnings: z.array(z.enum(["mount_boundary_skipped", "symlink_skipped", "unreadable_path", "path_disappeared", "discovery_truncated"])).max(100).default([]),
  discoveryTruncated: z.boolean().default(false),
  truncationCategories: z.array(z.enum(["repositories", "composeProjects", "applications", "settings", "warnings"])).max(5).default([])
});

export const agentPollRequestSchema = z.object({
  heartbeat: z.object({
    collectedAt: z.string().datetime(),
    agentVersion: z.string().min(1),
    protocolVersion: z.string().max(64).optional(),
    packageType: z.enum(["tar", "deb", "rpm"]).optional(),
    releaseChannel: z.enum(["stable", "candidate", "preview"]).optional(),
    binarySha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    capabilities: z.array(z.string().regex(/^[A-Za-z0-9._:-]{1,160}$/)).max(100).optional()
  }),
  metrics: serverMetricsSchema.optional(),
  docker: z.array(dockerServiceSchema).max(250).optional(),
  compose: z.array(composeServiceSchema).max(250).optional(),
  git: z.array(gitStatusSchema).max(100).optional(),
  httpHealth: z.array(httpHealthResultSchema).optional(),
  mongo: z.array(mongoCheckResultSchema).optional(),
  discovery: applicationDiscoverySchema.optional(),
  connectivity: z.array(connectivityStatusSchema).max(10).optional()
});

export const agentTaskSchema = z.object({
  id: z.string(),
  kind: z.enum(["collect"]),
  config: z.object({
    projects: z.array(z.object({
      projectId: objectIdSchema,
      repoPath: z.string().optional(),
      composePath: z.string().optional()
    })),
    httpHealthChecks: z.array(z.object({
      id: objectIdSchema,
      url: z.string().url(),
      timeoutMs: z.number().int().min(100).max(30000)
    })),
    mongoChecks: z.array(z.object({
      id: objectIdSchema,
      databaseNameHint: z.string().optional()
    }))
  })
});

export type AgentPollRequest = z.infer<typeof agentPollRequestSchema>;
export type AgentTask = z.infer<typeof agentTaskSchema>;
