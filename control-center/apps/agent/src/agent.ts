import os from "node:os";
import { agentPollRequestSchema, agentSigningKey, deploymentCapabilities, isTaskExpired, verifyTaskEnvelope, type TaskEnvelope, type TaskPayload, type TaskType } from "@control-center/shared";
import fs from "node:fs";
import path from "node:path";
import { loadConfig, saveConfig, type AgentConfig } from "./config.js";
import { enroll, signedPost } from "./client.js";
import { collectApplicationDiscovery, collectCompose, collectDocker, collectGit, collectHttp, collectMongo, collectSystem } from "./inspectors.js";
import { executeConfigurationDeployment } from "./configurationDeployment.js";
import { handoffUpgrade } from "./upgradeHandoff.js";

const advertisedCapabilities = ["system", "docker", "compose", "git", "http", "mongo", "environmentDiscovery", "configurationFingerprinting", "encryptedSecretDelivery", "environmentFileWrite", "dockerComposeActivation", "configurationValidation", "configurationRollback", "agentUpgrade", "upgradeManifestHandoff"] as const;
const heartbeatStateFile = "/var/lib/opsworkbench-agent/agent/heartbeat.json";
function writeUpdaterHeartbeat(config: AgentConfig, discoveryComplete: boolean) { try { fs.mkdirSync(path.dirname(heartbeatStateFile), { recursive: true, mode: 0o750 }); const temporary = `${heartbeatStateFile}.pending`; fs.writeFileSync(temporary, `${JSON.stringify({ agentVersion: config.agentVersion, capabilities: advertisedCapabilities, discoveryComplete, recordedAt: new Date().toISOString() })}\n`, { mode: 0o600 }); fs.renameSync(temporary, heartbeatStateFile); } catch { /* updater heartbeat is best-effort; polling remains authoritative */ } }

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
    agentVersion: config.agentVersion,
    protocolVersion: config.protocolVersion,
    packageType: config.packageType,
    releaseChannel: config.releaseChannel,
    binarySha256: config.binarySha256,
    capabilities: [...advertisedCapabilities]
  });
  const nextConfig = { ...config, serverId: result.serverId, agentId: result.agentId, agentSecret: result.agentSecret, pollIntervalSeconds: result.pollIntervalSeconds };
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
    case "configuration.apply":
    case "configuration.rollback":
      if (!payload.configurationDeployment) throw new Error("Missing typed configuration deployment payload");
      result = await executeConfigurationDeployment(payload.configurationDeployment, agentSigningKey(config.agentSecret), envelope.nonce, [...deploymentCapabilities], config.agentVersion);
      break;
    case "agent.upgrade":
      if (!payload.agentUpgrade) throw new Error("Missing typed agent upgrade manifest");
      result = handoffUpgrade(config, payload.agentUpgrade, envelope.serverId, envelope.taskId);
      await acknowledge(config, envelope.taskId, "progress", result, "Agent upgrade handed to independent updater");
      return;
    default:
      throw new Error("Unsupported task type");
  }
  const deploymentResult = envelope.taskType === "configuration.apply" || envelope.taskType === "configuration.rollback" ? result as { phase?: string } : undefined;
  await acknowledge(config, envelope.taskId, deploymentResult && deploymentResult.phase !== "succeeded" ? "failed" : "succeeded", result, deploymentResult ? `Configuration deployment ${deploymentResult.phase || "failed"}` : undefined);
}

async function pollOnce() {
  const config = await maybeEnroll();
  await reportUpdaterResults(config);
  const initial = {
    heartbeat: { collectedAt: new Date().toISOString(), agentVersion: config.agentVersion, protocolVersion: config.protocolVersion, packageType: config.packageType, releaseChannel: config.releaseChannel, binarySha256: config.binarySha256, capabilities: [...advertisedCapabilities] },
    metrics: await collectSystem(config.agentVersion),
    docker: await collectDocker().catch(() => []),
    discovery: await collectApplicationDiscovery(config).catch(() => undefined)
  };
  const response = await signedPost(config, "/api/agent/poll", agentPollRequestSchema.parse(initial)) as { serverId?: string; tasks?: ClaimedTask[] };
  if (!config.serverId && response.serverId) { config.serverId = response.serverId; saveConfig(config); }
  writeUpdaterHeartbeat(config, Boolean(initial.discovery));
  for (const task of response.tasks || []) {
    try {
      await executeTask(config, task);
    } catch (error) {
      const taskId = task?.envelope?.taskId;
      if (taskId) {
        const configurationTask = task.envelope.taskType === "configuration.apply" || task.envelope.taskType === "configuration.rollback";
        const upgradeTask = task.envelope.taskType === "agent.upgrade" && task.payload.agentUpgrade;
        const result = configurationTask ? { phase: "failed", progress: 100, changedVariables: 0, services: [], healthChecksPassed: 0, errorCategory: "unknown" } : upgradeTask ? { phase: "failed", upgradeId: upgradeTask.upgradeId, errorCategory: "unknown" } : { errorCategory: "unknown" };
        await acknowledge(config, taskId, "failed", result, configurationTask ? "Configuration deployment failed" : (error as Error).message).catch(() => undefined);
      }
    }
  }
}

async function reportUpdaterResults(config: AgentConfig, resultsDirectory = "/var/lib/opsworkbench-agent/updater-results", agentState = "/var/lib/opsworkbench-agent/agent") {
  if (!fs.existsSync(resultsDirectory)) return;
  for (const name of fs.readdirSync(resultsDirectory).filter((item) => /^[A-Za-z0-9._:-]+\.result\.json$/.test(item))) {
    const upgradeId = name.slice(0, -".result.json".length); const mapping = path.join(agentState, `${upgradeId}.task.json`); if (!fs.existsSync(mapping)) continue;
    try { const result = JSON.parse(fs.readFileSync(path.join(resultsDirectory, name), "utf8")); const { taskId } = JSON.parse(fs.readFileSync(mapping, "utf8")); const success = result.phase === "complete"; await acknowledge(config, taskId, success ? "succeeded" : "failed", result, success ? "Agent upgrade validated" : `Agent upgrade ${result.phase}`); fs.unlinkSync(path.join(resultsDirectory, name)); fs.unlinkSync(mapping); } catch { /* retry on next poll without logging result content */ }
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

export { executeTask, pollOnce, reportUpdaterResults, verifyTask };
