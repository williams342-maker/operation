import test from "node:test";
import assert from "node:assert/strict";
import { serverMetricsSchema } from "../src/protocol.js";

test("server metrics reject unreasonable CPU values", () => {
  const parsed = serverMetricsSchema.safeParse({
    collectedAt: new Date().toISOString(),
    agentVersion: "test",
    uptimeSeconds: 1,
    cpu: { loadPercent: 101, cores: 2 },
    memory: { totalBytes: 10, usedBytes: 5 },
    disk: []
  });
  assert.equal(parsed.success, false);
});
