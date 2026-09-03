# Split authority: `bindingPrincipalId` and `audiencePrincipalId`

**Date:** 2026-09-02
**Author:** Claude
**Revision:** v6, after design review rounds 1 (8, 4 HIGH), 2 (5, 3 HIGH), 3 (4, 2 HIGH), 4 (4, 2 HIGH)
and 5 (2, 1 HIGH).
Round 3: *"the central split-authority direction is now sound"* — what remained was turning two open
security choices into exact, testable contracts. v4 makes both choices.
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

### Round 3 — 4 findings, 2 HIGH. *"The central split-authority direction is now sound."*

| # | finding | what I had written | what is true |
|---|---|---|---|
| 1 | HIGH | offered atomic taint-on-disable *or* an acquire-time check, and left the choice open | leaving it open **was** the defect — they are different state machines, transaction shapes, audit semantics and indexes. v4 chooses the acquire-time check, and specifies it as a conditional **write** because a snapshot read creates no Mongo conflict — §8 |
| 2 | HIGH | acquire stamps an attempt identifier, "the exclusive capability the lease id is not" | generating a value does not make it exclusive. It must be **protected bearer credential material**: high entropy, verifier-only storage, excluded from projections/audit/logs/payloads, constant-time verification, single-attempt — §5 |
| 3 | MED | a five-category inventory | the framework is right, the contents were not: both `schemaVersion` literals missing, and **`protected` misclassified as binder-selectable when the schema pins it to `false`** — the one thing I made worse — §6 |
| 4 | MED | "migration rules are state-by-state" | said, not specified. v4 gives the table, and concludes there is **no in-place migration at all** — an immutable identity that can be rewritten was never immutable — §9 |

### Round 4 — 4 findings, 2 HIGH

| # | finding | what I had written | what is true |
|---|---|---|---|
| 1 | HIGH | verifier-only token storage **and** "a retry returns the same result" | **internally impossible.** If the first response is lost, a gate that kept only a verifier cannot reproduce the token. Acquire is now **single-delivery**: a committed retry returns `already_acquired` with no token, and a lost response is an `INDETERMINATE` attempt — §5 |
| 2 | HIGH | chose the acquire-time binder check | **but left v3's bulk-invalidation requirement standing above it**, so §8 specified two incompatible protocols. My regression, introduced while fixing round 3. Deleted, and the chosen protocol rewritten as executable postconditions with a real conditional update and asserted matched/modified counts — §8 |
| 3 | MED | acquire checks the binder's *present* enabled status | unsafe under **re-enable**: a principal disabled after bind and re-enabled is presently enabled, so the check accepts exactly the bindings disablement should invalidate. Now a monotonic **`incarnation`**, incremented on disable, never on rotation — §8 |
| 4 | MED | "the audit lineage records the superseded v1 id" | a requirement with no contract. Now specified: field on the new record, owner-supplied, store-validated against the referenced record, immutable, identity-digest-covered, both mint paths — §9 |

Round 4 also corrected §5 item 7: **rotation and disablement are not the same event.** v4 refused both
extension and redeem for both, arguing only that "a disabled credential must not be usable" — which says
nothing about rotation. After ordinary rotation, redeem is now **allowed**: the attempt token still
proves the winning attempt, and refusing would manufacture an `INDETERMINATE` from a routine operation.

### Round 5 — 2 findings, 1 HIGH. *"The next revision can be small."*

| # | finding | what I had written | what is true |
|---|---|---|---|
| 1 | HIGH | rotation refuses extension (table), extension needs "the current audience credential" (predicate) | **the two disagreed.** After a rotation the *new* credential IS current and the token is still valid, so the stated predicate would have **permitted** extension. Two conforming implementations could reach opposite outcomes. Now enforced by `acting.credentialEpoch === executingCredentialEpoch` — §5 item 2 |
| 2 | MED | acquire writes `lastAcquireAt` so the update "cannot be optimised into a no-op" | **not guaranteed.** Two acquisitions can read the same clock, a fixed test clock reproduces it, clock regression rewrites it — and MongoDB reports `matchedCount: 1, modifiedCount: 0` when `$set` writes the existing value. Now `$inc: { acquireFence: 1 }` — §8 item 2 |

Round 5 confirmed the earlier regressions were gone: no bulk-invalidation contradiction, no lineage
ambiguity. The pattern held anyway in a narrower form — a *table* and a *predicate* that disagreed, which
is the same failure as superseded text left beside its replacement, one level down.

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

1. **Acquire atomically mints an execution attempt CREDENTIAL** — not merely an identifier. Round 3 was
   right that calling a generated identifier an "exclusive capability" overstated what the text
   guaranteed: generating and stamping a value makes it exclusive only if it is treated as a secret.

   - **cryptographically random, high entropy**, returned **only** to the winning acquire response;
   - the gate stores **a verifier (hash), never the token**, as it already does for principal credentials;
   - **structurally confined, not merely excluded by a list.** An exclusion list is only as complete as
     its author. The rule: **the token plaintext exists in exactly two places** — the local value inside
     the acquire handler, and the single successful acquire response. It must never enter an
     `AttestationRecord`, a generic operation result, an exception, a tracing or APM attribute, a
     request/response body logger, an idempotency record, a metrics label, client durable storage, or a
     diagnostic dump. The acquire response carries `Cache-Control: no-store` and travels only over
     authenticated TLS. *(The lease id's mistake was being public; repeating it here would waste the
     mechanism.)*
   - **verified in constant time**, alongside the current audience credential;
   - **single-attempt**: it cannot be regenerated, recovered or reissued. A lost token is an
     `INDETERMINATE` attempt requiring reconciliation, which is the honest outcome — the gate genuinely
     does not know whether the host changed;
   - **acquire is SINGLE-DELIVERY.** v4 promised that a retry from the same request identity returns the
     same result, which is impossible alongside verifier-only storage: if the first response is lost, the
     gate cannot reproduce a token it never kept. Round 4 caught the contradiction.

     A retry of a **committed** acquire returns `already_acquired` **and no token**. Losing the original
     response therefore loses the attempt, and it becomes `INDETERMINATE` for reconciliation. That is the
     honest outcome: the gate cannot know whether the executor received the token and started.

     The rejected alternative — storing the token recoverably — would trade the verifier-only property for
     a replay convenience, and would need its own storage, encryption, retention, authorization and
     deletion design.

   - **"Same request identity" is concrete**: a required, high-entropy acquire idempotency key, bound to
     the authenticated principal, the attestation, the lease, the action digest **and a hash of the whole
     acquire request** — not the shared principal identity, which every process of that executor has.

   Acquire also records the executing principal and **`executingCredentialEpoch`**. That epoch is an
   **enforced** field, not an audit note — item 2 compares against it, and calling it "for audit" is
   exactly how v5 ended up with a table and a predicate that disagreed.
2. **Extension requires**: state `EXECUTING`; that attempt token; **`acting.credentialEpoch ===
   executingCredentialEpoch`** (the epoch recorded at acquire); current target provisioning; live
   attestation; released claim still authorizable.

   **The epoch equality is what enforces "rotation refuses extension".** v5 said extension needs "the
   current audience credential", and then claimed in the table below that rotation refuses it — but after
   a rotation the *new* credential **is** current and the token is still valid, so the stated predicate
   would have *permitted* extension. Recording the acquiring epoch "for audit" enforces nothing. Round 5
   caught that two conforming implementations could reach opposite authorization outcomes from the same
   document.

   **Redeem deliberately does NOT require this equality** — it requires the current credential plus the
   attempt token. That asymmetry is the whole content of the rotation row in the table at item 7.
3. **It must occur before the current execution deadline** — an expired attempt does not extend, it
   reconciles.
4. **Deadlines are monotonic.** An extension may only move the deadline later. (§14.2: the existing
   renewal does not have this property.)
5. **Each extension is short and bounded**, against an absolute cumulative execution deadline:

   > `absoluteDeadline = min(acquiredAt + configuredMaximumExecutionDuration, attestation.expiresAt)`

   with a bounded per-extension increment. The durations are configuration; **the bounding formula is
   part of the design**. "Repeat until attestation expiry" is available only as an explicit choice, never
   the default.
6. **Redeem uses the attempt identity and execution deadline**, not binder-holder semantics.
7. **Executor rotation and disablement during an attempt are DIFFERENT, and v4 conflated them.**

   | event | extension | redeem |
   |---|---|---|
   | ordinary **rotation** | **refused** — `acting.credentialEpoch !== executingCredentialEpoch` | **allowed**, with the new current credential plus the attempt token |
   | **disablement** | refused | refused |

   **Rotation:** the executor is still a trusted principal; only its credential changed. Refusing to
   record an outcome it already produced would manufacture an `INDETERMINATE` out of a routine operation,
   for no gain — the attempt token still proves it is the winning attempt. Extension is refused because
   extending is forward-looking authority, and is enforced by the epoch equality in item 2 — **not** by
   "the old credential cannot authenticate", which was v5's reasoning and is beside the point: the party
   asking for an extension after a rotation holds the *new* credential, which authenticates fine.

   **Disablement:** the principal must not act. Both refuse, the attempt reaches its deadline and becomes
   `INDETERMINATE` for owner reconciliation against the executor's durable journal.

   *(v4 argued only that "a disabled credential must not be usable", which says nothing about rotation,
   and then applied the disablement answer to both.)*

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

**(4) Schema literals and generated or equality-constrained identifiers.** `schemaVersion` is pinned to
`configuration-deployment-v1` and `agent-upgrade-v1` respectively; `automaticRollback` to literal `true`;
**`protected` to literal `false`**; and `reviewAuthorization.attestationId`/`leaseId` must equal the
request's.

**(5) Binder-selectable.** Configuration: `repositoryRoot`, `environmentFilePath`, `composePath`,
`composeProject`, `statelessServices`, `protectedServices`, `healthChecks`, `expectedConfigurationDigest`,
`expectedActiveDeploymentId`, `planId`, `planRevision`, `deploymentId`, `environmentKind`,
**`action`** (see §13.1), and both `encryptedValues` and `sealedValues`. Agent upgrade: `upgradeId`,
manifest `serverId`, expected agent id / current version / current binary, target version, release id,
`planDigest`, OS, architecture, package type, required capabilities, manifest expiry and nonce, artifact
signature and key id.

*(Cumulative corrections: round 1 — omitted `planRevision`, `expectedActiveDeploymentId`,
`environmentKind` and sealed material; wrongly listed `automaticRollback`; omitted agent upgrade
entirely. Round 2 — omitted `rollbackTarget` identity, `action`, `upgradeId`, the
`encryptedValues`/`sealedValues` distinction, and the whole transitive category. Round 3 — omitted both
`schemaVersion` literals, and **moved `protected` into binder-selectable when the schema pins it to
`false`**, which is the one thing I made worse while fixing round 2.)*

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
- **`EXECUTING` records are never made `REVOKED`** — that would claim an effect was stopped which may
  already have happened;
- owner revocation remains linearizable against acquire (exists).

*(v4 also carried a requirement that disablement "atomically taint or invalidate all of that binder's
non-`EXECUTING` attestations" — directly contradicting the choice made below, which rejects bulk
invalidation. Round 4 found the contradiction. It was mine: I added the choice and left the superseded
requirement standing above it, so the section specified two incompatible protocols. Deleted.)*

**CHOSEN: the acquire-time binder check.** Round 3 was right that leaving this open was itself the defect
— atomic bulk invalidation and an acquire-time check are different state machines, transaction shapes,
audit semantics and indexes, and "the implementer decides" would have meant nobody decided.

The bulk-invalidation option is rejected: it has unbounded transaction size, write amplification and hot
index contention, and it *duplicates a fact the principal row already holds canonically*.

**The contract, as executable postconditions rather than description:**

0. **Disable mutates ONLY the canonical principal row and its audit record.** It performs no bulk update
   over attestations. Incident identification is *derived*, by querying `EXECUTING` records by
   `bindingPrincipalId` — the store must index that — or by a separately specified bounded process. There
   is no per-attempt incident flag written inside the disable transaction, because that is the unbounded
   write v4 rejected in the same breath as requiring it.

1. **Bind records `binderIncarnation`** and `binderCredentialEpoch` on the attestation. The epoch is for
   audit and enumeration only. The incarnation is the acquire-time equality test (see 4).
2. **Acquire conditionally WRITES the binder principal row and the attestation in one transaction.**

   **A snapshot read is not sufficient**: under Mongo snapshot isolation a read takes no lock and creates
   no conflict, so a read-only status check would not serialize against a concurrent disable. This is the
   trap the main design already records, and it is the likeliest way to implement this wrongly.

   **"Claims the document" is not a postcondition.** The required mutation is a conditional update of the
   binder principal row **filtered on `{ disabledAt: null, incarnation: <recorded> }`**, applying
   **`$inc: { acquireFence: 1 }`**. Its **matched/modified counts are the decision**: matched 0 means the
   binder was disabled or re-incarnated, and acquire refuses. Both counts must be asserted by tests, not
   inferred.

   **It must be `$inc`, not a timestamp.** v5 specified `lastAcquireAt` "so it cannot be optimised into a
   no-op", which is not guaranteed: two acquisitions can read the same clock value, a supplied or fixed
   test clock reproduces one exactly, and clock regression can rewrite an existing value — and MongoDB
   reports `matchedCount: 1, modifiedCount: 0` when `$set` writes the value already there. A monotonic
   counter always modifies. `lastAcquireAt` may be written alongside it for observability, but it is not
   the conflict primitive.

   **And it must be on the canonical principal row, not a dedicated counter document.** Serialization
   against disablement only works if both operations contend on the *same* authoritative write target; a
   separate document moves the hot spot without creating the conflict, unless disablement is also made to
   write it — which is strictly more machinery for the same result.

   Whichever write to the principal row commits first wins, which is the entire point of writing rather
   than reading it.
3. **Serialization:** either acquire commits first or disablement does.
   - **acquire wins** → the attempt simply remains `EXECUTING`. Disablement writes nothing to it. The
     incident responder finds it by querying `EXECUTING` records for that `bindingPrincipalId`;
   - **disablement wins** → acquire's conditional update matches nothing and acquire refuses.
4. **A monotonic `incarnation` is compared — not the credential epoch, and not merely present status.**

   Two wrong answers, and why:

   - **comparing the credential epoch** would invalidate on ordinary *rotation*, contradicting the policy
     that rotation preserves completed bindings;
   - **checking only present enabled/disabled status** is unsafe under **re-enable**. A principal disabled
     after bind and later re-enabled is *presently enabled*, so a status-only check would accept exactly
     the bindings disablement was meant to invalidate. This was my Q3 in round 3 and the concern was
     right.

   So: principals carry a **monotonic `incarnation`**, incremented **on disable** and never on rotation.
   Bind records it; acquire requires equality. Disable-then-re-enable therefore invalidates prior
   bindings, while rotation leaves them alone — which is precisely the policy.

   *The reviewer offered a simpler option — make disabling a principal id permanent, so re-enabling means
   provisioning a new id. I did not take it because it silently removes the `enable` operation
   `operator.ts` already implements, and a design that breaks an existing tool without saying so is the
   same class of error as the contradiction above. One integer buys keeping the operation.*

**Executor disablement or rotation during `EXECUTING`** — §5 previously pointed here, and this section
only covered the binder. Resolved there instead, since it is a property of the attempt.

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
- **migration, state by state** — v3 promised this and then gave only the rejection matrix:

  | state | policy |
  |---|---|
  | `PENDING` | **audit-only; never migrated.** The owner mints a fresh v2 attestation instead — minting is cheap and it is the authority that should be re-exercised |
  | `RESERVED_UNBOUND` | **audit-only.** The lease is abandoned, which §2.6 of the main design already establishes is safe *because nothing is bound* |
  | `RESERVED_BOUND`, `EXECUTING`, terminal | **never identity-rewritten**, under any authority |

  **Migration never edits a record.** Where a replacement is wanted, the owner mints a **new v2
  attestation**. The v1 record keeps its v1 digest semantics and remains readable forever.

  **The lineage contract** — v4 required lineage without saying what it is:

  - `supersedesAttestationId` is a **field on the new v2 attestation**, not a side audit record, so it
    cannot drift from the thing it describes;
  - it is **owner-supplied at mint** and **store-validated**: the referenced record must exist, and its
    `candidateId`, `contentDigest`, `orgId` and `serverId` must match the new attestation's;
  - it is **immutable and covered by `attestationIdentityDigest`**, by the same argument that puts
    `bindingPrincipalId` there — a replacement that could be re-pointed is not a lineage;
  - it is **optional** (most attestations supersede nothing) but, once set, never changed;
  - it is available on **both mint paths**, and appears in the field inventory (§6, category 3) and the
    surfaces list (§10).

  This means there is no in-place migration path at all, which is the point: an immutable identity that
  can be rewritten was never immutable.

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
`configuration.rollback → configuration.rollback.v1`.

**This fix belongs in the SAME implementation candidate**, decided at review round 3. It may be a
logically separate prerequisite commit, but building the split on top of a known-broken retained invariant
would make the candidate impossible to approve end to end. It must be exercised by **both** the store
conformance suite and the exposed-API choreography test.

### 13.2 MEDIUM — "renew" can move a deadline BACKWARDS

`renewLease` computes `Math.min(requestedExpiresAt, record.expiresAt)` and writes it, with **no floor at
the current lease expiry** (verified). An operation described as extending a lease can therefore contract
it. Not exploitable by an unauthorised party — it needs the lease holder's credential — but it is a
monotonicity property the design assumes and the code does not provide, and §5 above now depends on it.

**Required:** deadlines move only later, for both lease renewal and execution extension.

## 14. Questions for review round 6

Round 5 answered the four open ones: principal-row contention is fine provided the conflict primitive is a
guaranteed-changing counter; the monotonic `incarnation` is the right trade and precisely preserves
`enable`; single-delivery acquire is acceptable because a pre-acquire handshake cannot prove receipt of the
eventual token response and so does not remove the indeterminate outcome; and redeem-after-rotation /
refuse-after-disablement is the right line **once the epoch predicates are executable**, which v6 makes
them.

What remains open:

1. Is there any remaining place where a **table, a matrix or a prose summary** states an outcome that the
   **predicates** do not produce? That has now been the defect twice — bulk-invalidation text beside its
   replacement, then the rotation row beside its predicate — and it is the failure mode I am least able to
   catch in my own document, because both halves read as true separately.
2. §5 item 2 — `executingCredentialEpoch` is now enforced rather than audit. Does anything else I labelled
   "for audit" actually carry enforcement weight? `binderCredentialEpoch` is the other candidate.
3. Anything made worse in v6.
