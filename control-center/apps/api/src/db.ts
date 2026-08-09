import { MongoClient, ObjectId } from "mongodb";
import type {
  AgentNonceDoc,
  AgentTaskDoc,
  AgentTaskResultDoc,
  ConfigurationDefinitionDoc,
  ConfigurationEnvironmentDoc,
  ConfigurationVersionDoc,
  ConfigurationTargetProfileDoc,
  ConfigurationDeploymentPlanDoc,
  AiUsageDoc,
  AuditEventDoc,
  EnrollmentDoc,
  HealthCheckDoc,
  MongoCheckDoc,
  OrganizationDoc,
  ProjectDoc,
  ServerDoc,
  SessionDoc,
  LoginThrottleDoc,
  TelemetryDoc,
  UserDoc,
  AgentReleaseDoc,
  AgentUpgradePlanDoc,
  AgentRolloutDoc,
  CloudflareAccessIntegrationDoc,
  WebsiteBuildWorkflowDoc,
  SeoAuditDoc,
  AiWorkforceRunDoc
  , CreditAccountDoc, CreditLedgerEntryDoc, AiCreditUsageRequestDoc, CreditBudgetPolicyDoc, CreditEmergencyControlDoc, CreditPricingDoc, CreditNotificationStateDoc
} from "./models.js";

const mongoUrl = process.env.MONGO_URL || "mongodb://127.0.0.1:27017/control_center";
const dbName = process.env.CONTROL_CENTER_DB || "control_center";

export const client = new MongoClient(mongoUrl);
export const db = client.db(dbName);

export const collections = {
  organizations: db.collection<OrganizationDoc>("organizations"),
  users: db.collection<UserDoc>("users"),
  sessions: db.collection<SessionDoc>("sessions"),
  loginThrottle: db.collection<LoginThrottleDoc>("login_throttle"),
  enrollments: db.collection<EnrollmentDoc>("enrollments"),
  cloudflareAccessIntegrations: db.collection<CloudflareAccessIntegrationDoc>("cloudflare_access_integrations"),
  servers: db.collection<ServerDoc>("servers"),
  projects: db.collection<ProjectDoc>("projects"),
  healthChecks: db.collection<HealthCheckDoc>("health_checks"),
  mongoChecks: db.collection<MongoCheckDoc>("mongo_checks"),
  telemetry: db.collection<TelemetryDoc>("telemetry"),
  agentNonces: db.collection<AgentNonceDoc>("agent_nonces"),
  auditEvents: db.collection<AuditEventDoc>("audit_events"),
  agentTasks: db.collection<AgentTaskDoc>("agent_tasks"),
  agentTaskResults: db.collection<AgentTaskResultDoc>("agent_task_results"),
  aiUsage: db.collection<AiUsageDoc>("ai_usage"),
  aiWorkforceRuns: db.collection<AiWorkforceRunDoc>("ai_workforce_runs"),
  websiteBuildWorkflows: db.collection<WebsiteBuildWorkflowDoc>("website_build_workflows"),
  seoAudits: db.collection<SeoAuditDoc>("seo_audits"),
  configurationEnvironments: db.collection<ConfigurationEnvironmentDoc>("configuration_environments"),
  configurationDefinitions: db.collection<ConfigurationDefinitionDoc>("configuration_definitions"),
  configurationVersions: db.collection<ConfigurationVersionDoc>("configuration_versions"),
  configurationTargetProfiles: db.collection<ConfigurationTargetProfileDoc>("configuration_target_profiles"),
  configurationDeploymentPlans: db.collection<ConfigurationDeploymentPlanDoc>("configuration_deployment_plans"),
  agentReleases: db.collection<AgentReleaseDoc>("agent_releases"),
  agentUpgradePlans: db.collection<AgentUpgradePlanDoc>("agent_upgrade_plans"),
  agentRollouts: db.collection<AgentRolloutDoc>("agent_rollouts")
  , creditAccounts: db.collection<CreditAccountDoc>("credit_accounts")
  , creditLedger: db.collection<CreditLedgerEntryDoc>("credit_ledger")
  , creditUsageRequests: db.collection<AiCreditUsageRequestDoc>("credit_usage_requests")
  , creditBudgetPolicies: db.collection<CreditBudgetPolicyDoc>("credit_budget_policies")
  , creditEmergencyControls: db.collection<CreditEmergencyControlDoc>("credit_emergency_controls")
  , creditPricing: db.collection<CreditPricingDoc>("credit_pricing")
  , creditNotificationState: db.collection<CreditNotificationStateDoc>("credit_notification_state")
};

export async function connectDb() {
  await client.connect();
  await ensureIndexes();
}

async function ensureIndexes() {
  await collections.enrollments.updateMany({ name: { $exists: false } }, { $set: { name: "Legacy enrollment" } });
  await collections.enrollments.updateMany({ uses: { $exists: false } }, { $set: { uses: 0 } });
  await collections.enrollments.updateMany({ usage: { $exists: false } }, { $set: { usage: [] } });
  await Promise.all([
    collections.organizations.createIndex({ slug: 1 }, { unique: true }),
    collections.users.createIndex({ orgId: 1, email: 1 }, { unique: true }),
    collections.sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    collections.sessions.createIndex({ tokenHash: 1 }, { unique: true }),
    collections.sessions.createIndex({ orgId: 1, userId: 1 }),
    collections.loginThrottle.createIndex({ key: 1 }, { unique: true }),
    collections.loginThrottle.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    collections.enrollments.createIndex({ orgId: 1, tokenHash: 1 }, { unique: true }),
    collections.enrollments.createIndex({ orgId: 1, createdAt: -1 }),
    collections.cloudflareAccessIntegrations.createIndex({ orgId: 1 }, { unique: true }),
    collections.servers.createIndex({ orgId: 1, agentId: 1 }, { unique: true }),
    collections.servers.createIndex({ orgId: 1, machineId: 1 }, { unique: true, partialFilterExpression: { machineId: { $type: "string" } } }),
    collections.servers.createIndex({ orgId: 1, agentInstallationId: 1 }, { unique: true, partialFilterExpression: { agentInstallationId: { $type: "string" } } }),
    collections.servers.createIndex({ orgId: 1, slug: 1 }, { unique: true, partialFilterExpression: { slug: { $type: "string" } } }),
    collections.servers.createIndex({ orgId: 1, status: 1 }),
    collections.servers.createIndex({ orgId: 1, archivedAt: 1 }),
    collections.servers.createIndex({ orgId: 1, enrollmentStatus: 1, updatedAt: -1 }),
    collections.servers.createIndex({ orgId: 1, keyProtocolVersion: 1, migrationState: 1 }),
    collections.servers.createIndex({ orgId: 1, publicSiteCheckedAt: 1 }),
    collections.projects.createIndex({ orgId: 1, slug: 1 }, { unique: true }),
    collections.projects.createIndex({ orgId: 1, primaryServerId: 1 }),
    collections.projects.createIndex({ orgId: 1, archivedAt: 1 }),
    collections.healthChecks.createIndex({ orgId: 1, projectId: 1 }),
    collections.healthChecks.createIndex({ orgId: 1, archivedAt: 1 }),
    collections.mongoChecks.createIndex({ orgId: 1, projectId: 1 }),
    collections.mongoChecks.createIndex({ orgId: 1, archivedAt: 1 }),
    collections.telemetry.createIndex({ orgId: 1, serverId: 1, collectedAt: -1 }),
    collections.telemetry.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    collections.agentNonces.createIndex({ orgId: 1, agentId: 1, nonce: 1 }, { unique: true }),
    collections.agentNonces.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    collections.agentTasks.createIndex({ orgId: 1, serverId: 1, state: 1, availableAt: 1 }),
    collections.agentTasks.createIndex({ orgId: 1, agentId: 1, state: 1, availableAt: 1 }),
    collections.agentTasks.createIndex({ orgId: 1, idempotencyKey: 1 }, { unique: true }),
    collections.agentTasks.createIndex({ expiresAt: 1 }),
    collections.agentTasks.createIndex({ historyExpiresAt: 1 }, { expireAfterSeconds: 0 }),
    collections.agentTaskResults.createIndex({ orgId: 1, serverId: 1, completedAt: -1 }),
    collections.agentTaskResults.createIndex({ orgId: 1, taskId: 1 }, { unique: true }),
    collections.agentTaskResults.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    collections.auditEvents.createIndex({ orgId: 1, createdAt: -1 }),
    collections.auditEvents.createIndex({ requestId: 1 }),
    collections.aiUsage.createIndex({ orgId: 1, createdAt: -1 }),
    collections.aiUsage.createIndex({ orgId: 1, userId: 1, createdAt: -1 }),
    collections.aiUsage.createIndex({ orgId: 1, concurrencySlot: 1 }, { unique: true, partialFilterExpression: { concurrencySlot: { $type: "number" } } }),
    collections.aiUsage.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    collections.aiWorkforceRuns.createIndex({ orgId: 1, state: 1, availableAt: 1 }),
    collections.aiWorkforceRuns.createIndex({ orgId: 1, createdAt: -1 }),
    collections.aiWorkforceRuns.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    collections.websiteBuildWorkflows.createIndex({ orgId: 1, createdAt: -1 }),
    collections.websiteBuildWorkflows.createIndex({ orgId: 1, stage: 1, updatedAt: -1 }),
    collections.seoAudits.createIndex({ orgId: 1, createdAt: -1 }),
    collections.seoAudits.createIndex({ orgId: 1, projectId: 1, createdAt: -1 }),
    collections.configurationEnvironments.createIndex({ orgId: 1, projectId: 1, name: 1 }, { unique: true }),
    collections.configurationDefinitions.createIndex({ orgId: 1, projectId: 1, applicationPath: 1, name: 1 }, { unique: true }),
    collections.configurationVersions.createIndex({ orgId: 1, definitionId: 1, environmentId: 1, version: -1 }, { unique: true }),
    collections.configurationVersions.createIndex({ orgId: 1, projectId: 1, state: 1 }),
    collections.configurationTargetProfiles.createIndex({ orgId: 1, projectId: 1, environmentId: 1, revision: -1 }, { unique: true }),
    collections.configurationDeploymentPlans.createIndex({ orgId: 1, projectId: 1, environmentId: 1, revision: -1 }, { unique: true }),
    collections.configurationDeploymentPlans.createIndex({ orgId: 1, state: 1, createdAt: -1 }),
    collections.agentReleases.createIndex({ orgId: 1, id: 1 }, { unique: true }),
    collections.agentReleases.createIndex({ orgId: 1, channel: 1, publicationStatus: 1, revoked: 1, version: -1 }),
    collections.agentUpgradePlans.createIndex({ orgId: 1, serverId: 1, createdAt: -1 }),
    collections.agentUpgradePlans.createIndex({ orgId: 1, planDigest: 1 }, { unique: true }),
    collections.agentRollouts.createIndex({ orgId: 1, state: 1, createdAt: -1 }),
    collections.creditAccounts.createIndex({ orgId: 1 }, { unique: true }),
    collections.creditLedger.createIndex({ orgId: 1, createdAt: -1 }),
    collections.creditLedger.createIndex({ orgId: 1, entryKey: 1 }, { unique: true }),
    collections.creditUsageRequests.createIndex({ orgId: 1, idempotencyKey: 1 }, { unique: true }),
    collections.creditUsageRequests.createIndex({ orgId: 1, startedAt: -1 }),
    collections.creditBudgetPolicies.createIndex({ orgId: 1, enabled: 1 }),
    collections.creditEmergencyControls.createIndex({ orgId: 1 }, { unique: true }),
    collections.creditPricing.createIndex({ provider: 1, model: 1, version: 1 }, { unique: true }),
    collections.creditNotificationState.createIndex({ orgId: 1, policyId: 1, periodKey: 1, thresholdPercent: 1 }, { unique: true })
  ]);
  // Safe additive migration: existing organizations receive a zero-credit account
  // with paid AI disabled. No promotional or production credit is invented.
  for await (const org of collections.organizations.find({}, { projection: { _id: 1, createdAt: 1 } })) {
    if (!org._id) continue; const now = new Date();
    await collections.creditAccounts.updateOne({ orgId: org._id }, { $setOnInsert: { orgId: org._id, status: "active", currency: "USD", creditUnitVersion: "usd-micros-v1", cachedAvailableCredits: 0, cachedReservedCredits: 0, createdAt: now, updatedAt: now } }, { upsert: true });
    await collections.creditEmergencyControls.updateOne({ orgId: org._id }, { $setOnInsert: { orgId: org._id, globalAiEnabled: false, organizationAiEnabled: false, providerEnabled: {}, modelEnabled: {}, projectEnabled: {}, reason: "Paid AI disabled by safe migration", changedBy: "system", changedAt: now, createdAt: now, updatedAt: now } }, { upsert: true });
  }
}

export function oid(value: string | ObjectId) {
  return typeof value === "string" ? new ObjectId(value) : value;
}

export function scopedFilter<T extends { orgId: ObjectId }>(orgId: ObjectId, filter: Partial<T> = {}) {
  return { ...filter, orgId };
}
