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
    failed: 0,
    skipped: 0,
    relevantLines: ["# tests 2", "# pass 2", "# fail 0", "# cancelled 0", "# skipped 0", "# todo 0", "# duration_ms 12.5"]
  });
});

test("accepts TAP summary indentation and CRLF output", () => {
  const tap = "  # tests 1\r\n  # fail 0\r\n  # skipped 0\r\n";
  const summary = parseTapSummary(tap);
  assert.equal(summary.tests, 1);
  // The fail line has to survive the same indentation and carriage returns as the other two, or the
  // gate would reject every genuine Windows-produced TAP file as unjudgeable.
  assert.equal(summary.failed, 0);
  assert.equal(summary.skipped, 0);
});

test("rejects missing count summaries", () => {
  assert.throws(() => parseTapSummary("# skipped 0\n", "missing.tap"), /exactly one TAP test-count summary, found 0/);
});

// A TAP file with no fail line is not a file with no failures -- it is a file this gate cannot judge,
// and treating the two the same is how a truncated artifact reads as clean.
test("rejects a TAP file with no fail-count summary", () => {
  const withoutFail = validTap.split("\n").filter((line) => !line.startsWith("# fail")).join("\n");
  assert.throws(() => parseTapSummary(withoutFail, "truncated.tap"), /exactly one TAP fail-count summary, found 0/);
});

test("reads the fail count out of the TAP itself", () => {
  const red = validTap.replace("# pass 2", "# pass 1").replace("# fail 0", "# fail 1");
  assert.equal(parseTapSummary(red).failed, 1);
});

test("rejects duplicate count summaries", () => {
  assert.throws(() => parseTapSummary(`${validTap}# tests 2\n`, "duplicate.tap"), /exactly one TAP test-count summary, found 2/);
});

const expectedSuites = parseExpectedSuiteInventory("agent=38,api=63,shared=52,web=26");
const completeSummary = {
  files: [
    { suite: "agent", tests: 38, failed: 0, skipped: 0 },
    { suite: "api", tests: 63, failed: 0, skipped: 0 },
    { suite: "shared", tests: 52, failed: 0, skipped: 0 },
    { suite: "web", tests: 26, failed: 0, skipped: 0 }
  ],
  tests: 179,
  failed: 0,
  skipped: 0
};

test("accepts the complete known Linux suite inventory with zero skips", () => {
  assert.doesNotThrow(() => validateTapSummary(completeSummary, expectedSuites, 179));
});

// The counts can all be exactly right and the run still be red. Before this the gate read every
// number in the TAP except the one that says whether the tests passed, and leaned on `set -e` in the
// workflow to notice -- which is a property of the shell, not of the retained evidence.
test("rejects a failing suite even when every count matches, and names it", () => {
  const files = completeSummary.files.map((file) => ({ ...file }));
  files[1].failed = 2;
  assert.throws(() => validateTapSummary({ ...completeSummary, files, failed: 2 }, expectedSuites, 179), /failing tests in api: 2/);
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
