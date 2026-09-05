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
//   - Hardlinks are compared as ordinary files: their bytes are verified, their link topology is not.
//   - On a CASE-INSENSITIVE filesystem two artifact paths differing only in case cannot both exist in an
//     extracted expected tree, so such an artifact cannot be faithfully checked there. Production
//     verification runs on Linux, where they can.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

// HOW A PATH IS RENDERED INTO EVIDENCE, and the only way it should be.
//
// `JSON.stringify` handles the C0 controls, the quotes and the backslashes — a name containing a newline
// cannot print as two lines, and one carrying ANSI escapes cannot repaint the terminal it lands in. It does
// NOT handle the Unicode bidi formatting controls, which survive it intact and reorder what a reader sees:
// `RLO` in a filename can make `deploy/exe.conf` display as `deploy/fnoc.exe`. Those are valid Linux
// filename characters, so this is the same evidence-integrity problem as the escapes, not a theoretical one.
//
// Deliberately NOT escaped: ordinary non-ASCII and homoglyphs. Filenames legitimately use them, and
// escaping every non-ASCII character would make real paths unreadable to buy nothing — the difference is
// that a bidi control changes the ORDER of what is displayed, while a homoglyph is just a character that
// resembles another.
// Written as code points rather than as a character class of literal bidi controls, because such a class is
// invisible in an editor and unreviewable in a diff — a reader could not tell a correct one from a wrong one.
// U+061C ALM, U+200E LRM, U+200F RLM, U+202A–U+202E (LRE RLE PDF LRO RLO), U+2066–U+2069 (LRI RLI FSI PDI).
const BIDI_CONTROL_POINTS = new Set([0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e,
  0x2066, 0x2067, 0x2068, 0x2069]);
export function renderPath(value) {
  return [...JSON.stringify(value)]
    .map((character) => {
      const point = character.codePointAt(0);
      if (!BIDI_CONTROL_POINTS.has(point)) return character;
      return `\\u${point.toString(16).padStart(4, "0")}`;
    })
    .join("");
}

// One entry per path, with its TYPE as well as its bytes. Type matters: a name-only comparison accepts a
// symlink where the artifact had a regular file, and a symlink is an instruction to read something else.
// `lstat`, not `stat`, so a link is reported as a link rather than as whatever it points at -- which is also
// why the walk cannot follow a symlinked directory out of the tree or around a cycle.
//
// Filesystem errors are NOT collected here; they throw. That is deliberate and it is the one place this
// module does throw: a tree it cannot read is a tree it cannot vouch for, and a caller about to deploy
// should stop rather than receive a report with holes in it.
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
        // Sockets, fifos, devices. Recorded with the raw mode so the refusal below can say what it found;
        // two such nodes at the same path are NEVER treated as equal, because nothing here establishes
        // their identity and "same unknown kind" is not "same thing".
        entries.set(relative, { type: "other", mode: stats.mode });
      }
    }
  };
  walk(root);
  return entries;
}

// Allowances are TYPED. A bare path would permit `runtime.log` to arrive as a symlink pointing anywhere,
// which is precisely the substitution the type comparison exists to catch -- an escape hatch that silences
// the finding this module is for. A directory allowance permits THAT ENTRY only: its children are not
// implicitly allowed, because "allow this directory" is otherwise indistinguishable from "allow anything
// anyone puts in it".
//
// SYMLINKS CANNOT BE ALLOWED AT ALL. A typed `symlink` allowance sounds safe and is not: the type would be
// checked and the TARGET would not, so it permits a link at that path pointing anywhere, inside the tree or
// out of it. That is the substitution this module exists to refuse, and constraining the target instead
// would mean a deploy declaring in advance exactly what a link it did not put there should point at. There
// is no honest use for it here.
export const ALLOWABLE_TYPES = ["file", "directory"];

function normaliseAllowances(allowExtra) {
  const allowances = new Map();
  for (const entry of allowExtra) {
    if (typeof entry === "string" || !entry?.path || !entry?.type) {
      throw new TypeError(
        `allowExtra entries must be {path, type}; received ${JSON.stringify(entry)}. A path without a type ` +
        "would permit a symlink where a file was expected."
      );
    }
    // Every rejection below is a value that would otherwise become a SILENT NO-OP: it never matches a path
    // `describeTree` produces, so verification passes while the allowance the caller wrote does nothing.
    // A no-op allowance is worse than a rejected one, because the caller believes it is in effect.
    if (!ALLOWABLE_TYPES.includes(entry.type)) {
      throw new TypeError(
        `allowExtra type must be one of ${ALLOWABLE_TYPES.join(", ")}; received ${JSON.stringify(entry.type)}` +
        (entry.type === "symlink"
          ? ". A symlink allowance would check the type and not the target, permitting a link to anywhere."
          : "")
      );
    }
    const { path: relative } = entry;
    if (path.posix.isAbsolute(relative) || /^[A-Za-z]:/.test(relative)) {
      throw new TypeError(`allowExtra path must be relative to the tree root; received ${JSON.stringify(relative)}`);
    }
    if (relative.includes("\\")) {
      throw new TypeError(`allowExtra path must use "/" separators; received ${JSON.stringify(relative)}`);
    }
    if (relative.endsWith("/")) {
      throw new TypeError(`allowExtra path must not end with a separator; received ${JSON.stringify(relative)}`);
    }
    // A NUL can never appear in a path Node returns from readdir, so an allowance containing one is
    // unmatchable by construction. Trailing spaces and other control characters are NOT rejected: they are
    // valid Linux filenames that genuinely can match, and refusing them would be theatre. NFC/NFD forms are
    // likewise left alone -- they are distinct paths on Linux, and silently normalising would make an
    // allowance match something the caller did not write.
    if (relative.includes(String.fromCharCode(0))) {
      throw new TypeError(`allowExtra path must not contain a NUL; received ${JSON.stringify(relative)}`);
    }
    if (relative.split("/").some((segment) => segment === "." || segment === ".." || segment === "")) {
      throw new TypeError(`allowExtra path must be normalised, with no "." or ".." segments; received ${JSON.stringify(relative)}`);
    }
    if (allowances.has(relative)) {
      // Last-write-wins over two contradictory allowances for one path silently picks a winner. Refuse.
      throw new TypeError(`allowExtra names ${JSON.stringify(relative)} more than once`);
    }
    allowances.set(relative, entry.type);
  }
  return allowances;
}

/**
 * Compare a deployed directory against the tree an artifact expands to.
 *
 * `expected` and `actual` are either directory paths or Maps from `describeTree`.
 * `allowExtra` is a list of `{path, type}`.
 *
 * Returns `{ ok, problems, missing, extra, mismatched, permitted }`. `extra` is the finding that motivated
 * this file and it is a PROBLEM, not a note: a release directory holding files the artifact does not is a
 * directory whose provenance chain covers only part of it.
 *
 * Comparison mismatches are collected, never thrown. Unreadable trees and malformed allowances do throw --
 * those are conditions under which no report would be trustworthy.
 */
export function compareReleaseTree(expected, actual, { allowExtra = [] } = {}) {
  const expectedEntries = expected instanceof Map ? expected : describeTree(expected);
  const actualEntries = actual instanceof Map ? actual : describeTree(actual);
  const allowances = normaliseAllowances(allowExtra);

  const missing = [];
  const extra = [];
  const mismatched = [];
  const permitted = [];

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
      mismatched.push({
        path: relative,
        // The TARGET is attacker-controlled too, and it is a string read off the deployed tree.
        reason: `link target differs: expected ${renderPath(want.target)}, found ${renderPath(got.target)}`
      });
    }
    if (want.type === "other") {
      mismatched.push({ path: relative, reason: "neither file, directory nor symlink; identity cannot be established" });
    }
  }

  for (const [relative, got] of actualEntries) {
    if (expectedEntries.has(relative)) continue;
    // `extra` and `mismatched` are DISJOINT: one filesystem entry produces one problem. An earlier version
    // put an unexpected special node in both and reported "FAILED: 2 problems" for a single node.
    const allowedType = allowances.get(relative);
    if (allowedType !== undefined && allowedType === got.type) {
      permitted.push(relative);
    } else if (allowedType !== undefined) {
      mismatched.push({ path: relative, reason: `permitted as ${allowedType}, found ${got.type}` });
    } else {
      extra.push(relative);
    }
  }

  // EVERY PATH IS ESCAPED ON THE WAY OUT, and the comparison keys are left exactly as the filesystem gave
  // them. A Linux filename may contain a newline, a carriage return, a tab or a terminal escape, and these
  // strings become the evidence a deploy records. An extra file whose name contains a newline followed by
  // the text of this module's own success line would otherwise print as two lines, the second of them a
  // forged pass; a name carrying ANSI escapes could rewrite what an operator sees in the terminal it is
  // printed to. Either is the thing being caught editing the record of catching it.
  const show = renderPath;
  const extraType = (relative) => actualEntries.get(relative)?.type ?? "unknown";
  const problems = [
    ...missing.map((p) => `missing from the deployed tree: ${show(p)}`),
    // Named separately and worded as content the artifact does not cover, because "extra file" reads as
    // harmless and this is the one that shipped an unreviewed Dockerfile into production. The type is
    // carried because an unexpected symlink or special node is a different problem from an unexpected file.
    ...extra.map((p) => `present but NOT in the artifact, so outside its provenance: ${show(p)} (${extraType(p)})`),
    ...mismatched.map((m) => `${show(m.path)}: ${m.reason}`)
  ];

  return {
    ok: problems.length === 0,
    problems,
    missing: missing.sort(),
    extra: extra.sort(),
    mismatched,
    permitted: permitted.sort()
  };
}

// Refuses anything it does not recognise. Skipping unknown tokens means `--allow-exrta runtime.log:file`
// is silently ignored and the run can still exit 0 — a typo in a security allowance that reads as success.
export function parseAllowExtraArgs(args) {
  const allowances = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] !== "--allow-extra") {
      throw new TypeError(
        args[i].startsWith("-")
          ? `unknown option ${JSON.stringify(args[i])}`
          : `unexpected argument ${JSON.stringify(args[i])}`
      );
    }
    const value = args[i + 1];
    if (!value) throw new TypeError("--allow-extra needs a value of the form <path>:<type>");
    // Split on the LAST colon: a path may contain one, a type never does.
    const cut = value.lastIndexOf(":");
    if (cut <= 0) throw new TypeError(`--allow-extra needs <path>:<type>, received ${JSON.stringify(value)}`);
    allowances.push({ path: value.slice(0, cut), type: value.slice(cut + 1) });
    i += 1;
  }
  return allowances;
}

// Separated from the process so it can be tested without spawning one -- `node --test` already spawns per
// file and has died with EPERM inside review sandboxes, so a CLI whose only test is a subprocess is a CLI
// that quietly goes unverified there.
export function runCli(argv, { log = console.log, error = console.error } = {}) {
  const [expectedDir, actualDir, ...rest] = argv;
  if (!expectedDir || !actualDir) {
    error("usage: verify-release-tree.mjs <expected-tree> <deployed-tree> [--allow-extra <path>:<type>]...");
    return 2;
  }
  let result;
  try {
    result = compareReleaseTree(expectedDir, actualDir, { allowExtra: parseAllowExtraArgs(rest) });
  } catch (cause) {
    // Usage and unreadable-tree errors, which are not comparison outcomes and must not read as one.
    error(`release tree verification could not run: ${cause.message}`);
    return 2;
  }
  for (const problem of result.problems) error(problem);
  if (result.ok) {
    // Says what was permitted rather than "nothing extra", which would be false whenever an allowance was
    // used -- and this line is the evidence a deploy would record.
    const extras = result.permitted.length > 0
      ? `${result.permitted.length} permitted extra(s): ${result.permitted.map(renderPath).join(", ")}`
      : "nothing extra";
    log(`release tree matches: all expected entries present, ${extras}`);
    return 0;
  }
  error(`release tree verification FAILED: ${result.problems.length} problem(s)`);
  return 1;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("verify-release-tree.mjs")) {
  process.exit(runCli(process.argv.slice(2)));
}
