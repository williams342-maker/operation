# Review gate — candidate K handoff to independent review

**Date:** 2026-09-02
**Author / remediator:** Claude.
**Receiving reviewer:** Codex, or any reviewer with no prior participation on this candidate.
**Round:** 10.

> **Author-side claims are leads, not certification.**
>
> **This candidate follows a change of approach, not another patch.** In round 9 I asked the reviewer
> whether the defect rate was converging or whether the design was the problem. The answer was the
> design: *"The system repeatedly treats TypeScript visibility, export selection, interfaces, and comments
> as security-capability boundaries. They are packaging and maintainability mechanisms, not robust runtime
> authority boundaries. Continuing to patch the current object graph is likely to produce more variations
> of the same defect."* This round implements that advice. Two of its five recommendations are **not**
> done and are declared in §G rather than glossed.

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
| **code commit** | `8e7ad8ba672e452a202248a78a85d73fcf2a7475` |
| **candidate commit** | tip of `feat/review-gate-20260902` |
| predecessor | `1afc9c5b` (candidate J, NO-GO) |
| lineage | A → C → D → E → F → G → H → I → J → **K** |

```
git diff 8e7ad8ba..origin/feat/review-gate-20260902 -- control-center/packages/shared   # must be empty
```

## E. Work completed since candidate J

### C9-1 (CRITICAL) — the service leaked its store

`private readonly store` is a compile-time annotation that emits an ordinary property, so
`(service as any).store` returned the live store and the whole gate could be driven around it. Round 8 had
removed the store from the package index and **I called that closed**; the object was reachable through
the exported mediator the entire time.

**Two runtime barriers, per recommendations 2 and 3:**

- The service holds `#store`, `#authenticator` and `#clock` as ECMAScript private fields. No cast reaches
  them.
- The store's mutators no longer trust their caller at all. `create`, `compareAndSetState` and
  `recordEvidence` require a `StoreWriteCapability` that cannot be constructed outside the module.
  **Reaching the store object is no longer sufficient.**

**My own test caught me repeating the exact mistake inside the fix.** I first wrote the capability with a
TypeScript `private constructor` — erased at runtime, so `new StoreWriteCapability()` worked and the
capability was free to anyone. Compile-time visibility standing in for a runtime boundary, for the fourth
time, *in the class built to stop that*. The constructor now demands a module-private symbol.

I am recording this because **the test catching it rather than the reviewer is the first sign in nine
rounds that the suite is starting to do its job.**

### C9-2 (CRITICAL) — `resolves` was a timeless tombstone

`outstandingFindings` accumulated every finding, then in a *second pass* deleted every id ever mentioned
in any verdict's `resolves`. Order did not matter, so `resolves: ["FUTURE"]` submitted before `FUTURE`
existed erased it when a later `NO_GO` raised it as a CRITICAL. A single verdict could raise and resolve
the same finding in one breath.

Verdicts now replay **in order**, and a discharge applies only to what is outstanding when it happens.
`submitVerdict` additionally refuses a verdict resolving a finding it raises, and one naming anything not
currently outstanding.

### Recommendation 5 — test capability reachability, not just exports

The boundary test now constructs a service instance, enumerates its own and prototype properties, and
requires that none of them is the store or the authenticator. It then walks the **full lifecycle**
`BUILT → … → READY_FOR_OWNER_DECISION` through a directly-held store and requires every write to be
refused. That is what would have caught C9-1.

## F. Verification performed

| check | scope | result |
| --- | --- | --- |
| `npm test` | `packages/shared` | **PASS** — 189 tests, 188 pass, 0 fail, 1 skip |
| `tsc --noEmit` | shared, api, agent, updater | **PASS** (all four) |
| `npm run build` + inspect emitted root | `dist/index.js` | **PASS** — no store, no principal, no evaluator; `ReviewGateService` present |
| dependency scan / integration | — | **NOT RUN** |

**You could not run the suite in rounds 3, 4 and 9** (`spawn EPERM`). Where you can, please re-run.

## G. Remaining findings — open, unfixed, not claimed

| severity | id | item |
| --- | --- | --- |
| **MAJOR** | rec-3 | **Not done.** Authoritative mutation is not behind a *separately deployed* persistence boundary. The capability is a strong in-process barrier; it is not a process boundary, and an application that implements the port owns its own database regardless. |
| **MAJOR** | rec-4 | **Partly done.** Discharge now enforces causal ordering, but still references a finding **id**, not a specific finding *occurrence*. Two candidates can use the same id for different defects. |
| **CRITICAL (partial)** | C5-1 | Evidence is separation of duties, **not provenance**. Owner authority — §I. |
| **MAJOR** | H.16 | No durable store; **four** atomic invariants ride on it. |
| **MAJOR** | — | No real `SessionAuthenticator` wired. Identity and reviewer authority both rest on it. |
| **MAJOR** | — | Discharge is the right party but still an unverified assertion. |
| MINOR | r1 | Rollback targets not semantically validated. |
| — | — | **Recommendation 1 is a question for the owner, not a defect**: is application code holding the service trusted? The design currently assumes *partly* — see §I. |

## H. Production state

**Production mutations: 0.** Database: 0. Credentials: 0. Infrastructure: 0. External providers: 0.
DNS: 0. GitHub: one branch pushed; no PR, no branch-protection change, no merge.

## I. Authority boundaries

**Reviewer may:** read, build, run the suite, reproduce read-only.
**Must not:** modify the candidate, commit, push, open or merge a PR, change branch protection, deploy.

**OWNER AUTHORITY — now two items, consolidated:**

> **1. Test provenance.** Signed execution results need key material. Unchanged since candidate G.
>
> **2. The trust question, raised by the reviewer.** Is application code holding the `ReviewGateService`
> trusted? Today the answer is implicitly "partly" — the capability and `#private` fields defend against
> adjacent in-process code, but not against the application that owns the database. Making that answer
> "no" means a separately deployed persistence boundary, which is an architecture decision with cost, not
> an engineering detail I should settle alone.

## J. Next required action

**Codex, round 10.** Attempt to invalidate.

1. **The capability barrier.** It is a module-private symbol plus an identity check. Is there a route to
   an instance — a serialisation path, a subclass, a prototype trick, an existing instance reachable from
   any exported object?
2. **`#private` fields.** Genuinely unreachable, or is there a leak through an error, a promise, a
   closure captured elsewhere?
3. **Causal discharge.** Verdicts replay in order. Is there an ordering the replay gets wrong — a
   successor chain, a candidate whose verdicts were appended out of order by a concurrent write?
4. **Whether this round's approach change is the right one at all.** You said patching the object graph
   would keep producing variants. If this still looks like the same shape, say so and I will stop
   patching and propose a redesign to the owner instead.
5. **The suite.** It caught one defect this round. Assume it still certifies others.

## K. Rollback

```
git push origin --delete feat/review-gate-20260902 && git branch -D feat/review-gate-20260902
```

`main` untouched at `07244a83`; no PR open; nothing wired to a route.

## L. Completion

**This workstream: ~70%.** Unchanged from candidate J: this round hardened boundaries rather than adding
capability, which is the honest accounting.

**Remaining ~30%:** the two owner-authority items, a durable store meeting four invariants, occurrence-
scoped findings, review-dispatch adapters, reviewer packet and risk classification, evidence packet
emitter, redaction, operator documentation, and wiring into live routes.
