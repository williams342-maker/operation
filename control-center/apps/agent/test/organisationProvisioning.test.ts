import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

// THE INDEPENDENT LOCAL INPUT, and the tests security review asked for by name.
//
// Two easier sources were rejected: the control plane, because whoever controls it would then choose
// which owner-signed identity a host accepts, and the signed identity itself, because a document that
// supplies the value it is compared against is a check comparing a thing to itself. What is left is an
// operator provisioning it, which is what this script does and what these tests hold to account.
const here = path.dirname(fileURLToPath(import.meta.url));
const scripts = path.resolve(here, "..", "..", "..", "scripts");
const provision = (...args: string[]) => execFileSync(process.execPath, [path.join(scripts, "provision-agent-organisation.mjs"), ...args], { encoding: "utf8" });
const org = "6a5dab47776e3028ac9b604b";
const server = "6a5f685ff8195a8813879bd7";

function enrolledConfig(overrides: Record<string, unknown> = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agent-provision-"));
  const file = path.join(directory, "agent.local.json");
  const body = `${JSON.stringify({ controlCenterUrl: "https://control.test", agentId: "agent-1", agentSecret: "s".repeat(32), serverId: server, ...overrides }, null, 2)}\n`;
  fs.writeFileSync(file, body, { mode: 0o600 });
  return { directory, file, body };
}

test("provisioning writes the organisation, keeps the mode, and leaves a byte-exact way back", () => {
  const { file, body } = enrolledConfig();
  const result = JSON.parse(provision("--config", file, "--org", org));
  assert.equal(result.orgId, org);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).orgId, org);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).agentSecret, "s".repeat(32), "the enrolment credential is still there");
  if (process.platform !== "win32") assert.equal(fs.statSync(file).mode & 0o777, 0o600, "the file holds a credential, so provisioning must not widen it");
  assert.equal(fs.readFileSync(result.backup, "utf8"), body, "the backup is the bytes that were there");

  const rolledBack = JSON.parse(provision("--config", file, "--rollback"));
  assert.equal(fs.readFileSync(file, "utf8"), body, "rollback restores the previous configuration byte for byte");
  assert.equal(rolledBack.sha256, crypto.createHash("sha256").update(body).digest("hex"));
  if (process.platform !== "win32") assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test("a provisioned organisation survives a restart, because it is written down", () => {
  const { file } = enrolledConfig();
  provision("--config", file, "--org", org);
  // A restart is a fresh read of the file, which is exactly what loadConfig does.
  const reread = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(reread.orgId, org);
  assert.equal(JSON.parse(provision("--config", file, "--org", org)).unchanged, file, "and provisioning it again is a no-op rather than a second backup");
});

test("provisioning refuses to silently replace an organisation that is already set", () => {
  // Silent replacement is the same authority this repair exists to remove, only slower.
  const { file } = enrolledConfig({ orgId: org });
  assert.throws(() => provision("--config", file, "--org", "9".repeat(24)), /already provisioned/);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).orgId, org, "and nothing changed");
  const replaced = JSON.parse(provision("--config", file, "--org", "9".repeat(24), "--replacing", org));
  assert.equal(replaced.orgId, "9".repeat(24), "stating what is being replaced is allowed");
});

test("provisioning refuses anything that is not an organisation id", () => {
  const { file, body } = enrolledConfig();
  for (const bad of ["", "not-an-id", org.toUpperCase(), `${org}0`]) {
    assert.throws(() => provision("--config", file, "--org", bad), /--org (is required|must be a 24-character hex)/);
  }
  assert.equal(fs.readFileSync(file, "utf8"), body);
});
