# Project deployment and rollback history

`project_deployments` and `project_rollbacks` are the authoritative application-project history collections. They remain separate from configuration plans, agent upgrades, task records, and audit events. Existing audit or task data is never inferred or backfilled as deployment history.

## Controlled non-production execution

The executor accepts only `staging`, `preview`, and `testing` plans. A plan must have a current separate-administrator approval, a passed control-plane preflight, and a recent passed exact-revision Git preflight. Execution additionally requires an enabled reviewed target profile bound to the same organization, project, server, repository root, environment, ordered Compose files, stateless service allowlist, and health checks.

The signed agent task contains no shell command or secret. It binds the immutable plan digest, exact 40-character target revision, preflight HEAD revision, branch, target-profile ID and revision, Compose project, ordered base/override files, stateless services, protected services, and health checks. The agent independently rejects production, replay, missing capabilities, path or mount escapes, symlinks, protected-service overlap, a dirty or changed repository, a different branch, and a target revision that does not resolve exactly.

Immediately before activation the agent rechecks the repository and records its current commit as the rollback checkpoint. It advances the registered branch to the exact approved commit with fixed Git arguments, then rebuilds and recreates only the target profile's stateless services with fixed Docker Compose arguments. All registered health checks must pass.

Activation or health failure automatically restores the checkpoint commit, rebuilds the previous stateless services, and reruns every health check. A verified restoration produces a terminal `rolled_back` deployment plus a linked successful rollback record. A failed restoration produces terminal failure evidence and a linked failed rollback record. Production publication, database migration, DNS changes, payment activation, secret rotation, and signing are outside this protocol.

## Evidence and replay safety

The plan's pre-generated task ID is the execution replay key. Unique organization/task indexes reject duplicate tasks, deployment evidence, task results, and rollback evidence. Terminal agent results use a strict bounded schema and contain revision/digest identifiers, service names, check counts, and bounded failure classifications only. Raw process output and paths are not persisted in public history.

Completion writes update the task result, deployment outcome, validation evidence, rollback availability, and any automatic rollback record idempotently. Completion and rollback audit events use deterministic dedupe keys and their IDs are appended to the matching history records. Actor identifiers remain restricted by `audit:view`; history access requires `status:view`; project lookup is organization-scoped; and archived projects remain readable with an explicit archived marker.
