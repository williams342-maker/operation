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
// THE RULE IS THAT LIVE WINS, INCLUDING WHEN LIVE IS EMPTY. The live configuration is what the running
// host actually is; the snapshot is older by construction. A first version made an empty live value lose
// to the snapshot, so an operator who had deliberately rolled the organisation back had it reinstated by
// the next release rollback, over a message saying nothing had been carried forward.
//
// The live configuration arrives as a FILE, captured before the snapshot lands on top of it, because
// passing the two identifiers through argv could not distinguish "the live identity is empty" from "the
// live identity could not be read" — and truncated any value containing whitespace.
//
// The script exposes this as a `reconcile-identity` verb, above the root check, for the same reason
// `probe-credentials` exists: the rollback path needs root and systemd, and a rule nothing can execute is
// a rule nobody has checked. The verb calls the same shell function the rollback calls.
const here = path.dirname(fileURLToPath(import.meta.url));
const installer = path.resolve(here, "..", "..", "..", "scripts", "install-reviewed-agent.sh");
const org = "6a5dab47776e3028ac9b604b";
const server = "6a5f685ff8195a8813879bd7";
const other = "7c11ee0912a4bb6650341f88";

const reconcile = (restoredPath: string, livePath: string) =>
  execFileSync("bash", [installer, "reconcile-identity", restoredPath, livePath], { encoding: "utf8" });

const configuration = (fields: Record<string, unknown> = {}) =>
  `${JSON.stringify({ controlCenterUrl: "https://control.test", agentId: "agent-1", agentSecret: "s".repeat(32), agentVersion: "0.1.14", ...fields }, null, 2)}\n`;

/** A restored snapshot and the configuration that was live, side by side, as the rollback sees them. */
function pair(snapshot: Record<string, unknown>, live: Record<string, unknown>, mode = 0o600) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agent-rollback-"));
  const restoredPath = path.join(directory, "agent.json");
  const livePath = path.join(directory, ".agent-live-fixture");
  for (const [file, fields] of [[restoredPath, snapshot], [livePath, live]] as const) {
    fs.writeFileSync(file, configuration(fields), { mode });
    fs.chmodSync(file, mode);
  }
  return { directory, restoredPath, livePath };
}

const linuxOnly = (t: { skip: (why: string) => void }) => {
  if (process.platform === "win32") { t.skip("the installer is a POSIX shell script"); return true; }
  return false;
};

test("a snapshot that predates provisioning does not take the organisation with it", (t) => {
  if (linuxOnly(t)) return;
  // The case the condition is about. The snapshot has no organisation because it was taken before the
  // ceremony; the host has one because the ceremony happened.
  const { restoredPath, livePath } = pair({ serverId: server }, { orgId: org, serverId: server });
  assert.match(reconcile(restoredPath, livePath), /the snapshot disagreed about orgId; the live value stands/);
  const after = JSON.parse(fs.readFileSync(restoredPath, "utf8"));
  assert.equal(after.orgId, org, "the live organisation survived the rollback");
  assert.equal(after.serverId, server);
  assert.equal(after.agentVersion, "0.1.14", "and the rolled-back release is still what the snapshot said");
});

test("a snapshot that agrees with what was live is left exactly alone", (t) => {
  if (linuxOnly(t)) return;
  const { restoredPath, livePath } = pair({ orgId: org, serverId: server }, { orgId: org, serverId: server });
  const before = fs.readFileSync(restoredPath, "utf8");
  assert.match(reconcile(restoredPath, livePath), /already matches what was live/);
  assert.equal(fs.readFileSync(restoredPath, "utf8"), before, "byte for byte, because there was nothing to do");
});

test("an organisation the operator deliberately removed does not come back", (t) => {
  if (linuxOnly(t)) return;
  // LIVE WINS EVEN WHEN LIVE IS EMPTY, and a review found the first version got this backwards. The path
  // is entirely ordinary: provision, activate — so the snapshot carries the organisation — then roll the
  // provisioning back on purpose, then roll the release back. The organisation must stay gone.
  const { restoredPath, livePath } = pair({ orgId: org, serverId: server }, { serverId: server });
  assert.match(reconcile(restoredPath, livePath), /the snapshot disagreed about orgId; the live value stands/);
  const after = JSON.parse(fs.readFileSync(restoredPath, "utf8"));
  assert.equal(after.orgId, "", "the removal stands, and the agent will refuse to start until somebody provisions again");
  assert.equal(after.serverId, server);
});

test("an identifier neither side has is not invented", (t) => {
  if (linuxOnly(t)) return;
  const { restoredPath, livePath } = pair({ serverId: server }, { serverId: server });
  const before = fs.readFileSync(restoredPath, "utf8");
  assert.match(reconcile(restoredPath, livePath), /already matches what was live/);
  assert.equal(fs.readFileSync(restoredPath, "utf8"), before);
});

test("a snapshot carrying a DIFFERENT identity loses to what was live", (t) => {
  if (linuxOnly(t)) return;
  // An activation snapshot from before a deliberate re-provisioning carries the old organisation, and
  // restoring the release must not quietly move the host back to it.
  const { restoredPath, livePath } = pair({ orgId: other, serverId: other }, { orgId: org, serverId: server });
  assert.match(reconcile(restoredPath, livePath), /disagreed about orgId and serverId/);
  const after = JSON.parse(fs.readFileSync(restoredPath, "utf8"));
  assert.equal(after.orgId, org);
  assert.equal(after.serverId, server);
});

test("a planted link at the replacement's name cannot make root write somewhere else", (t) => {
  if (linuxOnly(t)) return;
  // THE ESCALATION. The installer creates the configuration directory owned by the AGENT account, so the
  // agent account can create siblings in it. The replacement used to have a fixed name and a plain "w"
  // open: a review planted a link there, had root write the configuration — credential included — to a
  // path of its choosing, watched the chown hand it over, and finished with the configuration itself
  // replaced by the link. No race to win.
  //
  // The name is random and the open is exclusive now, so there is nothing to plant AT. What can still be
  // planted is a link at the CONFIGURATION, and that is refused before anything is opened.
  const { directory, restoredPath, livePath } = pair({ serverId: server }, { orgId: org, serverId: server });
  const elsewhere = path.join(directory, "elsewhere");

  // Every name the old attack could have used, and one it could not: the fixed one is simply gone.
  fs.symlinkSync(elsewhere, `${restoredPath}.identity-pending`);
  try {
    reconcile(restoredPath, livePath);
    assert.equal(fs.existsSync(elsewhere), false, "nothing was written through the planted name");
    assert.equal(JSON.parse(fs.readFileSync(restoredPath, "utf8")).orgId, org, "and the real work still happened");
    assert.equal(fs.lstatSync(restoredPath).isSymbolicLink(), false, "the configuration is still a file");
  } finally {
    fs.rmSync(`${restoredPath}.identity-pending`, { force: true });
  }

  // And the configuration itself as a link is refused rather than followed. The target has to EXIST for
  // this to be the interesting case: a dangling link is refused by the verb's own existence check, which
  // proves nothing about whether the link would have been followed.
  const target = path.join(directory, "somebody-elses.json");
  fs.writeFileSync(target, configuration({ orgId: other }), { mode: 0o600 });
  const untouched = fs.readFileSync(target, "utf8");
  const linked = path.join(directory, "linked.json");
  fs.symlinkSync(target, linked);
  assert.throws(() => reconcile(linked, livePath), /is not a regular file/);
  assert.equal(fs.readFileSync(target, "utf8"), untouched, "the file at the far end is untouched");
  assert.equal(fs.existsSync(elsewhere), false, "and still nothing written where the first link pointed");
});

test("a live configuration that cannot be trusted is a refusal, not an empty identity", (t) => {
  if (linuxOnly(t)) return;
  // The failure that used to be indistinguishable from success. A corrupt or unreadable live
  // configuration produced the same empty pair as a host with no identity, the snapshot then won by
  // default, and the rollback announced that it had verified the identity against what was live.
  const { directory, restoredPath, livePath } = pair({ orgId: other, serverId: other }, { orgId: org, serverId: server });
  const before = fs.readFileSync(restoredPath, "utf8");

  fs.writeFileSync(livePath, "{ truncated", { mode: 0o600 });
  assert.throws(() => reconcile(restoredPath, livePath), /Unexpected|JSON/);
  assert.equal(fs.readFileSync(restoredPath, "utf8"), before, "and the snapshot did not win by default");

  fs.writeFileSync(livePath, "[]", { mode: 0o600 });
  assert.throws(() => reconcile(restoredPath, livePath), /is not an agent configuration/);
  assert.equal(fs.readFileSync(restoredPath, "utf8"), before);

  fs.rmSync(livePath, { force: true });
  assert.throws(() => reconcile(restoredPath, livePath), /no captured live configuration/);
  assert.equal(fs.readFileSync(restoredPath, "utf8"), before);

  fs.mkdirSync(livePath, { mode: 0o700 });
  try {
    assert.throws(() => reconcile(restoredPath, livePath), /no captured live configuration|is not a regular file/);
    assert.equal(fs.readFileSync(restoredPath, "utf8"), before);
  } finally {
    fs.rmSync(livePath, { recursive: true, force: true });
  }
  assert.deepEqual(fs.readdirSync(directory).filter((entry) => entry.includes(".identity-")), [], "and no replacement was left anywhere");
});

test("the file keeps its mode and owner, and nothing is left beside it", (t) => {
  if (linuxOnly(t)) return;
  // THE FIXTURE IS 0640 ON PURPOSE, and not because the agent would accept such a file — its own
  // protection rule refuses a configuration anybody can read. It is the mode that can tell a PRESERVED
  // mode from a normalised one, because the script sets `umask 077` at the top, so 0600 comes back as
  // 0600 whether or not anything restored it.
  const { directory, restoredPath, livePath } = pair({ serverId: server }, { orgId: org, serverId: server }, 0o640);
  reconcile(restoredPath, livePath);
  assert.equal(fs.statSync(restoredPath).mode & 0o777, 0o640, "the mode came back rather than following the script's umask");
  assert.equal(JSON.parse(fs.readFileSync(restoredPath, "utf8")).orgId, org, "and it really did rewrite the file");
  assert.deepEqual(fs.readdirSync(directory).filter((entry) => entry.includes(".identity-")), [], "nothing left over");

  // Ownership is the other half of the same restoration and needs a second account to prove. A
  // replacement is a new inode: run by root over an agent-owned file without this, the rollback hands the
  // service a configuration it cannot read, which is the outage this reconciliation exists to avoid.
  if (process.getuid?.() === 0) {
    const staged = pair({ serverId: server }, { orgId: org, serverId: server });
    fs.chownSync(staged.restoredPath, 65534, 65534);
    reconcile(staged.restoredPath, staged.livePath);
    const owned = fs.statSync(staged.restoredPath);
    assert.equal(owned.uid, 65534, "the agent still owns its own configuration");
    assert.equal(owned.gid, 65534);
  }
});

test("the verb refuses what it cannot act on, rather than half-acting", (t) => {
  if (linuxOnly(t)) return;
  const { directory, livePath } = pair({}, {});
  assert.throws(() => reconcile(path.join(directory, "absent.json"), livePath), /no configuration at/);
  assert.throws(() => execFileSync("bash", [installer, "reconcile-identity"], { encoding: "utf8" }), /usage: reconcile-identity/);
  assert.throws(() => execFileSync("bash", [installer, "reconcile-identity", path.join(directory, "agent.json")], { encoding: "utf8" }), /usage: reconcile-identity/);
});

test("STRUCTURAL: the rollback calls the same function, before the restart, and never writes in place", (t) => {
  if (linuxOnly(t)) return;
  // The verb exists to make the rule executable and would be worthless if the rollback did its own thing
  // beside it. The last two assertions cover what no fixture in this process can: that the write goes to
  // a sibling and is renamed, rather than truncating the configuration where it stands, and that the
  // result is read back and checked. Both are rules a review broke without failing anything.
  const source = fs.readFileSync(installer, "utf8");
  const compact = source.replace(/\s+/g, "");
  assert.equal(source.match(/^reconcile_identity\(\) \{$/m) !== null, true, "one definition");
  assert.equal(source.match(/reconcile_identity "/g)?.length, 2, "the verb and the rollback, and nothing else");

  const rollback = source.slice(source.indexOf('if [ "$command" = rollback ]'));
  const captured = rollback.indexOf("cp -a -- \"$config_root/agent.json\" \"$live_config\"");
  const overwritten = rollback.indexOf("agent.json.rollback-pending");
  const reconciled = rollback.indexOf("reconcile_identity ");
  const restarted = rollback.indexOf("systemctl restart");
  assert.ok(captured > 0 && captured < overwritten, "the live configuration is captured before the snapshot lands on it");
  assert.ok(reconciled > overwritten && reconciled < restarted, "and reconciled after that, before the service is restarted");
  assert.match(rollback.slice(reconciled), /\|\| fail "rollback could not reconcile the agent identity/);

  assert.equal(compact.includes('fs.openSync(pending,"wx"'), true, "the replacement is created exclusively");
  assert.equal(compact.includes('crypto.randomBytes(8).toString("hex")'), true, "and named unguessably");
  assert.equal(compact.includes("fs.renameSync(pending,file)"), true, "and renamed into place rather than written where the file stands");
  assert.equal(compact.includes("fs.fchmodSync(handle"), true, "properties are set on the descriptor, not the name");
  assert.equal(compact.includes("fs.fchownSync(handle"), true);
  assert.equal(compact.includes('readConfiguration(file,"thereconciledconfiguration")'), true, "and the result is read back");
  // Read back AND compared. A review deleted the comparison loop and nothing objected, because asserting
  // the read-back happens says nothing about whether anybody looks at what came back. This loop is the
  // literal text of the reviewer's condition.
  assert.equal(compact.includes('for(constfieldof["orgId","serverId"])if((after[field]||"")!==next[field])'), true, "and every identifier compared against what was intended");
  // And nothing is orphaned when any of it fails. Same rule as the provisioning tool's, for the same
  // reason: the replacement can hold the credential and the private keys, and a random name means a
  // leaked one is never reused, collided with, or listed.
  assert.equal(compact.includes("if(!installed){try{fs.rmSync(pending,{force:true})"), true, "the replacement is removed on any failure after the open");
});
