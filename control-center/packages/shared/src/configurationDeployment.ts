import { z } from "zod";
import crypto from "node:crypto";
import { settingNameSchema } from "./configuration.js";

export const deployableEnvironmentKinds = ["staging", "development", "testing", "preview", "ci"] as const;
export const deploymentCapabilities = ["encryptedSecretDelivery", "environmentFileWrite", "dockerComposeActivation", "configurationValidation", "configurationRollback"] as const;
export const minimumDeploymentAgentVersion = "0.1.0";
export const deploymentPhases = ["queued", "preflight", "backup_created", "configuration_written", "services_activating", "health_checking", "rollback_started", "rollback_restored", "rollback_validating", "succeeded", "failed", "rolled_back", "rollback_failed"] as const;

const safeId = z.string().regex(/^[A-Za-z0-9._:-]{1,160}$/);
const mutationBase = { name: settingNameSchema, versionId: z.string().min(12).max(64), secret: z.boolean() };
export const configurationMutationSchema = z.discriminatedUnion("operation", [
  z.object({ ...mutationBase, operation: z.enum(["add", "update", "rotate", "enable"]), valueRef: safeId }).strict(),
  z.object({ ...mutationBase, operation: z.enum(["remove", "disable"]) }).strict()
]);
export const encryptedValueBundleSchema = z.object({ algorithm: z.literal("aes-256-gcm"), ciphertext: z.string().max(400_000), nonce: z.string().max(64), authTag: z.string().max(64), keyVersion: z.string().max(40) }).strict();
// agent-v2: deployment values sealed to the agent's X25519 encryption key (ECIES). No signing/encryption
// key reuse; only the agent's private key opens it. Versioned via the algorithm literal.
export const sealedValueBundleSchema = z.object({ algorithm: z.literal("x25519-hkdf-sha256-aes256gcm"), ephemeralPublicKey: z.string().max(512), nonce: z.string().max(64), authTag: z.string().max(64), ciphertext: z.string().max(400_000) }).strict();

/**
 * Layer-3 review authorization, carried INSIDE the action payload.
 *
 * It lives here rather than beside the payload so that it falls under `privilegedActionDigest`, and
 * therefore under both the owner's offline signature and the transport envelope digest, with no
 * separate hashing rule for the gate, the signer, the API and the executor to disagree about.
 *
 * OPTIONAL, AND INERT WHEN ABSENT. `authorizePrivilegedTask` is unchanged and the existing two layers
 * behave exactly as before. That is the same additive discipline the owner-authorization layer used:
 * a new check must not be able to break the path it is being added to.
 *
 * NOT circular. Both ids exist before the payload is finalised, because an attestation is minted
 * UNBOUND and a lease is taken before binding. An earlier design computed the action digest at mint
 * time, which required the payload to contain ids that did not exist yet — a sequence with no valid
 * execution order.
 */
export const reviewAuthorizationSchema = z.object({
  attestationId: z.string().min(1).max(200),
  leaseId: z.string().min(1).max(200),
}).strict();
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
  encryptedValues: encryptedValueBundleSchema.optional(),
  sealedValues: sealedValueBundleSchema.optional(),
  expectedConfigurationDigest: z.string().regex(/^[a-f0-9]{64}$/),
  expectedActiveDeploymentId: z.string().min(12).max(64).optional(),
  reviewAuthorization: reviewAuthorizationSchema.optional(),
  automaticRollback: z.literal(true)
}).strict().superRefine((value, context) => {
  const protectedSet = new Set(value.protectedServices);
  for (const service of value.statelessServices) if (protectedSet.has(service)) context.addIssue({ code: z.ZodIssueCode.custom, message: "Protected services cannot be activated", path: ["statelessServices"] });
  if (new Set(value.mutations.map((item) => item.name)).size !== value.mutations.length) context.addIssue({ code: z.ZodIssueCode.custom, message: "Duplicate variable mutation", path: ["mutations"] });
  if (Boolean(value.encryptedValues) === Boolean(value.sealedValues)) context.addIssue({ code: z.ZodIssueCode.custom, message: "Exactly one of encryptedValues (v1) or sealedValues (v2) is required", path: ["encryptedValues"] });
});

const deploymentErrorCategory = z.enum(["capability", "environment", "version", "path", "symlink", "mount", "parsing", "backup", "write", "activation", "health", "rollback", "replay", "unknown"]);
export const deploymentProgressSchema = z.object({ phase: z.enum(deploymentPhases), progress: z.number().min(0).max(100), changedVariables: z.number().int().nonnegative().max(250), services: z.array(safeId).max(30), healthChecksPassed: z.number().int().nonnegative().max(30), errorCategory: deploymentErrorCategory.optional(), deploymentErrorCategory: deploymentErrorCategory.optional(), rollbackErrorCategory: deploymentErrorCategory.optional(), backupId: safeId.optional(), configurationDigest: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict();

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
