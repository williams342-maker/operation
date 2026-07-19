# Agent lifecycle and upgrade management

This design is non-production only. Production and protected servers are denied during planning and revalidated during approval. The browser creates or approves typed plans; it never sends shell commands.

## Compatibility inventory

Enrollment and heartbeat record version, task protocol, capabilities, OS, architecture, package type, release channel, installed artifact digest, and heartbeat time. The inventory API joins project/environment classification and evaluates every current or future server against published, non-revoked releases. Missing inventory or upgrade capability produces a manual-bootstrap state; platform and upgrade-path mismatches fail closed.

The old discovery warning was not a version comparison: the UI inferred `Agent upgrade required` whenever discovery data was absent. An online `0.1.0` agent can report metrics and execute signed typed tasks, but it does not advertise `environmentDiscovery`, `agentUpgrade`, or `upgradeManifestHandoff`. Retry repeats discovery and cannot add capabilities.

## Trust and task flow

1. An Owner or Administrator creates a draft catalog record whose canonical manifest digest matches its immutable fields.
2. Owner review supplies a pre-existing trusted key identifier, artifact signature, and signed manifest. This repository does not create or store a signing private key.
3. A recently authenticated user creates an expiring server-specific plan. The plan binds server/agent identity, current version and installed digest, release, platform, package type, capability requirements, nonce, and exact digest.
4. A different recently authenticated Owner or Administrator approves the exact digest. Server classification, current state, release publication, revocation, and compatibility are revalidated.
5. The existing signed task protocol carries an `agent.upgrade` manifest without a URL, command, executable path, service name, install path, or credential.
6. The agent writes the validated manifest with exclusive creation to the fixed updater inbox. The independent root-owned updater selects the URL only from its root-owned release catalog.
7. The updater verifies the signed release manifest, artifact size, SHA-256 and Ed25519 signature, platform, package type and structure; backs up the known-good release and configuration; switches a versioned link; restarts the fixed service; and validates heartbeat, target version, capabilities, and discovery.
8. Failure after switching restores configuration and the prior release, restarts it, and reports redacted rollback state.

Fleet rollouts bind the exact server set, every per-server plan digest, release, strategy, batch parameters, failure threshold, environment allowlist, and expiration. Approval queues only the first canary/batch. Advancement stops on the threshold; pause, resume, and cancellation are explicit. Cancellation affects queued work only and never interrupts an updater that has started.

## Filesystem and services

- `/opt/opsworkbench-agent/releases/<version>/`: immutable versioned releases.
- `/opt/opsworkbench-agent/current`: active release link.
- `/etc/opsworkbench-agent/agent.json`: preserved agent identity and credential configuration.
- `/etc/opsworkbench-agent/release-catalog.json`: root-owned approved catalog projection.
- `/etc/opsworkbench-agent/updater-trust.json`: root-owned public verification keys only.
- `/var/lib/opsworkbench-agent/updater-inbox/`: typed manifests.
- `/var/lib/opsworkbench-agent/consumed-upgrades/`: persistent nonce/upgrade replay markers.
- `/var/backups/opsworkbench-agent/`: known-good release and configuration backups.

The systemd templates use a fixed service name and fixed executable paths. Credentials remain in restrictive environment files; no secret is added to a unit, manifest, task result, audit event, or browser response.

## Bootstrap gate

The currently enrolled legacy agents require one manual bootstrap because they do not implement `agentUpgrade` or the updater handoff. Release `0.10.0-beta.1` is the first proposed bootstrap, remains `nonProductionOnly`, and is a draft until every gate in [agent-release-signing.md](agent-release-signing.md) passes. The bootstrap requires an independently provisioned trusted public key and an existing enrolled `agent.json`; it cannot enroll a new identity.

The installer is downloaded to a protected file, inspected, and run from a root shell. It verifies the signed bootstrap manifest before trusting artifact metadata, then verifies exact sizes, SHA-256 digests, and Ed25519 signatures. It preserves identity/configuration, installs fixed systemd units and root-owned trust/catalog files, validates heartbeat/version/capabilities/discovery, and rolls back on failure. Optional Cloudflare Access service-token values are read from mode-restricted files into a temporary curl configuration and are removed on exit. They are never command arguments, unit fields, release artifacts, or logs. Do not pipe the installer into Bash.
