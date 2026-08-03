# Provenance recovery — production commit `16e14682`

**Status:** `16e14682` is UNRECOVERABLE from git. Recovery must be **artifact-diff based** and requires a
host-operator to retrieve the deployed tree from production. Promotion stays BLOCKED until this completes
**and** owner approval is granted.

## What production self-reports (and why it is not proof)

`opsworkbench.org` reports `{version: "phase2-staging", commit: "16e14682…", branch: "feat/project-deployment-history"}`.
Source (`control-center/apps/api/src/runtimeIdentity.ts`, on branch `feat/project-deployment-history`):

```js
export function runtimeIdentity() {
  return {
    version: process.env.BUILD_VERSION || "development",
    commit: process.env.CONTROL_CENTER_SOURCE_COMMIT || process.env.GIT_COMMIT || "unknown",
    branch: process.env.GIT_BRANCH || "unknown",
    node: process.version,
  };
}
```

Every field is a **self-declared build-time environment string**, not a cryptographic or git-verified value.
`16e14682` is whatever `CONTROL_CENTER_SOURCE_COMMIT`/`GIT_COMMIT` was set to at deploy; it attests nothing.

## Findings (read-only investigation, 2026-08-03)

1. **`16e14682` exists in no object database** — not local, not `origin`, not GitHub (prior push → 422). It is
   not an ancestor of any local ref, tag, or reflog entry. The commit object is gone (orphaned then GC'd, or
   the build used a dirty/uncommitted tree). Exact-hash recovery from git is therefore impossible.
2. **The probable source line is local and unpushed.** Branch `feat/project-deployment-history` exists:
   - `origin/feat/project-deployment-history` @ `ce604870` (pushed, auditable)
   - local `feat/project-deployment-history` @ `d354a615` — **112 commits ahead of origin**, purely additive
     (merge-base = `ce604870`), dated **2026-07-23 → 2026-07-26**, author Michael Williams. Its tip commits
     ("execute staging deployments with rollback", "authenticated user dashboard", SEO staging) match the
     `phase2-staging` feature profile. Production (deployed ~2026-07-27/28 per ~6.2 d uptime) was almost
     certainly built from this line or a since-rewritten HEAD on top of it.
3. **The 112 commits are the sole copy of production lineage** and exist only on this disk. Preserved locally
   as annotated tag `provenance/project-deployment-history-local-tip-20260803` (→ `d354a615`). **Do not delete
   this tag or the branch without owner sign-off.** They are unreviewed and unattested until pushed + audited.

## Operator procedure to CLOSE recovery (host-operator only — I cannot SSH to prod)

Read-only on the production host. Do NOT redeploy, restart, or mutate prod during this.

1. **Capture the running identity + build metadata** (confirm it still reports `16e14682`, no silent redeploy):
   `curl -s https://opsworkbench.org/…/identity` (the runtimeIdentity endpoint), and record container/image
   labels: `docker inspect <container> --format '{{json .Config.Labels}}'` and the image digest.
2. **Extract the deployed source/build tree** to an offline location (e.g. `docker cp <container>:/app /tmp/prod-16e14682`
   or copy the deploy checkout). Compute a tree hash you can compare: `git init` a throwaway repo on it, or
   `find . -type f -not -path './node_modules/*' | sort | xargs sha256sum | sha256sum`.
3. **Compare against the preserved local line.** For the closest match and the drift:
   - `git diff --stat provenance/project-deployment-history-local-tip-20260803 -- <mapped paths>` after copying
     the extracted tree over a checkout of `d354a615`, OR
   - iterate candidates: for each commit in `ce604870..d354a615`, diff the extracted `control-center/` tree
     against that commit; the commit with the smallest/zero diff is the true source.
4. **Classify the result:**
   - **Exact match** to some commit C in the 112 → provenance established: prod == C; attest C and proceed to
     push/audit C's line.
   - **Match with delta** → the delta is the unreviewed production drift; capture it as a patch, review it, and
     fold it into the line (or reject) before any promotion.
   - **No match** → prod ran off-repo code; treat the extracted tree itself as the artifact of record, review it
     in full, and reconstruct a reviewed commit from it.
5. **Hand the extracted tree hash + diff result back** for audit vs reconciled `main` (`2277beb6`) and for the
   release-attestation baseline.

## Durability recommendation (needs owner approval — outward action)

Push the preserved lineage to origin under a NON-protected provenance ref so the 112 production-lineage commits
are durable and auditable in GitHub (they are currently one disk failure from lost):
`git push origin refs/heads/feat/project-deployment-history:refs/heads/provenance/project-deployment-history-20260803`
This does not touch `main`, does not deploy, and does not enable any flag. It is an outward publish of
previously-unpushed commits, so it must be owner-approved first. Left UNDONE pending approval.

## Gate

Production promotion remains blocked on: (a) this recovery closed via the operator procedure with the drift
reviewed, AND (b) explicit owner approval. Neither the prod-reported commit string nor this document constitutes
either gate.
