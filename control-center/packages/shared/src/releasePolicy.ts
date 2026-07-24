import crypto from "node:crypto";
import { z } from "zod";

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const safeId = z.string().regex(/^[A-Za-z0-9._:-]{1,160}$/);
const signatureSchema = z.string().min(80).max(1000);

export const releaseStages = [
  "build",
  "test",
  "security_validation",
  "staging_deployment",
  "burn_in_monitoring",
  "staging_rollback",
  "release_candidate_creation",
  "production_publication"
] as const;

export const stagingActions = [
  "deploy",
  "restart",
  "rollback",
  "collect_telemetry",
  "browser_validation",
  "security_validation",
  "production_publish",
  "database_migration",
  "dns_changes",
  "payment_activation",
  "secret_rotation",
  "signing"
] as const;

const authorityEntrySchema = z.object({
  stage: z.enum(releaseStages),
  authority: z.enum(["ai", "owner_ed25519_signature"]),
  autonomous: z.boolean()
}).strict();

const operationalRoleSchema = z.object({
  role: z.enum(["owner", "operations_administrator", "publisher"]),
  responsibilities: z.array(safeId).min(1).max(20)
}).strict();

export const releasePolicySchema = z.object({
  schemaVersion: z.literal("opsworkbench-release-policy-v1"),
  policyId: safeId,
  version: z.number().int().positive(),
  authority: z.array(authorityEntrySchema).length(releaseStages.length),
  roles: z.array(operationalRoleSchema).length(3),
  monitoring: z.object({
    availabilityPercentMinimum: z.number().min(0).max(100),
    httpErrorRatePercentMaximum: z.number().min(0).max(100),
    p95LatencyMsMaximum: z.number().positive(),
    agentHeartbeatGapSecondsMaximum: z.number().positive(),
    diskWarningPercent: z.number().min(0).max(100),
    diskCriticalPercent: z.number().min(0).max(100)
  }).strict(),
  stagingProfile: z.object({
    name: safeId,
    version: z.number().int().positive(),
    allowedActions: z.array(z.enum(stagingActions)).min(1),
    deniedActions: z.array(z.enum(stagingActions)).min(1)
  }).strict(),
  observation: z.object({
    minimumHours: z.number().positive(),
    resetOn: z.array(z.enum([
      "unexpected_restart",
      "critical_alert",
      "latency_threshold_breach",
      "availability_threshold_breach",
      "agent_heartbeat_threshold_breach"
    ])).min(1)
  }).strict(),
  publication: z.object({
    ownerKeyId: safeId,
    requireValidOwnerSignature: z.literal(true),
    requirePolicySignature: z.literal(true),
    requireSecurityValidation: z.literal(true),
    requireStagingValidation: z.literal(true),
    requireTelemetryThresholds: z.literal(true),
    requireRollbackCheckpoint: z.literal(true)
  }).strict()
}).strict().superRefine((policy, context) => {
  const authorityStages = new Set(policy.authority.map((entry) => entry.stage));
  if (authorityStages.size !== releaseStages.length) context.addIssue({ code: z.ZodIssueCode.custom, message: "Every release stage must appear exactly once" });
  const production = policy.authority.find((entry) => entry.stage === "production_publication");
  if (production?.authority !== "owner_ed25519_signature" || production.autonomous) context.addIssue({ code: z.ZodIssueCode.custom, message: "Production publication must require a non-autonomous owner Ed25519 signature" });
  if (policy.authority.some((entry) => entry.stage !== "production_publication" && (entry.authority !== "ai" || !entry.autonomous))) context.addIssue({ code: z.ZodIssueCode.custom, message: "All non-production stages must remain autonomous AI stages" });

  const roles = new Set(policy.roles.map((entry) => entry.role));
  if (roles.size !== 3) context.addIssue({ code: z.ZodIssueCode.custom, message: "Owner, Operations Administrator, and Publisher roles must each appear exactly once" });
  if (policy.monitoring.diskWarningPercent >= policy.monitoring.diskCriticalPercent) context.addIssue({ code: z.ZodIssueCode.custom, message: "Disk warning threshold must be below the critical threshold" });

  const allowed = new Set(policy.stagingProfile.allowedActions);
  const denied = new Set(policy.stagingProfile.deniedActions);
  if ([...allowed].some((action) => denied.has(action))) context.addIssue({ code: z.ZodIssueCode.custom, message: "Staging actions cannot be both allowed and denied" });
  for (const action of ["production_publish", "database_migration", "dns_changes", "payment_activation", "secret_rotation", "signing"] as const) {
    if (!denied.has(action)) context.addIssue({ code: z.ZodIssueCode.custom, message: `Staging profile must deny ${action}` });
  }
  if (allowed.has("production_publish") || allowed.has("signing")) context.addIssue({ code: z.ZodIssueCode.custom, message: "Staging profile cannot permit publication or signing" });
});

export const signedReleasePolicySchema = z.object({
  policy: releasePolicySchema,
  policyDigest: digestSchema,
  signatureKeyId: safeId,
  signature: signatureSchema
}).strict();

export const releaseCandidateEvidenceSchema = z.object({
  schemaVersion: z.literal("opsworkbench-release-candidate-evidence-v1"),
  releaseId: safeId,
  releaseDigest: digestSchema,
  policyDigest: digestSchema,
  targetEnvironment: z.literal("production"),
  observationStartedAt: z.string().datetime(),
  observedAt: z.string().datetime(),
  availabilityPercent: z.number().min(0).max(100),
  httpErrorRatePercent: z.number().min(0).max(100),
  p95LatencyMs: z.number().nonnegative(),
  maximumAgentHeartbeatGapSeconds: z.number().nonnegative(),
  maximumDiskPercent: z.number().min(0).max(100),
  unexpectedRestarts: z.number().int().nonnegative(),
  criticalAlerts: z.number().int().nonnegative(),
  securityValidationPassed: z.boolean(),
  stagingValidationPassed: z.boolean(),
  rollbackCheckpointDigest: digestSchema
}).strict();

export const publicationAuthorizationSchema = z.object({
  schemaVersion: z.literal("opsworkbench-publication-authorization-v1"),
  releaseId: safeId,
  releaseDigest: digestSchema,
  policyDigest: digestSchema,
  evidenceDigest: digestSchema,
  signedAt: z.string().datetime(),
  signatureKeyId: safeId,
  signature: signatureSchema
}).strict();

export type ReleasePolicy = z.infer<typeof releasePolicySchema>;
export type SignedReleasePolicy = z.infer<typeof signedReleasePolicySchema>;
export type ReleaseCandidateEvidence = z.infer<typeof releaseCandidateEvidenceSchema>;
export type PublicationAuthorization = z.infer<typeof publicationAuthorizationSchema>;
export type StagingAction = typeof stagingActions[number];

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, stable(item)]));
  }
  return value;
}

export function canonicalJson(value: unknown) {
  return JSON.stringify(stable(value));
}

export function sha256Canonical(value: unknown) {
  return crypto.createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function releasePolicyDigest(policy: ReleasePolicy) {
  return sha256Canonical(releasePolicySchema.parse(policy));
}

export function releaseCandidateEvidenceDigest(evidence: ReleaseCandidateEvidence) {
  return sha256Canonical(releaseCandidateEvidenceSchema.parse(evidence));
}

export function publicationAuthorizationDigest(authorization: Omit<PublicationAuthorization, "signature">) {
  return sha256Canonical(publicationAuthorizationSchema.omit({ signature: true }).parse(authorization));
}

export function ed25519PublicKeyId(publicKeyPem: string | Buffer) {
  const publicKey = crypto.createPublicKey(publicKeyPem);
  if (publicKey.asymmetricKeyType !== "ed25519") throw new Error("Owner public key must be Ed25519");
  const der = publicKey.export({ type: "spki", format: "der" });
  return `ed25519-${crypto.createHash("sha256").update(der).digest("hex").slice(0, 24)}`;
}

function verifyDigestSignature(digest: string, signature: string, publicKeyPem: string | Buffer) {
  try {
    const publicKey = crypto.createPublicKey(publicKeyPem);
    if (publicKey.asymmetricKeyType !== "ed25519") return false;
    return crypto.verify(null, Buffer.from(digest, "hex"), publicKey, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

export function isStagingActionAllowed(policyInput: ReleasePolicy, action: StagingAction) {
  const policy = releasePolicySchema.parse(policyInput);
  return policy.stagingProfile.allowedActions.includes(action) && !policy.stagingProfile.deniedActions.includes(action);
}

export type PublicationPolicyEvaluation = {
  publishEnabled: boolean;
  checks: Array<{ name: string; passed: boolean }>;
  warnings: string[];
};

export function evaluateProductionPublication(input: {
  signedPolicy: SignedReleasePolicy;
  evidence: ReleaseCandidateEvidence;
  authorization: PublicationAuthorization;
  ownerPublicKeyPem: string | Buffer;
}): PublicationPolicyEvaluation {
  const signedPolicy = signedReleasePolicySchema.parse(input.signedPolicy);
  const evidence = releaseCandidateEvidenceSchema.parse(input.evidence);
  const authorization = publicationAuthorizationSchema.parse(input.authorization);
  const policy = signedPolicy.policy;
  const policyDigest = releasePolicyDigest(policy);
  const evidenceDigest = releaseCandidateEvidenceDigest(evidence);
  const authorizationDigest = publicationAuthorizationDigest({
    schemaVersion: authorization.schemaVersion,
    releaseId: authorization.releaseId,
    releaseDigest: authorization.releaseDigest,
    policyDigest: authorization.policyDigest,
    evidenceDigest: authorization.evidenceDigest,
    signedAt: authorization.signedAt,
    signatureKeyId: authorization.signatureKeyId
  });
  let publicKeyId = "";
  try { publicKeyId = ed25519PublicKeyId(input.ownerPublicKeyPem); } catch { /* represented by failed checks */ }

  const elapsedHours = (Date.parse(evidence.observedAt) - Date.parse(evidence.observationStartedAt)) / 3_600_000;
  const checks = [
    { name: "owner_key_matches_policy", passed: publicKeyId === policy.publication.ownerKeyId && signedPolicy.signatureKeyId === publicKeyId && authorization.signatureKeyId === publicKeyId },
    { name: "policy_digest_matches", passed: signedPolicy.policyDigest === policyDigest && evidence.policyDigest === policyDigest && authorization.policyDigest === policyDigest },
    { name: "policy_signature_valid", passed: verifyDigestSignature(policyDigest, signedPolicy.signature, input.ownerPublicKeyPem) },
    { name: "release_identity_bound", passed: authorization.releaseId === evidence.releaseId && authorization.releaseDigest === evidence.releaseDigest },
    { name: "evidence_digest_bound", passed: authorization.evidenceDigest === evidenceDigest },
    { name: "owner_release_signature_valid", passed: verifyDigestSignature(authorizationDigest, authorization.signature, input.ownerPublicKeyPem) },
    { name: "minimum_observation_complete", passed: elapsedHours >= policy.observation.minimumHours },
    { name: "availability_threshold", passed: evidence.availabilityPercent >= policy.monitoring.availabilityPercentMinimum },
    { name: "http_error_rate_threshold", passed: evidence.httpErrorRatePercent < policy.monitoring.httpErrorRatePercentMaximum },
    { name: "latency_threshold", passed: evidence.p95LatencyMs < policy.monitoring.p95LatencyMsMaximum },
    { name: "agent_heartbeat_threshold", passed: evidence.maximumAgentHeartbeatGapSeconds <= policy.monitoring.agentHeartbeatGapSecondsMaximum },
    { name: "disk_critical_threshold", passed: evidence.maximumDiskPercent < policy.monitoring.diskCriticalPercent },
    { name: "no_unexpected_restarts", passed: evidence.unexpectedRestarts === 0 },
    { name: "no_critical_alerts", passed: evidence.criticalAlerts === 0 },
    { name: "security_validation", passed: evidence.securityValidationPassed },
    { name: "staging_validation", passed: evidence.stagingValidationPassed },
    { name: "rollback_checkpoint_exists", passed: /^[a-f0-9]{64}$/.test(evidence.rollbackCheckpointDigest) }
  ];
  const warnings = evidence.maximumDiskPercent >= policy.monitoring.diskWarningPercent
    ? [`Disk usage reached ${evidence.maximumDiskPercent}%, at or above the ${policy.monitoring.diskWarningPercent}% warning threshold`]
    : [];
  return { publishEnabled: checks.every((check) => check.passed), checks, warnings };
}
