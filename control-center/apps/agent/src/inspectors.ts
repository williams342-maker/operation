import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MongoClient } from "mongodb";
import { validateRegisteredPath } from "@control-center/shared";
import { execFixed } from "./safeExec.js";
import type { AgentConfig } from "./config.js";
import { parseComposePsLine, parseDockerPsLine } from "./parsers.js";

export async function collectSystem(agentVersion: string) {
  const cpus = os.cpus();
  const load = os.loadavg()[0] || 0;
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const disks = await collectDisks();
  return {
    collectedAt: new Date().toISOString(),
    agentVersion,
    uptimeSeconds: os.uptime(),
    cpu: { loadPercent: Math.min(100, (load / Math.max(1, cpus.length)) * 100), cores: cpus.length },
    memory: { totalBytes: totalMem, usedBytes: totalMem - freeMem },
    disk: disks
  };
}

async function collectDisks() {
  const roots = process.platform === "win32" ? [path.parse(process.cwd()).root] : ["/"];
  return roots.map((mount) => {
    try {
      const stats = fs.statfsSync(mount);
      return { mount, totalBytes: stats.blocks * stats.bsize, usedBytes: (stats.blocks - stats.bfree) * stats.bsize };
    } catch {
      return { mount, totalBytes: 0, usedBytes: 0 };
    }
  });
}

function validateAgainstAllowedRoots(config: AgentConfig, candidate?: string) {
  if (!candidate) return undefined;
  for (const root of config.allowedRoots) {
    try {
      return validateRegisteredPath(root, candidate);
    } catch {
      continue;
    }
  }
  throw new Error("Registered path is outside allowed roots");
}

export async function collectGit(config: AgentConfig, projects: Array<{ projectId: string; repoPath?: string }>) {
  const rows = [];
  for (const project of projects) {
    try {
      const repoPath = validateAgainstAllowedRoots(config, project.repoPath);
      if (!repoPath) continue;
      const [branch, commit, dirty] = await Promise.all([
        execFixed("git", ["rev-parse", "--abbrev-ref", "HEAD"], repoPath),
        execFixed("git", ["rev-parse", "--short", "HEAD"], repoPath),
        execFixed("git", ["status", "--porcelain"], repoPath)
      ]);
      rows.push({ projectId: project.projectId, branch: branch.stdout.trim(), commit: commit.stdout.trim(), dirty: Boolean(dirty.stdout.trim()), collectedAt: new Date().toISOString() });
    } catch {
      rows.push({ projectId: project.projectId, collectedAt: new Date().toISOString() });
    }
  }
  return rows;
}

export async function collectDocker() {
  const result = await execFixed("docker", ["ps", "--format", "{{json .}}"]);
  return result.stdout.split(/\r?\n/).filter(Boolean).map((line) => {
    try {
      return parseDockerPsLine(line);
    } catch {
      return { name: "unknown", state: "unknown" };
    }
  });
}

export async function collectCompose(config: AgentConfig, projects: Array<{ projectId: string; composePath?: string }>) {
  const rows = [];
  for (const project of projects) {
    try {
      const composePath = validateAgainstAllowedRoots(config, project.composePath);
      if (!composePath) continue;
      const cwd = fs.statSync(composePath).isDirectory() ? composePath : path.dirname(composePath);
      const args = fs.statSync(composePath).isDirectory()
        ? ["compose", "ps", "--format", "json"]
        : ["compose", "-f", composePath, "ps", "--format", "json"];
      const result = await execFixed("docker", args, cwd);
      for (const line of result.stdout.split(/\r?\n/).filter(Boolean)) {
        rows.push(parseComposePsLine(line, project.projectId, composePath));
      }
    } catch {
      continue;
    }
  }
  return rows;
}

export async function collectHttp(checks: Array<{ id: string; url: string; timeoutMs: number }>) {
  const rows = [];
  for (const check of checks) {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), check.timeoutMs);
    try {
      const response = await fetch(check.url, { method: "GET", signal: controller.signal });
      rows.push({ healthCheckId: check.id, success: response.ok, statusCode: response.status, latencyMs: Date.now() - started, checkedAt: new Date().toISOString() });
    } catch (error) {
      const category = (error as Error).name === "AbortError" ? "timeout" : "network";
      rows.push({ healthCheckId: check.id, success: false, latencyMs: Date.now() - started, errorCategory: category, checkedAt: new Date().toISOString() });
    } finally {
      clearTimeout(timer);
    }
  }
  return rows;
}

export async function collectMongo(config: AgentConfig, checks: Array<{ id: string; databaseNameHint?: string }>) {
  const rows = [];
  for (const check of checks) {
    const uri = config.mongoChecks[check.id];
    const started = Date.now();
    if (!uri) {
      rows.push({ mongoCheckId: check.id, success: false, errorCategory: "configuration", checkedAt: new Date().toISOString() });
      continue;
    }
    try {
      const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
      await client.connect();
      const db = check.databaseNameHint ? client.db(check.databaseNameHint) : client.db();
      await db.command({ ping: 1 });
      const databaseName = db.databaseName;
      await client.close();
      rows.push({ mongoCheckId: check.id, success: true, latencyMs: Date.now() - started, databaseName, checkedAt: new Date().toISOString() });
    } catch (error) {
      const message = (error as Error).message.toLowerCase();
      const errorCategory = message.includes("auth") ? "auth" : message.includes("timeout") ? "timeout" : "network";
      rows.push({ mongoCheckId: check.id, success: false, latencyMs: Date.now() - started, errorCategory, checkedAt: new Date().toISOString() });
    }
  }
  return rows;
}
