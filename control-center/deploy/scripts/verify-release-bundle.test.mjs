import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  verifyReleaseBundle,
  parseSha256Sums,
  sha256Hex,
} from "../../scripts/verify-release-bundle.mjs";

// Build a minimal, self-consistent release-output/ directory in a temp dir.
function makeBundle({ tag = "v1.2.3-rc1", commit = "a".repeat(40), tamper = null, schema = "opsworkbench-release-v1" } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relbundle-"));
  const version = tag.slice(1);
  const artifact = `opsworkbench-control-center-${version}.tar.gz`;
  const manifestName = `opsworkbench-control-center-${version}.manifest.json`;
  const tarballBytes = Buffer.from("fake-deterministic-tarball-bytes");
  const manifest = { schemaVersion: schema, tag, commit, artifact, source: "test", reproducible: true };
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + "\n");
  fs.writeFileSync(path.join(dir, artifact), tarballBytes);
  fs.writeFileSync(path.join(dir, manifestName), manifestBytes);
  const sums =
    `${sha256Hex(tarballBytes)}  ${artifact}\n` +
    `${sha256Hex(manifestBytes)}  ${manifestName}\n`;
  fs.writeFileSync(path.join(dir, "SHA256SUMS"), sums);
  if (tamper === "tarball") fs.writeFileSync(path.join(dir, artifact), Buffer.from("MUTATED"));
  if (tamper === "remove-manifest") fs.rmSync(path.join(dir, manifestName));
  if (tamper === "remove-sums") fs.rmSync(path.join(dir, "SHA256SUMS"));
  return { dir, tag, commit, artifact, manifestName };
}

test("parseSha256Sums parses valid lines and flags malformed ones", () => {
  const parsed = parseSha256Sums(`${"a".repeat(64)}  file.tar.gz\nnot-a-checksum line\n`);
  assert.equal(parsed.length, 2);
  assert.deepEqual(parsed[0], { hash: "a".repeat(64), name: "file.tar.gz" });
  assert.equal(parsed[1], null);
});

test("a well-formed bundle verifies ok", () => {
  const { dir, tag } = makeBundle();
  const result = verifyReleaseBundle(dir, { expectedTag: tag });
  assert.equal(result.ok, true, JSON.stringify(result.problems));
  assert.equal(result.problems.length, 0);
  assert.equal(result.manifest.tag, tag);
});

test("a tampered artifact is rejected with a checksum mismatch", () => {
  const { dir, tag, artifact } = makeBundle({ tamper: "tarball" });
  const result = verifyReleaseBundle(dir, { expectedTag: tag });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes("checksum mismatch") && p.includes(artifact)));
});

test("a mismatched expected tag is rejected", () => {
  const { dir } = makeBundle({ tag: "v2.0.0-rc1" });
  const result = verifyReleaseBundle(dir, { expectedTag: "v9.9.9-rc1" });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes("manifest tag") && p.includes("v9.9.9-rc1")));
});

test("a bad manifest schemaVersion is rejected", () => {
  const { dir, tag } = makeBundle({ schema: "something-else" });
  const result = verifyReleaseBundle(dir, { expectedTag: tag });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes("schemaVersion")));
});

test("a non-40-char commit is rejected", () => {
  const { dir, tag } = makeBundle({ commit: "16e14682" });
  const result = verifyReleaseBundle(dir, { expectedTag: tag });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes("40-char SHA")));
});

test("a missing manifest is rejected", () => {
  const { dir, tag } = makeBundle({ tamper: "remove-manifest" });
  const result = verifyReleaseBundle(dir, { expectedTag: tag });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes("missing") || p.includes("manifest")));
});

test("a missing SHA256SUMS is rejected without throwing", () => {
  const { dir } = makeBundle({ tamper: "remove-sums" });
  const result = verifyReleaseBundle(dir);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes("SHA256SUMS")));
});
