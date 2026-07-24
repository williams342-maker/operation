# Private staging burn-in evidence

This log contains value-safe staging evidence only. It does not authorize a
production release. Production publication still requires an owner-controlled
Ed25519 signature.

## Active release

- Environment: private staging, host `146.190.210.14`
- Source commit: `4adf0ba8e78dfe8505c64b24e9eb7c2b074f6cda`
- Release path: `/opt/opsworkbench/releases/review-4adf0ba/app`
- Immediate rollback: `/opt/opsworkbench/releases/review-e058083/app`
- Source archive SHA-256:
  `486dce5258707a763fd42d66cb66dd1be0bf535e627683ef149b50f6fa603d13`
- Activated: 2026-07-24 UTC

## Completed evidence

### Build and application validation

- Full workspace typecheck passed.
- Full workspace tests passed.
- API: 73 passed, 2 guarded database skips.
- Web: 94 passed across component and contract suites.
- Agent: 43 passed, 5 platform/disposable skips.
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

## Remaining gates

- Complete at least 24 continuous hours of threshold monitoring.
- Complete live public-path logout and expired-session checks if they are
  required in addition to the isolated staging-host suite.
- Complete the remaining failed-login, recent-auth, enrollment, configuration,
  and task audit categories plus API, agent, proxy, and Docker log redaction.
- Exercise the disposable agent restart/recovery check.
- Exercise an end-to-end non-production configuration deployment and controlled
  rollback with separate approval.
- Record the monitoring/on-call/rollback owners and final owner sign-off.
