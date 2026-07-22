import { ObjectId } from "mongodb";
import { hasPermission, type EvidenceFreshness, type ProjectOverview, type Role } from "@control-center/shared";
import { collections } from "./db.js";
import { calculateAgentStatus } from "./serverStatus.js";

const RECENT_LIMIT = 5;
type Row = Record<string, unknown>;
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.filter((item): item is Row => Boolean(item) && typeof item === "object") : [];
const text = (value: unknown) => typeof value === "string" && value.length <= 1024 ? value : undefined;
const bounded = (value: string | undefined, maximum: number) => value ? value.slice(0, maximum) : undefined;
const safeImage = (value: unknown) => { const candidate = text(value); return candidate && !/[@?#]|(?:password|token|secret|credential|bearer)/i.test(candidate) ? candidate : undefined; };
const safeSummary = (value: unknown) => { const candidate = text(value); return candidate && !/(?:password|token|secret|credential|bearer|mongodb:\/\/|https?:\/\/[^\s/@]+:[^\s/@]+@)/i.test(candidate) ? candidate.slice(0, 500) : undefined; };
const iso = (value: unknown) => value instanceof Date ? value.toISOString() : typeof value === "string" && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : undefined;
const id = (value: unknown) => String(value ?? "");

export function evidenceFreshness(value: unknown, now = new Date()): EvidenceFreshness {
  const timestamp = iso(value);
  if (!timestamp) return "unavailable";
  const age = now.getTime() - new Date(timestamp).getTime();
  if (age <= 2 * 60_000) return "fresh";
  if (age <= 5 * 60_000) return "delayed";
  return "stale";
}

export async function buildProjectOverview(orgId: ObjectId, projectId: ObjectId, role: Role, now = new Date()): Promise<ProjectOverview | null> {
  const project = await collections.projects.findOne({ _id: projectId, orgId });
  if (!project) return null;
  const server = await collections.servers.findOne({ _id: project.primaryServerId, orgId }, { projection: { agentSecretHash: 0, metadata: 0, allowlistedRoots: 0 } });
  const [telemetry, checks, environment, tasks] = await Promise.all([
    server ? collections.telemetry.findOne({ orgId, serverId: server._id! }, { sort: { collectedAt: -1 } }) : null,
    collections.healthChecks.find({ orgId, projectId, archivedAt: { $exists: false } }).limit(100).toArray(),
    collections.configurationEnvironments.findOne({ orgId, projectId }, { sort: { createdAt: 1 } }),
    hasPermission(role, "tasks:view") ? collections.agentTasks.find({ orgId, projectId }, { projection: { payload: 0, result: 0, nonce: 0, idempotencyKey: 0, signingKeyVersion: 0 } }).sort({ createdAt: -1 }).limit(RECENT_LIMIT).toArray() : Promise.resolve(null)
  ]);
  const state = (telemetry || server?.currentState || {}) as Row;
  const observedAt = telemetry?.collectedAt || state.collectedAt;
  const freshness = evidenceFreshness(observedAt, now);
  const observedGit = rows(state.git).find((item) => text(item.projectId) === id(projectId));
  const discovery = state.discovery && typeof state.discovery === "object" ? state.discovery as Row : undefined;
  const discoveredRepo = rows(discovery?.repositories).find((item) => text(item.path) === project.repoPath);
  const observedBranch = text(observedGit?.branch);
  const discoveredBranch = text(discoveredRepo?.branch);
  const observedCommit = text(observedGit?.commit);
  const discoveredCommit = text(discoveredRepo?.commit);
  const conflicts: string[] = [];
  if (observedBranch && discoveredBranch && observedBranch !== discoveredBranch) conflicts.push("branch-evidence-conflict");
  if (observedCommit && discoveredCommit && !discoveredCommit.startsWith(observedCommit) && !observedCommit.startsWith(discoveredCommit)) conflicts.push("revision-evidence-conflict");
  const confidence = conflicts.length ? "conflicting" : observedBranch || observedCommit ? "observed" : discoveredBranch || discoveredCommit ? "discovered" : project.branch ? "configured" : "unavailable";
  const compose = rows(state.compose).filter((item) => !project.serviceNames?.length || project.serviceNames.includes(text(item.service) || ""));
  const docker = rows(state.docker);
  const serviceRows = compose.length ? compose.map((item) => ({ item, source: "compose" as const })) : docker.filter((item) => !project.serviceNames?.length || project.serviceNames.includes(text(item.name) || "")).map((item) => ({ item, source: "docker" as const }));
  const http = rows(state.httpHealth);
  const safeRepository = project.githubRepository && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(project.githubRepository) ? project.githubRepository : undefined;
  let audit: ProjectOverview["recent"]["audit"] = null;
  if (hasPermission(role, "audit:view")) {
    const taskIds = (tasks || []).map((task) => task._id).filter(Boolean);
    const events = await collections.auditEvents.find({ orgId, $or: [
      { targetType: "project", targetId: projectId },
      ...(taskIds.length ? [{ targetType: "agent_task", targetId: { $in: taskIds } }] : [])
    ] }).sort({ createdAt: -1 }).limit(RECENT_LIMIT).toArray();
    audit = events.map((event) => ({ id: id(event._id), action: event.action, actor: event.actorType, target: event.targetType, result: event.result, timestamp: event.createdAt.toISOString() }));
  }
  const limitations = ["RELEASE_MODEL_UNAVAILABLE", "DEPLOYMENT_HISTORY_UNAVAILABLE", "ROLLBACK_HISTORY_UNAVAILABLE", "LOGS_UNAVAILABLE"];
  if (!server) limitations.push("SERVER_UNAVAILABLE");
  if (freshness === "stale") limitations.push("TELEMETRY_STALE");
  if (confidence !== "observed") limitations.push("RUNTIME_REVISION_NOT_OBSERVED");
  return {
    schemaVersion: "project-overview-v1", generatedAt: now.toISOString(),
    project: { id: id(project._id), name: bounded(project.name, 120) || "Unnamed project", slug: bounded(project.slug, 120) || "unknown", archived: Boolean(project.archivedAt), repository: bounded(safeRepository, 200), configuredBranch: bounded(project.branch, 255), ...(hasPermission(role, "projects:manage") && project.repoPath ? { paths: { repository: project.repoPath.slice(0, 1024), compose: bounded(project.composePath, 1024) } } : {}) },
    environment: environment ? { name: bounded(environment.name, 120), kind: environment.kind, protected: environment.protected, state: "configured" } : { state: "not-configured" },
    server: { id: server?._id ? id(server._id) : undefined, name: bounded(server?.name, 120), enrollmentStatus: server?.enrollmentStatus || "unavailable", agentStatus: server ? calculateAgentStatus(server.lastHeartbeatAt, server.revokedAt, now) : "unavailable", lastHeartbeatAt: iso(server?.lastHeartbeatAt), freshness: evidenceFreshness(server?.lastHeartbeatAt, now), capabilities: server?.agentCapabilities?.slice(0, 100).map((capability) => capability.slice(0, 160)) || [], limitations: server ? [] : ["server-unavailable"] },
    revision: { configuredBranch: bounded(project.branch, 255), discoveredBranch: bounded(discoveredBranch, 255), observedBranch: bounded(observedBranch, 255), discoveredCommit: bounded(discoveredCommit, 64), observedCommit: bounded(observedCommit, 64), dirty: typeof observedGit?.dirty === "boolean" ? observedGit.dirty : typeof discoveredRepo?.dirty === "boolean" ? discoveredRepo.dirty : undefined, evidenceAt: iso(observedGit?.collectedAt) || iso(discovery?.collectedAt) || iso(observedAt), confidence, conflicts },
    services: serviceRows.slice(0, 50).map(({ item, source }) => { const stateText = text(item.state)?.slice(0, 128) || "unknown"; return { name: (text(item.service) || text(item.name) || "Unnamed service").slice(0, 255), state: stateText, health: /running|up/i.test(stateText) ? "healthy" : /exited|dead|failed/i.test(stateText) ? "unhealthy" : "unknown", image: source === "docker" ? safeImage(item.image) : undefined, source, evidenceAt: iso(observedAt), freshness }; }),
    health: checks.slice(0, 50).map((check) => { const result = http.find((item) => text(item.healthCheckId) === id(check._id)) || (check.lastResult && typeof check.lastResult === "object" ? check.lastResult as Row : undefined); return { id: id(check._id), name: check.name.slice(0, 120), success: typeof result?.success === "boolean" ? result.success : undefined, statusCode: typeof result?.statusCode === "number" ? result.statusCode : undefined, checkedAt: iso(result?.checkedAt), freshness: evidenceFreshness(result?.checkedAt, now) }; }),
    recent: { tasks: tasks?.map((task) => ({ id: id(task._id), type: task.type, state: task.state, target: server?.name || id(task.serverId), summary: safeSummary(task.resultSummary), startedAt: iso(task.startedAt), completedAt: iso(task.completedAt) })) || null, audit },
    availability: { releases: "unavailable", deployments: "unavailable", rollbacks: "unavailable", logs: "unavailable" }, limitations
  };
}
