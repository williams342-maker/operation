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
const { adoptRuntimeIdentity, establishRuntimeIdentity, learnRuntimeIdentity, validateForgeRuntimeIdentity } = await import("../src/agent.js");

// WHY THIS FILE EXISTS. `validateForgeRuntimeIdentity` compares an owner-signed identity against
// `config.orgId` — and nothing ever wrote that value. The poll response carried a server id and nothing
// else, so on every host the field sat at its empty default and the check could not pass, however
// correct the signed material was. The agent now learns both ids the same way, and says so precisely
// when it has not been told.

const baseConfig = { controlCenterUrl: "https://control.test", agentId: "agent-1", agentSecret: "s".repeat(32), orgId: "", serverId: "" } as unknown as AgentConfig;
const org = "6a5dab47776e3028ac9b604b";
const server = "6a5f685ff8195a8813879bd7";

test("the runtime learns both ids when it has neither, and reports that it did", () => {
  const config = { ...baseConfig };
  assert.equal(learnRuntimeIdentity(config, { orgId: org, serverId: server }), true);
  assert.equal(config.orgId, org);
  assert.equal(config.serverId, server);
});

test("what the runtime already knows is never replaced by what the network says", () => {
  // These two values decide WHICH owner-signed identity this runtime will accept. A control plane that
  // could replace them could choose that for it, so an operator's configuration wins over any answer.
  const config = { ...baseConfig, orgId: org, serverId: server };
  assert.equal(learnRuntimeIdentity(config, { orgId: "0".repeat(24), serverId: "1".repeat(24) }), false, "nothing to learn, so nothing is written");
  assert.equal(config.orgId, org);
  assert.equal(config.serverId, server);

  // And one known, one not: only the missing half moves.
  const half = { ...baseConfig, serverId: server };
  assert.equal(learnRuntimeIdentity(half, { orgId: org, serverId: "1".repeat(24) }), true);
  assert.equal(half.orgId, org, "the missing one is learned");
  assert.equal(half.serverId, server, "the known one is left alone");
});

test("a response that says nothing changes nothing", () => {
  const config = { ...baseConfig };
  assert.equal(learnRuntimeIdentity(config, {}), false);
  assert.equal(learnRuntimeIdentity(config, { orgId: "", serverId: "" }), false, "an empty answer is not an answer");
  assert.equal(config.orgId, "");
});

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
