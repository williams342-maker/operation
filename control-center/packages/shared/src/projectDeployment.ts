import { z } from "zod";

const safeId = z.string().regex(/^[A-Za-z0-9._:-]{1,160}$/);
const revision = z.string().regex(/^[a-f0-9]{40}$/);

export const projectDeploymentCapabilities = ["projectDeploymentExecution", "projectDeploymentRollback", "dockerComposeActivation", "configurationValidation"] as const;

export const projectDeploymentPayloadSchema = z.object({
  schemaVersion: z.literal("project-deployment-v1"),
  action: z.literal("project.deploy.v1"),
  deploymentId: z.string().min(12).max(64),
  planDigest: z.string().regex(/^[a-f0-9]{64}$/),
  environmentKind: z.enum(["staging", "preview", "testing"]),
  protected: z.literal(false),
  targetProfileId: z.string().min(12).max(64),
  targetProfileRevision: z.number().int().positive(),
  repositoryRoot: z.string().min(1).max(1024),
  composePath: z.string().min(1).max(1024),
  composeOverridePaths: z.array(z.string().min(1).max(1024)).max(8).default([]),
  composeProject: safeId,
  statelessServices: z.array(safeId).min(1).max(30),
  protectedServices: z.array(safeId).max(30),
  healthChecks: z.array(z.object({ id: safeId, url: z.string().url(), timeoutMs: z.number().int().min(100).max(30_000) }).strict()).min(1).max(30),
  branch: z.string().regex(/^[A-Za-z0-9._/-]{1,255}$/),
  expectedCurrentRevision: revision,
  requestedRevision: revision,
  automaticRollback: z.literal(true)
}).strict().superRefine((value, context) => {
  const composePaths = [value.composePath, ...value.composeOverridePaths];
  if (new Set(composePaths).size !== composePaths.length) context.addIssue({ code: z.ZodIssueCode.custom, message: "Compose paths must be unique", path: ["composeOverridePaths"] });
  const protectedSet = new Set(value.protectedServices);
  for (const service of value.statelessServices) if (protectedSet.has(service)) context.addIssue({ code: z.ZodIssueCode.custom, message: "Protected services cannot be activated", path: ["statelessServices"] });
});

export const projectDeploymentResultSchema = z.object({
  phase: z.enum(["succeeded", "failed", "rolled_back", "rollback_failed"]),
  progress: z.literal(100),
  deployedRevision: revision.optional(),
  checkpointRevision: revision.optional(),
  restoredRevision: revision.optional(),
  artifactDigest: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  releaseId: safeId.optional(),
  services: z.array(safeId).max(30),
  healthChecksPassed: z.number().int().nonnegative().max(30),
  rollbackAttempted: z.boolean(),
  rollbackVerified: z.boolean(),
  failureClassification: z.enum(["schema", "policy", "capability", "replay", "path", "repository_state", "revision", "activation", "health", "rollback", "unknown"]).optional()
}).strict();

export type ProjectDeploymentPayload = z.infer<typeof projectDeploymentPayloadSchema>;
export type ProjectDeploymentResult = z.infer<typeof projectDeploymentResultSchema>;
