import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

export const agentConfigSchema = z.object({
  controlCenterUrl: z.string().url(),
  installationId: z.string().default(""),
  requestedSlug: z.string().default(""),
  agentId: z.string(),
  agentSecret: z.string(),
  // agent-v2 asymmetric credential material (optional; present only for v2-enrolled agents). Private
  // keys are stored agent-side at 0600 and never transmitted. controlPlanePublicKey is the Ed25519
  // public key used to verify control-plane task envelopes.
  keyProtocolVersion: z.enum(["agent-v1", "agent-v2"]).default("agent-v1"),
  signingPrivateKey: z.string().optional(),
  encryptionPrivateKey: z.string().optional(),
  controlPlanePublicKey: z.string().optional(),
  // Owner PUBLIC verification key (offline owner key's public half, delivered via bootstrap). When set,
  // privileged tasks must additionally carry a valid owner authorization. Independent of the transport key.
  ownerPublicKey: z.string().optional(),
  serverId: z.string().default(""),
  // Organization this agent is enrolled into. Recorded locally so the host can PROVE which target it is
  // when verifying a Forge target binding — a signed target id binds nothing unless the verifier can
  // measure the actual target. Empty until enrollment populates it, and the preflight fails closed on
  // an empty value rather than skipping the comparison.
  orgId: z.string().default(""),
  agentVersion: z.string().default("0.1.0"),
  protocolVersion: z.string().default("task-v1"),
  packageType: z.enum(["tar", "deb", "rpm"]).default("tar"),
  releaseChannel: z.enum(["stable", "candidate", "preview"]).default("stable"),
  binarySha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  // Layer 3. Absent is fine while this executor is DISABLED; absent while it is ENFORCING is a startup
  // failure, because losing configuration must not silently turn enforcement off.
  //
  // NOTE WHAT IS NOT HERE: the state directory. It used to be a field, and an independent review showed
  // that made enforcement caller-selectable — `executeTask({...config, stateDir: emptyDir}, task)`
  // resolved advisory on a host whose real record said ENFORCING. Removing the third argument had only
  // moved the caller-controlled input, not removed it. The location is now a property of the PROCESS
  // (see `stateDir()` below), and no argument can move it.
  reviewGate: z.object({
    url: z.string().url(),
    credential: z.string().min(1),
    timeoutMs: z.number().int().min(100).max(30000).default(5000),
  }).strict().optional(),
  allowedRoots: z.array(z.string()).default([]),
  pollIntervalSeconds: z.number().int().min(10).max(3600).default(30),
  mongoChecks: z.record(z.string()).default({})
});

export type AgentConfig = z.infer<typeof agentConfigSchema>;

const configPath = process.env.CONTROL_CENTER_AGENT_CONFIG || path.resolve(process.cwd(), "agent.local.json");

/**
 * Where durable executor state lives: the review-enforcement record and the execution journal.
 *
 * DERIVED FROM THE PROCESS, never from an argument. `configPath` is a module constant resolved once at
 * load from `CONTROL_CENTER_AGENT_CONFIG` (or the working directory), so a caller holding an
 * `AgentConfig` object cannot point enforcement at a different record. That is the whole reason this is
 * a function of nothing rather than a config field — the previous shape let any caller of `executeTask`
 * choose which durable record was authoritative, which is not a boundary at all.
 *
 * WHAT THIS DOES AND DOES NOT DEFEND, stated exactly — and the wording here has been tightened once
 * already, because "resists configuration substitution" was itself an overclaim.
 *
 * It resists substitution of the parsed `AgentConfig` OBJECT after process initialization: no caller of
 * `executeTask`, however it builds its argument, can move the record that decides whether this executor
 * enforces.
 *
 * It does NOT resist a different process ENVIRONMENT. Launching the agent with
 * `CONTROL_CENTER_AGENT_CONFIG` pointing elsewhere selects a different config file and, with it, a
 * different state directory — where an absent record reads as DISABLED. Nor does it resist arbitrary code
 * inside this process, which can call the deployment functions directly and never reach the executor at
 * all, nor write access to the host, which can edit the record or the config file.
 *
 * All three of those require host control. Activation resists a compromised control-center. It does not
 * resist a compromised host, and nothing in this file should be read as claiming otherwise.
 *
 * Beside the configuration file rather than under the working directory, because a service's working
 * directory is an accident of how it was started.
 */
export function stateDir(): string {
  return path.join(path.dirname(configPath), "agent-state");
}

/** Where this process's configuration lives. Read-only, so a caller cannot move the trust anchor. */
export function configurationPath(): string { return configPath; }

/**
 * THE CONFIGURATION IS A TRUST ANCHOR, so refuse to read one anybody can rewrite.
 *
 * Security review required an INDEPENDENTLY PROTECTED local input for the Forge identity comparison, and
 * a later review pointed out that nothing enforced the "protected" half: provisioning preserved whatever
 * mode it found, including 0666, and loading never looked. On such a host any local user rewrites both
 * trust identifiers and the agent accepts them, which is the defeat the whole repair exists to prevent —
 * without forging anything. This file also holds the enrolment credential, so the same check is worth
 * making for its own sake.
 *
 * WHAT IS CHECKED. The file must not be writable by group or other, and must belong to root or to
 * whoever is running. Every directory above it must likewise not be writable by group or other, because
 * a writable parent means the file can simply be renamed out of the way and replaced — unless the sticky
 * bit is set, which is exactly the case where others may create but not touch what is not theirs.
 *
 * WHAT IS NOT. POSIX mode bits do not describe a Windows ACL, so this checks nothing there and says so
 * rather than pretending. It does not defend against root, or against the owner of the file; both of
 * those already control the host.
 */
export function assertConfigurationIsProtected(file: string) {
  if (process.platform === "win32") return;
  const self = process.getuid ? process.getuid() : 0;
  const openToOthers = (mode: number) => (mode & 0o022) !== 0;
  const owned = (uid: number) => uid === 0 || uid === self;
  const stat = fs.statSync(file);
  if (openToOthers(stat.mode)) throw new Error(`${file} is writable by group or other (mode 0${(stat.mode & 0o7777).toString(8)}); it carries this runtime's organisation, server id and enrolment credential, so anyone who can write it can choose which owner-signed Forge identity this host accepts`);
  if (!owned(stat.uid)) throw new Error(`${file} belongs to uid ${stat.uid}, which is neither root nor this process (${self}); that account can rewrite the identifiers the Forge check is matched against`);
  for (let directory = path.dirname(file); ; directory = path.dirname(directory)) {
    const above = fs.statSync(directory);
    const sticky = (above.mode & 0o1000) !== 0;
    if (openToOthers(above.mode) && !sticky) throw new Error(`${directory} is writable by group or other (mode 0${(above.mode & 0o7777).toString(8)}), so ${file} can be renamed away and replaced whatever its own mode says`);
    if (path.dirname(directory) === directory) break;
  }
}

export function loadConfig() {
  const fallback = path.resolve(process.cwd(), "agent.example.json");
  const file = fs.existsSync(configPath) ? configPath : fallback;
  assertConfigurationIsProtected(file);
  return agentConfigSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
}

/**
 * ONE LOCK, SHARED WITH THE PROVISIONING TOOL, over a read-modify-write of the configuration.
 *
 * Enrolment used to read the configuration, await the network, and then save the snapshot it had read.
 * A review provisioned an organisation during that await and watched the enrolment response put the old
 * empty value back: a control plane that chooses when to answer therefore chooses whether provisioning
 * survives. Re-reading inside the lock closes the window, and the tool holds the same lock, so neither
 * can run inside the other.
 */
export function withConfigurationLock<T>(operation: () => T): T {
  const lockPath = `${configPath}.provisioning-lock`;
  let handle: number;
  try {
    handle = fs.openSync(lockPath, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "EEXIST") throw new Error(`another provisioning or rollback is in progress (${lockPath}); this runtime will not write its configuration underneath one`, { cause: error });
    throw error;
  }
  try {
    return operation();
  } finally {
    try { fs.closeSync(handle); } catch { /* releasing is best effort */ }
    try { fs.rmSync(lockPath, { force: true }); } catch { /* as above */ }
  }
}

/**
 * REPLACED, NEVER TRUNCATED IN PLACE.
 *
 * This file holds the enrolment credential. Writing over it directly means a full disk, or a crash
 * between truncate and write, leaves invalid JSON — and the next start fails in `loadConfig`, losing the
 * credential along with whatever was being saved. A review reproduced exactly that with a partial write
 * followed by ENOSPC.
 *
 * So: write a sibling, fsync it, rename over the target. Rename is atomic within a filesystem, so a
 * reader always sees one whole version or the other, and a failure leaves the old one in place.
 */
export function saveConfig(config: AgentConfig) {
  const body = `${JSON.stringify(agentConfigSchema.parse(config), null, 2)}\n`;
  const pending = `${configPath}.pending-${process.pid}`;
  let handle: number | undefined;
  try {
    handle = fs.openSync(pending, "w", 0o600);
    fs.writeFileSync(handle, body);
    fs.fsyncSync(handle);
    fs.closeSync(handle);
    handle = undefined;
    fs.renameSync(pending, configPath);
    // The rename itself needs the DIRECTORY entry on disk to survive a power loss; fsyncing the file
    // only guarantees its contents. Windows cannot open a directory for reading, so it can never do
    // this, and refusing there would be refusing over a platform limitation rather than a failure.
    if (process.platform !== "win32") {
      const directory = fs.openSync(path.dirname(configPath), "r");
      try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
    }
  } catch (error) {
    if (handle !== undefined) { try { fs.closeSync(handle); } catch { /* the write failure is the one worth reporting */ } }
    try { fs.rmSync(pending, { force: true }); } catch { /* as above */ }
    throw error;
  }
}
