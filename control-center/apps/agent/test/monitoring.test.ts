import assert from "node:assert/strict";
import test from "node:test";
import { isExpectedHttpStatus } from "../src/inspectors.js";
import { dueHttpMonitoringChecks, resetHttpMonitoringSchedule } from "../src/monitoring.js";

const check = {
  id: "507f1f77bcf86cd799439011",
  url: "https://example.test/health",
  timeoutMs: 1000,
  expectedStatus: 200,
  intervalSeconds: 60
};

test("HTTP monitoring runs immediately and then observes the configured interval", () => {
  resetHttpMonitoringSchedule();
  assert.deepEqual(dueHttpMonitoringChecks([check], 1_000), [check]);
  assert.deepEqual(dueHttpMonitoringChecks([check], 60_999), []);
  assert.deepEqual(dueHttpMonitoringChecks([check], 61_000), [check]);
});

test("HTTP monitoring runs changed targets immediately and removes stale schedule state", () => {
  resetHttpMonitoringSchedule();
  dueHttpMonitoringChecks([check], 1_000);
  const changed = { ...check, expectedStatus: 204 };
  assert.deepEqual(dueHttpMonitoringChecks([changed], 2_000), [changed]);
  assert.deepEqual(dueHttpMonitoringChecks([], 3_000), []);
  assert.deepEqual(dueHttpMonitoringChecks([check], 4_000), [check]);
});

test("HTTP monitoring honors an explicit expected status", () => {
  assert.equal(isExpectedHttpStatus(204, 204), true);
  assert.equal(isExpectedHttpStatus(200, 204), false);
  assert.equal(isExpectedHttpStatus(204), true);
  assert.equal(isExpectedHttpStatus(302), false);
});
