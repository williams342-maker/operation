# Hosted Multi-Project Control Center

Phase 1 implements a read-only hosted control center plus an outbound polling agent.

## Phase 1 Scope

- Organizations, users, servers, projects, enrollments, health checks, Mongo checks, telemetry, and audit logs are organization-scoped.
- Agents communicate outbound over signed HTTPS polling.
- One-time enrollment tokens expire and are single-use.
- Agent secrets are stored hashed in the API database.
- Signed agent requests include timestamp and nonce replay protection.
- Phase 1 contains no deployment, restart, env editing, rollback, backup restore, log deletion, or arbitrary shell execution.
- Docker, Docker Compose, Git, HTTP health, Mongo connectivity, CPU, memory, disk, and uptime are read-only status checks.

## Local Development

API:

```powershell
cd control-center\apps\api
npm install
npm run dev
```

Agent:

```powershell
cd control-center\apps\agent
npm install
npm run dev
```

Web:

```powershell
cd control-center\apps\web
npm install
npm run dev
```

## Security Notes

Use `CONTROL_CENTER_SESSION_SECRET`, `CONTROL_CENTER_ENCRYPTION_KEY`, and `MONGO_URL` in development. The encryption key must be 32 bytes encoded as base64.

Agents never receive browser-originated secrets. Mongo checks should run on the agent and return only status, latency, database name, error category, and timestamp.
