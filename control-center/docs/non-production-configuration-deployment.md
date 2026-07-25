# Controlled non-production configuration deployment

OpsWorkbench can prepare and execute typed configuration changes only for `staging`, `development`, `testing`, `preview`, and `ci` environments. Production and protected environments are rejected independently by the API schema, API policy, and agent executor. There is no production override.

## Security model

- Owners and administrators may create plans. A different owner or administrator must approve each immutable revision after recent authentication.
- Organization, project, environment, server, target profile, and pending version IDs are checked together before planning and again before approval.
- The API queues only signed, expiring `configuration.apply` or `configuration.rollback` tasks. Task signatures bind the organization, server, agent, expiry, nonce, and payload digest. The agent rejects expired, altered, misassigned, or replayed tasks.
- Agents must advertise every deployment capability. Older agents remain read-only; incomplete new agents cannot receive a deployment.
- Agents must also report a stable semantic version at or above `0.1.0`; missing, malformed, prerelease, and older versions are rejected independently by the API and agent.
- Secret values are decrypted only during approval, encrypted specifically for the assigned agent, and never returned by the API or included in audit metadata. Progress uses a strict value-free schema.
- Target profiles pin the repository root, environment file, base Compose file,
  ordered Compose override files, project name, stateless services, protected
  services, and health checks. Every Compose file is passed to activation in
  the recorded order so release-specific image/build overrides cannot be
  silently dropped. Paths must remain beneath the root; duplicate, escaping,
  symlinked, separate-device, and Linux mount-point targets are rejected.
- Environment names and values are bounded. NUL, CR, LF, duplicate names, invalid syntax, unknown payload fields, and expected-version conflicts are rejected.
- The agent creates an exclusive timestamped backup, preserves mode and ownership, writes and flushes a same-directory temporary file, then atomically renames it. Only fixed `docker compose` arguments are used; arbitrary shell execution is unavailable.
- Only allowlisted stateless services are recreated. Protected/stateful service overlap is rejected. Failed activation or health verification restores the prior file and recreates the affected stateless services.
- Health-check URLs are restricted to credential-free public HTTP(S) targets without query strings or fragments. Private, loopback, link-local, metadata, reserved, malformed, and DNS-resolved non-public targets are rejected before approval and again by the agent; redirects are revalidated at each hop.
- After restoration the agent recreates the affected services and reruns every health check. Results distinguish healthy recovery, rollback activation failure, and failed post-rollback health validation without retaining raw error text.

## Protocol flow

1. An administrator creates a revisioned target profile for an explicit non-production environment.
2. A plan snapshots pending configuration version IDs, target revision, and expected file digest.
3. A different administrator approves after the API revalidates scope, capabilities, environment, profile revision, and pending versions.
4. The API encrypts an agent-bound value bundle and queues a signed, expiring typed task.
5. The agent performs preflight, backup, atomic write, allowlisted Compose activation, and bounded health checks.
6. The agent returns a strict value-free success or rollback report. Audit events contain IDs, counts, revisions, phases, and outcomes only.

## Database migration

Startup index initialization creates `configuration_target_profiles` and `configuration_deployment_plans`. Both use organization-scoped project/environment/revision indexes; plans also have a state/time index. No existing documents are rewritten.

## Recovery and compatibility

Backups are adjacent to the target file and identified by sanitized backup IDs. A health or Compose failure automatically restores the original bytes, ownership, and permissions. Operators must resolve a stale expected digest by creating a new plan; bypassing the conflict is not supported. Existing enrolled agents without the complete capability set remain discovery-only.

## Validation gates

The default suite uses disposable directories and simulated Compose/health adapters. MongoDB integration, Docker Compose activation, Linux mount-boundary, and browser checks are separately gated when their disposable dependencies are available. Tests must never point at production hosts, databases, Compose projects, or environment files.
