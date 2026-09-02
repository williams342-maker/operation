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

/**
 * Workspace roots the evaluator scan covers.
 *
 * Round 5: the scan listed five roots while the non-vacuity test checked two, so `scripts`, `deploy` and
 * `tools` could all be absent or unread without anything failing -- and `tools` does not exist in this
 * checkout. A single list, asserted against reality below, is what stops that drifting again.
 */
const SCAN_ROOTS = ["apps", "packages", "scripts", "deploy", "tools"] as const;

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

/** Extensions a bypass could actually be written in. Round 4 noted the scan saw only `.ts`. */
const SCANNED = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

function sourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (SCANNED.some((e) => entry.name.endsWith(e)) && !entry.name.endsWith(".d.ts")) out.push(full);
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
  assert.equal(surface.InMemoryReviewGateStore, undefined,
    "the store is the mutation primitive the service mediates; publishing it hands out the bypass");
  assert.equal(surface.TrustedPrincipal, undefined,
    "TrustedPrincipal must not be a value on the public surface; a consumer could call its statics");
  assert.equal(surface.principalFromSession, undefined,
    "a public minting function lets any consumer forge an identity");
  assert.equal(surface.evaluateTransition, undefined,
    "the policy evaluator must not be reachable through the package index");
  // and the counterpart: the surface is restricted, not empty.
  assert.equal(typeof surface.ReviewGateService, "function", "the service must still be exported");
});

test("the index still exports the surface consumers legitimately need", async () => {
  // The counterpart assertion: a boundary that exported NOTHING would also satisfy the tests above, so
  // this proves the restriction is narrow rather than total.
  //
  // TWICE-CORRECTED. Round 3 found the first version vacuous — it read
  //     index.includes(name) || /reviewGateService\.js/.test(index)
  // whose right-hand side is true whenever the index mentions that module at all, so every name could
  // have been deleted with the test still green. Round 4 found the replacement still weak: matching a
  // name anywhere in the text passes on a string literal or a comment, and never proves the name is
  // EXPORTED. So this now inspects the real module namespace. Text-matching a source file to learn what
  // a module exports is guesswork; importing it is not.
  const surface = await import("../src/index.js") as Record<string, unknown>;
  const expected: Array<[string, string]> = [
    ["candidateDigest", "function"],
    ["ReviewGateService", "function"],
    ["isTransitionAllowed", "function"],
    ["independenceOf", "function"],
    ["candidateBindingSchema", "object"],
    ["TRANSITIONS", "object"],
  ];
  for (const [name, kind] of expected) {
    assert.equal(typeof surface[name], kind,
      name + " should remain reachable through the package index as a " + kind);
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
  // Round 4: the scan looked only in apps/. Everything in the workspace that could import the module is
  // now covered, including deploy scripts and any future package.
  for (const app of SCAN_ROOTS) {
    for (const file of sourceFiles(path.join(repoRoot, app))) {
      if (path.resolve(file).startsWith(path.resolve(sharedSrc))) continue;
      if (path.resolve(file).startsWith(path.resolve(here))) continue;
      const text = code(file);
      if (/\bevaluateTransition\b/.test(text) || /reviewGateInternal/.test(text)) {
        offenders.push(path.relative(repoRoot, file));
      }
    }
  }
  assert.deepEqual(offenders, [],
    "these files reach the policy evaluator directly; route them through ReviewGateService instead");
});

test("the scan actually reads files, so an empty result means clean rather than blind", () => {
  // A scan that silently found nothing to look at would pass the test above forever. Round 4 called the
  // apps/ scan a repository regression check rather than an enforcement boundary; that is exactly what
  // it is, and a regression check that scans nothing is worthless.
  const scanned = SCAN_ROOTS.flatMap((d) => sourceFiles(path.join(repoRoot, d)));
  assert.ok(scanned.length > 20, "expected a substantial number of workspace files, got " + scanned.length);
  assert.ok(scanned.some((f) => f.endsWith(".ts")), "the scan should be finding TypeScript");
});

test("every scanned root is accounted for: present and read, or knowingly absent", () => {
  // ROUND 5 was right that the previous version of this test covered two of the five roots, so three
  // could vanish silently. Each root must now be either present with files in it, or explicitly listed
  // as not existing -- which makes a root disappearing a visible change rather than a quiet gap.
  const absent: string[] = [];
  const populated: string[] = [];
  for (const root of SCAN_ROOTS) {
    const full = path.join(repoRoot, root);
    if (!fs.existsSync(full)) { absent.push(root); continue; }
    assert.ok(sourceFiles(full).length > 0, root + " exists but the scan read nothing from it");
    populated.push(root);
  }
  // Measured, not guessed. I first wrote this expecting scripts/ and deploy/ to be empty of scannable
  // files and the test failed, which is the test doing its job: the scan in fact reads 23 files across
  // those two roots, so the coverage claim is stronger than I assumed rather than weaker.
  assert.deepEqual(populated, ["apps", "packages", "scripts", "deploy"],
    "a root falling silent must be a deliberate edit here, not a quiet gap in the scan");
  assert.deepEqual(absent, ["tools"],
    "tools/ does not exist in this checkout; if it is added, it is already covered by SCAN_ROOTS");
});

test("only the service module imports the evaluator", () => {
  const importers = sourceFiles(sharedSrc)
    .filter((f) => path.basename(f) !== "reviewGateInternal.ts")
    .filter((f) => /\bevaluateTransition\b/.test(code(f)))
    .map((f) => path.basename(f));
  assert.deepEqual(importers, ["reviewGateService.ts"],
    "the evaluator should have exactly one caller: the authoritative service");
});

test("service operations reject a forged principal at runtime, whatever the source text says", async () => {
  // ROUND 4 WAS RIGHT TO REJECT THE PREVIOUS VERSION OF THIS TEST. It searched for the exact string
  // `principal:` and for the words "private constructor" and "WeakSet". Renaming a parameter, adding a
  // space, or destructuring would all have evaded it, and the presence of the word "WeakSet" in a file
  // proves nothing about whether operations are branded. It asserted vocabulary, not behaviour.
  //
  // The behaviour is what matters, so assert the behaviour: build a real service and hand each operation
  // the forgery that used to work. If any of them authenticates it, the boundary is gone regardless of
  // how the file reads.
  const { ReviewGateService, InMemoryReviewGateStore } =
    await import("../src/reviewGateService.js");
  const svc = new ReviewGateService(new InMemoryReviewGateStore(), {
    authenticate: (proof) => {
      const id = (proof as { userId?: unknown } | null)?.userId;
      return typeof id === "string" && id ? { identity: id } : null;
    },
  });
  const forged = { identity: "codex" };
  const attempts = [
    svc.createCandidate(forged, { candidateId: "x", binding: {} as never }),
    svc.transition(forged, {
      candidateId: "x", occurrenceId: "1", billingClass: "INTERNAL_QA_TEST", to: "TESTED" as never }),
    svc.submitVerdict(forged, {
      candidateId: "x", occurrenceId: "2", billingClass: "INTERNAL_REVIEW", verdict: {} }),
    svc.recordTestExecution(forged, {
      candidateId: "x", occurrenceId: "3", billingClass: "INTERNAL_QA_TEST",
      evidenceId: "e", resultDigest: "0".repeat(64) }),
    svc.createSuccessor(forged, { candidateId: "y", supersedes: "x", binding: {} as never }),
  ];
  for (const result of await Promise.all(attempts)) {
    assert.equal(result.ok, false, "a forged principal must not authenticate");
    assert.equal((result as { code: string }).code, "unauthenticated",
      "and it must be refused for being unauthenticated, not for some later validation failure");
  }
});

test("the request intent carries no identity field", () => {
  // The one assertion here that is legitimately textual: it is about what the SCHEMA declares, and the
  // schema is a literal in the source. Round 1's hole was `actorIdentity: string` on the parsed intent.
  const service = code(path.join(sharedSrc, "reviewGateService.ts"));
  assert.equal(
    /actorIdentity:\s*z\./.test(service),
    false,
    "identity must not be part of the parsed request intent",
  );
});

// ── the attack itself, run rather than described ─────────────────────────────────────────────────────

test("the round-3 subpath attack is refused by the module resolver", async () => {
  // Every other assertion in this file reads configuration and infers that Node will honour it. This one
  // performs the exact import Codex used to falsify round 3's claim, and requires the resolver to refuse
  // it. Package self-reference works because the package declares both a name and an exports map, so
  // this exercises the same resolution path a consumer in apps/ would take.
  //
  // The refusal is RESOLUTION-time: it does not depend on dist/ having been built, which was verified by
  // moving dist/ aside and re-running. So this is not a test that quietly passes when the build is
  // missing.
  const blocked = [
    "@control-center/shared/dist/reviewGateInternal.js",
    "@control-center/shared/dist/reviewGate.js",
    "@control-center/shared/dist/reviewGateService.js",
    "@control-center/shared/dist/index.js",
  ];
  for (const specifier of blocked) {
    let code: string | undefined;
    try {
      await import(specifier);
    } catch (error) {
      code = (error as NodeJS.ErrnoException).code;
    }
    assert.equal(code, "ERR_PACKAGE_PATH_NOT_EXPORTED",
      specifier + " must not resolve; a reachable subpath rebuilds the evaluator bypass");
  }
});

test("the root specifier still resolves, so the exports map restricts rather than severs", async () => {
  // Counterpart to the test above: an exports map naming a path that does not exist would also refuse
  // every subpath, while breaking every consumer. The restriction has to be survivable.
  const surface = await import("@control-center/shared") as Record<string, unknown>;
  assert.equal(typeof surface.ReviewGateService, "function",
    "consumers must still reach the service through the package root");
  assert.equal(surface.evaluateTransition, undefined,
    "...and must still not reach the evaluator through it");
});
