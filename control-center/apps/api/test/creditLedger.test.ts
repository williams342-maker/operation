import assert from "node:assert/strict";
import test from "node:test";
import { checkedCredits, estimatePrice, microsToCredits, periodBounds } from "../src/creditLedger.js";

test("credit conversion uses integer micros and always rounds provider cost up", () => {
  assert.equal(microsToCredits(0), 0); assert.equal(microsToCredits(1), 1); assert.equal(microsToCredits(1_001), 2);
  assert.deepEqual(estimatePrice(1_000, 2_000, { inputCostMicrosPerMillion: 1_000_000, outputCostMicrosPerMillion: 2_000_000 }), { estimatedCostMicros: 5_000, estimatedCredits: 5 });
});
test("negative, fractional, and overflowing credit values are rejected", () => {
  for (const value of [-1, 1.2, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => checkedCredits(value));
});
test("organization timezone determines daily boundaries", () => {
  const winter = periodBounds(new Date("2026-01-15T20:00:00Z"), "America/Los_Angeles", "day");
  assert.equal(winter.start.toISOString(), "2026-01-15T08:00:00.000Z"); assert.equal(winter.end.toISOString(), "2026-01-16T08:00:00.000Z");
  const summer = periodBounds(new Date("2026-07-15T20:00:00Z"), "America/Los_Angeles", "day");
  assert.equal(summer.start.toISOString(), "2026-07-15T07:00:00.000Z");
});
test("monthly boundaries follow local calendar months", () => {
  const value = periodBounds(new Date("2026-08-03T12:00:00Z"), "America/Los_Angeles", "month");
  assert.equal(value.start.toISOString(), "2026-08-01T07:00:00.000Z"); assert.equal(value.end.toISOString(), "2026-09-01T07:00:00.000Z");
});
