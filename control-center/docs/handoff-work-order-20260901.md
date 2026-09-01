# OpsWorkbench work order — 2026-09-01

**Supersedes** the "Immediate work order", "Current operating posture", and "Material state discrepancy"
sections of `HANDOFF-BRIEF.md` (packaged 2026-09-01) and the status sections of Foreman's
`context/opsworkbench.md`. Those were written against the premise that OpsWorkbench is not deployed and
that deployment is frozen. **It is deployed and serving traffic.** Every item below is re-scoped for a
live system.

Nothing in this document authorizes deployment, release publication, flag changes, key creation, DNS or
Cloudflare changes, or production data mutation. The authorization boundary in the packaged brief is
unchanged and is restated in §5.

---

## 1. Verified state

All of the following was established read-only on 2026-09-01. Each line names how it was checked, so a
reader can tell evidence from inference.

### Package and repository

| Fact | Value | How verified |
|---|---|---|
| Handoff package integrity | PASS | `restore/verify-handoff.ps1` (HEAD, origin URL, clean tree, `fsck`, 4 SHA-256s) |
| Snapshot commit | `4c47c7b17cbfd8f4bfc4ea1d13fa703e43cf437b` | `git rev-parse HEAD` |
| `origin/main` | same commit, 0 ahead / 0 behind | `git rev-list --left-right --count` |
| Remote movement since packaging | **none** | `git fetch --all --prune --tags` fetched nothing |
| Remote branches / tags | 31 / 13 | `git branch -r`, `git tag` |
| Object connectivity | clean | `git fsck --connectivity-only` |

The snapshot is current, not stale. The remote has not moved since 2026-08-08.

> `SHA256SUMS.txt` includes the hash of `restore/verify-handoff.ps1` itself, so the script attests its own
> integrity. Treat the verification as a corruption check, not a tamper-evidence check.

### Running system

```
GET https://opsworkbench.org/healthz  ->  200
{"ok":true,"status":"alive","version":"0.1.2-operate",
 "commit":"4c47c7b17cbfd8f4bfc4ea1d13fa703e43cf437b","source":"manifest"}
```

- Fronted by Cloudflare; HSTS, CSP, COOP, CORP, `X-Content-Type-Options`, `Referrer-Policy`,
  `X-Frame-Options: DENY` all present. Several headers are emitted twice by different layers — cosmetic,
  but see item **W7**.
- `GET /api/healthz` -> `401 {"error":"Authentication required"}`. The API surface is gated.
- `GET /` -> `200`, SPA shell, `Cache-Control: no-store`.
- The reported commit is `origin/main` and is exactly tag `v0.1.2-operate`. Internally consistent.

### Branch reconciliation, by exact SHA

| Branch | Tip | Status vs `origin/main` |
|---|---|---|
| `review/fleet-agent-upgrades` | `efd8290c2a2c` | merged, 0 ahead |
| `agent-v2/asymmetric-credentials` | `bcbf8ba186ba` | merged, 0 ahead |
| `staging/agent-v2-exercise-20260803` | `b439b807e8a1` | merged, 0 ahead |
| `integration/foundry-consolidated` | `470983211a2e` | **not merged**, 4 ahead |

Checked with `git merge-base --is-ancestor` against `origin/main`, not by branch name and not by reading
merge-commit subjects.

### Provenance lineage

`origin/provenance/project-deployment-history-20260803` and annotated tag
`provenance/project-deployment-history-local-tip-20260803` both resolve to `d354a615` **on GitHub**
(`git ls-remote`). The 112-commit production lineage is durable. It is still unreviewed and unattested.
See `provenance-recovery-16e14682.md`, which has been corrected.

---

## 2. What the packaged brief got wrong

1. **"Production deployment is frozen" / "not deployed."** It is deployed, at `main` tip. This is the
   correction that re-scopes everything else: the risk posture is live-system risk, not pre-launch risk.
2. **The `16e14682` recovery is a release prerequisite.** No longer. Production does not report that
   identity and does not run that line. The recovery's operator procedure is now unrunnable — the tree it
   asks an operator to extract is not deployed anywhere. Recovery is optional archaeology, wanted only if
   the 112-commit lineage is ever promoted.
3. **The provenance durability push is outstanding.** It was completed; both refs are on `origin`.
4. **`integration/foundry-consolidated` is Forge material to be reconciled.** It is not.
   **Foundry is not Forge** — see §3.

Three of the four branches the brief warned "must not be assumed merged" are in fact merged. The warning
was still the right instinct; the answer just came out the other way.

---

## 3. Foundry is not Forge

`origin/integration/foundry-consolidated` (4 commits, ~2330 insertions across 37 files) contains
`FoundryStudio.tsx`, `FoundryLandingPage.tsx`, `foundryApi.ts`, a credit ledger, provider-neutral site
generation, and a theme system. It is the **AI website-builder studio** — a product surface.
`website-builder-extraction-audit.md` explicitly scoped that builder **out** of OpsWorkbench as a future
standalone product.

Forge, as the packaged brief defines it, is a build/artifact/manifest authority that produces immutable
source-bound manifests and cannot deploy. **No such code and no such specification exists in this
repository.** That is why the 2026-08-31 master brief "found no authoritative completed Forge
specification" — there is nothing to find, and the name collision with Foundry is the likely origin of the
belief that there was.

**Consequence:** do not "reconcile Forge/Foundry material". Foundry is a scoped-out product branch with its
own extraction plan. Forge is greenfield and starts with a written specification (item **W5**).

---

## 4. Work order

Ordered by dependency, not by ambition. **W1–W4 need no new authorization.** W5–W8 are design and build
work that stays deployment-free. W9–W11 are gated on owner authorization or on host access not available
from the handoff.

### W1 — Establish read-only host visibility *(blocked on access, not authorization)*

The packaged brief's item 2 asked to reverify staging identity; that is done for everything reachable from
the public edge. The following remain **unknown** and cannot be resolved over HTTPS from outside:

- Which host or container actually serves `opsworkbench.org`, and by what deployment mechanism
- Cloudflare Access / Tunnel configuration, and whether the origin is directly reachable
- MongoDB identity, location, and backup state
- Agent enrollment: how many agents, which keys, which organization scopes
- Whether `CONTROL_CENTER_RELEASE_MANIFEST` is actually set on the host, and to what

Do not infer any of these from the repository or from the public hostname. This is the single largest
blind spot; much of what follows is guesswork until it closes.

### W2 — Close the identity-attestation gap *(deployment-free)*

`resolveBuildIdentity()` validates the release manifest's **shape** — `schemaVersion`, a `v`-prefixed
`tag`, a 40-hex `commit` — and nothing more. No signature is checked at runtime, and nothing binds the
*running code* to the reported commit. It is a real improvement over the `GIT_COMMIT` environment variable
that produced `16e14682`, and it is still a self-declared string, now living in a file instead of an
environment variable.

**Correction (2026-09-01, same day).** An earlier draft of this document stated the repository has zero
GitHub attestations. That was wrong — it came from querying the attestations API with a placeholder
digest, which returns 404 regardless. Verified properly:

```
gh attestation verify opsworkbench-control-center-0.1.2-operate.tar.gz --repo williams342-maker/operation
-> verified, SLSA v1 provenance, Rekor log index 2385810293
```

A SLSA v1 build-provenance attestation **exists and verifies** for the `v0.1.2-operate` release bundle.
`sourceRepositoryDigest` and `resolvedDependencies[].digest.gitCommit` both equal
`4c47c7b17cbfd8f4bfc4ea1d13fa703e43cf437b`; the builder identity is
`.github/workflows/control-center-release.yml@refs/tags/v0.1.2-operate` on a `github-hosted` runner;
subject digests match the published `SHA256SUMS` exactly. The provenance chain from source to release
bundle is **strong and independently checkable**, backed by a public transparency log.

The gap is narrower than first stated, and cheaper to close. **The attestation exists; nothing consults
it.** `resolveBuildIdentity()` reads the manifest JSON and shape-checks it — it never verifies the
attestation that covers that very manifest, and nothing binds the running process to it. Two further
limits stand: all five releases are still **Drafts**, and the attestation covers the **release bundle**,
not the backend/frontend **container images** the deployment preflight actually deals with.

Work: verify the manifest against the SLSA build-provenance attestation at startup, and bind the manifest
to the shipped tree with a content digest computed over the served artifact rather than a string copied
into JSON. Fail closed to an explicit `source: "unverified"` rather than silently falling back to `env`.

### W3 — Resolve the served-asset timing discrepancy *(read-only, small)*

`index.html` is served with `Last-Modified: 2026-08-08T14:28:01Z`, which is **before** the `4c47c7b` merge
commit (`14:50:58Z`) and before its PR-head parent `cae6c0b6` (`14:45:46Z`). The merge commit's tree is
identical to that parent's (`322b1275e498`), so a benign explanation exists — an origin file mtime, or a
CDN artifact. But as it stands the served frontend bundle is not provably built from the commit the API
reports, which is a small live instance of exactly the gap W2 addresses. Resolve it, or record the benign
explanation.

### W4 — Correct the stale records *(this change)*

- `provenance-recovery-16e14682.md` — corrected in this change.
- Foreman's `context/opsworkbench.md` — corrected separately in the `foreman` repository, which is its
  source of truth; the handoff package's `docs/foreman_opsworkbench_context.md` is a byte-identical copy.
- `HANDOFF-BRIEF.md` — a package artifact covered by `SHA256SUMS.txt`. It points here rather than being
  edited in place, so the packaged manifest keeps verifying.

### W5 — Specify Forge before building it *(deployment-free)*

Forge does not exist. Write the specification first; there is nothing to reconcile against.

The authority model from the packaged brief is sound and should be preserved as written: Forge may build,
test, prepare immutable artifacts and manifests, and propose bounded plans. OpsWorkbench owns target
identity, environment classification, policy, approval, preflight, capability checks, and audit. The agent
executes only registered capabilities. **Forge must never deploy independently, and must never self-sign
and self-trust its own artifacts.**

The canonical manifest must bind: source commit and tree, artifact/image digests, target, environment,
required capabilities, rollback identity, expiry and nonce, and verifier identity.

### W6 — Integrate the Forge manifest with the beta preflight *(deployment-free)*

The preflight described in `beta-deployment-preflight.md` is the strongest asset in this repository. It
renders the Compose model, refuses unsafe production indicators and MongoDB recreation, binds candidate and
rollback images, fingerprints MongoDB destinations by hostname *and* database rather than by hostname
alone, writes a `0600` two-field override, refuses to overwrite existing paths, and emits commands without
executing them. `PASS` means "awaiting operator approval" and cannot deploy.

Preserve that property exactly. Integration adds manifest verification as an input to the gate; it must add
**no** execution authority. Prove the failure modes, not just the happy path: tamper, wrong target, wrong
environment, MongoDB inclusion, production hostname, stale candidate, and secret leak must each produce
`BLOCKED`.

### W7 — Housekeeping surfaced by the edge probe *(small)*

`Content-Security-Policy`, `Referrer-Policy`, `Strict-Transport-Security`, and `X-Content-Type-Options` are
each emitted more than once, by more than one layer, and the two CSP values **differ**. Browsers intersect
multiple CSP headers, so the effective policy is the stricter one and this is not a vulnerability — but two
layers disagreeing about policy is a maintenance hazard and makes the effective policy hard to reason
about. Consolidate to one authority.

### W8 — Decide Foundry's disposition *(decision, then small execution)*

`integration/foundry-consolidated` is 4 commits and roughly 2330 insertions of unmerged work on a product
that has been scoped out. It is not being reviewed and it is drifting from `main`. Either extract it per
`website-builder-extraction-audit.md`, which already maps the seams (`audit.ts`, `db.ts`, `auth.ts`,
`req.orgId`/`req.user`, two owned collections, one cross-domain read), or tag it for durability and stop
carrying it as an integration branch. Do not merge it as Forge work.

### W9 — Agent release signing *(owner-gated, unchanged)*

Unchanged from the packaged brief. Before any agent release is published: owner-controlled signing custody,
immutable hosting, out-of-band public-key provisioning, public-key-only verification, disposable Linux
install / reinstall / reboot / rollback tests, retention, revocation, and key-rotation policy. Signing
private keys stay offline and outside Git, CI, the OpsWorkbench runtime, artifact storage, target servers,
chat, tickets, command arguments, and environment variables.

### W10 — Independent review of the authority chain *(owner-gated)*

Once W5 and W6 exist, route the complete Forge -> OpsWorkbench -> Agent authority and evidence chain to an
independent certifier. Do not self-certify it.

### W11 — First site onboarding, read-only *(owner-gated)*

Unchanged from the packaged brief. Separate authorization required.

### Deliberately dropped

- *"Reverify staging/runtime identity"* — done; there is no `phase2-staging` identity to reverify.
- *"Recover/audit `16e14682` if it remains a release prerequisite"* — it does not. See §2.2.
- *"Reconcile the five refs by exact SHA"* — done; three are merged, and the fourth is Foundry, not Forge.

---

## 5. Authorization boundary (unchanged)

Read-only discovery and planning are not execution authority. A beta preflight `PASS` means "awaiting
operator approval" and cannot deploy.

Without separate, exact owner authorization, do not: flip the agent-v2 feature flag, publish an agent
release, create signing keys, expose new public ports, mutate production data, change DNS or Cloudflare
configuration, or perform a real-site deployment.

`main` is protected and PR-gated. Never force-push or bypass it.

The updater is a separate privileged path. Do not turn it, or Forge, into a generic remote-root or
arbitrary-shell interface.

## 6. Credential and history warning (unchanged)

`docs/gitleaks-triage-report.md` records historical credential findings and unresolved R2 credential
identity and rotation work. This is a full-history clone; treat the history as sensitive operational
material even though the remote repository is public. Do not extract, reproduce, or circulate historical
secret values. Complete the owner-side inventory and rotation decisions before relying on affected
credentials.

## 7. Still unverified

Stated plainly so that no later reader mistakes silence for assurance. As of 2026-09-01 this document does
**not** establish: the serving host or its deployment mechanism; Cloudflare Access or Tunnel state;
database identity, contents, or backup status; agent enrollment or key inventory; whether the running code
matches the commit it reports; the state of the R2 credential rotation; or the results of the product test
suites, which were not run.
