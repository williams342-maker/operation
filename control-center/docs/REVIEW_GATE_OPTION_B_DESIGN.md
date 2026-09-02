# Review gate as a separate service — design v3

**Date:** 2026-09-02
**Author:** Claude
**Status:** **DESIGN — NOT IMPLEMENTED.** Revision 3, after two design reviews.
**Decision it implements:** Owner chose **Option B** from `REVIEW_GATE_TRUST_BOUNDARY_DECISION.md`.

---

## 0. What each review changed

| rev | verdict | what it found |
| --- | --- | --- |
| v1 | NO-GO | I designed an authority over *records* and never named what stops anyone ignoring it. Also: two collections cannot enforce a cross-collection invariant. |
| v2 | NO-GO | The grant bound content and environment but not the *action*, the *target*, or the *audience* — weaker than the owner-authorization contract this repo already has. A later rejection did not invalidate an outstanding grant. The verdict action was missing from the authorization matrix entirely. |

**The v2 finding that most changed this revision:** the repository already has a two-layer cryptographic
authorization for privileged actions (`docs/agent-key-redesign.md` §8), including an **offline owner
Ed25519 signature** over `taskType · org · server · actionDigest · expiry · nonce`. My v2 grant would have
sat in its place, replacing an offline signature with a bearer-authenticated HTTP endpoint. That is a
**security regression**, and I did not notice I was proposing it.

§2 now composes with that contract as a **third, independent layer** instead of competing with it.

---

## 1. The one-sentence honest status

**Until the enforcement point in §2 is wired, this gate is ADVISORY.** It records and enforces the review
lifecycle for callers that use it. It prevents nothing for a caller that does not.

That sentence stays in this document, in the service README, and in `/healthz` until §2 ships and is
reviewed.

---

## 2. Enforcement: a third independent layer

### 2.1 What already exists, and stays

`docs/agent-key-redesign.md` §8 defines two layers that both must hold for `configuration.apply`,
`configuration.rollback` and `agent.upgrade`:

| layer | signs | answers |
| --- | --- | --- |
| 1 — transport envelope | id, org, server, agent, expiry, nonce, payload digest | *was this dispatch tampered with?* |
| 2 — **offline owner** Ed25519 | `taskType · org · server · actionDigest · expiry · nonce` | *did the owner approve this specific action on this target?* |

**Neither is replaced.** The owner's private key stays offline and never touches OpsWorkbench, exactly as
today. The gate does not sign on the owner's behalf and does not mint anything that substitutes for that
signature.

### 2.2 What the gate adds

| layer | issued by | answers |
| --- | --- | --- |
| 3 — **review attestation** | the gate | *did this content pass independent review, and is that review still valid?* |

`authorizePrivilegedTask()` gains a third check. All three must hold; **any one failing refuses**. Like
layer 2, layer 3 is **inert until configured**, so adding it cannot break the existing path — the same
additive discipline the agent-key redesign used.

This also clarifies something v2 got wrong. The gate's `owner-decision` action does **not** authorize
execution. It records that the owner accepted the *review outcome*. Execution authority remains the
offline signature.

### 2.3 What a review attestation binds

Deliberately using the existing contract's vocabulary rather than inventing a parallel one:

```
reviewAttestations {
  _id: attestationId,              // gate-generated, unguessable
  kind,                            // "configuration.apply" | "configuration.rollback" | "agent.upgrade"
                                   //   | "release.publish"  — the protected action, explicitly
  contentDigest,                   // the reviewed work
  actionDigest,                    // the exact payload, as layer 2 computes it
  orgId, serverId,                 // exact target; a target-SET digest for a rollout
  targetEnvironmentClass,
  audiencePrincipalId,             // WHICH executor may consume it
  candidateId,                     // provenance, not authority
  nonce,
  grantedByPrincipalId, grantedAt, expiresAt,
  state,                           // "OPEN" | "RESERVED" | "CONSUMED" | "REVOKED" | "EXPIRED"
  lease?: { leaseId, holderPrincipalId, expiresAt },
  consumedAt?, revokedAt?, revokedReason?
}
```

Every field answers a v2 gap: `kind` (which action), `actionDigest` (which payload), `orgId`/`serverId`
(which target), `audiencePrincipalId` (which executor), `nonce` (replay).

An attestation for approved content in production therefore **cannot** be presented by a different
executor, for a different action, or against a different payload or host.

### 2.4 Consumption contends on the content claim

v2's consumption checked only the attestation document, so this ordering worked: mint a grant, let the
digest become `REJECTED` by another route, consume the never-revoked grant. That is the
ordering-independent rejection defect, one stage later.

**Consumption reads and conditions on the same `contentClaims` document (§8) inside its transaction.** A
digest in `REJECTED` makes every unconsumed attestation for it unusable *by construction*, with no
dependence on a bulk-revocation sweep succeeding.

### 2.5 Reserve → apply → redeem

A database transaction cannot cover an action on a host. v2's single-shot consumption therefore had an
ambiguous window: mark consumed before applying and a crash loses the right to act; mark after and a lost
response permits double application.

Three steps, with the honest division of responsibility:

1. **Reserve.** CAS `OPEN → RESERVED` with a short lease naming the holder. Returns `leaseId`.
2. **Apply.** The executor writes its own durable journal entry keyed by `actionDigest` *before* acting,
   then acts. **Not-applying-twice is the executor's guarantee, not the gate's** — only the executor knows
   whether the host changed.
3. **Redeem.** CAS `RESERVED → CONSUMED`, requiring the matching `leaseId`, with the outcome recorded.

Recovery: an expired lease returns to `OPEN` and may be re-reserved **only by the same
`audiencePrincipalId` for the same `actionDigest`**. The executor consults its journal to distinguish
"authorized but not applied" from "already applied". If its journal is inconclusive it must refuse and
escalate rather than guess.

**Stated plainly:** the gate guarantees *at most one open authorization window at a time*. It cannot
guarantee at-most-once application. That is the executor's job and this design says so rather than
implying otherwise.

### 2.6 Fail closed

Gate unreachable, attestation unknown / expired / consumed / revoked / not `OPEN`, digest or target or
audience mismatch, content claim not authorizable, or any unexpected response → **refuse**. No cache, no
grace period, no last-known-good.

**No break-glass.** The review advised against adding one for completeness, and I have not. If operations
later need it, it should be a separately authorized, narrowly scoped, time-limited incident mechanism with
its own audit path — never a boolean bypass evaluated when the gate is unavailable.

---

## 3. The trust boundary

**The gate is a separate process with its own database. It is the authority over review records and
attestations. Everything else is a client with no privilege beyond its credential.**

### 3.1 Residual trust — the complete list

- The gate's **process, database, and host**; its **exclusive** database credentials (no shared user with
  the control-center).
- **Backups, restores, and database administrators.** A point-in-time restore silently un-rejects content.
- The **principal-provisioning plane** — whoever runs the operator CLI defines who may review.
- **Bearer credential lifecycle**: generation, storage, rotation, revocation, log redaction.
- **Transport termination** and the private network path.
- **The executors**, once wired: each is trusted to consult the gate, and to hash *the exact bytes and
  payload it will apply*. The attestation binds `actionDigest`; it cannot verify the executor computed it
  honestly.
- **Canonical digest calculation** and the artifact store's digest→bytes mapping.
- **Executor target identity** — that an executor claiming `serverId` is that server.
- **Trusted time and entropy**, for expiry and identifier generation.
- **The owner's authentication and signing workstation**, for layer 2.
- **Release registry / artifact distribution integrity.**
- **Availability**: fail-closed makes the gate a release-blocking dependency.
- **Test provenance** — still an authenticated assertion by a CI identity. Standing owner-authority item.

**Correction carried from v2:** I wrote that Option C "would remove" database trust. It would not.
Signatures make forged or altered decisions *detectable*; they do not prevent deletion, rollback,
withholding, or denial of service.

---

## 4. Process and repository shape

New workspace `control-center/apps/review-gate/`, following `apps/api` conventions: Express, MongoDB, ESM,
`tsx --test`, own `Dockerfile` and `tsconfig.json`.

```
apps/review-gate/src/
  server.ts    process entry; the ONLY place the store is constructed
  routes.ts    the API surface
  auth.ts      credential -> principal, from the gate's own registry
  store.ts     Mongo; not exported from any package
  policy.ts    evaluator and transition table (moved from packages/shared)
  service.ts   the operations (moved from packages/shared)
```

Policy leaves `packages/shared`; a thin client remains. **This is hygiene, not the security argument** —
the review was explicit that the real boundary is process isolation, exclusive credentials, server-side
authentication, and downstream enforcement.

---

## 5. Identity

```
principals {
  _id, displayName,
  credentialHash,              // Argon2id; never the credential
  reviewerClasses: [...],      // e.g. ["independent"]
  roles: [...],                // author | ci | reviewer | owner | executor
  audienceFor?: [...],         // for executors: which targets they may act on
  createdAt, disabledAt?, credentialRotatedAt?
}
```

A caller cannot name itself, name a reviewer, or claim a class. Provisioning is an **operator CLI** run by
the owner; every provisioning action appends to an audit collection. **I will create no credentials.**
Hashing protects the database, not against a stolen token — hence rotation and revocation in the CLI.

---

## 6. API surface

| method | path | effect |
| --- | --- | --- |
| `POST` | `/candidates` | register |
| `POST` | `/candidates/:id/successors` | register a replacement |
| `POST` | `/candidates/:id/evidence` | record a test execution |
| `POST` | `/candidates/:id/actions/:action` | one named lifecycle action (§7) |
| `POST` | `/candidates/:id/verdicts` | GO / NO_GO with findings |
| `POST` | `/candidates/:id/owner-decision` | accept the review outcome; mint attestations |
| `POST` | `/attestations/:id/reserve` | executor takes a lease |
| `POST` | `/attestations/:id/redeem` | executor completes |
| `POST` | `/attestations/:id/revoke` | owner |
| `GET` | `/candidates/:id` | read-only projection |
| `GET` | `/healthz` | liveness; no data |

Named actions, not a generic transition endpoint: the client names an *intent*, the gate derives the
transition. A client naming a target state was how callers stayed involved in deciding their own position.

---

## 7. Authorization matrix — complete

`from state × action × role × relationship → allow/deny`. Nothing is authorized by absence of a rule.

| action | legal from | who may | notes |
| --- | --- | --- | --- |
| `register` | — | author | claim must be absent (§8) |
| `submit-tests` | BUILT, RETEST_REQUIRED | ci | evidence must match and post-date any remediation |
| `record-test-failure` | BUILT, RETEST_REQUIRED | ci | |
| `freeze` | TESTED | author or participant | |
| `request-review` | FROZEN, REVIEW_BLOCKED | author or participant | **grants no role** |
| `claim-review` | REVIEW_REQUESTED | reviewer holding the requested class **and not a participant** | the only stranger entry point; **grants no role**; records `claimedByPrincipalId` |
| **`submit-go`** | REVIEW_IN_PROGRESS | **the recorded claiming reviewer**, still holding the class, **independence rechecked in the transaction** | refused while findings stand undischarged |
| **`submit-no-go`** | REVIEW_IN_PROGRESS | as above | must carry ≥1 finding |
| `block-review` | **REVIEW_IN_PROGRESS only** | the claiming reviewer | v2 allowed this from REVIEW_REQUESTED, where no claimant exists — that branch was unreachable. Corrected. |
| `begin-remediation` | REMEDIATION_REQUIRED | author or participant | records remediator |
| `submit-retest-request` | REMEDIATING | remediator | |
| `owner-decision` | GO | owner | mints attestations (§2.3) |
| `reserve` | attestation OPEN | the attestation's `audiencePrincipalId` | + content claim authorizable |
| `redeem` | attestation RESERVED | the lease holder | matching `leaseId` |
| `revoke` | attestation OPEN or RESERVED | owner | CAS against consumption |
| `cancel` | any non-terminal | author or owner | releases the claim |
| `expire` | any non-terminal | the gate, on a timer | releases the claim |

**v2's CRITICAL was that verdicts were absent from this table** and the API asked only for "a reviewer
holding the class" — so a participant who also held the reviewer role could have submitted one, and a
reviewer who never claimed the review could too. Both are now closed: the submitter must be **the recorded
claimant**, and independence is rechecked **at verdict time inside the transaction**, not only at claim
time.

**How participation is acquired**, since self-enrolment was a real defect: only by authoring the binding,
by `begin-remediation`, or by submitting a verdict. `request-review` and `claim-review` grant nothing.

---

## 8. `contentClaims` — one document per digest, with an exhaustive transition table

```
contentClaims {
  _id: contentDigest,
  disposition: "LIVE" | "RELEASED" | "REJECTED",
  liveCandidateId?, releasedByCandidateId?, rejectedByCandidateId?,
  rejectedAt?, releasedAt?, version
}
```

v2 said only "must not be REJECTED; claim LIVE", which permitted overwriting another candidate's claim,
moving `RELEASED → LIVE`, and multiple candidates for one digest while `liveCandidateId` names one.

| from | action | to | condition |
| --- | --- | --- | --- |
| *(absent)* | register | LIVE | document must not exist; insert wins by `_id` uniqueness |
| LIVE (held by P) | successor transfer | LIVE (held by S) | `liveCandidateId === P` — atomic replace, never a blind overwrite |
| LIVE | cancel / expire | *(deleted)* | `liveCandidateId` must match the candidate releasing it |
| LIVE | NO_GO | REJECTED | terminal |
| LIVE | owner-decision | RELEASED | `liveCandidateId` must match |
| RELEASED | *any registration* | — | **denied.** Reviewed-and-released work is not re-registrable; a change produces a different digest |
| RELEASED | further attestations | RELEASED | additional `kind`/target attestations may be minted from the same released candidate without overwriting history |
| REJECTED | *anything* | REJECTED | **monotonic.** No transition out, enforced by conditional update |

`RELEASED` stays distinct from `LIVE`: it means no review candidate is active *and* the owner accepted the
outcome. It is a durable disposition, not a reusable "not rejected" state.

### 8.1 Transaction boundaries and postconditions

MongoDB **as a replica set** is required — confirmed as the right call rather than contorting the model to
suit standalone Mongo.

| endpoint | one transaction over | postcondition |
| --- | --- | --- |
| register | idempotency, `contentClaims` insert, candidate | a candidate exists holding a LIVE claim, or nothing |
| successor | idempotency, predecessor superseded + verdict surface closed, inherited finding occurrences snapshotted, successor created, claim transferred | the whole chain, or nothing |
| evidence | idempotency, evidence uniqueness, candidate association | recorded once, or not at all |
| action | idempotency, state CAS, occurrence, participation row, claim read where approaching GO | the move with its ledger rows, or nothing |
| verdict | idempotency, state CAS, verdict + finding occurrences, claim disposition | the verdict and its consequences, or nothing |
| owner-decision | idempotency, state CAS, claim → RELEASED, attestations minted | attestations exist for released content, or nothing |
| reserve | attestation CAS `OPEN → RESERVED`, lease write, **claim read**, audience check | leased once, or refused |
| redeem | attestation CAS `RESERVED → CONSUMED` on matching `leaseId`, outcome, **claim read** | consumed exactly once, or refused |
| **revoke** | attestation CAS on state ∈ {OPEN, RESERVED}, idempotency, audit | **linearizable against redeem**: either revoke wins and redeem fails, or redeem wins and revoke reports it was too late |
| **provision / rotate / disable principal** | principal write, audit append | both, or neither |
| **expiry sweep** | per-candidate state CAS, occurrence, claim release | each candidate expires wholly or not at all |

v2 omitted revoke, provisioning and the expiry sweep. All three mutate authoritative state.

### 8.2 Idempotency as a database invariant

```
idempotency { _id: { principalId, scope, key }, requestHash, status, result?, createdAt, expiresAt }
```

Committed **in the same transaction** as the mutation. A repeated key with a different `requestHash` is an
error, never a silently unrelated result.

### 8.3 Occurrence-scoped findings

Every accepted finding gets a **gate-generated immutable occurrence id**. Inheritance and discharge
reference occurrence ids, never the reviewer's chosen label, so a reused label cannot conflate unrelated
defects. The label is kept for display only. This closes candidate K's declared `rec-4`.

---

## 9. What carries over

Candidate and content identity, the transition table, independence, evidence records, accumulated findings
with reviewer-only causal discharge, remediation lineage, billing classes — **189 tests move with them.**

Round-10 defects fixed by the move: successor inheritance becomes one transaction; the capability concept
disappears entirely, because there is no injected store to hand a token to.

---

## 10. What I will not do

No deployment. No public port. No credential creation. No DNS change. No production data. No live route or
executor wiring. No change to the offline owner key or layer 2. The deliverable runs locally and in tests,
with a Dockerfile and `.env.example`.

---

## 11. Questions for this review

1. **§2 — does layering the attestation as a third check alongside the existing envelope and offline-owner
   signatures compose correctly**, and is "inert until configured" the right rollout, matching how layer 2
   was introduced?
2. **§2.5 — is reserve/apply/redeem the right protocol**, and is my division of responsibility honest:
   the gate guarantees at most one open window, the executor guarantees at-most-once application?
3. **§8 — is the claim transition table exhaustive**, and is denying registration from `RELEASED` correct?
4. **§7 — which row is still wrong or missing?**
5. **§8.1 — is any boundary still too narrow?**
6. **Is this now build-ready?** If yes I will start implementing. If a fourth revision is needed, say what
   must change — that is far cheaper than another ten rounds against code.
