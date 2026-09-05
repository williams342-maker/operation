import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { generateAgentKeyPairs } from "@control-center/shared";

// WHERE THE FORGE SECURITY MATERIAL IS REQUIRED, and where it is not.
//
// `reviewEnforcement()` loads root-owned material from a fixed path to obtain the owner-bound Review Gate
// CA. That CA authenticates an HTTPS gate. The gate URL schema permits `http:` only for loopback, where
// there is no TLS to bind — so the material is required for an HTTPS gate and not for a loopback one.
//
// This file exists because the production shape is the one that must not regress. An earlier defect in
// this subsystem survived precisely because every fixture exercised a convenient configuration and never
// the one production uses, so the two cases are asserted together, in one file, deliberately.
//
// The process's identity is established BEFORE the agent module loads: `configPath` is a module constant
// resolved once at import, and `stateDir()` derives from it. Setting the environment after the import
// would change nothing, which is why the dynamic import below is load-bearing rather than stylistic.
process.env.NODE_ENV = "test";
const PROCESS_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "forge-ca-home-"));
process.env.CONTROL_CENTER_AGENT_CONFIG = path.join(PROCESS_HOME, "agent.json");
const PROCESS_STATE_DIR = path.join(PROCESS_HOME, "agent-state");

// EVERY agent-module import here is dynamic, and that is not style. A static `import` is hoisted above
// the assignments above it, so `config.js` would resolve `configPath` from the ambient environment before
// this file had set it — and the tests would then read a state directory belonging to some other agent.
// The first draft of this file did exactly that and reported "not enforcing" for both cases.
const { agentConfigSchema } = await import("../src/config.js");
const { writeEnforcement } = await import("../src/reviewEnforcement.js");
const { reviewEnforcement } = await import("../src/agent.js");

const cp = generateAgentKeyPairs();
const owner = generateAgentKeyPairs();
const configFor = (gateUrl: string) => agentConfigSchema.parse({
  controlCenterUrl: "https://cc.test", agentId: "agent-1", agentSecret: "unused-legacy-secret",
  keyProtocolVersion: "agent-v2", controlPlanePublicKey: cp.signingPublicKey, ownerPublicKey: owner.signingPublicKey,
  // Deliberately not any real enrolled target: on a host that HAS the material provisioned this makes the
  // HTTPS case below fail the identity binding rather than silently passing.
  orgId: "org-unenrolled", serverId: "server-unenrolled",
  reviewGate: { url: gateUrl, credential: "executor-only", timeoutMs: 1000 },
});

const enforcing = () => {
  fs.rmSync(PROCESS_STATE_DIR, { recursive: true, force: true });
  writeEnforcement(PROCESS_STATE_DIR, { state: "ENFORCING", by: "owner", reason: "forge ca scope" });
};

test("PRODUCTION SHAPE: an HTTPS gate still requires the Forge security material", () => {
  enforcing();
  // ASSERTING *WHY* IT THROWS, not merely that it does. `ReviewGateClient` independently refuses an HTTPS
  // gate with no CA, so a bare `assert.throws` passes even if this function stops loading the material
  // altogether — mutation-tested, and the first version of this test did exactly that.
  //
  // The message differs by host and both are correct: unprovisioned it cannot read the fixed path,
  // provisioned it refuses an identity bound to a different enrolled target. What identifies the WRONG
  // refusal is the client's own message, so that is what is excluded.
  assert.throws(() => reviewEnforcement(configFor("https://gate.test")), (error: Error) => {
    assert.doesNotMatch(error.message, /requires its owner-bound CA/,
      "must refuse while loading the security material, not later at the client");
    return true;
  });
});

test("a LOOPBACK HTTP gate does not require it, because there is no TLS for the CA to bind", () => {
  enforcing();
  const enforcement = reviewEnforcement(configFor("http://127.0.0.1:9"));
  assert.equal(enforcement.enforcing, true);
});

test("a non-enforcing executor loads nothing at all", () => {
  fs.rmSync(PROCESS_STATE_DIR, { recursive: true, force: true });
  writeEnforcement(PROCESS_STATE_DIR, { state: "DISABLED", by: "owner", reason: "off" });
  // Guards the ordering: the enforcement decision comes first, so a DISABLED executor never touches the
  // fixed security path even when its gate is HTTPS.
  assert.deepEqual(reviewEnforcement(configFor("https://gate.test")), { enforcing: false });
});
