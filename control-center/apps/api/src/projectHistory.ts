import { ObjectId } from "mongodb";
import { hasPermission, type ProjectDeploymentHistoryItem, type ProjectRollbackHistoryItem, type Role } from "@control-center/shared";
import { collections } from "./db.js";
import type { AgentTaskDoc, ProjectDeploymentDoc, ProjectDoc, ProjectRollbackDoc, ServerDoc } from "./models.js";

const safeText = (value: string | undefined, maximum = 160) => value && /^[A-Za-z0-9._:/+ -]+$/.test(value) ? value.slice(0, maximum) : undefined;
const safeRevision = (value: string | undefined) => value && /^[A-Za-z0-9._/-]{1,255}$/.test(value) ? value : undefined;
const safeDigest = (value: string | undefined) => value && /^[a-f0-9]{64}$/.test(value) ? value : undefined;
const iso = (value?: Date) => value?.toISOString();
const id = (value: ObjectId | undefined) => value?.toHexString() || "";

export function assertProjectHistoryRelationships(input: { orgId: ObjectId; project: ProjectDoc; server: ServerDoc; task: AgentTaskDoc; projectId: ObjectId; serverId: ObjectId }) {
  const same = (left: ObjectId | undefined, right: ObjectId) => Boolean(left?.equals(right));
  if (!same(input.project.orgId, input.orgId) || !same(input.server.orgId, input.orgId) || !same(input.task.orgId, input.orgId)) throw new Error("Cross-organization history relationship");
  if (!same(input.project._id, input.projectId) || !same(input.server._id, input.serverId) || !same(input.project.primaryServerId, input.serverId)) throw new Error("Cross-server history relationship");
  if (!same(input.task.projectId, input.projectId) || !same(input.task.serverId, input.serverId)) throw new Error("Cross-project task relationship");
}

export function deploymentHistoryItem(row: ProjectDeploymentDoc, serverName: string | undefined, role: Role): ProjectDeploymentHistoryItem {
  const canAudit = hasPermission(role, "audit:view");
  return { id: id(row._id), projectId: id(row.projectId), server: { id: id(row.serverId), name: safeText(serverName, 120) }, environment: safeText(row.environment, 80) || "unknown", requestedRevision: safeRevision(row.requestedRevision) || "unknown", deployedRevision: safeRevision(row.deployedRevision), branch: safeRevision(row.branch), artifactDigest: safeDigest(row.artifactDigest), releaseId: safeText(row.releaseId, 160), taskId: id(row.taskId), planDigest: safeDigest(row.planDigest), approvalExpiresAt: iso(row.approvalExpiresAt), ...(canAudit ? { actor: { id: id(row.actorId) }, ...(row.approvedByUserId && row.approvedAt ? { approval: { approverId: id(row.approvedByUserId), approvedAt: row.approvedAt.toISOString() } } : {}), ...(row.cancelledByUserId && row.cancelledAt ? { cancellation: { cancelledById: id(row.cancelledByUserId), cancelledAt: row.cancelledAt.toISOString() } } : {}) } : {}), ...(row.controlPlanePreflight ? { controlPlanePreflight: { status: row.controlPlanePreflight.status, checks: row.controlPlanePreflight.checks.map((check) => ({ name: safeText(check.name, 80) || "unknown", passed: check.passed })).slice(0, 10), checkedAt: row.controlPlanePreflight.checkedAt.toISOString(), ...(canAudit ? { checkedById: id(row.controlPlanePreflight.checkedByUserId) } : {}) } } : {}), ...(row.gitPreflight ? { gitPreflight: { taskId: id(row.gitPreflight.taskId), status: row.gitPreflight.status, checks: row.gitPreflight.checks.map((check) => ({ name: safeText(check.name, 80) || "unknown", passed: check.passed })).slice(0, 10), headRevision: safeRevision(row.gitPreflight.headRevision), resolvedRevision: safeRevision(row.gitPreflight.resolvedRevision), branch: safeRevision(row.gitPreflight.branch), dirty: row.gitPreflight.dirty, checkedAt: iso(row.gitPreflight.checkedAt) } } : {}), status: row.status, startedAt: iso(row.startedAt), completedAt: iso(row.completedAt), validation: { health: row.validation.health, readiness: row.validation.readiness, checkedAt: iso(row.validation.checkedAt) }, rollbackAvailable: row.rollbackAvailable, evidenceConfidence: row.evidenceConfidence, failureClassification: safeText(row.failureClassification, 80), createdAt: row.createdAt.toISOString() };
}

export function rollbackHistoryItem(row: ProjectRollbackDoc, serverName: string | undefined, role: Role): ProjectRollbackHistoryItem {
  return { id: id(row._id), projectId: id(row.projectId), server: { id: id(row.serverId), name: safeText(serverName, 120) }, sourceDeploymentId: id(row.sourceDeploymentId), restoredDeploymentId: id(row.restoredDeploymentId) || undefined, restoredReleaseId: safeText(row.restoredReleaseId, 160), taskId: id(row.taskId), ...(hasPermission(role, "audit:view") ? { actor: { id: id(row.actorId) } } : {}), reasonClassification: safeText(row.reasonClassification, 80) || "unspecified", status: row.status, startedAt: iso(row.startedAt), completedAt: iso(row.completedAt), verification: { health: row.verification.health, readiness: row.verification.readiness, checkedAt: iso(row.verification.checkedAt) }, failureClassification: safeText(row.failureClassification, 80), createdAt: row.createdAt.toISOString() };
}

async function serverNames(orgId: ObjectId, ids: ObjectId[]) {
  const rows = await collections.servers.find({ orgId, _id: { $in: ids } }, { projection: { name: 1 } }).toArray();
  return new Map(rows.map((row) => [id(row._id), row.name]));
}

async function reconcileExpiredGitPreflights(orgId: ObjectId, projectId: ObjectId, now = new Date()) {
  const deployments = await collections.projectDeployments.find({ orgId, projectId, status: "approved", "gitPreflight.status": { $in: ["queued", "running"] }, approvalExpiresAt: { $lte: now } }, { projection: { gitPreflight: 1 } }).limit(100).toArray();
  for (const deployment of deployments) {
    if (!deployment._id || !deployment.gitPreflight?.taskId) continue;
    await Promise.all([
      collections.agentTasks.updateOne({ _id: deployment.gitPreflight.taskId, orgId, state: { $in: ["queued", "claimed", "running"] } }, { $set: { state: "expired", completedAt: now, updatedAt: now }, $inc: { version: 1 } }),
      collections.projectDeployments.updateOne({ _id: deployment._id, orgId, "gitPreflight.taskId": deployment.gitPreflight.taskId, "gitPreflight.status": { $in: ["queued", "running"] } }, { $set: { "gitPreflight.status": "failed", "gitPreflight.checks": [{ name: "approval_current", passed: false }], "gitPreflight.checkedAt": now, updatedAt: now } })
    ]);
  }
}

export async function projectDeploymentHistory(orgId: ObjectId, projectId: ObjectId, role: Role, limit: number) {
  await reconcileExpiredGitPreflights(orgId, projectId);
  const rows = await collections.projectDeployments.find({ orgId, projectId }).sort({ createdAt: -1, _id: -1 }).limit(limit + 1).toArray();
  const names = await serverNames(orgId, rows.slice(0, limit).map((row) => row.serverId));
  return { records: rows.slice(0, limit).map((row) => deploymentHistoryItem(row, names.get(id(row.serverId)), role)), hasMore: rows.length > limit };
}
export async function projectRollbackHistory(orgId: ObjectId, projectId: ObjectId, role: Role, limit: number) {
  const rows = await collections.projectRollbacks.find({ orgId, projectId }).sort({ createdAt: -1, _id: -1 }).limit(limit + 1).toArray();
  const names = await serverNames(orgId, rows.slice(0, limit).map((row) => row.serverId));
  return { records: rows.slice(0, limit).map((row) => rollbackHistoryItem(row, names.get(id(row.serverId)), role)), hasMore: rows.length > limit };
}
