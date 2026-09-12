#!/usr/bin/env node
// Provision the organisation identifier into an agent's protected configuration — the INDEPENDENT local
// input the Forge identity check is matched against.
//
// WHY IT IS A SEPARATE, DELIBERATE ACT. Security review rejected two easier sources. The control plane
// must not supply it, or whoever controls that plane chooses which owner-signed identity a host will
// accept. The signed identity must not supply it either, or the document decides the value it is then
// compared against, which is a check comparing a thing to itself. What is left is an operator writing it
// down, once, on the host, with the ceremony's other evidence in front of them.
//
// WHAT THIS DOES NOT DO: it does not sign, install, or read Forge material; it does not contact the
// control plane; and it refuses to overwrite an organisation that is already set unless the caller
// states the value being replaced, because a silent replacement is the same authority this repair exists
// to remove.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const value = (name) => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
const has = (name) => process.argv.includes(name);
const fail = (message) => { throw new Error(message); };

const configPath = value("--config");
if (!configPath || !path.isAbsolute(configPath)) fail("--config must be an absolute path to the agent configuration");
const backupPath = `${configPath}.before-organisation`;

// THE POINT OF THIS FILE IS THAT IT IS PROTECTED, so refuse to write a trust anchor into one that is not.
// Provisioning preserves the mode it finds, and a review pointed out that this happily preserved 0666: on
// such a host any local user rewrites the organisation and the server id afterwards and the agent accepts
// them, which defeats the independently protected input this whole repair exists to establish, without
// forging anything. The agent applies the same rule when it loads (`readProtectedConfiguration`); the two
// are deliberately the same rule stated twice, because the tool cannot import the runtime's TypeScript and
// an operator should be told at provisioning time rather than at the next restart.
//
// ONE DELIBERATE DIFFERENCE, AND IT IS THE WHOLE POINT OF THE TOOL. The runtime accepts a file owned by
// root or by itself, because the runtime IS the agent account. An operator is usually root, and the file
// usually belongs to the agent — the ownership restoration below exists for exactly that case — so
// copying the runtime's rule locked the supported workflow out of its own tool. Root therefore states the
// account with `--expect-owner`, rather than the tool guessing which non-root owner is legitimate.
const resolveOwner = (spec) => {
  if (/^[0-9]+$/.test(spec)) return Number(spec);
  try {
    return Number(execFileSync("id", ["-u", "--", spec], { encoding: "utf8" }).trim());
  } catch {
    return fail(`--expect-owner ${spec} is neither a uid nor an account this host knows`);
  }
};
const assertProtected = (file, { exactOwner = false } = {}) => {
  if (process.platform === "win32") return; // POSIX mode bits do not describe a Windows ACL
  const self = process.getuid ? process.getuid() : 0;
  const openToOthers = (mode) => (mode & 0o022) !== 0;
  // THE STATED ACCOUNT IS TRUSTED FOR THE WHOLE PATH, not only the file. A review pointed out that the
  // installer creates /etc/opsworkbench-agent itself with `install -d -m 0750 -o $AGENT_USER`, so the
  // directory belongs to the agent too — and a rule that accepted the named owner for the file while
  // demanding root for its parent refused the exact layout this repository builds. An operator who says
  // the agent account is legitimate has said so about the tree it owns.
  const expected = value("--expect-owner");
  const stated = expected === undefined ? undefined : resolveOwner(expected);
  const owned = (uid) => uid === 0 || uid === self || uid === stated;
  // NO LINKS ANYWHERE IN THE PATH. Two cleverer rules were each defeated: resolving and measuring the
  // destination said nothing about who CHOSE the destination, and adding a walk of the written path
  // still missed a link in the middle of the chain, because `realpath` returns only the far end and
  // `stat` follows the whole thing. A chain of lookups has as many chances to be redirected as it has
  // links. So every component from the root down is lstat-ed, and a link anywhere is a refusal: what is
  // measured is exactly what is opened, and the path this locks is the only path there is.
  const chain = [];
  for (let entry = path.resolve(file); ; entry = path.dirname(entry)) {
    chain.unshift(entry);
    if (path.dirname(entry) === entry) break;
  }
  const target = chain[chain.length - 1];
  for (const entry of chain) {
    const info = fs.lstatSync(entry);
    if (info.isSymbolicLink()) fail(`${entry} is a symbolic link, and the configuration path must contain none: whoever owns the directory holding a link chooses which file is provisioned`);
    if (entry === target) break;
    if (openToOthers(info.mode) && (info.mode & 0o1000) === 0) fail(`${entry} is writable by group or other (mode 0${(info.mode & 0o7777).toString(8)}), so ${target} can be renamed away and replaced whatever its own mode says`);
    // A directory's owner may replace what is in it whatever the mode says, and the sticky bit exempts
    // the owner rather than binding them. An attacker-owned 0755 ancestor passed the mode rule alone.
    if (!owned(info.uid)) fail(`${entry} belongs to uid ${info.uid}, which is neither root nor this process (${self}); the owner of a directory may replace what is in it`);
  }
  const stat = fs.lstatSync(target);
  // A regular file, checked before anything opens it: a FIFO here would block whoever ran this until
  // somebody wrote to the other end, and a device can have effects merely from being opened.
  if (!stat.isFile()) fail(`${target} is not a regular file; --config names the agent's configuration, and provisioning will not write through whatever else is there`);
  // Read as well as write, for the file. It holds the enrolment credential and, on a v2 runtime, private
  // keys; the runtime refuses to load one anybody can read, so provisioning into one would be writing a
  // trust identifier into a file the agent will then refuse. Directories are still judged on write.
  if ((stat.mode & 0o077) !== 0) fail(`${target} is readable or writable by group or other (mode 0${(stat.mode & 0o7777).toString(8)}); tighten it to 0600 before provisioning a trust identifier into it`);
  // `--expect-owner` is an assertion about the CONFIGURATION — "this is the host you think it is" — so it
  // is matched exactly there and not applied to the backup, which this tool wrote itself and which is
  // root-owned whenever an operator provisioned as root.
  if (exactOwner && stated !== undefined) {
    if (stat.uid !== stated) fail(`${target} belongs to uid ${stat.uid}, and --expect-owner ${expected} says it should belong to ${stated}; provisioning the wrong host's configuration is the mistake this flag exists to catch`);
  } else if (!owned(stat.uid)) {
    fail(`${target} belongs to uid ${stat.uid}, which is neither root nor this process (${self}). If that is the account the agent runs as, say so with --expect-owner; this tool will not guess which non-root owner is legitimate`);
  }
};
if (!fs.existsSync(configPath)) fail(`${configPath} does not exist; provisioning writes into an enrolled agent's configuration, it does not create one`);
// A cheap look before the lock, so a mistyped --config does not even transiently create a lock file
// beside somebody else's file on its way to being refused. The exit handler would remove it either way;
// what this buys is that a kill in that window leaves nothing behind. A symlink is allowed past this glance deliberately: the real check
// runs under the lock and has a better thing to say about links than this line does.
if (process.platform !== "win32") { const glance = fs.lstatSync(configPath); if (!glance.isFile() && !glance.isSymbolicLink()) fail(`${configPath} is not a regular file; --config names the agent's configuration`); }

// ONE LOCK FOR BOTH VERBS. Exclusive creation of the backup serialises two provisionings against each
// other, and does nothing about a rollback arriving in the middle of one: a review interleaved them and
// finished with the new organisation installed and no backup to go back to. The lock covers the whole
// operation, either verb, and is released however this exits.
const lockPath = `${configPath}.provisioning-lock`;
let lockHandle;
try {
  lockHandle = fs.openSync(lockPath, "wx", 0o600);
} catch (error) {
  if (error?.code === "EEXIST") fail(`another provisioning or rollback is in progress (${lockPath}); remove it only if you are certain no other process is running`);
  // The other reachable one, found by a test that tried to roll back as an account which could read the
  // configuration but not write beside it. Provisioning writes three files into that directory, so this
  // is a refusal before anything is touched rather than an error halfway through.
  fail(`cannot create the lock at ${lockPath} (${error?.code ?? "unknown"}); provisioning writes beside the configuration, so run as an account that can write ${path.dirname(lockPath)}`);
}
process.on("exit", () => { try { fs.closeSync(lockHandle); } catch { /* releasing is best effort */ } try { fs.rmSync(lockPath, { force: true }); } catch { /* as above */ } });

// CHECKED INSIDE THE LOCK, not before it. A review pointed out that the protection check ran first and
// everything it established could therefore have changed by the time the lock was held. Nothing else in
// this script may touch the configuration before this line.
assertProtected(configPath, { exactOwner: true });

// The identity of the file as it stands: a replacement is a NEW inode, so its owner and mode have to be
// put back deliberately. Running this as root over an agent-owned configuration would otherwise leave a
// root-owned file the service cannot read, which is an outage dressed as a provisioning step.
const identityOf = (file) => { const stat = fs.lstatSync(file); return { uid: stat.uid, gid: stat.gid, mode: stat.mode & 0o777 }; };
const restoreIdentity = (file, identity) => {
  fs.chmodSync(file, identity.mode);
  try {
    fs.chownSync(file, identity.uid, identity.gid);
  } catch (error) {
    const current = fs.statSync(file);
    // Not root, and the file already belongs to whoever is running: nothing to restore, nothing wrong.
    if (current.uid === identity.uid && current.gid === identity.gid) return;
    fail(`cannot restore ownership ${identity.uid}:${identity.gid} on ${file} (${error?.code ?? "unknown"}); the agent would be left unable to read its own configuration`);
  }
};

// ROLLBACK FIRST, so the way out is never a thing to be improvised afterwards. It restores the exact
// bytes that were there, or refuses; it never reconstructs a configuration from what it thinks it knows.
if (has("--rollback")) {
  if (!fs.existsSync(backupPath)) fail(`no backup to roll back to at ${backupPath}`);
  // THE BACKUP IS AN INPUT, AND IT WAS THE ONE INPUT NOTHING CHECKED. A review put the configuration in
  // a sticky world-writable directory — which the ancestor rule accepts, because sticky stops anyone
  // REPLACING the file — and then simply created the backup beside it as an unprivileged user. The
  // operator's own documented recovery step installed it, and the result passed every protection rule,
  // so a local user had chosen both trust identifiers without forging anything. Sticky does not stop
  // siblings being created, and this design writes three of them, so each has to be safe on its own.
  assertProtected(backupPath);
  let saved;
  try {
    saved = fs.readFileSync(backupPath);
  } catch (error) {
    fail(`cannot read the backup at ${backupPath} (${error?.code ?? "unknown"}); a backup written by root is not readable by an unprivileged operator, so run the rollback as the account that provisioned`);
  }
  try {
    JSON.parse(saved.toString("utf8"));
  } catch (error) {
    fail(`${backupPath} is not the JSON configuration it claims to be (${error?.message ?? "unparseable"}); restoring it would leave this host unable to start`);
  }
  const identity = identityOf(configPath);
  // From random bytes, not the pid. Making the exclusive open fatal closed one hole and opened another:
  // a review covered the whole pid range as an unprivileged user in 0.6 seconds and every provisioning,
  // rollback and enrolment failed permanently. An unguessable name has nothing to collide with.
  const pending = `${configPath}.pending-${crypto.randomBytes(8).toString("hex")}`;
  // Exclusively: "w" adopts a file somebody else already created, and in a sticky directory an
  // unprivileged user can create one per candidate pid and have it renamed into place as the
  // configuration.
  let handle;
  try {
    handle = fs.openSync(pending, "wx", identity.mode);
  } catch (error) {
    fail(`cannot create the replacement configuration at ${pending} (${error?.code ?? "unknown"}); the configuration and the backup are both unchanged`);
  }
  let restored = false;
  try {
    try {
      fs.writeFileSync(handle, saved);
      fs.fsyncSync(handle);
    } catch (error) {
      fail(`cannot write the restored configuration at ${pending} (${error?.code ?? "unknown"}); the configuration and the backup are both unchanged`);
    } finally { fs.closeSync(handle); }
    // Explicitly, because the mode passed to open is filtered by the umask of whoever is running.
    restoreIdentity(pending, identity);
    fs.renameSync(pending, configPath);
    restored = true;
  } finally {
    if (!restored) { try { fs.rmSync(pending, { force: true }); } catch { /* best effort */ } }
  }
  fs.rmSync(backupPath, { force: true });
  process.stdout.write(`${JSON.stringify({ rolledBack: configPath, sha256: crypto.createHash("sha256").update(saved).digest("hex") }, null, 2)}\n`);
  process.exit(0);
}

const orgId = value("--org");
if (!orgId) fail("--org is required, or --rollback to restore the previous configuration");
if (!/^[a-f0-9]{24}$/.test(orgId)) fail("--org must be a 24-character hex organisation id, which is what the control plane and the signed identity both use");

let before;
try {
  before = fs.readFileSync(configPath);
} catch (error) {
  fail(`cannot read ${configPath} (${error?.code ?? "unknown"}); the protection rules accept a configuration owned by root, so an unprivileged operator can pass every check and still not be able to read it — run as the account that owns it`);
}
const config = JSON.parse(before.toString("utf8"));
const existing = typeof config.orgId === "string" ? config.orgId : "";
if (existing && existing !== orgId) {
  const replacing = value("--replacing");
  if (replacing !== existing) fail(`this configuration is already provisioned for ${existing}; pass --replacing ${existing} to state that you mean to change it`);
}
if (existing === orgId) {
  process.stdout.write(`${JSON.stringify({ unchanged: configPath, orgId }, null, 2)}\n`);
  process.exit(0);
}

// The backup is the rollback, so it is written and flushed BEFORE the configuration is touched.
// EXPLAINED, NOT THROWN. A review found three raw `EEXIST`/`EACCES` stack traces on the documented
// runbook path, in a tool that otherwise gives a reason for every refusal. A backup already here means an
// earlier provisioning was not rolled back, and that is the operator's decision to make, not this
// script's: it will not overwrite the way out.
let backupHandle;
try {
  backupHandle = fs.openSync(backupPath, "wx", 0o600);
} catch (error) {
  if (error?.code === "EEXIST") {
    // AND SAY WHICH KIND OF LEFTOVER IT IS. A review followed the remedy this message names and found a
    // loop: an interrupted run can leave a backup that does not parse, this branch sent the operator to
    // `--rollback`, and the rollback then refused the same file for not being a configuration — with the
    // only way forward being to delete by hand the file this message had just called the way out.
    // AND "I CANNOT READ IT" IS NOT "IT IS NOT A CONFIGURATION". The first version of this branch inferred
    // the second from any failed read, and a review ran it in the layout install.sh builds — an
    // agent-owned directory holding a backup root wrote — where a perfectly good backup is simply not
    // readable by the agent account. It was told to delete the only way back. An fs error carries a code
    // and a parse failure does not, which is the whole difference.
    let unreadable = false;
    let parses = true;
    try {
      JSON.parse(fs.readFileSync(backupPath, "utf8"));
    } catch (error) {
      if (error?.code) unreadable = true; else parses = false;
    }
    if (unreadable) fail(`a backup from an earlier provisioning is at ${backupPath} and this account cannot read it; run as the account that provisioned. Do not delete it — it may be the only way back, and nothing here can tell you otherwise.`);
    if (parses) fail(`a backup from an earlier provisioning is already at ${backupPath}; roll back with --rollback, or move that file aside yourself if you are certain it is stale. This script will not overwrite the way out.`);
    fail(`there is a file at ${backupPath} that is not a configuration, so it is not a way back — an earlier run was interrupted before it could write one. Remove it and provision again; nothing has been changed here.`);
  }
  fail(`cannot write the backup at ${backupPath} (${error?.code ?? "unknown"}); nothing has been changed`);
}
let backedUp = false;
try {
  try {
    fs.writeFileSync(backupHandle, before);
    fs.fsyncSync(backupHandle);
  } catch (error) {
    fail(`cannot write the backup at ${backupPath} (${error?.code ?? "unknown"}); nothing has been changed`);
  } finally { fs.closeSync(backupHandle); }
  backedUp = true;
} finally {
  // A half-written backup is worse than none: it is the file the next run will find and refuse, and the
  // file an operator would restore. Removed on any failure, so the next attempt starts clean.
  if (!backedUp) { try { fs.rmSync(backupPath, { force: true }); } catch { /* best effort */ } }
}

// Owner and mode preserved from what was there, not assumed: this file holds the enrolment credential,
// and a provisioning step that widened it, or handed it to a different account, is a worse outcome than
// not provisioning at all.
const identity = identityOf(configPath);
const body = `${JSON.stringify({ ...config, orgId }, null, 2)}\n`;
const pending = `${configPath}.pending-${crypto.randomBytes(8).toString("hex")}`;
let handle;
try {
  handle = fs.openSync(pending, "wx", identity.mode);
} catch (error) {
  fail(`cannot create the replacement configuration at ${pending} (${error?.code ?? "unknown"}); the configuration is unchanged and the backup is at ${backupPath}`);
}
// NOTHING ORPHANED ON THE WAY OUT. A review filled the filesystem and found the half-written replacement
// left behind, and the random name made that worse rather than better: a pid-derived name littered at
// most one file per pid and a later run would trip over it, while a random one mints a fresh name on
// every failure that nothing will ever reuse or list. Each orphan can hold the whole configuration —
// the enrolment credential and, on a v2 runtime, the private keys — so it is secret-bearing litter with
// no lifecycle at all. `restoreIdentity` throws too, so this is not only the out-of-space path.
let installed = false;
try {
  try {
    fs.writeFileSync(handle, body);
    fs.fsyncSync(handle);
  } catch (error) {
    fail(`cannot write the replacement configuration at ${pending} (${error?.code ?? "unknown"}); the configuration is unchanged and the backup is still at ${backupPath}`);
  } finally { fs.closeSync(handle); }
  restoreIdentity(pending, identity);
  fs.renameSync(pending, configPath);
  installed = true;
} finally {
  if (!installed) { try { fs.rmSync(pending, { force: true }); } catch { /* best effort */ } }
}

const after = fs.readFileSync(configPath);
const written = JSON.parse(after.toString("utf8"));
if (written.orgId !== orgId) fail("the configuration does not carry the organisation that was just written");
// NOTHING ELSE MOVED. The other trust identifier lives in this same file, and a provisioning step that
// touched it would be doing the one thing this whole repair exists to prevent.
for (const [field, previous] of Object.entries(config)) {
  if (field === "orgId") continue;
  if (JSON.stringify(written[field]) !== JSON.stringify(previous)) fail(`provisioning changed ${field}, and it must change nothing but the organisation`);
}
if (Object.keys(written).length !== Object.keys(config).length + (config.orgId === undefined ? 1 : 0)) fail("provisioning added or removed a field");
process.stdout.write(`${JSON.stringify({
  provisioned: configPath,
  orgId,
  backup: backupPath,
  mode: `0${(fs.statSync(configPath).mode & 0o777).toString(8)}`,
  owner: `${fs.statSync(configPath).uid}:${fs.statSync(configPath).gid}`,
  sha256Before: crypto.createHash("sha256").update(before).digest("hex"),
  sha256After: crypto.createHash("sha256").update(after).digest("hex"),
}, null, 2)}\n`);
