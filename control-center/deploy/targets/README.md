# Non-production configuration target profiles

These JSON files are value-free request bodies for the controlled
configuration deployment API. They identify exact non-production hosts and
runtime paths; they do not contain environment values, credentials, or owner
signatures.

`opsworkbench-staging.profile.json` records the prepared private staging
target:

- repository boundary:
  `/etc/opsworkbench-agent/targets/opsworkbench-staging`;
- environment file:
  `/etc/opsworkbench-agent/targets/opsworkbench-staging/env/.env.staging`;
- ordered Compose inputs: the shared base file first, then the active
  `8836151b` release override, both copied byte-for-byte into that boundary;
- Compose project: `opsworkbench`;
- recreatable services: `api` and `web`;
- protected stateful service: `mongo`; and
- public health validation at `/healthz`.

The profile is intentionally not a production-publication artifact. It does
not enable production, alter the owner-signature boundary, rotate secrets, or
apply a configuration change.

## Host preflight

The target lives beneath the agent unit's existing
`ReadWritePaths=/etc/opsworkbench-agent` sandbox. Its directory is mode `0750`;
the Compose inputs are mode `0640`; and the environment file is mode `0600`.
All are owned by `opsworkbench-agent:opsworkbench-agent`. The environment file
was copied server-side without printing its contents, and its SHA-256 digest
matches the active staging input.

The restricted agent successfully parsed the ordered Compose inputs with
`docker compose config --quiet`. That preflight did not register the profile,
write configuration, build or recreate services, or change the active runtime.
Registration and any immutable deployment plan remain separate authenticated
control-plane actions.

Run `npm test` or the focused Node test below to validate every committed
profile:

    node --test deploy/scripts/configuration-target-profile.test.mjs
