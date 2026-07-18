import { MongoClient, ObjectId } from "mongodb";
import type {
  AgentNonceDoc,
  AgentTaskDoc,
  AgentTaskResultDoc,
  AuditEventDoc,
  EnrollmentDoc,
  HealthCheckDoc,
  MongoCheckDoc,
  OrganizationDoc,
  ProjectDoc,
  ServerDoc,
  SessionDoc,
  TelemetryDoc,
  UserDoc
} from "./models.js";

const mongoUrl = process.env.MONGO_URL || "mongodb://127.0.0.1:27017/control_center";
const dbName = process.env.CONTROL_CENTER_DB || "control_center";

export const client = new MongoClient(mongoUrl);
export const db = client.db(dbName);

export const collections = {
  organizations: db.collection<OrganizationDoc>("organizations"),
  users: db.collection<UserDoc>("users"),
  sessions: db.collection<SessionDoc>("sessions"),
  enrollments: db.collection<EnrollmentDoc>("enrollments"),
  servers: db.collection<ServerDoc>("servers"),
  projects: db.collection<ProjectDoc>("projects"),
  healthChecks: db.collection<HealthCheckDoc>("health_checks"),
  mongoChecks: db.collection<MongoCheckDoc>("mongo_checks"),
  telemetry: db.collection<TelemetryDoc>("telemetry"),
  agentNonces: db.collection<AgentNonceDoc>("agent_nonces"),
  auditEvents: db.collection<AuditEventDoc>("audit_events"),
  agentTasks: db.collection<AgentTaskDoc>("agent_tasks"),
  agentTaskResults: db.collection<AgentTaskResultDoc>("agent_task_results")
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
    collections.sessions.createIndex({ orgId: 1, userId: 1 }),
    collections.enrollments.createIndex({ orgId: 1, tokenHash: 1 }, { unique: true }),
    collections.enrollments.createIndex({ orgId: 1, createdAt: -1 }),
    collections.servers.createIndex({ orgId: 1, agentId: 1 }, { unique: true }),
    collections.servers.createIndex({ orgId: 1, machineId: 1 }, { unique: true, partialFilterExpression: { machineId: { $type: "string" } } }),
    collections.servers.createIndex({ orgId: 1, agentInstallationId: 1 }, { unique: true, partialFilterExpression: { agentInstallationId: { $type: "string" } } }),
    collections.servers.createIndex({ orgId: 1, slug: 1 }, { unique: true, partialFilterExpression: { slug: { $type: "string" } } }),
    collections.servers.createIndex({ orgId: 1, status: 1 }),
    collections.servers.createIndex({ orgId: 1, archivedAt: 1 }),
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
    collections.auditEvents.createIndex({ requestId: 1 })
  ]);
}

export function oid(value: string | ObjectId) {
  return typeof value === "string" ? new ObjectId(value) : value;
}

export function scopedFilter<T extends { orgId: ObjectId }>(orgId: ObjectId, filter: Partial<T> = {}) {
  return { ...filter, orgId };
}
