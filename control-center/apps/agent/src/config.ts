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
 * WHAT IS CHECKED, and each line of it is a review finding rather than a precaution.
 *
 * The path is RESOLVED before anything is measured. A first version walked the path as written, so a
 * configuration that was a symlink into a 0777 directory satisfied every rule: the checks described one
 * file and the read took another.
 *
 * The file is OPENED ONCE and everything after that is a question about the open descriptor. A first
 * version measured a name and then read a name, and a review replaced the file in between and was
 * handed the attacker's organisation and server id. `fstat` describes the inode this function is
 * holding, and the contents are read from that same descriptor, so there is no second lookup to win.
 *
 * The file must not be writable by group or other, and must belong to root or to whoever is running.
 * Every directory above it must satisfy BOTH of those too: mode, because a writable parent means the
 * file is renamed away and replaced whatever its own mode says; and owner, because a directory's owner
 * may replace its entries no matter what the mode is — including a sticky one, which exempts the owner.
 * A first version checked ancestor modes only, and an attacker-owned 0755 directory sailed through.
 *
 * WHAT IS NOT. POSIX mode bits do not describe a Windows ACL, so this checks nothing there and says so
 * rather than pretending. It does not defend against root, or against the owner of the file; both of
 * those already control the host. And the resolution itself is a name lookup: an attacker who controls
 * an ancestor can still swap a component between `realpath` and `open`. What that buys them is a
 * different inode, which is then measured and refused unless it too is protected — so the remaining
 * window is a denial of service, not an accepted identity. Node exposes no `openat`, so this is the
 * floor rather than a choice.
 *
 * `self` is a parameter so the ownership rule can be exercised without root: a test that cannot make a
 * file belong to somebody else can ask this function who it thinks it is instead.
 */
export function readProtectedConfiguration(file: string, options: { self?: number } = {}): string {
  if (process.platform === "win32") return fs.readFileSync(file, "utf8");
  const self = options.self ?? (process.getuid ? process.getuid() : 0);
  const openToOthers = (mode: number) => (mode & 0o022) !== 0;
  const owned = (uid: number) => uid === 0 || uid === self;
  // The last component must be the file itself. Resolving it would be safe — everything below measures
  // the resolved target — but the lock this runtime shares with the provisioning tool is named after the
  // path as given, and a configuration that is a link means the two tools can disagree about what they
  // are protecting. A configuration is a file.
  if (fs.lstatSync(file).isSymbolicLink()) throw new Error(`${file} is a symbolic link; the agent's configuration must be the file itself, so that what is checked and what is locked are the same thing`);
  const target = fs.realpathSync(file);
  const handle = fs.openSync(target, "r");
  try {
    // Ancestors first, then the file. The order is not cosmetic: a test that cannot create a file owned
    // by somebody else can still separate these two rules by choosing where the fixture lives, and only
    // in this order does each rule get a case where it is the one that speaks.
    for (let directory = path.dirname(target); ; directory = path.dirname(directory)) {
      const above = fs.statSync(directory);
      const sticky = (above.mode & 0o1000) !== 0;
      if (openToOthers(above.mode) && !sticky) throw new Error(`${directory} is writable by group or other (mode 0${(above.mode & 0o7777).toString(8)}), so ${target} can be renamed away and replaced whatever its own mode says`);
      if (!owned(above.uid)) throw new Error(`${directory} belongs to uid ${above.uid}, which is neither root nor this process (${self}); the owner of a directory may replace what is in it, sticky bit or not`);
      if (path.dirname(directory) === directory) break;
    }
    const stat = fs.fstatSync(handle);
    if (openToOthers(stat.mode)) throw new Error(`${target} is writable by group or other (mode 0${(stat.mode & 0o7777).toString(8)}); it carries this runtime's organisation, server id and enrolment credential, so anyone who can write it can choose which owner-signed Forge identity this host accepts`);
    if (!owned(stat.uid)) throw new Error(`${target} belongs to uid ${stat.uid}, which is neither root nor this process (${self}); that account can rewrite the identifiers the Forge check is matched against`);
    return fs.readFileSync(handle, "utf8");
  } finally {
    fs.closeSync(handle);
  }
}

export function loadConfig() {
  const fallback = path.resolve(process.cwd(), "agent.example.json");
  const file = fs.existsSync(configPath) ? configPath : fallback;
  return agentConfigSchema.parse(JSON.parse(readProtectedConfiguration(file)));
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
