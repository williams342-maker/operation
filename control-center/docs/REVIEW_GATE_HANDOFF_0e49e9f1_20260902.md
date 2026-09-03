# Executor wiring — candidate W2 handoff to independent review

**Date:** 2026-09-02
**Author / remediator:** Claude. I wrote the candidate, the defects, and this document.
**Receiving reviewer:** Codex, or any reviewer with no prior participation.
**Round:** 2. **Predecessor W1 (`8d675d99`) was NO-GO** — see `REVIEW_GATE_HANDOFF_8d675d99_20260902.md`,
which is preserved unedited.

> **This document is leads and evidence pointers, not certification. Re-derive every material finding.**
> Round 1 found three defects. I found a fourth while auditing that the reviewer had not reached, and it
> was the most consequential. The scoreboard for this workstream is now eleven NO-GOs, and the shape has
> never changed: *my tests confirm my description of a mechanism instead of measuring the mechanism.*
> Two of the four defects below are exactly that, again.

---

## A. What round 1 found, and what I did about it

| # | severity | defect | source | fix |
|---|---|---|---|---|
| 1 | CRITICAL | `executeTask` took enforcement as an optional argument defaulting to advisory. Any caller omitting it bypassed the gate on an `ENFORCING` host. | reviewer | `executeTask` resolves enforcement itself from durable state. **There is no argument to omit.** |
| 2 | CRITICAL | The executor digested the **wrong object**: `privilegedActionDigest(taskPayload)` where the gate binds `privilegedActionDigest(subPayload)`. An activated executor would refuse every privileged task. | **mine — the reviewer did not reach it** | One shared `privilegedSubPayload()`; the executor and layer 3 both use it. |
| 3 | MAJOR | `state` and `history` were validated separately while only `state` was read, so `{state: DISABLED, history: [ENFORCING]}` passed and resolved advisory. | reviewer | `superRefine` requires them to agree. |
| 4 | MAJOR | Any syntactically valid URL was usable gate config, including `http://` — plaintext credential, spoofable `200 {"ok":true}`. | reviewer | TLS required; loopback exempt. |
| 5 | MINOR | `ExecutionJournal.list()` threw on a stray file, breaking the reconciliation tool. | mine | Filters on the digest shape. |

The reviewer also **cleared** these, and I am not re-litigating them: `ExecutionJournal.claim` genuinely
uses filesystem-exclusive `wx`; the filename guard blocks traversal; layer 3 does not weaken layer 2 where
layer 2 is configured; and redeeming `agent.upgrade` at the handoff is correct under this state machine
(`CONSUMED` means the authorization was spent — failed applications are consumed too, so requiring updater
success would be inconsistent).

## B. Defect 2, in full, because it is the one that matters

`reviewAuthorization` lives inside `configurationDeploymentPayloadSchema` and
`agentUpgradeManifestSchema`. It is **not** at the top of `taskPayloadSchema`, which is `.strict()` and has
no such field. The gate validates and binds the **sub-payload**. The executor was computing its digest and
reading its reference from the **task payload that wraps it**.

Consequences, in order of how they would actually have played out:

1. `verifyTask` under enforcement: reference not found → **every privileged task refused**.
2. Had that passed, `acquireForEffect` would have sent a digest the gate has never seen → refused.

It fails closed, so it is not an opening. It is worse in a different way: enforcement that can never
succeed is enforcement that gets switched off by whoever is on call.

**The third expression.** I fixed the executor's call site first and the end-to-end test immediately
failed on `verifyTask` — the same defect in a second place. That is the pattern from this workstream's
history: fix one expression, ship the others. There is now exactly one function that knows where the
privileged payload lives, used by both.

**Why every test passed anyway.** My contract test fed `acquireForEffect` the *gate's* payload shape
directly. My unit fixture put `reviewAuthorization` at the top of the task payload — the defect's own
shape. Both tests asserted my description. Neither ran the executor.

## C. The evidence that is actually new

`apps/review-gate/test/executorEffectPoint.test.ts` calls **`executeTask(config, task)`** — the real
exported function with its real two-argument signature, a real signed envelope, a real owner signature, a
real gate on a socket, a stub control-center to acknowledge to, and a durable `ENFORCING` record on disk.
**Nothing about enforcement is passed in; it has to be found.**

Both criticals fail loudly against it. It asserts:

- an enforcing executor acquires and redeems without being told to (`CONSUMED`, journal entry written);
- the digest sent is the sub-payload's, and that this **differs** from the wrapper's — so the test cannot
  pass by accident;
- a payload altered after review is refused, the attestation stays `RESERVED_BOUND`, and **nothing is
  claimed on this host**;
- an unreachable gate deploys nothing;
- a `DISABLED` executor never touches the attestation;
- a redelivered task cannot acquire twice.

The effect itself cannot succeed on a test machine (no docker; the fixture's health-check URL is refused
by the agent's own SSRF guard). That failure is *downstream* of what these tests measure and is caught
explicitly, so an acquisition failure cannot hide inside it — every assertion checks gate state and
journal contents directly.

## D. Candidate identity

| | |
| --- | --- |
| **code commit** | `0e49e9f1fd14cf334e37436b8578babebfc5d3fa` |
| predecessor | `8d675d99` (**NO-GO**, round 1) |
| base | `b19c8c62` (the gate service, GO for its built scope) |
| branch | `feat/review-gate-20260902` |
| pull request | **none opened** |

```
git diff 8d675d99..0e49e9f1 --stat        # the remediation alone
```

## E. What to attack this round

1. **Defect 2 had three expressions and I claim I found all of them.** Search for any other place that
   reaches into a payload to find `reviewAuthorization`, `configurationDeployment` or `agentUpgrade`
   without going through `privilegedSubPayload`.
2. **Defect 1's fix is the highest-risk code here** — remediation is always the most dangerous part of a
   change, and this one restructured the effect point. Is enforcement now genuinely unbypassable from
   *any* caller of `executeTask`, including one that supplies a doctored `config`?
3. `privilegedSubPayload` returns `undefined` for an unknown task type, so an enforcing executor refuses
   it. Confirm a new privileged type cannot be added such that it is *applied* rather than refused.
4. **The TLS fix is deliberately partial and I want it challenged.** It stops plaintext and a spoofed
   answer. It does **not** authenticate the gate: a certificate from any trusted CA for that name
   satisfies it. I put pinning in the activation design rather than here. Tell me if that is wrong.
5. **A real asymmetry I am flagging rather than smoothing over:** layer 2 signs
   `privilegedActionDigest(taskPayload)` while the gate binds `privilegedActionDigest(subPayload)` — two
   scopes for one action. Both are computed rather than asserted, and neither weakens the other, but
   whether they *should* be the same scope is a design question I did not want to settle by picking
   whichever made the code shorter.
6. **Still-known and unfixed:** a *deleted* enforcement record reads as `DISABLED`, so root on a host
   defeats activation. The fix is not local — it needs a signed bootstrap or the gate refusing an executor
   it believes is enforcing.

## F. Evidence

| suite | tests | pass | fail | skip |
|---|---|---|---|---|
| `packages/shared` | 79 | 78 | 0 | 1 |
| `apps/review-gate` | 173 | 172 | 0 | 1 (Mongo, no replica set here) |
| `apps/agent` | 90 | 85 | 0 | 5 (pre-existing) |
| `apps/api` | 133 | 131 | 0 | 2 |
| `apps/updater` | 4 | 4 | 0 | 0 |
| `apps/web` | 34 | 34 | 0 | 0 |

Both `tsconfig.test.json` typechecks clean. **Test provenance remains unresolved: these numbers are my
assertion**, and nothing in this candidate provenances them.

> Round 1's reviewer could not execute the suites — the managed environment denied child-process creation
> (`spawn EPERM`) before any test body ran. **That means no independent party has yet executed these
> tests.** A reviewer who can run them should; if you also cannot, say so in the verdict rather than
> treating the table above as verified.

## G. What I did NOT do

No executor activated. No gate credential created. Nothing deployed, no PR opened, `main` untouched, no
production data read or written. **Production mutations: 0.**

## H. Owner action

Unchanged from W1 §I, and still only two items: **activation is an owner decision** (it means an
unreachable gate stops deployments to that host), and **each activated executor needs its own gate
credential**, which I am not authorized to create. Everything else continues without owner involvement.

## I. Continuation

```
cd C:\Users\Mike\Downloads\Claude\opsworkbench-handoff-20260901\repo\operation
git checkout feat/review-gate-20260902 && git rev-parse HEAD   # 0e49e9f1...
cd control-center/apps/agent       && npm test && npx tsc -p tsconfig.test.json
cd ../review-gate                  && npm test && npx tsc -p tsconfig.test.json
```

Read: this document → `apps/review-gate/test/executorEffectPoint.test.ts` (the only test that measures the
wiring) → `agent.ts::executeTask` → `reviewEnforcedExecution.ts`. Design context in
`REVIEW_GATE_OPTION_B_DESIGN.md` §2.6, §2.7, §3.1. Lineage in `REVIEW_GATE_HANDOFF_INDEX.md`.
