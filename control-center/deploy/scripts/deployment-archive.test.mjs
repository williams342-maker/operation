import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import test from "node:test";
import { readTarGz, sha256, verifyEntries } from "../../scripts/deployment-archive-lib.mjs";

const repository = path.resolve(import.meta.dirname, "..", "..", "..");
const controlCenter = path.join(repository, "control-center");
const commit = execFileSync("git", ["-C", repository, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();

function build(output) {
  return JSON.parse(execFileSync(process.execPath, [path.join(controlCenter, "scripts", "build-deployment-archive.mjs"), "--commit", commit, "--output", output], { cwd: repository, encoding: "utf8", maxBuffer: 1024 * 1024 * 16 }));
}

test("deployment archive is deterministic and verifies exact committed shell bytes", { timeout: 120_000 }, () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "deployment-archive-test-"));
  try {
    const first = build(path.join(temp, "first"));
    const second = build(path.join(temp, "second"));
    assert.deepEqual(fs.readFileSync(first.archive), fs.readFileSync(second.archive));
    assert.deepEqual(fs.readFileSync(first.manifest), fs.readFileSync(second.manifest));
    const verified = spawnSync(process.execPath, [path.join(controlCenter, "scripts", "verify-deployment-archive.mjs"), "--archive", first.archive, "--manifest", first.manifest], { cwd: repository, encoding: "utf8" });
    assert.equal(verified.status, 0, verified.stderr);

    const manifest = JSON.parse(fs.readFileSync(first.manifest, "utf8"));
    const installerPath = "control-center/apps/web/public/install.sh";
    const installer = manifest.protectedShellFiles.find((file) => file.path === installerPath);
    assert.ok(installer);
    const blob = execFileSync("git", ["-C", repository, "cat-file", "blob", `${commit}:${installerPath}`]);
    assert.equal(installer.sha256, sha256(blob));
    assert.equal(installer.sha256, sha256(readTarGz(first.archive).get(installerPath).data));
    assert.equal(installer.lineEndings, "lf");
    assert.equal(blob.includes(Buffer.from("\r\n")), false);
    assert.equal(manifest.trackedFiles.some((file) => file.path.endsWith("staging-phase-2-fleet-agent-validation.md")), false);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
test("archive verification rejects changed, CRLF, missing, and extra protected files", { timeout: 120_000 }, () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "deployment-archive-tamper-"));
  try {
    const built = build(temp);
    const manifest = JSON.parse(fs.readFileSync(built.manifest, "utf8"));
    const installerPath = "control-center/apps/web/public/install.sh";
    const entries = readTarGz(built.archive);
    const crlf = new Map(entries);
    crlf.set(installerPath, { ...entries.get(installerPath), data: Buffer.from(entries.get(installerPath).data.toString("utf8").replaceAll("\n", "\r\n")) });
    assert.throws(() => verifyEntries(manifest, crlf), /shell bytes differ|CRLF/);
    const missing = new Map(entries); missing.delete(installerPath);
    assert.throws(() => verifyEntries(manifest, missing), /missing/);
    const extra = new Map(entries); extra.set("untracked-secret.env", { data: Buffer.from("synthetic"), mode: 0o600 });
    assert.throws(() => verifyEntries(manifest, extra), /unexpected/);
    const changedArchive = path.join(temp, "changed.tar.gz");
    const changed = fs.readFileSync(built.archive); changed[changed.length - 1] ^= 1; fs.writeFileSync(changedArchive, changed);
    const result = spawnSync(process.execPath, [path.join(controlCenter, "scripts", "verify-deployment-archive.mjs"), "--archive", changedArchive, "--manifest", built.manifest], { cwd: repository, encoding: "utf8" });
    assert.notEqual(result.status, 0);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
