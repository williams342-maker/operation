# Non-production configuration target profiles

These JSON files are value-free request bodies for the controlled
configuration deployment API. They identify exact non-production hosts and
runtime paths; they do not contain environment values, credentials, or owner
signatures.

`opsworkbench-staging.profile.json` records the active private staging layout:

- repository boundary: `/opt/opsworkbench`;
- environment file: `/opt/opsworkbench/shared/compose/env/.env.staging`;
- ordered Compose inputs: the shared base file first, then the active
  `f4f584ac` release override;
- Compose project: `opsworkbench`;
- recreatable services: `api` and `web`;
- protected stateful service: `mongo`; and
- public health validation at `/healthz`.

The profile is intentionally not a production-publication artifact. It does
not enable production, alter the owner-signature boundary, rotate secrets, or
apply a configuration change.

## Host preflight

Do not register or use a profile until the restricted agent can traverse the
repository boundary, read the Compose inputs, and atomically back up and write
the environment file under its systemd sandbox. At the time this candidate was
recorded, the live staging files remained root-owned under directories with
mode `0700`, while the agent unit exposed only `/etc/opsworkbench-agent` as a
writable path. The candidate therefore remains fail-closed and unapplied until
a separately reviewed, least-privilege host layout is prepared. Do not copy,
print, or weaken permissions on the live secret file merely to satisfy this
preflight.

Run `npm test` or the focused Node test below to validate every committed
profile:

    node --test deploy/scripts/configuration-target-profile.test.mjs
