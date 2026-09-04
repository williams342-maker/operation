# Review gate — candidate I handoff to independent review

**Date:** 2026-09-02
**Author / remediator:** Claude.
**Receiving reviewer:** Codex, or any reviewer with no prior participation on this candidate.
**Round:** 8.

> **Author-side claims are leads, not certification.** Seven rounds, every one with at least one claim of
> mine stronger than the mechanism behind it. Round 7 is the one to read first: I had declared C6-1
> **closed** after widening the CAS contract, and it was not — the defect was not an ordering problem at
> all, so ordering could not fix it. **When I say a finding is closed, that has been wrong before.**

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

## D. Candidate identity

| | |
| --- | --- |
| **code commit** | `0ce56c853e9abf582aed5973937f61110c9173d3` |
| **candidate commit** | tip of `feat/review-gate-20260902` |
| predecessor | `75f098e8` (candidate H, NO-GO) |
| lineage | A → C → D → E → F → G → H → **I** |

```
git diff 0ce56c85..origin/feat/review-gate-20260902 -- control-center/packages/shared   # must be empty
```

## E. Work completed since candidate H

### CRITICAL (closed) — rejection could not revoke an already-terminal decision

You showed the ordering my fix and my test both missed: approve twin A, move it to
`READY_FOR_OWNER_DECISION`, *then* reject twin B. That state is terminal, so the rejection had nothing to
act on — identical content permanently awaiting the owner **and** recorded as rejected.

**Per-operation atomicity cannot fix this**, which is why round 6's widened CAS did not. It establishes
ordering; it cannot make a later fact revoke an earlier terminal decision.

**So the contradiction is prevented rather than resolved: at most one live candidate may carry a given
content digest.** Twins cannot both exist, so there is no second record from which to disagree. The check
lives inside the store's `create`, so it cannot interleave. `CANCELLED` and `EXPIRED` release the claim —
abandoning work must not permanently bar resubmitting it — and `NO_GO` does not need to, because the
rejection ledger takes over there. Both handovers are tested.

**My concurrency test missed the ordering that mattered**, exactly as you said: it advanced to owner
decision only *after* the rejection completed, and never asserted the thing its own comment claimed in the
branch where approval won. **Third test of mine to certify a hole rather than catch one.**

### MAJOR (closed — you said it should block, and it did)

Remediation was `contentDigest` inequality, so any genuine code change let a successor through whether or
not it touched the defect. **The deeper reason was that the system discarded findings.** A verdict was
evaluated, its transition committed, and its content dropped. You cannot establish that a finding was
addressed if you did not keep the finding — which is why three rounds of digest comparison kept failing to
express "remediated".

Verdicts are now stored on the record, findings included, written in the same atomic step that commits
them. A successor must name the finding ids it addresses, cover every CRITICAL and MAJOR one, and cannot
invent a finding that was never raised. What it claims is recorded as lineage. OBSERVATION and MINOR do
not block, and a test proves the severity split cuts both ways.

### MAJOR (closed) — `requestedReviewerClass` was never consulted

Parsed into the binding and then ignored, so a candidate could request an independent reviewer and be
approved by whoever turned up without a conflicting participation record. **A field that states a
requirement and never enforces it reads like a control and is not one.**

`SessionAuthenticator` now declares which review authorities an identity holds. The class is enforced at
the claim *and* at the verdict, which also closes the review-seizing use of the stranger entry point.

**That check fires before the independence check**, which would have let two of my round-1 tests pass for
the wrong reason. Both now use an author who *also* holds the reviewer class, so independence is the only
thing left that can refuse her.

## F. Verification performed

| check | scope | result |
| --- | --- | --- |
| `npm test` | `packages/shared` | **PASS** — 177 tests, 176 pass, 0 fail, 1 skip |
| the 1 skip | pre-existing, unrelated | SKIP |
| `tsc --noEmit` | shared, api, agent, updater | **PASS** (all four) |
| dependency scan | — | **NOT RUN** |
| integration / live | — | **NOT RUN** |

## G. Remaining findings — open, unfixed, not claimed

| severity | id | item |
| --- | --- | --- |
| **CRITICAL (partial)** | C5-1 | Evidence is separation of duties, **not provenance**. Blocked on owner authority — §I. |
| **MAJOR** | H.16 | No durable store — and it now carries **three** invariants the in-memory implementation provides for free: the state CAS, the rejection check/write atomicity, and content uniqueness at `create`. Each round has made this gap heavier, and a Mongo implementation is now the largest single risk in the workstream. |
| **MAJOR** | — | No real `SessionAuthenticator` wired. Identity **and now reviewer authority** both rest on it. |
| MINOR | r1 | Rollback targets required but not semantically validated. |
| OBSERVATION | — | The workspace scan is a repository regression check, not an enforcement boundary. |

## H. Production state

**Production mutations: 0.** Database: 0. Credentials: 0. Infrastructure: 0. External providers: 0.
DNS: 0. GitHub: one branch pushed; no PR, no branch-protection change, no merge.

## I. Authority boundaries

**Reviewer may:** read, build, run the suite, reproduce read-only.
**Must not:** modify the candidate, commit, push, open or merge a PR, change branch protection, deploy.

**OWNER AUTHORITY REQUIRED — one item, unchanged since candidate G:** full test provenance needs signed
execution results and therefore key material. The owner can authorise a scheme, or accept
separation-of-duties as the ceiling. **No other item needs owner action.**

## J. Next required action

**Codex, round 8.** Attempt to invalidate.

1. **Content uniqueness is now the load-bearing invariant.** It is enforced in `create`. Is there any
   other path that produces a record — or any state transition — that could put two live candidates on the
   same content? Consider `createSuccessor`, and consider a candidate moving *out* of `CANCELLED`.
2. **`RELEASES_CONTENT` is `["CANCELLED", "EXPIRED"]` and is deliberately not `terminalStates`.** Is that
   split right? `READY_FOR_OWNER_DECISION` holds its claim forever by design — is there a case where that
   is wrong?
3. **Findings-linked remediation.** Only the *latest* `NO_GO`'s findings count. Is that right, or can a
   finding be laundered across two rejection cycles?
4. **Reviewer classes.** `reviewerClasses` comes from the authenticator, so it is only as good as the
   application. Is enforcing at claim *and* verdict sufficient, or is there a path to a verdict that skips
   the claim?
5. **The test suite.** Three of my tests have now certified holes. Assume a fourth.

Return **GO** or **NO-GO**, findings by severity with `file:line`, and for each CRITICAL the concrete
attack.

## K. Rollback

```
git push origin --delete feat/review-gate-20260902 && git branch -D feat/review-gate-20260902
```

`main` untouched at `07244a83`; no PR open; nothing wired to a route.

## L. Completion

**This workstream: ~65%.** Candidate and content identity, lifecycle, enforced independence, reviewer
authority, recorded evidence, stored findings, findings-linked remediation, content uniqueness, atomic
rejection, an enforced package boundary.

**Remaining ~35%:** test provenance (owner authority), a durable store meeting all three invariants
(§H.16 — now the largest risk), review-dispatch adapters (§D), reviewer packet and risk classification
(§E), evidence packet emitter (§G), redaction (§H.15), operator documentation, and wiring into live
approval routes behind a real `SessionAuthenticator`.
