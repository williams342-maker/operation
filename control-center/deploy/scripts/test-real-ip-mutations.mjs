/* global process */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm, cp } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";
import { join } from "node:path";

const api = fileURLToPath(new URL("../../apps/api/", import.meta.url));
const dir = await mkdtemp(join(api, ".q4-mutation-"));
await cp(join(api, "src"), join(dir, "src"), { recursive: true }); await mkdir(join(dir, "test"));
const sources = {};
for (const file of ["clientIdentity.ts", "ipRateLimits.ts", "environmentValidation.ts"]) sources[file] = await readFile(join(api, "src", file), "utf8");
const tests = await readFile(join(api, "test", "clientIdentity.test.ts"), "utf8");
await writeFile(join(dir, "test", "clientIdentity.test.ts"), tests);
const mutants = [
  ["missing trust", "clientIdentity.ts", '  return entries;', '  return [];'],
  ["missing malformed chain check", "clientIdentity.ts", 'typeof forwarded !== "string" || forwarded.length > 2048 || !forwarded.split(",").every((ip) => Boolean(isIP(ip.trim())))', 'false'],
  ["mapped IPv4 collapse", "ipRateLimits.ts", 'ipaddr.process(request.ip!).toString()', 'request.ip!']
];
try {
  const control = spawnSync(process.execPath, ["--import", "tsx", "--test", join(dir, "test", "clientIdentity.test.ts")], { cwd: api, encoding: "utf8", timeout: 30_000, windowsHide: true });
  assert.equal(control.status, 0, `Unmutated control must pass: ${control.stdout}\n${control.stderr}`);
  for (const [name, file, from, to] of mutants) {
    for (const [path, source] of Object.entries(sources)) await writeFile(join(dir, "src", path), source);
    assert.ok(sources[file].includes(from), `Mutation anchor missing: ${name}`);
    await writeFile(join(dir, "src", file), sources[file].replace(from, to));
    const result = spawnSync(process.execPath, ["--import", "tsx", "--test", join(dir, "test", "clientIdentity.test.ts")], { cwd: api, encoding: "utf8", timeout: 30_000, windowsHide: true });
    assert.notEqual(result.status, 0, `Surviving mutation: ${name}`);
    assert.match(result.stdout, /ERR_ASSERTION/, `Infrastructure failure is not a killed mutation: ${result.stdout}\n${result.stderr}`);
    process.stdout.write(`KILLED ${name}\n`);
  }
} finally { await rm(dir, { recursive: true, force: true }); }
