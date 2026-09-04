> ## SUPERSEDED, 2026-09-02 — do not review against this document
>
> This file was overwritten in place across rounds 1 to 4, which destroyed the text each reviewer
> actually read. That is a breach of the handoff rule on evidence preservation, and it is fixed by
> replacing this file with one document per candidate:
>
> - **`REVIEW_GATE_HANDOFF_INDEX.md`** — the candidate lineage, every verdict, and where each
>   superseded handoff lives in git history.
> - **`REVIEW_GATE_HANDOFF_05162ac1_20260902.md`** — the current candidate.
>
> The text below describes candidate `76203f01`, which received NO-GO. It is kept unedited as the record
> of what round 4 reviewed. Nothing in it should be treated as current.

# Codex reviewer handoff — mandatory review gate, frozen candidate

**Date:** 2026-09-02
**Author:** Claude (implementer)
**Round:** 4. Supersedes the round-1 text of this file entirely.
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
| code content | see the note below; round-3 remediation changed it |

| parent | `77a84dcc25147dba50799bcf4c8aa0cab4a23170` |
| stable patch id | resolve with the command below; it changes every round |
| branch | `feat/review-gate-20260902` (pushed; **no pull request opened**) |
| working tree | clean |
| scope | 10 files, +2227 / −0 |

```
A  control-center/docs/review-gate-codex-handoff-20260902.md
A  control-center/docs/review-gate-current-state-20260902.md
M  control-center/packages/shared/package.json
M  control-center/packages/shared/src/index.ts
A  control-center/packages/shared/src/reviewGate.ts
A  control-center/packages/shared/src/reviewGateInternal.ts
A  control-center/packages/shared/src/reviewGateService.ts
A  control-center/packages/shared/test/reviewGate.test.ts
A  control-center/packages/shared/test/reviewGateBoundary.test.ts
A  control-center/packages/shared/test/reviewGateService.test.ts
```

**Why the candidate commit is not a literal hash.** This document is *in* the candidate, so the tip
commit is the one that adds it, and no revision of it can name its own hash. Resolve the candidate and
its patch id with:

```
git rev-parse origin/feat/review-gate-20260902
git diff origin/main...origin/feat/review-gate-20260902 | git patch-id --stable
```

Round 3 reported the scope as `+1787 / -0` where git said `+1859`. The number above is `git diff
--numstat origin/main...HEAD` at the time of writing and will drift again; trust the command, not the
table. Round-3 remediation changed executable code, so unlike the previous round this candidate is NOT
code-identical to its predecessor.

**Review lineage.** `311506ce` (round 1) → NO-GO, 2 CRITICALs. `77a84dcc` (round 2) → NO-GO, 3 CRITICALs,
**one of which I introduced while fixing the first two**. `5dd28eb0` (round 3) → NO-GO, 2 CRITICALs, both
falsifying claims this document made. This is round 4.

---

## 2. What changed since round 3, and what you falsified

Round 3 returned NO-GO with two CRITICALs. **Both were correct, and both falsified a claim this document
made.** That is now three rounds in a row in which my description of a boundary was stronger than the
boundary. The pattern is specific enough to name: *I keep mistaking a convention for an enforcement.*

### C1 — the evaluator was still reachable, and my "boundary" was a naming convention

You wrote: removing the symbol from `index.ts` does not make the module inaccessible, because
`package.json` has no `exports` map, so a consumer can write

```ts
import { evaluateTransition } from "@control-center/shared/dist/reviewGate.js";
```

and rebuild the original bypass. **Confirmed — that resolved.** My round-3 claim that the evaluator was
"genuinely unreachable" was false, and the import-boundary test was the weaker substitute you called it:
it scanned `apps/` for an identifier, which catches a relative import inside the monorepo and nothing else.

Two changes, only one of which is enforcement:

- **`package.json` now declares `exports` with a single `"."` entry** (`package.json:8`). Node refuses
  every other subpath. This is the part that actually closes the attack.
- **The evaluator moved to `src/reviewGateInternal.ts`**, a module whose name states its status, so the
  boundary has somewhere to live. This is still only a convention, and the file says so.

`reviewGateBoundary.test.ts` now asserts the enforcement rather than the convention: the exports map must
exist, must list exactly `["."]`, must contain no wildcard, and must not name a review-gate module. Those
four assertions are what would have caught this finding.

**Honest scope.** The exports map governs package-specifier imports. A *relative* import from elsewhere in
the monorepo (`../../packages/shared/src/reviewGateInternal.js`) still resolves; that is what the `apps/`
scan covers. Neither mechanism covers both, and the test file says so where it is asserted.

### C2 — the principal was forgeable by every consumer

You wrote: `principalFromSession` was publicly exported, so an author could mint the uninvolved reviewer
named in the verdict; and a plain `{ identity: "codex" }` satisfies the type structurally. **Confirmed on
both counts.** The private constructor stopped `new` and nothing else, which is a smaller claim than the
one I made for it.

The design is now different in kind rather than degree:

- **No operation accepts a principal.** `createCandidate`, `transition` and `submitVerdict` take an opaque
  `proof: unknown`. There is no principal argument left to forge.
- **The service mints internally**, through a `SessionAuthenticator` injected at construction. The
  application's authentication system is the root of trust, explicitly and by injection.
- **A runtime brand.** Instances are recorded in a module-private `WeakSet`; a structural look-alike, and
  an `Object.create(TrustedPrincipal.prototype)` that genuinely passes `instanceof`, both fail
  `isTrusted`. There is a test for exactly that.
- **The index exports `TrustedPrincipal` as a TYPE ONLY**, so external code has no value binding on which
  to call a static. There is no public minting function at all.
- **An authenticator that throws denies.** It never authenticates by accident.

**What this still is not.** Whoever supplies the authenticator defines identity. That is the correct trust
root, but it means the gate is exactly as sound as the application's authentication, and this package
cannot make that claim on the application's behalf. The difference from round 3 is that the package no
longer *makes* the claim.

### MODERATE-1 — the C3 fix had no attack test

You were right that `reviewGateService.test.ts:99` proved bookkeeping, not the bypass, and that the
handoff's claim of "a test written as the attack for every CRITICAL" was therefore false. There is now an
end-to-end test that walks `NO_GO → REMEDIATION_REQUIRED → REMEDIATING → RETEST_REQUIRED → TESTED →
FROZEN → REVIEW_REQUESTED → REVIEW_IN_PROGRESS` as the reviewer and then attempts `GO`. It fails with
`reviewer_not_independent`, and it fails for the right reason: the ledger shows the remediator row that
the round-2 design let the caller omit.

### MODERATE-2 — the counterpart test was vacuous

Confirmed. `index.includes(name) || /reviewGateService\.js/.test(index)` is true whenever the index
mentions that module at all, so all four names could have been deleted with the test still green. The
disjunction is gone and the list is longer.

### MINORs

- The reachability test **was** misnamed; it checked table membership only. There is now a real BFS from
  `BUILT` asserting all 15 states are reachable, plus a counterpart proving the only states without an
  exit are the three declared terminal ones.
- The branch-identity test's name contradicted its assertion. **The assertions were right and the name was
  wrong**: `baseBranch` is part of the binding, so repointing a candidate makes it a different candidate.
  Renamed to say that, with the reasoning written in — a GO earned against `main` must not carry to
  `release/2026-09` by editing a field.
- The future-verdict correction now has two regression tests: one rejecting a future date, one proving
  modest skew is still accepted, so the fix did not become a blanket refusal.
- Scope figures: see §1. I have replaced the hardcoded count with the command that produces it.

### A defect I found in my own remediation, before you did

While writing the C2 boundary test I asserted the type-only export with a regex, then mutation-checked it
by flipping `type TrustedPrincipal` to `TrustedPrincipal`. **The test did not catch it** — the negative
lookahead excluded exactly the shape a value export takes. That would have been a fourth vacuous test of
mine in three rounds.

It is now a **runtime** assertion: the test imports `../src/index.js` and checks the actual module
namespace has no `TrustedPrincipal`, no `principalFromSession` and no `evaluateTransition` binding, with a
counterpart proving `ReviewGateService` *is* bound. It cannot be fooled by my regex, and my regexes are
demonstrably the weak link. **Please check whether any remaining text-matching assertion has the same
problem.**

## 3. What to attack, ordered by where I think this is weakest

1. **The authenticator seam is now the whole of identity.** See §2 C2. The forgeable principal is gone,
   but `SessionAuthenticator` is supplied by the application, so a wrong or permissive implementation
   reopens everything at a single call site. Is injection the right seam, or should the package refuse an
   authenticator it cannot itself constrain?
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
| full shared package | 137 | 136 | 0 | 1 |

The single skip pre-exists this candidate. `tsc --noEmit -p tsconfig.json` is clean for `packages/shared`
AND for `apps/api`, `apps/agent` and `apps/updater` — checked because the new `exports` map could have
broken a consumer. No workspace imports a subpath of the shared package, so none did.

**You could not run the suite in round 3** (`spawn EPERM` under the read-only sandbox), so these numbers
remain unverified by anyone but me. Given three rounds of my tests being wrong, treat the count as a
claim rather than as evidence, and read the assertions instead.

Round 3 correctly rejected the earlier form of this paragraph. Every CRITICAL from rounds 2 AND 3 now has
a test written **as the attack** — including the C3 end-to-end walk that was missing, the structural
principal forgery, an `Object.create` look-alike that genuinely passes `instanceof`, a throwing
authenticator, and seven unrecognised proof shapes.

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
| **M2** | Artifact/execution-context binding is optional (`reviewGate.ts:105-106`). You said this should block production use, or any claim that candidate identity is complete. Agreed, still not attempted, and I would rather you re-raise it than see it fade into a table. |
| §H.16 | No durable store. `InMemoryReviewGateStore` only, so restart durability and cross-process compare-and-set are unimplemented. No production assurance attaches to this. |
| r1 | Rollback-target *semantic* validation — the field is required, its content is not checked. |
| — | **The authenticator itself.** `SessionAuthenticator` is injected, so identity is only as sound as the implementation the application supplies. Nothing here wires one to real auth middleware. |

Closed since round 3, listed so you can check I have not quietly promoted anything: graph-reachability
completeness test (now a real BFS), branch-identity test naming, the future-verdict regression tests, the
vacuous counterpart test, and the missing C3 attack-path test.

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

**This workstream: ~50%.** §A complete, §B complete, §C core plus an in-memory store complete, §H mostly,
and as of this round the package boundary is enforced rather than described.
**Remaining ~50%:** the durable store and its restart guarantees (§C persistence, §H.16), artifact binding
(M2), review-dispatch adapters (§D), the reviewer packet and risk classification (§E), the evidence packet
emitter (§G), redaction (§H.15), operator documentation, and wiring the service into the live approval
routes behind a real SessionAuthenticator.

The percentage moved five points while two CRITICALs were closed, which is the honest ratio: the work this
round was making two existing claims true, not adding capability.

**Disposition: `READY_FOR INDEPENDENT REVIEW`.** Not certified, not deployable, not wired in.
