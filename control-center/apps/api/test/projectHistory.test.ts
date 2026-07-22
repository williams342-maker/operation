import assert from "node:assert/strict";
import test from "node:test";
import { ObjectId } from "mongodb";
import { assertProjectHistoryRelationships, deploymentHistoryItem, rollbackHistoryItem } from "../src/projectHistory.js";

const ids = { org: new ObjectId(), project: new ObjectId(), server: new ObjectId(), task: new ObjectId(), actor: new ObjectId(), deployment: new ObjectId() };
const now = new Date("2026-07-22T00:00:00.000Z");
const base = { orgId: ids.org, createdAt: now, updatedAt: now };
test("history relationships require matching organization, server, project, and task", () => {
  const project = { ...base, _id: ids.project, name: "Project", slug: "project", primaryServerId: ids.server, healthCheckIds: [], mongoCheckIds: [] };
  const server = { ...base, _id: ids.server, name: "Server", hostname: "server", agentId: "agent", agentSecretHash: "redacted", credentialVersion: 1, status: "online" as const };
  const task = { ...base, _id: ids.task, serverId: ids.server, projectId: ids.project, agentId: "agent", type: "deploy.project", state: "succeeded" as const, payload: {}, idempotencyKey: "once", nonce: "nonce", signingKeyVersion: "v1", version: 1, availableAt: now, expiresAt: now, historyExpiresAt: now };
  assert.doesNotThrow(() => assertProjectHistoryRelationships({ orgId: ids.org, project, server, task, projectId: ids.project, serverId: ids.server }));
  assert.throws(() => assertProjectHistoryRelationships({ orgId: ids.org, project, server: { ...server, _id: new ObjectId() }, task, projectId: ids.project, serverId: ids.server }), /Cross-server/);
  assert.throws(() => assertProjectHistoryRelationships({ orgId: ids.org, project, server, task: { ...task, projectId: new ObjectId() }, projectId: ids.project, serverId: ids.server }), /Cross-project/);
});

test("history serializers expose bounded safe fields and permission-filter actors", () => {
  const deployment = { ...base, _id: ids.deployment, projectId: ids.project, serverId: ids.server, environment: "staging", requestedRevision: "a".repeat(40), deployedRevision: "b".repeat(40), branch: "main", artifactDigest: "c".repeat(64), releaseId: "release-001", taskId: ids.task, actorId: ids.actor, status: "succeeded" as const, validation: { health: "passed" as const, readiness: "passed" as const, checkedAt: now }, rollbackAvailable: true, evidenceConfidence: "verified" as const, failureClassification: "token=https://credential", auditEventIds: [] };
  const owner = deploymentHistoryItem(deployment, "Server", "Owner");
  const viewer = deploymentHistoryItem(deployment, "Server", "Viewer");
  assert.equal(owner.actor?.id, ids.actor.toHexString()); assert.equal(viewer.actor, undefined);
  assert.equal(owner.failureClassification, undefined); assert.equal(owner.artifactDigest, "c".repeat(64));
  const rollback = rollbackHistoryItem({ ...base, _id: new ObjectId(), projectId: ids.project, serverId: ids.server, sourceDeploymentId: ids.deployment, taskId: new ObjectId(), actorId: ids.actor, reasonClassification: "operator_requested", status: "failed", verification: { health: "failed", readiness: "not_run" }, failureClassification: "health", auditEventIds: [] }, "Server", "Viewer");
  assert.equal(rollback.sourceDeploymentId, ids.deployment.toHexString()); assert.equal(rollback.actor, undefined);
  assert.doesNotMatch(JSON.stringify({ owner, viewer, rollback }), /credential|password|bearer|mongodb:\/\//i);
});
