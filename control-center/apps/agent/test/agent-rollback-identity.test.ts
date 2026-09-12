import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

// THE IDENTITY HALF OF AN AGENT-RELEASE ROLLBACK.
//
// Security review made this a condition of the Forge go-ahead. `install-reviewed-agent.sh` snapshots
// `agent.json` at ACTIVATION time and restores it on rollback; the Forge organisation is written into
// that same file separately and afterwards, by the provisioning tool. So a snapshot can be stale about
// identity the moment it is taken, and restoring it silently removes the organisation — after which the
// agent refuses to start, which is fail-closed but only helps somebody who knows to look.
//
// The reviewer's requirement was that rollback VERIFY the restored identity rather than trust the
// snapshot. It does more than verify: an identifier that is live survives the rollback, because a
// release rollback is about the release. One that was never set is not invented. A disagreement resolves
// in favour of what was live, because the snapshot is not current truth.
//
// The script exposes this as a `reconcile-identity` verb, above the root check, for the same reason
// `probe-credentials` exists: the rollback path itself needs root and systemd, and a rule nothing can
// execute is a rule nobody has checked. The verb calls the same shell function the rollback calls.
const here = path.dirname(fileURLToPath(import.meta.url));
const installer = path.resolve(here, "..", "..", "..", "scripts", "install-reviewed-agent.sh");
const org = "6a5dab47776e3028ac9b604b";
const server = "6a5f685ff8195a8813879bd7";
const other = "7c11ee0912a4bb6650341f88";

const reconcile = (file: string, liveOrg = "", liveServer = "") =>
  execFileSync("bash", [installer, "reconcile-identity", file, liveOrg, liveServer], { encoding: "utf8" });

function restored(fields: Record<string, unknown> = {}, mode = 0o600) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agent-rollback-"));
  const file = path.join(directory, "agent.json");
  fs.writeFileSync(file, `${JSON.stringify({ controlCenterUrl: "https://control.test", agentId: "agent-1", agentSecret: "s".repeat(32), agentVersion: "0.1.14", ...fields }, null, 2)}\n`, { mode });
  fs.chmodSync(file, mode);
  return { directory, file };
}

const linuxOnly = (t: { skip: (why: string) => void }) => {
  if (process.platform === "win32") { t.skip("the installer is a POSIX shell script"); return true; }
  return false;
};

test("a snapshot that predates provisioning does not take the organisation with it", (t) => {
  if (linuxOnly(t)) return;
  // The case the condition is about. The snapshot has no organisation because it was taken before the
  // ceremony; the host has one because the ceremony happened.
  const { file } = restored({ serverId: server });
  const output = reconcile(file, org, server);
  assert.match(output, /the snapshot was stale for orgId; carried the live value forward/);
  const after = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(after.orgId, org, "the live organisation survived the rollback");
  assert.equal(after.serverId, server);
  assert.equal(after.agentVersion, "0.1.14", "and the rolled-back release is still what the snapshot said");
});

test("a snapshot that agrees with what was live is left exactly alone", (t) => {
  if (linuxOnly(t)) return;
  const { file } = restored({ orgId: org, serverId: server });
  const before = fs.readFileSync(file, "utf8");
  const output = reconcile(file, org, server);
  assert.match(output, /restored identity matches what was live; nothing carried forward/);
  assert.equal(fs.readFileSync(file, "utf8"), before, "byte for byte, because there was nothing to do");
});

test("an identifier that was never live is not invented", (t) => {
  if (linuxOnly(t)) return;
  // A host that has not been provisioned must come back unprovisioned. Filling the field in would be the
  // same authority this whole repair exists to remove, arriving by a different door.
  const { file } = restored({ serverId: server });
  const before = fs.readFileSync(file, "utf8");
  const output = reconcile(file, "", server);
  const after = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.ok(!after.orgId, "no organisation, and the agent will refuse to start until somebody provisions one");
  assert.equal(after.serverId, server);
  // And the file is not rewritten at all for this: an absent field and an empty one are the same absence,
  // so there is nothing to carry and nothing to touch.
  assert.equal(fs.readFileSync(file, "utf8"), before);
  assert.match(output, /nothing carried forward/);
});

test("a snapshot carrying a DIFFERENT identity loses to what was live", (t) => {
  if (linuxOnly(t)) return;
  // Not a hypothetical: an activation snapshot from before a deliberate re-provisioning carries the old
  // organisation, and restoring the release must not quietly move the host back to it.
  const { file } = restored({ orgId: other, serverId: other });
  const output = reconcile(file, org, server);
  assert.match(output, /stale for orgId and serverId/);
  const after = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(after.orgId, org);
  assert.equal(after.serverId, server);
});

test("the file keeps its mode, and the reconciliation is atomic", (t) => {
  if (linuxOnly(t)) return;
  // It holds the enrolment credential, so a rollback that widened it would be a worse outcome than one
  // that lost the organisation. The pending file is a sibling and must not be left behind either.
  // THE FIXTURE IS 0640 ON PURPOSE, and not because the agent would accept such a file — it would not,
  // its own protection rule refuses a configuration anybody can read. It is the mode that can tell a
  // PRESERVED mode from a normalised one, because the script sets `umask 077` at the top, so the mode
  // passed to `open` comes back as 0600 unless something puts the original back deliberately. Trying
  // this with 0600 proves nothing: the umask has nothing left to strip. What is under test is that a
  // rollback does not quietly change the permissions of the file it is repairing.
  const { directory, file } = restored({ serverId: server }, 0o640);
  reconcile(file, org, server);
  assert.equal(fs.statSync(file).mode & 0o777, 0o640, "the mode came back rather than following the script's umask");
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).orgId, org, "and it really did rewrite the file");
  assert.deepEqual(fs.readdirSync(directory).filter((entry) => entry.includes(".identity-pending")), [], "nothing left over");

  // Ownership is the other half of the same restoration and needs a second account to prove, so it is
  // asserted structurally for every run and staged for real where the machine allows it. A replacement
  // is a new inode: run by root over an agent-owned file without this, the rollback hands the service a
  // configuration it cannot read, which is the outage this whole reconciliation exists to avoid.
  assert.match(fs.readFileSync(installer, "utf8"), /fs\.chownSync\(pending, stat\.uid, stat\.gid\);/);
  if (process.getuid?.() === 0) {
    const staged = restored({ serverId: server }, 0o600);
    fs.chownSync(staged.file, 65534, 65534);
    reconcile(staged.file, org, server);
    const owned = fs.statSync(staged.file);
    assert.equal(owned.uid, 65534, "the agent still owns its own configuration");
    assert.equal(owned.gid, 65534);
  }
});

test("the verb refuses what it cannot act on, rather than half-acting", (t) => {
  if (linuxOnly(t)) return;
  const { directory } = restored();
  assert.throws(() => reconcile(path.join(directory, "absent.json"), org, server), /no configuration at/);
  assert.throws(() => execFileSync("bash", [installer, "reconcile-identity"], { encoding: "utf8" }), /usage: reconcile-identity/);
});

test("STRUCTURAL: the rollback path calls the same function this verb does", (t) => {
  if (linuxOnly(t)) return;
  // The verb exists to make the rule executable, and it would be worthless if the rollback did its own
  // thing beside it. One definition, two callers, and the rollback runs it BEFORE the restart so a host
  // that cannot be made whole fails there rather than looking activated and refusing to start.
  const source = fs.readFileSync(installer, "utf8");
  assert.equal(source.match(/^reconcile_identity\(\) \{$/m) !== null, true, "one definition");
  assert.equal(source.match(/reconcile_identity "/g)?.length, 2, "the verb and the rollback, and nothing else");
  const rollback = source.slice(source.indexOf('if [ "$command" = rollback ]'));
  const reconciledAt = rollback.indexOf("reconcile_identity ");
  const restartedAt = rollback.indexOf("systemctl restart");
  assert.ok(reconciledAt > 0 && reconciledAt < restartedAt, "reconciled before the service is restarted");
  assert.match(rollback.slice(reconciledAt), /\|\| fail "rollback could not reconcile the agent identity/);
});
