import express from "express";
import { ObjectId } from "mongodb";
import { taskTypes, type TaskType } from "@control-center/shared";
import { audit } from "./audit.js";
import { noStore, requirePermission } from "./auth.js";
import { collections, oid } from "./db.js";
import { createTask, createTaskSchema, isConfigurationMutationTask, taskRegistry } from "./tasks.js";

export const taskRouter = express.Router();

function orgId(req: express.Request) { if (!req.orgId) throw new Error("Missing organization scope"); return req.orgId; }
function actorId(req: express.Request) { if (!req.user?._id) throw new Error("Missing user"); return req.user._id; }
function redactTask(task: Record<string, unknown>) { const copy = { ...task }; delete copy["payloadDigest"]; return copy; }

const projection = { payload: 0 };

taskRouter.get("/tasks/types", requirePermission("tasks:view"), (_req, res) => {
  res.json({ types: taskTypes.filter((type) => type !== "configuration.apply" && type !== "configuration.rollback").map((type) => ({ type, timeoutMs: taskRegistry[type].timeoutMs, outputCapBytes: taskRegistry[type].outputCapBytes })) });
});

taskRouter.get("/tasks", requirePermission("tasks:view"), async (req, res, next) => {
  try {
    const query = req.query;
    const filter: Record<string, unknown> = { orgId: orgId(req) };
    if (typeof query.state === "string" && query.state) filter.state = query.state;
    if (typeof query.type === "string" && query.type) filter.type = query.type;
    if (typeof query.serverId === "string" && ObjectId.isValid(query.serverId)) filter.serverId = oid(query.serverId);
    if (typeof query.projectId === "string" && ObjectId.isValid(query.projectId)) filter.projectId = oid(query.projectId);
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize || 25)));
    const page = Math.max(1, Number(query.page || 1));
    const [tasks, total] = await Promise.all([
      collections.agentTasks.find(filter, { projection }).sort({ createdAt: -1 }).skip((page - 1) * pageSize).limit(pageSize).toArray(),
      collections.agentTasks.countDocuments(filter)
    ]);
    res.json({ tasks, total, page, pageSize });
  } catch (error) { next(error); }
});

taskRouter.get("/tasks/:id", requirePermission("tasks:view"), async (req, res, next) => {
  try {
    const id = oid(String(req.params.id));
    const org = orgId(req);
    const [task, result] = await Promise.all([
      collections.agentTasks.findOne({ _id: id, orgId: org }, { projection }),
      collections.agentTaskResults.findOne({ taskId: id, orgId: org })
    ]);
    if (!task) return res.status(404).json({ error: "Task not found" });
    res.json({ task: redactTask(task as unknown as Record<string, unknown>), result });
  } catch (error) { next(error); }
});

taskRouter.post("/tasks", noStore, requirePermission("tasks:run"), async (req, res, next) => {
  try {
    const body = createTaskSchema.parse(req.body);
    if (isConfigurationMutationTask(body.type)) return res.status(403).json({ error: "Configuration mutation tasks require the approved deployment workflow" });
    const org = orgId(req);
    const server = await collections.servers.findOne({ _id: oid(body.serverId), orgId: org, archivedAt: { $exists: false }, revokedAt: { $exists: false } });
    if (!server?._id) return res.status(404).json({ error: "Server not found" });
    let projectId: ObjectId | undefined;
    if (body.projectId) {
      const project = await collections.projects.findOne({ _id: oid(body.projectId), orgId: org, primaryServerId: server._id, archivedAt: { $exists: false } });
      if (!project?._id) return res.status(404).json({ error: "Project not found" });
      projectId = project._id;
    }
    const expiresAt = new Date(Date.now() + body.expiresInSeconds * 1000);
    const task = await createTask({ orgId: org, server: server as typeof server & { _id: ObjectId }, projectId, type: body.type as TaskType, payload: body.payload ?? { projects: [], httpHealthChecks: [], mongoChecks: [] }, idempotencyKey: body.idempotencyKey || `${body.type}:${body.serverId}:${body.projectId || "none"}:${Date.now()}`, createdByUserId: actorId(req), expiresAt });
    await audit({ orgId: org, actorType: "user", actorId: actorId(req), action: "task.create", targetType: "agent_task", targetId: task._id, result: "success", requestId: req.requestId, metadata: { type: body.type } });
    res.status(201).json({ task: redactTask(task as unknown as Record<string, unknown>) });
  } catch (error) { next(error); }
});

taskRouter.post("/tasks/:id/cancel", requirePermission("tasks:cancel"), async (req, res, next) => {
  try {
    const id = oid(String(req.params.id));
    const now = new Date();
    const result = await collections.agentTasks.findOneAndUpdate(
      { _id: id, orgId: orgId(req), state: { $in: ["queued", "claimed", "running"] } },
      { $set: { state: "cancelled", cancelledAt: now, completedAt: now, updatedAt: now }, $inc: { version: 1 } },
      { returnDocument: "after" }
    );
    if (!result) return res.status(404).json({ error: "Cancelable task not found" });
    await audit({ orgId: orgId(req), actorType: "user", actorId: actorId(req), action: "task.cancel", targetType: "agent_task", targetId: id, result: "success", requestId: req.requestId });
    res.json({ task: redactTask(result as unknown as Record<string, unknown>) });
  } catch (error) { next(error); }
});

