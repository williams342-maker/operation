# Review gate — candidate G handoff to independent review

**Date:** 2026-09-02
**Author / remediator:** Claude. I wrote every line of the candidate, including the remediation of my own
defects.
**Receiving reviewer:** Codex, or any reviewer with no prior participation on this candidate.
**Round:** 6.

> **All author-side claims here are leads and evidence pointers, not certification. Re-derive material
> findings from primary evidence.** Five rounds, and every one contained at least one claim of mine that
> the reviewer falsified. The failure mode has been consistent enough to name: **I attach a guarantee to
> the wrong thing, then describe it as though it were attached to the right one.** Round 5 was the
> clearest case — I wrote that a rejected digest could never be approved, and it took a new `candidateId`
> and nothing else to disprove it. Test the mechanism; do not read my description of it.

---

## A. Objective

A release candidate must not reach owner decision without an independent reviewer's verdict against a
specific, immutable candidate identity, and no path may substitute a test result, a self-approval, or an
unverified assertion for that verdict.

## B. Current disposition

**ENGINEERING IN PROGRESS — REVIEW READY.**

Deliberately **not** "engineering complete": round 5 pointed out that claiming completion while §G lists
three MAJOR gaps and §L says ~60% is a contradiction the document was carrying. It was, and the
disposition was the wrong one.

Not certified, not deployable, not wired into any running route.

## C. Repository and environment

| | |
| --- | --- |
| repository | `williams342-maker/operation` |
| local path | `C:\Users\Mike\Downloads\Claude\opsworkbench-handoff-20260901\repo\operation` |
| branch | `feat/review-gate-20260902` (pushed) |
| base commit | `07244a83aae47d600a9c9f062999e10e8707840f` |
| pull request | **none opened** |
| test command | `cd control-center/packages/shared && npm test` |
| node | v24.18.0, Windows |

## D. Candidate identity

| | |
| --- | --- |
| **code commit** | `ac9fb61153bb52436328900ca4d514a4faca4fef` |
| **candidate commit** | tip of `feat/review-gate-20260902` — this document is *in* the candidate, so no revision of it can name its own hash |
| predecessor | `0c220758` (candidate F, NO-GO) |
| lineage | A → C → D → E → F → **G**; see `REVIEW_GATE_HANDOFF_INDEX.md` |

```
git rev-parse origin/feat/review-gate-20260902
git diff ac9fb611..origin/feat/review-gate-20260902 -- control-center/packages/shared   # must be empty
git diff --numstat origin/main...origin/feat/review-gate-20260902
```

## E. Work completed since candidate F

### C5-2 (CRITICAL, closed) — rejection was attached to a record, not to the work

I claimed a digest receiving `NO_GO` could never reach `GO`. It was enforced as
`record.occurrences.some(o => o.to === "NO_GO")` — **one record's own history**. Registering the identical
binding under a different `candidateId` produced a record with no rejection history. No successor API, no
trickery: call `createCandidate` again with a new id.

Root cause: I enforced a global property with local state.

### C5-3 (CRITICAL, closed) — "different candidate" meant different paperwork

`createSuccessor` required a different `candidateDigest`, which covers `createdAt`, `occurrenceId`,
`authorityRef`, `requestedReviewerClass` and `testResultDigest`. Bumping a timestamp produced a
"different" candidate. **So did re-running the tests on untouched code** — the remediation check could be
satisfied by a green re-run of the defect.

Root cause: candidate identity and content identity are different questions, and I had only one digest.

**Both fixed by `contentDigest`** (`reviewGate.ts`), covering only what must change for a defect to be
gone: project, repository, base/candidate commits, tree, patch, artifact, manifest, dependency lock set,
test plan. Rejection is recorded against **content**, in a store-level ledger that outlives the record,
and rejected content is refused at **registration** rather than at approval.

**The deliberate cost:** two candidates identical in content but targeting different environments share a
content digest, so a rejection in one blocks approval in the other. That is the direction I want the
error to point, but it is a real behavioural consequence and you should decide whether you agree.

### C5-1 (CRITICAL, **PARTIALLY** closed — read this carefully)

You were right that I had added persistence and called it provenance. The author invented a
`testResultDigest`, then recorded evidence for that same invented value: self-attestation with an extra
step.

**What is now true:** evidence requires a `runnerIdentity` and a `runReference`, is pinned to the content
digest it was recorded against, and **the author of a candidate may not record its evidence**.

**What is still not true:** this is separation of duties, **not provenance**. A CI identity is an
authenticated caller making an assertion. Nothing verifies that a test ran. An attacker who controls both
an author identity and a CI identity defeats it entirely.

**Why it stops here:** real provenance needs signed execution results, which needs key material. Creating
signing keys is explicitly outside my authority on this project. **This is a genuine owner-authority
boundary, recorded in §I, not a gap I am hoping goes unnoticed.**

### M5-1 (MAJOR, closed) — anyone could supersede anybody

`createSuccessor` checked only that the prior existed, the digest differed, and the actor matched the new
author. Any authenticated user could claim to supersede someone else's unrelated candidate. Now: same
project and repository, prior must be in a supersedable state, and the actor must have participated in it.

### M2 (MAJOR, closed) — after two rounds of agreeing with it

`artifactDigest` and `manifestDigest` are now **required**. I agreed this was a production blocker in two
consecutive handoffs and left it open both times. Agreeing with a finding twice and not acting on it is
not agreeing with it.

### MO5-1 (closed) — `>=` meant "after" included "at the same instant"

Strict now. **Two of my own tests failed the moment I tightened it** — they had been passing on fixed
clocks, which is precisely the condition you described. Both now advance time.

### MO5-2 (closed) — the scan claimed five roots, the non-vacuity test checked two

One list now, asserted against reality. I expected `scripts/` and `deploy/` to hold nothing scannable and
**the new test failed**: they hold 23 files the scan was already reading. Coverage was better than I
assumed, and I only know because the assertion was written to be falsifiable.

## F. Verification performed

| check | scope | result |
| --- | --- | --- |
| `npm test` | `packages/shared` | **PASS** — 162 tests, 161 pass, 0 fail, 1 skip |
| the 1 skip | pre-existing, unrelated | SKIP |
| `tsc --noEmit` | shared, api, agent, updater | **PASS** (all four) |
| `npm run build` + inspect emitted root | `dist/index.js` | **PASS** — binds `contentDigest`; binds neither `evaluateTransition` nor `TrustedPrincipal` |
| subpath resolution | 4 internal subpaths from `apps/api` | **PASS** — all `ERR_PACKAGE_PATH_NOT_EXPORTED` |
| dependency scan | — | **NOT RUN** |
| integration / live | — | **NOT RUN** — nothing wired to a route |

You independently reproduced 149/148/0/1 and the four typechecks last round. **Please re-run rather than
trust the numbers above.**

## G. Remaining findings — open, unfixed, not claimed

| severity | id | item |
| --- | --- | --- |
| **CRITICAL (partial)** | C5-1 | Test evidence is separated from authorship but **is not provenance**. Blocked on owner authority for key material — see §I. Until then no production claim should rest on "the candidate was tested". |
| **MAJOR** | H.16 | No durable store. `InMemoryReviewGateStore` only; restart durability and cross-process CAS unimplemented. The `ReviewGateStore` interface also does not make evidence-check and state-transition atomic, which you flagged as a future cross-process hazard. |
| **MAJOR** | — | No real `SessionAuthenticator` wired. All identity rests there. |
| MINOR | r1 | Rollback targets required but not semantically validated. |
| OBSERVATION | — | The workspace scan is a repository regression check, not an enforcement boundary; it cannot stop code with filesystem access importing the physical file, and the `exports` map cannot stop a relative import. Neither covers both. |

## H. Production state

**Production mutations: 0.** Database: 0. Credentials: 0. Infrastructure: 0. External providers: 0.
DNS: 0. GitHub: one branch pushed; no PR opened, no branch protection changed, no merge.

## I. Authority boundaries

**Reviewer may autonomously:** read anything; build and run the suite; attempt any read-only
reproduction. **Must not:** modify the candidate, commit, push, open or merge a PR, change branch
protection, or deploy — repairing it would surrender independence for it.

**OWNER AUTHORITY REQUIRED — one item, consolidated:**

> Full test provenance (C5-1) requires signed execution results, and therefore **key material for a test
> attestation scheme**. Creating signing keys is outside my standing authority. The owner's options are to
> authorise a scheme, or to accept separation-of-duties as the ceiling for this workstream and record that
> "tested" means "a second authenticated party asserted it". **No other item in this workstream needs
> owner action.**

## J. Next required action

**Codex, round 6.** Attempt to invalidate the candidate. In my order of suspicion:

1. **Attack `contentDigest`.** It is now load-bearing for rejection stickiness AND for what counts as
   remediation. Is the field split right? Is there a content change that should be material and is not —
   `baseBranch`, `targetEnvironmentClass`, `expiresAt` are all deliberately excluded, and I may have
   excluded something that matters.
2. **Attack the rejection ledger.** It is keyed on content and written after the CAS applies. Can a
   rejection be lost — a failed CAS, a concurrent verdict, a successor registered between the verdict and
   the ledger write?
3. **Attack the evidence separation.** I claim only separation of duties. Verify I have not implied more.
   Is there a path where the author's identity records evidence indirectly, or where evidence recorded for
   one candidate satisfies another?
4. **Attack `createSuccessor`'s new checks** — the participation requirement, the supersedable-state list,
   the project/repository continuity check.
5. **Audit the test suite again.** You have found three vacuous tests of mine; I found two more myself
   this round, one by mutation check and one because a falsifiable assertion failed. Assume a sixth.
6. **Confirm §G is complete** and that nothing here implies more than the code does.

Return **GO** or **NO-GO**, findings by severity with `file:line`, and for each CRITICAL the concrete
attack.

## K. Rollback

```
git push origin --delete feat/review-gate-20260902 && git branch -D feat/review-gate-20260902
```

`main` untouched at `07244a83`; no PR open; nothing wired to a route.

## L. Completion

**This workstream: ~60%.** Candidate identity, content identity, lifecycle, enforced independence,
recorded (if not provenanced) evidence, lineage, and an enforced package boundary.

**Remaining ~40%:** test provenance (owner authority), durable storage (§H.16), review-dispatch adapters
(§D), reviewer packet and risk classification (§E), evidence packet emitter (§G), redaction (§H.15),
operator documentation, and wiring into live approval routes behind a real `SessionAuthenticator`.
