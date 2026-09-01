# Forge manifest specification — `forge-deployment-v1`

**Status: DRAFT SPECIFICATION. No implementation exists.** This document defines a format and a
verification procedure. It authorizes nothing, deploys nothing, and adds no execution authority to any
component. Work-order item W5 in [handoff work order 2026-09-01](handoff-work-order-20260901.md).

**Owner decision, 2026-09-01: the verifier is a separate party, not an OpsWorkbench component.** §3 and
§7 are written to that decision, and §7.4 records that it also resolves the question of where Forge may
run and what key material it may hold. The short version: Forge holds **no signing key at all**.

## 1. Why this document exists

Forge has been referred to as an existing subsystem to be reconciled. It is not one. Verified against
`origin/main` on 2026-09-01: **no Forge code and no Forge specification exist in this repository.**

The confusion has a specific source. `origin/integration/foundry-consolidated` is the **Foundry** AI
website-builder studio — a product surface that
[website-builder-extraction-audit.md](website-builder-extraction-audit.md) explicitly scoped **out** of
OpsWorkbench as a future standalone product. **Foundry is not Forge.** They share three letters and
nothing else. Do not reconcile one against the other.

So Forge starts here, with a written format, rather than with an excavation.

## 2. The gap Forge closes

The [beta deployment preflight](beta-deployment-preflight.md) is the strongest safety mechanism in this
repository. It resolves the Compose model, refuses unsafe production indicators, blocks MongoDB
recreation, fingerprints database destinations by hostname *and* database name, writes a `0600`
two-field override, refuses to overwrite existing paths, and emits commands without executing them.

It has one structural gap, and it is not a bug — it is the boundary of what a preflight can know.

Every input in `BetaDeploymentPreflightInput` is **operator-asserted**. `authorizedBackendImage` is a
string a human typed into a JSON file. The preflight verifies that the image *exists locally*
(`docker image inspect`) and that the candidate and rollback images are *distinct*. It does not, and
cannot, verify that the image was built from reviewed source.

The seam is already visible in the code. `defaultInspectImage()` reads the OCI label
`org.opencontainers.image.revision` and stores it as `report.images[role].revision` — and **nothing ever
compares that value to anything.** The provenance is collected and then dropped on the floor.

Forge's job is to supply the value that field should be checked against.

| Question | Answered today by | Should be answered by |
|---|---|---|
| Does this image exist? | preflight (`docker image inspect`) | preflight, unchanged |
| Is the target environment beta? | preflight (three-way env resolution) | preflight, unchanged |
| Is MongoDB excluded? | preflight | preflight, unchanged |
| Was the **release bundle** built from reviewed source? | **already solved** — see §2.1 | unchanged, but actually consulted |
| **Was this container image built from reviewed source?** | **nobody** | **Forge manifest + verification** |
| **Is the rollback image a real prior release?** | **nobody** | **Forge manifest + verification** |
| **Has this authorization expired or been replayed?** | **nobody** | **Forge manifest + verification** |

### 2.1 What is already solved, and must not be rebuilt

`.github/workflows/control-center-release.yml` already produces a **keyless SLSA v1 build-provenance
attestation** (`actions/attest-build-provenance@v3`, `id-token: write`) over the release bundle.
Verified end to end on 2026-09-01:

```
$ gh attestation verify opsworkbench-control-center-0.1.2-operate.tar.gz \
    --repo williams342-maker/operation
verified
```

The attestation covers `SHA256SUMS`, the `opsworkbench-release-v1` manifest, and the `.tar.gz`; the
subject digests match the published `SHA256SUMS` exactly; `sourceRepositoryDigest` and
`resolvedDependencies[].digest.gitCommit` both equal `4c47c7b17cbfd8f4bfc4ea1d13fa703e43cf437b`; the
builder identity is `.github/workflows/control-center-release.yml@refs/tags/v0.1.2-operate` on a
`github-hosted` runner; and the whole thing is anchored in the public Rekor transparency log at index
`2385810293`.

That is a genuinely independent, machine-checkable provenance chain from source to release bundle,
**already working**, with no private key held anywhere.

Two limits keep it from closing the gap on its own:

1. **It covers the release bundle, not the container images.** The preflight deploys backend and
   frontend images; nothing attests those.
2. **Nothing consults it.** `resolveBuildIdentity()` shape-checks the manifest JSON at runtime and never
   verifies the attestation that covers that very manifest.

Forge extends this mechanism to images and deployment targets. It does not replace it, and it does not
introduce a competing signing scheme.

## 3. Authority model

Forge may build, test, produce immutable artifacts, and emit a manifest describing what it built. It
**proposes**. OpsWorkbench owns target identity, environment classification, policy, approval,
preflight, capability checks, and audit. It **decides**. The agent executes only registered capabilities
from the closed protocol enum. It **acts**.

Three properties are non-negotiable:

1. **Forge must never deploy.** No target credentials, no agent channel, no task-creation authority.
2. **Forge must never self-sign and self-trust.** Per the owner's 2026-09-01 decision, verification is
   performed by parties that are **not OpsWorkbench components**.
3. **A verified manifest is not an approval.** It turns a preflight `BLOCKED` into
   `PASS — awaiting operator approval`. That is all.

### 3.1 The two separate parties

The system already contains two independent verification authorities. Neither is an OpsWorkbench
component, neither requires new key custody, and both are already in use. Forge uses these rather than
inventing a third.

| | **Party A — Sigstore / Rekor** | **Party B — the owner** |
|---|---|---|
| Answers | *Was this built from that source, by that workflow?* | *Is this deployment authorized?* |
| Mechanism | keyless OIDC + public transparency log | offline Ed25519, `owner-authorization-v1` |
| Already in repo | `actions/attest-build-provenance@v3` (§2.1) | `ownerAuthorizationMessage()` in `ownerAuthorization.ts` |
| Key held by OpsWorkbench | none | none — public verification material only |
| Can OpsWorkbench forge it? | no — would require a Rekor entry it cannot mint | no — would require the offline private key |

**OpsWorkbench checks both and vouches for neither.** It holds only public trust material. This is the
same discipline the updater already follows: `/etc/opsworkbench-agent/updater-trust.json` is root-owned
and holds *public verification keys only*, and a public key shipped beside an artifact is informational
until checked against independently provisioned material.

Separation is structural, not procedural. Party A's authority rests in a transparency log outside this
project entirely. Party B's authority rests in a key that, per
[agent-release-signing.md](agent-release-signing.md), never enters this repository, CI variables, the
control-center database, artifact storage, or a target server.

## 4. Non-goals

- Forge does not gain a deployment task type. The protocol has ten (`agent.upgrade`, `check.http`,
  `check.mongo`, `collect.system`, `collect.telemetry`, `configuration.apply`,
  `configuration.rollback`, `inspect.compose`, `inspect.docker`, `inspect.git`) and this adds none.
- Forge does not hold, transport, or reference secret values. The manifest is value-free.
- **Forge does not hold a signing key.** See §7.
- Forge does not become a generic remote build-and-ship service, a remote shell, or a path to arbitrary
  commands, arguments, service names, or install paths.
- Forge does not replace or relax the preflight. It adds an input to it.

## 5. Manifest format

### 5.1 Shape

`forge-deployment-v1` mirrors `agent-upgrade-v1` (`packages/shared/src/agentUpgrades.ts`), which already
solves the same problem for agent upgrades. **Every value is a string, a number, or an array of
strings.** No nested objects. §6 explains why that is a correctness requirement rather than a style
preference.

The owner authorization (§7.2) travels **alongside** the manifest as a detached statement, not as a
nested field. This keeps the manifest flat and keeps the signature outside the thing it signs — the
separation `privilegedActionDigest()` already makes by deleting `ownerAuthorization` before digesting.

### 5.2 Fields

| Field | Type | Binds |
|---|---|---|
| `schemaVersion` | literal `"forge-deployment-v1"` | format identity |
| `manifestId` | `^[A-Za-z0-9._:-]{1,160}$` | this manifest |
| **Source** | | |
| `sourceRepository` | HTTPS URL | which repository |
| `sourceCommit` | `^[0-9a-f]{40}$` | exact commit |
| `sourceTree` | `^[0-9a-f]{40}$` | exact tree — catches a rewritten commit (§5.3) |
| `sourceTag` | `^v.+`, optional | the reviewed release tag, when one exists |
| **Artifact** | | |
| `backendImageDigest` | `^[a-z0-9.\-_/]+@sha256:[a-f0-9]{64}$` | immutable backend image |
| `frontendImageDigest` | same | immutable frontend image |
| `releaseBundleSha256` | `^[a-f0-9]{64}$`, optional | the attested release bundle (§2.1) |
| `releaseManifestDigest` | `^[a-f0-9]{64}$`, optional | ties to `opsworkbench-release-v1` (§8.3) |
| **Target** | | |
| `targetEnvironment` | `^[a-z][a-z0-9-]{0,39}$` | exactly one environment |
| `targetServerId` | 12–64 chars | exactly one server |
| `targetOrgId` | 12–64 chars | exactly one organization |
| `composeProjectName` | `^[a-z0-9][a-z0-9_-]{0,62}$` | exactly one Compose project |
| `authorizedServices` | array of service names, max 20 | exactly which services may be recreated |
| **Rollback** | | |
| `rollbackBackendImageDigest` | digest form | the prior known-good backend |
| `rollbackFrontendImageDigest` | digest form | the prior known-good frontend |
| `rollbackSourceCommit` | `^[0-9a-f]{40}$` | what the rollback images were built from |
| **Provenance (party A)** | | |
| `builderIdentity` | HTTPS URL | the OIDC workflow identity that must appear as the attestation's `builder.id` and certificate SAN |
| `builderRunnerEnvironment` | `^[a-z-]{1,40}$` | e.g. `github-hosted`; rejects a self-hosted runner substitution |
| `requiredCapabilities` | array, max 100 | drawn from the closed protocol enum (§5.4) |
| **Freshness** | | |
| `issuedAt` | RFC 3339 | when Forge built it |
| `expiresAt` | RFC 3339 | when it stops being usable |
| `nonce` | 16–160 chars | replay marker |

There is no `signature` field and no `verifierKeyId` field. Forge signs nothing (§7.1).

### 5.3 Why `sourceTree` as well as `sourceCommit`

A commit hash binds a commit *object*. Two commits can carry the same tree, and a rewritten history can
reuse a message and author while carrying a different tree. Binding both makes the manifest survive
history rewriting, and it costs one `git rev-parse <ref>^{tree}`.

This repository has already been bitten by the weaker form. `16e14682` was a commit string production
reported that exists in no object database — see
[provenance-recovery-16e14682.md](provenance-recovery-16e14682.md). A tree hash would not have saved
that deployment, but it makes the same class of claim checkable rather than merely asserted.

### 5.4 `requiredCapabilities` is a closed set

Values MUST come from the protocol enum in `packages/shared/src/protocol.ts`:

```
system, docker, compose, git, http, mongo, environmentDiscovery,
configurationFingerprinting, encryptedSecretDelivery, environmentFileWrite,
dockerComposeActivation, systemdActivation, configurationValidation,
configurationRollback, agentUpgrade, upgradeManifestHandoff
```

A manifest naming a capability outside this set is rejected. A manifest naming a capability the target
agent does not advertise is rejected. Extending the enum is a reviewed protocol change; neither Forge
nor a manifest may do it.

### 5.5 The manifest is value-free

No field may carry an environment value, a connection URI, a token, a key, or a password. Verification
rejects a manifest in which any field matches a credential-shaped pattern — a URI with embedded
userinfo, an `sk_live_` prefix, a PEM header, or a long high-entropy opaque string in a field not typed
as a digest. This mirrors the existing rule for the preflight input JSON.

## 6. Canonicalization

This repository contains three digest patterns with materially different properties. Choosing among
them deliberately matters more here than anywhere else, because this digest is what an authorization
signature covers.

| Pattern | Used by | Key-order canonical | Nesting-safe |
|---|---|---|---|
| **Explicit ordered field join** | `taskSigningBase()`, `ownerAuthorizationMessage()` | yes, by construction | n/a — no nesting possible |
| Plain `JSON.stringify` | `payloadDigest()` | **no** — insertion order | yes |
| `JSON.stringify` + array replacer | `agentReleaseManifestDigest()`, `canonicalUpgradePlan()` | yes | **no** — see §6.1 |

**`forge-deployment-v1` uses the first pattern.** The canonical statement is an explicit newline-joined
list of fields in a fixed documented order, exactly as `ownerAuthorizationMessage()` already does:

```js
["forge-deployment-v1", manifestId, sourceRepository, sourceCommit, sourceTree, ...].join("\n")
```

This sidesteps the §6.1 hazard entirely rather than avoiding it by convention, it is auditable by
reading, it has no serialization ambiguity, and it is the pattern the repository already trusts for its
two most security-sensitive signatures. Adding a field is an explicit, reviewable change to an ordered
list — not an invisible consequence of a schema edit.

### 6.1 The hazard this avoids

The replacer-array idiom looks canonical and is not, for nested input. In
`JSON.stringify(value, replacer)` the array-form replacer is an allowlist applied to **every object in
the graph**, not only the top level. Nested keys absent from the top-level list are dropped from the
serialization **without error**. Demonstrated, not assumed:

```js
const a = { schemaVersion: "x", target: { env: "beta", server: "AAA" } };
const b = { schemaVersion: "x", target: { env: "beta", server: "BBB" } };
const keys = Object.keys(a).sort();          // ["schemaVersion","target"]

JSON.stringify(a, keys)   // {"schemaVersion":"x","target":{}}
JSON.stringify(b, keys)   // {"schemaVersion":"x","target":{}}   <-- identical
```

Two manifests authorizing deployment to **different servers** serialize identically and therefore digest
identically. A signature over the first validates the second. No error, no warning.

**This is not a live bug.** `agentUpgradeManifestSchema`, `agentReleaseManifestDigest`, and
`canonicalUpgradePlan` are all entirely flat — strings and arrays of strings — so the idiom is correct
everywhere it is used today. It is a trap for any nested successor, which is what a Forge manifest would
naturally have become. Flatness (§5.1) plus the ordered-join digest removes the trap twice over.

## 7. Verification — the separate-party model

### 7.1 Forge holds no key

Forge does not sign. It emits the manifest as a **subject of a keyless build-provenance attestation**,
exactly as the release workflow already attests the release bundle (§2.1). The signing identity is the
ephemeral OIDC workflow identity; the evidence is a public Rekor transparency-log entry.

This is what makes property 2 of §3 structural rather than nominal. There is no Forge key to steal,
rotate, or misuse, and no key that both signs and verifies.

### 7.2 The two checks

**Party A — provenance.** Verify the attestation over the manifest against the repository, then require:

- attestation `builder.id` and certificate SAN equal the manifest's `builderIdentity`;
- `sourceRepositoryDigest` and `resolvedDependencies[].digest.gitCommit` equal `sourceCommit`;
- `runnerEnvironment` equals `builderRunnerEnvironment`;
- the attestation subject digest equals the digest of the manifest actually being read.

**Party B — authorization.** Require a detached `owner-authorization-v1` statement over the manifest's
canonical digest, verified against an independently provisioned public key. It binds org, server,
action digest, expiry, and nonce, and it is produced offline. This is the existing mechanism, reused
rather than reinvented.

Both must pass. Party A without Party B is a well-built artifact nobody authorized. Party B without
Party A is an authorization for something whose origin is unknown.

### 7.3 What OpsWorkbench may hold

Public verification material only: the trusted-root configuration for attestation verification, and the
owner's public key. If OpsWorkbench ever holds a private key capable of producing either proof, the
separation collapses and this specification has been violated.

### 7.4 This resolves where Forge runs

An earlier draft listed as an open question how Forge's key custody could be reconciled with
"the private key never enters CI variables" — which, as written, forbids the obvious implementation of a
CI-based builder.

**The question dissolves.** Keyless attestation needs no long-lived key: the OIDC token is ephemeral and
scoped to the workflow run, and the evidence lives in a public log. Forge may therefore run in GitHub
Actions — as `control-center-release.yml` already does — without any private key entering CI. The
constraint stands unweakened because nothing needs to be smuggled past it.

The owner's offline key stays offline. It is never used by Forge and never present in CI; it is used by
the owner, out of band, to authorize a manifest Forge has already produced.

## 8. Integration with the beta preflight

### 8.1 What must not change

`PASS` still means "awaiting operator approval". The CLI still never runs `up`, `create`, `start`,
`restart`, `build`, `pull`, or any volume-changing operation. The `0600` override is still exactly two
fields. Existing paths are still never overwritten. Temporary files are still removed in a `finally`
block and cleanup failure still prevents approval.

### 8.2 What is added

Two new optional inputs — `forgeManifestPath` and `ownerAuthorizationPath` — and one check group that
runs **before** the existing checks:

| Check | Rejects |
|---|---|
| `forge_manifest_schema` | malformed, wrong `schemaVersion`, unknown fields (strict), any nested object |
| `forge_manifest_attestation` | attestation absent, unverifiable, or not covering this manifest's digest |
| `forge_manifest_builder` | `builder.id` / SAN ≠ `builderIdentity`, or runner environment mismatch |
| `forge_manifest_owner_authorization` | missing, expired, replayed nonce, or not verifiable against the provisioned owner public key |
| `forge_manifest_target` | `targetEnvironment` ≠ resolved environment ≠ `APP_ENV`/`ENVIRONMENT`; or `composeProjectName`, `targetServerId`, `targetOrgId` mismatch |
| `forge_manifest_images` | candidate images ≠ the manifest's pinned digests |
| `forge_manifest_provenance` | `report.images[role].revision` (the OCI label the preflight already reads) ≠ `sourceCommit` |
| `forge_manifest_rollback` | rollback images ≠ the manifest's pinned rollback digests |
| `forge_manifest_capabilities` | a capability outside the enum, or not advertised by the target agent |
| `forge_manifest_secrets` | any credential-shaped field value (§5.5) |

When `forgeManifestPath` is absent the preflight behaves exactly as it does today. The change is inert
for current operators and gets adopted deliberately rather than by upgrade.

### 8.3 Relationship to `opsworkbench-release-v1`

Two manifests with different jobs; do not merge them.

- `opsworkbench-release-v1` (`scripts/build-release-artifacts.sh`) describes **what was built** — schema,
  tag, commit, artifact name, reproducibility. It is covered by the attestation of §2.1 and is what
  `resolveBuildIdentity()` reads at runtime.
- `forge-deployment-v1` describes **what may be deployed where, by whom, until when** — target,
  rollback, capabilities, expiry, nonce, builder identity.

`releaseManifestDigest` and `releaseBundleSha256` link the second to the first, so a deployment manifest
can point at the exact attested build it deploys.

### 8.4 An unresolved consequence, stated rather than glossed

The preflight's current rollback command is:

```
docker image tag <rollbackImage> <candidateImage> && docker compose ... up -d ...
```

That works because the images are **tag** references — retagging repoints the name the Compose override
pins. This specification requires **digest** references (§5.2), because a tag is mutable and the
preflight documentation already names mutable default tags as the hazard it exists to prevent.

`docker image tag` cannot assign a digest reference. So digest pinning changes the shape of the rollback
command, and the change is not free. Candidate approaches:

1. Emit a rollback override file pinning the rollback digests, and make rollback a second reviewed
   preflight run rather than a retag.
2. Keep a tag reference in the Compose override but require the manifest to carry the digest, and verify
   at preflight time that the tag currently resolves to it — weaker, because the tag can move between
   preflight and execution.
3. Pin digests directly in the generated override and accept that rollback needs its own generated
   override.

**Option 1 is the recommendation** — one mechanism, reviewable rollback, no time-of-check/time-of-use
window. It still needs an owner decision.

## 9. Required proofs

The preflight's own documentation sets the standard: prove the failure modes, not the happy path. Each
must produce `BLOCKED` — never `PASS`, never `ERROR`.

| # | Attack | Method |
|---|---|---|
| 1 | Tamper | flip one byte in any manifest field; the attestation subject digest must fail |
| 2 | Wrong target | valid manifest for server B presented for server A |
| 3 | Wrong environment | manifest says `staging`, compose resolves `beta` |
| 4 | MongoDB inclusion | `authorizedServices` contains a stateful service |
| 5 | Production hostname | a production destination appears in the resolved model |
| 6 | Stale candidate | `expiresAt` in the past, and separately a replayed `nonce` |
| 7 | Secret leak | a credential-shaped value in any manifest field |
| 8 | **Unbound artifact** | image whose `org.opencontainers.image.revision` ≠ `sourceCommit` |

Proof 8 is the one that exists in no form today, and it is the whole reason for Forge.

Four further cases test the separate-party property directly, and a design that passes 1–8 can still
fail these:

- **Wrong builder** — a valid attestation from a *different* workflow or repository must be rejected,
  not accepted because it verifies.
- **Self-hosted runner substitution** — a valid attestation whose `runnerEnvironment` differs from
  `builderRunnerEnvironment` must be rejected.
- **Missing owner authorization** — a fully attested manifest with no owner statement must be rejected.
  Provenance is not authorization.
- **Nested manifest** — a manifest containing any nested object must be rejected at schema level, so the
  §6.1 hazard cannot be reintroduced by a later schema edit.

## 10. What this specification does not authorize

Nothing here permits deployment, release publication, signing-key creation, flag changes, new public
ports, production data mutation, or DNS/Cloudflare changes. Those require separate, exact owner
authorization, unchanged.

Implementing the verifier does not make deployment authorized. It makes an unverifiable claim
verifiable. The operator approval gate, the owner authorization gate, and the frozen deployment posture
are all untouched.

## 11. Open questions

Two of the four original questions are now closed.

- ~~**Who is the verifier?**~~ **Closed by owner decision, 2026-09-01:** a separate party, not an
  OpsWorkbench component. Realized as §3.1 — Sigstore/Rekor for provenance, the owner's offline key for
  authorization.
- ~~**Where does Forge run, given CI key custody?**~~ **Closed as a consequence** — see §7.4. Keyless
  attestation means no key enters CI, so the constraint is satisfied rather than negotiated.

Still open:

1. **Rollback command shape** (§8.4) — option 1, 2, or 3. Recommendation: option 1.
2. **Is `targetServerId` knowable at build time?** If Forge builds before a target is chosen, the
   manifest splits into a build attestation and a target binding issued later. That is a larger design
   than this document assumes and should be settled before implementation rather than during it.
   Note that §3.1 makes this cheaper than it was: party A already binds source→artifact independently of
   any target, so a split is a matter of *when* the target fields are added, not of building a second
   trust mechanism.

## 12. Milestones

1. Owner resolves the two remaining questions in §11. **Blocking.**
2. `forge-deployment-v1` schema and ordered-join canonical digest land in `packages/shared`, with
   flatness enforced at schema level.
3. Verification module implementing the ten checks of §8.2, inert when no manifest is supplied.
4. The eight proofs of §9, plus the four separate-party tests.
5. Extend image builds to carry `org.opencontainers.image.revision` and their own attestation, closing
   limit 1 in §2.1.
6. Make `resolveBuildIdentity()` verify the attestation it currently ignores, closing limit 2 in §2.1
   (work-order item W2).
7. Independent review of the complete Forge → OpsWorkbench → Agent authority and evidence chain
   (work-order item W10). Not self-certified.
8. Only then: a decision about whether anything is deployed, made separately by the owner.
