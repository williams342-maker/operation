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

function enrolledConfig(overrides: Record<string, unknown> = {}, mode = 0o600) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agent-provision-"));
  const file = path.join(directory, "agent.local.json");
  const body = `${JSON.stringify({ controlCenterUrl: "https://control.test", agentId: "agent-1", agentSecret: "s".repeat(32), serverId: server, ...overrides }, null, 2)}\n`;
  fs.writeFileSync(file, body, { mode });
  // Explicitly, because writeFileSync's mode is filtered by whatever umask this test run inherited.
  fs.chmodSync(file, mode);
  return { directory, file, body };
}

// The same call, run under a umask that would strip the bits the fixture is meant to keep. `open(mode)`
// is filtered by the umask, so only the explicit chmod inside the tool can put them back: this is the
// fixture that can tell a working `restoreIdentity` from a missing one without needing root.
const provisionUnderUmask = (...args: string[]) =>
  execFileSync("/bin/sh", ["-c", 'umask 077; exec "$0" "$@"', process.execPath, path.join(scripts, "provision-agent-organisation.mjs"), ...args], { encoding: "utf8" });

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

test("provisioning changes the organisation and nothing else", () => {
  // A review mutated the script to also write `serverId` and every test still passed: the other trust
  // identifier lives in this same file, so "changes only the organisation" has to be asserted field by
  // field rather than assumed from the one field anybody looked at.
  const { file } = enrolledConfig({ pollIntervalSeconds: 45, allowedRoots: ["/srv"] });
  const before = JSON.parse(fs.readFileSync(file, "utf8"));
  provision("--config", file, "--org", org);
  const after = JSON.parse(fs.readFileSync(file, "utf8"));

  assert.equal(after.serverId, server, "the server id is untouched");
  assert.deepEqual(Object.keys(after).sort(), [...Object.keys(before), "orgId"].sort(), "no field appeared or vanished");
  for (const [field, previous] of Object.entries(before)) {
    assert.deepEqual(after[field], previous, `${field} is unchanged`);
  }
});

test("a rollback cannot run inside a provisioning, and vice versa", () => {
  // Interleaved, a review finished with the new organisation installed and no backup to return to. The
  // lock covers both verbs; this holds it and watches each verb refuse rather than proceed.
  const { file } = enrolledConfig();
  const lock = `${file}.provisioning-lock`;
  fs.writeFileSync(lock, "held by this test", { flag: "wx" });
  try {
    assert.throws(() => provision("--config", file, "--org", org), /in progress/);
    assert.throws(() => provision("--config", file, "--rollback"), /in progress/);
  } finally {
    fs.rmSync(lock, { force: true });
  }
  // And with the lock released, the same call works — so the refusal was the lock, not something else.
  assert.equal(JSON.parse(provision("--config", file, "--org", org)).orgId, org);
  assert.equal(fs.existsSync(lock), false, "the lock is released on the way out");
});

test("provisioning reports the ownership it preserved", (t) => {
  if (process.platform === "win32") return t.skip("ownership is a Linux property; the mode is asserted above");
  // HOW STRONG THIS IS DEPENDS ON WHO IS RUNNING IT, and that is stated rather than hidden. A replacement
  // is a new inode, so the owner has to be put back deliberately; the failure it prevents is root
  // provisioning an agent-owned configuration and leaving a root-owned file the service cannot read.
  // Given root, this stages exactly that — the fixture is handed to another account first, so removing
  // the `chown` alone fails here. Given an unprivileged runner, which is what CI is, nothing can create a
  // file owned by somebody else, so the assertions below degrade to "the owner did not change" and the
  // mode half is what the umask test above proves. No skip either way.
  const { file } = enrolledConfig();
  const root = process.getuid?.() === 0;
  // And when the fixture is handed away, the tool is told whose it is — which is the supported root
  // workflow end to end rather than two features tested apart from each other.
  if (root) fs.chownSync(file, 65534, 65534);
  const before = fs.statSync(file);
  const result = JSON.parse(provision("--config", file, "--org", org, ...(root ? ["--expect-owner", "65534"] : [])));
  const after = fs.statSync(file);
  assert.equal(result.owner, `${before.uid}:${before.gid}`);
  assert.equal(after.uid, before.uid, "a replacement is a new inode, so the owner has to be put back deliberately");
  assert.equal(after.gid, before.gid);
  assert.equal(after.mode & 0o777, before.mode & 0o777);
});

test("a hostile umask cannot narrow the configuration behind the operator's back", (t) => {
  if (process.platform === "win32") return t.skip("POSIX mode bits do not describe a Windows ACL");
  // WHY THIS EXISTS. The ownership test above cannot discriminate as a normal user — fixture and
  // replacement are owned by the same account, so deleting `restoreIdentity` entirely left all seven
  // provisioning tests green when a review tried it. The mode is the half of the same restoration that a
  // normal user CAN prove: run the tool under umask 077 against a 0640 file and the atomic replacement
  // comes back 0600 unless the tool puts the mode back deliberately.
  const { file } = enrolledConfig({}, 0o640);
  provisionUnderUmask("--config", file, "--org", org);
  assert.equal(fs.statSync(file).mode & 0o777, 0o640, "provisioning restored the mode rather than inheriting the umask");
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).orgId, org);

  provisionUnderUmask("--config", file, "--rollback");
  assert.equal(fs.statSync(file).mode & 0o777, 0o640, "and rollback restores it too, rather than hardcoding one");
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).orgId, undefined);
});

test("provisioning refuses a configuration that is not protected in the first place", (t) => {
  if (process.platform === "win32") return t.skip("POSIX mode bits do not describe a Windows ACL");
  // Preserving the mode it finds preserved 0666 just as faithfully. A trust anchor any local user can
  // rewrite afterwards is not one, so the operator is told now rather than at the next restart.
  const { file, body } = enrolledConfig({}, 0o666);
  assert.throws(() => provision("--config", file, "--org", org), /writable by group or other/);
  assert.equal(fs.readFileSync(file, "utf8"), body, "and nothing was written");
  assert.equal(fs.existsSync(`${file}.before-organisation`), false, "not even a backup");

  fs.chmodSync(file, 0o600);
  assert.equal(JSON.parse(provision("--config", file, "--org", org)).orgId, org, "tightening the mode is all it was asking for");
});

test("provisioning refuses a configuration that does not exist", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agent-absent-"));
  assert.throws(() => provision("--config", path.join(directory, "agent.local.json"), "--org", org), /does not exist/);
});

test("root provisioning an agent-owned configuration is supported, and states the account", (t) => {
  if (process.platform === "win32") return t.skip("POSIX ownership does not describe a Windows ACL");
  // A review found the first protection rule locked the tool out of its own supported workflow: copying
  // the runtime's "root or me" rule means an operator running as root refuses every file the agent owns,
  // which is the exact case the ownership restoration exists for. Root states the account instead. The
  // flag is checked from both sides here, which is what a normal user can prove without chown.
  const { file, body } = enrolledConfig();
  const mine = String(process.getuid?.() ?? 0);
  assert.throws(() => provision("--config", file, "--org", org, "--expect-owner", String(65534)), /--expect-owner 65534 says it should belong to 65534/);
  assert.equal(fs.readFileSync(file, "utf8"), body, "a mismatch writes nothing");
  assert.throws(() => provision("--config", file, "--org", org, "--expect-owner", "no-such-account-here"), /neither a uid nor an account/);
  assert.equal(JSON.parse(provision("--config", file, "--org", org, "--expect-owner", mine)).orgId, org, "and the matching account provisions");

  // THE LAYOUT THIS REPOSITORY ACTUALLY BUILDS. `install.sh` creates the configuration directory with
  // `install -d -m 0750 -o $AGENT_USER`, so the directory belongs to the agent as well as the file. A
  // review found the first version of this flag accepted the named account for the file and still
  // demanded root for its parent, which refuses every host the installer produces. Only a privileged run
  // can stage that ownership, so only a privileged run asserts it.
  if (process.getuid?.() === 0) {
    const { file: deployed } = enrolledConfig();
    const directory = path.dirname(deployed);
    fs.chmodSync(directory, 0o750);
    fs.chownSync(deployed, 65534, 65534);
    fs.chownSync(directory, 65534, 65534);
    try {
      assert.throws(() => provision("--config", deployed, "--org", org), /neither root nor this process/);
      assert.equal(JSON.parse(provision("--config", deployed, "--org", org, "--expect-owner", "65534")).orgId, org, "the installer's own layout provisions once the account is named");
      assert.equal(fs.statSync(deployed).uid, 65534, "and the file still belongs to the agent afterwards");
    } finally {
      fs.chownSync(directory, 0, 0);
      fs.chmodSync(directory, 0o700);
    }
  }
});

test("provisioning refuses a configuration that is a symbolic link", (t) => {
  if (process.platform === "win32") return t.skip("symlink creation needs a privilege on Windows that CI does not grant");
  // A 0600 link into a 0777 directory satisfied every rule while the writes went somewhere else.
  const { file } = enrolledConfig();
  const exposed = fs.mkdtempSync(path.join(os.tmpdir(), "agent-exposed-"));
  const behind = path.join(exposed, "agent.local.json");
  fs.copyFileSync(file, behind);
  fs.chmodSync(behind, 0o600);
  const link = path.join(path.dirname(file), "linked.json");
  fs.symlinkSync(behind, link);
  // And a link in the MIDDLE of the path, where the last component really is a file: the tree that gets
  // walked has to be the file's real one. Here every component the written path names is tight, and the
  // real grandparent is world-writable, which is where the file can be taken from underneath it.
  const outer = fs.mkdtempSync(path.join(os.tmpdir(), "agent-outer-"));
  const inner = path.join(outer, "inner");
  fs.mkdirSync(inner, { mode: 0o700 });
  fs.chmodSync(inner, 0o700);
  fs.copyFileSync(file, path.join(inner, "agent.local.json"));
  fs.chmodSync(path.join(inner, "agent.local.json"), 0o600);
  fs.chmodSync(outer, 0o777);
  const via = path.join(path.dirname(file), "via");
  fs.symlinkSync(inner, via);
  try {
    assert.throws(() => provision("--config", link, "--org", org), /symbolic link/);
    assert.equal(JSON.parse(fs.readFileSync(behind, "utf8")).orgId, undefined, "and nothing was written through it");
    assert.throws(() => provision("--config", path.join(via, "agent.local.json"), "--org", org), new RegExp(`${path.basename(outer)} is writable by group or other`));

    // And the mirror image, which resolving alone cannot see: the destination is beyond reproach and the
    // directory holding the link is not. Whoever owns that directory chooses which protected
    // configuration gets provisioned, without touching anything the destination checks look at.
    fs.chmodSync(outer, 0o700);
    const chooser = fs.mkdtempSync(path.join(os.tmpdir(), "agent-chooser-"));
    const pick = path.join(chooser, "pick");
    fs.symlinkSync(inner, pick);
    fs.chmodSync(chooser, 0o777);
    try {
      assert.throws(() => provision("--config", path.join(pick, "agent.local.json"), "--org", org), new RegExp(`${path.basename(chooser)} is writable by group or other`));
    } finally {
      fs.chmodSync(chooser, 0o700);
      fs.rmSync(chooser, { recursive: true, force: true });
    }
    fs.chmodSync(outer, 0o777);
  } finally {
    fs.rmSync(via, { force: true });
    fs.chmodSync(outer, 0o700);
    fs.rmSync(outer, { recursive: true, force: true });
    fs.rmSync(link, { force: true });
    fs.rmSync(exposed, { recursive: true, force: true });
  }
});

test("provisioning refuses a configuration under a directory anybody can write", (t) => {
  if (process.platform === "win32") return t.skip("POSIX mode bits do not describe a Windows ACL");
  // A writable parent means the file is renamed away and replaced whatever its own mode says, so the
  // tool has to walk the tree rather than look at the one file it was pointed at. The tool also refuses
  // an ancestor belonging to a third account, for the separate reason that a directory's owner may
  // replace its entries and the sticky bit exempts them; that rule needs a second account to exercise
  // and is proved on the runtime side, where the comparison can be asked to be somebody else.
  const { file } = enrolledConfig();
  const parent = path.dirname(file);
  fs.chmodSync(parent, 0o777);
  try {
    assert.throws(() => provision("--config", file, "--org", org), /writable by group or other/);
  } finally {
    fs.chmodSync(parent, 0o700);
  }
  // And the ownership half of the same rule, when this run is privileged enough to stage it: a directory
  // whose owner is a third account, at a mode nobody could object to. Its owner may still replace what is
  // in it. An unprivileged runner cannot create such a directory, so there it is the runtime suite that
  // carries this rule, by asking the comparison to be somebody else.
  if (process.getuid?.() === 0) {
    fs.chownSync(parent, 65534, 65534);
    try {
      assert.throws(() => provision("--config", file, "--org", org), new RegExp(`${path.basename(parent)} belongs to uid 65534`));
    } finally {
      fs.chownSync(parent, 0, 0);
    }
  }
});
