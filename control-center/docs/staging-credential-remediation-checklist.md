# Staging credential-remediation execution checklist

This is an owner-controlled gate. It records identifiers and evidence categories only. Never copy credential values into Git, tickets, chat, command arguments, logs, screenshots, or CI output.

## Scope and current evidence

The confirmed historical credential is an **Emergent LLM API key**, identified by the historical `EMERGENT_LLM_KEY` variable. It appeared in `memory/DEPLOY_ENV.md`, beginning at commit `4bd452d09043`. Repository evidence does not establish whether it served development, staging, production, or a shared account; the provider-account owner must identify every affected environment before staging.

The full-history scan also reported service-shaped categories for Brevo, Buffer, MailerSend, Mailtrap, Postmark, Cloudflare R2, Resend, Sender, Stripe API/webhooks, and an Azure AD client secret, plus generic/JWT test-shaped findings. Treat every service-shaped finding as potentially live until its issuing owner records a value-free disposition. The authoritative commit/path inventory is `docs/historical-credential-cleanup-plan.md`.

## Owner inventory

For the confirmed Emergent key and every unresolved service-shaped category, record evidence outside Git:

- [ ] Provider tenant/account and credential identifier or last-four fingerprint (never the value).
- [ ] Account owner and rotation/revocation operator.
- [ ] Environment classification: development, CI, staging, production, shared, or unused.
- [ ] Applications and scheduled jobs that reference the credential.
- [ ] Servers, containers, functions, and worker processes that receive it.
- [ ] GitHub Actions secrets, repository/environment secrets, and external CI stores that may contain it.
- [ ] Cloud secret managers, password vaults, host environment files, and deployment platforms that may contain it.
- [ ] Provider dashboards, webhook endpoints, OAuth registrations, or API clients tied to it.
- [ ] Logs, releases, artifacts, caches, forks, backups, and old clones that may retain historical copies.

## Safe rotation order

1. Freeze unrelated releases, merges, and deployments and name the remediation, rollback, and communications owners.
2. Inventory all consumers using provider-side metadata and secret-store references without authenticating with or printing the historical value.
3. Create a replacement credential with least privilege, a distinct identifier, and an owner-approved expiry where supported.
4. Store the replacement through the approved secret-delivery channel; do not place it in a repository checkout or shell command.
5. Update one non-production consumer at a time, restart it safely, and validate provider-side success plus application health.
6. Update remaining consumers in an approved order. Production consumers, if any, require a separate change window.
7. Confirm every known consumer uses the replacement and no unexplained authentication failures occur.
8. Revoke the historical credential in the provider control plane. Do not merely disable a local reference.
9. Validate revocation with provider metadata/audit evidence and absence of successful use by the old credential identifier. Do not test by transmitting the old value.
10. Preserve value-free evidence, then decide and separately authorize coordinated history remediation.

## Pre-revocation validation and rollback

Before revocation, require healthy application checks, successful bounded provider operations through the replacement, expected CI results, and provider audit events tied to the replacement identifier. Keep the old credential active only for the shortest owner-approved overlap.

If replacement validation fails, stop rollout, restore the previous secret-store version through the secret manager's recovery mechanism, restart only the affected consumer, and verify health. This temporary rollback does not cancel mandatory revocation; diagnose and repeat rotation within the approved window. After old-key revocation, rollback means repairing the replacement or issuing another new credential, never re-enabling the exposed value.

## Required revocation evidence

- [ ] Provider, tenant/account, credential identifier/fingerprint, operator, and UTC timestamp.
- [ ] Provider status showing revoked, deleted, or expired without revealing the value.
- [ ] Provider audit-event or change-ticket identifier.
- [ ] Consumer inventory with replacement-validation results.
- [ ] Monitoring window showing no unexplained authentication failures.
- [ ] Owner attestation that the historical credential was not displayed, tested, or transmitted during remediation.

## Proposed history remediation

Use checksum-verified `git-filter-repo` in a fresh, access-restricted disposable mirror and an untracked permission-restricted replacement specification. Rewrite all affected branch and tag refs, run fully redacted Gitleaks 8.30.1 across all history, require zero unexplained findings, and verify tests/builds at every supported rewritten tip. Update remote refs only with explicit refspecs and `--force-with-lease` under separate authorization; never use a blanket mirror push.

Impact: every rewritten commit and tag object ID changes; annotated tag signatures and release/source-archive references become invalid; open PRs may close or require recreation; branch protection may require a temporary narrowly scoped recovery procedure; CI reruns; collaborators must discard or quarantine old clones and clone again; forks, caches, artifacts, releases, and backups may retain old objects and require separate cleanup. Publish an old-to-new ref map containing object IDs only. Coordinate collaborators before the freeze and prohibit pushes from old clones afterward.

History rewriting reduces repository exposure but does not revoke a credential. Rotation/revocation evidence is a prerequisite, not a result of rewriting history.
