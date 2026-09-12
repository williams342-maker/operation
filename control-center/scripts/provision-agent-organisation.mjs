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
const assertProtected = (file) => {
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
  const stat = fs.statSync(target);
  if (openToOthers(stat.mode)) fail(`${target} is writable by group or other (mode 0${(stat.mode & 0o7777).toString(8)}); tighten it to 0600 before provisioning a trust identifier into it`);
  if (stated !== undefined) {
    if (stat.uid !== stated) fail(`${target} belongs to uid ${stat.uid}, and --expect-owner ${expected} says it should belong to ${stated}; provisioning the wrong host's configuration is the mistake this flag exists to catch`);
  } else if (!owned(stat.uid)) {
    fail(`${target} belongs to uid ${stat.uid}, which is neither root nor this process (${self}). If that is the account the agent runs as, say so with --expect-owner; this tool will not guess which non-root owner is legitimate`);
  }
};
if (!fs.existsSync(configPath)) fail(`${configPath} does not exist; provisioning writes into an enrolled agent's configuration, it does not create one`);
assertProtected(configPath);

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
  throw error;
}
process.on("exit", () => { try { fs.closeSync(lockHandle); } catch { /* releasing is best effort */ } try { fs.rmSync(lockPath, { force: true }); } catch { /* as above */ } });

// The identity of the file as it stands: a replacement is a NEW inode, so its owner and mode have to be
// put back deliberately. Running this as root over an agent-owned configuration would otherwise leave a
// root-owned file the service cannot read, which is an outage dressed as a provisioning step.
const identityOf = (file) => { const stat = fs.statSync(file); return { uid: stat.uid, gid: stat.gid, mode: stat.mode & 0o777 }; };
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
  const saved = fs.readFileSync(backupPath);
  const identity = identityOf(configPath);
  const pending = `${configPath}.pending-${process.pid}`;
  const handle = fs.openSync(pending, "w", identity.mode);
  try {
    fs.writeFileSync(handle, saved);
    fs.fsyncSync(handle);
  } finally { fs.closeSync(handle); }
  // Explicitly, because the mode passed to open is filtered by the umask of whoever is running.
  restoreIdentity(pending, identity);
  fs.renameSync(pending, configPath);
  fs.rmSync(backupPath, { force: true });
  process.stdout.write(`${JSON.stringify({ rolledBack: configPath, sha256: crypto.createHash("sha256").update(saved).digest("hex") }, null, 2)}\n`);
  process.exit(0);
}

const orgId = value("--org");
if (!orgId) fail("--org is required, or --rollback to restore the previous configuration");
if (!/^[a-f0-9]{24}$/.test(orgId)) fail("--org must be a 24-character hex organisation id, which is what the control plane and the signed identity both use");

const before = fs.readFileSync(configPath);
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
const backupHandle = fs.openSync(backupPath, "wx", 0o600);
try {
  fs.writeFileSync(backupHandle, before);
  fs.fsyncSync(backupHandle);
} finally { fs.closeSync(backupHandle); }

// Owner and mode preserved from what was there, not assumed: this file holds the enrolment credential,
// and a provisioning step that widened it, or handed it to a different account, is a worse outcome than
// not provisioning at all.
const identity = identityOf(configPath);
const body = `${JSON.stringify({ ...config, orgId }, null, 2)}\n`;
const pending = `${configPath}.pending-${process.pid}`;
const handle = fs.openSync(pending, "w", identity.mode);
try {
  fs.writeFileSync(handle, body);
  fs.fsyncSync(handle);
} finally { fs.closeSync(handle); }
restoreIdentity(pending, identity);
fs.renameSync(pending, configPath);

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
