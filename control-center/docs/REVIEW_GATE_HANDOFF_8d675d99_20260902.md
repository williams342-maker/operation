# Executor wiring — candidate W1 handoff to independent review

**Date:** 2026-09-02
**Author / remediator:** Claude. I wrote every line of this candidate and every line below.
**Receiving reviewer:** Codex, or any reviewer with no prior participation on this candidate.
**Round:** 1 (first review of the wiring; the gate service itself reached GO separately at its round 5).

> **All author-side claims here are leads and evidence pointers, not certification. Re-derive every
> material finding from primary evidence.** The lineage in `REVIEW_GATE_HANDOFF_INDEX.md` records ten
> NO-GOs whose common shape was mine: *I described a boundary that was stronger than the mechanism behind
> it.* This candidate is the highest-risk kind of code in the workstream — it is the remediation of the
> gate's own central weakness (that nothing consulted it), and per policy the remediation deserves more
> suspicion than the thing it fixes, not less.

---

## A. Objective

Make the review gate stop being advisory *by construction* rather than by assertion: an executor that has
been activated must not be able to apply a privileged task to a host without first taking execution from
the gate, and must fail closed when it cannot.

**What this candidate is NOT:** it is not activation. Every executor is `DISABLED`. Nothing was deployed,
no credential was created, no feature flag was flipped, and production is untouched.

## B. Current disposition

**ENGINEERING COMPLETE / REVIEW READY.** Wired, tested, inert.

| | before this candidate | after this candidate | after activation (**NOT DONE**) |
|---|---|---|---|
| gate prevents a deployment | no | no | yes |
| executor consults the gate | never | only when `ENFORCING` | yes |
| unreviewed privileged task | applies | applies | refused |
| gate unreachable | irrelevant | irrelevant | deployment stops |

The third column is the one that has not happened, and cannot happen without an owner decision and a
per-executor gate credential. See §I.

## C. Repository and environment

| | |
| --- | --- |
| repository | `williams342-maker/operation` |
| local path | `C:\Users\Mike\Downloads\Claude\opsworkbench-handoff-20260901\repo\operation` |
| branch | `feat/review-gate-20260902` |
| base branch | `main` |
| pull request | **none opened** |
| node | v24.18.0, Windows |

Per-workspace commands, from `control-center/`:

```
cd apps/agent       && npm test && npx tsc -p tsconfig.test.json
cd apps/review-gate && npm test && npx tsc -p tsconfig.test.json
cd packages/shared  && npm test
```

## D. Candidate identity

| | |
| --- | --- |
| **code commit** | `8d675d9955a93ce0fbff75bea1b9504f032f3f19` — the reviewable code, frozen |
| wiring commit | `12049b9b4bca39625cdea982458628b28520d7fe` |
| **candidate commit** | the tip of `feat/review-gate-20260902` — this document is *in* the candidate, so no revision of it can name its own hash |
| predecessor | `b19c8c62` (the gate service, **GO** at its round 5) |
| supersedes | nothing — this is a new workstream on top of a GO'd base |

```
git log --oneline b19c8c62..8d675d99
git diff b19c8c62..8d675d99 --stat
```

## E. What to review, in priority order

Everything below is a claim of mine. The point of the list is the order to attack it in.

### E1. The effect point — `apps/agent/src/agent.ts`, `executeTask`

The sequence I claim is enforced:

```
1. the gate ACQUIRES  — a mutation, so one delivery in the estate proceeds
2. the journal CLAIMS — a file, so one attempt on this host proceeds, across restarts
3. the effect happens
4. the journal RECORDS the outcome
5. the gate REDEEMS
```

**Attack it by asking:** is there any privileged path in `executeTask` that reaches an effect without
passing step 1? `test/reviewEnforcement.test.ts` asserts this structurally (acquisition's index in the
function body precedes both `executeConfigurationDeployment` and `handoffUpgrade`), which is a weaker
check than it looks — it would not catch a new privileged effect invoked through a helper. **A reviewer
who finds such a path has found the defect that matters most in this candidate.**

### E2. Two winners, and whether either is what I say it is

The gate stops a second *delivery* and cannot fence a host across its own restart; the journal does that
and nothing else. Neither makes application atomic.

- `ExecutionJournal` uses `fs.writeFileSync(..., { flag: "wx" })` so the **filesystem** decides the race,
  not a read-then-write in my code. Verify that claim at `apps/agent/src/executionJournal.ts`.
- The action digest becomes a **filename**. There is a sha256-hex guard; if it can be defeated, a gate or
  control-center that chooses that string chooses a path on the host.

### E3. Activation cannot be silently downgraded — `apps/agent/src/reviewEnforcement.ts`

An earlier review of this workstream made the point that if enforcement is only the presence of a setting,
then *losing* the setting turns enforcement off. So:

- `ENFORCING` with no usable gate config → **throws at startup**, does not run advisory.
- A corrupted record → **throws**, is not read as `DISABLED`.

**The known hole, stated plainly:** a *missing* file reads as `DISABLED`. An executor that was never
activated and one whose state file was deleted are indistinguishable from inside the executor. Root
access to the host defeats activation. I did not fix this because the fix is not local — it needs the
state somewhere the executor cannot be talked out of (a signed bootstrap, or the gate refusing to answer
an executor it believes is enforcing). **It is a real weakness and I am flagging it rather than describing
around it.**

### E4. Fail closed — `apps/agent/src/reviewGateClient.ts`

Unreachable, timeout, wrong status, unparseable body, a 200 whose body does not say `ok`: all refuse.
No cache, no grace period, no last-known-good. **Attack it by looking for any path that returns
permission without a positive answer from the gate.**

### E5. The credential

The executor authenticates with **its own** credential from configuration. If the control-center could
supply the proof that its own deployment was reviewed, the review would be decorative. A test offers
`credential` / `authorization` / `token` at the acquire call site and asserts neither the header nor the
request body picks them up.

### E6. Layer 3 is additive — `packages/shared/src/ownerAuthorization.ts`

`requireReviewAuthorization` defaults to `false`. A `DISABLED` executor takes no new code path, and layers
1 and 2 are untouched. There is a test that a forged owner authorization is still refused **when a valid
review reference is present** — i.e. layer 3 does not weaken layer 2.

**Note a real asymmetry:** layer 2 is only enforced when `ownerPublicKey` is configured (pre-existing
behaviour this candidate does not change). So for an executor missing that key, verification alone lets a
privileged task through, and *only the effect point stops it*. There is a test for this. Whether that
pre-existing conditionality is acceptable is worth a reviewer's opinion.

### E7. Redeeming an upgrade at the handoff

`agent.upgrade` redeems when the handoff is written, not when the updater reports. My reasoning: redeem
means *the authorization was spent*, not *the upgrade succeeded*, and by that line it has been — an
independent updater will act, including by replacing this process. Holding the lease until the updater
reports would make every upgrade `INDETERMINATE`, because the executor that would redeem it no longer
exists.

**This is a judgement call and I may have it wrong.** If redeem must mean completion, this is a defect.

## F. Evidence

| suite | tests | pass | fail | skip |
|---|---|---|---|---|
| `apps/agent` | 86 | 81 | 0 | 5 (pre-existing) |
| `apps/review-gate` | 167 | 166 | 0 | 1 (Mongo, no replica set here) |
| `packages/shared` | 79 | 78 | 0 | 1 |
| `apps/api` | 133 | 131 | 0 | 2 |
| `apps/updater` | 4 | 4 | 0 | 0 |
| `apps/web` | 34 | 34 | 0 | 0 |

**The evidence I would weigh most:** `apps/review-gate/test/executorContract.test.ts` runs the real router
on a real socket against the real executor client. Before it, both sides were tested in isolation — which
is precisely how a contract mismatch survives two green suites. It proves, by execution:

- the digest the executor computes from the payload it holds is the one the gate bound at review time;
- `acquire` moves `RESERVED_BOUND → EXECUTING`, `redeem` moves `EXECUTING → CONSUMED`;
- a **second host with an empty journal of its own** cannot acquire what the first took;
- a payload altered after review cannot acquire, and leaves the attestation at `RESERVED_BOUND`;
- a wrong target and a bad credential each acquire nothing.

**Test provenance is unchanged and still unresolved:** these numbers are my assertion. Nothing in this
candidate provenances them, and the gate's own GO was explicitly scoped to exclude test provenance.

## G. What I found while doing this, and fixed

- `apps/agent` **never typechecked its tests** — `tsconfig.json` includes only `src`. This is the same gap
  found earlier in the gate. Added `tsconfig.test.json`; it surfaced one real pre-existing type error in
  `betaDeploymentPreflight.test.ts`, which is fixed.
- The gate's route tests never exercised `acquire`/`redeem` over HTTP at all. Now covered by E-evidence
  above.

## H. What I did NOT do

- No executor activated. No gate credential created or requested.
- Nothing deployed, no PR opened, no branch protection touched, `main` untouched.
- No production data read or written. Production mutations: **0**.
- No change to the gate service's own logic — this candidate only adds a caller.

## I. Owner action

**Two items, both genuine authority boundaries.**

1. **Activation is an owner decision.** Turning an executor `ENFORCING` means: an unreachable gate stops
   deployments to that host. That trade is the owner's to make, not mine, and it is the entire point of
   the gate — softening it would be the defect.
2. **Each activated executor needs its own gate credential.** Creating credentials is outside my
   authorization. The gate's principal model already expects an `executor` role scoped by
   `audienceFor: [{ orgId, serverId }]`, so the shape is defined; issuing one is not mine to do.

**Everything else in this workstream continues without owner involvement.** If this candidate comes back
NO-GO, I resume remediation directly and route the result to an independent certifier — I do not certify
my own remediation, and the owner is not the message bus between engineering agents.

## J. Continuation, if you are picking this up cold

```
cd C:\Users\Mike\Downloads\Claude\opsworkbench-handoff-20260901\repo\operation
git checkout feat/review-gate-20260902
git rev-parse HEAD          # expect 8d675d9955a93ce0fbff75bea1b9504f032f3f19
cd control-center/apps/agent       && npm test && npx tsc -p tsconfig.test.json
cd ../review-gate                  && npm test && npx tsc -p tsconfig.test.json
```

Read in this order: `REVIEW_GATE_OPTION_B_DESIGN.md` §1 (status), §2.6 (the sequence this implements),
§2.7 (activation), §3.1 (residual trust) → then `apps/agent/src/reviewEnforcedExecution.ts` → then
`agent.ts::executeTask`. The remaining open items on the gate service itself are in
`REVIEW_GATE_BUILD_STATE.md`.
