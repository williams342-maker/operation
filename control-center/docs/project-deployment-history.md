# Project deployment and rollback history

`project_deployments` and `project_rollbacks` are the authoritative application-project history collections. They are intentionally separate from configuration deployment plans, agent upgrades, task records, and audit events. Existing audit or task data is never inferred or backfilled as deployment history.

This slice is read-only. A future execution slice should create one deployment record after task creation and approval have bound the organization, project, server, actor, revision, artifact digest, and immutable release identifier. The same workflow should advance it through preparation, activation, and validation, appending ordered audit references as those events are committed. Terminal outcome evidence must be written with task completion and treated as immutable. A future rollback workflow should create one rollback record after approval, link it to its source deployment, and finalize verification evidence with the rollback task result.

Before either future writer inserts a record it must call the relationship validator, use the task ID as the replay key, and perform record, task-result, and audit writes in the same transaction. The unique organization/task indexes reject duplicate replay. State transitions use the shared deterministic transition functions; same-state retries are idempotent and invalid transitions fail closed.

The schema change is additive: two collections and their indexes. No migration or historical backfill is required. Reversal consists of dropping those collections (or their indexes) while no separately authorized writer uses them. Existing project, task, audit, configuration, agent-upgrade, and staging records are unaffected.

Public responses expose only an allowlisted release identifier, never an immutable filesystem path or artifact URL. Actor identifiers follow the existing `audit:view` policy. History access follows `status:view`, project lookup is organization-scoped, limits are bounded, and archived projects remain readable with an explicit archived marker.
