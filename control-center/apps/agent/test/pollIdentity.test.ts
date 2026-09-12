import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { mock } from "node:test";
import type { AgentConfig } from "../src/config.js";

// THE CONTROL PLANE GETS NO SAY IN WHO THIS RUNTIME IS.
//
// A first version of the organisation fix let the poll response fill a missing id, and security review
// required that path removed rather than merely unreachable — unreachable is a property of today's call
// order, and a refactor can change that without anyone noticing a trust boundary moved. This drives the
// REAL `pollOnce` against a control plane that answers with both identifiers, and a hostile pair at that.
//
// The client is replaced before the agent module loads, which is the only moment it can be.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "agent-poll-identity-"));
const configFile = path.join(scratch, "agent.local.json");
const enrolled = { controlCenterUrl: "https://control.test", agentId: "agent-1", agentSecret: "s".repeat(32) };
fs.writeFileSync(configFile, JSON.stringify(enrolled));
process.env.CONTROL_CENTER_AGENT_CONFIG = configFile;
process.env.NODE_ENV = "test";

const answered: unknown[] = [];
mock.module(new URL("../src/client.ts", import.meta.url).href, {
  namedExports: {
    machineAccessHeaders: () => ({}),
    enroll: async () => { throw new Error("this test never enrols"); },
    signedPost: async (_config: AgentConfig, endpoint: string) => {
      answered.push(endpoint);
      return { orgId: "9".repeat(24), serverId: "8".repeat(24), tasks: [] };
    },
  },
});

const { pollOnce } = await import("../src/agent.js");

test("a poll response cannot establish either Forge trust identifier", async () => {
  const before = fs.readFileSync(configFile, "utf8");
  const config = {
    ...enrolled, orgId: "", serverId: "", installationId: "", requestedSlug: "",
    keyProtocolVersion: "agent-v1", agentVersion: "0.1.0", protocolVersion: "task-v1",
    packageType: "tar", releaseChannel: "stable", allowedRoots: [], pollIntervalSeconds: 30, mongoChecks: {},
  } as unknown as AgentConfig;

  await pollOnce(config);

  assert.ok(answered.includes("/api/agent/poll"), "the poll really happened, so the answer really was available to be believed");
  assert.equal(config.orgId, "", "and it established no organisation");
  assert.equal(config.serverId, "", "nor a server");
  assert.equal(fs.readFileSync(configFile, "utf8"), before, "and wrote nothing to the configuration file");
});

test("a poll response cannot replace an identifier the runtime already has", async () => {
  const org = "6a5dab47776e3028ac9b604b";
  const server = "6a5f685ff8195a8813879bd7";
  const before = fs.readFileSync(configFile, "utf8");
  const config = {
    ...enrolled, orgId: org, serverId: server, installationId: "", requestedSlug: "",
    keyProtocolVersion: "agent-v1", agentVersion: "0.1.0", protocolVersion: "task-v1",
    packageType: "tar", releaseChannel: "stable", allowedRoots: [], pollIntervalSeconds: 30, mongoChecks: {},
  } as unknown as AgentConfig;

  await pollOnce(config);

  assert.equal(config.orgId, org, "the established organisation is untouched");
  assert.equal(config.serverId, server);
  assert.equal(fs.readFileSync(configFile, "utf8"), before);
});
