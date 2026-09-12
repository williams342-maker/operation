import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { mock } from "node:test";

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
    signedPost: async (_config: unknown, endpoint: string) => {
      answered.push(endpoint);
      return { orgId: "9".repeat(24), serverId: "8".repeat(24), tasks: [] };
    },
  },
});

const { pollOnce } = await import("../src/agent.js");

test("a poll response cannot establish either Forge trust identifier", async () => {
  // `pollOnce` loads its own configuration from the file this test points it at, so the file IS the
  // subject: if a response could establish an identity, this is where it would land.
  fs.writeFileSync(configFile, JSON.stringify(enrolled));
  const before = fs.readFileSync(configFile, "utf8");

  await pollOnce();

  assert.ok(answered.includes("/api/agent/poll"), "the poll really happened, so the answer really was there to be believed");
  const after = JSON.parse(fs.readFileSync(configFile, "utf8"));
  assert.equal(after.orgId, undefined, "no organisation was established");
  assert.equal(after.serverId, undefined, "nor a server");
  assert.equal(fs.readFileSync(configFile, "utf8"), before, "the configuration file is untouched");
});

test("a poll response cannot replace an identifier the runtime already has", async () => {
  const org = "6a5dab47776e3028ac9b604b";
  const server = "6a5f685ff8195a8813879bd7";
  fs.writeFileSync(configFile, JSON.stringify({ ...enrolled, orgId: org, serverId: server }));
  const before = fs.readFileSync(configFile, "utf8");

  await pollOnce();

  const after = JSON.parse(fs.readFileSync(configFile, "utf8"));
  assert.equal(after.orgId, org, "the established organisation is untouched, whatever the answer said");
  assert.equal(after.serverId, server);
  assert.equal(fs.readFileSync(configFile, "utf8"), before);
});
