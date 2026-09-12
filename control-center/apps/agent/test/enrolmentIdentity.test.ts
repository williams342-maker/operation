import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { mock } from "node:test";

// ENROLMENT IS THE ONE CONTROL-PLANE INTERACTION THE REPAIR LEAVES IN PLACE, so it is the one that has to
// be held to account here. A review pointed out that the guard and the merge were both untested: removing
// the mismatch check and writing `serverId: result.serverId` straight through left every runtime-identity
// and poll-identity test green. These tests drive the real `maybeEnroll` against a control plane that
// answers with whatever the case needs.
//
// The client is replaced before the agent module loads, which is the only moment it can be.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "agent-enrolment-"));
const configFile = path.join(scratch, "agent.local.json");
const org = "6a5dab47776e3028ac9b604b";
const server = "6a5f685ff8195a8813879bd7";
const other = "7c11ee0912a4bb6650341f88";

process.env.CONTROL_CENTER_AGENT_CONFIG = configFile;
process.env.NODE_ENV = "test";
process.env.CONTROL_CENTER_ENROLLMENT_TOKEN = "enrolment-token";

// What the control plane answers, and what it does on its way to answering. `duringTheCall` is how the
// lost-update case is staged: the operator provisions while this request is in flight.
let answer: { serverId: string; agentId: string; agentSecret: string; pollIntervalSeconds: number };
let duringTheCall: () => void = () => {};

mock.module(new URL("../src/client.ts", import.meta.url).href, {
  namedExports: {
    machineAccessHeaders: () => ({}),
    signedPost: async () => { throw new Error("this test never polls"); },
    enroll: async () => { duringTheCall(); return answer; },
  },
});

const { maybeEnroll } = await import("../src/agent.js");

function unenrolled(overrides: Record<string, unknown> = {}) {
  fs.writeFileSync(configFile, `${JSON.stringify({ controlCenterUrl: "https://control.test", agentId: "", agentSecret: "", ...overrides }, null, 2)}\n`, { mode: 0o600 });
  answer = { serverId: server, agentId: "agent-1", agentSecret: "s".repeat(32), pollIntervalSeconds: 30 };
  duringTheCall = () => {};
}

test("enrolment establishes a server id on a runtime that has never had one", async () => {
  unenrolled();
  const enrolled = await maybeEnroll();
  assert.equal(enrolled.serverId, server);
  assert.equal(JSON.parse(fs.readFileSync(configFile, "utf8")).serverId, server, "and it is written down, because a restart has to see it");
});

test("enrolment refuses a server id that differs from the one already written down", async () => {
  // This is the whole guard. Remove it, or write `serverId: result.serverId` straight through, and a
  // control plane repoints this runtime at another server without anybody being told.
  unenrolled({ serverId: server });
  answer = { ...answer, serverId: other };
  await assert.rejects(() => maybeEnroll(), /refusing to change it/);
  const after = JSON.parse(fs.readFileSync(configFile, "utf8"));
  assert.equal(after.serverId, server, "the established server id is still there");
  assert.equal(after.agentId, "", "and nothing was saved, so the refusal is not half an enrolment");
});

test("enrolment keeps a matching server id rather than rewriting it", async () => {
  unenrolled({ serverId: server });
  const enrolled = await maybeEnroll();
  assert.equal(enrolled.serverId, server);
  assert.equal(enrolled.agentId, "agent-1", "the credential half of enrolment still lands");
});

test("an organisation provisioned during the request survives the response", async () => {
  // THE LOST UPDATE. Enrolment used to read the configuration, await the network, and save the snapshot
  // it had read. A review provisioned an organisation inside that await and watched the response put the
  // old empty value back — so a control plane choosing WHEN to answer chooses whether provisioning
  // survives, and an agent whose organisation is empty refuses to start.
  unenrolled();
  duringTheCall = () => {
    const current = JSON.parse(fs.readFileSync(configFile, "utf8"));
    fs.writeFileSync(configFile, `${JSON.stringify({ ...current, orgId: org }, null, 2)}\n`, { mode: 0o600 });
  };

  const enrolled = await maybeEnroll();

  assert.equal(enrolled.orgId, org, "the returned configuration carries what is on disk, not what was read before the await");
  const after = JSON.parse(fs.readFileSync(configFile, "utf8"));
  assert.equal(after.orgId, org, "and the provisioning was not written back over");
  assert.equal(after.agentId, "agent-1", "while enrolment still did its own job");
});

test("enrolment will not write its configuration underneath a provisioning", async () => {
  unenrolled();
  const lock = `${configFile}.provisioning-lock`;
  fs.writeFileSync(lock, "held by the provisioning tool", { flag: "wx" });
  try {
    await assert.rejects(() => maybeEnroll(), /in progress/);
    assert.equal(JSON.parse(fs.readFileSync(configFile, "utf8")).agentId, "", "nothing was saved");
  } finally {
    fs.rmSync(lock, { force: true });
  }
  // And with the lock released the same call works, so the refusal was the lock and not something else.
  assert.equal((await maybeEnroll()).agentId, "agent-1");
  assert.equal(fs.existsSync(lock), false, "the lock is released on the way out");
});

test("an established server id survives a response that carries none", async () => {
  // A review mutated `config.serverId || result.serverId` down to `result.serverId` alone and every test
  // still passed, because in each of them the two values agreed or the runtime had none. This is the case
  // that separates them: the runtime knows who it is, the answer does not say, and the answer must not
  // erase it. An empty server id fails the Forge comparison closed, so this is an availability hole as
  // well as a rule broken.
  unenrolled({ serverId: server });
  answer = { ...answer, serverId: "" };

  const enrolled = await maybeEnroll();

  assert.equal(enrolled.serverId, server, "the established server id is preserved, not overwritten with nothing");
  assert.equal(JSON.parse(fs.readFileSync(configFile, "utf8")).serverId, server);
});
