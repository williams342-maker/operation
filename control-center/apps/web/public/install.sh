#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

AGENT_USER="opsworkbench-agent"
INSTALL_DIR="/opt/opsworkbench-agent"
CONFIG_DIR="/etc/opsworkbench-agent"
INPUT_DIR="${OPSWORKBENCH_INSTALL_INPUT_DIR:-}"

fail() { printf 'OpsWorkbench installer: %s\n' "$*" >&2; exit 1; }
read_secret_file() {
  local path="$1"
  [ -f "$path" ] || return 1
  [ "$(wc -l <"$path")" -le 1 ] || fail "secret input must be a single line"
  tr -d '\r\n' <"$path"
}
shell_env_value() {
  case "$2" in *$'\n'*|*$'\r'*) fail "$1 must be a single line" ;; esac
  printf '%s=%q\n' "$1" "$2"
}

[ "$(id -u)" -eq 0 ] || fail "run from a root shell (use sudo -i once if needed)"
[ -n "$INPUT_DIR" ] && [ -d "$INPUT_DIR" ] || fail "OPSWORKBENCH_INSTALL_INPUT_DIR must name the protected installer input directory"
CONTROL_CENTER_URL="$(read_secret_file "$INPUT_DIR/control-center-url")" || fail "control-center-url input is required"
CONTROL_CENTER_SERVER_SLUG="$(read_secret_file "$INPUT_DIR/server-slug" 2>/dev/null || true)"
CONTROL_CENTER_ENROLLMENT_TOKEN="$(read_secret_file "$INPUT_DIR/enrollment-token")" || fail "enrollment-token input is required"
CF_ACCESS_CLIENT_ID="$(read_secret_file "$INPUT_DIR/cf-access-client-id" 2>/dev/null || true)"
CF_ACCESS_CLIENT_SECRET="$(read_secret_file "$INPUT_DIR/cf-access-client-secret" 2>/dev/null || true)"
[ -n "$CONTROL_CENTER_ENROLLMENT_TOKEN" ] || fail "enrollment token is empty"
if [ -n "$CF_ACCESS_CLIENT_ID" ] || [ -n "$CF_ACCESS_CLIENT_SECRET" ]; then [ -n "$CF_ACCESS_CLIENT_ID" ] && [ -n "$CF_ACCESS_CLIENT_SECRET" ] || fail "Cloudflare Access service-token credentials are incomplete"; fi
case "$CONTROL_CENTER_URL" in https://*) ;; *) fail "CONTROL_CENTER_URL must use HTTPS" ;; esac
case "$CONTROL_CENTER_SERVER_SLUG" in *[!a-z0-9-]*) fail "server slug must contain lowercase letters, numbers, and hyphens" ;; esac

if command -v apt-get >/dev/null 2>&1; then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ca-certificates curl git xz-utils
  if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'Number(process.versions.node.split(`.`)[0])')" -lt 22 ]; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs
  fi
elif command -v dnf >/dev/null 2>&1; then
  dnf install -y ca-certificates curl git nodejs npm
else
  fail "supported package manager not found (apt-get or dnf required)"
fi

id "$AGENT_USER" >/dev/null 2>&1 || useradd --system --home-dir "$INSTALL_DIR" --shell /usr/sbin/nologin "$AGENT_USER"
getent group docker >/dev/null 2>&1 && usermod -aG docker "$AGENT_USER" || true
install -d -m 0750 -o "$AGENT_USER" -g "$AGENT_USER" "$INSTALL_DIR" "$CONFIG_DIR"

work_dir="$(mktemp -d)"
cleanup() {
  rm -rf -- "$work_dir"
  unset CONTROL_CENTER_ENROLLMENT_TOKEN CF_ACCESS_CLIENT_ID CF_ACCESS_CLIENT_SECRET CF_TUNNEL_TOKEN
}
trap cleanup EXIT

printf '{"enrollmentToken":"%s"}' "$CONTROL_CENTER_ENROLLMENT_TOKEN" >"$work_dir/artifact-request.json"
cat >"$work_dir/artifact-curl.conf" <<EOF
silent
show-error
fail
header = "Content-Type: application/json"
data-binary = "@$work_dir/artifact-request.json"
dump-header = "$work_dir/artifact-headers"
output = "$work_dir/source.tar.gz"
EOF
if [ -n "$CF_ACCESS_CLIENT_ID" ]; then
  printf 'header = "CF-Access-Client-Id: %s"\nheader = "CF-Access-Client-Secret: %s"\n' "$CF_ACCESS_CLIENT_ID" "$CF_ACCESS_CLIENT_SECRET" >>"$work_dir/artifact-curl.conf"
fi
curl --config "$work_dir/artifact-curl.conf" "$CONTROL_CENTER_URL/api/agent/bootstrap/artifact"
artifact_sha256="$(awk 'BEGIN{IGNORECASE=1} /^X-OpsWorkbench-Artifact-SHA256:/ {gsub("\\r", "", $2); print $2}' "$work_dir/artifact-headers" | tail -n1)"
artifact_commit="$(awk 'BEGIN{IGNORECASE=1} /^X-OpsWorkbench-Source-Commit:/ {gsub("\\r", "", $2); print $2}' "$work_dir/artifact-headers" | tail -n1)"
case "$artifact_sha256" in *[!a-f0-9]*|'') fail "agent artifact digest header is invalid" ;; esac
[ "${#artifact_sha256}" -eq 64 ] || fail "agent artifact digest header is invalid"
case "$artifact_commit" in *[!a-f0-9]*|'') fail "agent artifact source commit header is invalid" ;; esac
[ "${#artifact_commit}" -eq 40 ] || fail "agent artifact source commit header is invalid"
printf '%s  %s\n' "$artifact_sha256" "$work_dir/source.tar.gz" | sha256sum -c - >/dev/null || fail "agent artifact digest verification failed"

printf '{"enrollmentToken":"%s"}' "$CONTROL_CENTER_ENROLLMENT_TOKEN" >"$work_dir/connectivity-request.json"
cat >"$work_dir/connectivity-curl.conf" <<EOF
silent
show-error
fail
header = "Content-Type: application/json"
data-binary = "@$work_dir/connectivity-request.json"
output = "$work_dir/connectivity.json"
EOF
if [ -n "$CF_ACCESS_CLIENT_ID" ]; then
  printf 'header = "CF-Access-Client-Id: %s"\nheader = "CF-Access-Client-Secret: %s"\n' "$CF_ACCESS_CLIENT_ID" "$CF_ACCESS_CLIENT_SECRET" >>"$work_dir/connectivity-curl.conf"
fi
curl --config "$work_dir/connectivity-curl.conf" "$CONTROL_CENTER_URL/api/agent/bootstrap/connectivity"
node - "$work_dir/connectivity.json" "$work_dir" <<'NODE'
const fs = require("fs"); const path = require("path"); const input = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const cf = input.providers?.find((item) => item.provider === "cloudflare"); if (!cf) process.exit(0);
const write = (name, value) => { if (value) fs.writeFileSync(path.join(process.argv[3], name), String(value), { mode: 0o600 }); };
write("cf-tunnel-enabled", cf.tunnel?.enabled ? "yes" : "no"); write("cf-tunnel-token", cf.tunnel?.token); write("cf-access-enabled", cf.access?.enabled ? "yes" : "no"); write("cf-access-client-id", cf.access?.clientId); write("cf-access-client-secret", cf.access?.clientSecret);
NODE
if [ -s "$work_dir/cf-access-client-id" ]; then CF_ACCESS_CLIENT_ID="$(read_secret_file "$work_dir/cf-access-client-id")"; CF_ACCESS_CLIENT_SECRET="$(read_secret_file "$work_dir/cf-access-client-secret")"; fi
install -d -m 0750 "$work_dir/source"
tar -xzf "$work_dir/source.tar.gz" -C "$work_dir/source"
[ "$(tr -d '\r\n' <"$work_dir/source/control-center/.opsworkbench-source-commit")" = "$artifact_commit" ] || fail "agent artifact source commit verification failed"
cd "$work_dir/source/control-center"
npm ci --omit=optional
npm run build --workspace @control-center/shared
npm run build --workspace @control-center/agent
chown -R "$AGENT_USER:$AGENT_USER" "$work_dir/source"
rm -rf -- "$INSTALL_DIR/source.previous"
[ ! -d "$INSTALL_DIR/source" ] || mv "$INSTALL_DIR/source" "$INSTALL_DIR/source.previous"
mv "$work_dir/source" "$INSTALL_DIR/source"

if [ ! -s "$CONFIG_DIR/agent.json" ]; then
  installation_id="$(cat /proc/sys/kernel/random/uuid 2>/dev/null || node -e 'console.log(require("crypto").randomUUID())')"
  printf '{"controlCenterUrl":"%s","installationId":"%s","requestedSlug":"%s","agentId":"","agentSecret":"","agentVersion":"0.1.0","allowedRoots":["/srv"],"pollIntervalSeconds":30,"mongoChecks":{}}\n' \
    "$CONTROL_CENTER_URL" "$installation_id" "$CONTROL_CENTER_SERVER_SLUG" >"$CONFIG_DIR/agent.json"
fi
previous_agent_id="$(node - "$CONFIG_DIR/agent.json" <<'NODE' 2>/dev/null || true
const fs = require("fs");
try { const config = JSON.parse(fs.readFileSync(process.argv[2], "utf8")); if (typeof config.agentId === "string") process.stdout.write(config.agentId); } catch { /* enrollment will validate the final config */ }
NODE
)"
{
  shell_env_value CONTROL_CENTER_ENROLLMENT_TOKEN "$CONTROL_CENTER_ENROLLMENT_TOKEN"
  shell_env_value CONTROL_CENTER_SERVER_SLUG "$CONTROL_CENTER_SERVER_SLUG"
  shell_env_value CONTROL_CENTER_FORCE_ENROLLMENT "1"
  shell_env_value CONTROL_CENTER_AGENT_CONFIG "$CONFIG_DIR/agent.json"
} >"$CONFIG_DIR/enrollment.env"
{
  shell_env_value CF_ACCESS_CLIENT_ID "$CF_ACCESS_CLIENT_ID"
  shell_env_value CF_ACCESS_CLIENT_SECRET "$CF_ACCESS_CLIENT_SECRET"
} >"$CONFIG_DIR/machine-auth.env"
chmod 0600 "$CONFIG_DIR/agent.json" "$CONFIG_DIR/enrollment.env" "$CONFIG_DIR/machine-auth.env"
chown "$AGENT_USER:$AGENT_USER" "$CONFIG_DIR/agent.json" "$CONFIG_DIR/enrollment.env"
chown root:root "$CONFIG_DIR/machine-auth.env"

if [ "$(read_secret_file "$work_dir/cf-tunnel-enabled" 2>/dev/null || true)" = "yes" ]; then
  CF_TUNNEL_TOKEN="$(read_secret_file "$work_dir/cf-tunnel-token")" || fail "Cloudflare tunnel token was not delivered"
  if ! command -v cloudflared >/dev/null 2>&1; then
    architecture="$(dpkg --print-architecture 2>/dev/null || rpm --eval '%{_arch}')"; case "$architecture" in amd64|x86_64) architecture=amd64 ;; arm64|aarch64) architecture=arm64 ;; *) fail "unsupported cloudflared architecture" ;; esac
    curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-$architecture" -o /usr/local/bin/cloudflared
    chmod 0755 /usr/local/bin/cloudflared
  fi
  install -d -m 0700 -o root -g root /etc/cloudflared
  printf '%s' "$CF_TUNNEL_TOKEN" >/etc/cloudflared/opsworkbench-token
  chmod 0600 /etc/cloudflared/opsworkbench-token
  node - /etc/cloudflared/opsworkbench-token /etc/cloudflared/opsworkbench-tunnel-id <<'NODE'
const fs = require("fs");
try { const token = fs.readFileSync(process.argv[2], "utf8").trim(); const decoded = JSON.parse(Buffer.from(token.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")); const id = decoded.t || decoded.tunnelId || decoded.TunnelID; if (typeof id === "string" && /^[A-Za-z0-9._:-]{1,160}$/.test(id)) fs.writeFileSync(process.argv[3], id, { mode: 0o644 }); } catch { /* tunnel identifier is optional and token material is never logged */ }
NODE
  cat >/etc/systemd/system/cloudflared.service <<'EOF'
[Unit]
Description=Cloudflare Tunnel
After=network-online.target
Wants=network-online.target
[Service]
Type=notify
ExecStart=/usr/local/bin/cloudflared tunnel run --token-file /etc/cloudflared/opsworkbench-token
Restart=on-failure
RestartSec=5s
[Install]
WantedBy=multi-user.target
EOF
  unset CF_TUNNEL_TOKEN
  systemctl daemon-reload
  systemctl enable --now cloudflared.service
  systemctl is-active --quiet cloudflared.service || fail "cloudflared service did not become active"
fi

docker_group=""; getent group docker >/dev/null 2>&1 && docker_group="SupplementaryGroups=docker"
cat >/etc/systemd/system/opsworkbench-agent.service <<EOF
[Unit]
Description=OpsWorkbench Agent
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
User=$AGENT_USER
Group=$AGENT_USER
$docker_group
WorkingDirectory=$INSTALL_DIR/source/control-center/apps/agent
EnvironmentFile=$CONFIG_DIR/enrollment.env
EnvironmentFile=$CONFIG_DIR/machine-auth.env
ExecStart=/usr/bin/node $INSTALL_DIR/source/control-center/apps/agent/dist/agent.js
Restart=always
RestartSec=10
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$CONFIG_DIR
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now opsworkbench-agent.service
systemctl restart opsworkbench-agent.service
for _ in $(seq 1 30); do
  if grep -Eq '"agentId"[[:space:]]*:[[:space:]]*"[^" ]+"' "$CONFIG_DIR/agent.json"; then
    current_agent_id="$(node - "$CONFIG_DIR/agent.json" <<'NODE' 2>/dev/null || true
const fs = require("fs");
try { const config = JSON.parse(fs.readFileSync(process.argv[2], "utf8")); if (typeof config.agentId === "string") process.stdout.write(config.agentId); } catch { /* handled below */ }
NODE
)"
    if [ -n "$previous_agent_id" ] && [ "$current_agent_id" = "$previous_agent_id" ]; then
      fail "fresh enrollment did not replace existing agent credentials"
    fi
    shell_env_value CONTROL_CENTER_AGENT_CONFIG "$CONFIG_DIR/agent.json" >"$CONFIG_DIR/enrollment.env"
    chmod 0600 "$CONFIG_DIR/enrollment.env"; chown "$AGENT_USER:$AGENT_USER" "$CONFIG_DIR/enrollment.env"
    unset CONTROL_CENTER_ENROLLMENT_TOKEN
    systemctl restart opsworkbench-agent.service
    systemctl is-active --quiet opsworkbench-agent.service || fail "agent service did not remain active"
    printf '\nOpsWorkbench agent enrolled successfully.\nControl Center: %s\nService: opsworkbench-agent (active)\n' "$CONTROL_CENTER_URL"
    exit 0
  fi
  sleep 2
done
fail "enrollment did not complete within 60 seconds; inspect the redacted service journal"
