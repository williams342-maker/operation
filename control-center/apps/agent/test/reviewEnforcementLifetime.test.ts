import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fixtureForgeSecurity } from "./fixtureForgeSecurity.js";

process.env.NODE_ENV = "test";
const home = fs.mkdtempSync(path.join(os.tmpdir(), "enforcement-lifetime-"));
process.env.CONTROL_CENTER_AGENT_CONFIG = path.join(home, "agent.json");
const security = await fixtureForgeSecurity({ orgId: "org-bound", serverId: "server-bound" });
const { agentConfigSchema } = await import("../src/config.js");
const { writeEnforcement } = await import("../src/reviewEnforcement.js");
const { reviewEnforcement } = await import("../src/agent.js");
writeEnforcement(path.join(home, "agent-state"), { state: "ENFORCING", by: "fixture", reason: "identity lifetime" });

const config = (url: string) => agentConfigSchema.parse({
  controlCenterUrl: "https://cc.test", agentId: "fixture-agent", agentSecret: "fixture-secret",
  orgId: "org-bound", serverId: "server-bound", reviewGate: { url, credential: "fixture-executor" },
});

test("every enforced invocation propagates later identity expiry for HTTPS and loopback", () => {
  for (const url of ["https://gate.test", "HTTPS://gate.test", "http://127.0.0.1:9"]) {
    security.refuse();
    const before = security.reads;
    assert.equal(reviewEnforcement(config(url)).enforcing, true);
    assert.equal(security.reads, before + 1);
    const expiry = new Error("Forge security identity is not currently valid");
    security.refuse(expiry);
    assert.throws(() => reviewEnforcement(config(url)), (error) => error === expiry);
    assert.equal(security.reads, before + 2);
  }
  security.refuse();
});

test("an enforced loopback invocation refuses runtime target drift after a successful check", () => {
  const enrolled = config("http://127.0.0.1:9");
  assert.equal(reviewEnforcement(enrolled).enforcing, true);
  for (const changed of [{ orgId: "other-org" }, { serverId: "other-server" }]) {
    assert.throws(() => reviewEnforcement({ ...enrolled, ...changed }), /does not match this enrolled agent runtime/);
  }
});
