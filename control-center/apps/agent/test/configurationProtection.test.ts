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
// anything. A round after that broke the first enforcement three more ways: an attacker-owned directory,
// a symlink, and a swap between the check and the read. These tests are that enforcement.
//
// POSIX mode bits do not describe a Windows ACL, so the check does nothing there and neither do these.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "agent-protection-"));
const configFile = path.join(scratch, "agent.local.json");
const enrolled = { controlCenterUrl: "https://control.test", agentId: "agent-1", agentSecret: "s".repeat(32), orgId: "6a5dab47776e3028ac9b604b", serverId: "6a5f685ff8195a8813879bd7" };
// Widened before writing, because a fixture left at 0400 cannot be rewritten by the account that owns it
// — only by root, which is why this passed locally and failed on an unprivileged runner.
const write = (file: string, mode = 0o600) => {
  if (fs.existsSync(file)) fs.chmodSync(file, 0o600);
  fs.writeFileSync(file, JSON.stringify(enrolled, null, 2));
  fs.chmodSync(file, mode);
};
write(configFile);

process.env.CONTROL_CENTER_AGENT_CONFIG = configFile;
const { readProtectedConfiguration, loadConfig } = await import("../src/config.js");

const linuxOnly = (t: { skip: (why: string) => void }) => {
  if (process.platform === "win32") { t.skip("POSIX mode bits do not describe a Windows ACL"); return true; }
  return false;
};
// Nobody, on every distribution this runs on.
const somebodyElse = 65534;
const amRoot = () => process.getuid?.() === 0;
// THE SAME RULE, REACHED FROM WHICHEVER SIDE THIS RUN CAN MOVE. The rule is "belongs to neither root nor
// me". A root session can hand the fixture to a third account and ask the real question; an unprivileged
// one cannot chown at all, so it asks the function to be somebody else instead. Both arrive at the same
// comparison and neither skips, so the rule is proved wherever this suite runs — root in a local WSL
// session, an unprivileged runner in CI.
const givenAway = (target: string): { self?: number } => {
  if (!amRoot()) return { self: somebodyElse };
  fs.chownSync(target, somebodyElse, somebodyElse);
  return {};
};
const givenBack = (target: string) => { if (amRoot()) fs.chownSync(target, 0, 0); };

test("a configuration only its owner can write is accepted, and its contents come back", (t) => {
  if (linuxOnly(t)) return;
  write(configFile);
  assert.equal(JSON.parse(readProtectedConfiguration(configFile)).orgId, enrolled.orgId);
  assert.equal(loadConfig().orgId, enrolled.orgId, "and it is the file this process actually reads");
});

test("a configuration anybody can write is refused, and so is the agent", (t) => {
  if (linuxOnly(t)) return;
  // The attack this closes: the file carries the organisation and server id the owner-signed Forge
  // identity is matched against, so whoever can write it chooses which identity this host accepts.
  for (const mode of [0o666, 0o622, 0o660, 0o620]) {
    write(configFile, mode);
    assert.throws(() => readProtectedConfiguration(configFile), /writable by group or other/, `mode 0${mode.toString(8)} must be refused`);
    assert.throws(() => loadConfig(), /writable by group or other/, `and loading must refuse it too, at mode 0${mode.toString(8)}`);
  }
  write(configFile);
});

test("a readable-but-not-writable configuration is still accepted", (t) => {
  if (linuxOnly(t)) return;
  // The rule is about who can CHANGE the identifiers. Group read is a deployment choice, not a defeat, and
  // refusing it would refuse hosts that are doing nothing wrong.
  for (const mode of [0o640, 0o644, 0o400]) {
    write(configFile, mode);
    readProtectedConfiguration(configFile);
  }
  write(configFile);
});

test("a configuration belonging to neither root nor this runtime is refused", (t) => {
  if (linuxOnly(t)) return;
  // The fixture sits directly in the temporary directory, which is root-owned, so every ancestor passes
  // and the file is the only thing left to fail — which is what makes this the FILE rule rather than the
  // directory one below.
  const inTmp = path.join(os.tmpdir(), `agent-owner-${process.pid}.json`);
  write(inTmp);
  try {
    assert.throws(() => readProtectedConfiguration(inTmp, givenAway(inTmp)), /agent-owner-.*belongs to uid/, "the FILE is what is refused here");
    givenBack(inTmp);
    readProtectedConfiguration(inTmp);
  } finally {
    fs.rmSync(inTmp, { force: true });
  }
});

test("a directory belonging to neither root nor this runtime is refused, whatever its mode", (t) => {
  if (linuxOnly(t)) return;
  // A directory's owner may replace what is in it however tight the mode is, and the sticky bit exempts
  // the owner rather than binding them — so an attacker-owned 0755 ancestor passed the mode rule alone.
  // The subject here is a directory rather than the file, and the ancestor rules run first, so this is
  // the check that speaks. The file itself stays acceptable throughout, as the read after the refusal
  // shows: what was rejected was the tree, not the configuration.
  try {
    assert.throws(() => readProtectedConfiguration(configFile, givenAway(scratch)), new RegExp(`${path.basename(scratch)} belongs to uid`), "the DIRECTORY is what is refused here");
  } finally {
    givenBack(scratch);
  }
  readProtectedConfiguration(configFile);
});

test("a directory anybody can write is refused, whatever the file's own mode says", (t) => {
  if (linuxOnly(t)) return;
  // A writable parent means the file is renamed away and replaced, so its 0600 protects nothing.
  const open = fs.mkdtempSync(path.join(os.tmpdir(), "agent-open-dir-"));
  const inside = path.join(open, "agent.local.json");
  write(inside);
  fs.chmodSync(open, 0o777);
  try {
    assert.throws(() => readProtectedConfiguration(inside), /writable by group or other/);
    // And the same directory with the sticky bit set passes the MODE rule, because others may create
    // there but not touch what is not theirs — which is exactly how the temporary directory holds these
    // fixtures. Ownership is a separate rule and is tested above.
    fs.chmodSync(open, 0o1777);
    readProtectedConfiguration(inside);
  } finally {
    fs.chmodSync(open, 0o700);
    fs.rmSync(open, { recursive: true, force: true });
  }
});

test("a configuration that is a symbolic link is refused", (t) => {
  if (linuxOnly(t)) return;
  // A review pointed a 0600 symlink at a file in a 0777 directory and every rule passed: the checks
  // described the link's own path and the read followed it somewhere else entirely.
  const exposed = fs.mkdtempSync(path.join(os.tmpdir(), "agent-exposed-"));
  const realFile = path.join(exposed, "agent.local.json");
  write(realFile);
  fs.chmodSync(exposed, 0o777);
  const link = path.join(scratch, "linked.json");
  fs.symlinkSync(realFile, link);
  try {
    assert.throws(() => readProtectedConfiguration(link), /symbolic link/);
  } finally {
    fs.rmSync(link, { force: true });
    fs.chmodSync(exposed, 0o700);
    fs.rmSync(exposed, { recursive: true, force: true });
  }
});

test("the tree that is checked is the file's real one, not the one the path spells", (t) => {
  if (linuxOnly(t)) return;
  // Resolution is not only about the last component. Here the configuration is a real file with a tight
  // mode in a tight directory, reached through a link — and its REAL parent's parent is world-writable,
  // which is where the file can be taken from underneath it. Walking the path as written never visits
  // that directory at all: every component it does visit is fine, and the check returns happy.
  const exposed = fs.mkdtempSync(path.join(os.tmpdir(), "agent-exposed-tree-"));
  const inner = path.join(exposed, "inner");
  fs.mkdirSync(inner, { mode: 0o700 });
  fs.chmodSync(inner, 0o700);
  const realFile = path.join(inner, "agent.local.json");
  write(realFile);
  fs.chmodSync(exposed, 0o777);
  const via = path.join(scratch, "via");
  fs.symlinkSync(inner, via);
  try {
    assert.throws(() => readProtectedConfiguration(path.join(via, "agent.local.json")), new RegExp(`${path.basename(exposed)} is writable by group or other`));
  } finally {
    fs.rmSync(via, { force: true });
    fs.chmodSync(exposed, 0o700);
    fs.rmSync(exposed, { recursive: true, force: true });
  }
});

test("a directory that only SELECTS the configuration is trusted too", (t) => {
  if (linuxOnly(t)) return;
  // THE SELECTION ATTACK, which protecting the destination does not touch. A review owned a directory,
  // put a link in it, and swung that link between two configurations that were both perfectly protected:
  // every check passed both times and the runtime came back with two different organisations. Nobody had
  // to write a file the checks look at — choosing which protected file is read is choosing the identity.
  //
  // Both paths are walked now, so the question is not only "is the destination safe" but "who chose it".
  const chooser = fs.mkdtempSync(path.join(os.tmpdir(), "agent-chooser-"));
  const a = fs.mkdtempSync(path.join(os.tmpdir(), "agent-org-a-"));
  const b = fs.mkdtempSync(path.join(os.tmpdir(), "agent-org-b-"));
  for (const [directory, orgId] of [[a, "1".repeat(24)], [b, "2".repeat(24)]] as const) {
    const inside = path.join(directory, "agent.local.json");
    fs.writeFileSync(inside, JSON.stringify({ ...enrolled, orgId }), { mode: 0o600 });
    fs.chmodSync(inside, 0o600);
  }
  const via = path.join(chooser, "via");
  fs.symlinkSync(a, via);
  const through = path.join(via, "agent.local.json");
  try {
    // Both destinations are beyond reproach: read directly, each is accepted and gives its own identity.
    assert.equal(JSON.parse(readProtectedConfiguration(path.join(a, "agent.local.json"))).orgId, "1".repeat(24));
    assert.equal(JSON.parse(readProtectedConfiguration(path.join(b, "agent.local.json"))).orgId, "2".repeat(24));
    // Reached through a directory the attacker owns, the same destinations are refused — and the refusal
    // names the chooser, not the file, because the file was never the problem.
    fs.chmodSync(chooser, 0o777);
    assert.throws(() => readProtectedConfiguration(through), new RegExp(`${path.basename(chooser)} is writable by group or other`));
    // The ownership half of the same rule, when the run can stage it. Asking the function to be somebody
    // else cannot isolate it here: that makes every directory in both chains untrusted at once, so the
    // walk speaks about whichever it reaches first rather than about the chooser. Handing the chooser
    // away, which needs root, is the only way to make it the one thing that is wrong.
    fs.chmodSync(chooser, 0o755);
    if (amRoot()) {
      fs.chownSync(chooser, somebodyElse, somebodyElse);
      try {
        assert.throws(() => readProtectedConfiguration(through), new RegExp(`${path.basename(chooser)} belongs to uid`));
      } finally {
        fs.chownSync(chooser, 0, 0);
      }
    }
    // And with the chooser trusted, the link is an operator's own arrangement and is honoured.
    fs.chmodSync(chooser, 0o700);
    assert.equal(JSON.parse(readProtectedConfiguration(through)).orgId, "1".repeat(24));
    fs.rmSync(via, { force: true });
    fs.symlinkSync(b, via);
    assert.equal(JSON.parse(readProtectedConfiguration(through)).orgId, "2".repeat(24), "a trusted party may still repoint it; that is administration, not an attack");
  } finally {
    for (const directory of [chooser, a, b]) { try { fs.chmodSync(directory, 0o700); } catch { /* best effort */ } fs.rmSync(directory, { recursive: true, force: true }); }
  }
});

test("what is read is the file that was checked, not the name that was checked", async (t) => {
  if (linuxOnly(t)) return;
  // THE INTERLEAVING, and an honest account of how much of it a test can reach. A review replaced the
  // configuration between the check and the read and was handed the attacker's organisation. The fix is
  // to open once and ask every question of the descriptor, including the read.
  //
  // Nothing can interleave with a synchronous call in this process, so the behaviour cannot be staged
  // from inside a test. What CAN be shown is the platform fact the fix rests on, and that the code
  // actually rests on it. Both halves are here, and the second is a structural assertion precisely
  // because no behaviour in this process can distinguish it.
  const racy = path.join(scratch, "racy.json");
  write(racy);
  const original = fs.readFileSync(racy, "utf8");
  const handle = fs.openSync(racy, "r");
  try {
    const replacement = path.join(scratch, "replacement.json");
    fs.writeFileSync(replacement, JSON.stringify({ ...enrolled, orgId: "9".repeat(24) }, null, 2), { mode: 0o666 });
    fs.chmodSync(replacement, 0o666);
    fs.renameSync(replacement, racy);
    assert.equal(fs.readFileSync(handle, "utf8"), original, "a rename over the name does not reach an open descriptor");
    assert.notEqual(fs.readFileSync(racy, "utf8"), original, "while the same read by NAME gets the replacement, which is the whole difference");
  } finally {
    fs.closeSync(handle);
    fs.rmSync(racy, { force: true });
  }

  const source = await fs.promises.readFile(new URL("../src/config.ts", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("export function readProtectedConfiguration"), source.indexOf("export function loadConfig"));
  assert.match(body, /fs\.fstatSync\(handle\)/, "the file's own properties are measured on the descriptor");
  assert.match(body, /return fs\.readFileSync\(handle, "utf8"\)/, "and the contents come from the same descriptor, not from a second lookup by name");
});

// The ownership cases above adapt: given root they really hand the fixture to another account, and given
// an unprivileged runner they ask the comparison to be somebody else. CI is the second of those, so on CI
// they prove the comparisons are made and that each names the right subject, rather than proving the
// kernel refuses a genuine third-party file. The Linux gate requires zero skips precisely so that a test
// which never runs cannot sit in the suite looking like coverage, so this is written down rather than
// stood in for by something that would show green without executing.
//
// The resolution is still a sequence of name lookups, so a window remains between resolving and opening.
// Both chains are checked now, though, so every directory that could be swapped during it belongs to root
// or to this process — parties who could edit the file directly. An earlier version of this note called
// that window a denial of service while the written path went unchecked, which was wrong: an untrusted
// directory there let somebody choose which protected configuration was read, and choosing the identity
// is not a refusal. Node exposes no `openat`.
