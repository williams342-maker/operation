// verify-release-tree.mjs — bidirectional comparison of a deployed release directory against the tree the
// attested artifact contains (gap G6).
//
// WHY THIS IS NOT verify-release-bundle.mjs. That one verifies a release-output BUNDLE: SHA256SUMS, the
// manifest, and the attestation over those files. It answers "is this bundle the one that was built and
// signed". This one answers a different question that nothing was asking: "does the directory we are about
// to run contain ONLY what that bundle contains".
//
// The distinction is not academic. On 2026-09-05 the production release directory was compared against the
// attested v0.1.2-operate artifact: all 253 artifact files were byte-identical, and the directory held TWO
// MORE -- `apps/web/Dockerfile.admin` and `deploy/nginx/admin-web.conf` -- written nine minutes after
// extraction, from no commit in the repository, with a live container built from them. Every check that
// walked the manifest passed. A check that walks the manifest CANNOT see a file the manifest does not name;
// only a comparison in both directions can.
//
// WHAT THIS DOES NOT DO, stated here because the difference is where the remaining risk lives:
//
//   - It has NO CALLER. No deployment mechanism for the control-center has been found in this repository or
//     in the host paths searched (gap G0), so there is nowhere to enforce this yet. It ships validated and
//     inert, exactly as verify-release-bundle.mjs does for G1.
//   - Comparing at one instant does not make the verified tree the tree that gets consumed. The production
//     overlay landed AFTER extraction; a check that runs only at extraction time would have seen nothing.
//     Running it again immediately before start narrows that race, it does not close it -- closing it means
//     the verified object must BE the object consumed. See §2 and G6 of docs/deployment-readiness.md.
//
// Pure and offline. Never throws on a verification failure; it collects problems so a caller can decide.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

// One entry per path, with its TYPE as well as its bytes. Type matters: a name-only comparison accepts a
// symlink where the artifact had a regular file, and a symlink is an instruction to read something else.
// `lstat`, not `stat`, so a link is reported as a link rather than as whatever it points at.
export function describeTree(root) {
  const entries = new Map();
  const walk = (dir) => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, item.name);
      // POSIX separators regardless of host, so a tree described on Windows compares to one described on
      // Linux. Without this every path differs and the comparison reports the entire tree as both missing
      // and extra.
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      const stats = fs.lstatSync(absolute);
      if (stats.isSymbolicLink()) {
        entries.set(relative, { type: "symlink", target: fs.readlinkSync(absolute) });
      } else if (stats.isDirectory()) {
        entries.set(relative, { type: "directory" });
        walk(absolute);
      } else if (stats.isFile()) {
        entries.set(relative, { type: "file", sha256: sha256File(absolute) });
      } else {
        // Sockets, fifos, devices. Not expected in a release tree, and silently ignoring one would be the
        // same class of hole this file exists to close.
        entries.set(relative, { type: "other" });
      }
    }
  };
  walk(root);
  return entries;
}

/**
 * Compare a deployed directory against the tree an artifact expands to.
 *
 * `expected` and `actual` are either directory paths or Maps from `describeTree`.
 *
 * Returns `{ ok, problems, missing, extra, mismatched }`. `extra` is the finding that motivated this file
 * and it is a PROBLEM, not a note: a release directory holding files the artifact does not is a directory
 * whose provenance chain covers only part of it.
 */
export function compareReleaseTree(expected, actual, { allowExtra = [] } = {}) {
  const expectedEntries = expected instanceof Map ? expected : describeTree(expected);
  const actualEntries = actual instanceof Map ? actual : describeTree(actual);
  const permitted = new Set(allowExtra);

  const missing = [];
  const extra = [];
  const mismatched = [];

  for (const [relative, want] of expectedEntries) {
    const got = actualEntries.get(relative);
    if (!got) {
      missing.push(relative);
      continue;
    }
    if (got.type !== want.type) {
      mismatched.push({ path: relative, reason: `expected ${want.type}, found ${got.type}` });
      continue;
    }
    if (want.type === "file" && got.sha256 !== want.sha256) {
      mismatched.push({ path: relative, reason: "content differs" });
    }
    if (want.type === "symlink" && got.target !== want.target) {
      mismatched.push({ path: relative, reason: `link target differs: expected ${want.target}, found ${got.target}` });
    }
  }

  for (const relative of actualEntries.keys()) {
    if (!expectedEntries.has(relative) && !permitted.has(relative)) extra.push(relative);
  }

  const problems = [
    ...missing.map((p) => `missing from the deployed tree: ${p}`),
    // Named separately and worded as content the artifact does not cover, because "extra file" reads as
    // harmless and this is the one that shipped an unreviewed Dockerfile into production.
    ...extra.map((p) => `present but NOT in the artifact, so outside its provenance: ${p}`),
    ...mismatched.map((m) => `${m.path}: ${m.reason}`)
  ];

  return { ok: problems.length === 0, problems, missing: missing.sort(), extra: extra.sort(), mismatched };
}

function main() {
  const [expectedDir, actualDir, ...rest] = process.argv.slice(2);
  if (!expectedDir || !actualDir) {
    console.error("usage: verify-release-tree.mjs <expected-tree> <deployed-tree> [--allow-extra <path>]...");
    process.exit(2);
  }
  const allowExtra = [];
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === "--allow-extra" && rest[i + 1]) {
      allowExtra.push(rest[i + 1]);
      i += 1;
    }
  }
  const result = compareReleaseTree(expectedDir, actualDir, { allowExtra });
  for (const problem of result.problems) console.error(problem);
  if (result.ok) {
    console.log(`release tree matches: ${describeTree(expectedDir).size} entries, nothing extra`);
    process.exit(0);
  }
  console.error(`release tree verification FAILED: ${result.problems.length} problem(s)`);
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("verify-release-tree.mjs")) {
  main();
}
