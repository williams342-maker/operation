import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { enrollmentEnv, enrollmentInstallCommand } from "@control-center/shared";

const installer = path.resolve(process.cwd(), "../web/public/install.sh");

test("installer provisions and verifies the systemd agent", () => {
  const source = fs.readFileSync(installer, "utf8");
  assert.match(source, /CONTROL_CENTER_URL=.*opsworkbench\.org/);
  assert.match(source, /CONTROL_CENTER_ENROLLMENT_TOKEN is required/);
  assert.match(source, /installation_id=/);
  assert.match(source, /CONTROL_CENTER_SERVER_SLUG/);
  assert.match(source, /useradd --system/);
  assert.match(source, /opsworkbench-agent\.service/);
  assert.match(source, /systemctl enable --now/);
  assert.match(source, /agent enrolled successfully/);
  assert.match(source, /CONTROL_CENTER_AGENT_CONFIG=.*agent\.json/);
  assert.match(source, /printf 'CONTROL_CENTER_AGENT_CONFIG=/, "installer must remove the plaintext enrollment token after successful use");
});

test("enrollment download and copy-command formats are stable", () => {
  const token = "owenr_test-token";
  assert.equal(enrollmentEnv(token), `CONTROL_CENTER_URL=https://opsworkbench.org\nCONTROL_CENTER_ENROLLMENT_TOKEN=${token}\n`);
  const command = enrollmentInstallCommand(token, "https://opsworkbench.org", "opsworkbench");
  assert.match(command, /^curl -fsSL https:\/\/opsworkbench\.org\/install\.sh/);
  assert.match(command, /CONTROL_CENTER_ENROLLMENT_TOKEN="owenr_test-token"/);
  assert.match(command, /CONTROL_CENTER_SERVER_SLUG="opsworkbench"/);
  assert.match(command, /sudo env/);
  assert.match(command, /bash$/);
});

test("installer has valid shell syntax when bash is available", { skip: process.platform === "win32" }, () => {
  const result = spawnSync("bash", ["-n", installer], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});
