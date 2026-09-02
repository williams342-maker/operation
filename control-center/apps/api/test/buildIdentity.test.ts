import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveBuildIdentity, measureRuntimeDigest } from "../src/buildIdentity.js";

function writeManifest(contents: unknown): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relman-"));
  const file = path.join(dir, "release.manifest.json");
  fs.writeFileSync(file, typeof contents === "string" ? contents : JSON.stringify(contents));
  return file;
}

const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const DIGEST = "a".repeat(64);
const valid = { schemaVersion: "opsworkbench-release-v1", tag: "v1.4.0-rc2", commit: COMMIT, artifact: "x.tar.gz" };

test("no manifest configured is the development path, and says so", () => {
  const id = resolveBuildIdentity({ BUILD_VERSION: "phase2-staging", GIT_COMMIT: "16e14682", GIT_BRANCH: "feat/x" } as NodeJS.ProcessEnv, DIGEST);
  assert.equal(id.source, "env");
  assert.equal(id.version, "phase2-staging");
  assert.equal(id.commit, "16e14682");
  assert.equal(id.branch, "feat/x");
});

test("a valid manifest is authoritative over the environment", () => {
  const id = resolveBuildIdentity({ CONTROL_CENTER_RELEASE_MANIFEST: writeManifest(valid), BUILD_VERSION: "ignored", GIT_COMMIT: "ignored", GIT_BRANCH: "release" } as NodeJS.ProcessEnv, DIGEST);
  assert.equal(id.source, "manifest");
  assert.equal(id.version, "1.4.0-rc2");
  assert.equal(id.commit, COMMIT);
  assert.equal(id.branch, "release");
});

// ── Fail closed ─────────────────────────────────────────────────────────────────────────────────────
// The behaviour these replace: EVERY failure below used to return the environment values and report
// `source: "env"`, making "a manifest was configured and is broken" indistinguishable from "no manifest
// was configured" — and answering both with a string somebody typed at build time. That is the exact
// mechanism by which production once reported commit 16e14682, which exists in no object database.

test("REGRESSION: a configured-but-missing manifest fails closed instead of reporting env values", () => {
  const id = resolveBuildIdentity({ CONTROL_CENTER_RELEASE_MANIFEST: path.join(os.tmpdir(), "does-not-exist-xyz.json"), BUILD_VERSION: "dev-fallback", GIT_COMMIT: "envcommit" } as NodeJS.ProcessEnv, DIGEST);
  assert.equal(id.source, "unverified");
  assert.equal(id.version, "unknown");
  assert.equal(id.commit, "unknown");
  assert.notEqual(id.commit, "envcommit", "the environment value must not leak through a failure");
});

test("REGRESSION: malformed, wrong-schema, and bad-commit manifests all fail closed", () => {
  const cases: Array<[string, unknown]> = [
    ["malformed json", "{ not valid json"],
    ["wrong schemaVersion", { ...valid, schemaVersion: "something-else" }],
    ["short commit", { ...valid, commit: "abc123" }],
    ["uppercase commit", { ...valid, commit: COMMIT.toUpperCase() }],
    ["missing tag", { schemaVersion: "opsworkbench-release-v1", commit: COMMIT }],
    ["tag without v prefix", { ...valid, tag: "1.4.0" }],
    ["commit not a string", { ...valid, commit: 12345 }]
  ];
  for (const [label, contents] of cases) {
    const id = resolveBuildIdentity({ CONTROL_CENTER_RELEASE_MANIFEST: writeManifest(contents), BUILD_VERSION: "envver", GIT_COMMIT: "envcommit" } as NodeJS.ProcessEnv, DIGEST);
    assert.equal(id.source, "unverified", `${label} must fail closed`);
    assert.equal(id.commit, "unknown", `${label} must not report the env commit`);
  }
});

// ── Measured runtime digest ─────────────────────────────────────────────────────────────────────────

test("the runtime digest is reported on every path, because it is measured rather than declared", () => {
  assert.equal(resolveBuildIdentity({} as NodeJS.ProcessEnv, DIGEST).runtimeDigest, DIGEST);
  assert.equal(resolveBuildIdentity({ CONTROL_CENTER_RELEASE_MANIFEST: writeManifest(valid) } as NodeJS.ProcessEnv, DIGEST).runtimeDigest, DIGEST);
  assert.equal(resolveBuildIdentity({ CONTROL_CENTER_RELEASE_MANIFEST: "/nope" } as NodeJS.ProcessEnv, DIGEST).runtimeDigest, DIGEST);
});

test("a manifest declaring the wrong runtime digest fails closed", () => {
  // This is the check that binds the CLAIM to the CODE. Without it a manifest proves only that somebody
  // wrote a well-formed file.
  const manifest = writeManifest({ ...valid, runtimeSha256: "b".repeat(64) });
  const id = resolveBuildIdentity({ CONTROL_CENTER_RELEASE_MANIFEST: manifest } as NodeJS.ProcessEnv, DIGEST);
  assert.equal(id.source, "unverified");
  assert.equal(id.commit, "unknown");
});

test("a manifest declaring the correct runtime digest verifies", () => {
  const manifest = writeManifest({ ...valid, runtimeSha256: DIGEST });
  const id = resolveBuildIdentity({ CONTROL_CENTER_RELEASE_MANIFEST: manifest } as NodeJS.ProcessEnv, DIGEST);
  assert.equal(id.source, "manifest");
  assert.equal(id.commit, COMMIT);
});

test("an expectation that cannot be evaluated is a failure, not a pass", () => {
  // No measurable digest (development under tsx) plus a manifest that declares one. An unverifiable
  // claim must never read as a verified one.
  const manifest = writeManifest({ ...valid, runtimeSha256: DIGEST });
  // `null` means "measurement attempted and failed". Passing `undefined` would select the default
  // parameter and silently use the module's own digest — which is why the sentinel exists at all, and
  // why this case was untestable before it did.
  const id = resolveBuildIdentity({ CONTROL_CENTER_RELEASE_MANIFEST: manifest } as NodeJS.ProcessEnv, null);
  assert.equal(id.source, "unverified");
  assert.equal(id.runtimeDigest, undefined);
});

test("a malformed runtimeSha256 fails closed rather than being ignored", () => {
  const manifest = writeManifest({ ...valid, runtimeSha256: "not-a-digest" });
  assert.equal(resolveBuildIdentity({ CONTROL_CENTER_RELEASE_MANIFEST: manifest } as NodeJS.ProcessEnv, DIGEST).source, "unverified");
});

// ── The measurement itself ──────────────────────────────────────────────────────────────────────────

test("measureRuntimeDigest is stable, content-sensitive, and layout-sensitive", () => {
  const build = (files: Array<[string, string]>) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-"));
    for (const [name, body] of files) {
      fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
      fs.writeFileSync(path.join(dir, name), body);
    }
    return dir;
  };
  const base: Array<[string, string]> = [["index.js", "export const a = 1;"], ["lib/util.js", "export const b = 2;"]];

  const first = measureRuntimeDigest(build(base));
  assert.match(String(first), /^[a-f0-9]{64}$/);
  assert.equal(measureRuntimeDigest(build(base)), first, "identical trees must digest identically");

  // Content change.
  assert.notEqual(measureRuntimeDigest(build([["index.js", "export const a = 2;"], base[1]])), first);
  // Same total bytes, different layout — the path is hashed alongside the content for exactly this case.
  assert.notEqual(measureRuntimeDigest(build([["index.js", "export const b = 2;"], ["lib/util.js", "export const a = 1;"]])), first);
  // Non-JavaScript files are ignored, so a stray log or source map does not move the digest.
  assert.equal(measureRuntimeDigest(build([...base, ["notes.txt", "irrelevant"], ["index.js.map", "{}"]])), first);
});

test("measureRuntimeDigest returns undefined rather than throwing when it cannot measure", () => {
  assert.equal(measureRuntimeDigest(path.join(os.tmpdir(), "definitely-not-here-xyz")), undefined);
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-empty-"));
  assert.equal(measureRuntimeDigest(empty), undefined, "an empty tree is unmeasurable, not a valid digest");
  const file = path.join(empty, "f.js");
  fs.writeFileSync(file, "x");
  assert.equal(measureRuntimeDigest(file), undefined, "a file is not a runtime root");
});

test("the digest of this package's own build is measurable and well-formed", () => {
  // Guards against the measurement silently returning undefined in the shipped layout, which would make
  // every runtimeSha256 expectation unevaluable and therefore permanently unverified.
  const dist = path.join(import.meta.dirname, "..", "dist");
  if (!fs.existsSync(dist)) return; // not built in this run
  assert.match(String(measureRuntimeDigest(dist)), /^[a-f0-9]{64}$/);
});

test("the reported digest is a real sha256 of real bytes, not a placeholder", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-known-"));
  fs.writeFileSync(path.join(dir, "only.js"), "x");
  const expected = crypto.createHash("sha256").update("root:0\0").update("only.js").update("\0").update(Buffer.from("x")).update("\0").digest("hex");
  assert.equal(measureRuntimeDigest(dir), expected);
});

test("multiple roots are hashed distinctly, so identical files cannot collide across them", () => {
  const mk = (body: string) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-multi-"));
    fs.writeFileSync(path.join(dir, "same.js"), body);
    return dir;
  };
  const a = mk("export const x = 1;");
  const b = mk("export const x = 1;");
  // The two roots hold byte-identical files. Order must still matter, and the pair must not digest as
  // either root alone — otherwise a dropped root would go unnoticed.
  const ab = measureRuntimeDigest([a, b]);
  assert.match(String(ab), /^[a-f0-9]{64}$/);
  // Dropping a root must be detectable.
  assert.notEqual(ab, measureRuntimeDigest(a));
  // Byte-identical roots in either order digest the same, and that is CORRECT: the measurement is of
  // content, not of which temporary directory it came from. Asserting order-sensitivity here would be
  // asserting a property we do not actually want.
  assert.equal(ab, measureRuntimeDigest([b, a]));
  // The root boundary itself must be part of the hash, or two roots of one file each would collide with
  // one root of two identical files. That is what the `root:<index>` prefix is for.
  const merged = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-merged-"));
  fs.writeFileSync(path.join(merged, "same.js"), "export const x = 1;");
  fs.writeFileSync(path.join(merged, "same2.js"), "export const x = 1;");
  assert.notEqual(ab, measureRuntimeDigest(merged));
});

test("an unmeasurable root is skipped, but a wholly unmeasurable set is undefined", () => {
  const real = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-mix-"));
  fs.writeFileSync(path.join(real, "a.js"), "export const a = 1;");
  const missing = path.join(os.tmpdir(), "definitely-absent-xyz");
  // A missing second root must not void the measurement of the first...
  assert.equal(measureRuntimeDigest([real, missing]), measureRuntimeDigest([real]));
  // ...but nothing measurable at all is undefined, never a digest of emptiness.
  assert.equal(measureRuntimeDigest([missing, path.join(os.tmpdir(), "also-absent-xyz")]), undefined);
});
