# Beta deployment preflight

The beta deployment preflight is a read-only approval gate. It renders the
Compose model with the operator-supplied project, Compose file, and environment
file; validates that the resolved backend is beta-safe; confirms candidate and
rollback images already exist; and emits value-free JSON with deployment and
rollback commands. It never calls `up`, `create`, `start`, `restart`, `build`,
`pull`, or a volume-changing operation.

## Forge evidence requires a provisioned host identity

Supplying Forge evidence paths makes the preflight read root-owned identity from the agent
configuration: `orgId`, `serverId` and `ownerPublicKey`, plus the trusted root at
`/etc/opsworkbench-agent/forge-trust-root.json`.

**These are provisioned, not enrolled.** Enrollment writes `serverId` only; nothing writes `orgId`. That
is deliberate rather than an omission: `orgId` is the measured identity a signed binding is checked
against, so learning it from the control plane would let the party issuing bindings also define the
identity they are checked against.

A host where they are absent **blocks**, and the preflight now names which field is missing on stderr
rather than reporting `trust-anchors-unavailable`, which describes a symptom two layers from the cause.

## What "value-free" means, exactly

It does **not** mean the report is empty of content, and reading it that way is
how the term got overstated. The report deliberately carries what an operator
needs in order to act: file paths, image references, resolved service names, the
deployment and rollback commands, the database hostname and database name, and
Forge nonces. Those are identifiers and operational metadata.

What it means is that the report carries **no secret configuration values and no
key material**. The distinction is load-bearing where the two meet: `MONGO_URL`
is parsed, and its hostname and database name ARE reported — so material derived
from a configuration value reaches the report, while the credential embedded in
that same value does not. `new URL()` exposes `username` and `password` as
separate properties and nothing here reads them.

That is asserted rather than asserted-about: a test puts a credential inside
`MONGO_URL` and checks it never appears in the serialized report on the passing
path, the blocked path, or the malformed-destination path — the last being where
a raw value is most likely to get interpolated into a message for debugging.

Run it from `control-center` with a value-free JSON input file:

```bash
npm run preflight:beta --workspace @control-center/agent -- /secure/path/beta-preflight.json
```

Required input fields are `targetEnvironment`, `composeWorkingDirectory`,
`composeProjectName`, `composeFilePath`, `environmentFilePath`,
`composeOverrideFilePath`, `rollbackComposeOverrideFilePath`, the four
candidate/rollback image references,
`authorizedServices`, `allowedComposeServices`, `allowedHostnames`, and the
reviewed `allowedDatabaseDestinations` hostname/database fingerprints. The
optional `serviceEnvironmentReferencePath` identifies a missing service-level
env-file reference that the CLI may satisfy with a temporary symlink. Do not put
environment values, database URIs, or credentials in this JSON file.

The CLI creates **two** image overrides with mode `0600`, each containing
exactly two fields, `services.backend.image` and `services.frontend.image`: one
pinning the candidate pair and one pinning the rollback pair. Both must be
inside the Compose working directory, both refuse to overwrite an existing path,
both must be distinct paths, and both are removed in the `finally` block. The
rollback override is a deployment input too, and a weaker rule on it would be
the weakest link. When a service env reference is requested, it likewise refuses
an existing path, points only to the authoritative environment file, verifies the
link target, and removes both temporary files in a `finally` block. Cleanup
failure prevents approval. Any later deployment must regenerate the reviewed
override before using the reported command.

The result is one of:

- `PASS — awaiting operator approval`
- `BLOCKED`
- `ERROR`

Even a passing invocation cannot deploy. An operator must separately review the
resolved target, service plan, safety-flag matrix, image IDs, MongoDB exclusion,
file hashes, and generated commands before any later execution task is created.

## Rollback

Rollback selects the reviewed **rollback override** rather than retagging
images. The earlier form ran `docker image tag <rollback> <candidate>` before
recreating, which mutated a tag so an approved name resolved to different bytes
— the exact mutable-reference hazard this gate exists to prevent — and left the
host with a tag that no longer meant what it said.

Rolling back is itself a deployment. The emitted rollback command is evidence
for review, not an approval, and the reviewed way to obtain one is a second
preflight run with the candidate and rollback roles swapped.

## Forge evidence (optional)

When the optional `forgeCandidateBuildPath`, `forgeRollbackBuildPath`,
`forgeTargetBindingPath`, `forgeOwnerAuthorizationPath`,
`forgeOwnerPublicKeyPath`, and `forgeAttestationPath` inputs are supplied, the
preflight additionally verifies that the candidate and rollback images were
built from reviewed source, that a binding authorizes this exact build onto this
exact target, and that the owner authorized that binding. See
[the Forge manifest specification](forge-manifest-spec.md).

Three properties matter:

- **Inert by default.** With none of these paths supplied the preflight behaves
  exactly as it did before they existed, and no `forge_*` check runs.
- **Partial evidence never passes.** Supplying some documents and omitting
  others is blocked, not ignored — omitting the owner authorization is exactly
  the shape of an attempt to deploy on provenance alone.
- **The preflight hashes the evidence files itself** and compares the result
  against the attestation subject, rather than trusting a digest supplied in the
  input. Attestation verification happens out of band (`gh attestation verify`)
  and its result is recorded into the evidence file; the preflight performs no
  network I/O and must never fetch its own evidence.

A complete, verified evidence set still yields `PASS — awaiting operator
approval`. It adds a gate; it removes none.

Compose rendering uses both the base file and the temporary image override.
The guardrail intentionally blocks a Compose model whose resolved backend image
does not match the authorized candidate. A build-only Compose definition must
therefore be paired with the generated, separately hashed override before this
gate can pass. This prevents mutable default tags from silently selecting the
wrong artifact.

MongoDB destinations are not approved by hostname alone. The effective URI
variable and database name (from the URI path or `DB_NAME`) must exactly match a
reviewed beta hostname/database fingerprint. Comma-delimited HTTP URL values are
split into individual URLs before hostname validation; malformed individual
tokens remain blocked.
