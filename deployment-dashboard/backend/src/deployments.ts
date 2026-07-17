import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { execSafe } from "./safeExec.js";
import type { AppSettings } from "./types.js";

type Deployment = {
  id: string;
  status: "running" | "success" | "failed";
  lines: string[];
};

const deployments = new Map<string, Deployment>();

export function getDeployment(id: string) {
  return deployments.get(id);
}

function addLine(deployment: Deployment, line: string, settings: AppSettings) {
  const clean = line.replace(/\r/g, "");
  deployment.lines.push(clean);
  fs.mkdirSync(settings.paths.logRoot, { recursive: true });
  fs.appendFileSync(path.join(settings.paths.logRoot, "deployment.log"), clean);
}

export function startDeployment(settings: AppSettings) {
  const deployment: Deployment = { id: nanoid(), status: "running", lines: [] };
  deployments.set(deployment.id, deployment);
  void runDeployment(deployment, settings);
  return deployment.id;
}

async function step(deployment: Deployment, settings: AppSettings, label: string, command: string, args: string[], cwd: string) {
  addLine(deployment, `\n== ${label} ==\n`, settings);
  const result = await execSafe(command, args, cwd, (chunk) => addLine(deployment, chunk, settings));
  if (result.code !== 0) throw new Error(`${label} failed with exit code ${result.code}`);
}

async function packageChanged(settings: AppSettings) {
  const result = await execSafe("git", ["diff", "--name-only", "HEAD@{1}", "HEAD"], settings.paths.repoRoot);
  return /(^|\/)package(-lock)?\.json$/m.test(result.stdout);
}

async function runDeployment(deployment: Deployment, settings: AppSettings) {
  try {
    await step(deployment, settings, "Fetch", "git", ["fetch", "origin", settings.github.branch], settings.paths.repoRoot);
    await step(deployment, settings, "Pull", "git", ["pull", "--ff-only", "origin", settings.github.branch], settings.paths.repoRoot);
    if (await packageChanged(settings)) {
      await step(deployment, settings, "Install backend dependencies", settings.commands.backendInstall[0], settings.commands.backendInstall.slice(1), settings.paths.backendRoot);
      await step(deployment, settings, "Install frontend dependencies", settings.commands.frontendInstall[0], settings.commands.frontendInstall.slice(1), settings.paths.frontendRoot);
    }
    await step(deployment, settings, "Build frontend", settings.commands.frontendBuild[0], settings.commands.frontendBuild.slice(1), settings.paths.frontendRoot);
    await step(deployment, settings, "Restart backend", "pm2", ["restart", settings.pm2.backendProcess], settings.paths.repoRoot);
    await step(deployment, settings, "Restart frontend", "pm2", ["restart", settings.pm2.frontendProcess], settings.paths.repoRoot);
    deployment.status = "success";
    addLine(deployment, "\nDeployment completed successfully.\n", settings);
  } catch (error) {
    deployment.status = "failed";
    addLine(deployment, `\nDeployment failed: ${(error as Error).message}\n`, settings);
    try {
      await step(deployment, settings, "Rollback", "git", ["reset", "--hard", "HEAD@{1}"], settings.paths.repoRoot);
      await step(deployment, settings, "Restart backend after rollback", "pm2", ["restart", settings.pm2.backendProcess], settings.paths.repoRoot);
      await step(deployment, settings, "Restart frontend after rollback", "pm2", ["restart", settings.pm2.frontendProcess], settings.paths.repoRoot);
    } catch (rollbackError) {
      addLine(deployment, `Rollback failed: ${(rollbackError as Error).message}\n`, settings);
    }
  }
}
