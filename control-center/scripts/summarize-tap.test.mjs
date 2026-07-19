import assert from "node:assert/strict";
import test from "node:test";
import { parseTapSummary } from "./summarize-tap.mjs";

const validTap = `TAP version 13
1..2
# tests 2
# pass 2
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 12.5
`;

test("parses the single top-level TAP summary", () => {
  assert.deepEqual(parseTapSummary(validTap, "agent.tap"), {
    filePath: "agent.tap",
    tests: 2,
    skipped: 0,
    relevantLines: ["# tests 2", "# pass 2", "# fail 0", "# cancelled 0", "# skipped 0", "# todo 0", "# duration_ms 12.5"]
  });
});

test("accepts TAP summary indentation and CRLF output", () => {
  const tap = "  # tests 1\r\n  # skipped 0\r\n";
  assert.equal(parseTapSummary(tap).tests, 1);
});

test("rejects missing count summaries", () => {
  assert.throws(() => parseTapSummary("# skipped 0\n", "missing.tap"), /exactly one TAP test-count summary, found 0/);
});

test("rejects duplicate count summaries", () => {
  assert.throws(() => parseTapSummary(`${validTap}# tests 2\n`, "duplicate.tap"), /exactly one TAP test-count summary, found 2/);
});
