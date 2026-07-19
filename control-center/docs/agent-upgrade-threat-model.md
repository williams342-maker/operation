# Agent upgrade threat model

## Protected assets

Agent credentials, enrollment and machine-access credentials, release signing keys, server identity, the updater trust policy, the current known-good release, configuration, and production availability are protected assets.

## Trust boundaries and controls

- Browser to API: authenticated session, CSRF protection, `agent:update`, recent authentication, explicit confirmation, separate planner/approver, organization scoping, and no-store responses.
- API to agent: existing authenticated signed task envelopes, expiry, nonce, payload digest, exact server and agent binding, and typed payload schemas.
- Agent to updater: fixed inbox, strict manifest schema and digest validation, exclusive file creation, no commands or paths, and persistent replay markers.
- Updater to artifact storage: HTTPS is transport only. Root-owned catalog selection, signed canonical release manifest, trusted public-key identifier, exact size, SHA-256, and Ed25519 artifact signature provide trust.
- Updater to host: root-owned independent service, fixed systemd service and paths, exclusive lock, bounded archive structure, versioned install, preserved backup, atomic Linux link switch, health validation, and rollback.

## Denied attacks

- Arbitrary shell, executable, arguments, service name, install path, and task-supplied URL are not representable.
- Draft, revoked, expired, wrong-platform, wrong-channel, unsupported-source, cross-server, changed-state, modified-digest, duplicate, and replayed plans fail closed.
- Production, protected, and unclassified servers are denied both when planned and when approved; fleet requests cannot include them implicitly.
- Archive traversal, links, special files, oversized entry sets, partial artifacts, signature/digest mismatch, and insufficient rollback space are rejected.
- Error/result schemas contain only phase, opaque upgrade ID, target version, and bounded category. Raw diagnostics and credentials are not returned.

## Residual risks and owner gates

- The API stores signature metadata but does not possess signing private keys. Owner release publication must independently verify provenance and provision only public trust material.
- Current legacy agents cannot use the handoff. The proposed `0.10.0-beta.1` one-time bootstrap remains non-production and draft pending the signing and Linux staging gates.
- A bootstrap trusts only an out-of-band public key, verifies the signed manifest before artifact metadata, rejects unsafe archives and special files, preserves the enrolled identity, and uses file-based machine credentials when Cloudflare Access is required.
- Linux systemd, archive, reboot/reconnect, and rollback validation must run in a disposable staging host before any release publication.
- Production policy, signing ceremony, artifact hosting, retention, monitoring, and Cloudflare machine-access policy require separate owner approval.
