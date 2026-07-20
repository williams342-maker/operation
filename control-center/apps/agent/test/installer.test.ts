import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { enrollmentEnv, enrollmentInstallCommand } from "@control-center/shared";

const installer = fileURLToPath(new URL("../../web/public/install.sh", import.meta.url));

test("installer provisions and verifies the systemd agent", () => {
  const source = fs.readFileSync(installer, "utf8");
  assert.match(source, /CONTROL_CENTER_URL=.*control-center-url/);
  assert.match(source, /OPSWORKBENCH_INSTALL_INPUT_DIR/);
  assert.match(source, /machine-auth\.env/);
  assert.match(source, /CF_ACCESS_CLIENT_ID/);
  assert.match(source, /CF_ACCESS_CLIENT_SECRET/);
  assert.match(source, /installation_id=/);
  assert.match(source, /CONTROL_CENTER_SERVER_SLUG/);
  assert.match(source, /agent-revision/);
  assert.match(source, /agent-archive-sha256/);
  assert.match(source, /AGENT_ARCHIVE_BASE_URL\/\$AGENT_REVISION\.tar\.gz/);
  assert.match(source, /verify_agent_archive .*source\.tar\.gz/);
  assert.doesNotMatch(source, /archive\/[0-9a-f]{40}\.tar\.gz/, "installer must not pin a stale source revision");
  assert.match(source, /useradd --system/);
  assert.match(source, /opsworkbench-agent\.service/);
  assert.match(source, /systemctl enable --now/);
  assert.match(source, /Restart=always/);
  assert.match(source, /\[ ! -s "\$CONFIG_DIR\/agent\.json" \]/, "reinstallation must preserve permanent agent credentials");
  assert.match(source, /agent enrolled successfully/);
  assert.match(source, /shell_env_value CONTROL_CENTER_AGENT_CONFIG .*agent\.json/);
  assert.match(source, /shell_env_value CONTROL_CENTER_AGENT_CONFIG .* >"\$CONFIG_DIR\/enrollment\.env"/, "installer must remove the plaintext enrollment token after successful use");
  const webConfig = fs.readFileSync(fileURLToPath(new URL("../../../deploy/nginx/web.conf", import.meta.url)), "utf8");
  assert.match(webConfig, /location = \/install\.sh/);
  assert.match(webConfig, /default_type text\/x-shellscript/);
});

test("installer accepts only an exact revision-matched archive with the expected digest", { skip: process.platform === "win32" }, () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "opsworkbench-installer-artifact-"));
  const revision = "a".repeat(40);
  const staleRevision = "b".repeat(40);
  const root = path.join(temporary, `operation-${revision}`);
  const archive = path.join(temporary, "source.tar.gz");
  try {
    fs.mkdirSync(root);
    fs.writeFileSync(path.join(root, "identity.txt"), revision);
    const packed = spawnSync("tar", ["-czf", archive, "-C", temporary, `operation-${revision}`], { encoding: "utf8" });
    assert.equal(packed.status, 0, packed.stderr);
    const digest = crypto.createHash("sha256").update(fs.readFileSync(archive)).digest("hex");
    const accepted = spawnSync("bash", [installer, "--verify-agent-archive", revision, digest, archive], { encoding: "utf8" });
    assert.equal(accepted.status, 0, accepted.stderr);
    const changedDigest = spawnSync("bash", [installer, "--verify-agent-archive", revision, "0".repeat(64), archive], { encoding: "utf8" });
    assert.notEqual(changedDigest.status, 0);
    assert.match(changedDigest.stderr, /SHA-256 mismatch/);
    const stale = spawnSync("bash", [installer, "--verify-agent-archive", staleRevision, digest, archive], { encoding: "utf8" });
    assert.notEqual(stale.status, 0);
    assert.match(stale.stderr, /identity or path set is invalid/);
    const abbreviated = spawnSync("bash", [installer, "--verify-agent-archive", revision.slice(0, 12), digest, archive], { encoding: "utf8" });
    assert.notEqual(abbreviated.status, 0);
    assert.match(abbreviated.stderr, /exact lowercase 40-character Git commit/);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("enrollment download and copy-command formats are stable", () => {
  const token = "owenr_test-token";
  assert.equal(enrollmentEnv(token), `CONTROL_CENTER_URL=https://opsworkbench.org\nCONTROL_CENTER_ENROLLMENT_TOKEN=${token}\n`);
  const command = enrollmentInstallCommand(token, "https://opsworkbench.org", "opsworkbench");
  assert.doesNotMatch(command, /owenr_test-token/, "generated commands must not embed enrollment tokens");
  assert.match(command, /read -rsp 'Enrollment token:/);
  assert.match(command, /curl --config curl\.conf/);
  assert.match(command, /bash -n installer\.sh/);
  assert.match(command, /inspect before continuing/);
  assert.match(command, /OPSWORKBENCH_INSTALL_INPUT_DIR=/);
  assert.doesNotMatch(command, /sudo env|curl .*\|.*bash/);
  assert.doesNotMatch(command, /\\ +\n/, "continuation backslashes may not have trailing whitespace");
});

test("installer has valid shell syntax when bash is available", { skip: process.platform === "win32" }, () => {
  const result = spawnSync("bash", ["-n", installer], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});
