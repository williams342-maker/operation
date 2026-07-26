import crypto from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { projectDeploymentCapabilities, projectDeploymentPayloadSchema, type ProjectDeploymentResult } from "@control-center/shared";
import { validateDeploymentPath } from "./configurationDeployment.js";
import { execFixed } from "./safeExec.js";
import { requestSafeHttp, resolveSafeHttpTarget, type SafeHttpHooks } from "./safeHttp.js";

const usedNonces = new Map<string, number>();
type CommandResult = { stdout?: string; code: number | null };
export type ProjectDeploymentHooks = {
  git?: (args: string[], cwd: string) => Promise<CommandResult>;
  compose?: (args: string[], cwd: string) => Promise<CommandResult>;
  health?: (url: string, timeoutMs: number) => Promise<boolean>;
  resolve?: (hostname: string) => Promise<string[]>;
  httpRequest?: SafeHttpHooks["request"];
  now?: () => Date;
  healthRetryWindowMs?: number;
  healthRetryIntervalMs?: number;
};

class ExecutionFailure extends Error { constructor(public classification: NonNullable<ProjectDeploymentResult["failureClassification"]>, message: string) { super(message); } }
const clean = (value: string | undefined) => (value || "").trim();

async function healthCheck(url: string, timeoutMs: number, hooks: ProjectDeploymentHooks) {
  if (hooks.health) return hooks.health(url, timeoutMs);
  await resolveSafeHttpTarget(url, hooks.resolve);
  const response = await requestSafeHttp(url, timeoutMs, { resolve: hooks.resolve, request: hooks.httpRequest });
  return response.statusCode >= 200 && response.statusCode < 300;
}

async function waitForHealth(url: string, timeoutMs: number, hooks: ProjectDeploymentHooks) {
  const now = hooks.now || (() => new Date());
  const deadline = now().getTime() + Math.max(timeoutMs, hooks.healthRetryWindowMs ?? 120_000);
  do {
    try { if (await healthCheck(url, timeoutMs, hooks)) return true; } catch { /* bounded retry */ }
    if (now().getTime() >= deadline) return false;
    await sleep(Math.min(hooks.healthRetryIntervalMs ?? 5_000, Math.max(0, deadline - now().getTime())));
  } while (true);
}

async function runHealthGate(checks: Array<{ url: string; timeoutMs: number }>, hooks: ProjectDeploymentHooks) {
  const results = await Promise.all(checks.map((check) => waitForHealth(check.url, check.timeoutMs, hooks)));
  return results.filter(Boolean).length;
}

export async function executeProjectDeployment(raw: unknown, nonce: string, capabilities: string[], hooks: ProjectDeploymentHooks = {}): Promise<ProjectDeploymentResult> {
  let payload;
  try { payload = projectDeploymentPayloadSchema.parse(raw); } catch { throw new ExecutionFailure("schema", "Invalid project deployment payload"); }
  if (payload.protected || !["staging", "preview", "testing"].includes(payload.environmentKind)) throw new ExecutionFailure("policy", "Production project deployment is unavailable");
  if (!projectDeploymentCapabilities.every((capability) => capabilities.includes(capability))) throw new ExecutionFailure("capability", "Incomplete project deployment capabilities");
  const now = (hooks.now || (() => new Date()))().getTime();
  for (const [key, expiry] of usedNonces) if (expiry <= now) usedNonces.delete(key);
  if (usedNonces.has(nonce)) throw new ExecutionFailure("replay", "Project deployment replay rejected");
  usedNonces.set(nonce, now + 24 * 60 * 60 * 1000);
  try {
    validateDeploymentPath(payload.repositoryRoot, payload.repositoryRoot);
    for (const file of [payload.composePath, ...payload.composeOverridePaths]) validateDeploymentPath(payload.repositoryRoot, file);
    for (const check of payload.healthChecks) await resolveSafeHttpTarget(check.url, hooks.resolve);
  } catch { throw new ExecutionFailure("path", "Deployment target path or health target rejected"); }

  const git = hooks.git || ((args: string[], cwd: string) => execFixed("git", args, cwd, 120_000));
  const compose = hooks.compose || ((args: string[], cwd: string) => execFixed("docker", args, cwd, 600_000));
  const runGit = async (args: string[]) => {
    const result = await git(args, payload.repositoryRoot);
    if (result.code !== 0) throw new ExecutionFailure("repository_state", "Repository command failed");
    return clean(result.stdout);
  };
  const checkpointRevision = await runGit(["rev-parse", "HEAD"]);
  const branch = await runGit(["symbolic-ref", "--short", "HEAD"]);
  const dirty = await runGit(["status", "--porcelain"]);
  if (!/^[a-f0-9]{40}$/.test(checkpointRevision) || checkpointRevision !== payload.expectedCurrentRevision || branch !== payload.branch || dirty) throw new ExecutionFailure("repository_state", "Repository changed after Git preflight");
  const resolved = await runGit(["rev-parse", "--verify", `${payload.requestedRevision}^{commit}`]);
  if (resolved !== payload.requestedRevision) throw new ExecutionFailure("revision", "Approved revision could not be resolved exactly");

  const composeFiles = [payload.composePath, ...payload.composeOverridePaths].flatMap((file) => ["-f", file]);
  const composeArgs = ["compose", ...composeFiles, "-p", payload.composeProject, "up", "-d", "--no-deps", "--force-recreate", "--build", "--pull", "never", "--quiet-build", "--quiet-pull", ...payload.statelessServices];
  let failure: "activation" | "health" = "activation";
  let passed = 0;
  try {
    const reset = await git(["reset", "--hard", payload.requestedRevision], payload.repositoryRoot);
    if (reset.code !== 0) throw new ExecutionFailure("activation", "Approved revision activation failed");
    for (const file of [payload.composePath, ...payload.composeOverridePaths]) validateDeploymentPath(payload.repositoryRoot, file);
    const activated = await compose(composeArgs, payload.repositoryRoot);
    if (activated.code !== 0) throw new ExecutionFailure("activation", "Compose activation failed");
    failure = "health";
    passed = await runHealthGate(payload.healthChecks, hooks);
    if (passed !== payload.healthChecks.length) throw new ExecutionFailure("health", "Deployment health validation failed");
    const tree = await runGit(["rev-parse", "HEAD^{tree}"]);
    return { phase: "succeeded", progress: 100, deployedRevision: payload.requestedRevision, checkpointRevision, artifactDigest: crypto.createHash("sha256").update(tree).digest("hex"), releaseId: `deploy-${payload.requestedRevision.slice(0, 12)}`, services: payload.statelessServices, healthChecksPassed: passed, rollbackAttempted: false, rollbackVerified: false };
  } catch (error) {
    const classification = error instanceof ExecutionFailure ? error.classification : failure;
    const restored = await git(["reset", "--hard", checkpointRevision], payload.repositoryRoot);
    if (restored.code !== 0) return { phase: "rollback_failed", progress: 100, checkpointRevision, services: payload.statelessServices, healthChecksPassed: 0, rollbackAttempted: true, rollbackVerified: false, failureClassification: "rollback" };
    const reactivated = await compose(composeArgs, payload.repositoryRoot);
    if (reactivated.code !== 0) return { phase: "rollback_failed", progress: 100, checkpointRevision, restoredRevision: checkpointRevision, services: payload.statelessServices, healthChecksPassed: 0, rollbackAttempted: true, rollbackVerified: false, failureClassification: "rollback" };
    const rollbackChecks = await runHealthGate(payload.healthChecks, hooks);
    if (rollbackChecks !== payload.healthChecks.length) return { phase: "rollback_failed", progress: 100, checkpointRevision, restoredRevision: checkpointRevision, services: payload.statelessServices, healthChecksPassed: rollbackChecks, rollbackAttempted: true, rollbackVerified: false, failureClassification: "rollback" };
    return { phase: "rolled_back", progress: 100, checkpointRevision, restoredRevision: checkpointRevision, services: payload.statelessServices, healthChecksPassed: rollbackChecks, rollbackAttempted: true, rollbackVerified: true, failureClassification: classification };
  }
}

export function safeProjectDeploymentFailure(error: unknown): ProjectDeploymentResult {
  return { phase: "failed", progress: 100, services: [], healthChecksPassed: 0, rollbackAttempted: false, rollbackVerified: false, failureClassification: error instanceof ExecutionFailure ? error.classification : "unknown" };
}

export function resetProjectDeploymentReplayForTests() { if (process.env.NODE_ENV !== "test") throw new Error("Test-only operation"); usedNonces.clear(); }
