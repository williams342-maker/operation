# Forge manifest specification — `forge-build-v1` + `forge-target-binding-v1`

**Status: DRAFT SPECIFICATION. No implementation exists.** This document defines a format and a
verification procedure. It authorizes nothing, deploys nothing, and adds no execution authority to any
component. Work-order item W5 in [handoff work order 2026-09-01](handoff-work-order-20260901.md).

**Two owner decisions, both 2026-09-01, are written into this document:**

1. **The verifier is a separate party, not an OpsWorkbench component.** §3 and §7. It also resolves
   where Forge may run and what key material it may hold (§7.4). Short version: Forge holds **no
   signing key at all**.
2. **`targetServerId` is not knowable at build time, so the manifest is split** into
   `forge-build-v1` and `forge-target-binding-v1` (§5). This fixed a design error, not only an
   ergonomic one — see §5.0.

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

1. ~~**It covers the release bundle, not the container images.**~~ **Being closed.** Both Dockerfiles
   now require a `SOURCE_COMMIT` build argument and stamp
   `org.opencontainers.image.revision` — the label the preflight already reads — plus the source tree,
   repository, tag, and creation time, on the **runtime** stage where the label survives. The argument
   is required rather than optional, because an optional provenance label is absent exactly when it
   matters. `.github/workflows/control-center-images.yml` builds and stamps the images and can publish
   and attest them, but is `workflow_dispatch`-only with `publish` defaulting to **false**: pushing an
   image and writing a transparency-log entry are outward, permanent acts and must not fire on a tag
   push.
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

### 5.0 Two documents, because a target is not knowable at build time

The first draft of this specification used one `forge-deployment-v1` manifest carrying source,
artifact, **and** target. The owner's decision that `targetServerId` is not knowable at build time
retires that shape — and doing so fixed a design error rather than merely an inconvenience.

**A single manifest forced Forge to assert a target.** That contradicts §3, which gives target identity
to OpsWorkbench, not to Forge. The one-document design quietly required the party with the least
authority over targets to name one.

| | `forge-build-v1` | `forge-target-binding-v1` |
|---|---|---|
| Says | what was built, from what source | which build goes to which target, until when |
| Produced by | **Forge**, at build time | **OpsWorkbench**, once a target exists |
| Authorized by | nobody — it is a statement of fact | **the owner's offline key** |
| Attested by | Sigstore/Rekor (party A) | — (it inherits the builds' provenance via digests) |
| Carries a target | **no** | yes |
| Expires | **no** | yes |
| Has a nonce | **no** | yes |

**A build carries no expiry and no nonce.** A build is a permanent fact: a six-month-old build is not
invalid. What must expire is the *authorization to deploy it*, which lives in the binding. Putting
expiry on the build would have conflated "this artifact exists" with "you may ship it now".

**Composing is not authorizing.** OpsWorkbench composes the binding because it owns target identity,
environment classification, and policy — but it cannot sign it. Only the owner's offline key can, which
keeps §3's property 2 intact across the split.

### 5.1 Shape

Both documents mirror `agent-upgrade-v1` (`packages/shared/src/agentUpgrades.ts`). **Every value is a
string, a number, or an array of strings.** No nested objects. §6 explains why that is a correctness
requirement rather than a style preference.

The owner authorization (§7.2) travels **alongside** the binding as a detached statement, not as a
nested field. This keeps the binding flat and keeps the signature outside the thing it signs — the
separation `privilegedActionDigest()` already makes by deleting `ownerAuthorization` before digesting.

### 5.2 `forge-build-v1`

| Field | Type | Binds |
|---|---|---|
| `schemaVersion` | literal `"forge-build-v1"` | format identity |
| `buildId` | `^[A-Za-z0-9._:-]{1,160}$` | this build |
| `sourceRepository` | HTTPS URL | which repository |
| `sourceCommit` | `^[0-9a-f]{40}$` | exact commit |
| `sourceTree` | `^[0-9a-f]{40}$` | exact tree — catches a rewritten commit (§5.3) |
| `sourceTag` | `^v.+`, optional | the reviewed release tag, when one exists |
| `backendImageDigest` | `…@sha256:[a-f0-9]{64}` | immutable backend image |
| `frontendImageDigest` | same | immutable frontend image |
| `releaseBundleSha256` | `^[a-f0-9]{64}$`, optional | the attested release bundle (§2.1) |
| `releaseManifestDigest` | `^[a-f0-9]{64}$`, optional | ties to `opsworkbench-release-v1` (§8.3) |
| `builderIdentity` | HTTPS URL | the OIDC workflow identity that must appear as the attestation's `builder.id` and certificate SAN |
| `builderRunnerEnvironment` | `^[a-z-]{1,40}$` | e.g. `github-hosted`; rejects a self-hosted runner substitution |
| `issuedAt` | RFC 3339 | when Forge built it |

No `signature` and no `verifierKeyId`: Forge signs nothing (§7.1). No target, no expiry, no nonce.

### 5.2.1 `forge-target-binding-v1`

| Field | Type | Binds |
|---|---|---|
| `schemaVersion` | literal `"forge-target-binding-v1"` | format identity |
| `bindingId` | safe id | this binding |
| `buildDigest` | `^[a-f0-9]{64}$` | **the join** — exactly one candidate build, by canonical digest |
| `rollbackBuildDigest` | `^[a-f0-9]{64}$` | exactly one prior build as the rollback |
| `targetEnvironment` | `^[a-z][a-z0-9-]{0,39}$` | exactly one environment |
| `targetOrgId` | 12–64 chars | exactly one organization |
| `targetServerId` | 12–64 chars | exactly one server |
| `composeProjectName` | `^[a-z0-9][a-z0-9_-]{0,62}$` | exactly one Compose project |
| `authorizedServices` | array, max 20 | exactly which services may be recreated |
| `requiredCapabilities` | array, max 100 | from the closed protocol enum (§5.4); target-dependent, so it lives here |
| `issuedAt` / `expiresAt` | RFC 3339 | the authorization window |
| `nonce` | 16–160 chars | replay marker |

### 5.2.2 Rollback is a build, not a string

`rollbackBuildDigest` names another **attested build**, and verification holds it to exactly the same
provenance standard as the candidate: same attestation check, same builder identity check, same runner
check, same commit check.

This is what finally makes *"is the rollback a real prior release?"* answerable. It also closes a case
the first draft left open: an unattested rollback is a fine way to deliver whatever you like, because
rollback is the path taken when something has already gone wrong and scrutiny is lowest.

A binding whose candidate and rollback are the same build is rejected — that makes rollback a no-op
that still reports success.

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

### 5.5 Both documents are value-free

No field may carry an environment value, a connection URI, a token, a key, or a password. Verification
rejects a document in which any field matches a credential-shaped pattern — a URI with embedded
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

**Both forge documents use the first pattern.** Each canonical statement is an explicit newline-joined
list of fields in a fixed documented order, exactly as `ownerAuthorizationMessage()` already does:

```js
["forge-build-v1", buildId, sourceRepository, sourceCommit, sourceTree, ...].join("
")
["forge-target-binding-v1", bindingId, buildDigest, rollbackBuildDigest, ...].join("
")
```

Each document has its **own** field order, and the order is part of the format: never reorder, never
remove, only append.

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
everywhere it is used today. It is a trap for any nested successor — and the split makes that risk concrete, because a binding
referencing a build is exactly the shape that invites nesting the build inside it. It does not: the
binding references the build by **digest**, so both documents stay flat. Flatness (§5.1) plus the
ordered-join digest removes the trap twice over.

## 7. Verification — the separate-party model

### 7.1 Forge holds no key

Forge does not sign. It emits the manifest as a **subject of a keyless build-provenance attestation**,
exactly as the release workflow already attests the release bundle (§2.1). The signing identity is the
ephemeral OIDC workflow identity; the evidence is a public Rekor transparency-log entry.

This is what makes property 2 of §3 structural rather than nominal. There is no Forge key to steal,
rotate, or misuse, and no key that both signs and verifies.

### 7.2 The two checks

**Party A — provenance.** Verify the attestation over **each build** — candidate and rollback alike —
against the repository, then require, for both:

- attestation `builder.id` and certificate SAN equal the manifest's `builderIdentity`;
- `sourceRepositoryDigest` and `resolvedDependencies[].digest.gitCommit` equal `sourceCommit`;
- `runnerEnvironment` equals `builderRunnerEnvironment`;
- the attestation subject digest equals the digest of the build manifest actually being read.

**Party B — authorization.** Require a detached `owner-authorization-v1`-shaped statement over the
**binding's** canonical digest, verified against an independently provisioned public key. Because the
binding digest covers both `buildDigest` and `rollbackBuildDigest`, one statement authorizes exactly one
build onto exactly one target with exactly one rollback, and cannot be transferred to another build or
replayed onto another target. Produced offline; the existing mechanism reused rather than reinvented.

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

Three new optional inputs — `forgeBuildPath`, `forgeRollbackBuildPath`, and `forgeTargetBindingPath`
(the owner authorization travels with the binding) — and one check group that runs **before** the
existing checks:

| Check | Rejects |
|---|---|
| `forge_build_schema` | malformed, wrong `schemaVersion`, unknown fields (strict), any nested object |
| `forge_build_attestation` | attestation absent, unverifiable, or not covering this build's digest — applied to **both** candidate and rollback |
| `forge_build_builder` | `builder.id` / SAN ≠ `builderIdentity`, or runner environment mismatch |
| `forge_binding_schema` | malformed binding, or candidate and rollback are the same build |
| `forge_binding_join` | `buildDigest` ≠ the candidate presented, or `rollbackBuildDigest` ≠ the rollback presented |
| `forge_binding_owner_authorization` | missing, expired, replayed nonce, or not verifiable against the provisioned owner public key |
| `forge_binding_target` | `targetEnvironment` ≠ resolved environment ≠ `APP_ENV`/`ENVIRONMENT`; or `composeProjectName`, `targetServerId`, `targetOrgId` mismatch |
| `forge_binding_images` | candidate images ≠ the candidate build's pinned digests |
| `forge_build_provenance` | `report.images[role].revision` (the OCI label the preflight already reads) ≠ the build's `sourceCommit` |
| `forge_binding_rollback_images` | rollback images ≠ the rollback build's pinned digests |
| `forge_binding_capabilities` | a capability outside the enum, or not advertised by the target agent |
| `forge_secrets` | any credential-shaped field value in either document (§5.5) |

When `forgeBuildPath` is absent the preflight behaves exactly as it does today. The change is inert
for current operators and gets adopted deliberately rather than by upgrade.

### 8.3 Relationship to `opsworkbench-release-v1`

Two manifests with different jobs; do not merge them.

- `opsworkbench-release-v1` (`scripts/build-release-artifacts.sh`) describes **what was built** — schema,
  tag, commit, artifact name, reproducibility. It is covered by the attestation of §2.1 and is what
  `resolveBuildIdentity()` reads at runtime.
- `forge-build-v1` describes **what Forge built** — source, tree, image digests, builder identity.
- `forge-target-binding-v1` describes **what may be deployed where, until when** — target, rollback
  build, capabilities, expiry, nonce.

The build manifest's `releaseManifestDigest` and `releaseBundleSha256` link it to the release manifest,
so a binding can be traced through its build to the exact attested release it deploys.

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

**Option 1 was chosen by the owner on 2026-09-01 and is implemented.** The preflight now emits a second
reviewed override pinning the rollback digests and selects it for rollback instead of retagging.
Retagging mutated a tag so an approved name resolved to different bytes — the very hazard this gate
exists to prevent — and left the host with a tag that no longer meant what it said.

Both overrides are held to identical rules: inside the Compose working directory, exclusive creation,
mode `0600`, never overwriting an existing path, distinct paths, and removed in the `finally` block. The
rollback override is a deployment input too, and a weaker rule on it would be the weakest link.

Rolling back is itself a deployment. The emitted rollback command is evidence for review, not an
approval; the reviewed way to obtain one is a second preflight run with the candidate and rollback roles
swapped.

## 9. Required proofs

The preflight's own documentation sets the standard: prove the failure modes, not the happy path. Each
must produce `BLOCKED` — never `PASS`, never `ERROR`.

| # | Attack | Method |
|---|---|---|
| 1 | Tamper | flip one byte in any build field; the attestation subject digest must fail |
| 2 | Wrong target | valid manifest for server B presented for server A |
| 3 | Wrong environment | manifest says `staging`, compose resolves `beta` |
| 4 | MongoDB inclusion | `authorizedServices` contains a stateful service |
| 5 | Production hostname | a production destination appears in the resolved model |
| 6 | Stale candidate | `expiresAt` in the past, and separately a replayed `nonce` |
| 7 | Secret leak | a credential-shaped value in either document |
| 8 | **Unbound artifact** | image whose `org.opencontainers.image.revision` ≠ `sourceCommit` |

Proof 8 is the one that exists in no form today, and it is the whole reason for Forge.

Four further cases test the separate-party property directly, and a design that passes 1–8 can still
fail these:

- **Wrong builder** — a valid attestation from a *different* workflow or repository must be rejected,
  not accepted because it verifies.
- **Self-hosted runner substitution** — a valid attestation whose `runnerEnvironment` differs from
  `builderRunnerEnvironment` must be rejected.
- **Missing owner authorization** — fully attested builds with a well-formed binding and no owner
  statement must be rejected. Provenance is not authorization.
- **Nested document** — either document containing a nested object must be rejected at schema level, so
  the §6.1 hazard cannot be reintroduced by a later schema edit.
- **Substituted build** — a binding presented with a build it does not name must be rejected, for the
  candidate and for the rollback independently.
- **Unattested rollback** — a rollback build without valid provenance must be rejected as firmly as an
  unattested candidate. Rollback is the path taken when something has already gone wrong and scrutiny
  is lowest.

## 10. What this specification does not authorize

Nothing here permits deployment, release publication, signing-key creation, flag changes, new public
ports, production data mutation, or DNS/Cloudflare changes. Those require separate, exact owner
authorization, unchanged.

Implementing the verifier does not make deployment authorized. It makes an unverifiable claim
verifiable. The operator approval gate, the owner authorization gate, and the frozen deployment posture
are all untouched.

## 11. Open questions

Three of the four original questions are now closed.

- ~~**Who is the verifier?**~~ **Closed by owner decision, 2026-09-01:** a separate party, not an
  OpsWorkbench component. Realized as §3.1 — Sigstore/Rekor for provenance, the owner's offline key for
  authorization.
- ~~**Where does Forge run, given CI key custody?**~~ **Closed as a consequence** — see §7.4. Keyless
  attestation means no key enters CI, so the constraint is satisfied rather than negotiated.
- ~~**Is `targetServerId` knowable at build time?**~~ **Closed by owner decision, 2026-09-01: no.**
  The manifest is split into `forge-build-v1` and `forge-target-binding-v1` — see §5.0.

- ~~**Rollback command shape.**~~ **Closed by owner decision, 2026-09-01: option 1**, and implemented —
  see §8.4.

**No open questions remain.** What is left is execution, review, and the owner's separate decision about
whether anything is deployed at all.

## 12. Milestones

1. ~~Owner resolves the blocking questions in §11.~~ Two of three closed; only the rollback command
   shape remains, and it does not block the schema.
2. ~~`forge-build-v1` / `forge-target-binding-v1` schemas and ordered-join canonical digests land in
   `packages/shared`, with flatness enforced at schema level.~~ **Done.**
3. ~~Verification module wired into the preflight as the check group of §8.2, inert when no build is
   supplied.~~ **Done.** Inert by default, partial evidence never passes, and the preflight hashes the
   evidence files itself rather than trusting a supplied digest. Note the ordering that still matters
   operationally: milestone 5 must be in place before this gate means anything, or
   `forge_build_provenance` has nothing to check against.
4. ~~The proofs of §9, plus the separate-party tests.~~ **Done at both layers.** The schema layer
   proves the documents; the preflight layer proves the documents against reality, including label
   absence, image substitution, partial evidence, and that verified evidence relaxes no existing rule.
5. ~~Extend image builds to carry `org.opencontainers.image.revision` and their own attestation.~~
   **Done for the label and the build path; the publish path is built but deliberately not enabled.**
   `forge_build_provenance` now has something real to check against. Note the label mechanism is
   verified by static assertion and by shell-level testing of the guard, **not** by an actual image
   build — that verification needs CI or a machine with a running Docker daemon.
6. Make `resolveBuildIdentity()` verify the attestation it currently ignores, closing limit 2 in §2.1
   (work-order item W2).
7. Independent review of the complete Forge → OpsWorkbench → Agent authority and evidence chain
   (work-order item W10). Not self-certified.
8. Only then: a decision about whether anything is deployed, made separately by the owner.
