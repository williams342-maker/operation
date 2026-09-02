# Review gate as a separate service — design v4

**Date:** 2026-09-02
**Author:** Claude
**Status:** **DESIGN — NOT IMPLEMENTED.** Revision 4, after three design reviews.
**Decision it implements:** Owner chose **Option B** from `REVIEW_GATE_TRUST_BOUNDARY_DECISION.md`.

---

## 0. What each review changed

| rev | verdict | what it found |
| --- | --- | --- |
| v1 | NO-GO | An authority over *records*, with nothing named that stops anyone ignoring it. Two collections cannot enforce a cross-collection invariant. |
| v2 | NO-GO | The grant bound content and environment but not the action, target, or audience — and would have *replaced* the repo's existing offline owner signature with a bearer endpoint. A later rejection did not invalidate an outstanding grant. Verdicts were missing from the authorization matrix. |
| v3 | NO-GO | The successor claim was modelled against the **wrong digest**. An expiring lease **cannot fence a host mutation**. `contentDigest` and `actionDigest` sitting side by side does not establish that the action applies the reviewed content. |

**The v3 finding I most want to flag**, because it is the one I would have shipped: a successor by
definition has a *different* content digest, so `LIVE (held by P) → LIVE (held by S)` on **one** claim
document cannot be right. I wrote a transition between two candidates on a document keyed by the thing
that distinguishes them. §8 now handles the predecessor's digest and the successor's digest as two
documents in one transaction.

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

### 2.4 The gate computes `actionDigest`; it never accepts one

v3 let an attestation carry `contentDigest` and `actionDigest` as adjacent fields, which — as the review
put it — *"can truthfully identify reviewed content A while authorizing an action payload B that does not
deploy A."* Adjacency is not a relationship.

**Minting an attestation requires the full action payload.** The gate:

1. computes `actionDigest = privilegedActionDigest(payload)` **itself**, with the same function layer 2
   uses (`packages/shared/src/ownerAuthorization.ts`), excluding the signature field exactly as that
   function does — so the digest cannot recurse;
2. validates the payload against the **released candidate's binding**, by a rule stated per kind:

| kind | the gate requires |
| --- | --- |
| `configuration.apply` | the payload's configuration digest equals the candidate binding's `artifactDigest`, and its manifest digest equals `manifestDigest` |
| `configuration.rollback` | the payload's rollback target resolves to a digest that is itself `RELEASED` in `contentClaims` — a rollback may only target previously released content |
| `agent.upgrade` | the payload's agent artifact digest equals the candidate binding's `artifactDigest` |

3. refuses to mint if the rule does not hold.

**If a kind cannot be validated this way it does not get an attestation.** The attestation asserts *"this
payload deploys this reviewed content"*, and it is only allowed to assert that because the gate checked
it. The executor hashing honestly (§3.1) is still trusted, but it is now trusted about *bytes*, not about
*which content those bytes are*.

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
  state,                           // OPEN | RESERVED | CONSUMED | REVOKED | EXPIRED | INDETERMINATE
  lease?: { leaseId, holderPrincipalId, expiresAt },
  consumedAt?, revokedAt?, revokedReason?, indeterminateAt?, indeterminateReason?
}
```

### 2.6 Reserve → apply → redeem, and what happens when it goes wrong

v3 returned an expired lease to `OPEN`. The review showed why that is unsafe: reservation gives the
executor everything it needs to act, and expiry *"does not revoke that knowledge or stop an executor that
is delayed, partitioned, or already applying."* A second reservation could then be issued while the first
execution was still live. My claim of "at most one open authorization window" was true of the database and
false of the world.

**A lease that expires does not reopen. It becomes `INDETERMINATE` — a terminal state.**

| step | who | effect |
| --- | --- | --- |
| reserve | the `audiencePrincipalId`, authenticated to the gate | CAS `OPEN → RESERVED`, lease with expiry; requires the claim predicate (§8.2) |
| apply | the executor | journals `STARTED` keyed by `actionDigest`, acts, journals the outcome |
| redeem | the lease holder | CAS `RESERVED → CONSUMED` on matching `leaseId`; records outcome |
| lease expires | the gate's sweep | CAS `RESERVED → INDETERMINATE`. **No automatic retry.** |

**Recovery from `INDETERMINATE` is an explicit, owner-authorized operation**, not a timeout. The operator
reconciles the host against the executor's journal and then either marks the attestation `CONSUMED`
(the action did happen) or requests a fresh owner-decision (it did not). A `STARTED` journal entry with no
outcome is exactly the case a human must resolve, and the design refuses to guess.

**The honest division of responsibility, corrected:** the gate guarantees *at most one reservation exists
in its database at a time*, and that an ambiguous outcome halts the pipeline rather than retrying. It does
**not** guarantee at-most-once application on a host — no database transaction can. Fencing the effect
point is the executor's problem, and if the executor cannot fence it, the honest answer is that
`INDETERMINATE` requires a human.

### 2.7 Fail closed, and activation that cannot be downgraded

Refuse on: gate unreachable; attestation unknown, expired, revoked, consumed, `INDETERMINATE`, or not in
the state the step requires; digest, target, kind, or audience mismatch; claim predicate unmet; principal
disabled or credential rotated since reservation; any unexpected response.

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
        attestation.state == RESERVED
      ∧ lease.leaseId == leaseId ∧ lease.expiresAt > now
      ∧ attestation.kind == envelope.taskType
      ∧ attestation.actionDigest == parts.actionDigest        // the same digest layer 2 signed
      ∧ attestation.orgId == parts.orgId ∧ serverId == parts.serverId
      ∧ authenticated principal == attestation.audiencePrincipalId, still enabled
      ∧ contentClaims[attestation.contentDigest] satisfies §8.2
```

`attestationId` and `leaseId` travel **in the task envelope's payload**, so they are covered by the layer-1
digest and cannot be swapped in transit. The executor authenticates to the gate as `audiencePrincipalId`
with its own credential — **not** the control-center's, and not by presenting anything the control-center
gave it. Reservation happens **before** dispatch, so the payload the owner signs already names the
attestation and lease.

**Agent gate credentials** are provisioned by the same operator CLI as any other principal (§5) and are
distinct from agent transport keys, so layer 3 cannot weaken layer 1.

---

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
| `POST` | `/attestations/:id/reserve` | executor takes a lease |
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
| `reserve` | attestation OPEN | its `audiencePrincipalId`, enabled | + claim predicate §8.2 |
| `redeem` | attestation RESERVED | the lease holder | matching `leaseId` |
| `revoke` | attestation OPEN or RESERVED | owner | linearizable against redeem |
| `lease-expiry` | attestation RESERVED | the gate's sweep | → `INDETERMINATE`, terminal |
| `attestation-expiry` | attestation OPEN | the gate's sweep | → `EXPIRED` |
| `resolve-indeterminate` | attestation INDETERMINATE | owner, after reconciliation | → CONSUMED, or a fresh decision |
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
| reserve | attestation CAS `OPEN → RESERVED`, lease, claim predicate, audience + enabled check | leased once, or refused |
| redeem | attestation CAS `RESERVED → CONSUMED` on `leaseId`, outcome, claim predicate | consumed exactly once, or refused |
| revoke | attestation CAS on state ∈ {OPEN, RESERVED}, idempotency, audit | **linearizable against redeem** |
| lease-expiry sweep | attestation CAS `RESERVED → INDETERMINATE` on an expired lease | each attestation transitions wholly; **never back to OPEN** |
| attestation-expiry sweep | attestation CAS `OPEN → EXPIRED` | wholly or not at all |
| resolve-indeterminate | attestation CAS from INDETERMINATE, audit | resolved once, audited |
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

1. **§2.4 — does the gate computing `actionDigest` and validating the payload per kind close the
   content-to-action gap**, and are the three per-kind rules right? `configuration.rollback` requiring its
   target to be already-`RELEASED` is the one I am least sure of.
2. **§2.6 — is `INDETERMINATE` as a terminal state with owner-authorized recovery the right answer**, or
   does it strand pipelines in practice often enough to need something else?
3. **§2.8 — is the execution predicate exact enough to implement**, and is putting `attestationId` and
   `leaseId` in the envelope payload (so layer 1 covers them) correct?
4. **§8.1 — is the cross-digest successor operation right now**, including leaving a REJECTED predecessor
   claim untouched?
5. **§8.2 — is the claim predicate right?**
6. **Is this build-ready?** If a fifth revision is needed, say exactly what must change.
