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
fs.writeFileSync(configFile, JSON.stringify({ controlCenterUrl: "https://control.test", agentId: "agent-1", agentSecret: "s".repeat(32) }), { mode: 0o600 });
process.env.CONTROL_CENTER_AGENT_CONFIG = configFile;
process.env.NODE_ENV = "test";
const { validateForgeRuntimeIdentity } = await import("../src/agent.js");
const { loadConfig, saveConfig } = await import("../src/config.js");

// WHY THIS FILE EXISTS. `validateForgeRuntimeIdentity` compares an owner-signed identity against
// `config.orgId` — and nothing ever wrote that value. The poll response carried a server id and nothing
// else, so on every host the field sat at its empty default and the check could not pass, however
// correct the signed material was. The agent now learns both ids the same way, and says so precisely
// when it has not been told.

const baseConfig = { controlCenterUrl: "https://control.test", agentId: "agent-1", agentSecret: "s".repeat(32), orgId: "", serverId: "" } as unknown as AgentConfig;
const org = "6a5dab47776e3028ac9b604b";
const server = "6a5f685ff8195a8813879bd7";




test("a runtime with no organisation provisioned fails closed", () => {
  // Absent and empty are the same posture and a different message from a mismatch: at the ceremony one
  // means "provision this host" and the other means "you have the wrong document".
  const identity = { orgId: org, serverId: server };
  const load = (() => ({ identity })) as unknown as Parameters<typeof validateForgeRuntimeIdentity>[1];

  const absent = { ...baseConfig, serverId: server } as AgentConfig;
  delete (absent as { orgId?: string }).orgId;
  assert.throws(() => validateForgeRuntimeIdentity(absent, load), /no organisation or server id configured/);
  assert.throws(() => validateForgeRuntimeIdentity({ ...baseConfig, orgId: "", serverId: server }, load), /no organisation or server id configured/);
  assert.throws(() => validateForgeRuntimeIdentity({ ...baseConfig, orgId: org, serverId: "" }, load), /no organisation or server id configured/);
});

test("a wrong organisation refuses the identity, and so does a wrong server", () => {
  const identity = { orgId: org, serverId: server };
  const load = (() => ({ identity })) as unknown as Parameters<typeof validateForgeRuntimeIdentity>[1];

  assert.throws(() => validateForgeRuntimeIdentity({ ...baseConfig, orgId: "9".repeat(24), serverId: server }, load), /does not match this enrolled agent runtime/);
  // The enrolment residual, kept deliberately: a server id the control plane got wrong at enrolment
  // causes a REFUSAL, never a substitution and never an acceptance. That is denial of service, not a
  // trust bypass, and the distinction is the reason this test exists rather than a repair.
  assert.throws(() => validateForgeRuntimeIdentity({ ...baseConfig, orgId: org, serverId: "9".repeat(24) }, load), /does not match this enrolled agent runtime/);
});

test("independently provisioned ids let verification advance", () => {
  const identity = { orgId: org, serverId: server };
  const material = { identity } as unknown as ReturnType<typeof validateForgeRuntimeIdentity>;
  const load = (() => material) as unknown as Parameters<typeof validateForgeRuntimeIdentity>[1];
  assert.equal(validateForgeRuntimeIdentity({ ...baseConfig, orgId: org, serverId: server }, load), material);
});

test("the signed identity cannot write either identifier, in any direction", () => {
  // The repair this replaces did exactly that: it adopted missing ids FROM the document being validated,
  // which let the document decide the value it was then matched against.
  const config = { ...baseConfig, orgId: org, serverId: server };
  const other = { identity: { orgId: "9".repeat(24), serverId: "8".repeat(24) } } as unknown as ReturnType<typeof validateForgeRuntimeIdentity>;
  assert.throws(() => validateForgeRuntimeIdentity(config, (() => other) as never));
  assert.equal(config.orgId, org, "a refused document changed nothing");
  assert.equal(config.serverId, server);

  const empty = { ...baseConfig, serverId: server };
  assert.throws(() => validateForgeRuntimeIdentity(empty, (() => ({ identity: { orgId: org, serverId: server } })) as never));
  assert.equal(empty.orgId, "", "and an accepted-looking document does not fill a missing value either");

  const source = fs.readFileSync(new URL("../src/agent.ts", import.meta.url), "utf8");
  assert.equal(/config\.orgId\s*=/.test(source), false, "nothing in the agent assigns the organisation");
  assert.equal(/config\.serverId\s*=\s*(?!config)/.test(source), false, "nor the server, outside enrolment");
  assert.equal(source.includes("adoptRuntimeIdentity"), false, "the adoption helper is gone, not merely unused");
});
