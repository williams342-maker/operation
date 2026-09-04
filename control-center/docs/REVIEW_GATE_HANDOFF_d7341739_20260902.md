# Review gate — candidate J handoff to independent review

**Date:** 2026-09-02
**Author / remediator:** Claude.
**Receiving reviewer:** Codex, or any reviewer with no prior participation on this candidate.
**Round:** 9.

> **Author-side claims are leads, not certification.** Eight rounds, every one with at least one claim of
> mine stronger than the mechanism behind it.
>
> **Round 8 identified a repeating shape rather than a one-off.** Three times now I have built a mediating
> layer, described it as the boundary, and left the primitive it mediates on the public surface: the
> evaluator (round 3), the principal-minting function (round 5), the store (round 8). **Before accepting
> any boundary claim in this document, check what the package actually hands out.**

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
| **code commit** | `d7341739fb30ab26095399c213cdb4c69b404002` |
| **candidate commit** | tip of `feat/review-gate-20260902` |
| predecessor | `c5b66c5f` (candidate I, NO-GO) |
| lineage | A → C → D → E → F → G → H → I → **J** |

```
git diff d7341739..origin/feat/review-gate-20260902 -- control-center/packages/shared   # must be empty
```

## E. Work completed since candidate I

### C8-1 (CRITICAL, closed) — the package published the mutation primitive

`InMemoryReviewGateStore` was exported. Its `create()` took a caller-built record **including its state**,
and `compareAndSetState()` wrote any `nextState` it was handed. A consumer could write a record straight
into `READY_FOR_OWNER_DECISION` — no test, no freeze, no review, no reviewer class, no verdict.

**Two changes, and only the first is a boundary.** The store is off the public surface: it is a *port*, an
application supplies its own implementation of the `ReviewGateStore` type, and the in-memory one is a
reference this package's own tests reach by relative path. The boundary test asserts the emitted root
binds no `InMemoryReviewGateStore`.

The second is defence in depth, because the application holds a store either way: a record must arrive at
`BUILT` with no occurrences and no verdicts, and `compareAndSetState` re-checks the transition table
before writing. **This does not make the store safe to drive directly** — it enforces no evidence, no
independence, no reviewer class. It removes the cheapest way to forge a decision, and the code says so.

### C8-2 (CRITICAL, closed) — findings could be laundered by a milder second rejection

`outstandingFindings` looked only at the latest `NO_GO`, on my reasoning that an earlier finding was
"either fixed, or raised again". **Nothing enforced either branch.** Walk a rejected candidate round the
remediation loop, collect a second `NO_GO` carrying only a MINOR, and the original CRITICAL evaporated.

Findings now **accumulate**: every CRITICAL and MAJOR from every rejection on the record, plus whatever
the candidate inherited from the one it replaces.

**And claiming is now separated from discharging**, which is the part that matters most. An author's
`remediates` list says what they believe they fixed; it lets a successor be registered and is recorded as
lineage, but **it retires nothing**. Only a reviewer can discharge a finding, through a new `resolves`
field on the verdict, and `GO` is refused while anything stands undischarged. A reviewer approving a
successor must account for the inherited defect explicitly. Silence is not agreement.

### M8-1 (accepted) — I undercounted the durable-store burden

You were right: the store must also append the verdict **and its findings** atomically with the verdict
transition, or a durable implementation recreates the discarded-findings defect. That is a **fourth**
invariant, not three. §G is corrected.

## F. Verification performed

| check | scope | result |
| --- | --- | --- |
| `npm test` | `packages/shared` | **PASS** — 183 tests, 182 pass, 0 fail, 1 skip |
| the 1 skip | pre-existing, unrelated | SKIP |
| `tsc --noEmit` | shared, api, agent, updater | **PASS** (all four) |
| `npm run build` + inspect emitted root | `dist/index.js` | **PASS** — binds no store, no principal, no evaluator; binds `ReviewGateService` and `contentDigest` |
| dependency scan | — | **NOT RUN** |
| integration / live | — | **NOT RUN** |

## G. Remaining findings — open, unfixed, not claimed

| severity | id | item |
| --- | --- | --- |
| **CRITICAL (partial)** | C5-1 | Evidence is separation of duties, **not provenance**. Blocked on owner authority — §I. |
| **MAJOR** | H.16 | No durable store, now carrying **four** atomic invariants the in-memory implementation provides for free: the state CAS; rejection check and write; content uniqueness at `create`; and the verdict-with-findings append. **This is the largest single risk in the workstream** and every round has added to it. |
| **MAJOR** | — | No real `SessionAuthenticator` wired. Identity **and** reviewer authority rest on it. |
| **MAJOR** | — | A reviewer can discharge a finding by asserting `resolves`. That is the right party — but it is still an assertion, and a compromised or careless reviewer can retire a real defect with one string. The gate makes it *attributable*, not *verified*. |
| MINOR | r1 | Rollback targets required but not semantically validated. |

## H. Production state

**Production mutations: 0.** Database: 0. Credentials: 0. Infrastructure: 0. External providers: 0.
DNS: 0. GitHub: one branch pushed; no PR, no branch-protection change, no merge.

## I. Authority boundaries

**Reviewer may:** read, build, run the suite, reproduce read-only.
**Must not:** modify the candidate, commit, push, open or merge a PR, change branch protection, deploy.

**OWNER AUTHORITY REQUIRED — one item, unchanged since candidate G:** full test provenance needs signed
execution results and therefore key material. **No other item needs owner action.**

## J. Next required action

**Codex, round 9.** Attempt to invalidate.

1. **What else does the package hand out?** Given the three-times-repeated pattern, audit the *entire*
   public surface for anything that lets a consumer reach past `ReviewGateService`, not just the items
   previously named.
2. **Findings accumulation.** It unions across the record's verdicts and `inherited`. Is there a path that
   drops a finding — a successor of a successor, a finding id reused with a lower severity, a candidate
   that is cancelled and re-registered?
3. **`resolves`.** A reviewer discharges by id. Can an author reach it? Can a reviewer discharge a finding
   raised on a *different* candidate, or one never raised at all?
4. **The store's new self-checks.** `create` requires `BUILT` with empty history; `compareAndSetState`
   re-checks the table. Is there still a direct-store path to a forged decision?
5. **The test suite.** Three of my tests have certified holes. Assume a fourth.

Return **GO** or **NO-GO**, findings by severity with `file:line`, and for each CRITICAL the concrete
attack.

## K. Rollback

```
git push origin --delete feat/review-gate-20260902 && git branch -D feat/review-gate-20260902
```

`main` untouched at `07244a83`; no PR open; nothing wired to a route.

## L. Completion

**This workstream: ~70%.** Candidate and content identity, lifecycle, enforced independence, reviewer
authority, recorded evidence, accumulated findings with reviewer-only discharge, findings-linked
remediation lineage, content uniqueness, atomic rejection, an enforced package boundary.

**Remaining ~30%:** test provenance (owner authority), a durable store meeting all four invariants
(§H.16), review-dispatch adapters (§D), reviewer packet and risk classification (§E), evidence packet
emitter (§G), redaction (§H.15), operator documentation, and wiring into live approval routes behind a
real `SessionAuthenticator`.
