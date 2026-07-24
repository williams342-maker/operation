#!/usr/bin/env bash
set -euo pipefail

install -d -m 0755 /etc/opsworkbench-fixture
openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
  -subj "/CN=opsworkbench-bootstrap-fixture" \
  -addext "subjectAltName=IP:127.0.0.1" \
  -keyout /etc/opsworkbench-fixture/release.key \
  -out /etc/opsworkbench-fixture/release.crt >/dev/null 2>&1
install -m 0644 /etc/opsworkbench-fixture/release.crt /usr/local/share/ca-certificates/opsworkbench-bootstrap-fixture.crt
update-ca-certificates >/dev/null

cat >/etc/systemd/system/opsworkbench-bootstrap-fixture.service <<'UNIT'
[Unit]
Description=Disposable OpsWorkbench bootstrap fixture servers
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/node /usr/local/lib/opsworkbench-bootstrap-fixture/fake-control-center.mjs
Restart=always

[Install]
WantedBy=multi-user.target
UNIT

groupadd --system opsworkbench-agent
useradd --system --gid opsworkbench-agent --home-dir /var/lib/opsworkbench-agent --shell /usr/sbin/nologin opsworkbench-agent
install -d -o root -g opsworkbench-agent -m 0750 /etc/opsworkbench-agent
cat >/etc/opsworkbench-agent/agent.json <<'JSON'
{
  "controlCenterUrl": "http://127.0.0.1:18000",
  "installationId": "fixture-installation",
  "requestedSlug": "",
  "agentId": "fixture-agent",
  "agentSecret": "fixture-agent-secret-at-least-32-characters",
  "serverId": "fixture-server",
  "agentVersion": "0.1.0",
  "protocolVersion": "task-v1",
  "packageType": "tar",
  "releaseChannel": "stable",
  "allowedRoots": [],
  "pollIntervalSeconds": 10,
  "mongoChecks": {}
}
JSON
chown root:opsworkbench-agent /etc/opsworkbench-agent/agent.json
chmod 0640 /etc/opsworkbench-agent/agent.json
printf '%s\n' 'CONTROL_CENTER_AGENT_CONFIG=/etc/opsworkbench-agent/agent.json' >/etc/opsworkbench-agent/enrollment.env
install -o root -g opsworkbench-agent -m 0640 /dev/null /etc/opsworkbench-agent/machine-auth.env

install -d -o root -g root -m 0755 /opt/opsworkbench-agent/source/control-center/apps/agent/dist
cat >/opt/opsworkbench-agent/source/control-center/apps/agent/dist/agent.js <<'JS'
setInterval(() => {}, 60_000);
JS
cat >/etc/systemd/system/opsworkbench-agent.service <<'UNIT'
[Unit]
Description=Disposable legacy OpsWorkbench Agent
After=opsworkbench-bootstrap-fixture.service
Requires=opsworkbench-bootstrap-fixture.service

[Service]
Type=simple
User=opsworkbench-agent
Group=opsworkbench-agent
ExecStart=/usr/bin/node /opt/opsworkbench-agent/source/control-center/apps/agent/dist/agent.js
Restart=always

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now opsworkbench-bootstrap-fixture.service opsworkbench-agent.service >/dev/null
systemctl is-active --quiet opsworkbench-bootstrap-fixture.service
systemctl is-active --quiet opsworkbench-agent.service
