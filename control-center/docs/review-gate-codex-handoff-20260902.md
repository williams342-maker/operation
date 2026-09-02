# Codex reviewer handoff — mandatory review gate, frozen candidate

**Date:** 2026-09-02
**Author:** Claude (implementer)
**Requested reviewer:** Codex, or any reviewer with no prior participation on this candidate
**Disposition:** `READY_FOR INDEPENDENT REVIEW`

**This is not a certification and must not be recorded as one.** I authored every line below. The whole
point of the gate being reviewed is that an author cannot certify their own work, and that applies to this
candidate as much as to anything it will later police.

---

## 1. Candidate identity

| field | value |
| --- | --- |
| repository | `williams342-maker/operation` |
| base branch | `main` |
| base commit | `07244a83aae47d600a9c9f062999e10e8707840f` |
| candidate commit | `311506cee3514a6f96e81f7fe5875bf308ba390d` |
| candidate tree | `5728e1432ad3f0333a850a86342352f043f44198` |
| parent | `be695c7034b79ad67c1bd3091a1959b28f74dcc3` |
| stable patch id | `8a2952b4fe0005d12b15c0d1317c662fadd4739e` |
| branch | `feat/review-gate-20260902` (local only, never pushed) |
| working tree | clean |
| scope | 4 files, +730 / −0 |

```
A  control-center/docs/review-gate-current-state-20260902.md
M  control-center/packages/shared/src/index.ts
A  control-center/packages/shared/src/reviewGate.ts
A  control-center/packages/shared/test/reviewGate.test.ts
```

Verify with `git diff origin/main...311506ce | git patch-id --stable`.

---

## 2. Three handoff premises that are false, checked before building on them

The handoff asked for a bypass inventory. Producing one falsified three of its own assumptions, and the
design follows the evidence rather than the brief.

**There is no smoke-test path to close.** The handoff's central worry is smoke success substituting for
release approval. `apps/api/src` contains no `smoke`, no `testsPassed`, and no test-result gate at all.
Nothing advances on a test result because nothing reads one. The work is to keep it that way as tests are
wired in, not to unpick an existing shortcut.

**There is no `codex.py` and no MCP intake** in either `operation` or `foreman`. §F describes adviser
screening applied in `codex.py` while MCP intake bypasses it. Neither exists. §F is therefore *narrowed*,
which the handoff explicitly permits, rather than "fixed": there is no second intake path to bring under
the same checks, and the requirement becomes a forward constraint on any intake added later.

**There is no reviewer concept to extend.** No verdict, no reviewer identity distinct from an approver, no
findings, no remediation linkage. §C is new construction, not a refinement.

---

## 3. Bypass inventory — what the gate is actually for

Full detail in `review-gate-current-state-20260902.md`. Five findings, all still live on `main`:

| id | finding |
| --- | --- |
| **B1** | Nothing compares approver to author. `approvedByUserId` is recorded, never checked against `createdByUserId`; `agentUpgradeRoutes.ts:70` writes the same `actorId(req)` to both. **An author can approve their own work, everywhere, today.** |
| **B2** | The separation of duties is nominal. Configuration deployment splits `deploy-non-production` from `approve-non-production`, but `rbac.ts` gives **both** to Owner and Administrator and **neither** to Developer or Viewer. No role can deploy without also being able to approve. |
| **B3** | Agent upgrades do not split the permission at all — create and approve both require `agent:update`. |
| **B4** | No test asserts any of this, so B1–B3 can regress silently. |
| **B5** | No reviewer concept exists. |

**This candidate does not fix B1–B3.** It builds the mechanism that makes fixing them expressible. Wiring
`evaluateTransition` into the existing routes is the next candidate, and doing it in this one would have
mixed a new subsystem with a behaviour change to live approval paths.

---

## 4. What to attack

Ordered by where I think the design is weakest.

1. **`independenceOf` trusts the participation ledger.** Nothing in this candidate writes that ledger — a
   caller supplies it. If a caller can supply an empty `participants` array, independence collapses to the
   single `identity === authorIdentity` check. That is the load-bearing gap, and it moves to the store
   layer, which does not exist yet. Is the seam in the right place, or should the ledger be read rather
   than passed?
2. **`candidateDigest` covers what I chose to put in the binding.** Anything absent from
   `candidateBindingSchema` can change without changing identity. Look for something material I left out —
   compiler version, base image, feature flags, migration set.
3. **The transition table is the whole safety argument.** `TESTED -> GO` and `FROZEN -> GO` are absent by
   design. Look for a path through legal moves that reaches `READY_FOR_OWNER_DECISION` without an
   independent verdict. I believe there is none, and I built the table so I am the wrong person to be sure.
4. **§H.18's exemption is a judgement call.** `development` and `test` skip the rollback requirement, on
   the reasoning that demanding a rollback target where none exists teaches people to write placeholders.
   Disagree if you think it is a hole.
5. **`safeId` permits `/` and `:`.** Chosen so repository and branch identifiers fit. Check it cannot be
   abused where these values are interpolated.
6. **NO_GO requires at least one finding** — a reviewer cannot reject without saying why. Reasonable, or an
   obstacle that will get worked around?

---

## 5. Evidence

**Tests.** `npx tsx --test test/*.test.ts` in `control-center/packages/shared`:

| suite | tests | pass | fail | skip |
| --- | ---: | ---: | ---: | ---: |
| `reviewGate.test.ts` alone | 23 | 23 | 0 | 0 |
| full shared package | 102 | 101 | 0 | 1 |

The single skip pre-exists this candidate. Typecheck (`tsc --noEmit -p packages/shared/tsconfig.json`)
is clean.

**Adversarial coverage**, numbered against §H. Covered here: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 18, 20.

**NOT covered, and not claimed:** 12 (idempotent duplicate callbacks), 16 (restart durability), 17
(concurrent transition ordering) all require the durable store, which this candidate does not build. 14
(MCP parity) is not applicable — no MCP intake exists. 15 (secret redaction) is not implemented; there is
no evidence-persistence layer yet to redact into. 19 (a skipped required test blocks freeze) is partially
covered — `testResultDigest` is bound into identity, so changing test results changes the candidate, but
nothing yet *evaluates* whether required tests were skipped.

Claiming 12, 16 or 17 from unit tests would be precisely the unearned assurance this gate exists to
prevent.

**Two tests exist to stop the suite being vacuous:** one proves an uninvolved reviewer *is* accepted, so
the independence check is not simply rejecting everyone; one derives the completeness check from the state
*list* rather than the transition table it polices, so deleting a state cannot delete its own coverage.

---

## 6. Required demonstrations

- **Smoke pass cannot bypass review.** No smoke concept exists to bypass with; separately, `TESTED -> GO`
  is absent from `TRANSITIONS` and the test asserts it for both `TESTED` and `FROZEN`.
- **Review GO stops at owner decision.** `TRANSITIONS.GO === ["READY_FOR_OWNER_DECISION"]` and
  `TRANSITIONS.READY_FOR_OWNER_DECISION === []`. A test asserts `GO` is the *only* state that reaches
  owner decision, derived by scanning the table rather than by restating it.
- **NO-GO → remediation → retest → new review.** `NO_GO -> REMEDIATION_REQUIRED -> REMEDIATING ->
  RETEST_REQUIRED -> TESTED`, with `REMEDIATING -> REVIEW_REQUESTED` asserted absent, so remediated work
  cannot re-enter review without being retested.

---

## 7. Rollback

`git branch -D feat/review-gate-20260902`. The branch is local and unpushed; `main` is untouched at
`07244a83`. The three added files are new and the one modification is a single export line in `index.ts`.
Nothing is wired into a running route, so removing it changes no behaviour.

---

## 8. Mutations

**Production: 0. Database: 0. Credentials: 0. Infrastructure: 0. External providers: 0. GitHub: 0** — no
branch pushed, no pull request opened, no branch protection changed, consistent with the handoff's
non-goals.

---

## 9. Completion

**This workstream: ~35%.** §A complete, §B complete, §C core complete, §H partially. **Remaining ~65%:**
the durable store and its concurrency and restart guarantees (§C persistence, §H 12/16/17), review-dispatch
adapters (§D), the reviewer packet and risk classification (§E), the evidence packet emitter (§G),
redaction (§H15), operator documentation, and wiring `evaluateTransition` into the live approval routes to
close B1–B3.

**Disposition: `READY_FOR INDEPENDENT REVIEW`.** Not certified, not deployable, not wired in.
