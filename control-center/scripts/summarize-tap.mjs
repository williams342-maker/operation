import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const summaryPattern = /^[\t ]*# (tests|pass|fail|cancelled|skipped|todo|duration_ms)\b.*$/gm;
const countPattern = /^[\t ]*# tests[\t ]+(\d+)[\t ]*$/gm;
const skippedPattern = /^[\t ]*# skipped[\t ]+(\d+)[\t ]*$/gm;

export function parseTapSummary(text, filePath = "<tap>") {
  const relevantLines = [...text.matchAll(summaryPattern)].map((match) => match[0]);
  const testMatches = [...text.matchAll(countPattern)];
  const skippedMatches = [...text.matchAll(skippedPattern)];

  if (testMatches.length !== 1) {
    throw new Error(`${filePath}: expected exactly one TAP test-count summary, found ${testMatches.length}`);
  }
  if (skippedMatches.length !== 1) {
    throw new Error(`${filePath}: expected exactly one TAP skipped-count summary, found ${skippedMatches.length}`);
  }

  return {
    filePath,
    tests: Number(testMatches[0][1]),
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
    skipped: files.reduce((total, file) => total + file.skipped, 0)
  };
}

export function printTapSummary(summary, output = console.log) {
  for (const file of summary.files) {
    output(`TAP file: ${path.resolve(file.filePath)}`);
    output(`Parsed tests: ${file.tests}`);
    output(`Parsed skipped: ${file.skipped}`);
    output("Relevant TAP summary lines:");
    for (const line of file.relevantLines) output(`  ${line}`);
  }
  output(`Aggregate tests: ${summary.tests}`);
  output(`Aggregate skipped: ${summary.skipped}`);
}

function main() {
  const expected = Number(process.env.CI_EXPECTED_TESTS);
  if (!Number.isSafeInteger(expected) || expected < 0) {
    throw new Error(`CI_EXPECTED_TESTS must be a non-negative integer, received ${JSON.stringify(process.env.CI_EXPECTED_TESTS)}`);
  }

  const filePaths = process.argv.slice(2);
  if (filePaths.length === 0) throw new Error("at least one TAP file path is required");
  if (new Set(filePaths).size !== filePaths.length) throw new Error("duplicate TAP file paths are not allowed");

  const summary = summarizeTapFiles(filePaths);
  printTapSummary(summary);
  if (summary.tests !== expected) throw new Error(`unexpected test count: ${summary.tests}; expected ${expected}`);
  if (summary.skipped !== 0) throw new Error(`unexpected skipped tests: ${summary.skipped}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
