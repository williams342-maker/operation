# Review gate as a separate service — design v2

**Date:** 2026-09-02
**Author:** Claude
**Status:** **DESIGN — NOT IMPLEMENTED.** Revision 2, after design review.
**Decision it implements:** Owner chose **Option B** from `REVIEW_GATE_TRUST_BOUNDARY_DECISION.md`.

---

## Why this document exists before the code

Ten rounds of independent review went into implementations of a design that was wrong. So the design gets
reviewed first. Revision 1 was reviewed and returned **NO-GO** — against the enforcement and persistence
protocol, explicitly *not* against Option B itself:

> "The separate-service decision itself is good; the NO-GO is against the incomplete enforcement and
> persistence protocol."

**The most important thing that review found, and that revision 1 missed entirely:**

> "Building an authoritative service is insufficient unless the protected action accepts authorization
> only from that service. A compromised control-center can otherwise skip the HTTP client and drive its
> existing approval/release path directly."

I had designed an authority over *records* and never named what stops anyone ignoring it. That is the same
overclaim as the previous ten rounds, one level up: a boundary that exists only if everyone agrees to
respect it. §2 is the answer and is now the first substantive section rather than an afterthought.

---

## 1. The one-sentence honest status

**Until the enforcement point in §2 is wired, this gate is ADVISORY.** It records and enforces the review
lifecycle for callers that use it. It prevents nothing for a caller that does not.

That sentence stays in this document, in the service's README, and in `/healthz`'s response body until
§2.3 is implemented and reviewed. Ten rounds of my handoffs described advisory mechanisms as boundaries;
this one says which it is.

---

## 2. The enforcement point — what actually stops the protected action

### 2.1 What is protected

The protected actions in this estate are the ones that change a machine or a customer-visible system:

| protected action | performed by |
| --- | --- |
| apply a configuration deployment plan | the agent on the target host |
| apply an agent upgrade / rollout | the updater on the target host |
| publish an agent release | the release pipeline |

**The control-center is not on that list.** It *requests* these things; it does not perform them. That is
what makes Option B enforceable at all: the component that performs the action is a different process
from the one that must not be able to self-approve.

### 2.2 Why the executor cannot accept a control-center assertion

Today the executor acts on an instruction from the control-center. Under this design an instruction is not
authorization. The executor must hold **its own credential to the gate** and obtain authorization itself.
A field in the instruction — `approved: true`, or an id the control-center chose — is exactly the
caller-supplied authority this whole workstream exists to eliminate.

### 2.3 Release authorization: a single-use grant, not a state to query

The review asked whether `READY_FOR_OWNER_DECISION` is durable authorization, a current-state query, or a
one-time grant. **It is none of them — it is a precondition.** Reaching it permits the *owner* to decide;
it does not authorize execution.

When the owner decides, the gate mints a **release authorization**:

```
releaseAuthorizations {
  _id: authorizationId,        // gate-generated; the control-center never chooses it
  contentDigest,               // what is authorized — the work, not a candidate id
  targetEnvironmentClass,      // where
  grantedByPrincipalId,        // the owner principal that decided
  grantedAt, expiresAt,        // short-lived
  consumedAt?, consumedByPrincipalId?, consumedForTarget?,
  revokedAt?, revokedReason?
}
```

Properties, each chosen against a specific failure:

- **Single-use.** Consumption is a conditional update on `consumedAt: null` in the same transaction that
  records it. A replayed authorization loses the CAS. *(Against replay.)*
- **Scoped to content and environment.** Not to a candidate id, so relabelling cannot move it; not
  environment-agnostic, so a staging grant cannot deploy production. *(Against laundering.)*
- **Short-lived.** An expired grant is refused. *(Against stale caching.)*
- **Revocable.** Revocation is checked at consumption, inside the transaction.
- **Verified by the executor, against the gate, using the executor's own credential.** The executor sends
  `authorizationId` plus the digest of what it is *about to apply*, and the gate refuses if they disagree.
  *(Against substituting different content under a valid grant.)*

### 2.4 Fail closed

| condition | executor behaviour |
| --- | --- |
| gate unreachable / timeout | **refuse to act.** No cache, no grace period, no "last known good". |
| authorization unknown, expired, consumed, revoked | refuse |
| digest mismatch | refuse |
| gate returns anything unexpected | refuse |

There is no offline path. If the gate is down, deployment stops — that is the intended trade, and it is
the owner's to overrule explicitly rather than mine to soften with a fallback.

### 2.5 Sequencing, stated honestly

Wiring the executors is **a later candidate with its own review**, consistent with the deployment freeze.
This document defines the contract now because, as the review put it, *"'wiring later' is acceptable
sequencing; leaving the enforcement point undefined is not."*

---

## 3. The trust boundary

**The review gate is a separate process with its own database. It is the authority over review records and
release authorizations. Everything else is a client with no privilege beyond its credential.**

| | previous design | this design |
| --- | --- | --- |
| who supplies the store | the application | **nobody — the gate constructs it** |
| who supplies identity | the application (`SessionAuthenticator`) | **the gate, from its own principal registry** |
| where the evaluator runs | the caller's process | **the gate's process** |
| what the caller can reach | every injected object | **an HTTP API** |
| what authorizes execution | an instruction | **a single-use grant the executor fetches itself** |

### 3.1 The complete residual trust statement

Everything below is trusted and is **not** defended by this design. The review asked for the full list; an
incomplete one is how the previous rounds went wrong.

- **The gate's process, database, and host.**
- **The database's credentials**, which must be exclusive to the gate — no shared user with the
  control-center. This is a deployment requirement, not a code property.
- **Backups, restores, and anyone with database administrator access.** A restore to an earlier point
  silently un-rejects content.
- **The principal-provisioning plane** — whoever runs the operator CLI defines who may review.
- **Bearer credential handling**: generation, storage, rotation, revocation, and keeping them out of logs.
- **Transport termination and the private network path** between callers and the gate.
- **The executors** in §2, once wired: each is trusted to actually consult the gate.
- **Availability.** Fail-closed means the gate is a release-blocking dependency.
- **Test provenance**, still an authenticated assertion by a CI identity. Unchanged; still the standing
  owner-authority item.

**Correction to revision 1:** I wrote that Option C "would remove" database trust. The review is right
that it would not. Signatures make forged or altered decisions *detectable*; they do not prevent deletion,
rollback, withholding, or denial of service. Option C narrows this list; it does not empty it.

---

## 4. Process and repository shape

New workspace `control-center/apps/review-gate/`, following `apps/api` conventions: Express, MongoDB
driver, ESM, `tsx --test`, its own `Dockerfile` and `tsconfig.json`.

```
apps/review-gate/
  src/
    server.ts      process entry; the ONLY place the store is constructed
    routes.ts      the API surface
    auth.ts        credential -> principal, from the gate's own registry
    store.ts       Mongo; not exported from any package
    policy.ts      evaluator and transition table (moved from packages/shared)
    service.ts     the operations (moved from packages/shared)
  test/
```

Review-gate policy **leaves `packages/shared` entirely**. What remains there is a client: request/response
types and a thin HTTP caller, with no store, no capability, and no evaluator.

**On whether this is the fifth packaging mistake** — the review answered no, and corrected my framing:

> "The real boundary is process isolation, exclusive database credentials, server-side authentication, and
> downstream enforcement. Removing policy from `shared` is useful hygiene, not the security proof."

So it is recorded here as hygiene. The security argument is §2 and §3, not the module layout.

---

## 5. Identity

A `principals` collection maps a credential to an identity and its authorities:

```
principals {
  _id: principalId,            // immutable, gate-generated
  displayName,
  credentialHash,              // Argon2id; never the credential
  reviewerClasses: [...],      // e.g. ["independent"]
  roles: [...],                // "author" | "ci" | "reviewer" | "owner" | "executor"
  createdAt, disabledAt?, credentialRotatedAt?
}
```

A caller cannot name itself, name a reviewer, or claim a class. Provisioning is an **operator CLI** run by
the owner, which writes a principal and prints the credential once; all provisioning actions append to an
audit collection.

**I will create no credentials.** The CLI and a `.env.example` are the deliverable.

The review's caveat is recorded: hashing protects the database, not against a stolen token. Rotation and
revocation are in the CLI for that reason.

---

## 6. The API surface

All routes require an authenticated principal. Nothing accepts state, ledgers, participation facts, or
identity from the body.

| method | path | role required | effect |
| --- | --- | --- | --- |
| `POST` | `/candidates` | author | register; body is the binding only |
| `POST` | `/candidates/:id/successors` | prior author / remediator | register a replacement |
| `POST` | `/candidates/:id/evidence` | ci, **not** the candidate's author | record a test execution |
| `POST` | `/candidates/:id/actions/:action` | see §7 | one named lifecycle action |
| `POST` | `/candidates/:id/verdicts` | reviewer holding the requested class | GO / NO_GO with findings |
| `POST` | `/candidates/:id/owner-decision` | owner | mint a release authorization |
| `POST` | `/authorizations/:id/consume` | executor | single-use consumption, digest checked |
| `POST` | `/authorizations/:id/revoke` | owner | revoke |
| `GET` | `/candidates/:id` | any authenticated | read-only projection |
| `GET` | `/healthz` | unauthenticated | liveness only; no data |

**Named actions, not a generic transition endpoint.** The review recommended this and it removes a class
of mistake: a client naming a target state was how the caller stayed involved in deciding its own
position. The client names an *intent*; the gate derives the transition.

---

## 7. Transition authorization matrix

Every action is `from state × action × authenticated role × existing relationship → allow/deny`. Nothing
is authorized by absence of a rule.

| action | legal from | who may | notes |
| --- | --- | --- | --- |
| `submit-tests` | BUILT, RETEST_REQUIRED | ci | requires matching evidence recorded after any remediation |
| `record-test-failure` | BUILT, RETEST_REQUIRED | ci | |
| `freeze` | TESTED | author or participant | |
| `request-review` | FROZEN, REVIEW_BLOCKED | author or participant | **grants no role** |
| `claim-review` | REVIEW_REQUESTED | reviewer holding the requested class, **not** a participant | the only stranger entry point; grants no role |
| `block-review` | REVIEW_REQUESTED, REVIEW_IN_PROGRESS | the claiming reviewer | |
| `begin-remediation` | REMEDIATION_REQUIRED | author or participant | records remediator |
| `submit-retest-request` | REMEDIATING | remediator | |
| `cancel` | any non-terminal | author, or owner | releases the content claim |
| `expire` | any non-terminal | gate itself, on a timer | releases the content claim |

**How participation is acquired**, since self-enrolment was a real defect: only by being the binding's
author, by being recorded as a remediator through `begin-remediation`, or by submitting a verdict.
`request-review` and `claim-review` deliberately grant nothing.

---

## 8. Persistence: one authority document per content digest

Revision 1 proposed separate `liveContent` and `rejectedContent` collections with unique indexes. **The
review showed that cannot enforce the cross-collection invariant** — for one digest, transaction A sees no
rejection and inserts live, while B sees no live candidate and inserts rejected; different documents in
different collections, so both commit. Write skew, which a transaction does not prevent by itself.

**One document per digest, and every relevant operation contends on it:**

```
contentClaims {
  _id: contentDigest,          // the digest IS the key
  disposition: "LIVE" | "RELEASED" | "REJECTED",
  liveCandidateId?, rejectedByCandidateId?, rejectedAt?,
  version
}
```

- `REJECTED` is **monotonic**. Nothing transitions it back. Enforced by conditional update, not by code
  discipline.
- Registration, successor creation, cancel/expire, rejection, and every step toward GO all read or update
  **this one document inside their transaction**, so competing operations contend on a single document.

As the review put it, this is not denormalising the rejection ledger into every candidate — it is the
digest-level aggregate the guarantee actually belongs to.

## 8.1 Transaction boundaries and postconditions

MongoDB **as a replica set** is required. The review confirmed this is the right call rather than
contorting the model to suit standalone Mongo. Every mutating endpoint declares its boundary:

| endpoint | one transaction over | postcondition |
| --- | --- | --- |
| register | idempotency record, `contentClaims` (must not be REJECTED; claim LIVE), candidate | either a candidate exists holding a LIVE claim, or nothing changed |
| successor | idempotency, predecessor marked superseded and verdict-closed, inherited finding occurrences snapshotted, successor created, successor's claim | either the full chain exists, or nothing |
| evidence | idempotency, evidence uniqueness, candidate association | either recorded once, or not at all |
| action | idempotency, state CAS, occurrence, participation row, `contentClaims` read where the action approaches GO | either the move applied with its ledger rows, or nothing |
| verdict | idempotency, state CAS, verdict + finding occurrences, `contentClaims` disposition | either the verdict and its consequences, or nothing |
| owner-decision | idempotency, state CAS, `contentClaims` → RELEASED, authorization minted | either an authorization exists for released content, or nothing |
| consume | authorization CAS on `consumedAt: null`, digest and environment match, revocation check | either consumed exactly once, or refused |

A crash therefore cannot leave an orphan candidate, a released claim with a live candidate, a successor
without a superseded predecessor, or an applied mutation without its replay record.

## 8.2 Idempotency as a database invariant

Revision 1's "stored with the occurrence" did not cover creation endpoints or concurrent retries.

```
idempotency {
  _id: { principalId, scope, key },     // unique
  requestHash,                          // canonical hash of the request
  status: "IN_PROGRESS" | "COMPLETED",
  result?,                              // stable identifiers to replay
  createdAt, expiresAt                  // TTL index
}
```

The idempotency record and the business mutation **commit in the same transaction**. A repeated key with
a *different* request hash is an error, never a silently unrelated result.

## 8.3 Occurrence-scoped findings

Candidate K's declared `rec-4`, now closed in the design. Every accepted finding gets a **gate-generated
immutable occurrence id**. Successor inheritance and reviewer discharge reference occurrence ids, not the
reviewer's chosen label — so a reused id cannot conflate unrelated defects across verdicts or lineage. The
reviewer's own label is kept for display only.

---

## 9. What carries over

Policy from ten rounds moves rather than being rewritten: candidate and content identity, the transition
table, independence, evidence records, accumulated findings with reviewer-only causal discharge,
remediation lineage, billing classes. **189 tests move with it.**

Two round-10 defects are fixed by the move:

- **successor inheritance was a non-atomic snapshot** — now one transaction that supersedes the
  predecessor, closes its verdict surface, and snapshots inherited finding occurrences.
- **the capability tests passed for the wrong reason** — the capability concept disappears, because there
  is no injected store to hand a token to.

---

## 10. What I will not do

No deployment. No public port. No credential creation. No DNS change. No production data. No live route or
executor wiring. The deliverable runs locally and in tests, with a Dockerfile and an `.env.example`.

---

## 11. Questions for this review

1. **§2 — is the enforcement contract now complete and correct?** In particular: is a single-use
   authorization scoped to `(contentDigest, environment)`, consumed by the executor against its own
   credential, the right shape? And is unconditional fail-closed right, or does it need an owner-declared
   break-glass that is itself audited?
2. **§8 — does the single `contentClaims` document actually close the write skew**, and are the
   dispositions right? Is `RELEASED` a distinct disposition or should released content stay `LIVE`?
3. **§7 — is the authorization matrix complete?** Which row is wrong or missing?
4. **§3.1 — is the residual trust list now complete?**
5. **§8.1 — is any transaction boundary too narrow**, i.e. is there still a partial-failure case?
6. **What would you expect to fail first now?**
