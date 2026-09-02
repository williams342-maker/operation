# Review gate as a separate service — design v5

**Date:** 2026-09-02
**Author:** Claude
**Status:** **DESIGN — NOT IMPLEMENTED.** Revision 5, after four design reviews.
**Decision it implements:** Owner chose **Option B** from `REVIEW_GATE_TRUST_BOUNDARY_DECISION.md`.

---

## 0. What each review changed

| rev | verdict | what it found |
| --- | --- | --- |
| v1 | NO-GO | An authority over *records*, with nothing named that stops anyone ignoring it. Two collections cannot enforce a cross-collection invariant. |
| v2 | NO-GO | The grant bound content and environment but not the action, target, or audience — and would have *replaced* the repo's existing offline owner signature with a bearer endpoint. A later rejection did not invalidate an outstanding grant. Verdicts were missing from the authorization matrix. |
| v3 | NO-GO | The successor claim was modelled against the **wrong digest**. An expiring lease **cannot fence a host mutation**. `contentDigest` and `actionDigest` sitting side by side does not establish that the action applies the reviewed content. |
| v4 | NO-GO | Successor and claim models now sound. But minting, reservation and signing were **circular** — the payload must contain ids that do not exist until after the payload is digested. And the configuration rule named fields the real payload does not have. |

**The v4 finding worth flagging**: I specified that `attestationId` and `leaseId` travel inside the action
payload *and* that the gate computes `actionDigest` over that payload at minting time. Those cannot both
hold — the ids do not exist until after minting and reservation, and adding them afterwards changes the
digest. I had written a protocol that cannot execute in any order. §2.6 replaces it with an explicit
four-state sequence.

**And the configuration rule was written against a payload I had not read.** I required "the payload's
configuration digest equals `artifactDigest`, and its manifest digest equals `manifestDigest`". The real
payload (`configurationDeploymentPayloadSchema`) has **no manifest digest**, and its
`expectedConfigurationDigest` is a *precondition describing the state before the change* — not the content
being deployed. Binding to it would have asserted something false while looking rigorous. §2.4 is now
written against the actual schema.

---

## 1. The one-sentence honest status

**Until the enforcement point in §2 is wired and activated, this gate is ADVISORY.** It records and
enforces the review lifecycle for callers that use it. It prevents nothing for a caller that does not.

That sentence stays in this document, in the service README, and in `/healthz` until §2.7 activation ships
and is reviewed.

---

## 2. Enforcement: a third independent layer

### 2.1 What already exists, and stays

`docs/agent-key-redesign.md` §8 defines two layers, both of which must hold:

| layer | signs | answers |
| --- | --- | --- |
| 1 — transport envelope | id, org, server, agent, expiry, nonce, payload digest | *was this dispatch tampered with?* |
| 2 — **offline owner** Ed25519 | `taskType · org · server · actionDigest · expiry · nonce` | *did the owner approve this action on this target?* |

**Neither is replaced.** The owner's private key stays offline. The gate signs nothing on the owner's
behalf.

### 2.2 What the gate adds

| layer | issued by | answers |
| --- | --- | --- |
| 3 — **review attestation** | the gate | *did this content pass independent review, and is that review still valid for this exact action?* |

`authorizePrivilegedTask()` gains a third check. **Any one of the three failing refuses.**

The gate's `owner-decision` does **not** authorize execution — it records that the owner accepted the
*review outcome*. Execution authority remains the offline signature.

### 2.3 Scope: three kinds, not four

**`release.publish` is removed from this design.** v3 listed it as an attestation kind with no enforcement
point, since `authorizePrivilegedTask()` covers only configuration apply, rollback and agent upgrade. An
attestation kind nothing is obliged to consume is decoration. Release publication needs its own
enforcement point and its own design.

In scope: `configuration.apply`, `configuration.rollback`, `agent.upgrade`.

### 2.4 The gate computes `actionDigest`, and validates the payload against the real schema

v3 let an attestation carry `contentDigest` and `actionDigest` as adjacent fields — which, as the review
put it, *"can truthfully identify reviewed content A while authorizing an action payload B that does not
deploy A."* Adjacency is not a relationship.

**Minting requires the full action payload.** The gate computes
`actionDigest = privilegedActionDigest(payload)` **itself**, with the same function layer 2 uses, which
already excludes the signature field so the digest cannot recurse. It never accepts a caller's digest.

Then it validates the payload against the released candidate's binding. **v4's rule named fields that do
not exist**; these are written against `configurationDeploymentPayloadSchema` and the agent-upgrade
payload as they actually are.

#### `configuration.apply`

The reviewed thing is the **change set**, and the repository already has a canonical digest over exactly
it — `configurationChangeDigest()` over each mutation's `{name, operation, secret, versionId}`.

The candidate binding carries `changeDigest`. The gate **recomputes** `configurationChangeDigest(payload.mutations)`
and requires equality. It additionally requires `payload.environmentId`, `payload.targetProfileId` and
`payload.targetProfileRevision` to match the values bound into the candidate, so a reviewed change set
cannot be redirected at a different environment or profile.

**What this deliberately does NOT assert, stated because the previous ten rounds over-claimed:**

- **`expectedConfigurationDigest` is excluded.** It describes the state expected *before* the mutation. It
  is a concurrency precondition, not the reviewed content, and binding review to it would assert
  something false.
- **The secret material is not validated.** `encryptedValues`/`sealedValues` are ciphertext the gate
  cannot open — sealed to the agent's key by design. The gate asserts *which variables change, how, and to
  which immutable `versionId`*. It does **not** assert what plaintext the agent will receive. That gap is
  listed in §3.1 as trusted, because the alternative is pretending otherwise.

#### `agent.upgrade`

The candidate binding's `artifactDigest` must equal the payload's `artifactSha256`, and the bound
`manifestDigest` must equal the payload's canonical manifest digest. Both are digests of the bytes that
will actually be installed, so this kind binds more tightly than configuration does.

#### `configuration.rollback`

v4 required only that the rollback target resolve to *some* `RELEASED` digest. The review was right that
this is eligibility, not identity: an attestation for candidate A could have authorized rollback to
unrelated released content B.

**A rollback attestation is about the content being restored.** Its `contentDigest` and `candidateId` are
the **rollback target's**, and that claim must satisfy §8.2 exactly as any other. The forward candidate's
`rollbackTargetId` must resolve immutably to that same content digest, and the attestation records both,
so the pair is bound rather than merely each being individually plausible.

#### A kind with no verifiable rule gets no attestation

If a payload cannot be tied to reviewed content by a stated rule, the gate refuses to mint. The
attestation asserts *"this payload applies this reviewed change"* only because the gate checked it.

### 2.5 What an attestation binds

```
reviewAttestations {
  _id: attestationId,              // gate-generated, unguessable
  kind,                            // configuration.apply | configuration.rollback | agent.upgrade
  contentDigest,                   // the reviewed work
  actionDigest,                    // computed by the gate from the payload (§2.4)
  orgId, serverId,                 // exact target; targetSetDigest for a rollout
  targetEnvironmentClass,
  audiencePrincipalId,             // which executor may consume it
  candidateId,                     // provenance
  nonce,
  grantedByPrincipalId, grantedAt, expiresAt,
  state,                           // PENDING | RESERVED_UNBOUND | RESERVED_BOUND
                                   //   | CONSUMED | REVOKED | EXPIRED | INDETERMINATE | ABORTED
  actionDigest?,                   // ABSENT until binding (§2.6); immutable once set
  lease?: { leaseId, holderPrincipalId, credentialEpoch, expiresAt },
  reconciliation?,                 // required to leave INDETERMINATE (§2.6)
  consumedAt?, revokedAt?, revokedReason?, indeterminateAt?, indeterminateReason?, abortedAt?
}

`actionDigest` is deliberately optional in this shape and set exactly once, at binding. v4 listed it as a
minting-time field, which is what made the protocol circular.
```

### 2.6 The non-circular sequence: mint → reserve → bind → sign → dispatch → apply → redeem

v4 required `attestationId` and `leaseId` to be inside the payload **and** the gate to compute
`actionDigest` over that payload at minting. Those cannot both hold: the ids do not exist until minting
and reservation have happened, and adding them afterwards changes the digest. **It was a protocol that
could not execute in any order**, and I did not notice because I wrote the two halves in different
revisions.

| # | step | actor | state after | notes |
| --- | --- | --- | --- | --- |
| 1 | **mint** | owner, on a candidate at GO | `PENDING` | allocates `attestationId`; binds kind, content, target, audience, expiry. **No payload yet, no `actionDigest`.** |
| 2 | **reserve** | the `audiencePrincipalId` | `RESERVED_UNBOUND` | allocates `leaseId`; records `credentialEpoch`; claim predicate §8.2 checked |
| 3 | **bind** | the lease holder | `RESERVED_BOUND` | submits the final payload **containing both ids**. The gate validates it per §2.4, computes `actionDigest`, and stores it. **Immutable from here.** |
| 4 | **sign** | the owner, offline | — | signs that exact `actionDigest` (layer 2, unchanged) |
| 5 | **dispatch** | control-center | — | envelope covers the payload, so both ids are covered by layer 1 |
| 6 | **apply** | executor | — | journals `STARTED` keyed by `actionDigest`, acts, journals the outcome |
| 7 | **redeem** | the lease holder | `CONSUMED` | CAS on matching `leaseId` and `credentialEpoch` |

**Immutability and who may act:** `kind`, `contentDigest`, `orgId`, `serverId`,
`targetEnvironmentClass`, `audiencePrincipalId` and `candidateId` are fixed at mint. `actionDigest` is
fixed at bind and can never be re-bound — a different payload requires a new attestation. Only the
`audiencePrincipalId` may reserve; only the lease holder may bind or redeem.

**Before binding**, an attestation is harmless: it authorizes no specific payload. So a `PENDING` or
`RESERVED_UNBOUND` attestation that expires simply becomes `EXPIRED`, and an unbound reservation **may be
abandoned freely** — nothing has been dispatched and no host can have changed. This is the one place a
timeout is safe, and it is safe precisely because no payload is bound yet.

**After binding it is not.** A `RESERVED_BOUND` attestation names an exact payload that may already be in
flight.

#### When it goes wrong after binding

v3 returned an expired lease to `OPEN`. The review showed why that is unsafe: reservation gives the
executor everything it needs to act, and expiry *"does not revoke that knowledge or stop an executor that
is delayed, partitioned, or already applying."* A second reservation could then issue while the first
execution was still live. My claim of "at most one open authorization window" was true of the database and
false of the world.

**A bound lease that expires does not reopen. It becomes `INDETERMINATE` — terminal, no automatic retry.**

Leaving `INDETERMINATE` requires an owner-authorized reconciliation that records evidence:

```
reconciliation {
  resolvedByPrincipalId, resolvedAt,
  outcome,                     // "APPLIED" | "NOT_APPLIED"
  journalReference,            // the executor journal entry consulted
  observedHostStateDigest,     // what the host actually looks like now
  reason
}
```

| reconciliation says | transition | then |
| --- | --- | --- |
| **APPLIED** | `INDETERMINATE → CONSUMED` | the record shows a consumed authorization with its evidence; nothing further |
| **NOT_APPLIED** | `INDETERMINATE → ABORTED` | terminal. **Never reopened.** A retry needs a fresh attestation through the full sequence above, including a new owner signature |
| **inconclusive** | stays `INDETERMINATE` | the pipeline stays halted; the design refuses to guess |

**The division of responsibility, stated honestly:** the gate guarantees at most one *bound* reservation
exists at a time, and that an ambiguous outcome halts rather than retries. It does **not** guarantee
at-most-once application on a host — no database transaction can. If the executor cannot fence its own
effect point, the honest answer is that `INDETERMINATE` requires a human.

**Lease renewal** by the same holder with the same `leaseId` and `credentialEpoch` is permitted for
availability. It cannot change holder or identity, and cannot revive an expired lease.

### 2.7 Fail closed, and activation that cannot be downgraded

Refuse on: gate unreachable; attestation unknown, `EXPIRED`, `REVOKED`, `CONSUMED`, `INDETERMINATE`,
`ABORTED`, or not in the state the step requires; unbound where binding is required; digest, target, kind,
or audience mismatch; claim predicate unmet; principal disabled; **`credentialEpoch` different from the
one recorded in the lease**; any unexpected response.

**"Inert until configured" needed downgrade protection**, or losing a config file silently disables
enforcement. So enforcement is **per-executor durable state**, not the presence of a setting:

- an executor is `DISABLED` or `ENFORCING`; the value is persisted, and activation is an audited
  operation;
- an `ENFORCING` executor that starts **without** working gate configuration **fails to start**. It does
  not run unprotected;
- rollout may begin `DISABLED`; activation is one-way without an audited owner action.

**No break-glass.** Advised against, and not added.

### 2.8 The execution predicate, stated exactly

```
allow(apply) ⇔
     verifyEnvelope(envelope)                                  // layer 1
  ∧  verifyOwnerAuthorization(ownerPublicKey, parts, sig)      // layer 2, unchanged
  ∧  gate.redeemable(attestationId, leaseId) where the gate checks, in one transaction:
        attestation.state == RESERVED_BOUND
      ∧ lease.leaseId == leaseId ∧ lease.expiresAt > now
      ∧ lease.holderPrincipalId == authenticated principal
      ∧ lease.credentialEpoch == the authenticated principal's CURRENT epoch
      ∧ principal not disabled
      ∧ attestation.kind == envelope.taskType
      ∧ attestation.actionDigest == parts.actionDigest        // the digest layer 2 signed
      ∧ attestation.orgId == parts.orgId
      ∧ attestation.serverId == parts.serverId
      ∧ contentClaims[attestation.contentDigest] satisfies §8.2
```

**`credentialEpoch`** closes a gap v4 promised in §2.7 and never expressed here: "still enabled" does not
prove the credential was not *rotated* after reservation. The epoch is stamped into the lease at reserve
and must still match at bind and redeem, so a rotation invalidates work in flight rather than silently
permitting it.

`attestationId` and `leaseId` travel **in the envelope payload**, so layer 1 covers them and they cannot
be swapped in transit. Both exist before the payload is finalised — see the sequence in §2.6, which is
what makes that possible. The executor authenticates to the gate as `audiencePrincipalId` with **its own**
credential, never one the control-center supplies.

**Agent gate credentials** are provisioned by the same operator CLI as any other principal (§5) and are
distinct from agent transport keys, so layer 3 cannot weaken layer 1.

## 3. The trust boundary

**The gate is a separate process with its own database. It is the authority over review records and
attestations. Everything else is a client with no privilege beyond its credential.**

### 3.1 Residual trust — the complete list

- The gate's **process, database, host**, and its **exclusive** database credentials.
- **Backups, restores, database administrators.** A restore silently un-rejects content.
- The **principal-provisioning plane**.
- **Bearer credential lifecycle**: generation, storage, rotation, revocation, log redaction.
- **Transport termination** and the private network path.
- **The executors**: that each consults the gate, and hashes *the exact bytes it will apply*. §2.4 means
  the gate now verifies which *content* a payload deploys; it still cannot verify the executor computed
  the digest of the bytes it actually wrote.
- **The plaintext behind sealed configuration values.** §2.4 binds *which* variables change and to which
  immutable `versionId`; `encryptedValues`/`sealedValues` are sealed to the agent's key and the gate
  cannot open them. What the agent finally writes is trusted, and reviewing a change set is not reviewing
  a secret's contents.
- **Canonical digest calculation** and the artifact store's digest→bytes mapping.
- **Executor target identity** — that an executor claiming `serverId` is that server.
- **Trusted time and entropy** for expiry, leases and identifiers.
- **The owner's authentication and signing workstation** (layer 2).
- **Release registry / artifact distribution integrity.**
- **Availability**: fail-closed makes the gate release-blocking.
- **Test provenance** — an authenticated assertion by a CI identity. Standing owner-authority item.

**Correction carried forward:** Option C would *narrow* this list, not empty it. Signatures make forged
decisions detectable; they do not prevent deletion, rollback, withholding, or denial of service.

---

## 4. Process and repository shape

New workspace `control-center/apps/review-gate/` — Express, MongoDB, ESM, `tsx --test`, own `Dockerfile`
and `tsconfig.json`.

```
apps/review-gate/src/
  server.ts    process entry; the ONLY place the store is constructed
  routes.ts    the API surface
  auth.ts      credential -> principal, from the gate's own registry
  store.ts     Mongo; not exported from any package
  policy.ts    evaluator and transition table (moved from packages/shared)
  service.ts   the operations (moved from packages/shared)
```

Policy leaves `packages/shared`; a thin client remains. **Hygiene, not the security argument** — the real
boundary is process isolation, exclusive credentials, server-side authentication, and §2.

---

## 5. Identity

```
principals {
  _id, displayName, credentialHash,        // Argon2id; never the credential
  reviewerClasses: [...],                  // e.g. ["independent"]
  roles: [...],                            // author | ci | reviewer | owner | executor
  audienceFor?: { orgId, serverId }[],     // executors: which targets they may act on
  createdAt, disabledAt?, credentialRotatedAt?
}
```

Provisioning is an **operator CLI** run by the owner; every action appends to an audit collection.
**I will create no credentials.** Disablement and rotation invalidate outstanding reservations (§2.7).

---

## 6. API surface

| method | path | effect |
| --- | --- | --- |
| `POST` | `/candidates` | register |
| `POST` | `/candidates/:id/successors` | register a replacement |
| `POST` | `/candidates/:id/evidence` | record a test execution |
| `POST` | `/candidates/:id/actions/:action` | one named lifecycle action (§7) |
| `POST` | `/candidates/:id/verdicts` | GO / NO_GO with findings |
| `POST` | `/candidates/:id/owner-decision` | accept the outcome; mint attestations from payloads (§2.4) |
| `POST` | `/candidates/:id/attestations` | mint a further attestation from RELEASED content |
| `POST` | `/attestations/:id/reserve` | executor takes a lease (no payload yet) |
| `POST` | `/attestations/:id/bind` | executor submits the final payload; gate fixes `actionDigest` |
| `POST` | `/attestations/:id/renew` | executor extends its lease |
| `POST` | `/attestations/:id/redeem` | executor completes |
| `POST` | `/attestations/:id/revoke` | owner |
| `POST` | `/attestations/:id/resolve-indeterminate` | owner, after reconciliation (§2.6) |
| `GET` | `/candidates/:id` | read-only projection |
| `GET` | `/healthz` | liveness; no data |

---

## 7. Authorization matrix — complete

| action | legal from | who may | notes |
| --- | --- | --- | --- |
| `register` | — | author | claim absent (§8) |
| `successor` | predecessor supersedable | predecessor's author or recorded remediator | cross-digest (§8.1) |
| `submit-tests` | BUILT, RETEST_REQUIRED | ci, **and not the candidate's author** | evidence must match and post-date any remediation |
| `record-test-failure` | BUILT, RETEST_REQUIRED | ci, **not the author** | |
| `freeze` | TESTED | author or participant | |
| `request-review` | FROZEN, REVIEW_BLOCKED | author or participant | **grants no role** |
| `claim-review` | REVIEW_REQUESTED | reviewer holding the class **and not a participant** | only stranger entry; **grants no role**; records `claimedByPrincipalId` |
| `submit-go` | REVIEW_IN_PROGRESS | **the recorded claimant**, still holding the class, independence rechecked in-transaction | refused while findings stand |
| `submit-no-go` | REVIEW_IN_PROGRESS | as above | ≥1 finding |
| `block-review` | **REVIEW_IN_PROGRESS only** | the claiming reviewer | v2's REVIEW_REQUESTED branch was unreachable |
| `begin-remediation` | REMEDIATION_REQUIRED | author or participant | records remediator |
| `submit-retest-request` | REMEDIATING | remediator | |
| `owner-decision` | GO | owner | mints attestations (§2.4) |
| `mint-further-attestation` | claim RELEASED | owner | same payload validation; no history overwrite |
| `reserve` | attestation PENDING | its `audiencePrincipalId`, enabled | → RESERVED_UNBOUND; stamps `credentialEpoch`; claim predicate §8.2 |
| `bind` | attestation RESERVED_UNBOUND | the lease holder, matching epoch | submits the payload; gate computes and fixes `actionDigest` (§2.4) → RESERVED_BOUND |
| `redeem` | attestation RESERVED_BOUND | the lease holder, matching `leaseId` and epoch | → CONSUMED |
| `renew-lease` | RESERVED_UNBOUND or RESERVED_BOUND | the lease holder, same `leaseId` and epoch | extends expiry; cannot revive an expired lease or change holder |
| `revoke` | PENDING, RESERVED_UNBOUND, RESERVED_BOUND | owner | linearizable against redeem |
| `unbound-expiry` | PENDING or RESERVED_UNBOUND | the gate's sweep | → `EXPIRED`. **Safe**: nothing is bound, so nothing was dispatched |
| `bound-lease-expiry` | RESERVED_BOUND | the gate's sweep | → `INDETERMINATE`, terminal. **Never back to PENDING** |
| `resolve-indeterminate` | INDETERMINATE | owner, with a reconciliation record (§2.6) | APPLIED → CONSUMED; NOT_APPLIED → ABORTED; inconclusive stays INDETERMINATE |
| `provision` / `rotate` / `disable` principal | — | owner, via operator CLI | audited; invalidates reservations |
| `cancel` | any non-terminal | author or owner | claim per §8.1 |
| `expire` | any non-terminal | the gate's sweep | claim per §8.1 |

**The author-exclusion on evidence was silently dropped in v3.** The review caught it; the current
implementation enforces it and so does this table. Losing an existing control while redesigning is exactly
the regression this whole workstream is about.

---

## 8. `contentClaims` — one document per digest

```
contentClaims {
  _id: contentDigest,
  disposition: "LIVE" | "RELEASED" | "REJECTED",
  liveCandidateId?, releasedByCandidateId?, rejectedByCandidateId?,
  rejectedAt?, releasedAt?, version
}
```

### 8.1 Transitions — exhaustive

| from | action | to | condition |
| --- | --- | --- | --- |
| *(absent)* | register | LIVE | insert; wins by `_id` uniqueness |
| LIVE | cancel / expire | *(deleted)* | `liveCandidateId` matches the candidate releasing it |
| LIVE | NO_GO | REJECTED | terminal |
| LIVE | owner-decision | RELEASED | `liveCandidateId` matches |
| REJECTED | cancel / expire of the rejected candidate | REJECTED | **unchanged.** Monotonic — the claim is not deleted |
| RELEASED | cancel / expire | — | **unreachable**; the candidate is terminal |
| RELEASED | ordinary registration | — | **denied.** A change produces a different digest |
| RELEASED | further attestation | RELEASED | no history overwrite |
| REJECTED | *anything* | REJECTED | **monotonic**, by conditional update |

**Successor is a cross-digest operation on two documents** — v3 modelled it as a transfer on one, which
cannot be right when the successor's digest is what distinguishes it:

| document | condition | effect |
| --- | --- | --- |
| predecessor's digest | disposition is LIVE and `liveCandidateId` is the predecessor → delete. Disposition is REJECTED → **leave untouched** | the predecessor stops holding its content; a rejection stays permanent |
| successor's digest | **must be absent**; must not be REJECTED | insert LIVE held by the successor |

Both in one transaction with the predecessor being marked superseded, its verdict surface closed, and the
inherited finding occurrences snapshotted.

### 8.2 The claim predicate for reserve and redeem — stated exactly

v3 said "authorizable", which is vague. The review also noted `RELEASED → REJECTED` does not exist, so the
check is a guard against an unexpected state rather than an expected race. Both steps require:

```
claim.disposition == "RELEASED"  ∧  claim.releasedByCandidateId == attestation.candidateId
```

Anything else — absent, LIVE, REJECTED, or released by a different candidate — refuses.

### 8.3 Transaction boundaries and postconditions

MongoDB **as a replica set** is required.

| endpoint | one transaction over | postcondition |
| --- | --- | --- |
| register | idempotency, claim insert, candidate | a candidate holds a LIVE claim, or nothing |
| successor | idempotency, predecessor superseded + verdict-closed, findings snapshotted, successor created, **both claim documents per §8.1** | the whole chain, or nothing |
| evidence | idempotency, evidence uniqueness, candidate association | recorded once, or not at all |
| action | idempotency, state CAS, occurrence, participation row | the move with its rows, or nothing |
| verdict | idempotency, state CAS, verdict + finding occurrences, claim disposition | the verdict and its consequences, or nothing |
| owner-decision | idempotency, state CAS, claim → RELEASED, payload validation (§2.4), attestations minted | attestations exist for released content, or nothing |
| reserve | attestation CAS `PENDING → RESERVED_UNBOUND`, lease + `credentialEpoch`, claim predicate, audience + enabled check | leased once, or refused |
| bind | attestation CAS `RESERVED_UNBOUND → RESERVED_BOUND`, payload validation (§2.4), `actionDigest` written once | bound exactly once with a validated payload, or refused |
| redeem | attestation CAS `RESERVED_BOUND → CONSUMED` on `leaseId` + epoch, outcome, claim predicate | consumed exactly once, or refused |
| revoke | attestation CAS on state ∈ {PENDING, RESERVED_UNBOUND, RESERVED_BOUND}, idempotency, audit | **linearizable against redeem** |
| unbound-expiry sweep | attestation CAS `{PENDING, RESERVED_UNBOUND} → EXPIRED` | wholly or not at all |
| bound-lease-expiry sweep | attestation CAS `RESERVED_BOUND → INDETERMINATE` | wholly; **never back to PENDING or RESERVED_UNBOUND** |
| resolve-indeterminate | attestation CAS from INDETERMINATE to CONSUMED or ABORTED, reconciliation record, audit | resolved once with evidence, or stays INDETERMINATE |
| provision / rotate / disable | principal write, audit append | both, or neither |
| candidate expiry sweep | state CAS, occurrence, claim per §8.1 | each candidate wholly or not at all |

### 8.4 Idempotency

```
idempotency { _id: { principalId, scope, key }, requestHash, status, result?, createdAt, expiresAt }
```

Committed in the same transaction as the mutation. A repeated key with a different `requestHash` is an
error, never a silently unrelated result.

### 8.5 Occurrence-scoped findings

Every accepted finding gets a **gate-generated immutable occurrence id**. Inheritance and discharge
reference occurrence ids, never the reviewer's label. Closes candidate K's `rec-4`.

---

## 9. What carries over

Candidate and content identity, the transition table, independence, evidence records, accumulated findings
with reviewer-only causal discharge, remediation lineage, billing classes — **189 tests move with them.**
Round-10 defects fixed by the move: successor inheritance becomes one transaction; the capability concept
disappears, because there is no injected store.

---

## 10. What I will not do

No deployment. No public port. No credential creation. No DNS change. No production data. No live route or
executor wiring. No change to the offline owner key or layers 1–2. Runs locally and in tests, with a
Dockerfile and `.env.example`.

---

## 11. Questions for this review

1. **§2.6 — is the mint → reserve → bind → sign → dispatch → apply → redeem sequence non-circular and
   complete?** Specifically: is it right that an *unbound* attestation can expire safely and be abandoned,
   while a *bound* one cannot?
2. **§2.4 — do the three per-kind rules now map to real fields?** `configuration.apply` binds the change
   digest and explicitly does not bind `expectedConfigurationDigest` or the sealed values;
   `configuration.rollback` is now bound to the rollback target's own candidate and claim. Is the
   configuration rule strong enough to be worth asserting, given the secret material is out of reach?
3. **§2.6 — is the reconciliation record sufficient** to justify `INDETERMINATE → CONSUMED`, and is
   `ABORTED` correctly terminal?
4. **§2.8 — does `credentialEpoch` close the rotation gap**, and is the predicate now implementable
   as written?
5. **Is any state in the attestation machine unreachable or missing a transition?**
6. **Is this build-ready?** If a sixth revision is needed, say exactly what must change.
