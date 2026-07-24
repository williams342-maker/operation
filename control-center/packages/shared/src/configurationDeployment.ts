import { z } from "zod";
import crypto from "node:crypto";
import { settingNameSchema } from "./configuration.js";

export const deployableEnvironmentKinds = ["staging", "development", "testing", "preview", "ci"] as const;
export const deploymentCapabilities = ["encryptedSecretDelivery", "environmentFileWrite", "dockerComposeActivation", "configurationValidation", "configurationRollback"] as const;
export const minimumDeploymentAgentVersion = "0.1.0";
export const deploymentPhases = ["queued", "preflight", "backup_created", "configuration_written", "services_activating", "health_checking", "rollback_started", "rollback_restored", "rollback_validating", "succeeded", "failed", "rolled_back", "rollback_failed"] as const;
export const deploymentFailureStages = ["schema", "policy", "version", "capability", "replay", "health_preflight", "path_guard", "file_guard", "digest_guard", "backup", "decrypt", "mutation", "write", "activation", "health", "rollback", "unknown"] as const;

const safeId = z.string().regex(/^[A-Za-z0-9._:-]{1,160}$/);
const mutationBase = { name: settingNameSchema, versionId: z.string().min(12).max(64), secret: z.boolean() };
export const configurationMutationSchema = z.discriminatedUnion("operation", [
  z.object({ ...mutationBase, operation: z.enum(["add", "update", "rotate", "enable"]), valueRef: safeId }).strict(),
  z.object({ ...mutationBase, operation: z.enum(["remove", "disable"]) }).strict()
]);
export const encryptedValueBundleSchema = z.object({ algorithm: z.literal("aes-256-gcm"), ciphertext: z.string().max(400_000), nonce: z.string().max(64), authTag: z.string().max(64), keyVersion: z.string().max(40) }).strict();

export const configurationDeploymentPayloadSchema = z.object({
  schemaVersion: z.literal("configuration-deployment-v1"),
  action: z.enum(["configuration.apply.v1", "configuration.rollback.v1"]),
  planId: z.string().min(12).max(64),
  planRevision: z.number().int().positive(),
  deploymentId: z.string().min(12).max(64),
  environmentId: z.string().min(12).max(64),
  environmentKind: z.enum(deployableEnvironmentKinds),
  protected: z.literal(false),
  targetProfileId: z.string().min(12).max(64),
  targetProfileRevision: z.number().int().positive(),
  repositoryRoot: z.string().min(1).max(1024),
  environmentFilePath: z.string().min(1).max(1024),
  composePath: z.string().min(1).max(1024),
  composeProject: safeId,
  statelessServices: z.array(safeId).min(1).max(30),
  protectedServices: z.array(safeId).max(30),
  healthChecks: z.array(z.object({ id: safeId, url: z.string().url(), timeoutMs: z.number().int().min(100).max(30_000) }).strict()).min(1).max(30),
  mutations: z.array(configurationMutationSchema).min(1).max(250),
  encryptedValues: encryptedValueBundleSchema,
  expectedConfigurationDigest: z.string().regex(/^[a-f0-9]{64}$/),
  expectedActiveDeploymentId: z.string().min(12).max(64).optional(),
  automaticRollback: z.literal(true)
}).strict().superRefine((value, context) => {
  const protectedSet = new Set(value.protectedServices);
  for (const service of value.statelessServices) if (protectedSet.has(service)) context.addIssue({ code: z.ZodIssueCode.custom, message: "Protected services cannot be activated", path: ["statelessServices"] });
  if (new Set(value.mutations.map((item) => item.name)).size !== value.mutations.length) context.addIssue({ code: z.ZodIssueCode.custom, message: "Duplicate variable mutation", path: ["mutations"] });
});

const deploymentErrorCategory = z.enum(["capability", "environment", "version", "path", "symlink", "mount", "parsing", "backup", "write", "activation", "health", "rollback", "replay", "unknown"]);
const deploymentFailureStage = z.enum(deploymentFailureStages);
export const deploymentProgressSchema = z.object({ phase: z.enum(deploymentPhases), progress: z.number().min(0).max(100), changedVariables: z.number().int().nonnegative().max(250), services: z.array(safeId).max(30), healthChecksPassed: z.number().int().nonnegative().max(30), errorCategory: deploymentErrorCategory.optional(), failureStage: deploymentFailureStage.optional(), deploymentErrorCategory: deploymentErrorCategory.optional(), rollbackErrorCategory: deploymentErrorCategory.optional(), backupId: safeId.optional(), configurationDigest: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict();

export type ConfigurationDeploymentPayload = z.infer<typeof configurationDeploymentPayloadSchema>;
export type DeploymentProgress = z.infer<typeof deploymentProgressSchema>;

export function configurationChangeDigest(input: Array<{ name: string; operation: string; secret: boolean; versionId: string }>) {
  const canonical = [...input].sort((a, b) => a.name.localeCompare(b.name)).map(({ name, operation, secret, versionId }) => ({ name, operation, secret, versionId }));
  return crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function redactedConfigurationDiff(input: Array<{ name: string; operation: string; secret: boolean }>) {
  return [...input].sort((a, b) => a.name.localeCompare(b.name)).map(({ name, operation, secret }) => ({ name, operation, classification: secret ? "secret" as const : "non-secret" as const, proposedValue: secret ? "[redacted]" : "[pending value]" }));
}

export function parseStableSemver(value: string) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] as const : undefined;
}

export function isCompatibleAgentVersion(value: string | undefined, minimum = minimumDeploymentAgentVersion) {
  if (!value) return false;
  const actual = parseStableSemver(value); const required = parseStableSemver(minimum);
  if (!actual || !required) return false;
  for (let index = 0; index < 3; index += 1) { if (actual[index] !== required[index]) return actual[index] > required[index]; }
  return true;
}
