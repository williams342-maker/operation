# Environment & Integration Management: foundations and read-only discovery

## Scope and milestone boundary

This design implements Milestone 1 foundations and the read-only portion of Milestone 2. OpsWorkbench can inventory environment-variable names, classify configuration, define environments, and store immutable encrypted versions. It cannot deliver values to agents, write environment files, activate services, deploy, validate a live provider, or roll back a host. The server capability response therefore always reports `writableConfiguration: false`.

## Architecture proposal

The control plane owns organization-scoped metadata and ciphertext. The agent owns bounded, same-device discovery of variable names and source locations. Poll requests use the existing authenticated, signed, replay-protected channel. The API maps discovery to a project only when the application path is contained by that project's configured repository root. The web UI displays a provider-neutral matrix and never receives secret values or ciphertext.

Configuration hierarchy is `organization -> project -> application path -> environment -> server (optional) -> service (optional) -> definition -> immutable version`. Definitions describe a variable. Versions are environment-specific values. Later resolution should use the most-specific matching scope and reject equal-specificity conflicts; it must never silently select one.

Provider recognition is metadata only. MongoDB, PostgreSQL, Redis, S3/R2, payment, AI, email, messaging, analytics, identity, and arbitrary custom variables all use the same definition/version model.

## Threat model and controls

| Threat | Foundation control | Remaining work |
|---|---|---|
| Database disclosure | Per-version random DEK, AES-256-GCM, master-key wrapping, AAD scope binding; API projections exclude ciphertext | External KMS/HSM adapter and key-rotation ceremony |
| Cross-organization access | Every query includes authenticated `orgId`; project/environment ownership is rechecked | Add database-backed route integration tests |
| Secret exposure in UI/log/audit | UI gets fixed masks only; values are omitted from audit metadata; secret input is password/autocomplete-off and cleared | Browser network/log regression tests |
| Replay or agent impersonation | Existing signed poll, nonce, timestamp, and credential controls are preserved | Encrypted delivery protocol is a later milestone |
| Malicious variable/file input | Strict uppercase name schema, bounded files/counts/payload, no symlink reads, no value collection | Extend recursive source-language parsers only with explicit limits |
| Wrong project attribution | Repository-root containment and longest-root match | Explicit operator confirmation for ambiguous repositories |
| Unauthorized secret change | Separate RBAC permissions plus recent-auth requirement | Approval workflow and protected-environment policy |
| Host mutation | No writable agent task exists; writable capability is false | Requires separate reviewed milestone |
| Drift/fingerprint correlation | Keyed, server-bound fingerprints are available; raw hashes are prohibited | Agent-side computation and comparison are not enabled yet |

Development may use the existing local encryption-key fallback, but production environment validation requires a 32-byte base64 `CONTROL_CENTER_ENCRYPTION_KEY`. No plaintext fallback exists in production.

## Data model

- `configuration_environments`: organization, project, name, kind, protected flag, timestamps.
- `configuration_definitions`: organization/project/application identity; name, type, secret flag, required flag, provider label, usage, services, discovery sources/paths, authoritative path, status, active version.
- `configuration_versions`: organization/project/definition/environment and optional server/service scope; monotonically increasing version; classification; envelope ciphertext or public value; fixed mask; lifecycle and validation state; reason and actor.
- `servers.agentCapabilities`: enrolled capability names used for compatibility decisions.

Unique indexes prevent duplicate environments, definitions, and version numbers within their organization-scoped identities. Versions are append-only through the API.

## API proposal and implemented surface

- `GET /api/configuration/environments`: organization-scoped environment inventory.
- `POST /api/configuration/environments`: create a project-owned environment.
- `GET /api/configuration/definitions?projectId=...`: safe definitions and version metadata; excludes values, ciphertext, and fingerprints.
- `POST /api/configuration/definitions`: create a typed provider-neutral definition.
- `POST /api/configuration/definitions/:id/versions`: recent-auth, permission-gated immutable version creation.
- `GET /api/configuration/capabilities/:serverId`: negotiated enrolled capabilities and the hard-disabled write state.

All mutations use CSRF protection inherited from the API router. Secret changes require `secrets:create` or `secrets:replace`; public edits use `configuration:edit-public`; management uses `configuration:manage-integrations`.

Future endpoints must separately cover effective-value resolution, approvals, validation, deployment, rollback, drift, and integrations. They are intentionally absent now.

## UI proposal and implemented surface

The Configuration page is presented as an application Environment workspace rather than an infrastructure editor. It provides application/environment selectors, plain-language health cards, quick actions, a horizontally safe variable table, a detail panel, guided add/update/rotate forms, a six-step onboarding walkthrough, and a browser-local `.env` preview. Infrastructure paths and activation details remain discoverable metadata rather than routine user inputs.

The normal target workflow is: select application and environment, review missing/pending/drifted settings, choose a guided action, review the affected services and plain-language plan, approve once, and let a future deployment orchestrator perform backup, scoped updates, activation, validation, and automatic rollback. The current foundation stops before approval and host mutation. Promote, deploy, live validation, rollback, history, and drift actions are visibly unavailable instead of pretending to work.

The import preview accepts paste or a local file of at most 256 KiB, parses only strict uppercase `VARIABLE=value` records in browser memory, displays names/classification/duplicates, and provides an explicit clear action. It does not upload or persist plaintext. A later milestone can convert individually selected rows into encrypted pending versions after recent authentication and production approval.

Provider-specific instructions and managed rotation remain adapter-driven future work. The product must never claim managed rotation until an adapter has been separately reviewed and tested.

### Guided onboarding state target

Onboarding records should eventually persist the operator-approved application-to-project mapping, environment, server, repository root, authoritative environment-file path, Compose project, service names, systemd units, secret-store adapter, activation method, and validation plan. Discovery proposes these values; an administrator confirms them. Routine changes then use the approved profile without asking users for paths or shell commands. This profile is intentionally not used for host writes during Milestones 1–2.

Variable classifications presented to users are Ready, Missing, Needs Review, Invalid, Test Value, Production Value, Duplicate, Unused, Drifted, and Pending Deployment. Storage may retain the smaller lifecycle enum while derived findings supply the richer presentation status; equal-confidence conflicts must be shown as Needs Review rather than silently resolved.

## Agent protocol and capability negotiation

Enrollment recognizes discovery, fingerprinting, encrypted delivery, environment-file write, Compose activation, systemd activation, validation, and rollback capability names. The current agent advertises only `environmentDiscovery` and `configurationFingerprinting`. Discovery poll data contains names and bounded metadata only. Older agents remain valid because capabilities default to an empty array and settings default to an empty array.

Read-only discovery inspects `.env.example`/template/sample files, Compose interpolation, Dockerfiles, GitHub workflow files, top-level application source, and the names present in `.env`/`.env.local`. It does not return the associated values. Files over 256 KiB, symlinks, and excess items are skipped or truncated through existing discovery safety controls.

## Migration and compatibility plan

1. Create the three collections and indexes during normal API startup.
2. Existing servers require no migration; missing capabilities mean legacy/read-only.
3. Existing poll payloads parse because `settings` has a default.
4. Collect value-free discovery and review mapping before enabling any write capability.
5. Introduce external key wrapping, approvals, signed encrypted delivery, adapters, validation, rollback, and drift in separately reviewed milestones.
6. Keep all provider credentials outside Git and install them only through an approved secret store.

Rollback for this foundation is application-code rollback. The new collections are additive and need not be deleted. Existing telemetry remains readable.

## Milestone plan

1. **Foundations (implemented locally):** schemas, RBAC, indexes, envelope encryption, safe API, immutable versions, UI inventory.
2. **Read-only discovery (implemented locally):** bounded agent collection, signed transport, safe ingestion, capability negotiation.
3. **Resolution and approvals:** conflict detection, inheritance preview, protected-environment approvals.
4. **Encrypted delivery and adapters:** per-agent encrypted payloads, allowlisted atomic writes, Compose/systemd adapters.
5. **Validation, rollback, and drift:** health gates, automatic rollback, keyed fingerprints, alerts.
6. **Provider integration workflows:** generic templates and explicit operator-triggered validation only.

## Test strategy

Unit tests cover schemas, secret/type/provider classification, RBAC separation, envelope uniqueness, AAD/tamper rejection, server-bound keyed fingerprints, no-value discovery, and payload caps. Existing suites cover authentication, CSRF, organization isolation, signed-agent replay protection, traversal/mount constraints, API behavior, and responsive web components. Before a later writable milestone: add Mongo-backed route isolation tests, delivery cryptography vectors, allowlist/path traversal tests for each adapter, failure-injection rollback tests, browser network/log assertions, and agent-version compatibility matrices.

## Files introduced or changed

- `packages/shared/src/configuration.ts`, `protocol.ts`, `rbac.ts`, `audit.ts`, and `index.ts`
- `apps/api/src/configurationVault.ts`, `configurationDiscovery.ts`, `configurationRoutes.ts`, `models.ts`, `db.ts`, and `routes.ts`
- `apps/agent/src/configurationDiscovery.ts`, `discoverySafety.ts`, `inspectors.ts`, and `client.ts`
- `apps/web/src/ConfigurationPage.tsx`, `configurationUx.ts`, and `main.tsx`
- configuration-focused tests in shared, API, and agent workspaces
- this design and threat-model document

No `.env`, provider credential, generated scan report, deployment, Git reference, or production setting is part of this work.
