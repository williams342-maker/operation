#!/usr/bin/env bash
set -Eeuo pipefail
CONTROL_CENTER_URL="${CONTROL_CENTER_URL:-https://opsworkbench.org}"
CONTROL_CENTER_ENROLLMENT_TOKEN="${CONTROL_CENTER_ENROLLMENT_TOKEN:-}"
CONTROL_CENTER_SERVER_SLUG="${CONTROL_CENTER_SERVER_SLUG:-}"
AGENT_USER="opsworkbench-agent"
INSTALL_DIR="/opt/opsworkbench-agent"
CONFIG_DIR="/etc/opsworkbench-agent"
fail() { printf 'OpsWorkbench installer: %s\n' "$*" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || fail "run through sudo as shown in the Control Center"
[ -n "$CONTROL_CENTER_ENROLLMENT_TOKEN" ] || fail "CONTROL_CENTER_ENROLLMENT_TOKEN is required"
case "$CONTROL_CENTER_URL" in https://*) ;; *) fail "CONTROL_CENTER_URL must use HTTPS" ;; esac
case "$CONTROL_CENTER_SERVER_SLUG" in *[!a-z0-9-]*) fail "CONTROL_CENTER_SERVER_SLUG must contain lowercase letters, numbers, and hyphens" ;; esac

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
archive="$(mktemp)"; trap 'rm -f "$archive"' EXIT
curl -fsSL "https://github.com/williams342-maker/operation/archive/refs/heads/phase-2b-readonly-task-system.tar.gz" -o "$archive"
rm -rf "${INSTALL_DIR:?}/source"
install -d -m 0750 -o "$AGENT_USER" -g "$AGENT_USER" "$INSTALL_DIR/source"
tar -xzf "$archive" --strip-components=1 -C "$INSTALL_DIR/source"
cd "$INSTALL_DIR/source/control-center"
npm ci --omit=optional
npm run build --workspace @control-center/shared
npm run build --workspace @control-center/agent

installation_id="$(cat /proc/sys/kernel/random/uuid 2>/dev/null || node -e 'console.log(require("crypto").randomUUID())')"
cat >"$CONFIG_DIR/agent.json" <<EOF
{"controlCenterUrl":"$CONTROL_CENTER_URL","installationId":"$installation_id","requestedSlug":"$CONTROL_CENTER_SERVER_SLUG","agentId":"","agentSecret":"","agentVersion":"0.1.0","allowedRoots":["/srv"],"pollIntervalSeconds":30,"mongoChecks":{}}
EOF
cat >"$CONFIG_DIR/enrollment.env" <<EOF
CONTROL_CENTER_ENROLLMENT_TOKEN=$CONTROL_CENTER_ENROLLMENT_TOKEN
CONTROL_CENTER_SERVER_SLUG=$CONTROL_CENTER_SERVER_SLUG
CONTROL_CENTER_AGENT_CONFIG=$CONFIG_DIR/agent.json
EOF
chmod 0600 "$CONFIG_DIR/agent.json" "$CONFIG_DIR/enrollment.env"
chown "$AGENT_USER:$AGENT_USER" "$CONFIG_DIR/agent.json" "$CONFIG_DIR/enrollment.env"

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
    printf 'CONTROL_CENTER_AGENT_CONFIG=%s\n' "$CONFIG_DIR/agent.json" >"$CONFIG_DIR/enrollment.env"
    chmod 0600 "$CONFIG_DIR/enrollment.env"; chown "$AGENT_USER:$AGENT_USER" "$CONFIG_DIR/enrollment.env"
    systemctl restart opsworkbench-agent.service
    systemctl is-active --quiet opsworkbench-agent.service || fail "agent service did not remain active"
    printf '\nOpsWorkbench agent enrolled successfully.\nControl Center: %s\nService: opsworkbench-agent (active)\n' "$CONTROL_CENTER_URL"
    exit 0
  fi
  sleep 2
done
journalctl -u opsworkbench-agent.service --no-pager -n 20 >&2 || true
fail "enrollment did not complete within 60 seconds"
