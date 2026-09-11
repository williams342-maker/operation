import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// THE ONLY EXECUTABLE TEST THE AGENT INSTALLER HAS, and it exists because a reviewer demonstrated that
// reverting its credential construction to raw gids — the defect that would have refused every
// activation on the production host — passed every other check in this repository.
//
// `runuser` resolves `-G` with getgrnam and not getgrgid, so a numeric gid is looked up as a group whose
// NAME is that number and the probe fails. Measured on util-linux 2.34:
//   runuser -u nobody -G 65534   -- true  ->  "group 65534 does not exist", exit 1
//   runuser -u nobody -G nogroup -- true  ->  exit 0
//
// The installer prints the exact credential list through `probe-credentials`, built by the same function
// the activation path uses, so what this reads is what would be passed. The verb is read-only and needs
// no root; everything that changes a host is behind the root check below it.
const here = path.dirname(fileURLToPath(import.meta.url));
const installer = path.resolve(here, "..", "..", "scripts", "install-reviewed-agent.sh");
const linux = process.platform === "linux";

const run = (...args) => execFileSync("bash", [installer, ...args], { encoding: "utf8" }).trim().split("\n");

test("the probe is given group NAMES, never the gids they came from", (t) => {
  if (!linux) return t.skip("the installer is a Linux root script; its credential build runs on Linux");
  const user = os.userInfo().username;
  const group = execFileSync("id", ["-gn", user], { encoding: "utf8" }).trim();
  const printed = run("probe-credentials", user, group);

  assert.equal(printed[0], "-u");
  assert.equal(printed[1], user);
  assert.equal(printed[2], "-g");
  assert.equal(printed[3], group, "the primary group is the one the unit declares, not the account's own");

  const supplementary = [];
  for (let index = 4; index < printed.length; index += 2) {
    assert.equal(printed[index], "-G");
    supplementary.push(printed[index + 1]);
  }
  // The expected names are derived HERE, from the account's gids, not read back out of what the tool
  // printed. Counting entries and checking each resolves would accept the right number of wrong groups.
  const gids = execFileSync("id", ["-G", user], { encoding: "utf8" }).trim().split(/\s+/);
  const expected = gids.map((gid) => execFileSync("getent", ["group", gid], { encoding: "utf8" }).trim().split(":")[0]);
  assert.deepEqual(supplementary, expected, "the groups carried over are the account's own, by name");
  for (const name of supplementary) assert.doesNotMatch(name, /^[0-9]+$/, `runuser would look up a group NAMED ${name}, and there is none`);
});

test("runuser accepts the credential list the installer builds, and really drops to it", (t) => {
  if (!linux) return t.skip("needs runuser");
  // Only root may change credentials, so the execution — not the assertion — is what is skipped off
  // root. An assertion that quietly never runs is the failure this whole change keeps being about.
  if (process.getuid?.() !== 0) return t.skip("changing credentials needs root; the list itself is asserted above");
  // A deliberately unprivileged account: asking root to drop to root would make the negative control
  // pass for the wrong reason, which is exactly what it did the first time this was written.
  const user = "nobody";
  let group;
  try {
    group = execFileSync("id", ["-gn", user], { encoding: "utf8" }).trim();
  } catch {
    return t.skip("this host has no unprivileged nobody account");
  }
  const printed = run("probe-credentials", user, group);
  // THE IDENTITY OF THE PROCESS, asked of the process itself. The first version of this checked that
  // /etc/shadow could not be read, which proves nothing: a host where that file is absent, or where the
  // account is in a group that may read it, answers the same as a host where credentials never changed.
  const identity = (...command) => execFileSync("runuser", [...printed, "--", ...command], { encoding: "utf8" }).trim();
  assert.equal(identity("id", "-un"), user, "the process really runs as that account");
  assert.equal(identity("id", "-gn"), group, "with the group that was asked for as its primary");
  // Compared against the account's OWN groups read here, not against the list the installer printed:
  // deriving the expectation from the thing under test is how a wrong list would agree with itself.
  const carried = identity("id", "-Gn").split(/\s+/);
  const own = execFileSync("id", ["-Gn", user], { encoding: "utf8" }).trim().split(/\s+/);
  assert.deepEqual([...new Set(carried)].sort(), [...new Set([...own, group])].sort(), "and exactly the account's groups, plus the one asked for");
});

test("the primary group comes from the argument, not from the account", (t) => {
  // The unit's `Group=` is allowed to differ from the account's own primary group, and both fixtures
  // above happen to pass the account's own — so the override itself was asserted by nobody.
  if (!linux) return t.skip("needs id/getent");
  const user = os.userInfo().username;
  const own = execFileSync("id", ["-gn", user], { encoding: "utf8" }).trim();
  const other = ["daemon", "bin", "sys", "nogroup", "root"].find((candidate) => {
    if (candidate === own) return false;
    try {
      return execFileSync("getent", ["group", candidate], { encoding: "utf8" }).trim().length > 0;
    } catch {
      return false;
    }
  });
  if (!other) return t.skip("this host has no second group to override with");
  const printed = run("probe-credentials", user, other);
  assert.equal(printed[3], other, "the group asked for is the group passed");
  assert.notEqual(printed[3], own);
});

test("the read-only verb refuses what it cannot name", (t) => {
  if (!linux) return t.skip("needs getent");
  assert.throws(() => run("probe-credentials", "no-such-account-here", "root"), /no such account/);
  assert.throws(() => run("probe-credentials", os.userInfo().username, "no-such-group-here"), /no such group/);
  assert.throws(() => run("probe-credentials"), /usage/);
});
