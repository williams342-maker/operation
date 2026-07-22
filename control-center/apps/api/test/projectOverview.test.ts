import assert from "node:assert/strict";
import test from "node:test";
import { evidenceFreshness } from "../src/projectOverview.js";

const now = new Date("2026-07-21T20:00:00.000Z");
test("project overview freshness follows authoritative agent status bands", () => {
  assert.equal(evidenceFreshness(undefined, now), "unavailable");
  assert.equal(evidenceFreshness("2026-07-21T19:59:00.000Z", now), "fresh");
  assert.equal(evidenceFreshness("2026-07-21T19:57:00.000Z", now), "delayed");
  assert.equal(evidenceFreshness("2026-07-21T19:50:00.000Z", now), "stale");
});
