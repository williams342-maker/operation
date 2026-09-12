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
 * NO COMPONENT OF THE PATH IS A LINK. A first version walked the path as written, so a configuration
 * that was a symlink into a 0777 directory satisfied every rule: the checks described one file and the
 * read took another. Two later versions resolved the path instead, and each was defeated by a link the
 * check could not see; the reasoning is with the loop below.
 *
 * The file is MEASURED, then OPENED, then PROVED to be the same inode, and the contents come from that
 * descriptor. A first version measured a name and then read a name, and a review replaced the file in
 * between and was handed the attacker's organisation and server id. Opening first would close that hole
 * too, but it would mean opening whatever is at the end of the path before knowing what it is — and a
 * FIFO blocks the process until somebody writes to it. So the order is check, open, compare device and
 * inode: nothing is opened until it is known to be an ordinary protected file, and the comparison turns
 * "nobody untrusted could have substituted it" from an argument into a fact.
 *
 * The file must not be writable by group or other, and must belong to root or to whoever is running.
 * Every directory above it must satisfy BOTH of those too: mode, because a writable parent means the
 * file is renamed away and replaced whatever its own mode says; and owner, because a directory's owner
 * may replace its entries no matter what the mode is — including a sticky one, which exempts the owner.
 * A first version checked ancestor modes only, and an attacker-owned 0755 directory sailed through.
 *
 * WHAT IS NOT. POSIX mode bits do not describe a Windows ACL, so this checks nothing there and says so
 * rather than pretending. It does not defend against root, or against the owner of the file; both of
 * those already control the host. On a system where a directory above the configuration is legitimately
 * a symlink, this refuses and an operator has to point it at the real path; that is deliberate.
 *
 * `self` is a parameter so the ownership rule can be exercised without root: a test that cannot make a
 * file belong to somebody else can ask this function who it thinks it is instead.
 */
export function readProtectedConfiguration(file: string, options: { self?: number } = {}): string {
  if (process.platform === "win32") return fs.readFileSync(file, "utf8");
  const self = options.self ?? (process.getuid ? process.getuid() : 0);
  const openToOthers = (mode: number) => (mode & 0o022) !== 0;
  const owned = (uid: number) => uid === 0 || uid === self;
  const target = path.resolve(file);
  // A note on the two different mode rules below. DIRECTORIES are judged on write, because reading a
  // directory tells nobody anything they should not know. The FILE is judged on read as well: it carries
  // the enrolment credential and, on a v2 runtime, private keys, and `install.sh` creates it 0600. A
  // review pointed out that permitting 0644 here contradicted what the rest of this file says about the
  // same file — the check said "who can change the identifiers" while its own docstring justified itself
  // on secrets. It now says both.
    // NO LINKS ANYWHERE IN THE PATH, and this rule replaces two cleverer ones that were each defeated.
    //
    // First I resolved the path and measured the destination. A review owned a directory, put a link in
    // it, and swung the link between two configurations that were both perfectly protected: every check
    // passed and the runtime came back with a different organisation each time. Protecting the inode
    // says nothing about who chose the inode. So I walked the written path as well — and a review then
    // pointed a link in a TRUSTED directory at a link in an untrusted one. `realpath` returns only the
    // far end and `stat` follows the whole chain, so the middle of it was visited by neither walk.
    //
    // The lesson is that a chain of lookups has as many chances to be redirected as it has links, and
    // an endpoint check counts none of them. So there is no resolution here at all. Every component
    // from the root down is `lstat`ed, a link anywhere is a refusal, and what is measured is therefore
    // exactly what is opened. It also settles a smaller question: the lock this runtime shares with the
    // provisioning tool is named after the path as given, and with no links the given path is the only
    // path, so the two cannot disagree about what they are protecting.
    //
    // Ancestors before the file. The order is not cosmetic: a test that cannot create a file owned by
    // somebody else can still separate these rules by choosing where the fixture lives, and only in this
    // order does each rule get a case where it is the one that speaks.
  const chain: string[] = [];
  for (let entry = target; ; entry = path.dirname(entry)) {
    chain.unshift(entry);
    if (path.dirname(entry) === entry) break;
  }
  let measured: fs.Stats | undefined;
  for (const entry of chain) {
    const info = fs.lstatSync(entry);
    if (info.isSymbolicLink()) throw new Error(`${entry} is a symbolic link, and the agent's configuration path must contain none: whoever owns the directory holding a link chooses which file is read, and neither resolving the path nor walking it as written can see a link in the middle of the chain`);
    if (entry === target) { measured = info; break; }
    const sticky = (info.mode & 0o1000) !== 0;
    if (openToOthers(info.mode) && !sticky) throw new Error(`${entry} is writable by group or other (mode 0${(info.mode & 0o7777).toString(8)}), so ${target} can be renamed away and replaced whatever its own mode says`);
    if (!owned(info.uid)) throw new Error(`${entry} belongs to uid ${info.uid}, which is neither root nor this process (${self}); the owner of a directory may replace what is in it, sticky bit or not`);
  }
  const stat = measured!;
  // A REGULAR FILE, and this is checked before anything is opened. Opening a FIFO for reading blocks
  // until somebody writes to it, and a device can have side effects merely from being opened, so the
  // open must not happen until the thing at the end of the path is known to be an ordinary file.
  if (!stat.isFile()) throw new Error(`${target} is not a regular file; the agent's configuration is a file, and opening whatever else is there can block or have effects of its own`);
  if ((stat.mode & 0o077) !== 0) throw new Error(`${target} is readable or writable by group or other (mode 0${(stat.mode & 0o7777).toString(8)}); it carries this runtime's organisation, server id and enrolment credential, so anyone who can write it chooses which owner-signed Forge identity this host accepts and anyone who can read it has the credential`);
  if (!owned(stat.uid)) throw new Error(`${target} belongs to uid ${stat.uid}, which is neither root nor this process (${self}); that account can rewrite the identifiers the Forge check is matched against`);

  // MEASURED, THEN OPENED, THEN PROVED TO BE THE SAME THING. Every directory above this file has just
  // been shown to belong to root or to this process, so nobody untrusted can substitute the file between
  // the two calls — but "nobody can" is an argument, and the device and inode numbers are a fact. If the
  // descriptor is not the inode that was measured, the whole walk described a different file.
  const handle = fs.openSync(target, "r");
  try {
    assertOpenedWhatWasMeasured(stat, fs.fstatSync(handle), target);
    return fs.readFileSync(handle, "utf8");
  } finally {
    fs.closeSync(handle);
  }
}

/**
 * The descriptor holds the inode that was measured, or nothing here described the file being read.
 *
 * A separate exported function so that a test can put two stats side by side and watch it refuse. The
 * behaviour cannot be staged through `readProtectedConfiguration` itself: nothing interleaves with a
 * synchronous call in this process, so the substitution it guards against cannot be arranged from inside
 * a test, and a rule no test can execute is a rule nobody has checked.
 */
export function assertOpenedWhatWasMeasured(measured: { dev: number; ino: number }, opened: { dev: number; ino: number }, target: string) {
  if (opened.dev !== measured.dev || opened.ino !== measured.ino) throw new Error(`${target} changed between being checked and being opened; the file that was measured is not the file this descriptor holds`);
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
  let mine = false;
  try {
    // EXCLUSIVELY. A review pointed out that "w" adopts a file somebody else already created: with the
    // configuration in a sticky world-writable directory, an unprivileged user pre-creates one pending
    // file per candidate pid at mode 0666, this rename installs it as the configuration, and the
    // enrolment credential is theirs to read. `wx` refuses instead, loudly. The production layout is
    // 0750 and agent-owned so nobody could plant one there, but the rule above accepts a sticky parent,
    // and every sibling this design writes has to be safe in every layout the rule accepts.
    handle = fs.openSync(pending, "wx", 0o600);
    mine = true;
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
    // Only what this call created. A collision means somebody else's file is sitting there, and deleting
    // it would destroy the evidence of the very thing the exclusive open exists to catch.
    if (mine) { try { fs.rmSync(pending, { force: true }); } catch { /* as above */ } }
    throw error;
  }
}
