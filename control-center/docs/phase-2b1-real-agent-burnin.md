# OpsWorkbench Phase 2B.1 Real-Agent Staging Validation

This runbook is for a disposable managed target only. Do not run it on any production server or on the OpsWorkbench control-center host unless explicit approval is given.

## Target prerequisites

- Fresh Ubuntu 24.04 host with no production workloads.
- Docker Engine and Docker Compose plugin.
- Git and Node.js 22.
- No inbound agent port. The agent uses outbound HTTPS polling only.
- No production credentials, data, paths, or databases.

## Rollback point

Accepted Phase 2B rollback tag: `v0.2.1-phase-2b-readonly-task-system`.

## Test workload

Use `deploy/agent-burnin/docker-compose.yml` on the disposable target. It creates:

- `http-test`: minimal HTTP service on `127.0.0.1:18081` with `GET /health`.
- `mongo-test`: disposable MongoDB bound to `127.0.0.1:27028`.
- A named Docker volume `agent-burnin_mongo_test_data`.

Create a harmless local Git repository under `/srv/opsworkbench-agent-burnin/repo`:

```bash
sudo mkdir -p /srv/opsworkbench-agent-burnin/repo
sudo chown -R "$USER:$USER" /srv/opsworkbench-agent-burnin
cd /srv/opsworkbench-agent-burnin/repo
git init -b main
printf 'opsworkbench burn-in\n' > README.md
git add README.md
git commit -m 'Initial burn-in fixture'
```

Start the workload:

```bash
cd /srv/opsworkbench-agent-burnin
cp /opt/control-center/control-center/deploy/agent-burnin/docker-compose.yml ./docker-compose.yml
cp /opt/control-center/control-center/deploy/agent-burnin/env.test-workload.example ./.env.test-workload
chmod 600 .env.test-workload
# Replace the example Mongo password locally before starting.
docker compose up -d --build
curl -fsS http://127.0.0.1:18081/health
```

## Agent installation outline

Use a dedicated non-root user:

```bash
sudo useradd --system --create-home --home-dir /var/lib/opsworkbench-agent --shell /usr/sbin/nologin opsworkbench-agent
sudo usermod -aG docker opsworkbench-agent
sudo install -d -o opsworkbench-agent -g opsworkbench-agent -m 0700 /etc/opsworkbench-agent /var/lib/opsworkbench-agent /opt/opsworkbench-agent
```

Docker group membership allows local Docker socket read operations and is a meaningful privilege. It is required for Phase 2B Docker/Compose inspection unless a narrower Docker authorization layer is added later. Do not grant passwordless sudo.

Build/copy the agent from the OpsWorkbench repository checkout:

```bash
cd /opt/control-center/control-center
npm ci
npm run build --workspace @control-center/shared
npm run build --workspace @control-center/agent
sudo rsync -a apps/agent/package.json apps/agent/dist packages/shared/package.json packages/shared/dist package.json package-lock.json /opt/opsworkbench-agent/
sudo chown -R opsworkbench-agent:opsworkbench-agent /opt/opsworkbench-agent
```

Create `/etc/opsworkbench-agent/agent.json` with mode `0600` and owner `opsworkbench-agent`. Do not place real values in shell history.

```json
{
  "controlCenterUrl": "https://opsworkbench.org",
  "agentId": "",
  "agentSecret": "",
  "agentVersion": "0.2.1-burnin",
  "allowedRoots": ["/srv/opsworkbench-agent-burnin"],
  "pollIntervalSeconds": 30,
  "mongoChecks": {}
}
```

After creating a Mongo check in OpsWorkbench, add only the check ID as the key and a local disposable URI as the value. Never send this URI to the browser or audit metadata.

## systemd unit

Create `/etc/systemd/system/opsworkbench-agent.service`:

```ini
[Unit]
Description=OpsWorkbench Agent
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
User=opsworkbench-agent
Group=opsworkbench-agent
WorkingDirectory=/opt/opsworkbench-agent
Environment=NODE_ENV=production
Environment=CONTROL_CENTER_AGENT_CONFIG=/etc/opsworkbench-agent/agent.json
EnvironmentFile=-/etc/opsworkbench-agent/enrollment.env
ExecStart=/usr/bin/node /opt/opsworkbench-agent/apps/agent/dist/agent.js
Restart=always
RestartSec=10
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/etc/opsworkbench-agent /var/lib/opsworkbench-agent

[Install]
WantedBy=multi-user.target
```

Use `/etc/opsworkbench-agent/enrollment.env` only for first enrollment:

```bash
sudo install -o opsworkbench-agent -g opsworkbench-agent -m 0600 /dev/null /etc/opsworkbench-agent/enrollment.env
sudo editor /etc/opsworkbench-agent/enrollment.env
# CONTROL_CENTER_ENROLLMENT_TOKEN=one-time-token
sudo systemctl daemon-reload
sudo systemctl enable --now opsworkbench-agent
```

Immediately after successful enrollment, remove the token file or clear its contents:

```bash
sudo truncate -s 0 /etc/opsworkbench-agent/enrollment.env
sudo systemctl restart opsworkbench-agent
```

## Live validation matrix

Queue each task type from OpsWorkbench and verify queued -> claimed -> running -> succeeded/expected failure:

- `collect.system`
- `inspect.docker`
- `inspect.compose`
- `inspect.git`
- `check.http`
- `check.mongo`
- `collect.telemetry`

Use the project paths:

- Repository path: `/srv/opsworkbench-agent-burnin/repo`
- Compose path: `/srv/opsworkbench-agent-burnin/docker-compose.yml`
- HTTP URL: `http://127.0.0.1:18081/health` only if configured as agent-local; otherwise use a non-private URL because control-center-side SSRF protections reject localhost.

## Protocol/failure tests

Use a controlled test harness or temporary credential copy outside shell history to verify invalid signature, modified payload, wrong agent/server/org, expired task, duplicate claim, duplicate completion, revoked agent, rotation, oversized result, cancellation, and unavailable HTTP/Mongo categories.

Do not print credentials, tokens, cookies, signatures, Mongo URIs, or agent secrets.

## Burn-in

Run for at least 24 hours. Keep diagnostic task volume low and bounded. Record:

- Heartbeat continuity.
- Success/failure counts by task type.
- Median/max task completion latency.
- CPU, memory, disk, API errors, Mongo growth.
- Stuck claimed/running tasks.
- Secret-like values in API, agent, Docker, proxy, and audit logs.

## Cleanup

```bash
sudo systemctl disable --now opsworkbench-agent || true
sudo rm -f /etc/systemd/system/opsworkbench-agent.service
sudo systemctl daemon-reload
sudo rm -rf /etc/opsworkbench-agent /var/lib/opsworkbench-agent /opt/opsworkbench-agent
cd /srv/opsworkbench-agent-burnin && docker compose down -v --remove-orphans
sudo rm -rf /srv/opsworkbench-agent-burnin
sudo userdel opsworkbench-agent || true
```

