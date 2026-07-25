# Release policy and publication authority

OpsWorkbench uses policy and cryptographic verification instead of a recurring
manual approval process. Development and staging remain autonomous. Production
publication remains impossible until an owner-controlled Ed25519 signature
binds the exact release, evidence, and policy digests.

## Authority

| Stage | Authority | Autonomous |
| --- | --- | --- |
| Build | AI | Yes |
| Test | AI | Yes |
| Security validation | AI | Yes |
| Staging deployment | AI | Yes |
| Burn-in monitoring | AI | Yes |
| Staging rollback | AI | Yes |
| Release candidate creation | AI | Yes |
| Production publication | Owner Ed25519 signature | No |

The role names are durable even when one person currently performs every role:

- **Owner:** holds the offline Ed25519 private key, approves production
  releases, and may delegate operations without delegating signing authority.
- **Operations Administrator:** reviews monitoring, responds to incidents,
  approves staging deployments, and initiates approved staging rollbacks.
- **Publisher:** publishes only after the policy engine verifies an owner
  signature. It has no signature override.

## Version-controlled policy candidate

`release/policies/Staging-BurnIn-v1.policy.json` is the version-controlled
policy candidate. It defines the authority matrix, roles, configurable
monitoring thresholds, staging capabilities, denied operations, minimum
observation duration, and reset conditions.

The committed candidate deliberately contains
`OWNER_ED25519_KEY_ID_REQUIRED`. It is not an active signed policy and cannot
enable production publication. The owner must replace that value with the
fingerprint-derived identifier of the public key and sign the resulting policy
digest offline. The private key must never be placed in the repository,
staging host, browser, API, CI, chat, or an AI-accessible environment.

Validate the schema and obtain the deterministic policy digest:

    npm run release-policy:validate

The output remains `productionPublishEnabled: false`. A Publisher accepts only
a signed-policy envelope whose detached Ed25519 signature verifies over the
raw 32-byte policy digest.

## Publication inputs

The policy engine requires four inputs:

1. a signed-policy envelope containing the policy, its digest, owner key ID,
   and detached owner signature;
2. release-candidate evidence binding the release digest, policy digest,
   continuous telemetry window, validation results, and rollback checkpoint;
3. a publication authorization binding the release, policy, and evidence
   digests with a second owner signature; and
4. the trusted owner Ed25519 public key.

The authorization signature covers the deterministic digest of every
authorization field except the signature itself. This prevents a valid
signature from being replayed for a different release, policy, or evidence
package.

The Publisher verifies an assembled package with:

    npm run release-policy:verify-publication -- <signed-policy.json> <evidence.json> <authorization.json> <owner-public-key.pem>

The command exits nonzero unless every policy, signature, telemetry,
validation, and rollback check passes. No override flag exists.

## Burn-in behavior

The first policy version requires:

- availability at least 99.9%;
- HTTP error rate below 1%;
- p95 latency below 500 ms;
- maximum agent heartbeat gap of 60 seconds;
- disk warning at 80% and critical failure at 90%;
- zero unexpected restarts and zero critical alerts; and
- at least 24 continuous hours.

An unexpected restart, critical alert, latency or availability breach, or
unhealthy heartbeat resets the observation start. A warning-level disk result
is reported but does not enable publication; a critical disk result fails the
gate. Thresholds are data, not application constants, so a later
owner-signed policy version can change them without weakening signature
enforcement.

## Staging profile

`Staging-BurnIn-v1` allows deploy, restart, rollback, telemetry collection,
browser validation, and security validation. It denies production
publication, database migration, DNS changes, payment activation, secret
rotation, and signing. The schema rejects a profile that both permits and
denies an action, or that permits publication or signing.

This authority profile is separate from a host-specific configuration target
profile. A configuration deployment still needs its exact repository root,
environment file, ordered base/override Compose paths, Compose project,
service allowlist, and health checks before the control plane can create an
immutable deployment plan.
