# Controlled environment management threat model

## Security boundary

Environment management is a typed configuration workflow, not a file editor. Users can
select only registered variable names, approved environments, revisioned target profiles,
and typed operations. The agent accepts only signed, expiring tasks for an allowlisted
environment file beneath a pinned repository root. Production and protected targets
remain rejected by schema, API policy, browser workflow, and agent execution.

## Assets and prohibited disclosures

Secret plaintext may exist only in the API vault during creation/approval and in agent
memory during application. It is excluded from definition/version responses, proposed
diffs, approval digests, audit metadata, task progress, error summaries, and browser
state. Browser status for secrets is limited to Configured, Missing, Changed, or Pending
replacement. Non-secret display requires an explicit registry policy.

## Threats and controls

- Path escape, sibling-prefix, symlink and mount attacks: canonical containment checks,
  component `lstat`, mount/device checks, regular-file enforcement and one-hard-link
  enforcement run on the agent immediately before reading.
- Stale and concurrent edits: the plan pins a SHA-256 file digest; the agent rejects a
  mismatch before backup or write.
- Approval substitution/replay: an exact value-free mutation digest is shown to the
  approver, must be echoed at approval, expires after 15 minutes, and is also bound into
  the signed task. Creator and approver must differ.
- Injection: names and service identifiers use strict grammars; values reject NUL, CR,
  LF and oversize input; Docker is invoked through fixed arguments without a shell.
- Partial writes: the agent writes a mode-`0600` exclusive temporary file in the same
  directory, flushes it, sets final ownership/mode, atomically renames it, and flushes
  the directory.
- Unsafe activation: only allowlisted stateless Compose services are recreated.
  Protected/stateful services cannot overlap. Public health URLs are SSRF-filtered and
  every redirect is revalidated.
- Failed change: the previous bytes, ownership and mode are restored atomically, the
  prior services are activated, and health checks run again. Progress remains value-free.
- Privilege escalation through critical variables: enrollment trust, signing, recovery,
  encryption, capability policy, and Cloudflare machine credentials are rejected by the
  ordinary definition/version APIs. A separate privileged rotation workflow is required.
- Cross-environment leakage: promotion helpers copy definitions and policy only; values
  are removed and secret state becomes Missing.

## Registry and release growth

Definitions carry description, classification, required/optional status, applicable
environments, validation rules, affected services, activation behavior, removal/display
policy, risk, introduction/deprecation versions, and explicit rename metadata. Release
planning can list missing required names and pause without exposing values. Deprecation
metadata is informational; automatic deletion is prohibited.

## Remaining gates before production design review

This change deliberately does not enable production deployment or critical-variable
rotation. Before either is designed, add a target-profile-pinned expected UID/GID/mode,
systemd/nginx/database-specific typed activation and readiness adapters, durable
single-use approval consumption in a MongoDB transaction, signed release manifests,
and disposable Linux/browser tests for reboot persistence and every failure adapter.
These are approval gates, not runtime overrides.

## Rollback

Application rollback uses the previously approved immutable image. A failed agent change
rolls back automatically. Manual recovery uses the timestamped adjacent backup only
after verifying its path, ownership and digest, then performs an atomic same-directory
replacement and reruns the prior typed activation/health plan. Never print either file.
