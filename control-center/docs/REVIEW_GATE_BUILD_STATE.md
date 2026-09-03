# Review gate (Option B) — build state

**Date:** 2026-09-02
**Disposition:** **ENGINEERING IN PROGRESS.** Six build phases landed; three remain.
**Design:** `REVIEW_GATE_OPTION_B_DESIGN.md` v7 — READY TO BUILD after six design reviews.
**Branch:** `feat/review-gate-20260902`. **Production mutations: 0.**

---

## The honest status, first

**This gate is ADVISORY.** It records and enforces the review lifecycle for callers that use it. It
prevents nothing for a caller that does not, because the enforcement point (design §2) is not wired.

That sentence is in the service README, in `/healthz`, and here. It stays until executors consult the gate
and that wiring is independently reviewed.

**The service does not start.** `main()` throws: the Mongo store is not written yet. It exists to be read
and to fail loudly rather than half-run against a store that does not exist.

---

## What is built

| phase | what | tests |
| --- | --- | --- |
| 1 | Workspace, Dockerfile, `.env.example`, README; policy moved in; **typed `subject`** on the binding | 101 |
| 2 | **Attestation state machine** — PENDING → RESERVED_UNBOUND → RESERVED_BOUND → EXECUTING → CONSUMED, plus INDETERMINATE/ABORTED and reconciliation evidence rules | 115 |
| 3 | **Persistence port + in-memory reference** — one transaction per method, content claims, successor across two claim documents, idempotency | 130 |
| 4 | **Identity** — gate-owned principals, scrypt credentials, monotonic epoch, executor audience | 141 |
| 5 | **The service** — named actions, authorization matrix, findings, successors; policy **deleted** from `packages/shared` | 108 |
| 6 | **API surface + server** — the only door; idempotency required; startup refuses standalone Mongo | 122 |

**Gate: 122 tests pass. Shared: 79 (1 pre-existing skip). Typecheck clean across all five workspaces.**

Counts are not monotonic because phase 5 replaced ~60 service tests with 31 focused ones — several old
attacks are unexpressible on the new surface. The originals remain in git history.

---

## What remains

| # | item | why it is not done |
| --- | --- | --- |
| 7 | **Mongo store** implementing the port's four atomic invariants | Needs a replica set to exercise. I can write and typecheck it; I cannot run it here, and will report it **NOT RUN** rather than imply otherwise. |
| 8 | **Attestation service layer + routes** — owner-decision, reserve, bind, acquire, redeem, revoke, resolve | The store and state machine exist; the service methods and routes do not. |
| 9 | **Operator CLI** — provision, rotate, disable principals | Prints a credential once. **I create no credentials.** |
| — | **Executor wiring** (design §2) | A separate candidate with its own review, per the deployment freeze. |

---

## Deviations from the design, stated rather than slipped in

1. **scrypt, not Argon2id** (`src/auth.ts`). Argon2id needs a native dependency; adding one to a service
   that must build reproducibly in CI is a decision worth making deliberately. scrypt is memory-hard and
   adequate for high-entropy machine credentials. Moving later is a dependency change and a re-hash, not
   a redesign.
2. **`claimedByPrincipalId` is a field, not a participation row.** Design §7 requires the verdict to come
   from the recorded claimant while `claim-review` grants no role. Those are only compatible if the claim
   is recorded outside the ledger.
3. **CI actions are authorized by role alone.** My first implementation required the `ci` role *and*
   participation, so CI could not attest tests for anything. A build runner is not a participant in a
   candidate and never becomes one.

---

## Defects my own tests caught this round

Recorded because for ten rounds the reviewer found these and the suite did not.

- **`AuthenticatedPrincipal` had a TypeScript `private constructor`** — erased at runtime, so a route
  could have minted an owner. Fifth instance of compile-time visibility standing in for a runtime
  boundary; now a module-private symbol.
- **The CI authorization bug above**, which would have surfaced the first time the gate was wired to
  anything real.
- **The store refused a `BUILT → READY_FOR_OWNER_DECISION` jump** in a test helper I wrote carelessly —
  which is the store doing its job.

---

## Continuation

```
cd control-center/apps/review-gate && npm test      # 122
cd control-center/packages/shared  && npm test      # 79, 1 skip
```

Next action: **phase 7**, the Mongo store, against the transaction boundaries in design §8.3. It must
reproduce atomically what the in-memory reference gets for free by never awaiting: state CAS, the
rejection check and write, content uniqueness at registration, and the verdict-with-findings append.

**Owner action: two items, unchanged** — test provenance needs key material; and whether application code
holding the service is trusted, which is already answered "no" by Option B but still governs whether the
executors get their own credentials. See `REVIEW_GATE_TRUST_BOUNDARY_DECISION.md`.
