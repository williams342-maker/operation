# Deployment readiness & release attestation — OpsWorkbench control-center

**Reconciled 2026-09-05 against the running host, read-only.** The previous revision was written when
production was `16e14682` and said production had bypassed tags, attestation and the manifest entirely.
That was true of `16e14682` and **is no longer true of what is running**; two releases have happened since,
through the manifest mechanism. Baseline is now `main` @ `b5105c20`. **Promotion is still NOT authorized by
this document** — it requires explicit owner approval.

## 0. What production actually is, measured

| | |
| --- | --- |
| host | `Ops-Workbench`, Ubuntu 24.04.4, behind a token-mode Cloudflare Tunnel (`cloudflared.service`) |
| `/healthz` | `0.1.2-operate`, commit `4c47c7b1…`, `"source":"manifest"` |
| live release | `/opt/opsworkbench/current` → `releases/review-4c47c7b1/app` |
| runtime | Docker Compose project `opsworkbench`: `api`, `web`, `admin-web`, `edge` (nginx:1.27-alpine), `mongo` (mongo:8.0), images tagged with the full 40-char commit |
| listeners | edge published on `127.0.0.1:18080`; **admin-web on `127.0.0.1:18081` — observed as a separate listener, so a separate origin.** Whether public admin traffic reaches it directly is *not* established: the tunnel ingress is control-plane-managed and unreadable from the host |
| database | `control_center_staging` (the name is historical), 80 collections, 61,743 audit events, 47 enrollments |
| distance from `main` | **225 commits** |

## 1. Source → release artifact → deployed directory verifies. The runtime does not.

Established 2026-09-05, and stated with its boundary because the previous revision asserted the opposite and
overshooting in the other direction would be the same mistake:

- `gh attestation verify` on `opsworkbench-control-center-0.1.2-operate.tar.gz` exits 0, binding
  `gitCommit 4c47c7b17cbfd8f4bfc4ea1d13fa703e43cf437b` via `refs/tags/v0.1.2-operate`, builder
  `control-center-release.yml`, runner `github-hosted`;
- its three subject digests are `a4d89430…` (tarball), `c0eb41b8…` (manifest), `7213968e…` (`SHA256SUMS`);
- `release.manifest.json` and `incoming.SHA256SUMS` **on the host** hash to `c0eb41b8…` and `7213968e…` —
  the same bytes the attestation signed;
- **all 253 files in the artifact are byte-identical in the deployed `app/` directory.**

**Where that chain stops, precisely:**

- **The match is one-directional, and this is not a quibble.** Every file the artifact contains is present
  and identical; the directory is not therefore the artifact. It holds **two files the artifact does not**,
  and a live container is built from them (G6). "All artifact-listed files verified" is the claim the
  evidence supports; "the deployed directory is provenanced" is not. Importing those two files into the
  repository in PR #63 makes them reviewed **from now on** — it does not retroactively put them inside
  either attested release.

- **The running images are not bound to that tree.** They are *tagged* with the commit, and a tag is a label
  the builder chose. Nothing relates image bytes to the directory above. This is the largest remaining hole
  and it is why G4 below closes a narrow claim rather than a broad one.
- **The tag is not bound to the audited line.** The attestation proves *this artifact was built from the
  commit that tag points at*. It does not prove that commit was ever reviewed or is an ancestor of `main` —
  that is G3, still open. "Reviewed source" is therefore not a phrase this chain has yet earned.

## 2. What the release path is, and what rollback is

Neither was written down anywhere before this revision; both are recovered from the host.

**Release.** `releases/<name>/` holds `app/` plus `release.manifest.json`, `incoming.SHA256SUMS`,
`app.override.yml`, `rollback-release.txt` and `rollback-admin-image.txt`. `current` is a symlink to the
live `app/`. Compose lives at `/opt/opsworkbench/shared/compose/docker-compose.yml`; env at
`shared/compose/env/`. `checkpoints/` retains the compose and env of prior deployments.

**The thing that produces all of that is not in this repository, and is not on the host either.** Nothing
under `control-center/` deploys the control-center: `verify-release-bundle.mjs` has exactly one caller, its
own test, and `control-center/deploy/` is material a host consumes — compose, nginx, systemd — not a
deployer. On the host, no script under `shared/`, `/usr/local/bin` or `/root` references the release layout
or the two overlay files in G6. The layout above is an artifact of a process that exists only wherever it is
being run from.

**That is why G1 and G6 cannot be closed by writing code here.** Both remedies are checks a deploy performs,
and there is no deploy to put them in; adding another verifier nothing calls would reproduce exactly the
situation G1 already describes. Recovering or rebuilding the deployment mechanism under version control is
the prerequisite for both, and it is the first thing a reader looking for "where do I add this" should be
told, because searching for it is otherwise a day lost.

**Rollback. What is established, and nothing beyond it:**

- `rollback-release.txt` → `/opt/opsworkbench/releases/review-467a3138/app`, which exists;
- its `release.manifest.json` hashes to `6212564a…`, **exactly the manifest subject digest in the verified
  `v0.1.1-operate` attestation** — so the rollback target's metadata is attested, not merely present;
- **every one of the artifact's 253 files is byte-identical in it**, the same check §1 records for the live
  release — and one-directional in the same way: the directory holds the same two extra files, with the same
  digests, so G6 is present in this release too;
- three images tagged `control-center-{api,web,admin-web}:467a3138…` are on the host.

**What is NOT established, and each of these is load-bearing:**

- that those image bytes were built from that directory — the same unbound-tag problem as §1;
- that the current database and schema state is compatible with `v0.1.1-operate`;
- that retagging and `compose up` produces a *working* system. **No rollback has been executed.** Doing so is
  a production mutation and needs owner authorization.

So this is a rollback whose **artifacts are verified available**, not a rollback path shown to work. That
distinction is the whole of the readiness items in §4.

One operational fact worth not losing: production retains a distinct image tag per release, so a rollback
would be a retag rather than a rebuild. Staging has a single `:staging` tag per image, so a rebuild there
destroys the only rollback artifact it has.

## 3. Readiness gaps

| # | Gap | Status |
|---|-----|--------|
| G0 | **There is no deployment mechanism under version control.** The process that creates release directories, writes the overlay in G6 and moves `current` exists in neither this repository nor the host. | **OPEN, and it blocks G1 and G6** — both are checks a deploy performs, and there is no deploy to put them in. See §2. |
| G1 | **No enforced deploy-time verification.** Nothing makes prod consume only release-workflow output. | **OPEN.** `control-center/scripts/verify-release-bundle.mjs` exists (offline checksum+manifest, attestation via `gh`, mandatory with `CONTROL_CENTER_REQUIRE_RELEASE_ATTESTATION=1`) but is not wired into a live deploy. The chain in §1 was verified *by hand, after the fact*. |
| G2 | **Runtime identity was unverified env strings.** | **PARTLY CLOSED.** `resolveBuildIdentity()` binds `/healthz` to the shipped manifest and production reports `source: manifest`. The manifest is still a file the deployer placed there: nothing re-hashes the unpacked tree at startup and compares. Reporting an identity is not verifying one. |
| G3 | **Tag → audited-line binding is unchecked.** The release workflow will build any pushed `v*.*.*-*` tag. | **OPEN.** An unreviewed commit could still be tagged, attested and shipped, and the attestation would look exactly as convincing. |
| G4 | **Provenance of every ARTIFACT-LISTED file in the deployed directory.** *(Narrowed twice on 2026-09-05. It first read "of the currently-running prod", which the evidence does not reach; then "of the deployed release directory", which it also does not reach, because the match runs one way and the directory holds two files the artifact does not.)* | **CLOSED** — see §1. **Provenance of the directory as a whole stays incomplete under G6**, and that is the honest residue rather than a technicality. |
| G4b | **Provenance of the running RUNTIME.** Image bytes are not bound to the deployed tree. | **OPEN.** Carved out of G4 rather than closed with it. |
| G5 | **agent-v2 / key-ceremony prerequisites unmet.** | **OPEN**, unchanged. Keep `CONTROL_CENTER_AGENT_PROTOCOL_V2` off. |
| G6 | **Nothing checks that the release directory contains ONLY what the manifest names.** | **OPEN, and it has already happened — twice.** `apps/web/Dockerfile.admin` and `deploy/nginx/admin-web.conf`, from no commit in this repository, are in **both** the live release and the rollback target, byte-identical in each. A digest check that iterates the manifest cannot see them: every file the manifest named matched. See PR #63, which brought both under review. |

**G6's remedy, in the detail it needs — a naïve version has the same shape of hole it is closing:**

- compare **normalized relative paths *and* filesystem types**, in both directions — a name-only check
  passes a symlink where a file is expected;
- reject unexpected symlinks and directories, not only unexpected regular files;
- run **after extraction *and* again immediately before build/start**. The overlay here was written nine
  minutes after extraction, so a check running only at extraction time would have seen nothing wrong;
- make the later check the one the deploy **refuses on**.

**And that still does not close the window, which is worth saying rather than letting the timing imply it.**
A mutation after the last comparison and before the consumer opens the files is still possible; running the
check later narrows the race, it does not remove it. Removing it means **the verified object has to be the
object consumed**, and the examples have to satisfy that literally:

- build from an **immutable snapshot** that was verified;
- **create the package first, make it immutable or content-addressed, verify that exact package**, then
  consume it **by its verified identity** — creating it first only fixes the directory-to-package race, and
  a mutable package can still change after it has been verified;
- verify while **constructing a content-addressed package**, and consume the resulting digest;
- or prevent writes for the whole of verification *and* consumption.

Note which one is missing: *"package after verification and consume the package"* is **not** sufficient, and
it was in an earlier draft of this paragraph. The directory can change while it is being read into the
package, and the package is in any case not the object whose bytes were verified — it only moves the
boundary one step. Timing is the cheap mitigation; identity is the fix, and identity means the same bytes,
not a faithful copy of them.

## 4. Deployment-readiness gate (all must be TRUE before promotion)

- [x] **G4** Every **artifact-listed** file in the deployed directory matched to an attested artifact.
      *(Not the directory as a whole — it holds two files the artifact does not; that residue is G6.)*
- [x] Rollback **artifacts** verified available: target directory present, **all 253 artifact-listed files
      matched** to the attested `v0.1.1-operate` artifact, and its images retained. *(Same two extras
      recovered there; same residue.)*
- [ ] **Documented, tested rollback path.** *(Restored — the previous revision required this and this
      reconciliation wrongly dropped it. Artifact availability is a prerequisite for it, not a substitute.)*
- [ ] **G4b** Container images bound to the tree they were built from, rather than tagged with its commit.
- [ ] Release artifact built **only** by `control-center-release.yml` from a pushed annotated tag whose commit
      is in the audited `main` line (**G3**).
- [ ] Bundle **SHA256SUMS + SLSA build-provenance attestation verified at deploy time**; deploy refuses on
      failure (**G1**). Verifying by hand afterwards is not this.
- [ ] Running app verifies the **unpacked tree** against the manifest at startup, not only reports it (**G2**).
- [ ] Deploy **refuses a release directory containing files the manifest does not name**, checked
      immediately before start as well as after extraction (**G6**).
- [ ] agent-v2 decision explicit: flag stays **off** unless the full key ceremony (**G5**) has completed on
      persistent staging with owner sign-off.
- [ ] Secrets/keys handled by the owner (never by the assistant): no prod keys provisioned in code or CI.
- [ ] **Owner approval** recorded for this specific promotion.

## 5. Recommended implementation order (all non-production, reviewable in PRs)

1. **G0** — first, because it is not optional: G6 and G1 are checks with nowhere to live until a deployer is under version control. This is recovery of an existing process, not a new design.
2. **G6** — the only gap with a demonstrated instance, and cheap once G0 gives it a home.
3. **G3** — the tag→`main`-ancestor assertion in `control-center-release.yml`.
4. **G2** — startup tree-hash check against the shipped manifest.
5. **G1** — a verify-before-start deploy gate wired into the deploy scripts.
6. **G4b / G5** — image binding, and the owner-run key ceremony, tracked separately.

None of 2–5 mutates production while it is being built. They **do** change how a future promotion behaves —
that is their purpose: a startup tree-integrity check and a verify-before-start gate exist to *refuse* a
deploy that today would proceed. Saying they change nothing would be the same kind of overclaim this
revision exists to remove.

## 6. Migrations

There is **no migration ledger collection** in the production database. Schema state is whatever the
application has written, and there is no record on the host of which migrations have been applied. This is
consistent with the known behaviour that nothing calls `migrate()` automatically. Any promotion crossing a
schema change has to treat that as a manual, recorded step — and it is also why rollback compatibility in
§2 is unknown rather than merely untested.
