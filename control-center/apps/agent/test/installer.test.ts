import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { enrollmentEnv, enrollmentInstallCommand, enrollmentInstallScript } from "@control-center/shared";

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
  assert.match(source, /tar -xzf "\$work_dir\/source\.tar\.gz" -C "\$work_dir\/source"/);
  assert.doesNotMatch(source, /tar -xzf .*--strip-components/, "installer must preserve the artifact's control-center root directory");
  assert.match(source, /source\/control-center\/\.opsworkbench-source-commit/);
  assert.match(source, /cd "\$work_dir\/source\/control-center"/);
  assert.doesNotMatch(source, /github\.com\/.*\/archive\//, "installer must not depend on an unpublished GitHub source archive");
  assert.match(source, /connectivityDeliveredAt|connectivity-request\.json/);
  assert.match(source, /cloudflared tunnel run --token-file/);
  assert.match(source, /systemctl is-active --quiet cloudflared\.service/);
  assert.doesNotMatch(source, /cloudflared service install "\$CF_TUNNEL_TOKEN"/, "tunnel token must not be passed in process arguments");
  assert.doesNotMatch(source, /curl_args.*CF_ACCESS_CLIENT_SECRET/, "Access credentials must not be passed in process arguments");
  assert.match(source, /installation_id=/);
  assert.match(source, /CONTROL_CENTER_SERVER_SLUG/);
  assert.match(source, /CONTROL_CENTER_FORCE_ENROLLMENT/);
  assert.match(source, /useradd --system/);
  assert.match(source, /opsworkbench-agent\.service/);
  assert.match(source, /systemctl enable --now/);
  assert.match(source, /systemctl restart opsworkbench-agent\.service/);
  assert.match(source, /Restart=always/);
  assert.match(source, /\[ ! -s "\$CONFIG_DIR\/agent\.json" \]/, "reinstallation must preserve permanent agent credentials");
  assert.match(source, /previous_agent_id=/);
  assert.match(source, /fresh enrollment did not replace existing agent credentials/);
  assert.match(source, /agent enrolled successfully/);
  assert.match(source, /shell_env_value CONTROL_CENTER_AGENT_CONFIG .*agent\.json/);
  assert.match(source, /shell_env_value CONTROL_CENTER_AGENT_CONFIG .* >"\$CONFIG_DIR\/enrollment\.env"/, "installer must remove the plaintext enrollment token after successful use");
  const webConfig = fs.readFileSync(fileURLToPath(new URL("../../../deploy/nginx/web.conf", import.meta.url)), "utf8");
  assert.match(webConfig, /location = \/install\.sh/);
  assert.match(webConfig, /default_type text\/x-shellscript/);
});

test("enrollment download and copy-command formats are stable", () => {
  const token = "owenr_test-token";
  assert.equal(enrollmentEnv(token), `CONTROL_CENTER_URL=https://opsworkbench.org\nCONTROL_CENTER_ENROLLMENT_TOKEN=${token}\nCONTROL_CENTER_FORCE_ENROLLMENT=1\n`);
  const command = enrollmentInstallCommand(token, "https://opsworkbench.org", "opsworkbench");
  assert.doesNotMatch(command, /owenr_test-token/, "generated commands must not embed enrollment tokens");
  assert.match(command, /read -rsp 'Enrollment token:/);
  assert.match(command, /curl --config curl\.conf/);
  assert.match(command, /curl --config curl\.conf >"\$INSTALL_INPUT_DIR\/curl\.status"/);
  assert.match(command, /read -r HTTP_STATUS CONTENT_TYPE <"\$INSTALL_INPUT_DIR\/curl\.status"/);
  assert.doesNotMatch(command, /< <\(curl/, "the interactive command must wait for curl without process substitution");
  assert.ok(command.includes("sed -i 's/\\r$//' installer.sh"));
  assert.ok(command.includes("! grep -q $'\\r' installer.sh"));
  assert.match(command, /bash -n installer\.sh/);
  assert.match(command, /inspect before continuing/);
  assert.match(command, /OPSWORKBENCH_INSTALL_INPUT_DIR=/);
  assert.doesNotMatch(command, /sudo env|curl .*\|.*bash/);
  assert.doesNotMatch(command, /\\ +\n/, "continuation backslashes may not have trailing whitespace");

  const script = enrollmentInstallScript(token, "https://opsworkbench.org", "opsworkbench");
  assert.match(script, /^#!\/usr\/bin\/env bash\n/);
  assert.match(script, /ENROLLMENT_TOKEN='owenr_test-token'/, "the protected download carries only the short-lived authorization");
  assert.doesNotMatch(script, /read\s+-[^\n]*p/, "the downloaded script must be non-interactive");
  assert.doesNotMatch(script, /CF-Access-Client-(?:Id|Secret)/, "long-lived Access credentials must not be embedded");
  assert.doesNotMatch(script, /CF_ACCESS_CLIENT_SECRET=/, "long-lived Access secrets must not be embedded");
  assert.match(script, /chmod 0600/);
  assert.match(script, /rm -f -- "\$SELF_PATH"/, "the one-time script removes itself");
  assert.match(script, /OPSWORKBENCH_INSTALL_INPUT_DIR=/);
  assert.match(script, /curl --config curl\.conf >"\$INSTALL_INPUT_DIR\/curl\.status"/);
  assert.match(script, /read -r HTTP_STATUS CONTENT_TYPE <"\$INSTALL_INPUT_DIR\/curl\.status"/);
  assert.doesNotMatch(script, /< <\(curl/, "the protected script must not block on process substitution under noninteractive SSH");
  assert.ok(script.includes("sed -i 's/\\r$//' installer.sh"));
  assert.ok(script.includes("! grep -q $'\\r' installer.sh"));
});

test("installer has valid shell syntax when bash is available", { skip: process.platform === "win32" }, () => {
  const result = spawnSync("bash", ["-n", installer], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});
