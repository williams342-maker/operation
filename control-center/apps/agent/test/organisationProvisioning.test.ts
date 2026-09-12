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
// 0177 rather than 0077: the mode rule now refuses any group or other bit on the configuration, so the
// only bits left to strip are the owner's own. Under this umask `open(0600)` yields 0400, and the file
// comes back 0600 only if the tool puts the mode back deliberately.
const provisionUnderUmask = (...args: string[]) =>
  execFileSync("/bin/sh", ["-c", 'umask 177; exec "$0" "$@"', process.execPath, path.join(scripts, "provision-agent-organisation.mjs"), ...args], { encoding: "utf8" });

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
  // normal user CAN prove: run the tool under a umask that strips the owner's write bit and the atomic
  // replacement comes back 0400 unless the tool puts the mode back deliberately.
  const { file } = enrolledConfig({}, 0o600);
  provisionUnderUmask("--config", file, "--org", org);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600, "provisioning restored the mode rather than inheriting the umask");
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).orgId, org);

  provisionUnderUmask("--config", file, "--rollback");
  assert.equal(fs.statSync(file).mode & 0o777, 0o600, "and rollback restores it too, rather than hardcoding one");
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).orgId, undefined);
});

test("provisioning refuses a configuration that is not protected in the first place", (t) => {
  if (process.platform === "win32") return t.skip("POSIX mode bits do not describe a Windows ACL");
  // Preserving the mode it finds preserved 0666 just as faithfully. A trust anchor any local user can
  // rewrite afterwards is not one, so the operator is told now rather than at the next restart.
  const { file, body } = enrolledConfig({}, 0o666);
  assert.throws(() => provision("--config", file, "--org", org), /readable or writable by group or other/);
  // Read as well as write. The runtime refuses a configuration anybody can read, because it holds the
  // enrolment credential, so provisioning into one would be writing a trust identifier into a file the
  // agent will then refuse to load.
  fs.chmodSync(file, 0o644);
  assert.throws(() => provision("--config", file, "--org", org), /readable or writable by group or other/);
  fs.chmodSync(file, 0o666);
  assert.equal(fs.readFileSync(file, "utf8"), body, "and nothing was written");
  assert.equal(fs.existsSync(`${file}.before-organisation`), false, "not even a backup");

  fs.chmodSync(file, 0o600);
  assert.equal(JSON.parse(provision("--config", file, "--org", org)).orgId, org, "tightening the mode is all it was asking for");
});

test("a backup planted beside the configuration cannot be rolled back into place", (t) => {
  if (process.platform === "win32") return t.skip("POSIX ownership does not describe a Windows ACL");
  // THE SIBLING HOLE, demonstrated end to end by a review. The ancestor rule accepts a world-writable
  // directory when it is sticky, because sticky stops anybody REPLACING the configuration. It does not
  // stop them creating files NEXT TO it, and this design writes three siblings: the backup, the pending
  // replacement and the lock. The backup was the one nothing checked, so an unprivileged user could
  // simply write one and wait for the operator's own documented recovery step to install it — choosing
  // both trust identifiers, with the result passing every protection rule afterwards.
  const { file, body } = enrolledConfig();
  const planted = `${file}.before-organisation`;
  fs.writeFileSync(planted, JSON.stringify({ ...JSON.parse(body), orgId: "9".repeat(24), serverId: "8".repeat(24) }, null, 2), { mode: 0o666 });
  fs.chmodSync(planted, 0o666);
  try {
    assert.throws(() => provision("--config", file, "--rollback"), /readable or writable by group or other/, "a backup anybody could have written is not a way back");
    assert.equal(fs.readFileSync(file, "utf8"), body, "and the configuration is untouched");
  } finally {
    fs.rmSync(planted, { force: true });
  }

  // Nor is one that is not a configuration at all: restoring bytes that will not parse leaves a host
  // that cannot start, which is a worse outcome than refusing to roll back.
  fs.writeFileSync(planted, "not json at all", { mode: 0o600 });
  fs.chmodSync(planted, 0o600);
  try {
    assert.throws(() => provision("--config", file, "--rollback"), /not the JSON configuration it claims to be/);
  } finally {
    fs.rmSync(planted, { force: true });
  }

  // And the backup this tool writes itself still rolls back, so the new rule refuses plants rather than
  // recovery.
  provision("--config", file, "--org", org);
  assert.equal(JSON.parse(provision("--config", file, "--rollback")).rolledBack, file);
  assert.equal(fs.readFileSync(file, "utf8"), body);
});

test("a flood of planted pending files cannot stop provisioning", (t) => {
  if (process.platform === "win32") return t.skip("this is about POSIX pid ranges and a sticky directory");
  // THE HOLE THE PREVIOUS FIX OPENED. Making the exclusive open fatal stopped a planted file becoming the
  // configuration and handed an unprivileged user a permanent denial of service instead: the pending name
  // was built from the pid, the range is small, and a review covered all of it in 0.6 seconds, after
  // which provisioning, rollback and every enrolment failed for good. The name comes from random bytes
  // now, so there is nothing to cover. A few hundred plants stand in for the whole range: each would have
  // been a certain collision before, and all of them are irrelevant after.
  const { file } = enrolledConfig();
  const planted: string[] = [];
  // Two windows: the low pids, and a run above this process's own, because pids are handed out in order
  // and the tool runs in a child. Between them they are what the old name would have collided with.
  const candidates = [...Array.from({ length: 300 }, (_, i) => i + 1), ...Array.from({ length: 600 }, (_, i) => process.pid + i)];
  for (const pid of candidates) {
    const name = `${file}.pending-${pid}`;
    fs.writeFileSync(name, "planted", { mode: 0o600 });
    planted.push(name);
  }
  try {
    assert.equal(JSON.parse(provision("--config", file, "--org", org)).orgId, org, "provisioning is unaffected");
    assert.equal(JSON.parse(provision("--config", file, "--rollback")).rolledBack, file, "and so is the way back");
  } finally {
    for (const name of planted) fs.rmSync(name, { force: true });
  }
});

test("STRUCTURAL: the tool creates its replacement exclusively and names it unguessably", () => {
  // The behavioural test above plants the pid ranges a child is overwhelmingly likely to land in, which
  // demonstrates the fix but cannot guarantee the collision it is standing in for. These two assertions
  // can, so the rule is not left resting on a probability. Named STRUCTURAL for the same reason its
  // predecessor was renamed: a source-text test should not borrow a behavioural name.
  const source = fs.readFileSync(path.join(scripts, "provision-agent-organisation.mjs"), "utf8");
  assert.equal(source.match(/fs\.openSync\(pending, "wx", identity\.mode\)/g)?.length, 2, "both verbs create it exclusively");
  assert.equal(source.match(/pending-\$\{crypto\.randomBytes\(8\)\.toString\("hex"\)\}/g)?.length, 2, "and both name it from random bytes");
  assert.equal(source.includes("pending-${process.pid}"), false, "and neither from the pid, which is guessable and small");
});

test("a backup left by an earlier provisioning is explained, not thrown", (t) => {
  if (process.platform === "win32") return t.skip("POSIX modes do not describe a Windows ACL");
  // A review found three raw stack traces on the documented runbook path. This is the one an operator is
  // most likely to meet: provision, do not roll back, provision again. The backup is the way out, so the
  // refusal is right; printing an unhandled EEXIST at them is not.
  const { file } = enrolledConfig();
  provision("--config", file, "--org", org);
  assert.throws(() => provision("--config", file, "--org", "9".repeat(24), "--replacing", org), /will not overwrite the way out/);

  // AND THE TWO MESSAGES MUST NOT FORM A LOOP. An interrupted run can leave a backup that does not parse.
  // A review followed the remedy the message above names and found the rollback refusing the same file
  // for not being a configuration, so the only way forward was to delete by hand the file that message
  // had just called the way out. A backup that is not a configuration is not a way out, and now says so.
  fs.writeFileSync(`${file}.before-organisation`, "{ truncated", { mode: 0o600 });
  fs.chmodSync(`${file}.before-organisation`, 0o600);
  assert.throws(() => provision("--config", file, "--org", "9".repeat(24), "--replacing", org), /not a configuration, so it is not a way back/);
  assert.throws(() => provision("--config", file, "--rollback"), /not the JSON configuration it claims to be/, "and the rollback still refuses it, which is why the other message had to change");
});

test("an operator who cannot read the backup is told to run as the account that provisioned", (t) => {
  if (process.platform === "win32") return t.skip("POSIX ownership does not describe a Windows ACL");
  if (process.getuid?.() !== 0) return;
  // Root provisions, so the backup is root-owned. A colleague rolling back as themselves passes every
  // protection rule — root is an allowed owner — and then cannot read the file. A review pointed out
  // this branch had no test. Reaching it needs a second account, so a privileged run stages it and an
  // unprivileged one asserts nothing extra; there is no skip either way.
  //
  // The script is copied somewhere the other account can reach, because a checkout under /root is not
  // traversable by anybody else and that would fail for a reason this test is not about.
  const reachable = fs.mkdtempSync(path.join(os.tmpdir(), "agent-reachable-"));
  fs.chmodSync(reachable, 0o755);
  const tool = path.join(reachable, "provision.mjs");
  fs.copyFileSync(path.join(scripts, "provision-agent-organisation.mjs"), tool);
  fs.chmodSync(tool, 0o755);

  const { file, directory } = enrolledConfig();
  provision("--config", file, "--org", org);
  const rollbackAsNobody = () => execFileSync("runuser", ["-u", "nobody", "--", process.execPath, tool, "--config", file, "--rollback"], { encoding: "utf8" });
  try {
    // First, the account cannot even write beside the configuration, so it never reaches the backup.
    fs.chmodSync(directory, 0o755);
    assert.throws(rollbackAsNobody, /run as an account that can write/);

    // Now the layout where the branch is actually reachable, and it is a real one: the directory belongs
    // to the agent account, root provisioned into it, and the backup root wrote is not readable by the
    // agent. Every protection rule passes — root is an allowed owner — and the read is what fails.
    fs.chownSync(directory, 65534, 65534);
    assert.throws(rollbackAsNobody, /run the rollback as the account that provisioned/);
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).orgId, org, "and nothing was rolled back");
  } finally {
    fs.chownSync(directory, 0, 0);
    fs.chmodSync(directory, 0o700);
    fs.rmSync(reachable, { recursive: true, force: true });
  }
});

test("a completed run leaves no replacement behind, and the cleanup that covers a failed one", (t) => {
  if (process.platform === "win32") return t.skip("POSIX modes do not describe a Windows ACL");
  // The behavioural half: after a provisioning and a rollback there is no pending file left anywhere.
  const { file, directory } = enrolledConfig();
  provision("--config", file, "--org", org);
  provision("--config", file, "--rollback");
  assert.deepEqual(fs.readdirSync(directory).filter((entry) => entry.includes(".pending-")), [], "nothing left over");

  // The structural half, named as such. A review forced the failure with a full filesystem and found the
  // half-written replacement orphaned — and because the name is random, every failure mints a fresh one
  // that nothing will ever reuse or list, each able to hold the credential and the private keys. The
  // failure paths that reach it (out of space, and a refused chown) cannot be staged from this harness,
  // so what is asserted is that both verbs remove what they created rather than that they were watched
  // doing it.
  const source = fs.readFileSync(path.join(scripts, "provision-agent-organisation.mjs"), "utf8");
  assert.equal(source.match(/if \(!installed\) \{ try \{ fs\.rmSync\(pending, \{ force: true \}\); \}/g)?.length, 1, "the provisioning verb");
  assert.equal(source.match(/if \(!restored\) \{ try \{ fs\.rmSync\(pending, \{ force: true \}\); \}/g)?.length, 1, "and the rollback verb");
  assert.equal(source.match(/if \(!backedUp\) \{ try \{ fs\.rmSync\(backupPath, \{ force: true \}\); \}/g)?.length, 1, "and a half-written backup is not left to be found");
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

test("provisioning refuses a link anywhere in the configuration path", (t) => {
  if (process.platform === "win32") return t.skip("symlink creation needs a privilege on Windows that CI does not grant");
  // Three shapes, and the third is the one that defeated two earlier rules. A link as the configuration
  // itself; a link as a directory in the path; and a link in a TRUSTED directory pointing at a link in
  // an untrusted one, where `realpath` reports only the far end and `stat` follows the whole chain, so
  // an endpoint check on either path never visits the directory doing the choosing.
  const { file } = enrolledConfig();
  const exposed = fs.mkdtempSync(path.join(os.tmpdir(), "agent-exposed-"));
  const behind = path.join(exposed, "agent.local.json");
  fs.copyFileSync(file, behind);
  fs.chmodSync(behind, 0o600);
  const link = path.join(path.dirname(file), "linked.json");
  fs.symlinkSync(behind, link);

  const chooser = fs.mkdtempSync(path.join(os.tmpdir(), "agent-chooser-"));
  const pick = path.join(chooser, "pick");
  fs.symlinkSync(exposed, pick);
  const entry = path.join(path.dirname(file), "entry");
  fs.symlinkSync(pick, entry);
  try {
    assert.throws(() => provision("--config", link, "--org", org), /is a symbolic link/);
    assert.equal(JSON.parse(fs.readFileSync(behind, "utf8")).orgId, undefined, "and nothing was written through it");
    assert.throws(() => provision("--config", path.join(entry, "agent.local.json"), "--org", org), new RegExp(`${path.basename(entry)} is a symbolic link`));
    assert.equal(JSON.parse(fs.readFileSync(behind, "utf8")).orgId, undefined, "nor through the chain");
    // The destination itself is fine, by its own name, so each refusal was the link and nothing else.
    assert.equal(JSON.parse(provision("--config", behind, "--org", org)).orgId, org);
  } finally {
    fs.rmSync(link, { force: true });
    fs.rmSync(entry, { force: true });
    fs.rmSync(chooser, { recursive: true, force: true });
    fs.rmSync(exposed, { recursive: true, force: true });
  }
});

test("provisioning refuses a path that ends in something other than a regular file", (t) => {
  if (process.platform === "win32") return t.skip("named pipes are not POSIX FIFOs on Windows");
  // The order has to be measure, then open. A FIFO opened for reading blocks until somebody writes to
  // the other end, so a tool that opened first would hang the operator instead of refusing — remove the
  // check and this test stops failing and starts never finishing, which is the same point made louder.
  const { directory } = enrolledConfig();
  const pipe = path.join(directory, "fifo.json");
  execFileSync("mkfifo", ["-m", "600", pipe]);
  try {
    assert.throws(() => provision("--config", pipe, "--org", org), /not a regular file/);
  } finally {
    fs.rmSync(pipe, { force: true });
  }
  assert.throws(() => provision("--config", directory, "--org", org), /not a regular file/);
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
