import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import dns from "node:dns/promises";
import net from "node:net";
import { configurationDeploymentPayloadSchema, deploymentCapabilities, isCompatibleAgentVersion, isSafeHttpCheckUrl, minimumDeploymentAgentVersion, type ConfigurationDeploymentPayload, type DeploymentProgress } from "@control-center/shared";
import { execFixed } from "./safeExec.js";
import { linuxMountPoints } from "./discoverySafety.js";

const MAX_VALUE = 16 * 1024;
const usedNonces = new Map<string, number>();

export type DeploymentHooks = { compose?: (args: string[], cwd: string) => Promise<{ code: number | null }>; health?: (url: string, timeoutMs: number) => Promise<boolean>; resolve?: (hostname: string) => Promise<string[]>; now?: () => Date };
type DeploymentErrorCategory = NonNullable<DeploymentProgress["errorCategory"]>;
type DeploymentFailureStage = NonNullable<DeploymentProgress["failureStage"]>;
type TaggedDeploymentError = Error & { deploymentErrorCategory?: DeploymentErrorCategory; deploymentFailureStage?: DeploymentFailureStage };

function tagFailure(error: unknown, category: DeploymentErrorCategory, stage: DeploymentFailureStage) {
  if (error instanceof Error) {
    const tagged = error as TaggedDeploymentError;
    tagged.deploymentErrorCategory ??= category;
    tagged.deploymentFailureStage ??= stage;
  }
  return error;
}

function withFailureStage<T>(stage: DeploymentFailureStage, category: DeploymentErrorCategory, action: () => T): T {
  try { return action(); } catch (error) { throw tagFailure(error, category, stage); }
}

async function withFailureStageAsync<T>(stage: DeploymentFailureStage, category: DeploymentErrorCategory, action: () => Promise<T>): Promise<T> {
  try { return await action(); } catch (error) { throw tagFailure(error, category, stage); }
}

function categoryForPathGuard(error: unknown): DeploymentErrorCategory {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (/symlink/.test(message)) return "symlink";
  if (/mount/.test(message)) return "mount";
  return "path";
}

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

function publicAddress(address: string) {
  if (net.isIPv4(address)) { const [a, b] = address.split(".").map(Number); return !(a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224 || (a === 100 && b >= 64 && b <= 127)); }
  if (net.isIPv6(address)) { const value = address.toLowerCase(); return !(value === "::" || value === "::1" || /^(fc|fd|fe[89ab]|ff)/.test(value)); }
  return false;
}

async function validateHealthUrl(raw: string, resolver: (hostname: string) => Promise<string[]>) {
  if (!isSafeHttpCheckUrl(raw)) throw new Error("Health check target rejected");
  const url = new URL(raw); const hostname = url.hostname.replace(/^\[|\]$/g, ""); const addresses = net.isIP(hostname) ? [hostname] : await resolver(hostname);
  if (!addresses.length || addresses.some((address) => !publicAddress(address))) throw new Error("Health check target rejected");
  return url;
}

async function safeHealth(raw: string, timeoutMs: number, resolver: (hostname: string) => Promise<string[]>) {
  let current = raw;
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    await validateHealthUrl(current, resolver);
    const response = await fetch(current, { signal: AbortSignal.timeout(timeoutMs), redirect: "manual" });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) { if (redirects === 3) return false; current = new URL(location, current).toString(); continue; }
    return response.ok;
  }
  return false;
}

function writeAtomic(file: string, content: string, mode: number, uid: number, gid: number) {
  const temporary = `${file}.pending-${crypto.randomUUID()}`; const fd = fs.openSync(temporary, "wx", 0o600);
  try { fs.writeFileSync(fd, content, "utf8"); fs.fsyncSync(fd); fs.fchmodSync(fd, mode); if (shouldApplyOwnershipChange(uid, gid)) fs.fchownSync(fd, uid, gid); } finally { fs.closeSync(fd); }
  fs.renameSync(temporary, file);
  // Windows does not support fsync on directory handles; file data is still flushed before rename.
  if (process.platform !== "win32") { const directory = fs.openSync(path.dirname(file), "r"); try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); } }
}

export function shouldApplyOwnershipChange(targetUid: number, targetGid: number) {
  if (process.platform === "win32") return false;
  const currentUid = process.getuid?.();
  const currentGid = process.getgid?.();
  if (currentUid === undefined || currentGid === undefined) return false;
  if (currentUid === targetUid && currentGid === targetGid) return false;
  if (currentUid === 0) return true;
  throw new Error("Environment file ownership cannot be preserved by this agent user");
}

export async function executeConfigurationDeployment(raw: unknown, signingKey: string, nonce: string, capabilities: string[], agentVersion: string | undefined, hooks: DeploymentHooks = {}): Promise<DeploymentProgress> {
  const payload = withFailureStage("schema", "parsing", () => configurationDeploymentPayloadSchema.parse(raw)); withFailureStage("policy", "environment", () => assertNonProduction(payload));
  if (!isCompatibleAgentVersion(agentVersion)) throw tagFailure(new Error(`Agent version must be stable and at least ${minimumDeploymentAgentVersion}`), "version", "version");
  if (!deploymentCapabilities.every((item) => capabilities.includes(item))) throw tagFailure(new Error("Incomplete deployment capabilities"), "capability", "capability");
  const now = (hooks.now || (() => new Date()))(); for (const [key, expiry] of usedNonces) if (expiry < now.getTime()) usedNonces.delete(key);
  if (usedNonces.has(nonce)) throw tagFailure(new Error("Replay rejected"), "replay", "replay"); usedNonces.set(nonce, now.getTime() + 24 * 60 * 60 * 1000);
  const resolver = hooks.resolve || (async (hostname: string) => (await dns.lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address));
  for (const check of payload.healthChecks) await withFailureStageAsync("health_preflight", "health", () => validateHealthUrl(check.url, resolver));
  let file = "";
  try { file = assertSafePath(payload.repositoryRoot, payload.environmentFilePath); assertSafePath(payload.repositoryRoot, payload.composePath); } catch (error) { throw tagFailure(error, categoryForPathGuard(error), "path_guard"); }
  const stat = withFailureStage("file_guard", "environment", () => fs.lstatSync(file));
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw tagFailure(new Error("Environment file must be a regular file with one hard link"), "path", "file_guard");
  if (process.platform !== "win32" && (stat.mode & 0o022) !== 0) throw tagFailure(new Error("Environment file permissions are too broad"), "environment", "file_guard");
  const original = withFailureStage("file_guard", "environment", () => fs.readFileSync(file, "utf8")); if (configurationDigest(original) !== payload.expectedConfigurationDigest) throw tagFailure(new Error("Expected configuration version mismatch"), "parsing", "digest_guard");
  const backup = `${file}.backup-${now.toISOString().replace(/[:.]/g, "-")}`; withFailureStage("backup", "backup", () => { fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL); fs.chmodSync(backup, stat.mode); if (shouldApplyOwnershipChange(stat.uid, stat.gid)) fs.chownSync(backup, stat.uid, stat.gid); });
  const secrets = withFailureStage("decrypt", "parsing", () => decryptValues(payload, signingKey)); const proposed = withFailureStage("mutation", "parsing", () => applyEnvironmentMutations(original, payload.mutations, secrets));
  withFailureStage("write", "write", () => writeAtomic(file, proposed, stat.mode, stat.uid, stat.gid));
  const compose = hooks.compose || ((args: string[], cwd: string) => execFixed("docker", args, cwd, 300_000));
  const args = ["compose", "-f", payload.composePath, "-p", payload.composeProject, "up", "-d", "--no-deps", "--force-recreate", "--build", "--pull", "never", "--quiet-build", "--quiet-pull", ...payload.statelessServices];
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

export function safeConfigurationFailureProgress(error: unknown): DeploymentProgress {
  const tagged = error instanceof Error ? error as TaggedDeploymentError : undefined;
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  const fallbackCategory =
    /capabilit/.test(message) ? "capability" :
    /agent version|stable|minimum/.test(message) ? "version" :
    /replay|nonce/.test(message) ? "replay" :
    /escape|contain|repository root|safe directory|regular file|hard link/.test(message) ? "path" :
    /symlink/.test(message) ? "symlink" :
    /mount/.test(message) ? "mount" :
    /syntax|duplicate|parse|json|decrypt|cipher|auth|encrypted|value reference|value rejected|version mismatch/.test(message) ? "parsing" :
    /permission|eacces|eperm|access/.test(message) ? "environment" :
    /backup/.test(message) ? "backup" :
    /write|rename|copy|fsync|chmod|chown/.test(message) ? "write" :
    /activation|compose|docker/.test(message) ? "activation" :
    /health/.test(message) ? "health" :
    /rollback/.test(message) ? "rollback" :
    /production|environment/.test(message) ? "environment" :
    "unknown";
  const category = tagged?.deploymentErrorCategory ?? fallbackCategory;
  return { phase: "failed", progress: 100, changedVariables: 0, services: [], healthChecksPassed: 0, errorCategory: category, failureStage: tagged?.deploymentFailureStage ?? "unknown" };
}
