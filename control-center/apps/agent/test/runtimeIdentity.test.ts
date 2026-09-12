import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { AgentConfig } from "../src/config.js";

// The agent module reads its configuration and starts polling at import time, so both are pointed
// somewhere harmless BEFORE it is loaded. A static import would run the real thing against this machine.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "agent-identity-"));
const configFile = path.join(scratch, "agent.local.json");
fs.writeFileSync(configFile, JSON.stringify({ controlCenterUrl: "https://control.test", agentId: "agent-1", agentSecret: "s".repeat(32) }));
process.env.CONTROL_CENTER_AGENT_CONFIG = configFile;
process.env.NODE_ENV = "test";
const { adoptRuntimeIdentity, establishRuntimeIdentity, startupIdentity, validateForgeRuntimeIdentity } = await import("../src/agent.js");
const { loadConfig, saveConfig } = await import("../src/config.js");

// WHY THIS FILE EXISTS. `validateForgeRuntimeIdentity` compares an owner-signed identity against
// `config.orgId` — and nothing ever wrote that value. The poll response carried a server id and nothing
// else, so on every host the field sat at its empty default and the check could not pass, however
// correct the signed material was. The agent now learns both ids the same way, and says so precisely
// when it has not been told.

const baseConfig = { controlCenterUrl: "https://control.test", agentId: "agent-1", agentSecret: "s".repeat(32), orgId: "", serverId: "" } as unknown as AgentConfig;
const org = "6a5dab47776e3028ac9b604b";
const server = "6a5f685ff8195a8813879bd7";




test("a runtime that was never told who it is says exactly that", () => {
  // The distinction matters at one moment: the owner's signing ceremony. "Does not match" sends an
  // operator hunting for a wrong document when what is missing is a line of configuration.
  const identity = { orgId: org, serverId: server };
  const load = (() => ({ identity })) as unknown as Parameters<typeof validateForgeRuntimeIdentity>[1];

  assert.throws(() => validateForgeRuntimeIdentity({ ...baseConfig, serverId: server }, load), /no organisation or server id configured/);
  assert.throws(() => validateForgeRuntimeIdentity({ ...baseConfig, orgId: org }, load), /no organisation or server id configured/);
});

test("a configured runtime still refuses an identity issued to someone else", () => {
  const identity = { orgId: org, serverId: server };
  const load = (() => ({ identity })) as unknown as Parameters<typeof validateForgeRuntimeIdentity>[1];

  assert.throws(() => validateForgeRuntimeIdentity({ ...baseConfig, orgId: "9".repeat(24), serverId: server }, load), /does not match this enrolled agent runtime/);
  assert.throws(() => validateForgeRuntimeIdentity({ ...baseConfig, orgId: org, serverId: "9".repeat(24) }, load), /does not match this enrolled agent runtime/);
  assert.deepEqual(validateForgeRuntimeIdentity({ ...baseConfig, orgId: org, serverId: server }, load), { identity }, "and accepts the one that names it");
});

// --- Startup, which is where the deadlock was ------------------------------------------------------
//
// The first version of this fix taught the POLL to learn the organisation id. Review found that the
// identity check runs at startup, before any poll, so a runtime with no organisation id exits before it
// can ever reach the network that would tell it. The owner-signed identity is the only source available
// at that moment, and it is the right one: its signature, this host's name, its machine id and a
// validity window are all verified before it is handed over.

const identity = { orgId: org, serverId: server };
const material = { identity } as unknown as ReturnType<typeof validateForgeRuntimeIdentity>;

test("a runtime that was never told who it is adopts the owner-signed answer and starts", () => {
  const config = { ...baseConfig };
  const persisted: AgentConfig[] = [];
  const security = establishRuntimeIdentity(config, () => material, (saved) => { persisted.push(saved); });
  assert.equal(security, material, "the material is still returned to the caller");
  assert.equal(config.orgId, org);
  assert.equal(config.serverId, server);
  assert.equal(persisted.length, 1, "and the answer is written down, so it survives a restart");
  // The check that used to refuse now passes, which is the whole point.
  assert.doesNotThrow(() => validateForgeRuntimeIdentity(config, () => material));
});

test("a runtime that already knows adopts nothing and writes nothing", () => {
  const config = { ...baseConfig, orgId: org, serverId: server };
  const persisted: AgentConfig[] = [];
  establishRuntimeIdentity(config, () => material, (saved) => { persisted.push(saved); });
  assert.equal(persisted.length, 0, "there is nothing to learn, so the file is left alone");
});

test("an identity naming someone else is refused, and nothing is adopted from it", () => {
  // Adoption must never be a way around the mismatch: a configured runtime keeps refusing.
  const config = { ...baseConfig, orgId: "9".repeat(24) };
  const persisted: AgentConfig[] = [];
  assert.throws(() => establishRuntimeIdentity(config, () => material, (saved) => { persisted.push(saved); }), /does not match this enrolled agent runtime/);
  assert.equal(config.orgId, "9".repeat(24), "the configured value is untouched");
  assert.equal(config.serverId, "", "and nothing was adopted from a document that was refused");
  assert.equal(persisted.length, 0);

  const halfWrong = { ...baseConfig, orgId: org, serverId: "9".repeat(24) };
  assert.throws(() => adoptRuntimeIdentity(halfWrong, identity), /does not match/);
});

test("adoption fills only what is missing", () => {
  const knowsServer = { ...baseConfig, serverId: server };
  assert.equal(adoptRuntimeIdentity(knowsServer, identity), true);
  assert.equal(knowsServer.orgId, org);
  assert.equal(adoptRuntimeIdentity({ ...baseConfig, orgId: org, serverId: server }, identity), false, "nothing missing, nothing adopted");
});

test("startup establishes before it checks, which is the whole fix", () => {
  // Checking first refuses a runtime that has never been told its organisation, and it refuses before
  // the first poll, so that host can never reach anything that would tell it. This is the sequence
  // `main` delegates to; reversing the two calls inside it puts the deadlock straight back.
  const config = { ...baseConfig };
  const persisted: AgentConfig[] = [];
  const security = startupIdentity(config, () => material, (saved) => { persisted.push(saved); });
  assert.equal(security, material);
  assert.equal(config.orgId, org, "the runtime now knows who it is");
  assert.equal(persisted.length, 1);

  // And a document for another runtime is still refused by the same sequence.
  const stranger = { identity: { orgId: "9".repeat(24), serverId: "9".repeat(24) } } as unknown as typeof material;
  assert.throws(() => startupIdentity({ ...baseConfig, orgId: org, serverId: server }, () => stranger, () => {}), /does not match this enrolled agent runtime/);
});

test("a refused document leaves both halves of the configuration exactly as they were", () => {
  // Asymmetric on purpose. Adopting the missing half before checking the conflicting one would take the
  // organisation from a document that is about to be refused, and the earlier test could not see it
  // because its conflict was in the half that was already set.
  const emptyOrgWrongServer = { ...baseConfig, serverId: "9".repeat(24) };
  assert.throws(() => adoptRuntimeIdentity(emptyOrgWrongServer, identity), /does not match/);
  assert.equal(emptyOrgWrongServer.orgId, "", "nothing is adopted from a document that is refused");
  assert.equal(emptyOrgWrongServer.serverId, "9".repeat(24));

  const emptyServerWrongOrg = { ...baseConfig, orgId: "9".repeat(24) };
  assert.throws(() => adoptRuntimeIdentity(emptyServerWrongOrg, identity), /does not match/);
  assert.equal(emptyServerWrongOrg.serverId, "");
  assert.equal(emptyServerWrongOrg.orgId, "9".repeat(24));
});

test("the configuration file survives a write that fails half way", (t) => {
  // It holds the enrolment credential. Truncating in place meant a full disk left invalid JSON and the
  // next start failed in loadConfig, losing the credential along with the ids being saved.
  const before = fs.readFileSync(configFile, "utf8");
  const real = fs.writeFileSync;
  // HALF WAY, literally: some bytes reach the sibling before the failure, which is the shape of a full
  // disk. Throwing before writing anything would have tested a cheaper case than the one that bites.
  t.mock.method(fs, "writeFileSync", (target: unknown, body: unknown, options?: unknown) => {
    if (typeof target === "number") {
      (real as (a: unknown, b: unknown, c?: unknown) => void)(target, String(body).slice(0, 37), options);
      throw Object.assign(new Error("no space left on device"), { code: "ENOSPC" });
    }
    return (real as (a: unknown, b: unknown, c?: unknown) => void)(target, body, options);
  });
  assert.throws(() => saveConfig({ ...loadConfig(), orgId: org, serverId: server }), /no space left on device/);
  t.mock.restoreAll();
  assert.equal(fs.readFileSync(configFile, "utf8"), before, "the old configuration is still there, whole");
  assert.doesNotThrow(() => loadConfig(), "and still readable");
  assert.deepEqual(fs.readdirSync(path.dirname(configFile)).filter((name) => name.includes(".pending-")), [], "and no half-written sibling is left behind");
});

// --- The control plane is not allowed a say ---------------------------------------------------------
//
// A first version of the organisation fix let the poll response fill a missing id. Security review
// required that path removed rather than merely unreachable: unreachable is a property of today's call
// order, and a refactor can change that without anyone noticing it changed a trust boundary.


test("the agent source contains no path from a response to either identifier", () => {
  // A behavioural test can only cover the call sites that exist today. This one covers the requirement
  // itself: that no such assignment is reachable from a response object at all.
  const source = fs.readFileSync(new URL("../src/agent.ts", import.meta.url), "utf8");
  assert.equal(/config\.orgId\s*=\s*response/.test(source), false, "no response may assign the organisation");
  assert.equal(/config\.serverId\s*=\s*response/.test(source), false, "nor the server");
  assert.equal(source.includes("learnRuntimeIdentity"), false, "the helper that did this is gone, not merely unused");
});
