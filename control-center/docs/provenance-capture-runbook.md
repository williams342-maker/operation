# Runbook — read-only capture & comparison of the deployed production tree (blocker #1)

Purpose: recover the provenance of the running production build (self-reported commit `16e14682`, which
exists in no git object DB) by **read-only** capture of the deployed tree and comparison against a clean
checkout of `d354a615` (the preserved production-lineage tip). See
[provenance-recovery-16e14682.md](provenance-recovery-16e14682.md) for why this is necessary.

## Safety guarantees (do not deviate)

- **Read-only on production.** The capture uses only `docker inspect`, `docker cp`, `find`, `sha256sum`,
  `tar`, and (optionally) `curl` to the identity endpoint. It never `docker exec`s, restarts, redeploys, or
  writes to the running application. **Do not** restart, rebuild, or change production configuration.
- **No secrets leave the host.** Secrets, env files, keys, runtime data, logs, caches, dependencies, and
  generated artifacts are pruned from the local copy *before* anything is hashed or archived, and the diff is
  secret-redacted. Review `secret-scan-flags.txt` / `REVIEW-REQUIRED.txt` before returning anything.
- **Return only sanitized outputs** (listed below) — never the raw tree, the archive, or any environment dump.

## Scripts

- `control-center/deploy/provenance/capture-deployed-tree.sh` — run **on the production host**.
- `control-center/deploy/provenance/compare-against-d354a615.sh` — run **offline** (operator workstation or
  any clean host with internet), never on production.

## Step 1 — Identify the deployed release (read-only)

```bash
docker ps --format '{{.ID}}  {{.Image}}  {{.Names}}  up {{.Status}}'
# note the OpsWorkbench control-center container name/id and its app path (commonly /app)
```

## Step 2 — Capture on the production host (read-only)

```bash
# container deployment (typical):
./capture-deployed-tree.sh --container <name|id> --app-path /app \
    --identity-url https://opsworkbench.org/api/identity     # identity-url optional

# OR, if deployed as a plain directory rather than a container:
./capture-deployed-tree.sh --tree /srv/opsworkbench/current
```

Produces (default `~/opsworkbench-provenance-<UTC>/`):
`release-identity.txt`, `deployed-inventory.tsv`, `secret-scan-flags.txt`, `deployed-source.tar.gz`.

## Step 3 — Confirm nothing sensitive was captured

```bash
cat ~/opsworkbench-provenance-*/secret-scan-flags.txt   # review — see below
```
The **secret-file prune is the primary control** (it removes `.env`, keys, data, logs, etc. before anything
is hashed). This scan is an advisory backstop. Expect occasional matches from test fixtures containing fake
secrets; those are benign. Investigate only **real** key material or live credential values, and never return
the archive itself — only the sanitized outputs below leave the host.

## Step 4 — Compare against `d354a615` (offline)

Copy `deployed-source.tar.gz` (+ `release-identity.txt`) to a clean machine, then:

```bash
./compare-against-d354a615.sh /path/to/deployed-source.tar.gz \
    --identity /path/to/release-identity.txt
# defaults: clones origin @ tag provenance/project-deployment-history-local-tip-20260803 (-> d354a615),
#           and aligns the deployed root to the repo's control-center/ subtree.
# adjust with --base-subdir / --deployed-subdir if the deployed layout differs.
```

Produces (default `./provenance-compare-<UTC>/`):
`summary.txt`, `file-classification.tsv`, `sanitized-diff.patch`, `inventory-hashes.txt`
(+ `REVIEW-REQUIRED.txt` only if the redactor flagged something).

## Step 5 — Review and return

1. Confirm `REVIEW-REQUIRED.txt` is absent, and skim `sanitized-diff.patch` to be certain no secret survived.
2. **Return only:** `release-identity.txt`, `summary.txt`, `file-classification.tsv`, `sanitized-diff.patch`,
   `inventory-hashes.txt`. Nothing else.

## Expected outputs (what "closing blocker #1" needs)

| File | Contents | Sensitivity |
|------|----------|-------------|
| `release-identity.txt` | version/commit/branch/image/labels (identity strings only) | safe |
| `file-classification.tsv` | per-path status identical/modified/added/removed + hashes | safe (hashes/paths) |
| `sanitized-diff.patch` | redacted unified diff of modified/added source vs `d354a615` | review before send |
| `inventory-hashes.txt` | archive + output hashes for integrity | safe |
| `summary.txt` | counts + identity echo | safe |

## Interpreting the result → next action

- **All `identical` (no modified/added/removed source):** production == `d354a615`. Provenance established;
  attest `d354a615` and proceed to the deployment-readiness gate.
- **Some `modified`/`added`:** that is the **unreviewed production drift**. Capture it as reviewed commits
  (or explicitly document each hunk with a rationale) before provenance can be called closed.
- **`removed` files present:** production is missing tracked files (partial/older build) — document why.
- **Large unexplained divergence:** production ran off-repo code; the returned diff + inventory become the
  artifact of record for a full review.

Closing blocker #1 = this comparison run, with **all drift classified and captured in reviewed commits or
explicitly documented**. Promotion still additionally requires explicit owner approval.
