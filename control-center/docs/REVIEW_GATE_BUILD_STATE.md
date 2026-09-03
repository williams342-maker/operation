# Review gate (Option B) — build state

**Date:** 2026-09-02
**Disposition:** **ENGINEERING COMPLETE FOR THIS SCOPE — REVIEW READY.** All nine build phases landed.
**Design:** `REVIEW_GATE_OPTION_B_DESIGN.md` v7, after six design reviews.
**Branch:** `feat/review-gate-20260902`. **Production mutations: 0. Credentials created: 0.**

---

## The honest status, first

**This gate is ADVISORY.** It records and enforces the review lifecycle for callers that use it. It
prevents nothing for a caller that does not, because the enforcement point (design §2) is not wired to
the executors. That sentence is in the README, in `/healthz`, in the startup log, and here.

**The Mongo store has never been executed.** No replica set was available. It is typechecked, and
`test/mongoStore.test.ts` runs the *same conformance suite* the in-memory reference passes — skipping
loudly until `REVIEW_GATE_TEST_MONGO_URL` names a replica set. **Treat the durable store as unverified.**

**Nothing is deployed.** The service builds and starts, but has only ever been started against
configuration that it correctly refused.

---

## What is built

| phase | what |
| --- | --- |
| 1 | Workspace, Dockerfile, `.env.example`, README; policy moved in; **typed `subject`** on the binding |
| 2 | **Attestation state machine** — PENDING → RESERVED_UNBOUND → RESERVED_BOUND → EXECUTING → CONSUMED, plus INDETERMINATE/ABORTED and reconciliation evidence rules |
| 3 | **Persistence port + in-memory reference** — one transaction per method; no primitive that means "put this candidate in that state" |
| 4 | **Identity** — gate-owned principals, scrypt credentials, monotonic epoch, executor audience |
| 5 | **The service** — named actions, authorization matrix; policy **deleted** from `packages/shared` |
| 6 | **API surface + server** — the only door; idempotency required; startup refuses standalone Mongo |
| 7 | **Mongo store + conformance suite** — the same assertions run against both implementations |
| 8 | **Attestation service** — gate-computed `actionDigest`, per-kind payload validation, reserve/bind/acquire/redeem |
| 9 | **Attestation routes + operator CLI**; `main()` wired to the store |

**151 tests: 150 pass, 1 visible skip.** Typecheck clean across all five workspaces. `packages/shared`
79 (1 pre-existing skip); `apps/agent` 64.

Counts are not monotonic across phases: phase 5 replaced ~60 service tests with 31, because several old
attacks are unexpressible on the new surface. The originals are in git history.

---

## Verification

| check | result |
| --- | --- |
| `npm test` in `apps/review-gate` | **PASS** — 151, 150 pass, 1 skip |
| `npm test` in `packages/shared` | **PASS** — 79, 1 pre-existing skip |
| `npm test` in `apps/agent` | **PASS** — 64, 5 pre-existing skips |
| `tsc --noEmit` × 5 workspaces | **PASS** |
| `npm run build` → `dist/` | **PASS** |
| service refuses standalone Mongo at startup | **PASS** (exercised on the built artifact) |
| service refuses missing configuration | **PASS** |
| operator CLI usage / arg validation | **PASS** |
| **Mongo store conformance** | **NOT RUN** — no replica set |
| **service against a live database** | **NOT RUN** |
| **executor wiring end to end** | **NOT BUILT** — separate candidate |

---

## Deviations from the design, stated rather than slipped in

1. **scrypt, not Argon2id** (`src/auth.ts`). Argon2id needs a native dependency; adding one to a service
   that must build reproducibly in CI is a decision worth making deliberately. Moving later is a
   dependency change and a re-hash, not a redesign.
2. **`claimedByPrincipalId` is a field, not a participation row.** Design §7 requires the verdict to come
   from the recorded claimant *and* `claim-review` to grant no role. Those are only compatible if the
   claim is recorded outside the ledger.
3. **CI actions are authorized by role alone.** My first implementation required the `ci` role *and*
   participation, so CI could not attest tests for anything. A build runner is not a participant.
4. **`reviewAuthorization` added to two shared payload schemas.** Design §2.8 requires the ids to travel
   inside the payload, and both schemas are `.strict()`. Optional and inert when absent, so
   `authorizePrivilegedTask` is unchanged.

---

## Defects my own tests caught

For ten rounds the reviewer found this class of thing and the suite did not.

- **`AuthenticatedPrincipal` had a TypeScript `private constructor`** — erased at runtime, so a route
  could have minted an owner. Fifth instance of compile-time visibility standing in for a runtime
  boundary, made *inside the class built to stop that*.
- **A real authorization bug**: `submit-tests` required the `ci` role *and* participation, so CI could not
  attest tests for anything. Would have surfaced the first time the gate touched something real.
- **The store refused a `BUILT → READY_FOR_OWNER_DECISION` jump** in a test helper I wrote carelessly.

---

## Open, and not claimed

| severity | item |
| --- | --- |
| **CRITICAL (partial)** | Test evidence is separation of duties, **not provenance**. A CI identity is an authenticated caller making an assertion. Owner authority — key material. |
| **MAJOR** | The Mongo store is unverified. Everything the durable path guarantees rests on code that has not run. |
| **MAJOR** | The enforcement point is not wired. Until then the gate is advisory. |
| **MAJOR** | The executor needs a **durable** local claim on `actionDigest` before acting. The current agent's replay map is in-memory and does not survive a restart. |
| MINOR | Rollback targets are bound but their payload semantics are only as good as the change-set digest. |

---

## Continuation

```
cd control-center/apps/review-gate && npm test
REVIEW_GATE_TEST_MONGO_URL="mongodb://localhost:27017/?replicaSet=rs0" npm test   # verifies the durable store
```

**Next action:** independent review of this candidate, then — separately — the Mongo conformance run on a
host that has a replica set, and the executor wiring as its own candidate.

**Owner action: two items** — test provenance needs key material; and whether the executors get their own
gate credentials, which is the remaining half of the trust decision.
