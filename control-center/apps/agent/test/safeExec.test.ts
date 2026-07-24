import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execNodeForTest } from "../src/safeExec.js";

process.env.NODE_ENV = "test";
test("bounded process returns normal output", async () => { const result = await execNodeForTest("process.stdout.write('ok')"); assert.deepEqual({ stdout: result.stdout, code: result.code, error: result.errorCategory }, { stdout: "ok", code: 0, error: undefined }); });
test("bounded process is terminated on timeout without leaking output", async () => { const started = Date.now(); const result = await execNodeForTest("process.stdout.write('sensitive');setTimeout(()=>{},10000)", 100); assert.equal(result.errorCategory, "timeout"); assert.equal(result.stdout, ""); assert.equal(result.stderr, ""); assert.ok(Date.now() - started < 3000); });
test("bounded process timeout terminates child process group", { skip: process.platform === "win32" }, async () => {
  const pidFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "control-center-safe-exec-")), "child.pid");
  const childSource = `require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 10000);`;
  const parentSource = `require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(childSource)}], { stdio: "ignore" }); setInterval(() => {}, 10000);`;
  const result = await execNodeForTest(parentSource, 100);
  assert.equal(result.errorCategory, "timeout");
  const childPid = Number(fs.readFileSync(pidFile, "utf8"));
  await new Promise((resolve) => setTimeout(resolve, 250));
  try {
    process.kill(childPid, 0);
    process.kill(childPid, "SIGKILL");
    assert.fail("child process remained after timeout");
  } catch (error) {
    assert.equal((error as NodeJS.ErrnoException).code, "ESRCH");
  }
});
test("stdout overflow is terminated and scrubbed", async () => { const result = await execNodeForTest("process.stdout.write('x'.repeat(20000))"); assert.equal(result.errorCategory, "output_limit"); assert.equal(result.stdout, ""); assert.equal(result.stderr, ""); });
test("stderr overflow is terminated and scrubbed", async () => { const result = await execNodeForTest("process.stderr.write('x'.repeat(20000))"); assert.equal(result.errorCategory, "output_limit"); assert.equal(result.stdout, ""); assert.equal(result.stderr, ""); });
test("combined output stays bounded", async () => { const result = await execNodeForTest("process.stdout.write('x'.repeat(12000));process.stderr.write('y'.repeat(12000))"); assert.ok(Buffer.byteLength(result.stdout) <= 16384); assert.ok(Buffer.byteLength(result.stderr) <= 16384); });
test("failure output is scrubbed", async () => { const result = await execNodeForTest("process.stderr.write('sensitive');process.exit(2)"); assert.equal(result.errorCategory, "exit_failure"); assert.equal(result.stdout, ""); assert.equal(result.stderr, ""); });
