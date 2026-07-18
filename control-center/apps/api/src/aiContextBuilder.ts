import type { ObjectId } from "mongodb";
import { collections } from "./db.js";
import type { ProjectDoc, ServerDoc } from "./models.js";
import { sanitizeForAi } from "./aiRedaction.js";
import { analyzeDeployment, buildOperationalSnapshot, findSimilarIncidents, generateTimeline, normalizeSection, OperationalContextCache, rankRootCauses, scoreConfidence, snapshotEvidence, type OperationalEvent } from "./operationalIntelligence.js";

const cache = new OperationalContextCache<Awaited<ReturnType<typeof collect>>>(30_000);
const notArchived = { archivedAt: { $exists: false } };
export function invalidateOperationalContext(scopeId?: string) { cache.invalidate(scopeId); }
export function operationalContextCacheStatus() { return { status: "ready", entries: cache.size(), ttlMs: 30_000 }; }

type Input = { orgId: ObjectId; userId: ObjectId; scopeType: "server" | "application"; scopeId: string; server: ServerDoc; project?: ProjectDoc; options: { includeHealth: boolean; includeDiscovery: boolean; includeRecentLogs: boolean; includeDeployments: boolean; includeCiSummary: boolean }; now?: Date };
async function collect(input: Input) {
  const now = input.now || new Date(); const { orgId, server, project } = input;
  const [telemetry, health, databases, tasks, audits, usage] = await Promise.all([
    collections.telemetry.findOne({ orgId, serverId: server._id! }, { sort: { collectedAt: -1 } }),
    project && input.options.includeHealth ? collections.healthChecks.find({ orgId, projectId: project._id!, ...notArchived }).limit(20).toArray() : [],
    project && input.options.includeHealth ? collections.mongoChecks.find({ orgId, projectId: project._id!, ...notArchived }, { projection: { encryptedConnectionString: 0, secretReference: 0 } }).limit(20).toArray() : [],
    collections.agentTasks.find({ orgId, serverId: server._id! }, { projection: { payload: 0, result: 0, nonce: 0, idempotencyKey: 0 } }).sort({ createdAt: -1 }).limit(50).toArray(),
    collections.auditEvents.find({ orgId, $or: [{ targetId: input.scopeId }, { targetId: server._id! }, ...(project?._id ? [{ targetId: project._id }] : [])] }).sort({ createdAt: -1 }).limit(50).toArray(),
    collections.aiUsage.find({ orgId }).sort({ createdAt: -1 }).limit(100).toArray()
  ]);
  const heartbeatAt = server.lastHeartbeatAt || telemetry?.collectedAt || server.updatedAt;
  const telemetryAt = telemetry?.collectedAt || server.currentState?.collectedAt;
  const state = telemetry || server.currentState || {};
  const sections = [
    normalizeSection({ key: "server", timestamp: heartbeatAt, source: "servers.currentState", data: { name: server.name, status: server.status, agentStatus: server.agentStatus, enrollmentStatus: server.enrollmentStatus, lastHeartbeatAt: server.lastHeartbeatAt, agentVersion: server.agentVersion }, complete: Boolean(server.status) }, now),
    normalizeSection({ key: "metrics", timestamp: telemetryAt, source: telemetry ? "telemetry" : "servers.currentState", data: state.metrics, complete: Boolean(state.metrics) }, now),
    normalizeSection({ key: "containers", timestamp: telemetryAt, source: telemetry ? "telemetry.docker" : "servers.currentState.docker", data: state.docker, complete: Array.isArray(state.docker) }, now),
    normalizeSection({ key: "compose", timestamp: telemetryAt, source: telemetry ? "telemetry.compose" : "servers.currentState.compose", data: state.compose, complete: Array.isArray(state.compose) }, now),
    normalizeSection({ key: "services", timestamp: telemetryAt, source: "telemetry.docker,telemetry.compose", data: [...(Array.isArray(state.docker) ? state.docker : []), ...(Array.isArray(state.compose) ? state.compose : [])], complete: Array.isArray(state.docker) || Array.isArray(state.compose) }, now),
    normalizeSection({ key: "git", timestamp: telemetryAt, source: telemetry ? "telemetry.git" : "servers.currentState.git", data: state.git, complete: Array.isArray(state.git) && state.git.length > 0 }, now),
    normalizeSection({ key: "discovery", timestamp: telemetryAt, source: telemetry ? "telemetry.discovery" : "servers.currentState.discovery", data: input.options.includeDiscovery ? state.discovery : undefined, complete: input.options.includeDiscovery && Boolean(state.discovery) }, now),
    normalizeSection({ key: "health", timestamp: newestTimestamp([...health.map((item) => (item.lastResult as any)?.checkedAt), ...databases.map((item) => (item.lastResult as any)?.checkedAt)]), source: "health_checks,mongo_checks", data: { health: health.map(({ name, enabled, lastResult }) => ({ name, enabled, lastResult })), databases: databases.map(({ name, enabled, databaseNameHint, lastResult }) => ({ name, enabled, databaseNameHint, lastResult })) }, complete: input.options.includeHealth && health.length + databases.length > 0 }, now),
    normalizeSection({ key: "deployments", timestamp: tasks[0]?.createdAt, source: "agent_tasks", data: input.options.includeDeployments ? tasks.filter((task) => /deploy|upgrade/i.test(task.type)) : undefined, complete: input.options.includeDeployments }, now),
    normalizeSection({ key: "rollbacks", timestamp: tasks.find((task) => /rollback/i.test(task.type))?.createdAt, source: "agent_tasks", data: input.options.includeDeployments ? tasks.filter((task) => /rollback/i.test(task.type)) : undefined, complete: input.options.includeDeployments }, now),
    normalizeSection({ key: "scheduledTasks", timestamp: tasks[0]?.createdAt, source: "agent_tasks", data: tasks.filter((task) => task.availableAt > task.createdAt), complete: true, staleMs: 24 * 60 * 60_000 }, now),
    normalizeSection({ key: "failures", timestamp: tasks.find((task) => task.state === "failed")?.updatedAt, source: "agent_tasks", data: tasks.filter((task) => task.state === "failed"), complete: true, staleMs: 7 * 24 * 60 * 60_000 }, now),
    normalizeSection({ key: "alerts", timestamp: audits.find((item) => /alert/i.test(item.action))?.createdAt, source: "audit_events", data: audits.filter((item) => /alert/i.test(item.action)), complete: true, staleMs: 7 * 24 * 60 * 60_000 }, now),
    normalizeSection({ key: "audit", timestamp: audits[0]?.createdAt, source: "audit_events", data: audits, complete: true, staleMs: 7 * 24 * 60 * 60_000 }, now),
    normalizeSection({ key: "rateLimit", timestamp: usage[0]?.createdAt || now, source: "ai_usage", data: { recentRequests: usage.length, pending: usage.filter((item) => item.outcome === "pending").length }, complete: true, staleMs: 24 * 60 * 60_000 }, now),
    normalizeSection({ key: "aiUsage", timestamp: usage[0]?.createdAt || now, source: "ai_usage", data: { requests: usage.length, inputTokens: usage.reduce((sum, item) => sum + (item.inputTokens || 0), 0), outputTokens: usage.reduce((sum, item) => sum + (item.outputTokens || 0), 0) }, complete: true, staleMs: 24 * 60 * 60_000 }, now),
    normalizeSection({ key: "ci", source: "github_actions", data: undefined, complete: false }, now),
    normalizeSection({ key: "logs", source: "bounded_log_summary", data: undefined, complete: false }, now),
    normalizeSection({ key: "kubernetes", source: "future_interface", data: undefined, complete: false }, now)
  ];
  const snapshot = buildOperationalSnapshot({ type: input.scopeType, id: input.scopeId, label: project?.name || server.name }, sections, now);
  const evidence = snapshotEvidence(snapshot);
  const events: OperationalEvent[] = [
    ...tasks.map((task) => ({ id: task._id!.toHexString(), type: task.state === "failed" ? "failure" as const : /rollback/i.test(task.type) ? "rollback" as const : "deployment" as const, timestamp: task.updatedAt, summary: `${task.type} ${task.state}`, status: task.state, errorCategory: task.errorCategory, tags: [task.type], orgId: orgId.toHexString() })),
    ...audits.map((event) => ({ id: event._id!.toHexString(), type: /alert/i.test(event.action) ? "alert" as const : "audit" as const, timestamp: event.createdAt, summary: `${event.action} ${event.result}`, status: event.result, tags: [event.action], orgId: orgId.toHexString() }))
  ];
  const currentIncident = events.find((event) => event.type === "failure" || event.type === "alert");
  const latestDeploy = tasks.find((task) => /deploy|upgrade/i.test(task.type));
  return { snapshot, evidence, likelyCauses: rankRootCauses(evidence), confidence: scoreConfidence(evidence), timeline: generateTimeline(events), relatedIncidents: currentIncident ? findSimilarIncidents(currentIncident, events, orgId.toHexString()) : [], deploymentImpact: latestDeploy ? analyzeDeployment(latestDeploy as any, project as any) : null, ciAnalysis: null, events };
}

export async function buildAiContext(input: Input) {
  const key = `${input.orgId}:${input.scopeType}:${input.scopeId}:${JSON.stringify(input.options)}`;
  const cached = cache.get(key); if (cached) return { ...cached, cache: "hit" as const };
  const result = await collect(input); cache.set(key, result); return { ...result, cache: "miss" as const };
}
function newestTimestamp(values: unknown[]) { const dates = values.map((item) => new Date(String(item))).filter((item) => Number.isFinite(item.getTime())).sort((a, b) => b.getTime() - a.getTime()); return dates[0]; }
export function sanitizeOperationalContext(value: unknown) { return sanitizeForAi(value, { maxDepth: 8, maxArray: 100, maxString: 1000 }); }
