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

const value = (name) => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
const has = (name) => process.argv.includes(name);
const fail = (message) => { throw new Error(message); };

const configPath = value("--config");
if (!configPath || !path.isAbsolute(configPath)) fail("--config must be an absolute path to the agent configuration");
const backupPath = `${configPath}.before-organisation`;

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
