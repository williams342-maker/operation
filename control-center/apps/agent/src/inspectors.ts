import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MongoClient } from "mongodb";
import { validateRegisteredPath } from "@control-center/shared";
import { execFixed, type FixedExecutable } from "./safeExec.js";
import { capDiscovery, DISCOVERY_LIMITS, sanitizeGitRemote, walkSameDevice } from "./discoverySafety.js";
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
    cpu: { loadPercent: Math.min(100, (load / Math.max(1, cpus.length)) * 100), cores: cpus.length, loadAverage: os.loadavg() as [number, number, number] },
    memory: { totalBytes: totalMem, usedBytes: totalMem - freeMem },
    disk: disks,
    network: collectNetwork()
  };
}

function collectNetwork() {
  if (process.platform !== "linux") return { receivedBytes: 0, transmittedBytes: 0 };
  try {
    const rows = fs.readFileSync("/proc/net/dev", "utf8").split(/\r?\n/).slice(2);
    return rows.reduce((total, row) => { const [name, values] = row.trim().split(":"); if (!values || name === "lo") return total; const fields = values.trim().split(/\s+/).map(Number); total.receivedBytes += fields[0] || 0; total.transmittedBytes += fields[8] || 0; return total; }, { receivedBytes: 0, transmittedBytes: 0 });
  } catch { return { receivedBytes: 0, transmittedBytes: 0 }; }
}

export async function collectApplicationDiscovery(config: AgentConfig) {
  const traversals = config.allowedRoots.map(walkSameDevice); const directories = [...new Set(traversals.flatMap((item) => item.directories))].slice(0, DISCOVERY_LIMITS.directories);
  const repositories = []; const composeProjects = []; const applications = []; const warnings = traversals.flatMap((item) => item.warnings);
  for (const directory of directories) {
    if (fs.existsSync(path.join(directory, ".git"))) {
      const get = async (args: string[]) => (await execFixed("git", args, directory)).stdout.trim();
      const rawRemote = await get(["remote", "get-url", "origin"]).catch(() => "");
      repositories.push({ path: directory.slice(0, DISCOVERY_LIMITS.paths), branch: (await get(["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => undefined))?.slice(0, DISCOVERY_LIMITS.branch), commit: (await get(["rev-parse", "HEAD"]).catch(() => undefined))?.slice(0, DISCOVERY_LIMITS.commit), remote: sanitizeGitRemote(rawRemote) || undefined, dirty: Boolean(await get(["status", "--porcelain"]).catch(() => "")) });
    }
    const composeFile = ["compose.yml", "compose.yaml", "docker-compose.yml", "docker-compose.yaml"].map((name) => path.join(directory, name)).find(fs.existsSync);
    if (composeFile) composeProjects.push({ name: path.basename(directory).slice(0, DISCOVERY_LIMITS.name), configPath: composeFile.slice(0, DISCOVERY_LIMITS.paths), services: [] });
    const markers: Array<[string, "node" | "python" | "dotnet"]> = [["package.json", "node"], ["pyproject.toml", "python"], ["requirements.txt", "python"]];
    const marker = markers.find(([file]) => fs.existsSync(path.join(directory, file)));
    const dotnet = (() => { try { return fs.readdirSync(directory).find((file) => file.endsWith(".csproj")); } catch { return undefined; } })();
    if (marker || dotnet) applications.push({ path: directory.slice(0, DISCOVERY_LIMITS.paths), type: marker?.[1] || "dotnet" as const, name: path.basename(directory).slice(0, DISCOVERY_LIMITS.name) });
  }
  const installed = async (command: FixedExecutable, args: string[]) => Boolean(await execFixed(command, args).then((result) => result.code === 0).catch(() => false));
  return capDiscovery({ collectedAt: new Date().toISOString(), dockerInstalled: await installed("docker", ["--version"]), composeProjects, repositories, applications, nginxInstalled: await installed("nginx", ["-v"]), warnings });
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
  return result.stdout.split(/\r?\n/).filter(Boolean).slice(0, 250).map((line) => {
    try {
      const row = parseDockerPsLine(line); return { name: row.name.slice(0, 255), image: row.image?.slice(0, 512), state: row.state.slice(0, 128), status: row.status?.slice(0, 512) };
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
  return rows.slice(0, 250);
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
