import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { walkSameDevice } from "../src/discoverySafety.js";
import { validateDeploymentPath } from "../src/configurationDeployment.js";

test("Linux discovery rejects bind and separate mounts", { skip: process.platform !== "linux" || process.env.CONTROL_CENTER_RUN_PRIVILEGED_FS_TESTS !== "true" }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ops-linux-discovery-")); const source = fs.mkdtempSync(path.join(os.tmpdir(), "ops-bind-source-")); const bind = path.join(root, "bind"); const separate = path.join(root, "separate"); fs.mkdirSync(bind); fs.mkdirSync(separate);
  try { execFileSync("sudo", ["mount", "--bind", source, bind]); execFileSync("sudo", ["mount", "-t", "tmpfs", "-o", "size=1m", "tmpfs", separate]); const result = walkSameDevice(root); assert.equal(result.directories.includes(fs.realpathSync(bind)), false); assert.equal(result.directories.includes(fs.realpathSync(separate)), false); assert.ok(result.warnings.includes("mount_boundary_skipped")); }
  finally { for (const target of [separate, bind]) { try { execFileSync("sudo", ["umount", target]); } catch { /* cleanup best effort */ } } fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(source, { recursive: true, force: true }); }
});

test("Linux configuration deployment rejects bind and separate mounts", { skip: process.platform !== "linux" || process.env.CONTROL_CENTER_RUN_PRIVILEGED_FS_TESTS !== "true" }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ops-linux-deploy-")); const source = fs.mkdtempSync(path.join(os.tmpdir(), "ops-deploy-source-")); const bind = path.join(root, "bind"); const separate = path.join(root, "separate"); fs.mkdirSync(bind); fs.mkdirSync(separate);
  try { execFileSync("sudo", ["mount", "--bind", source, bind]); execFileSync("sudo", ["mount", "-t", "tmpfs", "-o", "size=1m", "tmpfs", separate]); assert.throws(() => validateDeploymentPath(root, path.join(bind, ".env")), /Mount-boundary/); assert.throws(() => validateDeploymentPath(root, path.join(separate, ".env")), /Mount-boundary/); }
  finally { for (const target of [separate, bind]) { try { execFileSync("sudo", ["umount", target]); } catch { /* cleanup best effort */ } } fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(source, { recursive: true, force: true }); }
});
