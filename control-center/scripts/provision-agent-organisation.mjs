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

// ROLLBACK FIRST, so the way out is never a thing to be improvised afterwards. It restores the exact
// bytes that were there, or refuses; it never reconstructs a configuration from what it thinks it knows.
if (has("--rollback")) {
  if (!fs.existsSync(backupPath)) fail(`no backup to roll back to at ${backupPath}`);
  const saved = fs.readFileSync(backupPath);
  const pending = `${configPath}.pending-${process.pid}`;
  const handle = fs.openSync(pending, "w", 0o600);
  try {
    fs.writeFileSync(handle, saved);
    fs.fsyncSync(handle);
  } finally { fs.closeSync(handle); }
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

// Mode preserved from what was there, not assumed: this file holds the enrolment credential, and a
// provisioning step that quietly widened it would be a worse outcome than not provisioning at all.
const mode = fs.statSync(configPath).mode & 0o777;
const body = `${JSON.stringify({ ...config, orgId }, null, 2)}\n`;
const pending = `${configPath}.pending-${process.pid}`;
const handle = fs.openSync(pending, "w", mode);
try {
  fs.writeFileSync(handle, body);
  fs.fsyncSync(handle);
} finally { fs.closeSync(handle); }
fs.renameSync(pending, configPath);

const after = fs.readFileSync(configPath);
if (JSON.parse(after.toString("utf8")).orgId !== orgId) fail("the configuration does not carry the organisation that was just written");
process.stdout.write(`${JSON.stringify({
  provisioned: configPath,
  orgId,
  backup: backupPath,
  mode: `0${(fs.statSync(configPath).mode & 0o777).toString(8)}`,
  sha256Before: crypto.createHash("sha256").update(before).digest("hex"),
  sha256After: crypto.createHash("sha256").update(after).digest("hex"),
}, null, 2)}\n`);
