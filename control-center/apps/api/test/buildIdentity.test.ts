import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveBuildIdentity } from "../src/buildIdentity.js";

function writeManifest(contents: unknown): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relman-"));
  const file = path.join(dir, "release.manifest.json");
  fs.writeFileSync(file, typeof contents === "string" ? contents : JSON.stringify(contents));
  return file;
}

const COMMIT = "0123456789abcdef0123456789abcdef01234567";

test("falls back to env identity when no release manifest is configured", () => {
  const id = resolveBuildIdentity({ BUILD_VERSION: "phase2-staging", GIT_COMMIT: "16e14682", GIT_BRANCH: "feat/x" } as NodeJS.ProcessEnv);
  assert.equal(id.source, "env");
  assert.equal(id.version, "phase2-staging");
  assert.equal(id.commit, "16e14682");
  assert.equal(id.branch, "feat/x");
});

test("binds identity to a valid release manifest (authoritative over env)", () => {
  const manifest = writeManifest({ schemaVersion: "opsworkbench-release-v1", tag: "v1.4.0-rc2", commit: COMMIT, artifact: "x.tar.gz" });
  const id = resolveBuildIdentity({ CONTROL_CENTER_RELEASE_MANIFEST: manifest, BUILD_VERSION: "ignored", GIT_COMMIT: "ignored", GIT_BRANCH: "release" } as NodeJS.ProcessEnv);
  assert.equal(id.source, "manifest");
  assert.equal(id.version, "1.4.0-rc2");
  assert.equal(id.commit, COMMIT);
  assert.equal(id.branch, "release");
});

test("falls back to env when the manifest path is set but the file is missing", () => {
  const id = resolveBuildIdentity({ CONTROL_CENTER_RELEASE_MANIFEST: path.join(os.tmpdir(), "does-not-exist-xyz.json"), BUILD_VERSION: "dev-fallback" } as NodeJS.ProcessEnv);
  assert.equal(id.source, "env");
  assert.equal(id.version, "dev-fallback");
});

test("rejects a manifest with the wrong schemaVersion and falls back to env", () => {
  const manifest = writeManifest({ schemaVersion: "something-else", tag: "v9.9.9-rc9", commit: COMMIT });
  const id = resolveBuildIdentity({ CONTROL_CENTER_RELEASE_MANIFEST: manifest, GIT_COMMIT: "envcommit" } as NodeJS.ProcessEnv);
  assert.equal(id.source, "env");
  assert.equal(id.commit, "envcommit");
});

test("rejects a manifest with a non-40-char commit or malformed JSON and falls back to env", () => {
  const shortCommit = writeManifest({ schemaVersion: "opsworkbench-release-v1", tag: "v1.0.0-rc1", commit: "abc123" });
  assert.equal(resolveBuildIdentity({ CONTROL_CENTER_RELEASE_MANIFEST: shortCommit, BUILD_VERSION: "envver" } as NodeJS.ProcessEnv).source, "env");
  const malformed = writeManifest("{ not valid json");
  assert.equal(resolveBuildIdentity({ CONTROL_CENTER_RELEASE_MANIFEST: malformed, BUILD_VERSION: "envver" } as NodeJS.ProcessEnv).source, "env");
});
