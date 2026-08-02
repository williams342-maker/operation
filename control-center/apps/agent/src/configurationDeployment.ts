import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import dns from "node:dns/promises";
import { configurationDeploymentPayloadSchema, deploymentCapabilities, isCompatibleAgentVersion, minimumDeploymentAgentVersion, type ConfigurationDeploymentPayload, type DeploymentProgress } from "@control-center/shared";
import { execFixed } from "./safeExec.js";
import { linuxMountPoints } from "./discoverySafety.js";
import { validateHttpCheckUrl } from "./urlSafety.js";

const MAX_VALUE = 16 * 1024;
const usedNonces = new Map<string, number>();

export type DeploymentHooks = { compose?: (args: string[], cwd: string) => Promise<{ code: number | null }>; health?: (url: string, timeoutMs: number) => Promise<boolean>; resolve?: (hostname: string) => Promise<string[]>; now?: () => Date };

function assertNonProduction(payload: ConfigurationDeploymentPayload) {
  if (payload.protected || !["staging", "development", "testing", "preview", "ci"].includes(payload.environmentKind)) throw new Error("Production configuration deployment is unavailable");
}

function contained(root: string, target: string) {
  const resolvedRoot = path.resolve(root); const resolved = path.resolve(target);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error("Target escapes repository root");
  return { root: resolvedRoot, target: resolved };
}

function assertSafePath(root: string, target: string) {
  const value = contained(root, target); const rootStat = fs.lstatSync(value.root); const mountPoints = linuxMountPoints();
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("Repository root is not a safe directory");
  let cursor = value.target;
  while (cursor !== value.root) {
    if (fs.existsSync(cursor)) { const stat = fs.lstatSync(cursor); if (stat.isSymbolicLink()) throw new Error("Symlink target rejected"); if (stat.dev !== rootStat.dev || mountPoints.has(path.resolve(cursor))) throw new Error("Mount-boundary target rejected"); }
    cursor = path.dirname(cursor);
  }
  return value.target;
}
export function validateDeploymentPath(root: string, target: string) { return assertSafePath(root, target); }

export function parseEnvironment(source: string) {
  const values = new Map<string, string>();
  for (const [index, raw] of source.split(/\n/).entries()) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const match = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match) throw new Error(`Unsafe environment syntax at line ${index + 1}`);
    if (values.has(match[1])) throw new Error("Duplicate environment variable");
    if (Buffer.byteLength(match[2], "utf8") > MAX_VALUE || /[\0\r\n]/.test(match[2])) throw new Error("Environment value rejected");
    values.set(match[1], match[2]);
  }
  return values;
}

export function configurationDigest(source: string) { return crypto.createHash("sha256").update(source).digest("hex"); }

export function applyEnvironmentMutations(source: string, mutations: ConfigurationDeploymentPayload["mutations"], resolved: Record<string, string>) {
  const current = parseEnvironment(source); const changed = new Set<string>();
  for (const mutation of mutations) {
    if (!("valueRef" in mutation)) current.delete(mutation.name);
    else { const value = resolved[mutation.valueRef]; if (value === undefined) throw new Error("Missing encrypted value reference"); current.set(mutation.name, value); }
    changed.add(mutation.name);
  }
  const output: string[] = [];
  for (const raw of source.split(/\n/)) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    const match = /^([A-Z_][A-Z0-9_]*)=/.exec(line);
    if (!match || !changed.has(match[1])) { if (line || output.length) output.push(line); continue; }
    if (current.has(match[1])) { output.push(`${match[1]}=${current.get(match[1])}`); current.delete(match[1]); }
  }
  for (const mutation of mutations) if (current.has(mutation.name)) { output.push(`${mutation.name}=${current.get(mutation.name)}`); current.delete(mutation.name); }
  while (output.length && output[output.length - 1] === "") output.pop();
  return `${output.join("\n")}\n`;
}

export function decryptValues(payload: ConfigurationDeploymentPayload, signingKey: string) {
  const bundle = payload.encryptedValues; const key = crypto.createHash("sha256").update(`configuration-deployment:${signingKey}`).digest();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(bundle.nonce, "base64")); decipher.setAuthTag(Buffer.from(bundle.authTag, "base64"));
  const decoded = Buffer.concat([decipher.update(Buffer.from(bundle.ciphertext, "base64")), decipher.final()]).toString("utf8");
  const record = JSON.parse(decoded) as Record<string, unknown>;
  for (const [reference, value] of Object.entries(record)) if (!/^[A-Za-z0-9._:-]{1,160}$/.test(reference) || typeof value !== "string" || Buffer.byteLength(value) > MAX_VALUE || /[\0\r\n]/.test(value)) throw new Error("Decrypted configuration rejected");
  return record as Record<string, string>;
}

async function safeHealth(raw: string, timeoutMs: number, resolver: (hostname: string) => Promise<string[]>) {
  let current = raw;
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    await validateHttpCheckUrl(current, resolver);
    const response = await fetch(current, { signal: AbortSignal.timeout(timeoutMs), redirect: "manual" });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) { if (redirects === 3) return false; current = new URL(location, current).toString(); continue; }
    return response.ok;
  }
  return false;
}

function writeAtomic(file: string, content: string, mode: number, uid: number, gid: number) {
  const temporary = `${file}.pending-${crypto.randomUUID()}`; const fd = fs.openSync(temporary, "wx", 0o600);
  try { fs.writeFileSync(fd, content, "utf8"); fs.fsyncSync(fd); fs.fchmodSync(fd, mode); if (process.platform !== "win32") fs.fchownSync(fd, uid, gid); } finally { fs.closeSync(fd); }
  fs.renameSync(temporary, file);
  // Windows does not support fsync on directory handles; file data is still flushed before rename.
  if (process.platform !== "win32") { const directory = fs.openSync(path.dirname(file), "r"); try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); } }
}

export async function executeConfigurationDeployment(raw: unknown, signingKey: string, nonce: string, capabilities: string[], agentVersion: string | undefined, hooks: DeploymentHooks = {}): Promise<DeploymentProgress> {
  const payload = configurationDeploymentPayloadSchema.parse(raw); assertNonProduction(payload);
  if (!isCompatibleAgentVersion(agentVersion)) throw new Error(`Agent version must be stable and at least ${minimumDeploymentAgentVersion}`);
  if (!deploymentCapabilities.every((item) => capabilities.includes(item))) throw new Error("Incomplete deployment capabilities");
  const now = (hooks.now || (() => new Date()))(); for (const [key, expiry] of usedNonces) if (expiry < now.getTime()) usedNonces.delete(key);
  if (usedNonces.has(nonce)) throw new Error("Replay rejected"); usedNonces.set(nonce, now.getTime() + 24 * 60 * 60 * 1000);
  const resolver = hooks.resolve || (async (hostname: string) => (await dns.lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address));
  for (const check of payload.healthChecks) await validateHttpCheckUrl(check.url, resolver);
  const file = assertSafePath(payload.repositoryRoot, payload.environmentFilePath); assertSafePath(payload.repositoryRoot, payload.composePath);
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error("Environment file must be a regular file with one hard link");
  if (process.platform !== "win32" && (stat.mode & 0o022) !== 0) throw new Error("Environment file permissions are too broad");
  const original = fs.readFileSync(file, "utf8"); if (configurationDigest(original) !== payload.expectedConfigurationDigest) throw new Error("Expected configuration version mismatch");
  const backup = `${file}.backup-${now.toISOString().replace(/[:.]/g, "-")}`; fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL); fs.chmodSync(backup, stat.mode); if (process.platform !== "win32") fs.chownSync(backup, stat.uid, stat.gid);
  const secrets = decryptValues(payload, signingKey); const proposed = applyEnvironmentMutations(original, payload.mutations, secrets);
  writeAtomic(file, proposed, stat.mode, stat.uid, stat.gid);
  const compose = hooks.compose || ((args: string[], cwd: string) => execFixed("docker", args, cwd, 120_000));
  const args = ["compose", "-f", payload.composePath, "-p", payload.composeProject, "up", "-d", "--no-deps", "--force-recreate", ...payload.statelessServices];
  const activation = await compose(args, payload.repositoryRoot);
  const health = hooks.health || ((url: string, timeoutMs: number) => safeHealth(url, timeoutMs, resolver));
  const runHealth = async (url: string, timeoutMs: number) => { try { return await health(url, timeoutMs); } catch { return false; } };
  let healthy = activation.code === 0;
  if (healthy) for (const check of payload.healthChecks) if (!await runHealth(check.url, check.timeoutMs)) { healthy = false; break; }
  if (!healthy) {
    const deploymentErrorCategory = activation.code === 0 ? "health" as const : "activation" as const;
    writeAtomic(file, original, stat.mode, stat.uid, stat.gid);
    const rollbackActivation = await compose(args, payload.repositoryRoot);
    if (rollbackActivation.code !== 0) return { phase: "rollback_failed", progress: 100, changedVariables: payload.mutations.length, services: payload.statelessServices, healthChecksPassed: 0, errorCategory: "rollback", deploymentErrorCategory, rollbackErrorCategory: "activation", backupId: path.basename(backup), configurationDigest: configurationDigest(original) };
    let rollbackHealthPassed = 0;
    for (const check of payload.healthChecks) { if (!await runHealth(check.url, check.timeoutMs)) return { phase: "rollback_failed", progress: 100, changedVariables: payload.mutations.length, services: payload.statelessServices, healthChecksPassed: rollbackHealthPassed, errorCategory: "rollback", deploymentErrorCategory, rollbackErrorCategory: "health", backupId: path.basename(backup), configurationDigest: configurationDigest(original) }; rollbackHealthPassed += 1; }
    return { phase: "rolled_back", progress: 100, changedVariables: payload.mutations.length, services: payload.statelessServices, healthChecksPassed: rollbackHealthPassed, errorCategory: deploymentErrorCategory, deploymentErrorCategory, backupId: path.basename(backup), configurationDigest: configurationDigest(original) };
  }
  return { phase: "succeeded", progress: 100, changedVariables: payload.mutations.length, services: payload.statelessServices, healthChecksPassed: payload.healthChecks.length, backupId: path.basename(backup), configurationDigest: configurationDigest(proposed) };
}

export function resetReplayStateForTests() { if (process.env.NODE_ENV !== "test") throw new Error("Test-only operation"); usedNonces.clear(); }
