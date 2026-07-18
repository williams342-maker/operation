import assert from "node:assert/strict";
import test from "node:test";
import { execNodeForTest } from "../src/safeExec.js";

process.env.NODE_ENV = "test";
test("bounded process returns normal output", async () => { const result = await execNodeForTest("process.stdout.write('ok')"); assert.deepEqual({ stdout: result.stdout, code: result.code, error: result.errorCategory }, { stdout: "ok", code: 0, error: undefined }); });
test("bounded process is terminated on timeout without leaking output", async () => { const started = Date.now(); const result = await execNodeForTest("process.stdout.write('sensitive');setTimeout(()=>{},10000)", 100); assert.equal(result.errorCategory, "timeout"); assert.equal(result.stdout, ""); assert.equal(result.stderr, ""); assert.ok(Date.now() - started < 3000); });
test("stdout overflow is terminated and scrubbed", async () => { const result = await execNodeForTest("process.stdout.write('x'.repeat(20000))"); assert.equal(result.errorCategory, "output_limit"); assert.equal(result.stdout, ""); assert.equal(result.stderr, ""); });
test("stderr overflow is terminated and scrubbed", async () => { const result = await execNodeForTest("process.stderr.write('x'.repeat(20000))"); assert.equal(result.errorCategory, "output_limit"); assert.equal(result.stdout, ""); assert.equal(result.stderr, ""); });
test("combined output stays bounded", async () => { const result = await execNodeForTest("process.stdout.write('x'.repeat(12000));process.stderr.write('y'.repeat(12000))"); assert.ok(Buffer.byteLength(result.stdout) <= 16384); assert.ok(Buffer.byteLength(result.stderr) <= 16384); });
test("failure output is scrubbed", async () => { const result = await execNodeForTest("process.stderr.write('sensitive');process.exit(2)"); assert.equal(result.errorCategory, "exit_failure"); assert.equal(result.stdout, ""); assert.equal(result.stderr, ""); });
