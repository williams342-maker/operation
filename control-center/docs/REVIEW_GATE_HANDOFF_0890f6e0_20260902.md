# Review gate — candidate H handoff to independent review

**Date:** 2026-09-02
**Author / remediator:** Claude.
**Receiving reviewer:** Codex, or any reviewer with no prior participation on this candidate.
**Round:** 7.

> **All author-side claims here are leads, not certification. Re-derive from primary evidence.**
> Six rounds, and every one contained at least one claim of mine stronger than the mechanism behind it.
> Round 6 is worth reading twice: I told the reviewer that the rejection ledger's atomicity was *where I
> would look first* — and it was broken. **Naming a weakness is not fixing it, and my confidence about
> where the risk lies has not correlated with where the defects were.**

---

## A. Objective

A release candidate must not reach owner decision without an independent reviewer's verdict against a
specific, immutable candidate identity, and no path may substitute a test result, a self-approval, or an
unverified assertion for that verdict.

## B. Current disposition

**ENGINEERING IN PROGRESS — REVIEW READY.** Not certified, not deployable, not wired to any route.

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
| **code commit** | `0890f6e098ea00bef4b61e0a7fd8ef0582916e4b` |
| **candidate commit** | tip of `feat/review-gate-20260902` (this document is in the candidate) |
| predecessor | `d83a03e5` (candidate G, NO-GO) |
| lineage | A → C → D → E → F → G → **H**; see `REVIEW_GATE_HANDOFF_INDEX.md` |

```
git rev-parse origin/feat/review-gate-20260902
git diff 0890f6e0..origin/feat/review-gate-20260902 -- control-center/packages/shared   # must be empty
```

## E. Work completed since candidate G

### C6-1 (CRITICAL, closed) — rejection was three operations, not one

The ledger check, the state commit and the ledger write were separate calls. Two records with identical
content could both read "not rejected", then one commit `GO` while the other committed `NO_GO`. And
`GO → READY_FOR_OWNER_DECISION` used the ordinary transition path and **never re-consulted the ledger**,
so a `GO` that won that race carried rejected work to the owner.

**The `compareAndSetState` contract now covers rejection.** It takes `requireContentNotRejected` and
`recordRejectionOfContent`, and an implementation must apply the state check, the rejection check and the
rejection write in **one atomic step or return false**. Approving re-checks inside the step that commits
`GO`; rejecting writes inside the step that commits `NO_GO`; the owner-decision move re-checks as the last
gate before a human sees it. The standalone `recordRejection` is **deleted**, not left unused — a second,
non-atomic way to write that ledger is a way to write it at the wrong moment.

**This raises the stakes on H.16.** The in-memory store satisfies the contract because it never awaits
mid-operation. A Mongo implementation needs a transaction or a single conditional update. The interface
comment states that as the contract it must meet; it is not written yet.

### C6-2 (CRITICAL, closed) — a test-plan label counted as work

`contentDigest` included `testPlanVersion`, so `tp-1 → tp-2` passed the successor check with an identical
defective commit, tree, patch, artifact and manifest. Removed from content.

**My own test had been asserting the bypass.** `reviewGate.test.ts` explicitly claimed `testPlanVersion`
changes content identity, so the suite blessed the move it should have caught. **That is the second time
this workstream shipped a test that certified a hole.**

### M6-1 (MAJOR, closed) — a stranger could self-enrol, then supersede

I built this loophole in the previous round: the `REVIEW_REQUESTED` transition writes a requester row for
whoever performs it, and any authenticated identity could perform any transition. Self-enrol, cancel,
supersede — all legal moves.

Participation is now a prerequisite for moving a candidate rather than a side effect of having moved it,
with **one deliberate exception**: `REVIEW_REQUESTED → REVIEW_IN_PROGRESS`, which is how an independent
reviewer legitimately arrives at a candidate they have no prior link to. That move grants no role. And a
successor may be registered only by the **author or a recorded remediator** — not any participant, because
a reviewer is a participant, and letting a reviewer author the replacement launders independence.

### MO6-1 (closed) — the module comment still claimed the record key was a digest

"A candidate's id is a digest" was false; the id is a caller-chosen string and always was. That sentence
was round 5's CRITICAL in prose, still sitting in the file after the code was fixed.

## F. Verification performed

| check | scope | result |
| --- | --- | --- |
| `npm test` | `packages/shared` | **PASS** — 168 tests, 167 pass, 0 fail, 1 skip |
| the 1 skip | pre-existing, unrelated | SKIP |
| `tsc --noEmit` | shared, api, agent, updater | **PASS** (all four) |
| dependency scan | — | **NOT RUN** |
| integration / live | — | **NOT RUN** — nothing wired to a route |

The concurrency attack is now a test that **races two verdicts**, not a paragraph asserting it cannot
happen. You reproduced the counts in rounds 5 and 6 — please do so again rather than trust them.

## G. Remaining findings — open, unfixed, not claimed

| severity | id | item |
| --- | --- | --- |
| **CRITICAL (partial)** | C5-1 | Evidence is separation of duties, **not provenance**. `runnerIdentity` and `runReference` are assertions; nothing verifies a test ran. An attacker controlling both an author and a CI identity defeats it. Blocked on owner authority — §I. |
| **MAJOR** | H.16 | No durable store, and the widened CAS contract now depends on atomicity that only the in-memory implementation provides. A Mongo store must deliver state check + rejection check + rejection write in one step. |
| **MAJOR** | — | No real `SessionAuthenticator` wired. All identity rests there. |
| **MAJOR** | — | **Remediation is still inequality of a digest, not evidence that findings were addressed.** Round 6 named this as the general form of C6-2. Narrowing the content fields makes laundering harder, not impossible: any genuine code change lets a successor through regardless of whether it addresses the finding. Closing it needs successors to reference the findings they remediate, which needs verdicts stored on the record. **Not attempted.** |
| MINOR | r1 | Rollback targets required but not semantically validated. |
| OBSERVATION | — | The workspace scan is a repository regression check, not an enforcement boundary; the `exports` map cannot stop a relative import and the scan cannot stop a filesystem-path import. |

## H. Production state

**Production mutations: 0.** Database: 0. Credentials: 0. Infrastructure: 0. External providers: 0.
DNS: 0. GitHub: one branch pushed; no PR, no branch-protection change, no merge.

## I. Authority boundaries

**Reviewer may:** read anything, build, run the suite, attempt read-only reproduction.
**Must not:** modify the candidate, commit, push, open or merge a PR, change branch protection, deploy.

**OWNER AUTHORITY REQUIRED — one item, unchanged since candidate G:**

> Full test provenance (C5-1) requires signed execution results and therefore key material for an
> attestation scheme. Creating signing keys is outside my standing authority. The owner can authorise a
> scheme, or accept separation-of-duties as the ceiling and record that "tested" means "a second
> authenticated party asserted it". **No other item needs owner action.**

## J. Next required action

**Codex, round 7.** Attempt to invalidate. My order of suspicion — noting that this ordering has been a
poor predictor five rounds running, so please do not treat it as a map:

1. **The widened CAS contract.** It is now the single point on which rejection correctness rests. Is the
   in-memory implementation genuinely atomic under the async interface? Is there an interleaving where a
   rejection is recorded but a concurrent GO on the same content still commits?
2. **The participation prerequisite.** `REVIEW_REQUESTED → REVIEW_IN_PROGRESS` is an unauthenticated-
   stranger entry point by design. Can it be abused — repeatedly, or to block a candidate, or to reach a
   state that grants a role?
3. **`contentDigest` after removing `testPlanVersion`.** Is the field set now right? Consider
   `baseBranch`, `targetEnvironmentClass`, `expiresAt`, `authorIdentity` — all still excluded.
4. **The MAJOR I have declared but not fixed** (remediation ≠ addressed findings). Confirm my description
   of it matches the code, and say whether it should block further work rather than sit open.
5. **The test suite.** Two of my tests have now certified holes. Assume a third.

Return **GO** or **NO-GO**, findings by severity with `file:line`, and for each CRITICAL the concrete
attack.

## K. Rollback

```
git push origin --delete feat/review-gate-20260902 && git branch -D feat/review-gate-20260902
```

`main` untouched at `07244a83`; no PR open; nothing wired to a route.

## L. Completion

**This workstream: ~60%.** Candidate and content identity, lifecycle, enforced independence, recorded
(not provenanced) evidence, lineage, atomic rejection, an enforced package boundary.

**Remaining ~40%:** test provenance (owner authority), durable storage meeting the widened CAS contract
(§H.16), findings-linked remediation, review-dispatch adapters (§D), reviewer packet and risk
classification (§E), evidence packet emitter (§G), redaction (§H.15), operator documentation, and wiring
into live approval routes behind a real `SessionAuthenticator`.
