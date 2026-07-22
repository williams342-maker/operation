# Beta deployment preflight

The beta deployment preflight is a read-only approval gate. It renders the
Compose model with the operator-supplied project, Compose file, and environment
file; validates that the resolved backend is beta-safe; confirms candidate and
rollback images already exist; and emits value-free JSON with deployment and
rollback commands. It never calls `up`, `create`, `start`, `restart`, `build`,
`pull`, or a volume-changing operation.

Run it from `control-center` with a value-free JSON input file:

```bash
npm run preflight:beta --workspace @control-center/agent -- /secure/path/beta-preflight.json
```

Required input fields are `targetEnvironment`, `composeWorkingDirectory`,
`composeProjectName`, `composeFilePath`, `environmentFilePath`,
`composeOverrideFilePath`, the four candidate/rollback image references,
`authorizedServices`, `allowedComposeServices`, `allowedHostnames`, and the
reviewed `allowedDatabaseDestinations` hostname/database fingerprints. The
optional `serviceEnvironmentReferencePath` identifies a missing service-level
env-file reference that the CLI may satisfy with a temporary symlink. Do not put
environment values, database URIs, or credentials in this JSON file.

The CLI creates the image override with mode `0600` and exactly two fields:
`services.backend.image` and `services.frontend.image`. It refuses to overwrite
an existing path. When a service env reference is requested, it likewise refuses
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
