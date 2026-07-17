import test from "node:test";
import assert from "node:assert/strict";
import { isHeartbeatStale } from "../src/telemetry.js";

test("heartbeat freshness marks stale servers offline after threshold", () => {
  const now = new Date("2026-07-17T12:00:00Z");
  assert.equal(isHeartbeatStale(new Date("2026-07-17T11:59:00Z"), now, 90), false);
  assert.equal(isHeartbeatStale(new Date("2026-07-17T11:58:00Z"), now, 90), true);
});
