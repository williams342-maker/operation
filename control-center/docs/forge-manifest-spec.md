# Forge manifest specification — `forge-deployment-v1`

**Status: DRAFT SPECIFICATION. No implementation exists.** This document defines a format and a
verification procedure. It authorizes nothing, deploys nothing, and adds no execution authority to any
component. Work-order item W5 in [handoff work order 2026-09-01](handoff-work-order-20260901.md).

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
| **Was this image built from reviewed source?** | **nobody** | **Forge manifest + verification** |
| **Is the rollback image a real prior release?** | **nobody** | **Forge manifest + verification** |
| **Has this authorization expired or been replayed?** | **nobody** | **Forge manifest + verification** |

## 3. Authority model

Unchanged from the packaged handoff brief, restated here because the manifest format only makes sense
against it.

- **Forge** may build, test, produce immutable artifacts, and emit a signed manifest describing what it
  built. It proposes.
- **OpsWorkbench** owns target identity, environment classification, policy, approval, preflight,
  capability checks, and audit. It decides.
- **The agent** executes only registered capabilities from the closed protocol enum. It acts.

Three properties are non-negotiable and every later design decision must preserve them:

1. **Forge must never deploy.** It has no target credentials, no agent channel, and no task-creation
   authority.
2. **Forge must never self-sign and self-trust.** A manifest Forge signed is *evidence*, not
   *authorization*. The verifying party must be a different party with independently provisioned trust
   material — the same discipline
   [agent-release-signing.md](agent-release-signing.md) already applies to release artifacts.
3. **A verified manifest is not an approval.** It changes a preflight `BLOCKED` into a preflight
   `PASS — awaiting operator approval`. That is all. The operator gate is untouched.

## 4. Non-goals

Stated explicitly because each is a plausible next step that would break the model:

- Forge does not gain a deployment task type. The protocol has ten task types
  (`agent.upgrade`, `check.http`, `check.mongo`, `collect.system`, `collect.telemetry`,
  `configuration.apply`, `configuration.rollback`, `inspect.compose`, `inspect.docker`, `inspect.git`)
  and this specification adds none.
- Forge does not hold, transport, or reference secret values. The manifest is value-free, like the
  preflight input.
- Forge does not become a generic remote build-and-ship service, a remote shell, or a path to arbitrary
  commands, arguments, service names, or install paths.
- Forge does not replace or relax the preflight. It adds an input to it.

## 5. Manifest format

### 5.1 Shape

`forge-deployment-v1` deliberately mirrors `agent-upgrade-v1`
(`packages/shared/src/agentUpgrades.ts`), which already solves the same problem for agent upgrades:
bind identity, target, artifact digest, signature, required capabilities, expiry, and nonce into one
strict, flat, digestible object.

**The manifest MUST be flat.** Every value is a string, a number, or an array of strings. This is a
correctness requirement, not a style preference — see §6.

### 5.2 Fields

| Field | Type | Binds |
|---|---|---|
| `schemaVersion` | literal `"forge-deployment-v1"` | format identity |
| `manifestId` | `^[A-Za-z0-9._:-]{1,160}$` | this manifest |
| **Source** | | |
| `sourceRepository` | HTTPS URL | which repository |
| `sourceCommit` | `^[0-9a-f]{40}$` | exact commit |
| `sourceTree` | `^[0-9a-f]{40}$` | exact tree — catches a commit whose content was rewritten |
| `sourceTag` | `^v.+` , optional | the reviewed release tag, when one exists |
| **Artifact** | | |
| `backendImageDigest` | `^[a-z0-9.\-_/]+@sha256:[a-f0-9]{64}$` | immutable backend image |
| `frontendImageDigest` | same | immutable frontend image |
| `artifactSha256` | `^[a-f0-9]{64}$`, optional | the release bundle, when one is shipped |
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
| **Authority** | | |
| `requiredCapabilities` | array, max 100 | drawn from the closed protocol enum (§5.4) |
| `builderId` | safe id | which Forge instance built this |
| `verifierKeyId` | `^ed25519-[a-f0-9]{24}$` | which key must verify — the identifier convention from [agent-release-signing.md](agent-release-signing.md) |
| `signature` | 80–1000 chars | Ed25519 detached signature over the canonical digest |
| **Freshness** | | |
| `issuedAt` | RFC 3339 | when Forge built it |
| `expiresAt` | RFC 3339 | when it stops being usable |
| `nonce` | 16–160 chars | replay marker |

### 5.3 Why `sourceTree` as well as `sourceCommit`

A commit hash binds a commit *object*. Two commits can carry the same tree, and a rewritten history can
reuse a message and author while carrying a different tree. Binding both makes the manifest survive
history rewriting, and it costs one `git rev-parse <ref>^{tree}`.

This repository has already been bitten by the weaker form. `16e14682` was a commit string that
production reported and that exists in no object database — see
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
agent does not advertise is rejected. Neither the manifest nor Forge may introduce a new capability
name; extending the enum is a reviewed protocol change.

### 5.5 The manifest is value-free

No field may carry an environment value, a connection URI, a token, a key, or a password. Verification
rejects a manifest in which any field matches a credential-shaped pattern — a URI with embedded
userinfo, a `sk_live_` prefix, a PEM header, or a long high-entropy opaque string in a field not typed
as a digest. This mirrors the existing rule for the preflight input JSON, which already forbids
environment values, database URIs, and credentials.

## 6. Canonicalization — a hazard to avoid

The repository's existing convention, from `agentUpgrades.ts`:

```js
JSON.stringify(input, Object.keys(input).sort())
```

then SHA-256 over the result. `agent-upgrade-v1` is entirely flat, so this is correct there.

**It would be silently wrong for a nested manifest.** In `JSON.stringify(value, replacer)` the
array-form replacer is an allowlist applied to **every object in the graph**, not only the top level.
A nested object's keys that do not happen to appear in the top-level key list are **dropped from the
serialization without error**.

Demonstrated, not assumed:

```js
const a = { schemaVersion: "x", target: { env: "beta", server: "AAA" } };
const b = { schemaVersion: "x", target: { env: "beta", server: "BBB" } };
const keys = Object.keys(a).sort();          // ["schemaVersion","target"]

JSON.stringify(a, keys)   // {"schemaVersion":"x","target":{}}
JSON.stringify(b, keys)   // {"schemaVersion":"x","target":{}}   <-- identical
```

Two manifests authorizing deployment to **different servers** serialize identically and therefore
digest identically. A signature over the first validates the second. That is a signature bypass in the
exact place it does the most damage, and it fails silently — no error, no warning, just a matching
digest.

Two acceptable resolutions. This specification takes the first:

1. **Keep the manifest flat** (§5.1). The existing idiom is then provably correct, the digest stays
   reviewable by eye, and no new canonicalization code carries new risk. Arrays are normalized by
   sorting explicitly before serialization, as `agentReleaseManifestDigest` already does with
   `[...release.requiredCapabilities].sort()`.
2. Define an explicit recursive canonicalization (sorted keys at every depth, no replacer array) and
   test it against nested-key-dropping directly.

Do not adopt the existing idiom for a nested structure without doing (2).

**Canonical digest:**

```
forgeManifestDigest(m) = sha256(JSON.stringify(m_without_signature,
                                Object.keys(m_without_signature).sort()))
```

The `signature` field is excluded from the object it signs — the same separation
`privilegedActionDigest()` already makes in `ownerAuthorization.ts`, where the owner-authorization
signature is removed before digesting so that the signature is never inside the digest it covers.

## 7. Signing and verification

- Forge signs the canonical digest with Ed25519. Key custody follows
  [agent-release-signing.md](agent-release-signing.md) without exception: the private key is an
  owner-controlled offline secret and never enters this repository, CI variables, the control-center
  database, artifact storage, or a target server.
- Key identifier convention is reused verbatim: `ed25519-` followed by the first 24 hex characters of
  the SHA-256 digest of the DER-encoded SPKI public key.
- The verifier trusts only an **out-of-band provisioned** public key. A public key shipped beside the
  manifest is informational and must itself be checked against already-trusted material — the rule
  bootstrap already follows.
- **Signature validity is not authorization.** A correctly signed manifest from an untrusted or
  unexpected `verifierKeyId` is rejected. A correctly signed, correctly keyed manifest still only
  reaches `PASS — awaiting operator approval`.

## 8. Integration with the beta preflight

### 8.1 What must not change

The preflight's existing behavior is the safety property. Integration must leave all of it intact:
`PASS` still means "awaiting operator approval"; the CLI still never runs `up`, `create`, `start`,
`restart`, `build`, `pull`, or any volume-changing operation; the `0600` override is still exactly two
fields; existing paths are still never overwritten; temporary files are still removed in a `finally`
block and a cleanup failure still prevents approval.

### 8.2 What is added

One new optional input field, `forgeManifestPath`, and one new check group that runs **before** the
existing checks:

| Check | Rejects |
|---|---|
| `forge_manifest_schema` | malformed, wrong `schemaVersion`, unknown fields (strict) |
| `forge_manifest_signature` | bad signature, untrusted or unexpected `verifierKeyId` |
| `forge_manifest_freshness` | `expiresAt` in the past, or a `nonce` already recorded |
| `forge_manifest_target` | `targetEnvironment` ≠ resolved environment ≠ `APP_ENV`/`ENVIRONMENT`; or `composeProjectName`, `targetServerId`, `targetOrgId` mismatch |
| `forge_manifest_images` | candidate images not equal to the manifest's pinned digests |
| `forge_manifest_provenance` | `report.images[role].revision` (the OCI `org.opencontainers.image.revision` label the preflight already reads) ≠ `sourceCommit` |
| `forge_manifest_rollback` | rollback images not equal to the manifest's pinned rollback digests |
| `forge_manifest_capabilities` | a capability outside the enum, or not advertised by the target agent |
| `forge_manifest_secrets` | any credential-shaped field value (§5.5) |

When `forgeManifestPath` is absent, the preflight behaves exactly as it does today. This keeps the
change inert for current operators and lets manifest verification be adopted deliberately rather than
by upgrade.

### 8.3 Relationship to `opsworkbench-release-v1`

Two manifests with different jobs, and they should not be merged:

- `opsworkbench-release-v1` (`scripts/build-release-artifacts.sh`) describes **what was built** —
  schema, tag, commit, artifact name, reproducibility. It is covered by GitHub keyless build-provenance
  attestation and is what `resolveBuildIdentity()` reads at runtime.
- `forge-deployment-v1` describes **what may be deployed where, by whom, until when**. It adds target,
  rollback, capabilities, expiry, nonce, and verifier.

`releaseManifestDigest` links the second to the first, so a deployment manifest can point at the exact
attested build it deploys.

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

**Option 1 is the recommendation** — it keeps one mechanism, keeps rollback reviewable, and avoids a
time-of-check/time-of-use window. It needs a decision before implementation, and it is the main reason
this document is a specification rather than a patch.

## 9. Required proofs

The preflight's own documentation sets the standard: prove the failure modes, not the happy path. The
following must each be demonstrated by test before any Forge integration is considered complete. Every
one of them must produce `BLOCKED` — never `PASS`, never `ERROR`.

| # | Attack | Method |
|---|---|---|
| 1 | Tamper | flip one byte in any manifest field; digest and signature must fail |
| 2 | Wrong target | valid manifest for server B presented for server A |
| 3 | Wrong environment | manifest says `staging`, compose resolves `beta` |
| 4 | MongoDB inclusion | `authorizedServices` contains a stateful service |
| 5 | Production hostname | a production destination appears in the resolved model |
| 6 | Stale candidate | `expiresAt` in the past, and separately a replayed `nonce` |
| 7 | Secret leak | a credential-shaped value in any manifest field |
| 8 | **Unbound artifact** | image whose `org.opencontainers.image.revision` ≠ `sourceCommit` |

Proof 8 is the one that does not exist in any form today, and it is the whole reason for Forge.

Two further cases deserve explicit tests because they are the ones a careless implementation gets wrong:

- **Nested-key dropping** (§6) — if a nested manifest is ever adopted, prove two manifests differing
  only in nested content produce different digests.
- **Self-signed manifest** — a manifest signed by a key Forge generated for itself must be rejected, not
  accepted because the signature is internally consistent.

## 10. What this specification does not authorize

Nothing here permits deployment, release publication, signing-key creation, flag changes, new public
ports, production data mutation, or DNS/Cloudflare changes. Those require separate, exact owner
authorization, unchanged.

Implementing the manifest verifier does not make deployment authorized. It makes an unverifiable claim
verifiable. The operator approval gate, the owner authorization gate, and the frozen deployment posture
are all untouched.

## 11. Open questions for the owner

1. **Rollback command shape** (§8.4) — option 1, 2, or 3.
2. **Where does Forge run?** Nothing in this specification assumes a location. If Forge runs in GitHub
   Actions, its signing key custody must be reconciled with "the private key never enters CI
   variables" — which as written forbids the obvious implementation.
3. **Who is the verifier?** Property 2 in §3 requires the verifier to be a different party from the
   signer. If both are OpsWorkbench components, that separation is nominal. Naming a real second party
   is a prerequisite, not a detail.
4. **Is `targetServerId` knowable at build time?** If Forge builds before a target is chosen, the
   manifest splits into a build attestation and a target binding issued later. That is a larger design
   than this document assumes, and it should be settled before implementation rather than during it.

## 12. Milestones

1. Owner resolves §11. **Blocking.**
2. `forge-deployment-v1` schema and canonical digest land in `packages/shared`, with the flatness
   requirement enforced by the type and the nested-key hazard covered by test.
3. Verification module with the nine checks of §8.2, defaulting to inert when no manifest is supplied.
4. The eight proofs of §9, plus the two implementation-hazard tests.
5. Independent review of the complete Forge → OpsWorkbench → Agent authority and evidence chain
   (work-order item W10). Not self-certified.
6. Only then: a decision about whether anything is deployed, made separately by the owner.
