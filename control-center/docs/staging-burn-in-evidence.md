# Private staging burn-in evidence

This log contains value-safe staging evidence only. It does not authorize a
production release. Production publication still requires an owner-controlled
Ed25519 signature.

## Active release

- Environment: private staging, host `146.190.210.14`
- Source commit: `ec3c642a275a0305384cef3510c606e1a10d1f7f`
- Release path: `/opt/opsworkbench/releases/review-ec3c642/app`
- Immediate rollback: `/opt/opsworkbench/releases/review-4adf0ba/app`
- Source archive SHA-256:
  `7715a775eca09edc51d1b140c2354e9a3cc62c551fb75a884e8ec279740195c6`
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
- The temporary request body and value-safe database verifier were removed.

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

## Remaining gates

- Complete at least 24 continuous hours of threshold monitoring.
- Complete a live public-path logout check if it is required in addition to the
  successful expired-session check.
- Complete the remaining recent-auth, enrollment, configuration, and task audit
  categories plus API, agent, proxy, and Docker log redaction.
- Exercise the end-to-end control-plane configuration plan, separate approval,
  dispatch, acknowledgement, and successful controlled rollback record.
- Record the monitoring/on-call/rollback owners and final owner sign-off.
