# Executor wiring — candidate W3 handoff to independent review

**Date:** 2026-09-02
**Author / remediator:** Claude. I wrote the candidate, the defects, and this document.
**Receiving reviewer:** Codex, or any reviewer with no prior participation.
**Round:** 3. **W1 (`8d675d99`) NO-GO. W2 (`0e49e9f1`) NO-GO.** Both handoffs preserved unedited.

> Three rounds, six defects, and the shape has not changed once: **my description claims a boundary the
> mechanism does not have.** Round 2's finding was the same defect as round 1, one level deeper — I
> removed the caller-supplied *argument* and left the caller-supplied *location*. Assume the same thing
> has happened again and look for where.

---

## A. What round 2 found, and what I did

| # | severity | defect | fix |
|---|---|---|---|
| 1 | CRITICAL | Removing the enforcement argument fixed *omission* but not *substitution*: the record's **location** still came from `config.stateDir`, so `executeTask({...config, stateDir: emptyDir}, task)` resolved advisory on a host whose real record said `ENFORCING`. | `stateDir` is no longer a config field. The location derives from the process's own config path — a module constant resolved once at load. |
| 2 | MAJOR | `taskTypes` and `privilegedTaskTypes` were two hand-maintained lists and the drift was **fail-open**: a new mutating type in the first, forgotten in the second, skipped both the owner signature and the gate. | One table, `taskTypeClassification`, pairing every type with `read \| privileged`. Both lists derive from it. |

**What still comes from the config, deliberately:** *where the gate is*. Substituting or removing it fails
**closed** — an `ENFORCING` record with unusable gate configuration refuses to run at all. Only the
*whether* had to be made unreachable, because that is the input where "absent" reads as "permitted".

## B. The boundary, stated exactly

This is now in the code rather than claimed around it, because three rounds of claiming it loosely is
enough:

> Enforcement resists a caller that **omits, misconfigures, or substitutes configuration**. It does **not**
> resist arbitrary code in this process, which can call the deployment functions directly and never reach
> the executor. It does **not** resist write access to the host, which can edit the record or the config
> file. **Activation resists a compromised control-center. It does not resist a compromised host.**

If a reviewer thinks the second and third sentences should be defended rather than documented, say so —
that is a design decision, and I would rather be told than assume the disclosure is sufficient.

## C. Candidate identity

| | |
| --- | --- |
| **code commit** | `7b62c0c6b28958375c3b45f4684834e007025b3a` |
| predecessors | `0e49e9f1` (NO-GO, round 2), `8d675d99` (NO-GO, round 1) |
| base | `b19c8c62` (the gate service, GO for its built scope) |
| branch | `feat/review-gate-20260902` |
| pull request | **none opened** |

```
git diff 0e49e9f1..7b62c0c6 --stat      # this round's remediation alone
```

## D. HOW TO RUN THE AGENT SUITE IN YOUR SANDBOX

**No independent party has ever executed the agent tests.** Twice the runner died with `spawn EPERM`
before any test body ran. The cause: `node --test` spawns one child process per test file. Running each
file directly executes it in-process, and `node:test` still reports normally:

```
cd control-center/apps/agent
for f in test/*.test.ts; do npx tsx "$f"; done
```

Verified here — 90 tests, 85 pass, 5 pre-existing skips, 0 fail, no child spawn. The same trick works for
the review-gate suite. **If this still fails, please say so in the verdict** rather than treating my
numbers as verified.

## E. What to attack

1. **The same defect, one level deeper again.** Round 1: the argument. Round 2: the location. What is
   left that a caller still supplies and that reads as "not enforcing" when absent or wrong? I believe the
   answer is nothing, which is exactly what I believed at rounds 1 and 2.
2. **`stateDir()` derives from `configPath`**, a module constant read from `CONTROL_CENTER_AGENT_CONFIG`
   at import. Is there a path by which that is re-read, mutated, or influenced after load?
3. **The classification table** — `taskTypeClassification` in `packages/shared/src/tasks.ts`. It changes
   how *layer 2* classifies tasks, not just layer 3, so it touches previously GO'd behaviour. Confirm the
   classifications are unchanged (same three privileged types) and that nothing else consumed
   `taskTypes` in a way this breaks.
4. **The remediation is the highest-risk code**, per this project's policy, and this round's remediation
   restructured config and a shared protocol table. That is a wider blast radius than round 2's.
5. **The effect-point test's dynamic imports are load-bearing**, not stylistic — a static import is
   hoisted above the env assignment, so the config module would resolve its path before the test could
   set it, and the test would silently measure nothing. Check I have not left a static one.
6. **Still known and unfixed:** a *deleted* enforcement record reads as `DISABLED`. Under §B this is the
   same class as the disclosed host-access limit.

## F. Evidence

| suite | tests | pass | fail | skip |
|---|---|---|---|---|
| `packages/shared` | 82 | 81 | 0 | 1 |
| `apps/review-gate` | 174 | 173 | 0 | 1 (Mongo, no replica set here) |
| `apps/agent` | 90 | 85 | 0 | 5 (pre-existing) |
| `apps/api` | 133 | 131 | 0 | 2 |
| `apps/updater` | 4 | 4 | 0 | 0 |
| `apps/web` | 34 | 34 | 0 | 0 |

All typechecks clean (`tsconfig.test.json` in agent and review-gate; `tsconfig.json` in api and shared).

New this round: `executorEffectPoint.test.ts` gains the round-2 defect as a test — it hands `executeTask`
a config naming a different state directory and asserts the attestation still reaches `CONSUMED` **and**
that nothing was written where the caller pointed. `ownerAuthorization.test.ts` gains three tests that a
task type cannot exist unclassified, that `isPrivilegedTaskType` is derived rather than a second list, and
that an unclassified type is refused at the protocol boundary.

**Test provenance remains unresolved** — these numbers are my assertion, and nothing in this candidate
provenances them.

## G. What I did NOT do

No executor activated. No gate credential created. Nothing deployed, no PR opened, `main` untouched, no
production data read or written. **Production mutations: 0.**

## H. Owner action

Unchanged and still only two: **activation is an owner decision** (an unreachable gate then stops
deployments to that host), and **each activated executor needs its own gate credential**, which I am not
authorized to create.

## I. Continuation

```
cd C:\Users\Mike\Downloads\Claude\opsworkbench-handoff-20260901\repo\operation
git checkout feat/review-gate-20260902 && git rev-parse HEAD   # 7b62c0c6...
cd control-center/apps/agent && for f in test/*.test.ts; do npx tsx "$f"; done
npx tsc -p tsconfig.test.json
cd ../review-gate && npm test && npx tsc -p tsconfig.test.json
```

Read: this document → `apps/review-gate/test/executorEffectPoint.test.ts` → `agent.ts::executeTask` and
`reviewEnforcement()` → `config.ts::stateDir` → `packages/shared/src/tasks.ts::taskTypeClassification`.
Design context in `REVIEW_GATE_OPTION_B_DESIGN.md` §2.6, §2.7, §3.1; lineage in
`REVIEW_GATE_HANDOFF_INDEX.md`.
