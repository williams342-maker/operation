import assert from "node:assert/strict";
import test from "node:test";
import { shouldEnroll } from "../src/enrollmentDecision.js";
import type { AgentConfig } from "../src/config.js";

const enrolledConfig: AgentConfig = {
  controlCenterUrl: "https://opsworkbench.org",
  installationId: "install-test",
  requestedSlug: "craftersmarketbeta",
  serverId: "old-server",
  agentId: "old-agent",
  agentSecret: "old-secret",
  agentVersion: "0.1.0",
  protocolVersion: "task-v1",
  packageType: "tar",
  releaseChannel: "stable",
  allowedRoots: ["/srv"],
  pollIntervalSeconds: 30,
  mongoChecks: {}
};

test("agent keeps existing credentials when no enrollment token is present", () => {
  assert.equal(shouldEnroll(enrolledConfig, undefined, undefined), false);
});

test("agent does not re-enroll existing credentials without an explicit force flag", () => {
  assert.equal(shouldEnroll(enrolledConfig, "owenr_test-token", undefined), false);
});

test("bootstrap can force re-enrollment over stale local credentials", () => {
  assert.equal(shouldEnroll(enrolledConfig, "owenr_test-token", "1"), true);
  assert.equal(shouldEnroll(enrolledConfig, "owenr_test-token", "true"), true);
  assert.equal(shouldEnroll(enrolledConfig, "owenr_test-token", "yes"), true);
});

test("fresh installs still enroll when credentials are absent", () => {
  assert.equal(shouldEnroll({ ...enrolledConfig, agentId: "", agentSecret: "" }, "owenr_test-token", undefined), true);
});
