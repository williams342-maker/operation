# Deployment readiness & release attestation — OpsWorkbench control-center

Baseline: reconciled `main` @ `2277beb6` (accepted UI stream). Goal: define exactly what must be true before
any production promotion. **Promotion is NOT authorized by this document** — it still requires provenance
recovery closed ([provenance-recovery-16e14682.md](provenance-recovery-16e14682.md)) **and** explicit owner approval.

## 1. Current state — the attestation pipeline is strong (and was bypassed)

The release/attestation machinery already exists and is rigorous:

- **`control-center-release.yml`** (tag `v*.*.*-*` or dispatch on an existing tag):
  checks out the **exact annotated tag** (`--verify-tag`); Gitleaks 8.30.1 (checksum-verified) secret scan of
  the tagged tree; `npm audit --audit-level=high`; `test` + `typecheck` + `lint` + `build`; **deterministic
  bundle built twice** (`verify-release-artifacts.sh`); **SLSA build-provenance attestation**
  (`actions/attest-build-provenance@v3`) over the tarball + manifest + `SHA256SUMS`; immutable draft prerelease
  that **refuses to replace** an existing release; final clean-tree integrity assertions.
- **`control-center-ci.yml`** builds + verifies an **exact-commit deployment archive** per push
  (`build-deployment-archive.mjs` → `verify-deployment-archive.mjs`).
- **`build-deployment-archive.mjs`** requires an exact 40-char SHA, **refuses any commit that does not resolve
  in the repo**, and emits an integrity manifest binding `archiveSha256` → `commit` → per-file hashes (with
  protected-shell-file LF enforcement).

**Implication:** production `16e14682` **could not have been produced by this tooling** — the archive builder
rejects a commit that does not resolve, and `16e14682` resolves nowhere. Production was deployed **out-of-band**
from a raw local checkout with an env-declared identity, bypassing tags, attestation, and the manifest entirely.
The pipeline is not the weakness; the absence of an **enforced path from pipeline → production** is.

## 2. Readiness gaps (what must change before promotion)

| # | Gap | Why it matters | Remedy |
|---|-----|----------------|--------|
| G1 | **No enforced deploy-time verification.** Nothing makes prod consume only release-workflow output. | This is precisely how `16e14682` happened. | A deploy step that `gh attestation verify` / verifies `SHA256SUMS` + the build-provenance attestation for the bundle, and **refuses to start** otherwise. |
| G2 | **Runtime identity is unverified env strings** (`runtimeIdentity()` trusts `CONTROL_CENTER_SOURCE_COMMIT`/`GIT_COMMIT`/`BUILD_VERSION`). | The running app cannot be proven to match any attested artifact. | Deploy injects the **manifest `commit` + `archiveSha256`**; the identity/health endpoint reports them; a startup check compares the unpacked tree hash to the manifest. |
| G3 | **Tag → audited-line binding is unchecked.** The release workflow will build any pushed `v*.*.*-*` tag. | An unreviewed commit (exactly `16e14682`'s situation) could still be tagged and shipped. | Release job asserts the tag's commit is an **ancestor of audited `main`** (or a reviewed release branch), and fails otherwise. |
| G4 | **Provenance of the currently-running prod is open.** | Cannot attest what is live, cannot safely roll forward/back. | Close via the operator artifact-diff procedure in [provenance-recovery-16e14682.md](provenance-recovery-16e14682.md). |
| G5 | **agent-v2 / key-ceremony prerequisites unmet.** `CONTROL_CENTER_AGENT_PROTOCOL_V2` off; no CP task-signing key, no owner public key, no persistent staging, no key ceremony. | Prod rollout of the asymmetric protocol is unsafe without these (see security-review). | Provision `CONTROL_CENTER_TASK_SIGNING_PRIVATE_KEY` (CP) + `CONTROL_CENTER_OWNER_PUBLIC_KEY`; agents bootstrap both public keys; run the key ceremony on persistent staging first. Keep flag off until then. |

## 3. Deployment-readiness gate (all must be TRUE before promotion)

- [ ] **G4** Provenance of live `16e14682` recovered, drift reviewed, and either matched to a reviewed commit or
      reconstructed into one that is an ancestor of audited `main`.
- [ ] Release artifact built **only** by `control-center-release.yml` from a **pushed annotated tag** whose commit
      is in the audited `main` line (**G3**).
- [ ] Bundle **SHA256SUMS + SLSA build-provenance attestation verified** at deploy time; deploy refuses on failure (**G1**).
- [ ] Running app reports **manifest `commit` + `archiveSha256`**, verified against the unpacked tree at startup (**G2**).
- [ ] Rollback ready: previous immutable bundle retained + verified; documented, tested rollback path; rollback tags current.
- [ ] agent-v2 decision explicit: flag stays **off** for this promotion unless the full key ceremony (**G5**) has
      completed on persistent staging with owner sign-off.
- [ ] Secrets/keys handled by the owner (never by the assistant): no prod keys provisioned in code or CI.
- [ ] **Owner approval** recorded for this specific promotion.

## 4. Recommended implementation order (all non-production, reviewable in PRs)

1. **G3** — add the tag→`main`-ancestor assertion to `control-center-release.yml` (cheapest, closes the
   "unreviewed commit can ship" hole that created `16e14682`).
2. **G2** — deploy injects manifest `commit`/`archiveSha256`; extend `runtimeIdentity()` to report them + a
   startup tree-hash check against the shipped manifest.
3. **G1** — a `verify-before-start` deploy gate (attestation + checksum verification) documented in `deploy/` and
   wired into the deploy scripts.
4. **G4/G5** — host-operator + owner actions (provenance closure, key ceremony), tracked separately.

None of items 1–3 touch production or change runtime behavior of the current build; they harden the path that a
future promotion will use. They should land as normal reviewed PRs against `main`, flag-neutral, before any
promotion is attempted.
