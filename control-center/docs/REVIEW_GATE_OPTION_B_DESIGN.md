# Review gate as a separate service — design for review

**Date:** 2026-09-02
**Author:** Claude
**Status:** **DESIGN — NOT IMPLEMENTED.** Seeking design review before any code is written.
**Decision it implements:** Owner chose **Option B** from `REVIEW_GATE_TRUST_BOUNDARY_DECISION.md`.

---

## Why this document exists before the code

Ten rounds of independent review, ten NO-GOs, on implementations of a design that was wrong. The reviewer
diagnosed it in round 9: the design treated packaging mechanisms as authority boundaries. Reviewing the
eleventh implementation of that idea would have been the same mistake at a larger scale.

**So the design gets reviewed first.** If the trust model below is wrong, that is a paragraph to fix, not
a service to rebuild.

---

## 1. The trust boundary, stated once and precisely

**The review gate is a separate process with its own database. It is the authority. Everything else is a
client with no privilege beyond what its credential grants.**

That single sentence is what the previous ten candidates could not say. Specifically:

| | previous design | this design |
| --- | --- | --- |
| who supplies the store | the application | **nobody — the gate constructs it** |
| who supplies identity | the application (`SessionAuthenticator`) | **the gate, from its own principal registry** |
| where the policy evaluator runs | the caller's process | **the gate's process** |
| what the caller can reach | every injected object | **an HTTP API** |
| what a caller bug can corrupt | all authoritative state | **its own requests** |

The control-center is **not** trusted. It holds a credential that lets it register candidates and request
transitions. It cannot approve anything, cannot write state, and cannot see the gate's database.

### What is still trusted, stated so it is not discovered later

- **The gate's own process and database.** Whoever can write to the gate's Mongo can forge anything.
  Defence is deployment isolation — separate credentials, no shared database user with the control-center
  — not code. **Option C (signed decisions) is what would remove this**, and is not in scope here.
- **The gate's host and operator.**
- **Test provenance remains unsolved** — a recorded run is still an authenticated assertion by a CI
  identity. Unchanged by this design; still the standing owner-authority item.

---

## 2. Process and repository shape

New workspace `control-center/apps/review-gate/`, following the existing `apps/api` conventions: Express,
MongoDB driver, ESM, `tsx --test`, its own `Dockerfile` and `tsconfig.json`.

```
apps/review-gate/
  src/
    server.ts         process entry; composes everything; the ONLY place the store is constructed
    routes.ts         the API surface — the only door
    auth.ts           credential -> principal, from the gate's own registry
    store.ts          Mongo implementation; not exported from any package
    policy.ts         the evaluator and transition table (moved from packages/shared)
    service.ts        the operations (moved from packages/shared)
  test/
```

**`packages/shared` keeps no review-gate policy.** Its `reviewGate*.ts` modules move into the service.
What remains in `shared` is a **client**: request/response types and a thin HTTP caller with no store, no
capability, no evaluator, and nothing that can be injected.

This is the structural point. In the old design the boundary was a rule about which symbols were
exported. Here, the policy code is **not in a package the control-center depends on at all.**

---

## 3. Identity — the fix that matters most

Previously `SessionAuthenticator` was an interface the *application* implemented, so identity and reviewer
authority were whatever the caller said they were.

**The gate owns identity.** A `principals` collection maps a credential to an identity and its reviewer
classes:

```
principals: {
  principalId, displayName,
  credentialHash,          // Argon2id or scrypt; never the credential itself
  reviewerClasses: [...],  // e.g. ["independent"]
  roles: [...],            // e.g. ["author"], ["ci"], ["reviewer"]
  disabledAt?
}
```

Every request authenticates with a bearer credential. The gate resolves it to a principal. **A caller
cannot name itself, name a reviewer, or claim a reviewer class.**

Provisioning is an **operator CLI**, run by the owner, that writes a principal and prints the credential
once. **I will create no credentials.** The CLI and a `.env.example` are the deliverable; every real
secret is the owner's to generate.

---

## 4. The API surface — the only door

All routes require an authenticated principal. Nothing accepts state, ledgers, digests-of-record, or
identity from the body.

| method | path | who | effect |
| --- | --- | --- | --- |
| `POST` | `/candidates` | author | register; body is the binding only |
| `POST` | `/candidates/:id/successors` | prior author / remediator | register a replacement |
| `POST` | `/candidates/:id/evidence` | ci (not the author) | record a test execution |
| `POST` | `/candidates/:id/transitions` | participant, or reviewer claiming | request one move |
| `POST` | `/candidates/:id/verdicts` | reviewer holding the class | GO / NO_GO with findings |
| `GET` | `/candidates/:id` | any authenticated | read-only projection |
| `GET` | `/healthz` | unauthenticated | liveness only, no data |

Idempotency: every mutating request carries `Idempotency-Key`, stored with the occurrence, so a retry is a
no-op rather than a second transition. This replaces the `occurrenceId` the caller used to invent.

---

## 5. The four atomic invariants, as database operations

These are the invariants the in-memory store satisfied for free and that §H.16 has been carrying as risk.
Owning the deployment lets them be enforced by the database rather than by a contract comment.

1. **State compare-and-set** — `findOneAndUpdate({_id, state: expected}, {$set:{state: next}, $push:{occurrences}})`.
   Single document, atomic without a transaction.
2. **Content uniqueness among live candidates** — a `liveContent` collection with a **unique index on
   `contentDigest`**. Insert on registration, delete on `CANCELLED`/`EXPIRED`. A duplicate insert fails on
   the index, so the invariant is the database's, not the code's.
3. **Rejection is permanent** — a `rejectedContent` collection with a unique index on `contentDigest`.
4. **Verdict + findings + rejection commit together** — this one genuinely needs a **multi-document
   transaction**, so the gate **requires MongoDB as a replica set**. That is a deployment constraint and I
   am stating it as such rather than discovering it later.

**Open question for the reviewer:** is requiring a replica set acceptable, or should the verdict write be
restructured to a single document so a standalone Mongo suffices? I lean towards requiring the replica
set, because expressing all four invariants in one document would mean denormalising the rejection ledger
into every candidate.

---

## 6. What the control-center does instead

`apps/api` gains a client that calls the gate. The existing approval routes are unchanged in this phase —
**no live route is rewired**, consistent with the standing freeze. Wiring is a separate, later candidate
with its own review.

---

## 7. Migration and what carries over

The policy work from ten rounds moves rather than being rewritten: candidate and content identity, the
transition table, independence, evidence records, accumulated findings with reviewer-only causal
discharge, remediation lineage, billing classes. **189 tests move with it.**

Two round-10 defects are fixed as part of the move, because both are policy bugs the new shape makes
easier:

- **successor inheritance was a non-atomic snapshot** — a superseded predecessor could collect a new
  finding the successor never saw. Fixed by marking the predecessor superseded in the same transaction
  that creates the successor, and refusing further verdicts on it.
- **the capability tests passed for the wrong reason.** The capability concept disappears entirely — there
  is no injected store to hand a token to — so the tests go with it.

---

## 8. What I will not do

No deployment. No public port. No credential creation. No DNS change. No production data. No live route
rewiring. The deliverable is a service that runs locally and in tests, with a Dockerfile and an
`.env.example`, and is deployed only on the owner's separate instruction.

---

## 9. Questions I want the design review to answer

1. **Is the trust boundary in §1 correct and completely stated?** Specifically: is "the gate's database is
   trusted" an acceptable residual, given Option C was deferred?
2. **Does moving the policy out of `packages/shared` actually close the pattern**, or have I relocated it
   again? This is the fifth time I have claimed a boundary; assume the same failure.
3. **Is gate-owned identity (§3) right**, or does it just move the `SessionAuthenticator` problem into a
   collection the operator populates?
4. **§5.4 — replica set, or restructure to avoid transactions?**
5. **Is there an ordering or partial-failure case** in the API that the four invariants do not cover — a
   request that half-applies across two collections?
6. **What in this design would you expect to be the first thing to fail review?**
