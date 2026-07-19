import assert from "node:assert/strict";
import test from "node:test";
import { parseExpectedSuiteInventory, parseTapSummary, validateTapSummary } from "./summarize-tap.mjs";

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

const expectedSuites = parseExpectedSuiteInventory("agent=38,api=63,shared=52,web=26");
const completeSummary = {
  files: [
    { suite: "agent", tests: 38, skipped: 0 },
    { suite: "api", tests: 63, skipped: 0 },
    { suite: "shared", tests: 52, skipped: 0 },
    { suite: "web", tests: 26, skipped: 0 }
  ],
  tests: 179,
  skipped: 0
};

test("accepts the complete known Linux suite inventory with zero skips", () => {
  assert.doesNotThrow(() => validateTapSummary(completeSummary, expectedSuites, 179));
});

test("rejects an unexpected skipped Linux test", () => {
  assert.throws(() => validateTapSummary({ ...completeSummary, skipped: 1 }, expectedSuites, 179), /unexpected skipped tests: 1/);
});

test("rejects a missing expected Linux suite", () => {
  assert.throws(() => validateTapSummary({ ...completeSummary, files: completeSummary.files.slice(0, -1) }, expectedSuites, 179), /expected TAP suite is missing: web/);
});

test("rejects an aggregate-count mismatch", () => {
  assert.throws(() => validateTapSummary({ ...completeSummary, tests: 178 }, expectedSuites, 179), /unexpected test count: 178; expected 179/);
});

test("rejects a per-suite count mismatch even when the aggregate is unchanged", () => {
  const files = completeSummary.files.map((file) => ({ ...file }));
  files[0].tests -= 1;
  files[1].tests += 1;
  assert.throws(() => validateTapSummary({ ...completeSummary, files }, expectedSuites, 179), /unexpected test count for agent: 37; expected 38/);
});
