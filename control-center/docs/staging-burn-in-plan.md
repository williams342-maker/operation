# Private staging burn-in plan

Burn-in begins only after the deployment intake and security gates are approved. Default duration is at least 24 continuous hours. Use non-production identities, data, paths, services, and databases exclusively.

## Entry gates

- [ ] Deployment artifact checksum and provenance match the approved tag and commit.
- [ ] Private access control, TLS, firewall, and origin-bypass protections pass.
- [ ] `/healthz` and `/readyz` pass and report the expected build identity.
- [ ] Backup identifier and tested restore procedure are recorded.
- [ ] Monitoring, log access, on-call owner, and rollback owner are active.
- [ ] Credential remediation and history-remediation decision gates are approved.

## Operational validation

- [ ] Authenticated access: anonymous denial, valid login, recent-auth challenge/retry, active logout, and expired-session logout.
- [ ] Health/readiness: API, MongoDB, audit, rate limiting, cache, build identity, and intentionally disabled subsystems report expected states.
- [ ] Browser smoke: run `npm run smoke:staging -- https://<approved-host>` at 1280×900 and 390×844 with no console errors or horizontal overflow.
- [ ] Roles: Owner/Administrator permitted actions and Viewer denials return correct 401 versus 403 behavior.
- [ ] Organization isolation: use two synthetic organizations and verify cross-organization IDs, queries, tasks, configuration, audit, and telemetry cannot cross scope.
- [ ] Audit: successful/failed login, authorization denial, recent authentication, enrollment, configuration, and task events are complete, scoped, and value-free.
- [ ] Redaction: inspect API, agent, proxy, Docker, audit, error, task-summary, and browser-visible output for secret-like material without copying suspected values.
- [ ] Restart/recovery: restart API, web, edge, MongoDB, and disposable agent individually; verify reconnection, idempotency, and no stuck tasks.
- [ ] Backup/restore: restore a backup into a separate non-production database/volume, verify inventory and integrity, then destroy the disposable restore target.
- [ ] Configuration deployment: exercise non-production planning, separate approval, digest validation, backup-before-write, atomic replacement, health validation, and controlled rollback.

## Monitoring and thresholds

Capture at least every five minutes: availability, HTTP 5xx/4xx/429 rates, p50/p95 latency, CPU, memory, disk usage/growth, container restarts, Mongo connections/storage, agent heartbeat gaps, queued/running task age, deployment outcomes, and sanitized error counts.

Proposed acceptance thresholds (owner must approve or replace before burn-in):

- Availability at least 99.5% excluding the recorded restart exercise.
- Zero unplanned outages longer than 60 seconds.
- HTTP 5xx below 0.5% over any rolling 15-minute window and no repeated unexplained exception.
- No unexpected 401/403 behavior; no sustained unexplained 429s.
- No OOM event, disk exhaustion, crash loop, or more than one unplanned restart per component.
- Agent heartbeat gap below two expected polling intervals outside the restart exercise.
- Zero stuck tasks older than their expiry and zero duplicate mutation effects.
- Zero secret exposure, organization-isolation failure, production/protected-environment mutation, backup failure, or rollback/health-revalidation failure.

## Immediate rollback triggers

Rollback and stop burn-in for secret exposure; unauthorized access; organization-boundary failure; production/protected-target contact; data corruption; failed or unverified backup; unsuccessful rollback; health-revalidation failure; persistent readiness failure; crash loop; resource exhaustion; or thresholds breached for two consecutive observation intervals. Security-boundary failures require incident handling, not merely application rollback.

After rollback, verify liveness, readiness, authentication, restored data, audit continuity, agent state, and value-safe logs. Preserve identifiers and timestamps, not sensitive payloads.

## Structured defect log

| ID | UTC detected | Severity | Area/workflow | Value-safe symptom | Expected | Reproduction reference | Impact | Owner | Status | Rollback triggered | Resolution/verification |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| — | — | — | — | — | — | — | — | — | — | — | — |

Severity: Critical for security/isolation/data-loss failures; High for rollback/readiness/authentication failures; Medium for bounded operational degradation; Low for cosmetic or documentation defects.

## Exit gate

Burn-in succeeds only when the approved duration completes, every mandatory workflow passes, thresholds hold, no Critical/High defect remains open, rollback evidence is complete, backups restore successfully, logs remain value-free, and deployment/security/rollback owners sign off. Success authorizes review of the evidence package only; it does not authorize production deployment.
