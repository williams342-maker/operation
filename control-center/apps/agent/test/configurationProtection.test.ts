import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// THE "PROTECTED" HALF OF "INDEPENDENTLY PROTECTED LOCAL INPUT".
//
// Security review required the organisation to come from a protected local configuration rather than from
// the control plane or from the signed document. A later review pointed out that nothing enforced the
// protection: the file could be 0666, provisioning preserved that, and loading never looked — so any local
// user rewrote both trust identifiers and the agent accepted them, defeating the repair without forging
// anything. These tests are that enforcement.
//
// POSIX mode bits do not describe a Windows ACL, so the check does nothing there and neither do these.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "agent-protection-"));
const configFile = path.join(scratch, "agent.local.json");
const enrolled = { controlCenterUrl: "https://control.test", agentId: "agent-1", agentSecret: "s".repeat(32), orgId: "6a5dab47776e3028ac9b604b", serverId: "6a5f685ff8195a8813879bd7" };
fs.writeFileSync(configFile, `${JSON.stringify(enrolled, null, 2)}\n`, { mode: 0o600 });
fs.chmodSync(configFile, 0o600);

process.env.CONTROL_CENTER_AGENT_CONFIG = configFile;
const { assertConfigurationIsProtected, loadConfig } = await import("../src/config.js");

const linuxOnly = (t: { skip: (why: string) => void }) => {
  if (process.platform === "win32") { t.skip("POSIX mode bits do not describe a Windows ACL"); return true; }
  return false;
};

test("a configuration only its owner can write is accepted", (t) => {
  if (linuxOnly(t)) return;
  fs.chmodSync(configFile, 0o600);
  assertConfigurationIsProtected(configFile);
  assert.equal(loadConfig().orgId, enrolled.orgId, "and it is the file this process actually reads");
});

test("a configuration anybody can write is refused, and so is the agent", (t) => {
  if (linuxOnly(t)) return;
  // The attack this closes: the file carries the organisation and server id the owner-signed Forge
  // identity is matched against, so whoever can write it chooses which identity this host accepts.
  for (const mode of [0o666, 0o622, 0o660, 0o620]) {
    fs.chmodSync(configFile, mode);
    assert.throws(() => assertConfigurationIsProtected(configFile), /writable by group or other/, `mode 0${mode.toString(8)} must be refused`);
    assert.throws(() => loadConfig(), /writable by group or other/, `and loading must refuse it too, at mode 0${mode.toString(8)}`);
  }
  fs.chmodSync(configFile, 0o600);
});

test("a readable-but-not-writable configuration is still accepted", (t) => {
  if (linuxOnly(t)) return;
  // The rule is about who can CHANGE the identifiers. Group read is a deployment choice, not a defeat, and
  // refusing it would refuse hosts that are doing nothing wrong.
  for (const mode of [0o640, 0o644, 0o400]) {
    fs.chmodSync(configFile, mode);
    assertConfigurationIsProtected(configFile);
  }
  fs.chmodSync(configFile, 0o600);
});

test("a directory anybody can write is refused, whatever the file's own mode says", (t) => {
  if (linuxOnly(t)) return;
  // A writable parent means the file is renamed away and replaced, so its 0600 protects nothing.
  const open = fs.mkdtempSync(path.join(os.tmpdir(), "agent-open-dir-"));
  const inside = path.join(open, "agent.local.json");
  fs.writeFileSync(inside, `${JSON.stringify(enrolled)}\n`, { mode: 0o600 });
  fs.chmodSync(inside, 0o600);
  fs.chmodSync(open, 0o777);
  try {
    assert.throws(() => assertConfigurationIsProtected(inside), /writable by group or other/);
    // And the same directory with the sticky bit set is fine, because others may create there but cannot
    // touch what is not theirs — which is exactly how /tmp holds these fixtures.
    fs.chmodSync(open, 0o1777);
    assertConfigurationIsProtected(inside);
  } finally {
    fs.chmodSync(open, 0o700);
    fs.rmSync(open, { recursive: true, force: true });
  }
});

test("a configuration belonging to some third account is refused", (t) => {
  if (linuxOnly(t)) return;
  if (process.getuid?.() !== 0) return t.skip("changing a file's owner needs root; the mode rules above are the part a normal user can prove");
  const owned = path.join(scratch, "someone-elses.json");
  fs.writeFileSync(owned, `${JSON.stringify(enrolled)}\n`, { mode: 0o600 });
  fs.chownSync(owned, 65534, 65534);
  assert.throws(() => assertConfigurationIsProtected(owned), /belongs to uid 65534/);
});
