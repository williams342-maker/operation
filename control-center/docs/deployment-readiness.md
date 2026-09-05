# Deployment readiness & release attestation — OpsWorkbench control-center

**Reconciled 2026-09-05 against the running host, read-only.** The previous revision was written when
production was `16e14682` and said production had bypassed tags, attestation and the manifest entirely.
That was true of `16e14682` and **is no longer true of what is running**; two releases have happened since,
through the manifest mechanism. Baseline is now `main` @ `a57104c0`. **Promotion is still NOT authorized by
this document** — it requires explicit owner approval.

## 0. What production actually is, measured

| | |
| --- | --- |
| host | `Ops-Workbench`, Ubuntu 24.04.4, behind a token-mode Cloudflare Tunnel (`cloudflared.service`) |
| `/healthz` | `0.1.2-operate`, commit `4c47c7b1…`, `"source":"manifest"` |
| live release | `/opt/opsworkbench/current` → `releases/review-4c47c7b1/app` |
| runtime | Docker Compose project `opsworkbench`: `api`, `web`, `admin-web`, `edge` (nginx:1.27-alpine), `mongo` (mongo:8.0), images tagged with the full 40-char commit |
| ports | edge → `127.0.0.1:18080`; **admin-web → `127.0.0.1:18081`, a separate origin that never traverses the edge** |
| database | `control_center_staging` (the name is historical), 80 collections, 61,743 audit events, 47 enrollments |
| distance from `main` | **225 commits** |

## 1. The chain from reviewed source to the deployed directory VERIFIES

Established 2026-09-05, and worth stating precisely because the previous revision asserted the opposite:

- `gh attestation verify` on `opsworkbench-control-center-0.1.2-operate.tar.gz` exits 0, binding
  `gitCommit 4c47c7b17cbfd8f4bfc4ea1d13fa703e43cf437b` via `refs/tags/v0.1.2-operate`, builder
  `control-center-release.yml`, runner `github-hosted`;
- its three subject digests are `a4d89430…` (tarball), `c0eb41b8…` (manifest), `7213968e…` (`SHA256SUMS`);
- `release.manifest.json` and `incoming.SHA256SUMS` **on the host** hash to `c0eb41b8…` and `7213968e…` —
  the same bytes the attestation signed;
- **all 253 files in the artifact are byte-identical in the deployed `app/` directory.**

So the run-time identity is no longer an env string, and the deployed tree is not merely *claimed* to come
from `4c47c7b1`.

**What is still not proven:** that the running container images were built from that tree. The images are
tagged with the commit, and a tag is a label the builder chose. Nothing binds image bytes to the tree.

## 2. What the release path is, and what rollback is

Neither was written down anywhere before this revision; both are recovered from the host.

**Release.** `releases/<name>/` holds `app/` plus `release.manifest.json`, `incoming.SHA256SUMS`,
`app.override.yml`, `rollback-release.txt` and `rollback-admin-image.txt`. `current` is a symlink to the
live `app/`. Compose lives at `/opt/opsworkbench/shared/compose/docker-compose.yml`; env at
`shared/compose/env/`. `checkpoints/` retains the compose and env of prior deployments.

**Rollback, verified present rather than assumed:**

- `rollback-release.txt` → `/opt/opsworkbench/releases/review-467a3138/app`, which **exists** and carries a
  coherent `release.manifest.json` for `v0.1.1-operate` / commit `467a3138…`;
- that manifest hashes to `6212564a…`, which is **exactly the manifest subject digest in the verified
  `v0.1.1-operate` attestation** — so the rollback target is itself attested, not merely present;
- **all three rollback images are still on the host** (`control-center-{api,web,admin-web}:467a3138…`), so a
  rollback is a retag and `compose up`, not a rebuild.

That last point is the one that is easy to lose: staging has a single `:staging` tag per image, so a rebuild
there destroys the only rollback artifact. Production does not have that problem today. Keep it that way.

**Untested.** Nothing here executes a rollback; that is a production mutation and needs owner authorization.
What is established is that the target, its provenance and its images are all intact.

## 3. Readiness gaps

| # | Gap | Status |
|---|-----|--------|
| G1 | **No enforced deploy-time verification.** Nothing makes prod consume only release-workflow output. | **OPEN.** `control-center/scripts/verify-release-bundle.mjs` exists (offline checksum+manifest, attestation via `gh`, mandatory with `CONTROL_CENTER_REQUIRE_RELEASE_ATTESTATION=1`) but is not wired into a live deploy. The chain in §1 was verified *by hand, after the fact*. |
| G2 | **Runtime identity was unverified env strings.** | **PARTLY CLOSED.** `resolveBuildIdentity()` binds `/healthz` to the shipped manifest and production reports `source: manifest`. The manifest is still a file the deployer placed there: nothing re-hashes the unpacked tree at startup and compares. A startup tree-hash check is what would close it. |
| G3 | **Tag → audited-line binding is unchecked.** The release workflow will build any pushed `v*.*.*-*` tag. | **OPEN.** An unreviewed commit could still be tagged and shipped. |
| G4 | **Provenance of the currently-running prod is open.** | **CLOSED 2026-09-05** — see §1. Superseded for `4c47c7b1`; `provenance-recovery-16e14682.md` remains the record for the older situation. |
| G5 | **agent-v2 / key-ceremony prerequisites unmet.** | **OPEN**, unchanged. Keep `CONTROL_CENTER_AGENT_PROTOCOL_V2` off. |
| G6 | **Nothing checks that the release directory contains ONLY what the manifest names.** | **OPEN, and it has already happened.** Two files a live container is built from — `apps/web/Dockerfile.admin` and `deploy/nginx/admin-web.conf` — were written into the release directory nine minutes after extraction and existed at **no commit in this repository**. A digest check that iterates the manifest cannot see this: every file the manifest names matched. See PR #63, which brought both under review. The remedy is a **set comparison in both directions**, not more digests. |

## 4. Deployment-readiness gate (all must be TRUE before promotion)

- [x] **G4** Provenance of the live release recovered and matched to an attested tag on the audited `main` line.
- [x] Rollback target retained, **its provenance verified**, and its images still present. *(Documented in §2;
      the rollback itself has not been executed — that needs owner authorization.)*
- [ ] Release artifact built **only** by `control-center-release.yml` from a pushed annotated tag whose commit
      is in the audited `main` line (**G3**).
- [ ] Bundle **SHA256SUMS + SLSA build-provenance attestation verified at deploy time**; deploy refuses on
      failure (**G1**). Verifying by hand afterwards is not this.
- [ ] Running app verifies the **unpacked tree** against the manifest at startup, not only reports it (**G2**).
- [ ] Deploy **refuses a release directory containing files the manifest does not name** (**G6**).
- [ ] Container images bound to the tree they were built from, rather than tagged with its commit (**§1**).
- [ ] agent-v2 decision explicit: flag stays **off** unless the full key ceremony (**G5**) has completed on
      persistent staging with owner sign-off.
- [ ] Secrets/keys handled by the owner (never by the assistant): no prod keys provisioned in code or CI.
- [ ] **Owner approval** recorded for this specific promotion.

## 5. Recommended implementation order (all non-production, reviewable in PRs)

1. **G6** — cheapest and the only one with a demonstrated exploit path: compare the file sets both ways.
2. **G3** — the tag→`main`-ancestor assertion in `control-center-release.yml`.
3. **G2** — startup tree-hash check against the shipped manifest.
4. **G1** — a verify-before-start deploy gate wired into the deploy scripts.
5. **G5** — owner actions (key ceremony), tracked separately.

None of 1–4 touch production or change the runtime behaviour of the current build; they harden the path a
future promotion will use.

## 6. Migrations

There is **no migration ledger collection** in the production database. Schema state is whatever the
application has written, and there is no record on the host of which migrations have been applied. This is
consistent with the known behaviour that nothing calls `migrate()` automatically. Any promotion crossing a
schema change has to treat that as a manual, recorded step.
