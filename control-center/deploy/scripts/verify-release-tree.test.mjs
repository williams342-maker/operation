import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compareReleaseTree, describeTree } from "../../scripts/verify-release-tree.mjs";

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

test("an untouched copy matches", () => {
  const expected = artifact();
  const result = compareReleaseTree(expected, copy(expected));
  assert.deepEqual(result.problems, []);
  assert.equal(result.ok, true);
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

test("A SYMLINK WHERE A FILE WAS is a type mismatch, not a match on the name", () => {
  // The reason the comparison carries types at all. A name-only check accepts this, and a symlink is an
  // instruction to read something else entirely — including something outside the tree.
  const expected = artifact();
  const deployed = copy(expected);
  const target = path.join(deployed, "package.json");
  fs.rmSync(target);
  try {
    fs.symlinkSync(path.join(deployed, "apps/api/src/server.ts"), target);
  } catch {
    return; // unprivileged Windows cannot create symlinks; the Linux CI run covers this
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

test("allowExtra permits a known addition and nothing else", () => {
  // The escape hatch a real caller needs — a runtime-written file, say — and the assertion that it is an
  // allowlist rather than a mute button.
  const expected = artifact();
  const deployed = copy(expected);
  write(deployed, "runtime.log", "started\n");
  write(deployed, "unexpected.conf", "\n");
  const result = compareReleaseTree(expected, deployed, { allowExtra: ["runtime.log"] });
  assert.deepEqual(result.extra, ["unexpected.conf"]);
  assert.equal(result.ok, false);
});

test("describeTree records POSIX-separated paths so a Windows tree compares to a Linux one", () => {
  // Without this every path differs by separator and the comparison reports the whole tree as both missing
  // and extra — which looks like a catastrophic failure rather than a bug in the checker.
  const entries = describeTree(artifact());
  assert.ok(entries.has("apps/api/src/server.ts"));
  assert.equal([...entries.keys()].some((key) => key.includes("\\")), false);
});
