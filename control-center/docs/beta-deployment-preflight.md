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
`composeProjectName`, `composeFilePath`, `environmentFilePath`, the four
candidate/rollback image references, `authorizedServices`,
`allowedComposeServices`, and `allowedHostnames`. Do not put environment values
or credentials in this JSON file.

The result is one of:

- `PASS — awaiting operator approval`
- `BLOCKED`
- `ERROR`

Even a passing invocation cannot deploy. An operator must separately review the
resolved target, service plan, safety-flag matrix, image IDs, MongoDB exclusion,
file hashes, and generated commands before any later execution task is created.

The guardrail intentionally blocks a Compose file whose resolved backend image
does not match the authorized candidate. A build-only Compose definition must
therefore be paired with a separately reviewed image override before this gate
can pass. This prevents mutable default tags from silently selecting the wrong
artifact.
