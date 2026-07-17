import { z } from "zod";

export const objectIdSchema = z.string().min(12).max(64);

export const agentEnrollmentRequestSchema = z.object({
  enrollmentToken: z.string().min(32),
  hostname: z.string().min(1).max(255),
  agentVersion: z.string().min(1).max(64),
  capabilities: z.array(z.enum(["system", "docker", "compose", "git", "http", "mongo"])).default([])
});

export const agentEnrollmentResponseSchema = z.object({
  agentId: z.string(),
  agentSecret: z.string(),
  serverId: z.string(),
  pollIntervalSeconds: z.number().int().min(10).max(3600)
});

export const dockerServiceSchema = z.object({
  name: z.string(),
  image: z.string().optional(),
  state: z.string(),
  status: z.string().optional()
});

export const composeServiceSchema = z.object({
  projectName: z.string(),
  service: z.string(),
  state: z.string(),
  configPath: z.string().optional()
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
    cores: z.number().int().positive()
  }),
  memory: z.object({
    totalBytes: z.number().nonnegative(),
    usedBytes: z.number().nonnegative()
  }),
  disk: z.array(z.object({
    mount: z.string(),
    totalBytes: z.number().nonnegative(),
    usedBytes: z.number().nonnegative()
  }))
});

export const agentPollRequestSchema = z.object({
  heartbeat: z.object({
    collectedAt: z.string().datetime(),
    agentVersion: z.string().min(1)
  }),
  metrics: serverMetricsSchema.optional(),
  docker: z.array(dockerServiceSchema).optional(),
  compose: z.array(composeServiceSchema).optional(),
  git: z.array(gitStatusSchema).optional(),
  httpHealth: z.array(httpHealthResultSchema).optional(),
  mongo: z.array(mongoCheckResultSchema).optional()
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
