import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const summaryPattern = /^[\t ]*# (tests|pass|fail|cancelled|skipped|todo|duration_ms)\b.*$/gm;
const countPattern = /^[\t ]*# tests[\t ]+(\d+)[\t ]*$/gm;
const skippedPattern = /^[\t ]*# skipped[\t ]+(\d+)[\t ]*$/gm;

// READ OUT OF THE ARTIFACT, not inferred from an exit code. The TAP file is what CI retains and what
// a reviewer reads later, so the failure count has to be judged from the same bytes. Relying on the
// runner's exit status instead means one stray `|| true` in the workflow turns a red suite green
// here, with the evidence of the failure sitting unread in the very file this gate parsed.
const failedPattern = /^[\t ]*# fail[\t ]+(\d+)[\t ]*$/gm;

export function parseTapSummary(text, filePath = "<tap>") {
  const relevantLines = [...text.matchAll(summaryPattern)].map((match) => match[0]);
  const testMatches = [...text.matchAll(countPattern)];
  const skippedMatches = [...text.matchAll(skippedPattern)];
  const failedMatches = [...text.matchAll(failedPattern)];

  if (testMatches.length !== 1) {
    throw new Error(`${filePath}: expected exactly one TAP test-count summary, found ${testMatches.length}`);
  }
  if (skippedMatches.length !== 1) {
    throw new Error(`${filePath}: expected exactly one TAP skipped-count summary, found ${skippedMatches.length}`);
  }
  if (failedMatches.length !== 1) {
    throw new Error(`${filePath}: expected exactly one TAP fail-count summary, found ${failedMatches.length}`);
  }

  return {
    filePath,
    tests: Number(testMatches[0][1]),
    failed: Number(failedMatches[0][1]),
    skipped: Number(skippedMatches[0][1]),
    relevantLines
  };
}

export function summarizeTapFiles(filePaths) {
  const files = filePaths.map((filePath) => {
    if (!fs.existsSync(filePath)) throw new Error(`${filePath}: TAP file is missing`);
    return parseTapSummary(fs.readFileSync(filePath, "utf8"), filePath);
  });

  return {
    files,
    tests: files.reduce((total, file) => total + file.tests, 0),
    failed: files.reduce((total, file) => total + file.failed, 0),
    skipped: files.reduce((total, file) => total + file.skipped, 0)
  };
}

export function parseExpectedSuiteInventory(value) {
  if (!value) throw new Error("CI_EXPECTED_TEST_SUITES is required");
  const inventory = new Map();
  for (const entry of value.split(",")) {
    const match = /^([a-z][a-z0-9-]*)=(\d+)$/.exec(entry);
    if (!match) throw new Error(`invalid expected suite entry: ${JSON.stringify(entry)}`);
    if (inventory.has(match[1])) throw new Error(`duplicate expected suite: ${match[1]}`);
    inventory.set(match[1], Number(match[2]));
  }
  return inventory;
}

export function summarizeTapSuites(suiteSpecs) {
  const suites = new Map();
  for (const spec of suiteSpecs) {
    const match = /^([a-z][a-z0-9-]*)=(.+)$/.exec(spec);
    if (!match) throw new Error(`invalid TAP suite specification: ${JSON.stringify(spec)}`);
    if (suites.has(match[1])) throw new Error(`duplicate TAP suite: ${match[1]}`);
    suites.set(match[1], match[2]);
  }
  const summary = summarizeTapFiles([...suites.values()]);
  summary.files.forEach((file, index) => { file.suite = [...suites.keys()][index]; });
  return summary;
}

export function validateTapSummary(summary, expectedSuites, expectedTotal) {
  const actualSuites = new Map(summary.files.map((file) => [file.suite, file.tests]));
  for (const [suite, expected] of expectedSuites) {
    if (!actualSuites.has(suite)) throw new Error(`expected TAP suite is missing: ${suite}`);
    const actual = actualSuites.get(suite);
    if (actual !== expected) throw new Error(`unexpected test count for ${suite}: ${actual}; expected ${expected}`);
  }
  for (const suite of actualSuites.keys()) {
    if (!expectedSuites.has(suite)) throw new Error(`unexpected TAP suite: ${suite}`);
  }
  if (summary.tests !== expectedTotal) throw new Error(`unexpected test count: ${summary.tests}; expected ${expectedTotal}`);
  if (summary.skipped !== 0) throw new Error(`unexpected skipped tests: ${summary.skipped}`);
  // Named per suite, because a bare aggregate does not tell a reader which of the five broke.
  for (const file of summary.files) {
    if (file.failed !== 0) throw new Error(`failing tests in ${file.suite}: ${file.failed}`);
  }
}

export function printTapSummary(summary, output = console.log) {
  for (const file of summary.files) {
    output(`TAP file: ${path.resolve(file.filePath)}`);
    output(`Parsed tests: ${file.tests}`);
    output(`Parsed failed: ${file.failed}`);
    output(`Parsed skipped: ${file.skipped}`);
    output("Relevant TAP summary lines:");
    for (const line of file.relevantLines) output(`  ${line}`);
  }
  output(`Aggregate tests: ${summary.tests}`);
  output(`Aggregate failed: ${summary.failed}`);
  output(`Aggregate skipped: ${summary.skipped}`);
}

function main() {
  const expected = Number(process.env.CI_EXPECTED_TESTS);
  if (!Number.isSafeInteger(expected) || expected < 0) {
    throw new Error(`CI_EXPECTED_TESTS must be a non-negative integer, received ${JSON.stringify(process.env.CI_EXPECTED_TESTS)}`);
  }

  const suiteSpecs = process.argv.slice(2);
  if (suiteSpecs.length === 0) throw new Error("at least one TAP suite specification is required");

  const expectedSuites = parseExpectedSuiteInventory(process.env.CI_EXPECTED_TEST_SUITES);
  const summary = summarizeTapSuites(suiteSpecs);
  printTapSummary(summary);
  validateTapSummary(summary, expectedSuites, expected);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
