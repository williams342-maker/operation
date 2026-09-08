# Hosted Multi-Project Control Center

**Current work order: [handoff work order 2026-09-01](docs/handoff-work-order-20260901.md)** — verified live state and the re-scoped task list. Read it before acting on any older handoff brief.

Staging operations: [deployment runbook](docs/staging-deployment.md), [readiness checklist](docs/staging-readiness-checklist.md), [security review](docs/staging-security-review.md), [credential-remediation checklist](docs/staging-credential-remediation-checklist.md), [deployment intake](docs/staging-deployment-intake.md), and [burn-in plan](docs/staging-burn-in-plan.md).
Release operations: [deterministic deployment artifacts](docs/release-artifacts.md).
Forge integration: **[parked status](docs/forge-chain-status-20260901.md)** — the chain remains DISABLED until the current activation gates pass; read the historical NO-GO findings before touching it. Specification: [`forge-build-v2` + `forge-target-binding-v1`](docs/forge-manifest-spec.md) (draft).

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

## URL-first server onboarding

Administrators add a server from the **Servers** page using its public website URL. OpsWorkbench normalizes the URL, optionally performs SSRF-safe public discovery, creates or reuses a pending server target, and displays a target-bound install command once. The agent reports the physical machine identity and metadata; the website URL is informational and is not used as machine authorization.

The installer consumes credentials from a protected temporary input directory and never requires a token in a command line. See [agent machine access](docs/agent-machine-access.md) and [URL-first onboarding migration](docs/url-first-onboarding-migration.md).

Agents never receive browser-originated secrets. Mongo checks should run on the agent and return only status, latency, database name, error category, and timestamp.

## Read-only AI Assistant

The optional AI Assistant explains server and managed-application evidence already available to the authenticated user. The browser calls only the OpsWorkbench API; provider credentials remain server-side. The first milestone cannot run commands, restart services, deploy, edit configuration, call tools, or execute proposed actions. Every result displays **No actions were executed**.

Enable it only in an approved staging window with `AI_ASSISTANT_ENABLED=true`, `AI_DEFAULT_PROVIDER`, `AI_DEFAULT_MODEL`, and provider/model allowlists. OpenAI uses `OPENAI_API_KEY` and optional `OPENAI_BASE_URL`; Anthropic uses `ANTHROPIC_API_KEY` and optional `ANTHROPIC_BASE_URL`; `AI_API_KEY`/`AI_BASE_URL` remain controlled compatibility overrides. `AI_PROVIDER` and `AI_MODEL` are deprecated. Limits use `AI_REQUEST_TIMEOUT_MS`, `AI_MAX_CONTEXT_BYTES`, and `AI_MAX_OUTPUT_TOKENS`. When disabled or incomplete, existing behavior is unchanged and readiness makes no external request.

Context can include organization-scoped server identity/status, bounded metrics and discovery, managed-application metadata, health/database-check status, and recent sanitized operation history. Complete environment files, process environments, credentials, enrollment/session tokens, authorization/cookie headers, private keys, connection strings, unrestricted logs, raw task payloads/results, repository files, and provider request headers are excluded. Collected data is treated as untrusted evidence; instructions found inside it are never followed.

Audit events retain user/scope identifiers, provider/model, included category names, byte and duration counts, response/error status, and aggregate redaction counts. They do not retain the raw question, prompt, context, logs, provider response, or secrets. Disable the feature immediately with `AI_ASSISTANT_ENABLED=false`.

Future controlled actions require separate schema validation, permissions, allowlisting, signatures, idempotency, auditing, explicit confirmation, and execution by OpsWorkbench code. No such execution exists in this milestone.

### Operational enablement, privacy, and cost controls

Global and organization-level enablement are both required. Configure server-controlled comma-separated `AI_ALLOWED_PROVIDERS` and `AI_ALLOWED_MODELS` lists plus `AI_DEFAULT_PROVIDER` and `AI_DEFAULT_MODEL` before staging. The browser cannot submit arbitrary providers, models, credentials, or base URLs. Provider credentials remain API environment variables because the existing secret-reference design is agent-local.

Owners and Administrators have `ai:admin`; existing roles retain `ai:use`, which never grants access to resources they cannot already view. MongoDB-backed usage records enforce per-user hourly, organization daily, optional monthly request/token, and concurrent-request limits. These records contain IDs, provider/model, scope, context bytes, duration, outcome, failure category, and provider token counts when available, and expire after 400 days. Raw questions, prompts, context, logs, secrets, and responses are excluded.

Enabling requires acknowledgment that sanitized, bounded operational data may be sent externally, retention depends on the provider account and contract, and charges may apply. OpsWorkbench does not claim zero retention or approve any provider for production.

For staging, configure environment credentials and allowlists, restart only staging, complete the checklist below, then enable the organization in Organization Settings. For emergency disablement, set `AI_ASSISTANT_ENABLED=false` and restart the API. For rollback, disable globally and roll back code; the additive organization field and `ai_usage` collection may remain because older code ignores them.

Provider review checklist: retention settings; training opt-out; processing region; contract/privacy terms; account logging; abuse-monitoring retention; model availability; token accounting; spend limits; and incident-response contact.

## Enrollment Management

Owners and Administrators can open **Administration → Enrollment** to create and manage agent enrollment credentials. The dashboard separates active, expired/exhausted, and revoked tokens and shows remaining uses without ever returning a stored token.

### Enroll a server

1. Select **Generate Enrollment Token**.
2. Choose a friendly name, expiration, maximum uses, and optional description.
3. Generate the token and copy the install command from the one-time dialog.
4. Paste the command into a supported Linux server as a sudo-capable user.
5. Wait for the installer to report success. The server appears automatically in **Servers**.

The generated dialog is the only time plaintext is available. The API stores a salted hash, and the installer removes the plaintext enrollment token from disk after successful enrollment.

### Installer behavior

`https://opsworkbench.org/install.sh` supports apt-based and dnf-based Linux distributions. It installs Node.js and required tools, creates a locked-down `opsworkbench-agent` system user, builds the agent, writes root-owned configuration under `/etc/opsworkbench-agent`, registers a hardened systemd unit, starts it, verifies enrollment, removes the consumed token, and restarts the service with its permanent agent credential.

Generate the install workflow in **Enrollments**, open an interactive root shell with
`sudo -i` if necessary, and paste the workflow. It reads credentials without echo,
downloads the installer to a protected temporary file, validates and displays it for
review, then asks for confirmation before execution. Never put enrollment or Cloudflare
credentials directly in shell commands, and never use `curl | bash`.

### Enrollment API

- `POST /api/admin/enrollment/generate` — creates a hashed token and returns plaintext once.
- `GET /api/admin/enrollment` — lists safe metadata and usage state.
- `POST /api/admin/enrollment/revoke` — revokes an active credential.
- `DELETE /api/admin/enrollment/:id` — deletes a revoked or expired record.
- `GET /api/admin/enrollment/download/:id` — returns HTTP 410 because plaintext is intentionally not retained; use the one-time client-side download.
- `POST /api/agent/enroll` — atomically consumes one allowed use and issues permanent agent credentials.

All administrative operations require the `servers:enroll` permission and produce audit events. Agent enrollment records success, rejection reason, hostname, usage count, and resulting server identifier without recording the token.

### Deployment

Build and verify all workspaces before updating staging:

```sh
npm ci
npm run build --workspace @control-center/shared
npm run build --workspace @control-center/api
npm run build --workspace @control-center/web
npm run build --workspace @control-center/agent
npm test --workspace @control-center/api
npm test --workspace @control-center/agent
```

Deploy with `deploy/docker-compose.staging.yml`. Existing enrollment documents remain compatible; new policy fields are populated for newly generated credentials.
