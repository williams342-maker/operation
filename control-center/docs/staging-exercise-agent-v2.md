# agent-v2 staging exercise (disposable CI)

**This is a disposable CI staging exercise — NOT a persistent-host staging deployment.** No persistent
OpsWorkbench staging control plane was available to operate (no reachable staging URL; the
`deploy/.env.staging.example` model targets a Docker-Compose staging host an operator controls). The
exercise therefore runs on the CI **disposable-MongoDB** integration environment, which stands up the
real control-plane app plus a fake agent against a fresh throwaway database, using **disposable Ed25519
keys generated in-test**. It changes no runtime code, no production configuration, and does not enable
the feature flag.

## Key-distribution invariant (proven)
Agents receive **only public keys** — the control-plane transport public key and the owner public key.
The control-plane task-signing **private** key stays control-plane-side; the owner **private** key stays
in the offline signing step. Neither private key is ever sent to an agent or written to the database.
Enforced/asserted by:
- `apps/agent/test/ownerAuthorizationEnforcement.test.ts` — the agent config schema exposes only
  `controlPlanePublicKey` + `ownerPublicKey` (public) and the agent's own credential keys; there is no
  field for the control-plane task-signing private key or the owner private key.
- `apps/api/test/dbApiIntegration.test.ts` (v2 matrix) — enrollment responses, server documents, and
  audit logs for v2 agents contain no private key or secret.

## What the exercise covers (all green on CI Mongo)
- **Enrollment + signed bootstrap:** v2 enrollment returns no secret; the agent is configured with public
  keys only.
- **Owner-authorized privileged tasks (two independent layers):** the control plane (`createTask`) and
  the agent (`verifyTask`) both require a valid owner authorization for privileged task types; the
  transport/control-plane key alone is insufficient. Missing and forged owner authorizations are
  rejected; a validly owner-signed action is accepted.
- **Migration states + rollback:** fresh v2, dual-accept, complete→v1-reject, revocation.
- **Fail-safe flag-off preflight:** a fresh-v2 agent (no usable v1 credential) makes a v1-only state
  unsafe; a migrated agent that retains v1 fallback is safe.
- **Backup/restore + upgrade/downgrade compatibility:** re-run green.

## Still required before production (unchanged)
A **persistent staging host** must complete the real key ceremony and agent-migration exercise, and
production stays frozen until: `16e14682` (or its immutable artifact) is recovered + audited; its diff
vs current `main` is understood; a verified rollback release + DB backup exist; the persistent-staging
key ceremony + agent migration complete; and the production key ceremony receives owner authorization.
See `agent-key-redesign.md` (§8 two trust layers, §9 rollback semantics) and the provenance-recovery
runbook.
