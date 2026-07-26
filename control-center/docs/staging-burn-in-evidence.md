# Private staging burn-in evidence

This log contains value-safe staging evidence only. It does not authorize a
production release. Production publication still requires an owner-controlled
Ed25519 signature.

## Active release

- Environment: private staging, host `146.190.210.14`
- Source commit: `f4f584ac86085a22ad1e935ab518d50a46e12f8f`
- Release path: `/opt/opsworkbench/releases/review-f4f584ac/app`
- Immediate rollback: `/opt/opsworkbench/releases/review-32af4a76/app`
- Source archive SHA-256:
  `ce7b3cdbb7d55ca89f5ea6e10619dd8a191209a2bad165a295fd7d4125fb8261`
- Activated: 2026-07-24 UTC

## Completed evidence

### Build and application validation

- Full workspace typecheck passed.
- Full workspace tests passed.
- API: 73 passed, 2 guarded database skips.
- Web: 94 passed across component and contract suites.
- Agent: 43 passed, 6 platform/disposable skips.
- Updater: 4 passed.
- Shared: 55 passed, 1 platform skip.
- Deployment-script and bootstrap verification passed with expected
  platform-only skips.
- The guarded API suite was then run against a fresh internal disposable
  MongoDB container: all 75 API tests passed with zero skips.
- Docker Buildx checks for the API and web images completed with no warnings.
- API and web containers reported healthy with the exact source commit.
- `/readyz` reported API, MongoDB, agent monitoring, audit, rate limiting, and
  cache ready; AI intentionally disabled; environment errors and warnings were
  both zero.
- Authenticated Projects rendered normally on the current release at 1280×900
  and 390×844. At both viewports the document and body scroll widths matched the
  viewport width, and no browser console errors were captured.
- The authenticated Health dashboard showed the exact `e058083` build identity
  and the expected ready/disabled/not-configured subsystem states.
- After the presentation correction, the Health dashboard showed the exact
  `4adf0ba` build identity and labeled the per-organization AI state
  unambiguously as `Organization AI`.
- The authenticated Audit dashboard showed the successful login and
  `project.deployment.expire` event. Its visible table contained no
  password-, bearer-, MongoDB-URL-, API-key-, or private-key-shaped text.
- The authenticated Tasks dashboard contained terminal historical results only;
  the database-level active-state check remained zero.

### Expired deployment reconciliation

- A legacy deployment remained `approved` without an approval-expiry field.
- Deployed reconciliation moved it to terminal `cancelled` with
  `approval_expiry_missing`, a completion timestamp, and one system audit event.
- A repeated reconciliation left the record unchanged and did not duplicate the
  audit event.
- Post-reconciliation counts were zero for queued, claimed, and running agent
  tasks; planned, approved, and deploying project deployments; and active
  rollbacks.

### Restart and recovery

- API and web were recreated on the new images and became healthy.
- Edge was restarted independently and resolved the current API afterward.
- MongoDB was restarted independently, became healthy, and the API returned full
  readiness after reconnecting.
- No active or stuck task, deployment, or rollback state remained after the
  restart sequence.
- A value-safe 30-minute API, web, edge, and MongoDB log scan found zero
  secret-shaped matches. All four containers were running with zero Docker
  restart count and no OOM kills.
- API and web had zero error- or warning-shaped entries. MongoDB had zero error
  or fatal severity entries, assertions, or rollback errors; its generic error
  words were confined to the recorded restart shutdown sequence.
- Edge recorded one `502` at 16:43:59 UTC and one resolver error at 16:43:53 UTC
  during the recorded API/web activation. There were no upstream connection
  refusals or timeouts. Its warning entries were response-buffering notices.
- The `Ops-Workbench` staging agent was restarted independently as its restricted
  service user. It remained active/running with zero service restart count,
  zero error-shaped journal entries, and zero secret-shaped journal matches.
- Its authenticated server inventory heartbeat resumed 33 seconds after the
  restart. No action was taken on the Crafters server.
- A later consistency check found that the legacy staging service was still
  executing an older agent runtime despite the API and web being on `4adf0ba`.
  The runtime lacked the current bounded health retry, non-root ownership,
  fixed Compose activation, and structured failure-stage changes.
- Agent and shared runtime inputs were confirmed unchanged between `4adf0ba`
  and the branch head. A locally rebuilt runtime archive had SHA-256
  `c5a723536425ec45b3592e791c5b8ddd789d2aa2eb552c93ff06b8e538bf3996`.
- The archive was verified on staging, syntax-checked as the restricted agent
  user, and activated atomically with the prior agent and shared `dist`
  directories retained as rollback copies.
- The refreshed service remained active/running with zero systemd restarts and
  no post-activation journal errors. Its authenticated inventory heartbeat
  resumed within the next polling interval, showing current CPU, memory, load,
  disk, and four-container discovery. Fresh Health navigation remained fully
  ready on exact build `4adf0ba`.

### Backup and disposable restore

- Backup ID: `burnin-e058083-20260724T1649Z`
- Backup archive SHA-256:
  `d016f49976ec4a97568648a889b7b8da1b8c1d62b2f135cc46fa9b7969acd6fa`
- Evidence location: `/opt/opsworkbench/backups/staging/`
- The backup was restored into a separate unexposed disposable MongoDB volume.
- Sorted collection document counts and index counts matched the source
  inventory exactly.
- The disposable restore container and volume were removed after verification.
- Live staging remained ready after the rehearsal.

### Disposable identity and isolation suite

- The unguarded database suite created its own isolated database and synthetic
  identities; it did not use the live staging database.
- Two synthetic organizations remained isolated across IDs, queries, users,
  projects, telemetry, tasks, configuration, audit, and history.
- Owner and Administrator allowed operations, Viewer denials, login,
  reauthentication, logout, expired sessions, password reset, CSRF, and
  authorization audit behavior passed.
- Deployment approval separation, digest binding, expiration reconciliation,
  idempotent audit evidence, and redaction assertions passed.
- The disposable MongoDB container, internal network, test images, and test
  source directories were removed after the run.

### Discovery ingestion and audit signal

- A burn-in review found that unchanged `configuration.discovery.received`
  heartbeats were written about every 30 seconds, crowding higher-value audit
  activity out of the visible table.
- Discovery receipts now use a concurrency-safe unique sparse key scoped to the
  server and a 15-minute window. Definition ingestion continues on every poll;
  only the redundant receipt event is suppressed.
- The database suite sends two equivalent discovery polls and requires exactly
  one audit receipt. It also exposed and now covers a conflicting MongoDB
  upsert modifier for newly mapped settings already marked `configured`.
- The corrected unguarded API suite passed 75 of 75 tests with zero skips
  against an isolated MongoDB container.
- On staging, the dedupe index reported unique and sparse, and normal repeated
  polls produced exactly one qualifying event in the current bucket. The Audit
  view showed one post-activation receipt followed by the older pre-activation
  30-second sequence.
- API and web activated on exact commit `ec3c642`; both containers became
  healthy with zero restart count. Fresh Health reported all required
  subsystems ready and exact build `ec3c642`.
- The disposable database container, network, test images, temporary Dockerfile,
  and verifier files were removed after validation.

### Authentication failure and session expiry

- One synthetic invalid login was submitted through the staging host's local
  edge and returned HTTP `401`.
- The database contained exactly one corresponding anonymous `auth.login`
  failure event in the bounded verification window.
- The stored audit record contained neither the synthetic password nor the
  synthetic email identifier used by the request.
- The existing authenticated browser session later expired. Direct navigation
  to the Audit path rendered the sign-in screen instead of protected content.
- A fresh authenticated session was signed out through the public staging UI.
  The application returned to the sign-in screen, and direct navigation back
  to `/audit` continued to render sign-in instead of protected content.
- The temporary request body and value-safe database verifier were removed.

### Recent authentication and enrollment lifecycle

- A fresh authenticated staging session generated one short-lived,
  single-use enrollment credential named `Disposable staging audit validation`.
- The one-time secret display was closed without copying, downloading, or
  emitting the token. The credential was then revoked and its disposable
  database record deleted.
- The Audit view and database contained exactly one successful
  `enrollment.create`, `enrollment.revoke`, and `enrollment.delete` event for
  the same target. Audit metadata contained only expiry and use-limit fields,
  with no secret-shaped values.
- A synthetic staging session was created with authentication deliberately
  outside the ten-minute freshness window. Its enrollment-generation request
  returned HTTP `403` with `RECENT_AUTH_REQUIRED`, created zero enrollment
  records, and produced exactly one `authorization.failure` event with bounded
  reason `recent-auth-required`.
- The synthetic stale session was deleted immediately; no session or
  enrollment artifact remained.

### Task lifecycle audit correlation

- An authenticated staging operator queued a read-only `collect.system` task
  against the OpsWorkbench server only. No task targeted Crafters.
- The first live run exposed two `task.claim` records for one task: the API
  recorded assignment and the agent acknowledgement recorded it again.
- Commit `daa72ff` made the API assignment the single authoritative claim event
  and added database-backed coverage that an acknowledgement cannot duplicate
  it.
- That run also exposed inconsistent target types: create and claim used a
  MongoDB ObjectId while start and completion used the same identifier as a
  string.
- Commit `7a569278` normalized acknowledgement audit targets to ObjectIds and
  added assertions covering both start and completion.
- The guarded API suite passed 75 of 75 tests with zero skips against a fresh,
  isolated MongoDB container after each correction.
- On exact staging commit `7a569278`, a fresh `collect.system` task succeeded
  and produced exactly one `task.create`, `task.claim`, `task.start`, and
  `task.complete` event. All four events referenced the same MongoDB ObjectId.
- The authenticated Tasks and Audit views displayed the successful terminal
  task and the one-per-stage lifecycle. Disposable test containers, networks,
  images, and Dockerfiles were removed.

### Runtime log redaction

- A count-only scan covered the prior 30 minutes of API, web, edge, MongoDB,
  and `opsworkbench-agent.service` logs after the task-audit deployments.
- The bounded patterns covered bearer credentials, MongoDB connection strings,
  password, secret, token, API-key, authorization, and private-key shapes.
- API, web, edge, MongoDB, and agent journal results each reported zero
  secret-shaped matches. No matching log contents or credential-like values
  were emitted during verification.

### Configuration metadata audit lifecycle

- All configuration actions targeted the existing `Project Overview
  Validation` project. The Crafters configuration workspace was inspected only
  as the page's default selection and was not modified.
- A non-production `Audit Validation` environment was created with kind
  `testing` and `protected: false`.
- One non-secret boolean definition, `AUDIT_VALIDATION_FLAG`, received one
  immutable pending public version for future workflow validation. Reloading
  the workspace showed the definition as pending with one prepared setting.
- The Audit view and database contained exactly one successful
  `configuration.environment.create`, `configuration.definition.create`, and
  `configuration.version.create` event. No secret-shaped value appeared in
  those audit records.
- The validation project has zero enabled deployment target profiles, zero
  configuration deployment plans, and zero apply or rollback tasks. The
  immutable-plan control therefore remains disabled and no server, file,
  service, or runtime configuration was changed.

### Disposable configuration rollback proof

- The installed staging agent implementation ran as its restricted
  `opsworkbench-agent` service user against an isolated Docker Compose project.
- The proof used the same fixed, local-build Compose activation path as a
  configuration deployment. No live OpsWorkbench or Crafters container,
  network, environment file, or task was targeted.
- A synthetic configuration mutation activated successfully, then a bounded
  post-activation health failure triggered automatic rollback.
- The agent restored the original environment file byte-for-byte, activated the
  disposable service a second time, passed the rollback health check, and
  returned terminal phase `rolled_back` with deployment error category `health`.
- The reported restored configuration digest matched the original, the backup
  existed, the restored service was running, and the running container received
  the original configuration value.
- The disposable Compose container and network, proof directory, and temporary
  harness files were removed. A bounded follow-up check found no residual proof
  container or network.
- The same scenario was added as a gated real-Docker regression. On staging,
  all 16 configuration-deployment tests passed with zero skips, including real
  Compose activation and restored-service rollback. Its temporary source,
  fixture directories, container, and network were removed afterward.
- Live task history still contains five older `rollback_failed` configuration
  attempts. The direct staging proof establishes the current agent rollback
  mechanics, but does not replace a successful control-plane plan, approval,
  dispatch, acknowledgement, and rollback record.

### 24-hour telemetry review and resource cleanup

- The OpsWorkbench server retained 2,841 telemetry samples from
  2026-07-23 18:45:17 UTC through 2026-07-24 18:44:55 UTC.
- Heartbeat intervals had a 30.237-second median, 32.387-second p95, and
  90.717-second maximum. Five intervals exceeded 60 seconds; the two material
  gaps aligned with recorded staging build/activation work, including the
  exact `7a569278` activation and readiness checkpoint.
- CPU load had a 4.5% median and 100% p95/maximum during repeated local Docker
  builds. Memory use had a 32.41% median, 36.13% p95, and 50.65% maximum.
  Root-disk use rose from 66.09% to 79.48%, with an 80.38% p95 and 81.29%
  maximum.
- The telemetry window contained zero non-running container observations.
  The terminal-state review found zero active tasks and zero expired active
  tasks.
- Docker's build cache accounted for 10.84 GB, of which 10.67 GB was reported
  reclaimable. A build-cache-only prune reclaimed 10.84 GB without removing
  images, volumes, releases, backups, checkpoints, or rollback artifacts.
- The next agent sample reported root-disk use at 66.53%. API and web remained
  healthy with zero restart count, the agent remained active, and readiness
  continued to report exact active build `7a569278`.
- This evidence satisfies the resource, heartbeat, container-state, and task
  portions of the review. It cannot retroactively certify the complete
  24-hour gate because persistent HTTP availability, status-rate, and latency
  series were not collected across container replacements.

### Release authority and monitoring policy

- The authority matrix now assigns build, test, security validation, staging
  deployment, burn-in monitoring, staging rollback, and release-candidate
  creation to autonomous AI operation.
- Production publication remains non-autonomous and requires an
  owner-controlled Ed25519 signature. Owner, Operations Administrator, and
  Publisher are durable roles; one person may currently perform all three
  without delegating signing authority.
- Version-controlled candidate policy `Staging-BurnIn-v1` defines 99.9%
  availability, HTTP errors below 1%, p95 latency below 500 milliseconds,
  agent heartbeat gaps no greater than 60 seconds, and disk warning/critical
  levels of 80%/90%.
- Burn-in is a minimum continuous 24-hour window. An unexpected restart,
  critical alert, latency or availability breach, or unhealthy heartbeat
  resets the observation start.
- The staging authority profile permits deploy, restart, rollback, telemetry,
  browser, and security validation. It denies production publication,
  database migration, DNS changes, payment activation, secret rotation, and
  signing.
- The committed policy remains an unsigned candidate with an explicit owner
  key-ID placeholder. It cannot enable production publication until the owner
  inserts the public-key identifier and signs the exact policy digest offline.

### HTTP target SSRF remediation

- Security review found that an authenticated Developer could persist or
  submit a syntactically public HTTP hostname whose DNS answer was private,
  and that agent and API redirect handling did not pin the validated address.
- Health-check create/update routes and ad-hoc HTTP task creation now resolve
  and reject private, link-local, metadata, benchmark, documentation, multicast,
  and mixed public/private answers before storing or dispatching work.
- Agent health checks independently resolve every target, reject any unsafe
  answer, pin the validated IP address for the socket connection, preserve the
  original hostname for HTTP Host and TLS verification, and manually
  revalidate every redirect hop.
- API website discovery applies the same address-pinning and per-redirect
  validation, closing the equivalent DNS-rebinding path in onboarding.
- Configuration deployment health validation reuses the pinned request path.
  A private redirect fails the new activation, restores the original
  environment file, and validates the rolled-back service without contacting
  the private destination.
- Regression coverage includes direct private and metadata targets, reserved
  IPv4/IPv6 ranges, private and mixed DNS answers, credential-bearing
  redirects, excess redirects, address pinning, ad-hoc tasks, API discovery,
  and rollback recovery.
- Full workspace type checking and lint passed. The complete local suite passed
  298 tests with 11 intentional platform/disposable skips.
- Staging API and web were atomically activated from exact commit
  `132e3205733c82a616bdf9143815f6a0adc05369`. Both containers reported healthy,
  zero restarts, and matching immutable OCI revision labels; the previous
  `7a569278` release remains the rollback target.
- The restricted `opsworkbench-agent` systemd service was atomically upgraded
  from the agent artifact embedded in that exact API image. Before activation,
  the deployed artifact rejected a direct metadata address and a public URL
  redirecting to a private address without making the private request.
- After activation, the agent reported `active`, `NRestarts=0`, the exact
  `132e3205` source marker, and a fresh online heartbeat at
  2026-07-24 19:32:12 UTC. The prior source tree remains available as the
  timestamped agent rollback target.
- A live authenticated staging API request attempted to create a health check
  for `http://169.254.169.254/latest/meta-data/`. The deployed API returned
  HTTP 400 with `Health check URL is not allowed`; database counts were zero
  both before and after the request. The transient proof session was deleted.

### Continuous staging burn-in activation

- One enabled health check, `OpsWorkbench public health` (ID
  `6a63c1be560b71f5eefc56ec`), checks
  `https://www.opsworkbench.org/healthz` every 30 seconds with expected HTTP
  status 200 and a 5-second timeout.
- Enabled health-check plans are sent to the restricted agent during normal
  polls. The agent schedules them by interval, uses the SSRF-safe pinned
  request path, records bounded latency and status evidence, and returns sparse
  telemetry to the API.
- The first live rollout exposed a Node 22 all-address DNS lookup
  incompatibility (`ERR_INVALID_IP_ADDRESS`). Commit `89f1f955` corrected the
  lookup contract without weakening address validation. The initial failures
  remain preserved as truthful pre-window evidence.
- The API evaluates live HTTP samples, heartbeat gaps, disk use, Docker restart
  increments, and critical alerts against the version-controlled
  `Staging-BurnIn-v1` policy. Any configured reset condition moves the
  authoritative start forward; a clean result cannot complete before the
  policy's 24-hour minimum.
- Exact commit `f4f584ac86085a22ad1e935ab518d50a46e12f8f` was atomically
  activated for the staging API, web, and restricted agent. API and web
  reported healthy with zero Docker restarts; the agent reported
  active/running with zero systemd restarts. The public health endpoint
  returned the same full commit.
- The authenticated Project Overview now presents the live policy state,
  progress, thresholds, metrics, sample/check counts, reset reasons, and an
  explicit reminder that production publication still requires the owner
  Ed25519 signature.
- The authoritative observation boundary is
  `2026-07-24T20:19:41.648Z`. The first eligible sample began the current
  window at `2026-07-24T20:20:00.484Z`; the earliest possible completion is
  `2026-07-25T20:20:00.484Z`.
- At `2026-07-24T20:22:54.224Z`, the evaluator reported six samples, one
  enabled HTTP check, 100% availability, 0% HTTP error rate, 50-millisecond
  p95 latency, a 30.594-second maximum heartbeat gap, 76.436% maximum disk use,
  zero unexpected restarts, zero critical alerts, and no reset reasons. Every
  policy gate passed except the still-running minimum observation duration.
- Full workspace type checking and lint passed. The evaluator milestone passed
  the full 316-test workspace suite with 305 passes and 11 intentional skips.
  The live UI milestone passed all 94 web tests.

### Authoritative continuous burn-in completion

- The authenticated Project Overview reported the `Staging-BurnIn-v1`
  observation as `complete` after the minimum continuous window elapsed. The
  window began at `2026-07-24T20:20:00.484Z` and its earliest completion was
  `2026-07-25T20:20:00.484Z`.
- At the final authenticated review on 2026-07-26 UTC, the policy evaluator
  reported 3,440 telemetry samples from one enabled HTTP check, 100.000%
  availability, 0.000% HTTP error rate, 46-millisecond p95 latency, a
  30.6-second maximum agent heartbeat gap, 76.57% maximum disk use, zero
  unexpected restarts, zero critical alerts, and no reset reason.
- Public `/healthz` and `/readyz` remained healthy. The API and web containers,
  their immutable OCI revision labels, the restricted agent source marker, and
  the public build identity all aligned to exact staging commit
  `f4f584ac86085a22ad1e935ab518d50a46e12f8f`.
- API, web, edge, and MongoDB were running and healthy with zero Docker restart
  counts. `opsworkbench-agent.service` was active/running with zero systemd
  restart count.
- The immediate rollback checkpoint is
  `/opt/opsworkbench/checkpoints/deploy-f4f584ac-20260724T201801Z`. Its sorted
  per-file SHA-256 evidence digest is
  `34a21f0fb39132d16d58dc0fc01c27c947d5107cf3cc995c2f858be945eba03b`;
  it binds candidate commit `f4f584ac86085a22ad1e935ab518d50a46e12f8f`
  to prior release `/opt/opsworkbench/releases/review-32af4a76/app` and records
  before/after container, health, readiness, and agent-state evidence.
- The final review created no deployment, publication, DNS, payment, database,
  secret-rotation, or signing action. Production publication remains disabled
  and still requires the owner-controlled Ed25519 boundary.

### Host-specific configuration target candidate

- `deploy/targets/opsworkbench-staging.profile.json` records a value-free,
  version-controlled target request for the existing validation project,
  testing environment, and OpsWorkbench staging server.
- The target binds least-privilege repository boundary
  `/etc/opsworkbench-agent/targets/opsworkbench-staging`, environment file
  `env/.env.staging`, Compose project `opsworkbench`, and the current
  configuration digest without recording any environment value.
- Ordered activation uses `docker-compose.yml` followed by
  `app.override.yml`. Their SHA-256 digests match the live shared base and
  active `f4f584ac` release override respectively; runtime container labels
  independently reported the source files in the same order.
- Only `api` and `web` are allowlisted as stateless activation services;
  `mongo` is explicitly protected. The public health validation remains
  `https://www.opsworkbench.org/healthz` with a five-second request timeout.
- The target was prepared beneath the agent's existing
  `ReadWritePaths=/etc/opsworkbench-agent` systemd boundary. The directory is
  mode `0750`, Compose inputs are mode `0640`, and the environment file is mode
  `0600`; all are restricted-agent-owned.
- The environment file was copied server-side without displaying its contents
  and retained exact digest
  `2f7bbe24480df6b91bc467c6ba42459219d9403a80a252eb3b1b424b60e7ddb4`.
  The restricted agent passed `docker compose config --quiet` using the ordered
  base and override. No profile was registered or applied, and no service was
  built, recreated, restarted, or changed.

## Remaining gates

- Exercise the end-to-end control-plane configuration plan, separate approval,
  dispatch, acknowledgement, and successful controlled rollback record.
- Register the committed target candidate through the authenticated control
  plane, then exercise plan creation, independent approval, dispatch,
  acknowledgement, and a controlled rollback record.
- Before any production publication, insert the owner public-key identifier
  into a new policy revision and apply the required offline Ed25519 signatures.
