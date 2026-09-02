import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// The import boundary, asserted rather than asked for politely.
//
// ROUND 2 of an independent review found that calling `evaluateTransition` "internal" in a comment
// enforced nothing: index.ts did `export * from "./reviewGate.js"`, so every consumer of
// @control-center/shared could bypass ReviewGateService and supply its own state, ledger, binding and
// verdict — the exact hole the service was built to close.
//
// ROUND 3 found that the fix was still not a boundary. Removing the symbol from index.ts left the module
// reachable at a package subpath, because package.json had no `exports` map:
//
//     import { evaluateTransition } from "@control-center/shared/dist/reviewGate.js";
//
// resolved perfectly well, and rebuilt the bypass. The lesson worth keeping is that BOTH of my earlier
// "boundaries" were conventions I had described as enforcement. The enforcement is the `exports` map;
// the internal module gives it a name; these tests fail if either half is removed.

const here = import.meta.dirname;
const sharedSrc = path.join(here, "..", "src");
const packageRoot = path.join(here, "..");
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

// ── the enforcement itself ───────────────────────────────────────────────────────────────────────────

test("package.json restricts consumers to the root entry point", () => {
  // THIS is the assertion that would have caught round 3's CRITICAL-1. Without an `exports` map, Node
  // resolves any file in the package by path, and every other test in this file becomes decoration.
  const pkg = JSON.parse(read(path.join(packageRoot, "package.json"))) as {
    exports?: Record<string, unknown>;
  };
  assert.ok(pkg.exports, "package.json must declare an exports map; without one every module is public");
  const subpaths = Object.keys(pkg.exports!);
  assert.deepEqual(subpaths, ["."],
    "only the root entry point may be exported; a subpath re-opens direct access to internal modules");
});

test("no exports subpath can resolve the internal evaluator", () => {
  const pkg = JSON.parse(read(path.join(packageRoot, "package.json"))) as {
    exports?: Record<string, unknown>;
  };
  const serialised = JSON.stringify(pkg.exports ?? {});
  assert.equal(/\*/.test(serialised), false,
    "a wildcard subpath exposes every module in the package, including reviewGateInternal");
  assert.equal(/reviewGate(Internal)?/.test(serialised), false,
    "the review-gate modules must be reachable only through the package index");
});

// ── the public surface ───────────────────────────────────────────────────────────────────────────────

test("the package index does not re-export the policy evaluator", () => {
  const index = code(path.join(sharedSrc, "index.ts"));
  assert.equal(
    /export \*\s+from\s+"\.\/reviewGate(Internal|Service)?\.js"/.test(index),
    false,
    "`export *` re-exports the evaluator and reopens the bypass; export by name instead",
  );
  assert.equal(
    /\bevaluateTransition\b/.test(index),
    false,
    "evaluateTransition must not appear in the package's public surface",
  );
  assert.equal(
    /reviewGateInternal/.test(index),
    false,
    "the internal module must not be referenced by the index at all",
  );
});

test("the index publishes TrustedPrincipal as a type, never as a value", async () => {
  // Round 3's CRITICAL-2: `export *` published the class value and a minting helper, so any consumer
  // could mint the identity of an uninvolved reviewer. A type-only export leaves no value binding to
  // call a static on.
  //
  // THIS ASSERTION IS A RUNTIME ONE ON PURPOSE. I first wrote it as a regex over the source, and a
  // mutation check showed it could not catch the very change it existed to catch -- the negative
  // lookahead excluded the exact shape a value export takes. That is the third time this round that a
  // text-matching test of mine passed for the wrong reason. Importing the module and looking at what is
  // actually bound cannot be fooled by my regex.
  const surface = await import("../src/index.js") as Record<string, unknown>;
  assert.equal(surface.TrustedPrincipal, undefined,
    "TrustedPrincipal must not be a value on the public surface; a consumer could call its statics");
  assert.equal(surface.principalFromSession, undefined,
    "a public minting function lets any consumer forge an identity");
  assert.equal(surface.evaluateTransition, undefined,
    "the policy evaluator must not be reachable through the package index");
  // and the counterpart: the surface is restricted, not empty.
  assert.equal(typeof surface.ReviewGateService, "function", "the service must still be exported");
});

test("the index still exports the surface consumers legitimately need", () => {
  // The counterpart assertion: a boundary that exported NOTHING would also satisfy the tests above, so
  // this proves the restriction is narrow rather than total.
  //
  // Round 3 found the previous version of this test vacuous. It read
  //     index.includes(name) || /reviewGateService\.js/.test(index)
  // and the right-hand side is true whenever the index mentions that module at all — so every name in
  // the list could have been deleted and the loop would still have passed. The disjunction made the
  // assertion unfalsifiable, which is worse than no counterpart test, because it reads like coverage.
  const index = code(path.join(sharedSrc, "index.ts"));
  for (const name of ["candidateDigest", "ReviewGateService", "candidateBindingSchema", "TRANSITIONS",
    "independenceOf", "InMemoryReviewGateStore", "SessionAuthenticator", "isTransitionAllowed"]) {
    assert.ok(new RegExp("\\b" + name + "\\b").test(index),
      name + " should remain reachable through the package index");
  }
});

// ── who may reach the evaluator ──────────────────────────────────────────────────────────────────────

test("the evaluator is defined in exactly one place, and that place is the internal module", () => {
  const definers = sourceFiles(sharedSrc)
    .filter((f) => /export function evaluateTransition\b/.test(code(f)))
    .map((f) => path.basename(f));
  assert.deepEqual(definers, ["reviewGateInternal.ts"],
    "the evaluator must live in the module whose name marks it as off the public surface");
});

test("no application code imports the evaluator directly", () => {
  // apps/* are the routes and agents. If any of them reaches past ReviewGateService, the authoritative
  // snapshot becomes caller-supplied again and every guarantee in the gate evaporates. Note the scope
  // honestly: this catches a *relative* import inside the monorepo, which the exports map cannot. The
  // exports map catches the package-subpath import, which this cannot. Both are needed.
  const offenders: string[] = [];
  for (const app of ["apps"]) {
    for (const file of sourceFiles(path.join(repoRoot, app))) {
      const text = code(file);
      if (/\bevaluateTransition\b/.test(text) || /reviewGateInternal/.test(text)) {
        offenders.push(path.relative(repoRoot, file));
      }
    }
  }
  assert.deepEqual(offenders, [],
    "these files reach the policy evaluator directly; route them through ReviewGateService instead");
});

test("only the service module imports the evaluator", () => {
  const importers = sourceFiles(sharedSrc)
    .filter((f) => path.basename(f) !== "reviewGateInternal.ts")
    .filter((f) => /\bevaluateTransition\b/.test(code(f)))
    .map((f) => path.basename(f));
  assert.deepEqual(importers, ["reviewGateService.ts"],
    "the evaluator should have exactly one caller: the authoritative service");
});

test("service operations take a proof, never an identity string or a principal", () => {
  // Guards the C2 remediation shape across all three rounds at once. `actorIdentity: string` was round
  // 1's hole; a caller-constructed principal was round 2's. The surface must expose neither.
  const service = code(path.join(sharedSrc, "reviewGateService.ts"));
  assert.equal(
    /actorIdentity:\s*z\.string\(\)/.test(service),
    false,
    "identity must not be part of the parsed request intent",
  );
  assert.equal(
    /async (createCandidate|transition|submitVerdict)\(\s*principal:/.test(service),
    false,
    "an operation accepting a principal accepts a forgeable object; take an opaque proof instead",
  );
  assert.ok(/private constructor/.test(service), "TrustedPrincipal must keep its private constructor");
  assert.ok(/WeakSet/.test(service), "a runtime brand is required; instanceof alone is forgeable");
});
