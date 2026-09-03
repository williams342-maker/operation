# Split authority: `bindingPrincipalId` and `audiencePrincipalId`

**Date:** 2026-09-02
**Author:** Claude
**Revision:** v3, after design review rounds 1 (8 findings, 4 HIGH) and 2 (5 findings, 3 HIGH).
**Status:** **DESIGN, FOR REVIEW BEFORE ANY CODE.** The owner chose option (b) from
`REVIEW_GATE_DISPATCH_GAP.md`.

> **Why a design round rather than building it.** The last three NO-GOs in this workstream were design
> errors that survived code review. Two design rounds have now returned seven HIGH findings, several of
> which would have shipped had I started from the code — `mayActOn` is not implementable as I wrote it,
> renewal becomes unowned after acquire, and my proposed disablement behaviour would have silently
> reversed a security property the operator tool already promises.
>
> **Round 2 also found two defects in the already-certified gate**, neither introduced by this design. See
> §13.

---

## 0. What each review round changed

### Round 1 — 8 findings, 4 HIGH

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

### Round 2 — 5 findings, 3 HIGH

| # | finding | what I had written | what is true |
|---|---|---|---|
| 1 | HIGH | "kind match" checks remain, so the operation is pinned | **the execution VERB is not pinned at all.** `validatePayload` never compares `kind` to `payload.action`, so a rollback payload binds to an apply attestation. A defect in the certified gate — §13.1 |
| 2 | HIGH | disablement handled by enumerate-and-revoke | that **silently reverses** a property `operator.ts` already promises, and is a race with no single authority and no completion guarantee. Disablement must differ from rotation, atomically — §8 |
| 3 | HIGH | the executor renews while `EXECUTING` under `executionAuthority` | that proves credential possession, not that the winning attempt is alive — the lease id is *in the signed payload*. Acquire must mint an attempt-specific capability — §5 |
| 4 | MED | an "exhaustive" pinned/not-pinned list | still incomplete, and "pinned" was hiding three mechanisms. Now five categories, adding `rollbackTarget` identity, `action`, `upgradeId`, `encryptedValues`/`sealedValues`, and transitive digest coverage — §6 |
| 5 | MED | reject v1 for execution, keep v1 digests for audit | right policy, **no executable discriminator** — the record has no identity-schema field — §9 |

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
payloads.

*(Corrected: I wrote "it costs nothing". It does cost something — provisioning and availability coupling.
A binder that is not provisioned for a target cannot bind for it, so scope changes become a way to break
deployment. That is the right trade, but it is a trade.)*

**Naming:** the target-scope field is called `audienceFor`, which made sense when only the audience used
it. Both principals now do. It should be renamed to something neutral, and that rename is part of the
implementation candidate rather than a follow-up.

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

**The executor may extend while `EXECUTING` — but NOT by reusing the lease renewal.** The authority
assignment was right in v2; reusing the pre-acquire operation was not. The two renewals assert different
things:

- pre-acquire renewal preserves the **binder's** allocation and binding window;
- execution extension asserts that **the acquired attempt is still running**.

Under v2's `executionAuthority`, any process holding the shared audience credential and the lease id —
which is *in the signed payload*, so it is not a secret — could extend. That proves credential possession,
not that the winning attempt is alive. The design already treats all processes sharing an audience
credential as one principal, so nothing there distinguishes the winner.

**A distinct execution-extension contract:**

1. **Acquire atomically stamps an execution attempt**: an attempt identifier generated by the gate, plus
   the executing principal and its credential epoch. This is the exclusive capability the lease id is not.
2. **Extension requires**: state `EXECUTING`; that attempt identifier; current audience credential;
   current target provisioning; live attestation; released claim still authorizable.
3. **It must occur before the current execution deadline** — an expired attempt does not extend, it
   reconciles.
4. **Deadlines are monotonic.** An extension may only move the deadline later. (§14.2: the existing
   renewal does not have this property.)
5. **Each extension is short and bounded**, against an absolute cumulative execution deadline. The
   alternative — repeat until attestation expiry — must be an explicit choice, not a default.
6. **Redeem uses the attempt identity and execution deadline**, not binder-holder semantics.
7. **Executor rotation or disablement during an attempt** must have defined behaviour — see §8.

Honest limit: an authenticated extension establishes *principal-level* liveness. Process-instance liveness
is only established because acquire mints an attempt-specific capability; without step 1 the whole
mechanism proves nothing beyond possession of a credential and a public identifier.

## 6. What the provisioner gains — corrected

My round-1 statement, "no new content authority", was an overclaim. The corrected claim:

> The provisioner gains **no authority to alter the review-pinned subject** — the configuration mutation
> identity and reviewed environment/profile, or the upgrade artifact and release-manifest digests. It
> **does** choose other execution parameters, subject to schema validation, the owner's signature,
> executor-side enforcement, and any layer-2 policy. It also gains **availability and allocation**
> authority: it can reserve, bind, exhaust or strand attestations, and a bound attestation cannot be
> re-bound.

**The inventory, in five categories.** Round 2 found my flat pinned/not-pinned split both incomplete and
misleading, because "pinned" was hiding three different mechanisms. Categorised:

**(1) Directly compared payload fields.** Configuration: the mutation set, via
`configurationChangeDigest(mutations)`; `environmentId`; `targetProfileId`; `targetProfileRevision`.
Agent upgrade: `artifactSha256`; `releaseManifestDigest`.

**(2) Transitively committed inside a reviewed digest.** `releaseManifestDigest` commits everything
`agentReleaseManifestDigest` covers — artifact URL, size, signature and key, supported platforms,
capabilities, upgrade/rollback compatibility, classification. Saying "only two things are pinned" for
agent upgrade obscured this. **Note the trap:** similarly *named* payload fields remain independently
selectable; commitment inside the manifest digest does not constrain the payload field of the same name.

**(3) Fixed at mint by the owner.** `kind`, `contentDigest`, `orgId`, `serverId`,
`targetEnvironmentClass`, `audiencePrincipalId`, `bindingPrincipalId`, `nonce`, `expiresAt`. For a
rollback subject, the canonical subject also carries `rollbackTarget.candidateId` and
`rollbackTarget.contentDigest`.

**(4) Schema literals and generated identifiers.** `automaticRollback` is pinned by the schema to literal
`true`. `reviewAuthorization.attestationId`/`leaseId` must equal the request's.

**(5) Binder-selectable.** Configuration: `repositoryRoot`, `environmentFilePath`, `composePath`,
`composeProject`, `statelessServices`, `protectedServices`, `healthChecks`, `expectedConfigurationDigest`,
`expectedActiveDeploymentId`, `planId`, `planRevision`, `deploymentId`, `environmentKind`, `protected`,
**`action`** (see §13.1), and both `encryptedValues` and `sealedValues`. Agent upgrade: `upgradeId`,
manifest `serverId`, expected agent id / current version / current binary, target version, release id,
`planDigest`, OS, architecture, package type, required capabilities, manifest expiry and nonce, artifact
signature and key id.

*(Cumulative corrections: round 1 — omitted `planRevision`, `expectedActiveDeploymentId`,
`environmentKind`, `protected` and sealed material; wrongly listed `automaticRollback`; omitted agent
upgrade entirely. Round 2 — omitted `rollbackTarget` identity, `action`, `upgradeId`, the
`encryptedValues`/`sealedValues` distinction, and the whole transitive category.)*

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

**Disablement is NOT the same as rotation, and v2 got this wrong in a way that would have silently removed
a property the system already promises.** `operator.ts` states that disabling a principal invalidates its
outstanding leases. Under the split, acquire deliberately ignores the binder's epoch — so disabling the
binder would no longer produce that result, and v2's "enumerate and revoke" is not equivalent:

- **acquire can win between enumeration and revocation** — a race, not a gap in diligence;
- the **provisioning operator** who disables is not the **owner** who may revoke — two authorities, no
  single atomic one;
- once acquire has won, **revocation is deliberately illegal**, so the window cannot be closed afterwards;
- so it has neither one authority nor a completion guarantee. A runbook is not a mechanism.

**Specified instead:**

- **ordinary rotation** may preserve completed bindings (the availability trade above);
- **binder disablement must atomically taint or invalidate all of that binder's non-`EXECUTING`
  attestations**, in the same transaction as the disable;
- **`EXECUTING` records must not be made `REVOKED`** — that would claim an effect was stopped which may
  already have happened. Either leave them executing and mark them for incident reconciliation, or define
  a distinct incident state that does not assert the effect stopped;
- the disable operation, the affected-state rules, its audit event, and the store/index transaction
  boundaries are specified **together**, not separately;
- owner revocation remains linearizable against acquire (exists).

**An acceptable alternative** is to check the recorded binder's epoch/status at acquire — provided
disablement and acquire share a linearizable conflict domain. That is a real design option and I am not
choosing between them here; both must be costed against the Mongo write-conflict rules in §8.3 of the
main design.

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
and provenance.

The policy is right but v2 gave it **no executable discriminator** — `AttestationRecord` has no
identity-schema field, so nothing can tell a v1 record from a v2 one. Specified:

- add **`identitySchemaVersion`** to the record; **absent means legacy v1**;
- every mint path writes **v2**;
- **v1 is rejected by**: reserve, bind, acquire, execution extension, redeem;
- **v1 remains available to**: revoke, the expiry sweep, read and audit, and reconciliation;
- migration rules are **state-by-state**, and in particular a **bound** record cannot silently acquire a
  different immutable identity — changing what its digest covers requires new owner authorization, not a
  rewrite.

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

## 13. Findings against the ALREADY-CERTIFIED gate, surfaced by this design review

Neither is introduced by option (b). Both are in code that holds a GO, and both are verified.

### 13.1 HIGH — the execution VERB is not pinned by layer 3

`validatePayload` never compares the attestation's `kind` to `payload.action`. **Verified: the identifier
`action` does not appear in that function at all.** The payload schema admits both
`configuration.apply.v1` and `configuration.rollback.v1`, and acquire's kind check compares the
*caller-supplied* kind against the record, never against the bound payload.

**So a rollback payload can be bound to an apply attestation, or the reverse.** The owner must still sign
it, but layer 3 does not pin which operation is performed — which contradicts the claim that the gate binds
"which reviewed change is applied".

**Required:** `validatePayload` must require `configuration.apply → configuration.apply.v1` and
`configuration.rollback → configuration.rollback.v1`, and this must appear in the retained-checks list and
in the conformance and choreography tests.

### 13.2 MEDIUM — "renew" can move a deadline BACKWARDS

`renewLease` computes `Math.min(requestedExpiresAt, record.expiresAt)` and writes it, with **no floor at
the current lease expiry** (verified). An operation described as extending a lease can therefore contract
it. Not exploitable by an unauthorised party — it needs the lease holder's credential — but it is a
monotonicity property the design assumes and the code does not provide, and §5 above now depends on it.

**Required:** deadlines move only later, for both lease renewal and execution extension.

## 14. Questions for review round 3

1. §5 — is the execution-attempt contract now sufficient, and is "short bounded extensions against an
   absolute cumulative deadline" the right default rather than "repeat until attestation expiry"?
2. §8 — I deliberately did **not** choose between atomic taint-on-disable and a binder epoch/status check
   at acquire. Both need costing against the Mongo write-conflict rules. Which is preferable, or is that
   properly an implementation decision?
3. §6 — is the five-category inventory now defensible as exhaustive?
4. §13.1 — should fixing the verb binding be part of this candidate, or its own, given it is a defect in
   already-certified code that exists independently of the split?
5. Is there anything in v3 that I have made *worse* while fixing round 2?
