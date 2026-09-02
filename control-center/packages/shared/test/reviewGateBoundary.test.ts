import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// The import boundary, asserted rather than asked for politely.
//
// An independent review found that calling `evaluateTransition` "internal" in a comment enforced nothing:
// index.ts did `export * from "./reviewGate.js"`, so every consumer of @control-center/shared could
// bypass ReviewGateService and supply its own state, ledger, binding and verdict — the exact hole the
// service was built to close. A comment is not a boundary. This test is.

const here = import.meta.dirname;
const sharedSrc = path.join(here, "..", "src");
const repoRoot = path.join(here, "..", "..", "..");

function read(file: string): string {
  return fs.readFileSync(file, "utf8");
}

/**
 * Source with comments removed.
 *
 * The first version of this test grepped raw text and failed on its own explanatory comment in index.ts,
 * which mentions `evaluateTransition` while explaining why it is not exported. A boundary test that
 * cannot tell code from prose reports the documentation as the violation.
 */
function code(file: string): string {
  return read(file)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    // The `m` flag matters: without it `^` anchors to the start of the whole string, so a `//` comment
    // beginning a line is never stripped. That is precisely how this helper first reported index.ts's
    // own explanatory comment as a boundary violation.
    .replace(/(^|[^:])\/\/[^\n]*/gm, "$1 ");
}

function sourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

test("the package index does not re-export the policy evaluator", () => {
  const index = code(path.join(sharedSrc, "index.ts"));
  assert.equal(
    /export \*\s+from\s+"\.\/reviewGate\.js"/.test(index),
    false,
    "`export *` re-exports evaluateTransition and reopens the bypass; export by name instead",
  );
  assert.equal(
    /\bevaluateTransition\b/.test(index),
    false,
    "evaluateTransition must not appear in the package's public surface",
  );
});

test("the index still exports the surface consumers legitimately need", () => {
  // The counterpart assertion. A boundary that exported nothing would also pass the test above, so this
  // proves the restriction is narrow rather than total.
  const index = code(path.join(sharedSrc, "index.ts"));
  for (const name of ["candidateDigest", "ReviewGateService", "candidateBindingSchema", "TRANSITIONS"]) {
    assert.ok(index.includes(name) || /reviewGateService\.js/.test(index),
      `${name} should remain reachable through the package index`);
  }
});

test("no application code imports the evaluator directly", () => {
  // apps/* are the routes and agents. If any of them reaches past ReviewGateService, the authoritative
  // snapshot becomes caller-supplied again and every guarantee in the gate evaporates.
  const offenders: string[] = [];
  for (const app of ["apps"]) {
    for (const file of sourceFiles(path.join(repoRoot, app))) {
      const text = code(file);
      if (/\bevaluateTransition\b/.test(text)) offenders.push(path.relative(repoRoot, file));
    }
  }
  assert.deepEqual(offenders, [],
    "these files import the policy evaluator directly; route them through ReviewGateService instead");
});

test("only the service module imports the evaluator", () => {
  const importers = sourceFiles(sharedSrc)
    .filter((f) => path.basename(f) !== "reviewGate.ts")
    .filter((f) => /\bevaluateTransition\b/.test(code(f)))
    .map((f) => path.basename(f));
  assert.deepEqual(importers, ["reviewGateService.ts"],
    "the evaluator should have exactly one caller: the authoritative service");
});

test("service operations take a principal rather than an identity string", () => {
  // Guards the C2 remediation shape. If someone reintroduces `actorIdentity: string` on the service
  // surface, identity becomes request data again and string equality authenticates nothing.
  const service = code(path.join(sharedSrc, "reviewGateService.ts"));
  assert.equal(
    /actorIdentity:\s*z\.string\(\)/.test(service),
    false,
    "identity must not be part of the parsed request intent",
  );
  assert.ok(service.includes("TrustedPrincipal"), "operations must accept a TrustedPrincipal");
});
