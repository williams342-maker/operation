import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..", "..");
const repositoryRoot = path.resolve(root, "..");

const protectedShellScripts = [
  "apps/web/public/install.sh",
  "scripts/bootstrap-agent-release.sh",
  "scripts/build-release-artifacts.sh",
  "scripts/linux-agent-upgrade-dry-run.sh",
  "scripts/rollback-agent-bootstrap.sh",
  "scripts/verify-release-artifacts.sh"
];

test("repository pins shell scripts to LF line endings", () => {
  const attributes = fs.readFileSync(path.join(repositoryRoot, ".gitattributes"), "utf8");
  assert.match(attributes, /^\*\.sh text eol=lf$/m);
});

test("protected shell scripts are LF-only in the working tree", () => {
  for (const relative of protectedShellScripts) {
    const file = path.join(root, relative);
    const source = fs.readFileSync(file);
    assert.equal(source.includes(13), false, `${relative} contains CR bytes`);
  }
});
