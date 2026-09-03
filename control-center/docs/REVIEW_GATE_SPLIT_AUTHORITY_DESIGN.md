# Split authority: `bindingPrincipalId` and `audiencePrincipalId`

**Date:** 2026-09-02
**Author:** Claude
**Revision:** v2, after design review round 1 (**NEEDS-REVISION**, 8 findings, 4 HIGH).
**Status:** **DESIGN, FOR REVIEW BEFORE ANY CODE.** The owner chose option (b) from
`REVIEW_GATE_DISPATCH_GAP.md`.

> **Why a design round rather than building it.** The last three NO-GOs in this workstream were design
> errors that survived code review. Round 1 of *this* review returned four HIGH findings, at least two of
> which would have shipped as defects had I started from the code — the `mayActOn` one is not
> implementable as I wrote it, and renewal becomes unowned after acquire.

---

## 0. What review round 1 changed

| # | finding | what I had written | what is true |
|---|---|---|---|
| 1 | HIGH | assigned `reserve` to the binder and left it there | reserve needs its own transactional contract; the store's `reserveAttestation` never proves `acting === lease.holderPrincipalId` — it compares the *audience* to a caller-supplied lease (**verified**) |
| 2 | HIGH | `executionAuthority` calls `acting.mayActOn(orgId, serverId)` | **not implementable** — at the store layer `acting` is `{principalId, credentialEpoch}` with no such method. The principal row must be loaded *inside* the transaction, or provisioning changes are a TOCTOU gap |
| 3 | HIGH | "the provisioner gains NO new content authority" | overclaim. It gains authority to *propose* execution semantics the subject does not pin; my field list was incomplete, wrong on one entry, and omitted agent-upgrade entirely |
| 4 | HIGH | renewal belongs to the binder | renewal is legal only in `RESERVED_UNBOUND`/`RESERVED_BOUND`, so after acquire **nobody** can extend a lease. A long action cannot redeem and becomes `INDETERMINATE` |
| 5 | MED | binder rotation invalidating execution has "no security gain" | overclaim. It has value as incident response; the choice is availability over automatic taint propagation, and disablement semantics must be defined separately |
| 6 | MED | "nothing to migrate" | unsupported — the repository cannot establish that deployed databases are empty, and audit records are not disposable. The digest change needs a version marker, not a silent field addition |
| 7 | MED | "not new, just attributable" | conditionally true, not categorical: a separately deployable credential *transfers* proposal authority to whoever holds it |
| 8 | MED | assigned reserve/bind/renew/acquire/redeem | the matrix must also cover both mint paths, the sweep, provisioning operations, and the reconciliation evidence path |

---

## 1. What was chosen

A **provisioning principal** reserves and binds. The **executor** acquires and redeems. The offline owner
signature is unchanged and still independently required. This resolves the circularity because the binder
can hold the prospective payload — it is the party constructing it — while the executor is no longer
required to bind one before it can receive it.

## 2. The complete authority matrix

| operation | actor | how established |
|---|---|---|
| mint (owner decision) | **owner** | role check |
| mint further, from released content | **owner** | role check |
| **reserve** | **binder** | §3 |
| **bind** | **binder**, as lease holder | §4 |
| **renew, before acquire** | **binder**, as lease holder | §4 |
| **renew, while `EXECUTING`** | **executor** | §5 — new, see below |
| **acquire** | **executor** (audience) | §4 |
| **redeem** | **executor** (audience) | §4 |
| revoke | **owner** | role check, unchanged |
| resolve indeterminate | **owner** | role check, unchanged (but see §8) |
| expiry sweep | **system scheduler**, no principal | unchanged |
| create/rotate/disable principals, assign target scope | **provisioning operator**, out of band | `operator.ts`, unchanged |
| produce reconciliation evidence | **executor**, via its durable journal | unchanged |

Both `bindingPrincipalId` and `audiencePrincipalId` are set at mint by the owner and immutable.

## 3. Reserve — its own transactional contract

Reserve is where binder authority is established, and today the store does not enforce that it is anyone
in particular. `reserveAttestation` checks `record.audiencePrincipalId !== input.lease.holderPrincipalId`
against a **caller-supplied** lease and never compares either to `acting.principalId` (verified in
`memoryStore.ts`). The service happens to construct them consistently; the store's named operation does
not require it. That is tolerable today only because the service is the sole caller — and under this
design the store operation becomes the place binder authority lives.

**Enforced inside the reserve transaction, in both stores:**

1. `#credentialCurrent(acting)` — current, not disabled *(exists)*
2. attestation is `PENDING` and unexpired
3. the released claim remains authorizable *(exists)*
4. `acting.principalId === record.bindingPrincipalId` **(new)**
5. `lease.holderPrincipalId === acting.principalId` **(new — closes the caller-supplied-lease gap)**
6. `lease.credentialEpoch === acting.credentialEpoch` **(new)**
7. the binder is currently provisioned for `record.orgId` / `record.serverId` **(new — see below)**
8. lease expiry bounded by attestation expiry *(exists)*

**On (7):** the reviewer recommended requiring target provisioning for the binder, and I agree. Without
it, owner assignment alone would let a principal outside its provisioned scope construct host-specific
payloads. It costs nothing — the binder must be provisioned somewhere, and this makes "for which hosts"
explicit.

## 4. Two named predicates, and what they are *not*

`#leaseHeld` bundles five checks that are two authorities: three about the lease (exists, id matches, not
expired) and two about who took it (holder, lease epoch). Acquire and redeem need the former and must not
use the latter, because the actor is deliberately not the holder.

**`bindingAuthority(record, acting, leaseId, now)`** — all five, as today. Used by `bind` and pre-acquire
`renew`.

**`executionAuthority(record, acting, leaseId, now)`** — lease exists, `lease.leaseId === leaseId`, lease
live, **`record.audiencePrincipalId === acting.principalId`**, and the acting principal's **current** row
shows it provisioned for `record.orgId`/`record.serverId`. Deliberately **not** holder, **not** lease
epoch.

Two corrections from review round 1:

- **The principal row is loaded inside the transaction.** I wrote `acting.mayActOn(...)`; that method
  belongs to `AuthenticatedPrincipal`, which lives above the store, while `acting` is
  `{principalId, credentialEpoch}`. Checking scope only before entering the store is a TOCTOU gap against
  a provisioning change. The store must read the current row in the same transaction as the mutation —
  which is the rule `store.ts` already states for credential epoch.
- **These predicates are not the whole authorization decision.** Acquire and redeem keep every surrounding
  check unchanged: expected state, attestation expiry, `actionDigest` match, target match, kind match,
  released claim, and acquire's atomic `RESERVED_BOUND → EXECUTING` transition. Naming the predicate must
  not invite anyone to read it as sufficient.

A second executor cannot win acquire, because of that atomic transition. Multiple processes sharing one
audience credential are **one security principal**; this design does not distinguish instances, and that
is intentional.

## 5. Renewal after acquire — a hole the split exposes

Renewal is legal only in `RESERVED_UNBOUND` and `RESERVED_BOUND`. Once acquire moves the record to
`EXECUTING`, **no actor can extend the lease.** With the current 15-minute maximum, an action that outruns
the remaining window cannot redeem and becomes `INDETERMINATE` — needing an owner-authorized
reconciliation for a deployment that simply took a while.

The split does not create this, but it is now unavoidable to decide it.

**Proposed: the executor may renew while `EXECUTING`, under `executionAuthority`.** Of the three options,
the alternatives are worse: requiring every action to finish inside the binding lease makes lease length a
deployment timeout chosen by the wrong party, and letting the *binder* renew during execution puts a
non-executing principal in control of a live attempt — which is the authority separation this whole design
exists to create.

**Open:** whether renewal while `EXECUTING` should be bounded differently (a shorter, repeatable extension
that requires the executor to still be alive) rather than reusing the binding lease's maximum.

## 6. What the provisioner gains — corrected

My round-1 statement, "no new content authority", was an overclaim. The corrected claim:

> The provisioner gains **no authority to alter the review-pinned subject** — the configuration mutation
> identity and reviewed environment/profile, or the upgrade artifact and release-manifest digests. It
> **does** choose other execution parameters, subject to schema validation, the owner's signature,
> executor-side enforcement, and any layer-2 policy. It also gains **availability and allocation**
> authority: it can reserve, bind, exhaust or strand attestations, and a bound attestation cannot be
> re-bound.

**What layer 3 pins, exhaustively.** Configuration: the mutation set (via `configurationChangeDigest`),
`environmentId`, `targetProfileId`, `targetProfileRevision`; plus `kind`, `contentDigest`, `orgId`,
`serverId` fixed at mint. Agent upgrade: **only** `artifactSha256` and `releaseManifestDigest`.

**What it does not pin.** Configuration: `repositoryRoot`, `environmentFilePath`, `composePath`,
`composeProject`, `statelessServices`, `protectedServices`, `healthChecks`, `expectedConfigurationDigest`,
`expectedActiveDeploymentId`, `planId`, `planRevision`, `deploymentId`, `environmentKind`, `protected`,
and the sealed value material. Agent upgrade: manifest `serverId`, expected agent id / current version /
current binary, target version, release id, `planDigest`, OS, architecture, package type, required
capabilities, manifest expiry and nonce, artifact signature and key id.

*(Round-1 errors: I omitted `planRevision`, `expectedActiveDeploymentId`, `environmentKind`, `protected`
and the sealed material; I listed `automaticRollback`, which is schema-pinned to literal `true`; and I
omitted the agent-upgrade side entirely.)*

**Also corrected:** I wrote that "only the owner's signature constrains them". It does not stand alone —
the strict payload schemas and the executor's own path and service protections constrain them too. The
owner's signature authenticates *approval of an exact payload*; it does not judge whether the values are
safe.

## 7. Residual trust — the missing entry

§3.1 covers sealed *values* but not the structural fields above. Proposed entry:

> **The payload fields the reviewed subject does not pin** — for configuration, host-local paths, compose
> project, service lists, health checks and expected-state digests; for agent upgrade, everything except
> the artifact and release-manifest digests. The gate binds *which* reviewed change is applied and *where
> in the estate*; it does not bind *where on the host* or the surrounding execution parameters. These are
> constrained by schema validation, the owner's signature, and executor-side protections — not by review.

**On "not new":** fair at the system level *only* if the provisioner is the same trusted control-center
code that already constructs these values. It is not categorical. A separately deployable provisioning
credential **transfers** that proposal authority to whoever holds it, and widens the population that can
exercise it. Naming `bindingPrincipalId` improves attribution only if bind events are **durably audited**
with acting principal, credential epoch, action digest and time — otherwise the field records an
assignment, not a fact about who chose the payload. The honest phrasing is *existing discretion made
explicit and potentially delegated*, not "no new exposure".

## 8. Rotation, disablement and incident response

**Ordinary binder rotation after a completed bind does not invalidate execution.** Outcome unchanged from
round 1; the *reasoning* was wrong. I wrote that invalidation has "no security gain". It does have one —
when rotation is incident response, invalidating limits use of bindings possibly produced with a
compromised credential. This design chooses **availability and owner approval over automatic taint
propagation**, which is a trade, not an absence of cost.

Consequences that must therefore be specified rather than implied:

- rotation or disablement **before** bind or renew is blocked by current-credential enforcement (exists);
- rotation or disablement **after** bind leaves already-bound attestations executable;
- therefore **incident response must enumerate and explicitly revoke** outstanding bindings — which
  requires the store to be queryable by binder and by lease holder, and the Mongo indexes to support it;
- owner revocation must remain linearizable against acquire (exists — revoke is illegal from `EXECUTING`).

**Also, independent of this design:** `reconciliation.resolvedByPrincipalId` is caller-supplied and never
compared to the acting owner (verified — the identifier appears only in the schema). A document claiming
improved attribution should not leave that unnamed. It should be set from the authenticated principal, not
accepted from the caller.

## 9. Identity digest and compatibility

`bindingPrincipalId` belongs in `attestationIdentityDigest`: without it, two attestations assigning
different binding authority have the same claimed immutable identity.

**It must not be added under the existing `attestation-v1|` domain marker.** The same v1 record would
then digest differently depending on software version. Use `attestation-v2`, or store an explicit
identity-schema version.

**Required at mint, never defaulted to `audiencePrincipalId`** — that default reproduces exactly the
unexecutable protocol this design exists to fix.

**Legacy records need an explicit policy, and "nothing to migrate" was unsupported.** I cannot establish
from the repository that any deployed database is empty, and records that cannot execute are still audit
and provenance. Proposed: legacy attestations are **rejected for new execution** and **retain v1 digest
semantics for audit**, with any conversion being an explicit owner-approved migration.

## 10. Surfaces this must travel through

Recorded because round 1 found the document discussed the record and the predicates but not the rest:
both mint APIs and their route schemas, the operator tooling that provisions binder principals, the store
port and both implementations, Mongo indexes and queryability by binder, the client contracts, and the
audit events for bind.

## 11. The activation gate

The choreography test from `REVIEW_GATE_DISPATCH_GAP.md` becomes writable under this design and **must
pass before any executor is activated**: only exposed APIs and clients, no direct `AttestationService`
calls, no store mutation, no authenticating as an arbitrary principal. Every existing test breaks that
last rule in setup, which is why they were green while the protocol could not execute.

## 12. What this design still does NOT decide

- **Whether the human stays in the critical path.** Under layer 2 unchanged, the owner signs after the
  lease ids exist, in **every** option. Removing that needs scoped standing or batch authorization — a
  separate, larger trust-model change.
- **Who runs the provisioner** — a control-center component, a separate service, or an operator tool. §7
  shows this is not merely operational: a separately deployable credential widens who holds proposal
  authority, so the answer changes the threat model.

## 13. Questions for review round 2

1. §5 — is executor-renewal-while-`EXECUTING` right, and should it be a distinct bounded extension rather
   than the binding lease's maximum?
2. §3 item 7 — requiring the binder to be target-provisioned: any reason not to?
3. §8 — is "rotation does not invalidate, but incident response must enumerate and revoke" sufficient, or
   does disablement need to differ from rotation?
4. §9 — is reject-for-execution plus v1-digest-for-audit the right legacy policy?
5. Is the corrected §6 statement now complete, or is there a further field class I have missed?
