#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

AGENT_USER="opsworkbench-agent"
INSTALL_DIR="/opt/opsworkbench-agent"
CONFIG_DIR="/etc/opsworkbench-agent"
INPUT_DIR="${OPSWORKBENCH_INSTALL_INPUT_DIR:-}"
AGENT_ARCHIVE_BASE_URL="https://github.com/williams342-maker/operation/archive"

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
validate_revision() {
  printf '%s\n' "$1" | grep -Eq '^[0-9a-f]{40}$' || fail "agent revision must be one exact lowercase 40-character Git commit"
}
validate_sha256() {
  printf '%s\n' "$1" | grep -Eq '^[0-9a-f]{64}$' || fail "agent archive SHA-256 must be 64 lowercase hexadecimal characters"
}
verify_agent_archive() {
  local revision="$1" expected="$2" archive="$3" actual
  validate_revision "$revision"
  validate_sha256 "$expected"
  [ -f "$archive" ] || fail "agent archive is missing"
  actual="$(sha256sum "$archive" | awk '{print $1}')"
  [ "$actual" = "$expected" ] || fail "agent archive SHA-256 mismatch"
  tar -tzf "$archive" | awk -v prefix="operation-$revision/" '
    BEGIN { found=0; invalid=0 }
    $0 == "" || $0 ~ /^\// || $0 ~ /(^|\/)\.\.($|\/)/ || index($0, prefix) != 1 { invalid=1; exit }
    { found=1 }
    END { exit found && !invalid ? 0 : 1 }
  ' || fail "agent archive identity or path set is invalid"
}

if [ "${1:-}" = "--verify-agent-archive" ]; then
  [ "$#" -eq 4 ] || fail "verification requires revision, SHA-256, and archive path"
  verify_agent_archive "$2" "$3" "$4"
  exit 0
fi

[ "$(id -u)" -eq 0 ] || fail "run from a root shell (use sudo -i once if needed)"
[ -n "$INPUT_DIR" ] && [ -d "$INPUT_DIR" ] || fail "OPSWORKBENCH_INSTALL_INPUT_DIR must name the protected installer input directory"
CONTROL_CENTER_URL="$(read_secret_file "$INPUT_DIR/control-center-url")" || fail "control-center-url input is required"
CONTROL_CENTER_SERVER_SLUG="$(read_secret_file "$INPUT_DIR/server-slug" 2>/dev/null || true)"
AGENT_REVISION="$(read_secret_file "$INPUT_DIR/agent-revision")" || fail "agent-revision input is required"
AGENT_ARCHIVE_SHA256="$(read_secret_file "$INPUT_DIR/agent-archive-sha256")" || fail "agent-archive-sha256 input is required"
CONTROL_CENTER_ENROLLMENT_TOKEN="$(read_secret_file "$INPUT_DIR/enrollment-token")" || fail "enrollment-token input is required"
CF_ACCESS_CLIENT_ID="$(read_secret_file "$INPUT_DIR/cf-access-client-id")" || fail "Cloudflare Access client ID input is required"
CF_ACCESS_CLIENT_SECRET="$(read_secret_file "$INPUT_DIR/cf-access-client-secret")" || fail "Cloudflare Access client secret input is required"
[ -n "$CONTROL_CENTER_ENROLLMENT_TOKEN" ] || fail "enrollment token is empty"
[ -n "$CF_ACCESS_CLIENT_ID" ] && [ -n "$CF_ACCESS_CLIENT_SECRET" ] || fail "Cloudflare Access service-token credentials are incomplete"
case "$CONTROL_CENTER_URL" in https://*) ;; *) fail "CONTROL_CENTER_URL must use HTTPS" ;; esac
case "$CONTROL_CENTER_SERVER_SLUG" in *[!a-z0-9-]*) fail "server slug must contain lowercase letters, numbers, and hyphens" ;; esac
validate_revision "$AGENT_REVISION"
validate_sha256 "$AGENT_ARCHIVE_SHA256"
AGENT_ARCHIVE_URL="$AGENT_ARCHIVE_BASE_URL/$AGENT_REVISION.tar.gz"

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
  unset CONTROL_CENTER_ENROLLMENT_TOKEN CF_ACCESS_CLIENT_ID CF_ACCESS_CLIENT_SECRET
}
trap cleanup EXIT
curl -fsSL "$AGENT_ARCHIVE_URL" -o "$work_dir/source.tar.gz"
verify_agent_archive "$AGENT_REVISION" "$AGENT_ARCHIVE_SHA256" "$work_dir/source.tar.gz"
install -d -m 0750 "$work_dir/source"
tar -xzf "$work_dir/source.tar.gz" --strip-components=1 -C "$work_dir/source"
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
{
  shell_env_value CONTROL_CENTER_ENROLLMENT_TOKEN "$CONTROL_CENTER_ENROLLMENT_TOKEN"
  shell_env_value CONTROL_CENTER_SERVER_SLUG "$CONTROL_CENTER_SERVER_SLUG"
  shell_env_value CONTROL_CENTER_AGENT_CONFIG "$CONFIG_DIR/agent.json"
} >"$CONFIG_DIR/enrollment.env"
{
  shell_env_value CF_ACCESS_CLIENT_ID "$CF_ACCESS_CLIENT_ID"
  shell_env_value CF_ACCESS_CLIENT_SECRET "$CF_ACCESS_CLIENT_SECRET"
} >"$CONFIG_DIR/machine-auth.env"
chmod 0600 "$CONFIG_DIR/agent.json" "$CONFIG_DIR/enrollment.env" "$CONFIG_DIR/machine-auth.env"
chown "$AGENT_USER:$AGENT_USER" "$CONFIG_DIR/agent.json" "$CONFIG_DIR/enrollment.env"
chown root:root "$CONFIG_DIR/machine-auth.env"

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
for _ in $(seq 1 30); do
  if grep -Eq '"agentId"[[:space:]]*:[[:space:]]*"[^" ]+"' "$CONFIG_DIR/agent.json"; then
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
