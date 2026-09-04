# Review gate — candidate F handoff to independent review

**Date:** 2026-09-02
**Author / remediator:** Claude. I wrote every line below and every line of the candidate, including the
remediation of my own defects.
**Receiving reviewer:** Codex, or any reviewer with no prior participation on this candidate.
**Round:** 5.

> **All author-side claims in this document are leads and evidence pointers, not certification.
> Re-derive every material finding from primary evidence.** Four previous rounds each contained at least
> one claim of mine that a reviewer falsified, and the failure mode was the same every time: I described a
> boundary that was stronger than the mechanism behind it. Test the mechanism; do not read my description
> of it. See the lineage table in `REVIEW_GATE_HANDOFF_INDEX.md`.

---

## A. Objective

Build the mandatory review gate from the OpsWorkbench Forge handoff: a release candidate must not reach
owner decision without an independent reviewer's verdict against a specific, immutable candidate identity,
and no path may substitute a test result, a self-approval, or an unverified assertion for that verdict.

**Completion criteria for this workstream** — candidate identity that binds what was built; a lifecycle
that cannot skip review; enforced reviewer independence; recorded evidence rather than asserted evidence;
durable storage; and the whole of it reachable only through an authoritative boundary.

## B. Current disposition

**ENGINEERING COMPLETE / REVIEW READY.**

Not certified, not deployable, not wired into any running route.

## C. Repository and environment

| | |
| --- | --- |
| repository | `williams342-maker/operation` |
| local path | `C:\Users\Mike\Downloads\Claude\opsworkbench-handoff-20260901\repo\operation` |
| branch | `feat/review-gate-20260902` (pushed) |
| remote | `origin` |
| base branch | `main` |
| base commit | `07244a83aae47d600a9c9f062999e10e8707840f` |
| pull request | **none opened** |
| test command | `cd control-center/packages/shared && npm test` |
| typecheck | `npx tsc --noEmit -p tsconfig.json` in each workspace |
| node | v24.18.0, Windows |

## D. Candidate identity

| | |
| --- | --- |
| **code commit** | `05162ac15f5108c63419d9cac777f5cb6bcd551e` |
| **candidate commit** | the tip of `feat/review-gate-20260902` — this document is *in* the candidate, so no revision of it can name its own hash |
| predecessor | `76203f014e3960975d17c5a2debcd6890d43322a` (candidate E, NO-GO) |
| supersedes | candidates A, C, D, E — see `REVIEW_GATE_HANDOFF_INDEX.md` |

Resolve and verify:

```
git rev-parse origin/feat/review-gate-20260902
git diff origin/main...origin/feat/review-gate-20260902 | git patch-id --stable
git diff 05162ac1..origin/feat/review-gate-20260902 -- control-center/packages/shared   # must be empty
git diff --numstat origin/main...origin/feat/review-gate-20260902
```

All executable content is at `05162ac1`; commits after it add documentation only. A reviewer who distrusts
that framing should review `05162ac1` for code and read this file separately.

## E. Work completed since candidate E

Round 4 returned one CRITICAL and two MODERATEs. All are addressed. Root causes, not filenames:

### CRITICAL — `TESTED` was an assertion, and my comment claimed otherwise

`evaluateTransition` documented that evidence "is required for the moves that assert something happened"
and that a caller "must supply the digest of a recorded result". **The function has no evidence parameter
and never had one, and no recorded result existed anywhere in the system.** `testResultDigest` was a
well-formed 64-character string in the binding and nothing else, so an author could invent one and move
`BUILT → TESTED`. I had written the assurance instead of the mechanism, then cited the assurance.

Root cause: documentation written in the tense of an intention, and never revisited when the intention was
not implemented.

Repair — evidence is now a recorded fact:
- `EvidenceRecord` carries candidate, result digest, who recorded it, and when.
- `recordTestExecution` is its own operation; the store is append-only and refuses a replayed evidence id.
- `TESTED` requires evidence whose digest **matches the binding**. Evidence for a different digest proves a
  test happened, not that *this* candidate was tested, and is refused.
- A retest requires evidence recorded **after** the remediation it follows, so a run from before the defect
  cannot be re-presented as proof the defect is gone.
- The evaluator's comment now states plainly what it does not do.

### CRITICAL, second half — a rejected candidate could be re-approved unchanged

The table cycles `REMEDIATING → RETEST_REQUIRED → TESTED` on the **same record**, changing neither binding
nor digest. A candidate could be rejected, walk the entire loop without a line of code changing, and be
approved by a second, genuinely independent reviewer for the identical content the first one rejected.

Root cause: independence was modelled as a property of *people*, and this attack requires no dishonest
person. The mechanism worked correctly and the outcome was still wrong.

Repair:
- A digest that received `NO_GO` can never reach `GO`. The binding is immutable, so a `NO_GO` on a record
  is a `NO_GO` on that content, permanently.
- `createSuccessor` is the legitimate exit: a new candidate that must hash differently from what it
  replaces (`successor_identical` otherwise), recording what it supersedes rather than leaving lineage to a
  commit message. A successor starts at `BUILT` and inherits no progress.

### An ordering mistake I made and fixed inside this round

I first ran the evidence gate **before** policy evaluation, so "no evidence" shadowed "expired" and
"illegal move", and a test that existed to prove expiry began passing for the wrong reason. A caller should
be told the first thing wrong with a request, not the last thing I added. The gate now runs after the
policy decision.

### MODERATE — the boundary scan was incomplete

It examined only `apps/` and only `.ts`. It now covers `apps`, `packages`, `scripts`, `deploy` and `tools`
across six extensions, and a new test asserts the scan **actually reads files**, because a scan that
silently finds nothing to look at passes forever.

### MODERATE — text assertions that could not fail

- The counterpart test matched names anywhere in the source, including string literals and comments, and
  never proved anything was exported. It now inspects the real module namespace.
- The "operations take a proof" test searched for the exact string `principal:` and for the words
  `private constructor` and `WeakSet` — vocabulary, not behaviour, evaded by a rename or a space. It now
  builds a service and hands all five operations the forgery that used to work.

### The attack is now run rather than described

Every other boundary assertion reads configuration and infers that Node will honour it. A new test performs
the exact subpath import used to falsify round 3 and requires `ERR_PACKAGE_PATH_NOT_EXPORTED`. Verified to
be resolution-time by moving `dist/` aside and re-running, so it cannot pass merely because the build is
missing.

## F. Verification performed

| check | scope | result |
| --- | --- | --- |
| `npm test` | `packages/shared` | **PASS** — 149 tests, 148 pass, 0 fail, 1 skip |
| the 1 skip | pre-existing, unrelated to this candidate | SKIP |
| `tsc --noEmit` | `packages/shared` | **PASS** |
| `tsc --noEmit` | `apps/api` | **PASS** |
| `tsc --noEmit` | `apps/agent` | **PASS** |
| `tsc --noEmit` | `apps/updater` | **PASS** |
| `npm run build` then inspect emitted JS | `packages/shared/dist` | **PASS** — root binds no `TrustedPrincipal`, no `principalFromSession`, no `evaluateTransition`; `ReviewGateService` resolves |
| subpath resolution from `apps/api` | 3 internal subpaths | **PASS** — all `ERR_PACKAGE_PATH_NOT_EXPORTED`; root resolves |
| same, with `dist/` moved aside | resolution-time proof | **PASS** |
| dependency scan | — | **NOT RUN** |
| integration / live | — | **NOT RUN** — nothing is wired to a route |

**The other four workspaces were typechecked specifically because the new `exports` map could have broken
a consumer.** No workspace imports a subpath of the shared package, so none did.

**Codex could not execute tests in rounds 3 and 4** (`spawn EPERM` under the read-only sandbox). The test
counts above therefore remain **unverified by anyone but the author**. Given four rounds of my tests being
wrong, treat the count as a claim and read the assertions.

## G. Remaining findings — open, unfixed, and not claimed

| severity | id | item |
| --- | --- | --- |
| **MAJOR** | M2 | Artifact/execution-context binding is optional (`reviewGate.ts:105-106`). Codex has twice said this should block production use or any claim that candidate identity is complete. Agreed. Not attempted — it is a schema redesign, not a patch. |
| **MAJOR** | H.16 | No durable store. `InMemoryReviewGateStore` only, so restart durability and cross-process compare-and-set are unimplemented. No production assurance attaches to this candidate. |
| **MAJOR** | — | No real `SessionAuthenticator` is wired. Identity now rests entirely on the injected authenticator, and nothing in this candidate supplies a genuine one. |
| MINOR | r1 | Rollback targets are required but not semantically validated. |
| OBSERVATION | — | The `apps/` scan is a repository regression check, not an enforcement boundary. It cannot stop code with filesystem access importing the physical file; the `exports` map cannot stop a relative import. Neither covers both, and the test says so where it is asserted. |

## H. Production state

**Production mutations: 0.** Database: 0. Credentials: 0. Infrastructure: 0. External providers: 0. DNS: 0.

GitHub: one branch pushed, at the owner's explicit instruction. No pull request opened, no branch
protection changed, no merge.

## I. Authority boundaries

**The receiving reviewer may autonomously:** read anything in the repository; build and run the test suite;
attempt any read-only reproduction; write diagnostic scratch files outside the repository.

**The receiving reviewer must not:** modify the candidate, commit, push, open or merge a pull request,
change branch protection, or deploy. Per the handoff rule §7, repairing the candidate would surrender
review independence for it.

**Requires owner authority (not requested here):** merging to `main`, any production deployment, wiring the
gate into live approval routes, credential creation, and enabling anything currently frozen.

**Owner action: None.**

## J. Next required action

**Codex, round 5.** Do not confirm the report above; attempt to invalidate the candidate. Specifically:

1. **Attack the evidence gate.** Can `TESTED` still be reached without a matching recorded run — through
   `TEST_FAILED`, through a successor, through concurrent transitions, or by recording evidence *after*
   reading state but before the compare-and-set? I believe the CAS covers the race; I built it, so I am the
   wrong person to be sure.
2. **Attack the sticky `NO_GO`.** It keys on `occurrences.some(o => o.to === "NO_GO")` for *this record*.
   Is there a path to `GO` on identical content through a successor whose digest differs trivially — a
   whitespace-only change, a re-run producing a new `testResultDigest` for the same code?
3. **Attack `createSuccessor`.** It compares digests and checks the author. Can a successor be registered
   that supersedes a candidate the actor never participated in, or that launders a rejected digest?
4. **Audit the remaining text-matching assertions.** You have caught two vacuous tests of mine and I caught
   a third; assume a fourth. Mutation-check anything that greps source.
5. **Confirm the open items in §G are genuinely open** and that nothing in this document quietly implies
   otherwise.

Return **GO** or **NO-GO** with findings by severity and `file:line`, and for each CRITICAL the concrete
attack that exploits it. If any claim here is false, say so plainly and cite the code — you have correctly
done that in all four previous rounds.

## K. Rollback

```
git push origin --delete feat/review-gate-20260902
git branch -D feat/review-gate-20260902
```

`main` is untouched at `07244a83`, no pull request is open, and nothing is wired into a running route, so
removing the branch changes no behaviour.

## L. Completion

**This workstream: ~55%.** §A, §B and §C core complete; an in-memory store with recorded evidence and
candidate lineage; §H mostly covered; the package boundary enforced rather than described.

**Remaining ~45%:** durable storage and its restart guarantees (§C persistence, §H.16), artifact binding
(M2), review-dispatch adapters (§D), the reviewer packet and risk classification (§E), the evidence packet
emitter (§G), redaction (§H.15), operator documentation, and wiring the service into live approval routes
behind a real `SessionAuthenticator`.
