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
const { learnRuntimeIdentity, validateForgeRuntimeIdentity } = await import("../src/agent.js");

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
