import os from "node:os";
import { agentPollRequestSchema, agentSigningKey, deploymentCapabilities, isTaskExpired, verifyTaskEnvelope, verifyTaskEnvelopeV2, isPrivilegedTaskType, authorizePrivilegedTask, privilegedSubPayload, type TaskEnvelope, type TaskPayload, type TaskType } from "@control-center/shared";
import fs from "node:fs";
import path from "node:path";
import { loadConfig, saveConfig, stateDir, type AgentConfig } from "./config.js";
import { enroll, signedPost } from "./client.js";
import { collectApplicationDiscovery, collectCompose, collectDocker, collectGit, collectHttp, collectMongo, collectSystem } from "./inspectors.js";
import { executeConfigurationDeployment } from "./configurationDeployment.js";
import { handoffUpgrade } from "./upgradeHandoff.js";
import { ExecutionJournal } from "./executionJournal.js";
import { ReviewGateClient } from "./reviewGateClient.js";
import { resolveEnforcement } from "./reviewEnforcement.js";
import { acquireForEffect, keepExecutionAlive, recordEffect, type Acquired } from "./reviewEnforcedExecution.js";

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

export type ReviewEnforcement =
  | { enforcing: true; gate: ReviewGateClient; journal: ExecutionJournal }
  | { enforcing: false };

/**
 * Layer 3, resolved from DURABLE STATE at a location this function's caller cannot choose.
 *
 * TWO INPUTS, AND ONLY ONE OF THEM IS AN ARGUMENT. *Whether* this executor enforces comes from the record
 * at `stateDir()`, which is derived from the process's own configuration path — the previous version read
 * it from `config.stateDir`, and an independent review showed that let any caller of `executeTask` hand
 * over a config naming an empty directory and be told it was advisory. *Where the gate is* still comes
 * from the config, and that is deliberate: substituting or removing it fails CLOSED, because an executor
 * whose record says ENFORCING and whose gate configuration is unusable refuses to run at all.
 *
 * `resolveEnforcement` throws for exactly that case, and the throw is not caught here.
 */
export function reviewEnforcement(config: AgentConfig): ReviewEnforcement {
  const directory = stateDir();
  const decision = resolveEnforcement({ stateDir: directory, gate: config.reviewGate });
  if (!decision.enforcing) return { enforcing: false };
  return {
    enforcing: true,
    gate: new ReviewGateClient(decision.gate),
    journal: new ExecutionJournal(path.join(directory, "execution-journal")),
  };
}

/**
 * Close out an acquisition: journal first, then redeem. NEVER THROWS.
 *
 * It swallows its own failures on purpose, because it runs in both the success and the failure path and
 * must not replace a real execution error with a bookkeeping one. What it cannot do is hide the
 * consequence: an unredeemed attestation stays EXECUTING and becomes INDETERMINATE, which is precisely
 * the reconciliation signal the gate is built around.
 */
async function settle(enforcement: ReviewEnforcement, acquired: Acquired | undefined, outcome: { succeeded: boolean; terminalPhase?: string; error?: string }) {
  if (!acquired || !enforcement.enforcing) return;
  try {
    await recordEffect({ gate: enforcement.gate, journal: enforcement.journal, acquired, at: new Date().toISOString(), ...outcome });
  } catch { /* the attestation is left EXECUTING for reconciliation; see above */ }
}

function verifyTask(config: AgentConfig, task: ClaimedTask, enforcing = false) {
  const envelope = task.envelope;
  if (envelope.agentId !== config.agentId) throw new Error("Task assigned to a different agent");
  if (isTaskExpired(envelope.expiresAt)) throw new Error("Task expired");
  // v2 envelopes are signed by the control plane's Ed25519 key and verified with its PUBLIC key; v1
  // envelopes keep the legacy agent-keyed HMAC. The signed signingKeyVersion selects the path.
  const useV2 = envelope.signingKeyVersion.startsWith("cp-ed25519");
  if (useV2 && !config.controlPlanePublicKey) throw new Error("Control-plane public key unavailable for v2 task verification");
  const verifyEnvelope = () => useV2
    ? verifyTaskEnvelopeV2(config.controlPlanePublicKey!, envelope, task.payload)
    : verifyTaskEnvelope(agentSigningKey(config.agentSecret), envelope, task.payload);
  // Privileged tasks require BOTH the transport envelope AND an independent owner authorization (owner
  // PUBLIC key). Enforced whenever the owner key is configured; the transport key alone never suffices.
  if (isPrivilegedTaskType(envelope.taskType) && config.ownerPublicKey) {
    const decision = authorizePrivilegedTask({ envelope, payload: task.payload, ownerAuthorization: task.payload.ownerAuthorization, ownerPublicKey: config.ownerPublicKey, verifyEnvelope, requireReviewAuthorization: enforcing });
    if (!decision.authorized) throw new Error(`Privileged task authorization failed: ${decision.reason}`);
    return;
  }
  if (!verifyEnvelope()) throw new Error("Invalid task signature");
}

async function acknowledge(config: AgentConfig, taskId: string, event: "claimed" | "started" | "progress" | "succeeded" | "failed", result?: unknown, message?: string) {
  return signedPost(config, "/api/agent/tasks/ack", { taskId, event, result, message });
}

/**
 * ENFORCEMENT IS RESOLVED HERE, from a record no argument can point elsewhere.
 *
 * This took two review rounds to get right, and the two failures are worth keeping side by side because
 * they are the same mistake at different depths:
 *
 *   round 1 — enforcement arrived as an optional argument defaulting to advisory, so any caller that
 *             omitted it bypassed the gate on an ENFORCING host.
 *   round 2 — the argument was gone, but the record's LOCATION still came from the caller's config, so
 *             `executeTask({...config, stateDir: emptyDir}, task)` was told it was advisory. Removing the
 *             argument had moved the caller-controlled input, not removed it.
 *
 * Both times my description said "unbypassable" and the mechanism said "unbypassable by callers who
 * follow the convention". The location is now derived from the process (see `stateDir()` in config.ts).
 *
 * The honest boundary, stated as precisely as I can manage after being caught loosening it three times:
 * this resists a caller that omits or substitutes the parsed `AgentConfig` after process initialization.
 * It does not resist a different process environment (a launch pointing `CONTROL_CENTER_AGENT_CONFIG`
 * elsewhere selects a different record), arbitrary code in this process, or write access to the host —
 * all of which require host control. Activation resists a compromised control-center, not a compromised
 * host. See `stateDir()` in config.ts for the full statement.
 */
async function executeTask(config: AgentConfig, task: ClaimedTask) {
  const enforcement = reviewEnforcement(config);
  verifyTask(config, task, enforcement.enforcing);
  const { envelope, payload } = task;
  await acknowledge(config, envelope.taskId, "claimed").catch(() => undefined);
  await acknowledge(config, envelope.taskId, "started");

  // THE EFFECT POINT. Acquisition is a mutation on the gate and a claim on this host, and both happen
  // before anything is applied. For a privileged task under enforcement, nothing below runs unless both
  // were won — and a refusal ends the task rather than downgrading it to a warning.
  let acquired: Acquired | undefined;
  if (enforcement.enforcing && isPrivilegedTaskType(envelope.taskType)) {
    const outcome = await acquireForEffect({
      gate: enforcement.gate, journal: enforcement.journal,
      // The SUB-PAYLOAD, which is what the gate bound. See acquireForEffect.
      payload: privilegedSubPayload(envelope.taskType, payload),
      taskType: envelope.taskType, orgId: envelope.orgId, serverId: envelope.serverId,
      at: new Date().toISOString(),
    });
    if (outcome.refused) {
      // FAIL CLOSED. An unreachable gate, a refused acquisition and an unresolved prior attempt on this
      // host all end here identically, because none of them is permission to touch the host.
      await acknowledge(config, envelope.taskId, "failed", { errorCategory: "review-gate", reviewGate: outcome.code },
        `Review gate refused execution: ${outcome.code}${outcome.detail ? ` (${outcome.detail})` : ""}`);
      return;
    }
    acquired = outcome;
  }

  // The authorization has a deadline, and until now nothing read it. A privileged effect that outran
  // its window kept going with a lapsed attempt and only found out at redeem. The keeper asks the gate
  // for more time before the window closes, using the attempt token from memory, and stops the moment
  // the effect is done -- whichever way it ends, which is why it is released in a `finally` rather
  // than after the settle.
  const keeper = acquired && enforcement.enforcing
    ? keepExecutionAlive({ gate: enforcement.gate, acquired })
    : undefined;

  try {
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
        result = await executeConfigurationDeployment(payload.configurationDeployment, agentSigningKey(config.agentSecret), envelope.nonce, [...deploymentCapabilities], config.agentVersion, {}, config.encryptionPrivateKey);
        break;
      case "agent.upgrade":
        if (!payload.agentUpgrade) throw new Error("Missing typed agent upgrade manifest");
        result = handoffUpgrade(config, payload.agentUpgrade, envelope.serverId, envelope.taskId);
        // REDEEMED AT THE HANDOFF, not at the updater's verdict, and the distinction is worth being exact
        // about. Redeem does not mean "the upgrade succeeded" — it means the authorization has been spent,
        // and by this line it has: the handoff is written and an independent updater will act on it,
        // including by replacing this process. Holding the lease until the updater reports would make every
        // upgrade INDETERMINATE, because the executor that would redeem it no longer exists. The journal
        // entry records what was actually true at this point, and nothing more.
        await settle(enforcement, acquired, { succeeded: true, terminalPhase: "handed-to-updater" });
        await acknowledge(config, envelope.taskId, "progress", result, "Agent upgrade handed to independent updater");
        return;
      default:
        throw new Error("Unsupported task type");
    }
    const deploymentResult = envelope.taskType === "configuration.apply" || envelope.taskType === "configuration.rollback" ? result as { phase?: string } : undefined;
    const failed = Boolean(deploymentResult && deploymentResult.phase !== "succeeded");
    // Settled BEFORE the acknowledgement, so the durable local record is written before the control-center
    // is told anything. If this host dies between the two, the journal is still right.
    await settle(enforcement, acquired, { succeeded: !failed, terminalPhase: deploymentResult?.phase });
    await acknowledge(config, envelope.taskId, failed ? "failed" : "succeeded", result, deploymentResult ? `Configuration deployment ${deploymentResult.phase || "failed"}` : undefined);
  } catch (error) {
    // A throw after acquisition still consumed the attestation, and the host may already have been
    // partly changed. Record that, then re-throw so the existing failure path is unchanged.
    await settle(enforcement, acquired, { succeeded: false, error: (error as Error)?.message });
    throw error;
  } finally {
    // Including the `agent.upgrade` path, which returns from inside the try. A keeper left running
    // would go on extending an attempt that has already been redeemed.
    keeper?.stop();
  }
}

async function pollOnce() {
  const config = await maybeEnroll();
  // Resolved here too, BEFORE any task is claimed, so an executor whose gate configuration has gone
  // missing stops the poll rather than failing task by task. `executeTask` resolves it again for itself
  // and does not take it from here — that argument was the defect an independent review found.
  reviewEnforcement(config);
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
  // Resolved once here as well as per poll, so an ENFORCING executor with unusable gate configuration
  // fails to START rather than logging a poll error every interval while looking alive.
  reviewEnforcement(config);
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
