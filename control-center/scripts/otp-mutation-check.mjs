import fs from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (process.env.CONTROL_CENTER_RUN_DB_TESTS !== "true" || !process.env.MONGO_URL_TEST) throw new Error("Enable database tests with a disposable MONGO_URL_TEST before mutation testing.");
const apiRoot = path.join(root, "apps/api");
const scratch = await fs.mkdtemp(path.join(apiRoot, ".otp-mutation-"));
if (path.dirname(scratch) !== apiRoot || !path.basename(scratch).startsWith(".otp-mutation-")) throw new Error("Unexpected mutation scratch path");
await fs.cp(path.join(apiRoot, "src"), path.join(scratch, "apps/api/src"), { recursive: true });
await fs.cp(path.join(apiRoot, "test"), path.join(scratch, "apps/api/test"), { recursive: true });
function check() {
  const result = spawnSync(process.execPath, ["--import", "tsx", "--test", "apps/api/test/otpIntegration.test.ts"], { cwd: scratch, env: process.env, encoding: "utf8", timeout: 180_000 });
  if (result.error || result.signal || !/# skipped 0\b/.test(result.stdout)) throw new Error(`Mutation check did not run normally: ${result.error || result.signal || result.stdout}`);
  return result;
}
try {
const baseline = check();
if (baseline.status !== 0) throw new Error(`Baseline failed:\n${baseline.stdout}\n${baseline.stderr}`);
const mutants = [
  { name: "remove session gate", file: "apps/api/src/auth.ts", from: "return loadSession(req, res, () => requirePasswordCurrent(req, res, next));", to: "return loadSession(req, res, next);", failure: "every role is gated" },
  { name: "remove identity flag", file: "apps/api/src/routes.ts", from: "mustChangePassword: req.user!.mustChangePassword === true", to: "mustChangePassword: false", failure: "every role is gated" },
  { name: "remove OTP expiry", file: "apps/api/src/passwordPolicy.ts", from: "return now - issued.getTime() >= otpTtlHours() * 3_600_000;", to: "return false;", failure: "wrong, missing, malformed and expired OTPs" }
];
for (const mutant of mutants) {
  const file = path.join(scratch, mutant.file);
  const original = await fs.readFile(file, "utf8");
  if (original.split(mutant.from).length !== 2) throw new Error(`Mutation anchor is not unique: ${mutant.name}`);
  let result;
  try { await fs.writeFile(file, original.replace(mutant.from, mutant.to)); result = check(); }
  finally { await fs.writeFile(file, original); }
  if (result.status === 0 || !result.stdout.includes("code: 'ERR_ASSERTION'") || !result.stdout.includes(`not ok 1 - ${mutant.failure}`) && !result.stdout.includes(`not ok 2 - ${mutant.failure}`)) throw new Error(`Mutant survived or failed unexpectedly: ${mutant.name}\n${result.stdout}\n${result.stderr}`);
  console.log(`KILLED: ${mutant.name}`);
}
console.log("OTP mutation checks passed: 3/3 killed; isolated source copies only.");

} finally {
  await fs.rm(scratch, { recursive: true, force: true });
}
