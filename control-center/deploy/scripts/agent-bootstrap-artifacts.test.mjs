import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..", "..");
function run(script, env) { const result = spawnSync(process.execPath, [path.join(root, "scripts", script)], { cwd: root, env: { ...process.env, ...env }, encoding: "utf8" }); assert.equal(result.status, 0, `${script}: ${result.stderr}`); return result.stdout.trim(); }
function files(directory) { return Object.fromEntries(fs.readdirSync(directory).sort().map((name) => [name, crypto.createHash("sha256").update(fs.readFileSync(path.join(directory, name))).digest("hex")])); }

test("bootstrap build is reproducible, signed, schema-bound, and secret-free", { timeout: 120_000 }, () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "opsworkbench-bootstrap-artifacts-")); const first = path.join(temporary, "first"); const second = path.join(temporary, "second"); const privateKeyFile = path.join(temporary, "disposable-test-private.pem"); const publicKeyFile = path.join(temporary, "disposable-test-public.pem");
  try {
    const keys = crypto.generateKeyPairSync("ed25519"); fs.writeFileSync(privateKeyFile, keys.privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 }); fs.writeFileSync(publicKeyFile, keys.publicKey.export({ type: "spki", format: "pem" }), { mode: 0o600 });
    for (const output of [first, second]) { run("build-agent-bootstrap.mjs", { BOOTSTRAP_OUTPUT_DIR: output, ALLOW_DIRTY_BOOTSTRAP_BUILD: "true" }); run("sign-agent-bootstrap.mjs", { BOOTSTRAP_OUTPUT_DIR: output, BOOTSTRAP_SIGNING_PRIVATE_KEY_FILE: privateKeyFile, BOOTSTRAP_SIGNING_PUBLIC_KEY_FILE: publicKeyFile, BOOTSTRAP_ARTIFACT_URL: "https://release-validation.invalid/opsworkbench-agent.tar.gz" }); run("verify-agent-bootstrap.mjs", { BOOTSTRAP_OUTPUT_DIR: output, BOOTSTRAP_SIGNING_PUBLIC_KEY_FILE: publicKeyFile }); }
    assert.deepEqual(files(first), files(second));
    const manifestName = fs.readdirSync(first).find((name) => name.endsWith(".manifest.json")); assert.ok(manifestName); const manifest = JSON.parse(fs.readFileSync(path.join(first, manifestName), "utf8")); assert.equal(manifest.version, "0.10.0-beta.1"); assert.equal(manifest.minimumSourceVersion, "0.1.0"); assert.equal(manifest.nonProductionOnly, true); assert.deepEqual(manifest.requiredCapabilities, ["environmentDiscovery", "agentUpgrade", "upgradeManifestHandoff"]); assert.ok(manifest.artifacts.some((item) => item.role === "sbom"));
    const packageArtifact = manifest.artifacts.find((item) => item.role === "agent_package"); assert.ok(packageArtifact); const packagePath = path.join(first, packageArtifact.filename); const agent = spawnSync(process.execPath, ["-e", `const fs=require("node:fs"),os=require("node:os"),path=require("node:path"),cp=require("node:child_process");const d=fs.mkdtempSync(path.join(os.tmpdir(),"opsworkbench-agent-runtime-"));try{cp.execFileSync("tar",["-xzf",${JSON.stringify(packagePath)},"-C",d]);const app=path.join(d,"control-center","apps","agent");if(require(path.join(app,"package.json")).type!=="commonjs")throw new Error("agent runtime type is not CommonJS");require(path.join(app,"dist","agent.js"));}finally{fs.rmSync(d,{recursive:true,force:true})}`], { env: { ...process.env, NODE_ENV: "test" }, encoding: "utf8" }); assert.equal(agent.status, 0, agent.stderr); assert.equal(agent.stdout, "");
    fs.appendFileSync(packagePath, "partial"); const failed = spawnSync(process.execPath, [path.join(root, "scripts", "verify-agent-bootstrap.mjs")], { cwd: root, env: { ...process.env, BOOTSTRAP_OUTPUT_DIR: first, BOOTSTRAP_SIGNING_PUBLIC_KEY_FILE: publicKeyFile }, encoding: "utf8" }); assert.notEqual(failed.status, 0);
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});

test("bootstrap and rollback scripts avoid direct execution and preserve fixed policy", () => {
  const bootstrap = fs.readFileSync(path.join(root, "scripts", "bootstrap-agent-release.sh"), "utf8"); const rollback = fs.readFileSync(path.join(root, "scripts", "rollback-agent-bootstrap.sh"), "utf8"); const builder = fs.readFileSync(path.join(root, "scripts", "build-agent-bootstrap.mjs"), "utf8"); const reviewed = fs.readFileSync(path.join(root, "scripts", "install-reviewed-agent.sh"), "utf8");
  assert.doesNotMatch(bootstrap, /curl[^\n]*\|[^\n]*(?:bash|sh)/); assert.match(bootstrap, /manifest signature verification failed/); assert.match(bootstrap, /artifact signature verification failed/); assert.match(bootstrap, /agentId\|\|!c\.agentSecret/); assert.match(bootstrap, /bootstrap validation failed and rollback was requested/); assert.match(bootstrap, /current_version.*0\.1\.0/); assert.match(rollback, /backup marker escaped the backup root/); assert.match(bootstrap, /chmod 0600 "\$curl_config"/); assert.match(bootstrap, /} >"\$curl_config"/); assert.doesNotMatch(`${bootstrap}\n${rollback}`, /CONTROL_CENTER_ENROLLMENT_TOKEN=/);
  assert.match(bootstrap, /install -d -o root -g root -m 0711 "\$STATE_ROOT"/); assert.match(rollback, /install -d -o root -g root -m 0711 "\$STATE_ROOT"/); assert.doesNotMatch(`${bootstrap}\n${rollback}`, /chown -R[^\n]*STATE_ROOT|chmod 0?777/);
  assert.match(bootstrap, /OPSWORKBENCH_BOOTSTRAP_LOCK_HELD=1/); assert.match(rollback, /\/proc\/\$\$\/fd\/9/); assert.match(rollback, /inherited bootstrap lock is invalid/);
  assert.match(bootstrap, /rm -f -- "\$heartbeat" "\$heartbeat\.pending"[\s\S]*systemctl restart "\$AGENT_SERVICE"/);
  assert.match(builder, /"typescript", "bin", "tsc".*"packages", "shared", "tsconfig\.json"/);
  assert.match(reviewed, /sha256sum .*prior-agent\.sha256/); assert.match(reviewed, /rollback agent identity changed/); assert.match(reviewed, /agent rollback snapshot is absent/); assert.match(reviewed, /systemctl restart "\$service"/);
});

test("rollback reuses only the parent's exact inherited lock", { skip: process.platform === "win32" }, () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "opsworkbench-bootstrap-lock-"));
  try {
    const state = path.join(temporary, "state"); const backups = path.join(temporary, "backups"); const install = path.join(temporary, "install"); const config = path.join(temporary, "config"); const units = path.join(temporary, "units");
    for (const directory of [state, backups, install, config, units]) fs.mkdirSync(directory);
    const source = fs.readFileSync(path.join(root, "scripts", "rollback-agent-bootstrap.sh"), "utf8").replace('[ "$(id -u)" -eq 0 ] || fail "run from a root shell"', ":").replace('INSTALL_ROOT="/opt/opsworkbench-agent"', `INSTALL_ROOT=${JSON.stringify(install)}`).replace('CONFIG_ROOT="/etc/opsworkbench-agent"', `CONFIG_ROOT=${JSON.stringify(config)}`).replace('STATE_ROOT="/var/lib/opsworkbench-agent"', `STATE_ROOT=${JSON.stringify(state)}`).replace('BACKUP_ROOT="/var/backups/opsworkbench-agent"', `BACKUP_ROOT=${JSON.stringify(backups)}`).replace('UNIT_ROOT="/etc/systemd/system"', `UNIT_ROOT=${JSON.stringify(units)}`).replace('install -d -o root -g root -m 0711 "$STATE_ROOT"', 'install -d -m 0711 "$STATE_ROOT"');
    const script = path.join(temporary, "rollback.sh"); fs.writeFileSync(script, source, { mode: 0o700 }); const lock = path.join(state, "bootstrap.lock");
    const inherited = spawnSync("bash", ["-c", 'exec 9>"$1"; flock -n 9; OPSWORKBENCH_BOOTSTRAP_LOCK_HELD=1 bash "$2"', "test", lock, script], { encoding: "utf8" }); assert.notEqual(inherited.status, 0); assert.match(inherited.stderr, /no bootstrap backup marker exists/); assert.doesNotMatch(inherited.stderr, /another bootstrap or rollback is active/);
    const concurrent = spawnSync("bash", ["-c", 'flock "$1" -c "sleep 5" & holder=$!; sleep 0.1; bash "$2"; status=$?; kill "$holder" 2>/dev/null || true; wait "$holder" 2>/dev/null || true; exit "$status"', "test", lock, script], { encoding: "utf8" }); assert.notEqual(concurrent.status, 0); assert.match(concurrent.stderr, /another bootstrap or rollback is active/);
    const independent = spawnSync("bash", [script], { encoding: "utf8" }); assert.notEqual(independent.status, 0); assert.match(independent.stderr, /no bootstrap backup marker exists/); assert.doesNotMatch(independent.stderr, /another bootstrap or rollback is active/);
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});

test("bootstrap scripts pass bash syntax validation when bash is available", { skip: process.platform === "win32" }, () => { for (const name of ["bootstrap-agent-release.sh", "rollback-agent-bootstrap.sh", "install-reviewed-agent.sh"]) { const result = spawnSync("bash", ["-n", path.join(root, "scripts", name)], { encoding: "utf8" }); assert.equal(result.status, 0, result.stderr); } });
