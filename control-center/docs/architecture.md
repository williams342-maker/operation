# Phase 1 Architecture

## Boundary

Phase 1 is read-only. The API and agent do not implement deployment, git pull, service restart/stop, environment editing, rollback, backup restore, log deletion, or arbitrary shell execution.

## Organization Isolation

Every persistent document that belongs to a tenant carries `orgId`: users, sessions, enrollments, servers, projects, health checks, Mongo checks, telemetry, nonces, and audit events. API routes derive `orgId` from the authenticated session or enrolled agent credential and include it in database filters. Agent-provided organization or server identifiers are ignored for trust decisions.

## Agent Protocol

Enrollment uses a one-time token. The token is hashed in the database, expires, and is marked used atomically. Enrollment returns `agentId`, `agentSecret`, `serverId`, and polling interval. The API stores only the derived verification hash needed for HMAC validation; it does not store plaintext agent secrets.

Polling is outbound HTTPS from agent to API. Requests include:

- `x-agent-id`
- `x-agent-timestamp`
- `x-agent-nonce`
- `x-agent-signature`

The signature is HMAC-SHA256 over method, path, timestamp, nonce, and body hash. The API rejects stale timestamps, duplicate nonces, missing signatures, unknown agents, revoked agents, and bad signatures.

## Read-Only Inspection

The agent uses fixed executables and argument arrays via `execFile` only. Allowed executables are currently `git` and `docker`. Registered repo and Compose paths must resolve inside configured `allowedRoots`; traversal and symlink escapes are rejected.

## Data Model

Phase 1 assigns each project to one primary server. This avoids a join table now while leaving room for a future project-server membership model.

## Telemetry

`servers.currentState` stores latest state. `telemetry` stores bounded history with TTL via `expiresAt`. Heartbeat freshness marks stale servers offline in overview reads.

## Mongo Checks

Mongo connectivity checks run on the agent where possible. The browser never receives connection strings. Agent returns only success/failure, latency, database name, error category, and timestamp.

## Audit

Audit events include actor, organization, action, target type, target ID, timestamp, result, request correlation ID, and sanitized metadata. Secrets and raw credentials are filtered from audit metadata.

## Staging readiness plane

The staging topology keeps the browser behind the same HTTPS origin as the API, connects the API to a dedicated staging MongoDB database, and enrolls agents through outbound HTTPS polling. Startup validates environment shape before opening the listener, then connects MongoDB and creates required indexes.

Three secret-free health surfaces have distinct purposes:

- `GET /healthz` is public process liveness and returns build identity only.
- `GET /readyz` is public deployment readiness and verifies MongoDB plus initialized subsystems.
- `GET /api/system/health` and `GET /api/system/diagnostics` are authenticated operational reports. Diagnostics requires audit permission.

The API has no in-process background worker queue in this release; health reports that state as `not_configured`. The operational context cache is in memory and is intentionally reported without cached content. AI remains globally disabled unless explicitly enabled, and startup readiness checks never contact an external provider.
