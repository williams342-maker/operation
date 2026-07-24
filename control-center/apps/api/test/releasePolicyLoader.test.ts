import assert from "node:assert/strict";
import test from "node:test";
import { loadStagingReleasePolicy } from "../src/releasePolicyLoader.js";

test("staging burn-in loads thresholds from the version-controlled policy", () => {
  const policy = loadStagingReleasePolicy();
  assert.equal(policy.policyId, "Staging-BurnIn");
  assert.equal(policy.stagingProfile.name, "Staging-BurnIn-v1");
  assert.equal(policy.monitoring.availabilityPercentMinimum, 99.9);
  assert.equal(policy.monitoring.p95LatencyMsMaximum, 500);
  assert.equal(policy.observation.minimumHours, 24);
  assert.equal(policy.authority.find((entry) => entry.stage === "production_publication")?.autonomous, false);
});
