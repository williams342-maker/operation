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
  const gids = execFileSync("id", ["-G", user], { encoding: "utf8" }).trim().split(/\s+/);
  assert.equal(supplementary.length, gids.length, "every group the account is in is carried over");
  for (const name of supplementary) {
    assert.doesNotMatch(name, /^[0-9]+$/, `runuser would look up a group NAMED ${name}, and there is none`);
    const resolved = execFileSync("getent", ["group", name], { encoding: "utf8" }).trim();
    assert.ok(resolved.length > 0, `${name} resolves to a real group`);
  }
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
  execFileSync("runuser", [...printed, "--", "test", "-x", "/tmp"], { stdio: "pipe" });
  assert.throws(() => execFileSync("runuser", [...printed, "--", "test", "-r", "/etc/shadow"], { stdio: "pipe" }), "the credentials are really dropped");
});

test("the read-only verb refuses what it cannot name", (t) => {
  if (!linux) return t.skip("needs getent");
  assert.throws(() => run("probe-credentials", "no-such-account-here", "root"), /no such account/);
  assert.throws(() => run("probe-credentials", os.userInfo().username, "no-such-group-here"), /no such group/);
  assert.throws(() => run("probe-credentials"), /usage/);
});
