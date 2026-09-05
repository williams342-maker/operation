import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  compareReleaseTree,
  describeTree,
  parseAllowExtraArgs,
  runCli
} from "../../scripts/verify-release-tree.mjs";

// Gap G6 — the check that would have caught the production overlay.
//
// The case that motivates every assertion below is real and is the reason this file exists: on 2026-09-05
// the deployed release directory contained all 253 files of the attested artifact, byte-identical, AND two
// more that were in no commit of this repository, with a live container built from them. Every check that
// walked the manifest passed, because a check that walks the manifest cannot see a file the manifest does
// not name.

const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), "release-tree-"));
const write = (root, relative, content) => {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
};

// A minimal stand-in for an extracted artifact: nested, so the walk is actually recursive.
function artifact() {
  const dir = scratch();
  write(dir, "package.json", '{"name":"x"}\n');
  write(dir, "apps/api/src/server.ts", "export const x = 1;\n");
  write(dir, "deploy/nginx/web.conf", "server { listen 8080; }\n");
  return dir;
}
const copy = (from) => {
  const dir = scratch();
  fs.cpSync(from, dir, { recursive: true });
  return dir;
};
// Symlink creation needs privilege or developer mode on Windows. Returns false when it is unavailable so a
// case can skip VISIBLY rather than returning early and reporting itself as passed.
const trySymlink = (target, at) => {
  try {
    fs.symlinkSync(target, at);
    return true;
  } catch {
    return false;
  }
};

test("an untouched copy matches", () => {
  const expected = artifact();
  const result = compareReleaseTree(expected, copy(expected));
  assert.deepEqual(result.problems, []);
  assert.equal(result.ok, true);
  assert.deepEqual(result.permitted, []);
});

test("THE PRODUCTION CASE: every expected file present and identical, plus one the artifact never had", () => {
  const expected = artifact();
  const deployed = copy(expected);
  // Exactly the shape of the real overlay: added after the copy, in a directory the artifact does have.
  write(deployed, "deploy/nginx/admin-web.conf", "server { listen 8080; }\n");

  const result = compareReleaseTree(expected, deployed);
  // The half every manifest-walking check already gets right, asserted so the test cannot pass by finding
  // the tree broken in some other way.
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.mismatched, []);
  // The half none of them can see.
  assert.deepEqual(result.extra, ["deploy/nginx/admin-web.conf"]);
  assert.equal(result.ok, false);
  assert.match(result.problems[0], /NOT in the artifact, so outside its provenance/);
});

test("a file deleted from the deployed tree is missing, not silently tolerated", () => {
  const expected = artifact();
  const deployed = copy(expected);
  fs.rmSync(path.join(deployed, "apps/api/src/server.ts"));
  const result = compareReleaseTree(expected, deployed);
  assert.deepEqual(result.missing, ["apps/api/src/server.ts"]);
  assert.equal(result.ok, false);
});

test("edited content is caught even though the path is unchanged", () => {
  const expected = artifact();
  const deployed = copy(expected);
  write(deployed, "apps/api/src/server.ts", "export const x = 2;\n");
  const result = compareReleaseTree(expected, deployed);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.extra, []);
  assert.deepEqual(result.mismatched, [{ path: "apps/api/src/server.ts", reason: "content differs" }]);
});

test("A SYMLINK WHERE A FILE WAS is a type mismatch, not a match on the name", (t) => {
  // The reason the comparison carries types at all. A name-only check accepts this, and a symlink is an
  // instruction to read something else entirely — including something outside the tree.
  const expected = artifact();
  const deployed = copy(expected);
  const target = path.join(deployed, "package.json");
  fs.rmSync(target);
  if (!trySymlink(path.join(deployed, "apps/api/src/server.ts"), target)) {
    t.skip("this host cannot create symlinks; Linux CI runs this case");
    return;
  }
  const result = compareReleaseTree(expected, deployed);
  assert.deepEqual(result.mismatched, [{ path: "package.json", reason: "expected file, found symlink" }]);
  assert.equal(result.ok, false);
});

test("a directory standing in for a file is a type mismatch too", () => {
  const expected = artifact();
  const deployed = copy(expected);
  fs.rmSync(path.join(deployed, "package.json"));
  fs.mkdirSync(path.join(deployed, "package.json"));
  const result = compareReleaseTree(expected, deployed);
  assert.deepEqual(result.mismatched, [{ path: "package.json", reason: "expected file, found directory" }]);
});

test("an extra DIRECTORY is reported, not only extra files", () => {
  const expected = artifact();
  const deployed = copy(expected);
  fs.mkdirSync(path.join(deployed, "vendor"));
  const result = compareReleaseTree(expected, deployed);
  assert.deepEqual(result.extra, ["vendor"]);
});

test("allowExtra permits a known addition, records it, and still refuses another", () => {
  // The escape hatch a real caller needs — a runtime-written file, say — and the assertion that it is an
  // allowlist rather than a mute button.
  const expected = artifact();
  const deployed = copy(expected);
  write(deployed, "runtime.log", "started\n");
  write(deployed, "unexpected.conf", "\n");
  const result = compareReleaseTree(expected, deployed, { allowExtra: [{ path: "runtime.log", type: "file" }] });
  assert.deepEqual(result.extra, ["unexpected.conf"]);
  assert.deepEqual(result.permitted, ["runtime.log"]);
  assert.equal(result.ok, false);
});

test("AN ALLOWANCE IS TYPED: the permitted path arriving as a symlink is a mismatch, not a pass", (t) => {
  // The finding that made allowances typed. A bare path would have let `runtime.log` arrive as a symlink
  // pointing anywhere — the exact substitution the type comparison exists to catch, waved through by the
  // escape hatch.
  const expected = artifact();
  const deployed = copy(expected);
  if (!trySymlink(path.join(deployed, "package.json"), path.join(deployed, "runtime.log"))) {
    t.skip("this host cannot create symlinks; Linux CI runs this case");
    return;
  }
  const result = compareReleaseTree(expected, deployed, { allowExtra: [{ path: "runtime.log", type: "file" }] });
  assert.deepEqual(result.permitted, []);
  assert.deepEqual(result.mismatched, [{ path: "runtime.log", reason: "permitted as file, found symlink" }]);
  assert.equal(result.ok, false);
});

test("an allowed DIRECTORY does not implicitly allow what is inside it", () => {
  // "Allow this directory" is otherwise indistinguishable from "allow anything anyone puts in it".
  const expected = artifact();
  const deployed = copy(expected);
  fs.mkdirSync(path.join(deployed, "state"));
  write(deployed, "state/secret.env", "TOKEN=x\n");
  const result = compareReleaseTree(expected, deployed, { allowExtra: [{ path: "state", type: "directory" }] });
  assert.deepEqual(result.permitted, ["state"]);
  assert.deepEqual(result.extra, ["state/secret.env"]);
  assert.equal(result.ok, false);
});

test("a bare string allowance is refused outright rather than silently weakened", () => {
  const expected = artifact();
  assert.throws(
    () => compareReleaseTree(expected, copy(expected), { allowExtra: ["runtime.log"] }),
    /must be \{path, type\}/
  );
});

test("describeTree records POSIX-separated paths so a Windows tree compares to a Linux one", () => {
  // Without this every path differs by separator and the comparison reports the whole tree as both missing
  // and extra — which looks like a catastrophic failure rather than a bug in the checker.
  const entries = describeTree(artifact());
  assert.ok(entries.has("apps/api/src/server.ts"));
  assert.equal([...entries.keys()].some((key) => key.includes("\\")), false);
});

test("an 'other' node is never equal to another 'other' node at the same path", () => {
  // Sockets, fifos and devices. Nothing here establishes their identity, and "same unknown kind" is not
  // "same thing", so the comparison must refuse rather than accept by type equality.
  const expected = new Map([["dev/thing", { type: "other", mode: 4516 }]]);
  const actual = new Map([["dev/thing", { type: "other", mode: 4516 }]]);
  const result = compareReleaseTree(expected, actual);
  assert.equal(result.ok, false);
  assert.match(result.mismatched[0].reason, /identity cannot be established/);
});

test("an UNEXPECTED 'other' node is reported ONCE, with its type, and cannot be allowed", () => {
  // `other` is not an allowable type, so there is no way to permit one. It is reported as an extra rather
  // than as both an extra and a mismatch: an earlier version double-counted and said "2 problems" for one
  // filesystem entry.
  const result = compareReleaseTree(new Map(), new Map([["sock", { type: "other", mode: 4516 }]]));
  assert.deepEqual(result.extra, ["sock"]);
  assert.deepEqual(result.mismatched, []);
  assert.equal(result.problems.length, 1);
  assert.match(result.problems[0], /outside its provenance: \"sock\" \(other\)/);
  assert.equal(result.ok, false);
});

test("A SYMLINK ALLOWANCE IS REFUSED OUTRIGHT, because the type would be checked and the target would not", () => {
  // The finding this rejection exists for: `{path, type: "symlink"}` reads as safe and permits a link at
  // that path pointing ANYWHERE, in the tree or out of it — the exact substitution the module refuses.
  assert.throws(
    () => compareReleaseTree(new Map(), new Map(), { allowExtra: [{ path: "link", type: "symlink" }] }),
    /permitting a link to anywhere/
  );
});

// Every value below would otherwise be a SILENT NO-OP: it can never match a path describeTree produces, so
// verification passes while the caller believes their allowance is in effect. That is worse than a refusal.
for (const [label, entry, expected] of [
  ["an unknown type", { path: "runtime.log", type: "regular-file" }, /type must be one of file, directory/],
  ["an absolute POSIX path", { path: "/runtime.log", type: "file" }, /must be relative/],
  ["a Windows drive path", { path: "C:/runtime.log", type: "file" }, /must be relative/],
  ["a backslash separator", { path: "state\\runtime.log", type: "file" }, /must use "\/" separators/],
  ["a trailing separator", { path: "state/", type: "directory" }, /must not end with a separator/],
  ["a parent segment", { path: "../runtime.log", type: "file" }, /no "\." or "\.\." segments/],
  ["a current-directory segment", { path: "./runtime.log", type: "file" }, /no "\." or "\.\." segments/],
  ["an empty segment", { path: "state//runtime.log", type: "file" }, /no "\." or "\.\." segments/]
]) {
  test(`an allowance with ${label} is refused rather than silently doing nothing`, () => {
    assert.throws(() => compareReleaseTree(new Map(), new Map(), { allowExtra: [entry] }), expected);
  });
}

test("an allowance containing a NUL is refused: no path from readdir can ever contain one", () => {
  assert.throws(
    () => compareReleaseTree(new Map(), new Map(), {
      allowExtra: [{ path: `runtime${String.fromCharCode(0)}.log`, type: "file" }]
    }),
    /must not contain a NUL/
  );
});

test("a trailing space is NOT refused, because it is a filename that can genuinely match", () => {
  // The counterpart to the rejections above, asserted so the validator cannot drift into refusing valid
  // Linux names. "runtime.log " is a different file from "runtime.log" and an allowance for it is real.
  const result = compareReleaseTree(new Map(), new Map([["runtime.log ", { type: "file", sha256: "x" }]]), {
    allowExtra: [{ path: "runtime.log ", type: "file" }]
  });
  assert.deepEqual(result.permitted, ["runtime.log "]);
  assert.equal(result.ok, true);
});

test("two allowances for one path are refused rather than last-write-wins", () => {
  assert.throws(
    () => compareReleaseTree(new Map(), new Map(), {
      allowExtra: [{ path: "runtime.log", type: "file" }, { path: "runtime.log", type: "directory" }]
    }),
    /names "runtime\.log" more than once/
  );
});

// ── Evidence integrity ──────────────────────────────────────────────────────────────────────────────
// A Linux filename may contain a newline, a carriage return, a tab or a terminal escape. These strings
// become the evidence a deploy records, so an unescaped one lets the thing being caught edit the record of
// catching it. Driven through Maps rather than real files: the point is portable, and Windows cannot create
// most of these names.

test("A FILENAME CANNOT FORGE A LOG LINE: newlines in an extra path are escaped, not printed", () => {
  const hostile = `ok${String.fromCharCode(10)}release tree matches: all expected entries present, nothing extra`;
  const result = compareReleaseTree(new Map(), new Map([[hostile, { type: "file", sha256: "x" }]]));
  assert.equal(result.problems.length, 1);
  // The literal newline must not survive into the message, or this one extra file prints as two lines and
  // the second is a forged success.
  assert.equal(result.problems[0].includes(String.fromCharCode(10)), false);
  assert.match(result.problems[0], /outside its provenance: "ok\\nrelease tree matches/);
  // And the comparison key itself is untouched — escaping is for output only.
  assert.equal(result.extra[0], hostile);
});

test("terminal escape sequences in a path are escaped in problem output", () => {
  const hostile = `${String.fromCharCode(27)}[2Kinnocent.txt`;
  const result = compareReleaseTree(new Map(), new Map([[hostile, { type: "file", sha256: "x" }]]));
  assert.equal(result.problems[0].includes(String.fromCharCode(27)), false);
  assert.match(result.problems[0], /\\u001b\[2Kinnocent\.txt/);
});

test("BIDI CONTROLS ARE ESCAPED: JSON.stringify leaves them active and they reorder what is displayed", (t) => {
  // The category JSON quoting does not cover. U+202E RIGHT-TO-LEFT OVERRIDE survives it intact, and a
  // reader of the evidence sees the path in a different order than it is stored in — an unexpected
  // `exe.conf` can display as `fnoc.exe`. Homoglyphs and ordinary non-ASCII are deliberately left alone.
  const rlo = String.fromCharCode(0x202e);
  const hostile = `deploy/${rlo}fnoc.exe`;
  const result = compareReleaseTree(new Map(), new Map([[hostile, { type: "file", sha256: "x" }]]));
  assert.equal(result.problems[0].includes(rlo), false, "the raw override must not reach the output");
  assert.match(result.problems[0], /\\u202e/);
  assert.equal(result.extra[0], hostile, "the comparison key keeps the real bytes");
  t.diagnostic(result.problems[0]);
});

test("ordinary non-ASCII survives rendering, because escaping it would only hurt a real reader", () => {
  const result = compareReleaseTree(new Map(), new Map([["docs/café-naïve.md", { type: "file", sha256: "x" }]]));
  assert.match(result.problems[0], /café-naïve\.md/);
});

test("a hostile MISSING path and a hostile mismatch are escaped too, not just extras", () => {
  const hostile = `a${String.fromCharCode(10)}b`;
  const missing = compareReleaseTree(new Map([[hostile, { type: "file", sha256: "x" }]]), new Map());
  assert.equal(missing.problems[0].includes(String.fromCharCode(10)), false);

  const mismatch = compareReleaseTree(
    new Map([[hostile, { type: "file", sha256: "x" }]]),
    new Map([[hostile, { type: "file", sha256: "y" }]])
  );
  assert.equal(mismatch.problems[0].includes(String.fromCharCode(10)), false);
  assert.match(mismatch.problems[0], /content differs/);
});

test("a hostile SYMLINK TARGET is escaped: it is read off the deployed tree too", () => {
  const target = `x${String.fromCharCode(10)}release tree matches`;
  const result = compareReleaseTree(
    new Map([["link", { type: "symlink", target: "safe" }]]),
    new Map([["link", { type: "symlink", target }]])
  );
  assert.equal(result.problems[0].includes(String.fromCharCode(10)), false);
});

test("CLI: a permitted extra with a hostile name is escaped in the SUCCESS line", (t) => {
  // The success line is the one a deploy files as proof. Forging inside it is the higher-value attack.
  const hostile = `runtime${String.fromCharCode(10)}FAILED: 0 problems.log`;
  const dir = scratch();
  try {
    fs.writeFileSync(path.join(dir, hostile), "x");
  } catch {
    t.skip("this host cannot create a filename containing a newline; Linux CI runs this case");
    return;
  }
  const out = [];
  runCli([scratch(), dir, "--allow-extra", `${hostile}:file`], { log: (l) => out.push(l), error: () => {} });
  assert.equal(out.length, 1);
  assert.equal(out[0].includes(String.fromCharCode(10)), false);
});

// ── CLI contract ────────────────────────────────────────────────────────────────────────────────────
// Exercised through `runCli` rather than a subprocess: `node --test` already spawns per file and has died
// with EPERM inside review sandboxes, so a CLI whose only test is a subprocess is one that quietly goes
// unverified there.

const captureCli = (argv) => {
  const out = [];
  const err = [];
  const code = runCli(argv, { log: (line) => out.push(line), error: (line) => err.push(line) });
  return { code, out, err };
};

test("CLI: exit 0 and a truthful success line when the trees match", () => {
  const expected = artifact();
  const run = captureCli([expected, copy(expected)]);
  assert.equal(run.code, 0);
  assert.match(run.out[0], /release tree matches: all expected entries present, nothing extra/);
});

test("CLI: a permitted extra is REPORTED, never described as 'nothing extra'", () => {
  // The success line is the evidence a deploy would record. Saying "nothing extra" while an allowance was
  // used would put a false claim of exact equality into that record.
  const expected = artifact();
  const deployed = copy(expected);
  write(deployed, "runtime.log", "started\n");
  const run = captureCli([expected, deployed, "--allow-extra", "runtime.log:file"]);
  assert.equal(run.code, 0);
  assert.match(run.out[0], /1 permitted extra\(s\): \"runtime\.log\"/);
  assert.doesNotMatch(run.out[0], /nothing extra/);
});

test("CLI: exit 1 and the offending path on a real difference", () => {
  const expected = artifact();
  const deployed = copy(expected);
  write(deployed, "deploy/nginx/admin-web.conf", "server { listen 8080; }\n");
  const run = captureCli([expected, deployed]);
  assert.equal(run.code, 1);
  assert.ok(run.err.some((line) => line.includes("deploy/nginx/admin-web.conf")));
  assert.match(run.err.at(-1), /FAILED: 1 problem/);
});

test("CLI: exit 2 for usage, which must not be confused with a clean tree", () => {
  const run = captureCli([]);
  assert.equal(run.code, 2);
  assert.match(run.err[0], /^usage:/);
  assert.deepEqual(run.out, []);
});

test("CLI: exit 2 when the tree cannot be read, rather than reporting it as a difference", () => {
  const run = captureCli([path.join(os.tmpdir(), "release-tree-does-not-exist"), artifact()]);
  assert.equal(run.code, 2);
  assert.match(run.err[0], /could not run/);
});

test("CLI: a malformed --allow-extra is a usage error, not a silently ignored flag", () => {
  const expected = artifact();
  const run = captureCli([expected, copy(expected), "--allow-extra", "runtime.log"]);
  assert.equal(run.code, 2);
  assert.match(run.err[0], /could not run: .*<path>:<type>/);
});

test("parseAllowExtraArgs splits on the LAST colon so a path may contain one", () => {
  assert.deepEqual(parseAllowExtraArgs(["--allow-extra", "a:b/c.log:file"]), [{ path: "a:b/c.log", type: "file" }]);
});

test("CLI: a MISTYPED option is exit 2, not silently ignored", () => {
  // Skipping unknown tokens meant `--allow-exrta runtime.log:file` was quietly dropped and the run could
  // still exit 0 — a typo in a security allowance reading as success.
  const expected = artifact();
  const deployed = copy(expected);
  write(deployed, "runtime.log", "started\n");
  const run = captureCli([expected, deployed, "--allow-exrta", "runtime.log:file"]);
  assert.equal(run.code, 2);
  assert.match(run.err[0], /unknown option "--allow-exrta"/);
});

test("CLI: a stray operand is exit 2", () => {
  const expected = artifact();
  const run = captureCli([expected, copy(expected), "extra-thing"]);
  assert.equal(run.code, 2);
  assert.match(run.err[0], /unexpected argument "extra-thing"/);
});

test("CLI: a symlink allowance is refused at the command line too", () => {
  const expected = artifact();
  const run = captureCli([expected, copy(expected), "--allow-extra", "link:symlink"]);
  assert.equal(run.code, 2);
  assert.match(run.err[0], /permitting a link to anywhere/);
});
