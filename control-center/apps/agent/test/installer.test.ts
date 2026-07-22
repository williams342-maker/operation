import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
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
  assert.match(source, /\/api\/agent\/bootstrap\/connectivity/);
  assert.match(source, /\/api\/agent\/bootstrap\/artifact/);
  assert.match(source, /X-OpsWorkbench-Artifact-SHA256/);
  assert.match(source, /agent artifact digest verification failed/);
  assert.match(source, /\.opsworkbench-source-commit/);
  assert.doesNotMatch(source, /github\.com\/.*\/archive\//, "installer must not depend on an unpublished GitHub source archive");
  assert.match(source, /connectivityDeliveredAt|connectivity-request\.json/);
  assert.match(source, /cloudflared tunnel run --token-file/);
  assert.match(source, /systemctl is-active --quiet cloudflared\.service/);
  assert.doesNotMatch(source, /cloudflared service install "\$CF_TUNNEL_TOKEN"/, "tunnel token must not be passed in process arguments");
  assert.doesNotMatch(source, /curl_args.*CF_ACCESS_CLIENT_SECRET/, "Access credentials must not be passed in process arguments");
  assert.match(source, /installation_id=/);
  assert.match(source, /CONTROL_CENTER_SERVER_SLUG/);
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
