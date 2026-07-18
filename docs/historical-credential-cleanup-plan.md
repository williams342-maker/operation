# Historical credential cleanup plan

Prepared 2026-07-18. This document contains identifiers and categories only. It intentionally contains no credential values.

## Confirmed credential

- Category/service: Emergent LLM API key, inferred from the `EMERGENT_LLM_KEY` variable name.
- Path: `memory/DEPLOY_ENV.md`.
- Introduction commit: `4bd452d09043e3c0acdf4fcf5eef312654153be0`.
- Subsequent path commits retaining the credential: `1dffb6b304700f5ddc40dfbdea5952a7e8793288` and `06e71c30f600dfd3f9821cc173f0101fbe95a8ea`.
- Current-tree redaction commit: `19e28fffc6ec06b375fc3de65f21fd9e348d27d2`.
- Earliest affected commit: `4bd452d09043e3c0acdf4fcf5eef312654153be0`.
- Latest affected commit on the validation line: `149fffec94ac4ff838d9cbb7d9b537175a83c464`, the parent of the redaction commit.
- Revocation/rotation status: not verifiable from repository evidence; manual owner action is required before rewriting history.

The following tips still contain the confirmed credential in their snapshots:

- Local branches: `control-center-phase-1`, `phase-2a-management-ui`, `phase-2b-readonly-task-system`.
- Remote branches: `origin/main`, `origin/control-center-phase-1`, `origin/phase-2a-management-ui`, `origin/phase-2b-readonly-task-system`.
- Tags: `v0.1.0-private-staging`, `v0.2.0-phase-2a-private-staging`, `v0.2.1-phase-2b-readonly-task-system`.

The local and remote `validation/discovery-hardening-linux` tips contain the working-tree redaction, but their ancestry remains affected.

## Full history scan

Gitleaks 8.30.1 was downloaded from its official release, verified against the published SHA-256 manifest, and run with `--all --full-history --no-textconv` and 100% redaction. It scanned 1,135 commits and reported 17 findings across five paths and five introduction commits. No matched value was copied into this document.

| Introduction commit | Path | Categories requiring triage |
| --- | --- | --- |
| `4bd452d09043e3c0acdf4fcf5eef312654153be0` | `memory/DEPLOY_ENV.md` | Emergent LLM, Brevo, Buffer, MailerSend, Mailtrap, Postmark, Cloudflare R2, Resend, Sender, Stripe API, Stripe webhook, and Stripe Connect webhook credential patterns |
| `3f446730ec5f33fcef92ca7de63b2e61628b5d3d` | `scripts/bing_oauth_bootstrap.py` | Azure AD client-secret pattern |
| `2ed81b40c25cd6b3ca6b9b242db17cb919c64da8` | `memory/CHANGELOG.md` | Generic API-key patterns |
| `0bce89b59eb46402cdd2502f2405ff481acc6d98` | `backend/tests/test_iter457_workshop_floor.py` | JWT pattern |
| `c357d0e867fe546681c6d741a9c94cfa87aaa243` | `test_reports/iteration_5.json` | Generic test-credential pattern |

All five introduction commits are reachable from every current local branch, fetched remote branch, and tag listed above, including the validation branch. Test-shaped findings may be fixtures, but they must be verified before allowlisting. All service-shaped findings must be treated as live until the issuing account owner confirms revocation or rotation.

## Required sequence

1. Inventory the owning account and environment for every service-shaped category above. Revoke or rotate credentials first. Record confirmation outside Git without copying values into tickets, chat, logs, or this repository.
2. Confirm whether the JWT and test-credential findings are synthetic fixtures. If so, replace them with scanner-safe generated fixtures; do not allowlist unexplained findings.
3. Freeze pushes and merges. Notify every collaborator that all branch and tag object IDs will change and old clones must not push.
4. Create an offline bare mirror backup with access restricted to the remediation owner. Keep it only for the agreed emergency-retention period, then securely destroy it.
5. Install and checksum-verify `git-filter-repo`. Work only in a fresh disposable mirror clone.
6. Generate an untracked, permission-restricted replacement specification directly from verified findings. It must replace all confirmed values across all refs without printing them. Never commit, echo, or archive that specification.
7. Run `git filter-repo --replace-text <restricted-specification> --force` across all local heads and tags in the disposable mirror. Use path removal only if owners decide the five historical files should be purged entirely; restore sanitized current versions in a new commit if needed.
8. Re-run Gitleaks with `--all --full-history --no-textconv`. Require zero unexplained findings. Verify current-tree tests, builds, branch tips, tags, and the intended validation commit content.
9. Review protected-branch rules and temporarily authorize only the remediation operator for coordinated rewritten-ref updates.
10. With separate explicit approval, force-update every affected remote branch using exact refspecs and `--force-with-lease`, then force-update each affected tag. Do not use an unqualified `--force` or `--mirror` push.
11. Make fresh clones, fetch tags, and repeat the history scan from each supported branch. Confirm GitHub Actions and required checks are green on rewritten tips.
12. Invalidate old clones, forks under organizational control, cached archives, CI artifacts, patch files, and local mirrors. GitHub caches and third-party forks may retain unreachable objects; contact their administrators where required.

## Operations requiring separate explicit approval

The following are intentionally not authorized by this plan:

- Rewriting any commit or tag with `git filter-repo`.
- Force-pushing `main`, `control-center-phase-1`, `phase-2a-management-ui`, `phase-2b-readonly-task-system`, or `validation/discovery-hardening-linux`.
- Force-updating or deleting any of the three listed tags.
- Changing protected-branch rules, deleting branches, or invalidating releases/artifacts.

Before approval, provide the fresh-mirror path, scanner version/checksum, replacement count by category, exact old-to-new branch and tag object IDs, exact `--force-with-lease` refspecs, backup retention owner, collaborator notification status, and proof of credential revocation/rotation.

## Exposure warning

Deleting or redacting a value in the current file does not remove it from Git history, forks, cached CI logs, downloaded source archives, releases, old clones, local mirrors, or third-party caches. History cleanup reduces repository exposure only after credentials are revoked and every affected ref and retained copy is handled.
