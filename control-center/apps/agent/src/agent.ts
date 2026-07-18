import os from "node:os";
import { agentSigningKey, isTaskExpired, verifyTaskEnvelope, type TaskEnvelope, type TaskPayload, type TaskType } from "@control-center/shared";
import fs from "node:fs";
import { loadConfig, saveConfig, type AgentConfig } from "./config.js";
import { enroll, signedPost } from "./client.js";
import { collectCompose, collectDocker, collectGit, collectHttp, collectMongo, collectSystem } from "./inspectors.js";

type ClaimedTask = { envelope: TaskEnvelope; payload: TaskPayload };

async function maybeEnroll() {
  const config = loadConfig();
  const token = process.env.CONTROL_CENTER_ENROLLMENT_TOKEN;
  if (config.agentId && config.agentSecret) return config;
  if (!token) throw new Error("Agent is not enrolled. Set CONTROL_CENTER_ENROLLMENT_TOKEN for first run.");
  const interfaces = Object.values(os.networkInterfaces()).flat().filter((entry) => entry && !entry.internal);
  const primaryIp = interfaces.find((entry) => entry?.family === "IPv4")?.address;
  const machineId = ["/etc/machine-id", "/var/lib/dbus/machine-id"].map((file) => { try { return fs.readFileSync(file, "utf8").trim(); } catch { return ""; } }).find(Boolean);
  let diskBytes: number | undefined;
  try { const stat = fs.statfsSync("/"); diskBytes = Number(stat.blocks) * Number(stat.bsize); } catch { /* optional metadata */ }
  const result = await enroll(config.controlCenterUrl, token, {
    requestedSlug: config.requestedSlug || process.env.CONTROL_CENTER_SERVER_SLUG || undefined,
    machineId: machineId || undefined, agentInstallationId: config.installationId || undefined,
    hostname: os.hostname(), primaryIp, privateIp: primaryIp,
    osName: os.platform(), osVersion: os.release(), kernelVersion: os.release(), architecture: os.arch(),
    cpuModel: os.cpus()[0]?.model, cpuCoreCount: os.cpus().length, memoryBytes: os.totalmem(), diskBytes,
    agentVersion: config.agentVersion
  });
  const nextConfig = { ...config, agentId: result.agentId, agentSecret: result.agentSecret, pollIntervalSeconds: result.pollIntervalSeconds };
  saveConfig(nextConfig);
  return nextConfig;
}

function verifyTask(config: AgentConfig, task: ClaimedTask) {
  const envelope = task.envelope;
  if (envelope.agentId !== config.agentId) throw new Error("Task assigned to a different agent");
  if (isTaskExpired(envelope.expiresAt)) throw new Error("Task expired");
  const valid = verifyTaskEnvelope(agentSigningKey(config.agentSecret), envelope, task.payload);
  if (!valid) throw new Error("Invalid task signature");
}

async function acknowledge(config: AgentConfig, taskId: string, event: "claimed" | "started" | "progress" | "succeeded" | "failed", result?: unknown, message?: string) {
  return signedPost(config, "/api/agent/tasks/ack", { taskId, event, result, message });
}

async function executeTask(config: AgentConfig, task: ClaimedTask) {
  verifyTask(config, task);
  const { envelope, payload } = task;
  await acknowledge(config, envelope.taskId, "claimed").catch(() => undefined);
  await acknowledge(config, envelope.taskId, "started");
  let result: unknown;
  switch (envelope.taskType as TaskType) {
    case "collect.system":
      result = { metrics: await collectSystem(config.agentVersion) };
      break;
    case "inspect.docker":
      result = { docker: await collectDocker().catch(() => []) };
      break;
    case "inspect.compose":
      result = { compose: await collectCompose(config, payload.projects).catch(() => []) };
      break;
    case "inspect.git":
      result = { git: await collectGit(config, payload.projects).catch(() => []) };
      break;
    case "check.http":
      result = { httpHealth: await collectHttp(payload.httpHealthChecks).catch(() => []) };
      break;
    case "check.mongo":
      result = { mongo: await collectMongo(config, payload.mongoChecks).catch(() => []) };
      break;
    case "collect.telemetry":
      result = {
        heartbeat: { collectedAt: new Date().toISOString(), agentVersion: config.agentVersion },
        metrics: await collectSystem(config.agentVersion),
        docker: await collectDocker().catch(() => []),
        compose: await collectCompose(config, payload.projects).catch(() => []),
        git: await collectGit(config, payload.projects).catch(() => []),
        httpHealth: await collectHttp(payload.httpHealthChecks).catch(() => []),
        mongo: await collectMongo(config, payload.mongoChecks).catch(() => [])
      };
      break;
    default:
      throw new Error("Unsupported task type");
  }
  await acknowledge(config, envelope.taskId, "succeeded", result);
}

async function pollOnce() {
  const config = await maybeEnroll();
  const initial = {
    heartbeat: { collectedAt: new Date().toISOString(), agentVersion: config.agentVersion },
    metrics: await collectSystem(config.agentVersion)
  };
  const response = await signedPost(config, "/api/agent/poll", initial) as { tasks?: ClaimedTask[] };
  for (const task of response.tasks || []) {
    try {
      await executeTask(config, task);
    } catch (error) {
      const taskId = task?.envelope?.taskId;
      if (taskId) await acknowledge(config, taskId, "failed", { errorCategory: "unknown" }, (error as Error).message).catch(() => undefined);
    }
  }
}

async function main() {
  const config = await maybeEnroll();
  let delay = config.pollIntervalSeconds * 1000;
  setInterval(() => {
    void pollOnce()
      .then(() => { delay = config.pollIntervalSeconds * 1000; })
      .catch((error) => {
        delay = Math.min(delay * 2, 5 * 60 * 1000);
        console.error(`[agent] poll failed: ${error.message}`);
      });
  }, Math.max(10_000, delay + Math.floor(Math.random() * 2500)));
  await pollOnce();
}

if (process.env.NODE_ENV !== "test") {
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

export { executeTask, pollOnce, verifyTask };
