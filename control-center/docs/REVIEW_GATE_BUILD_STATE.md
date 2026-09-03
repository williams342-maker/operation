# Review gate (Option B) — build state

**Date:** 2026-09-02
**Disposition:** **GO — for the scope it covers.** Independent implementation review returned GO at
round 5 with no findings, after four NO-GO rounds. **The GO is scoped and does not cover the four open
items in §Open below**, which the reviewer excluded explicitly.
**Design:** `REVIEW_GATE_OPTION_B_DESIGN.md` v7, after six design reviews.
**Branch:** `feat/review-gate-20260902`. **Production mutations: 0. Credentials created: 0.**

---

## The honest status, first

**This gate is ADVISORY in practice.** The enforcement point (design §2) is now wired into the executor —
candidate W1, `8d675d99`, review ready and NOT yet reviewed — but every executor is `DISABLED`, and
activation is an owner decision that has not been taken. A `DISABLED` executor behaves exactly as it did
before the wiring, so the gate still prevents nothing today. That sentence is in the README, in
`/healthz`, in the startup log, and here, and it stays until an executor is activated and that activation
is reviewed.

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
| 10 | **Round-1 review remediation** — two CRITICALs, five MAJORs, one MINOR |
| 11 | **Rounds 2–4 remediation** — see the review record below |

**162 tests: 161 pass, 1 visible skip.** Typecheck clean across all five workspaces **and across the test
sources**. `packages/shared` 79 (1 pre-existing skip); `apps/agent` 64.

Counts are not monotonic across phases: phase 5 replaced ~60 service tests with 31, because several old
attacks are unexpressible on the new surface. The originals are in git history.

---

## Verification

| check | result |
| --- | --- |
| `npm test` in `apps/review-gate` | **PASS** — 162, 161 pass, 1 skip |
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

## The review record

Four NO-GO rounds, then GO. The findings are kept because the *pattern* is the useful artifact.

### One defect, five expressions

The principal's issuance guard was defeated five separate times, and **each previous fix was real**:

| round | the guard I had | how it was defeated |
| --- | --- | --- |
| — | `private constructor` | TypeScript privacy is erased; `new` worked at runtime. *(My own test caught this one.)* |
| 1 | a runtime key on the constructor | `AuthenticatedPrincipal.of` was **public** and supplied the key itself |
| 2 | key on the factory too | the object was **not frozen**; `roles = ["owner"]` just worked |
| 3 | `Object.freeze(this)` + `instanceof` | `Object.create(prototype)` inherited every method and satisfied both checks |
| 4 | a `#private` brand | the freeze was **shallow**: `audienceFor[0].serverId` was writable |

The brand — `#issued in value` — is what finally held, because it cannot be inherited, assigned, cloned,
or produced by a prototype trick. **Four of the five were caught by the reviewer, not by me.**

### The other CRITICALs

| round | finding |
| --- | --- |
| 1 | Rotation did not invalidate work in flight — the epoch was compared to the **lease**, never the principal |
| 2 | A lease never checked **who held it**: any principal at a matching epoch could acquire someone else's |
| 3 | Mongo revalidation was **advisory** — a transaction that only *reads* the principal takes no lock, so a rotation could commit alongside it |

### And three findings about my own tests

| round | what the test claimed | what it did |
| --- | --- | --- |
| 1 | proved the forging path was closed | **used that path** as its normal way of obtaining authority |
| 2 | drove four lease operations as a non-holder | never created the attestation, so all four refused earlier |
| 2 | proved every mutation revalidates | asserted only "refused", which any broken method would satisfy |

Plus: **the tests were never typechecked** — `tsconfig` included only `src`. Turning that on surfaced
sixteen real type errors that had been sitting there.

## What round 1 of implementation review found

Both CRITICALs were the same species: **a guard that was real, defeated by a door standing open beside
it.** That is the shape this workstream keeps producing.

| | finding | what it means |
| --- | --- | --- |
| **C2** | `AuthenticatedPrincipal.of` was **public** and took a caller-built object, supplying the private symbol itself | Any module could mint an owner. I had put a runtime guard on the constructor after my own test caught the erased TypeScript one — then handed out what the guard protected, through a factory beside it. **And my tests used that route**, which is why the suite was silent: not by accident, but because the tests took the forging path as their normal way of obtaining authority. |
| **C1** | Rotation did not invalidate work in flight | The epoch was compared only with the epoch stored in the **lease**, so a request authenticated at epoch 1 holding a lease stamped at epoch 1 still matched after a rotation to epoch 2. My operator comment asserted the opposite. |
| M3 | The store still had the round-8 primitive under another name | `applyAction` took `expectedState`/`nextState` plus participation, claimant and claim-release, so a holder could request any graph-legal change while choosing the audit identity. Checking the graph does not make something a named operation. |
| M4 | The expiry sweep was **dead code** | Correct behaviour, called by nothing outside tests. An expired bound lease stayed `RESERVED_BOUND` for ever and never became reconcilable. A correct function nothing invokes is indistinguishable from an absent one. |
| M5 | Two specified operations were **missing entirely** | `renew`, and minting a further attestation from released content. |
| M6 | Principal change and audit entry were two writes | A crash between them left a principal changed with no record of who changed it. |
| M7 | The in-memory store moved the candidate **before** validating | "Never awaiting" prevents interleaving; it does not roll back. A real divergence from Mongo the shared conformance suite was not covering. |
| MINOR | `reserve` returned the **requested** lease expiry | The store clamps it to the attestation, so the caller got a false validity window. |

All are closed. The conformance suite now performs a real rotation mid-flight rather than hand-supplying
a mismatched epoch — **the old test would have passed against the broken code.**

## Defects my own tests caught

For ten rounds the reviewer found this class of thing and the suite did not.

- **`AuthenticatedPrincipal` had a TypeScript `private constructor`** — erased at runtime, so a route
  could have minted an owner. Fifth instance of compile-time visibility standing in for a runtime
  boundary, made *inside the class built to stop that*.
- **A real authorization bug**: `submit-tests` required the `ci` role *and* participation, so CI could not
  attest tests for anything. Would have surfaced the first time the gate touched something real.
- **The store refused a `BUILT → READY_FOR_OWNER_DECISION` jump** in a test helper I wrote carelessly.

---

## Open, and NOT covered by the GO

The reviewer stated these remain outside the GO and are not implicitly validated.



| severity | item |
| --- | --- |
| **CRITICAL (partial)** | Test evidence is separation of duties, **not provenance**. A CI identity is an authenticated caller making an assertion. Owner authority — key material. |
| **MAJOR** | The Mongo store is unverified. Everything the durable path guarantees rests on code that has not run. |
| **MAJOR** | ~~The enforcement point is not wired.~~ **Built in W1 (`8d675d99`), not yet reviewed.** Still advisory in practice: activation is an owner decision and no executor is activated. |
| **MAJOR** | ~~The executor needs a durable local claim on `actionDigest`.~~ **Built in W1** as `apps/agent/src/executionJournal.ts`, which lets the filesystem decide the race (`flag: "wx"`) rather than a read-then-write. Not yet reviewed. |
| **MAJOR (new, W1)** | A **deleted** enforcement record still reads as `DISABLED`, so root on a host defeats activation. A corrupted record throws and a missing gate config refuses startup, but absence is indistinguishable from never-activated. The fix is not local — it needs a signed bootstrap, or the gate refusing to answer an executor it believes is enforcing. |
| MINOR | Rollback targets are bound but their payload semantics are only as good as the change-set digest. |

---

## What the suite still cannot tell you

Round 1 is worth reading as evidence about the suite, not just the code. Three of its findings were
things a test could have caught and did not:

- the forging path, because the tests used it;
- the dead sweep, because nothing asserted it was driven;
- the in-memory/Mongo divergence, because the shared suite did not cover partial-failure ordering.

A green run here means the assertions hold. It has never meant the assertions are the right ones.

## Continuation

```
cd control-center/apps/review-gate && npm test
REVIEW_GATE_TEST_MONGO_URL="mongodb://localhost:27017/?replicaSet=rs0" npm test   # verifies the durable store
```

**Next action:** independent review of this candidate, then — separately — the Mongo conformance run on a
host that has a replica set, and the executor wiring as its own candidate.

**Owner action: two items** — test provenance needs key material; and whether the executors get their own
gate credentials, which is the remaining half of the trust decision.
