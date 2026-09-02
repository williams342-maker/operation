# Codex reviewer handoff — mandatory review gate, frozen candidate

**Date:** 2026-09-02
**Author:** Claude (implementer)
**Round:** 3. Supersedes the round-1 text of this file entirely.
**Requested reviewer:** Codex, or any reviewer with no prior participation on this candidate
**Disposition:** `READY_FOR INDEPENDENT REVIEW`

**This is not a certification and must not be recorded as one.** I authored every line below, including
the remediation of my own defects. The gate being reviewed exists because an author cannot certify their
own work, and that applies to this candidate more than to anything it will later police.

> ### What this document used to say, and why it was wrong
>
> Round 1 of this file described candidate `311506ce` and led with a bypass inventory whose headline
> finding — **B1**, "an author can approve their own work, everywhere, today" — was **false**, along with
> **B4**, "no test asserts any of this". Codex falsified both. Every approval route already enforces
> approver/author separation (`configurationDeployment.ts:23` `assertApproverSeparation`, and `.equals()`
> checks at `agentUpgradeRoutes.ts:28`, `:68`, `:83`), and `configurationDeployment.test.ts:13` is the
> test I said did not exist.
>
> I searched for `createdByUserId.*approvedByUserId`, `!== createdByUserId` and `selfApprov`. The real
> checks use different parameter names and `.equals()`. **I reported the absence of the pattern I imagined
> as the absence of the behaviour.** Treat every unquoted claim in this document as suspect for the same
> reason, and check the code rather than my description of it.
>
> The retraction is committed at `e677e4fb`, and `review-gate-current-state-20260902.md` carries the same
> banner. Reading either document without its retraction gives you a false premise.

---

## 1. Candidate identity

| field | value |
| --- | --- |
| repository | `williams342-maker/operation` |
| base branch | `main` |
| base commit | `07244a83aae47d600a9c9f062999e10e8707840f` |
| candidate commit | the tip of `feat/review-gate-20260902` (see note below) |
| code content | identical to `5dd28eb0605b1c0b6183cc5d4be2624b2710493e` |
| tree at `5dd28eb0` | `fecea7dbbab26a01a5bf2ab3c00d4ef2d5b7c2f6` |
| parent | `77a84dcc25147dba50799bcf4c8aa0cab4a23170` |
| stable patch id | `ef8b2c9c115fa54f4eda72e874b7c50b5a828f48` |
| branch | `feat/review-gate-20260902` (pushed; **no pull request opened**) |
| working tree | clean |
| scope | 8 files, +1787 / −0 |

```
A  control-center/docs/review-gate-codex-handoff-20260902.md
A  control-center/docs/review-gate-current-state-20260902.md
M  control-center/packages/shared/src/index.ts
A  control-center/packages/shared/src/reviewGate.ts
A  control-center/packages/shared/src/reviewGateService.ts
A  control-center/packages/shared/test/reviewGate.test.ts
A  control-center/packages/shared/test/reviewGateBoundary.test.ts
A  control-center/packages/shared/test/reviewGateService.test.ts
```

**Why the candidate commit is not a literal hash.** This document is *in* the candidate, so the tip
commit is the one that adds this file, and no revision of it can name its own hash. Resolve the candidate
with `git rev-parse origin/feat/review-gate-20260902`. All executable content — every file under
`packages/shared` — is byte-identical to `5dd28eb0`; the tip adds documentation only. Confirm both with:

```
git diff 5dd28eb0..origin/feat/review-gate-20260902 -- control-center/packages/shared   # must be empty
git diff origin/main...5dd28eb0 | git patch-id --stable                                 # ef8b2c9c...
```

A reviewer who distrusts that framing should review `5dd28eb0` for code and read this file separately.

**Review lineage.** `311506ce` (round 1) → NO-GO, 2 CRITICALs. `77a84dcc` (round 2) → NO-GO, 3 CRITICALs,
**one of which I introduced while fixing the first two**. `5dd28eb0` is round 3.

---

## 2. What changed since round 2, and what I got wrong doing it

### C3 — mine, and the worst of the three

Fixing C1 and C2, I made the participation role a caller-supplied `addRole` parameter. That is a complete
independence bypass: a reviewer issues NO_GO, walks the candidate through `REMEDIATING` while simply
omitting the role, and then approves their own remediation, because the ledger still shows them as
reviewer only. **I built a bypass into the fix for a bypass.**

Roles are now derived from the transition, and there is no parameter to omit:

```ts
private static roleFor(to: ReviewState): Participant["role"] | undefined {
  if (to === "REMEDIATING") return "remediator";
  if (to === "REVIEW_REQUESTED") return "requester";
  return undefined;
}
```

This is the single change in the candidate I most want attacked, because the same mistake in the same
place twice is a pattern, not an accident.

### C1 — the evaluator is now genuinely unreachable

Calling `evaluateTransition` "internal" in a comment enforced nothing: `index.ts` did
`export * from "./reviewGate.js"`, so any consumer could bypass `ReviewGateService`, supply its own state,
ledger, binding and verdict, and rebuild the exact hole the service closes. The index now exports by name,
and the evaluator is not on the public surface. `reviewGateBoundary.test.ts` asserts three things: the
index cannot re-export it, nothing under `apps/` may import it, and it has exactly one caller.

### C2 — identity is a principal, not a string

`actorIdentity` was a caller-supplied string, so a caller could set the actor and the verdict's reviewer to
the same uninvolved name and have string equality authenticate an assertion against itself. Identity is now
a `TrustedPrincipal`: a class with a **private constructor**, obtainable only through `fromSession()`.
Application code cannot write `new TrustedPrincipal("codex")`, and `intentSchema` has no identity field at
all, so identity cannot arrive as request data.

**Be clear about what C2 is not.** This is a compile-time boundary, not a cryptographic one. Anything able
to call `fromSession` can still mint a principal. Real assurance needs the API layer to be the only caller,
which is why the import-boundary test exists and why wiring routes through auth middleware is a
prerequisite for any production claim. Codex asked whether I had moved the hole one layer out; **partly
yes**, and the honest answer is that it cannot be fully closed inside `packages/shared`.

### MO1 — future-dated verdicts

A verdict dated in the future produced a *negative* age and sailed past the staleness limit. Future-dating
is now rejected outside a five-minute skew allowance, before the age check.

### Three of my own tests were wrong

Fixed rather than deleted, and listed because a reviewer should know which assertions were unreliable:

- the boundary test grepped raw text and failed on `index.ts`'s own comment explaining why the evaluator is
  not exported. **A boundary test that cannot tell code from prose reports the documentation as the
  violation.**
- its comment stripper lacked the `m` flag, so `^` anchored to the start of the whole string and a `//`
  comment beginning a line was never stripped.
- one filter still called `read()` instead of `code()`, so it saw comments.
- the ledger assertion expected only an author row; it now expects author **and** requester, which is the
  C3 fix working — the operation wrote the role the caller used to be able to omit.

---

## 3. What to attack, ordered by where I think this is weakest

1. **`TrustedPrincipal` is a compile-time barrier only.** See §2 C2. Is a private constructor plus an
   import-boundary test an acceptable interim, or does the missing cryptographic binding mean the
   independence claim should not be made at all yet?
2. **Role derivation is hard-coded to two states.** `roleFor` returns a role for `REMEDIATING` and
   `REVIEW_REQUESTED`, and `undefined` otherwise. Is there a state that *should* write participation and
   silently does not? That failure mode is invisible — it looks like a clean ledger.
3. **`candidateDigest` covers what I chose to put in the binding.** Anything absent from
   `candidateBindingSchema` can change without changing identity. **M2 from round 2 is still open**:
   artifact/execution-context binding remains optional. Codex said this should block production use; I
   agree, and I have not attempted the schema redesign.
4. **The transition table is the whole safety argument.** Look for a path through legal moves reaching
   `READY_FOR_OWNER_DECISION` without an independent verdict. I built the table, so I am the wrong person
   to be sure there is none.
5. **The store is in-memory.** `InMemoryReviewGateStore` makes §H.12 and §H.17 testable, and they are
   tested. It does **not** deliver §H.16 restart durability, and its compare-and-set is not the same
   primitive Mongo would give.
6. **§H.18's exemption is a judgement call.** `development` and `test` skip the rollback requirement, on
   the reasoning that demanding a rollback target where none exists teaches people to write placeholders.

---

## 4. Evidence

`npm test` in `control-center/packages/shared`:

| | tests | pass | fail | skip |
| --- | ---: | ---: | ---: | ---: |
| full shared package | 124 | 123 | 0 | 1 |

The single skip pre-exists this candidate. `tsc --noEmit -p tsconfig.json` is clean.

Every round-2 CRITICAL has a test written **as the attack**, not as the happy path — see
`reviewGateService.test.ts`, where each test name states the attack it defeats.

**Two tests exist to stop the suite being vacuous:** one proves an uninvolved reviewer *is* accepted, so
the independence check is not merely rejecting everyone; one derives the completeness check from the state
*list* rather than the transition table it polices, so deleting a state cannot delete its own coverage.

**§H coverage.** Covered: 1–13, 17, 18, 20. Newly covered because a store now exists: 12, 17.

**NOT covered, and not claimed:** **16** (restart durability) needs a durable store, which this candidate
does not build. **14** (MCP parity) is not applicable — no MCP intake exists in either repository. **15**
(secret redaction) is not implemented; there is no evidence-persistence layer to redact into. **19** is
partial — `testResultDigest` is bound into identity, so changing test results changes the candidate, but
nothing yet *evaluates* whether required tests were skipped.

Claiming 15 or 16 from unit tests would be precisely the unearned assurance this gate exists to prevent.

---

## 5. Required demonstrations

- **Smoke pass cannot bypass review.** No smoke concept exists in `apps/api/src` to bypass with — no
  `smoke`, no `testsPassed`, no test-result gate. Separately, `TESTED -> GO` is absent from `TRANSITIONS`,
  and a test asserts it for both `TESTED` and `FROZEN`.
- **Review GO stops at owner decision.** `TRANSITIONS.GO === ["READY_FOR_OWNER_DECISION"]` and
  `TRANSITIONS.READY_FOR_OWNER_DECISION === []`. A test asserts `GO` is the *only* state reaching owner
  decision, derived by scanning the table rather than restating it.
- **NO-GO → remediation → retest → new review.** `NO_GO -> REMEDIATION_REQUIRED -> REMEDIATING ->
  RETEST_REQUIRED -> TESTED`, with `REMEDIATING -> REVIEW_REQUESTED` asserted absent, so remediated work
  cannot re-enter review without being retested.

---

## 6. Still open — not fixed, not claimed

| id | item |
| --- | --- |
| **M2** | Artifact/execution-context binding is optional. Codex: this should block production use, or any claim that candidate identity is complete. Agreed; not attempted. |
| §H.16 | No durable store. In-memory only. |
| r1 | Rollback-target *semantic* validation — the field is required, its content is not checked. |
| r1 | Graph-reachability completeness test. |
| r1 | Branch-identity test naming. |

---

## 7. Rollback

`git push origin --delete feat/review-gate-20260902 && git branch -D feat/review-gate-20260902`. `main` is
untouched at `07244a83`, no pull request is open, and nothing is wired into a running route, so removing it
changes no behaviour.

---

## 8. Mutations

**Production: 0. Database: 0. Credentials: 0. Infrastructure: 0. External providers: 0.**
**GitHub: one branch pushed**, at the owner's explicit instruction. No pull request opened, no branch
protection changed, no merge — consistent with the handoff's non-goals.

---

## 9. Completion

**This workstream: ~45%.** §A complete, §B complete, §C core plus an in-memory store complete, §H mostly.
**Remaining ~55%:** the durable store and its restart guarantees (§C persistence, §H.16), artifact binding
(M2), review-dispatch adapters (§D), the reviewer packet and risk classification (§E), the evidence packet
emitter (§G), redaction (§H.15), operator documentation, and wiring the service into the live approval
routes.

**Disposition: `READY_FOR INDEPENDENT REVIEW`.** Not certified, not deployable, not wired in.
