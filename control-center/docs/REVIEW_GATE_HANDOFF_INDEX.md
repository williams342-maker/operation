# Review gate — candidate lineage index

**Objective:** build the mandatory review gate described in the OpsWorkbench Forge handoff, such that a
release candidate cannot reach owner decision without an independent reviewer's verdict against a
specific, immutable candidate identity.

**Current disposition:** the gate service holds its **GO for the built scope** (implementation round 5,
no findings — the first GO in this workstream, after ten NO-GOs on the previous design, six design-review
rounds on this one, and four implementation rounds). That GO is scoped: it does not cover test provenance
or the unverified Mongo store.

Two of the things it excluded — **the unwired enforcement point and the executor durable claim** — are now
built as a separate candidate. **W1 (`8d675d99`) was NO-GO**; **W2 (`0e49e9f1`) is the remediation and is
REVIEW READY** (`REVIEW_GATE_HANDOFF_0e49e9f1_20260902.md`). Both leave every executor `DISABLED`, so the
gate remains advisory in practice until an owner activates one.

**Previously:** ENGINEERING IN PROGRESS — Option B. The owner chose option B: the gate is a
separate service with its own database. The design went through SIX review rounds before any code was
written (`REVIEW_GATE_OPTION_B_DESIGN.md` v7), and six build phases have landed. Current build state and
what remains: `REVIEW_GATE_BUILD_STATE.md`.

Candidates A-K and their ten NO-GOs are the *previous* design, retained below as the record of why option
B was chosen. That policy now lives in `apps/review-gate`; it has been deleted from `packages/shared`.

**Owner action: FOUR ITEMS OPEN.** On the gate service — (1) test provenance needs key material for an
attestation scheme; (2) whether application code holding the service is trusted, which decides whether
authoritative mutation needs a separately deployed boundary. On W1 — (3) activating an executor is an
owner decision, because it means an unreachable gate stops deployments to that host; (4) each activated
executor needs its own gate credential, and creating credentials is outside my authorization. Everything
else in this workstream continues without owner involvement.

This file exists because the per-round handoff was previously **overwritten in place**, which destroyed
the reviewed text of earlier candidates. Each round's handoff is now its own file, and the text a reviewer
actually read is preserved at the commit named below. Never edit a superseded handoff; add a new one.

---

## Lineage

| # | candidate | handoff document | verdict | findings |
| --- | --- | --- | --- | --- |
| A | `311506ce` | `review-gate-codex-handoff-20260902.md` @ `8c3874f2` | **NO-GO** | 2 CRITICAL — every authoritative fact was caller-supplied; reviewer identity was an unsigned assertion |
| B | `e677e4fb` | retraction commit (no separate handoff) | — | B1/B4 of the current-state map **retracted**: approver/author separation already existed and was already tested |
| C | `77a84dcc` | `review-gate-codex-handoff-20260902.md` @ `77a84dcc` | **NO-GO** | 3 CRITICAL — C1 evaluator still public, C2 identity still a string, **C3 introduced by me while fixing C1/C2** |
| D | `5dd28eb0` / `ef8e64da` | `review-gate-codex-handoff-20260902.md` @ `ef8e64da` | **NO-GO** | 2 CRITICAL — evaluator reachable at a package subpath (no `exports` map); principal forgeable by every consumer |
| E | `76203f01` | `review-gate-codex-handoff-20260902.md` @ `76203f01` | **NO-GO** | 1 CRITICAL — `TESTED` and remediation were caller assertions, never recorded evidence; 2 MODERATE on vacuous tests |
| F | `05162ac1` / `0c220758` | `REVIEW_GATE_HANDOFF_05162ac1_20260902.md` | **NO-GO** | 3 CRITICAL — evidence was persisted but not provenanced; rejection was scoped to one record so a new candidateId laundered it; a successor needed only different paperwork |
| G | `ac9fb611` / `d83a03e5` | `REVIEW_GATE_HANDOFF_ac9fb611_20260902.md` | **NO-GO** | 2 CRITICAL — the rejection ledger was three non-atomic operations, so identical content could be approved and rejected concurrently; a test-plan label counted as work, so `tp-1 → tp-2` laundered a defective artifact. 1 MAJOR — a stranger could self-enrol as a participant and supersede |
| H | `0890f6e0` / `75f098e8` | `REVIEW_GATE_HANDOFF_0890f6e0_20260902.md` | **NO-GO** | 1 CRITICAL — `READY_FOR_OWNER_DECISION` is terminal, so a later rejection of identical content could not revoke it; atomicity could not fix an ordering-independent defect. 3 MAJOR — findings were discarded so remediation was unprovable; `requestedReviewerClass` was never enforced |
| I | `0ce56c85` / `c5b66c5f` | `REVIEW_GATE_HANDOFF_0ce56c85_20260902.md` | **NO-GO** | 2 CRITICAL — the package published `InMemoryReviewGateStore`, whose `create` took a caller-built state, so a record could be written straight into `READY_FOR_OWNER_DECISION`; findings could be laundered by a second, milder rejection |
| J | `d7341739` / `1afc9c5b` | `REVIEW_GATE_HANDOFF_d7341739_20260902.md` | **NO-GO** | 2 CRITICAL — `private readonly store` is erased, so `(service as any).store` handed back the live store; `resolves` was an unordered tombstone that could pre-authorise deleting a finding not yet raised. **Plus a design judgement: the defect rate was not converging** |
| K | `8e7ad8ba` / `aedd4f1e` | `REVIEW_GATE_HANDOFF_8e7ad8ba_20260902.md` | **NO-GO** | 2 CRITICAL — the service hands its write capability to the caller-supplied store, so a wrapper captures it; successor inheritance is a non-atomic snapshot. **And the design judgement: same shape, stop patching** |

### Executor wiring — a separate lineage on top of the GO'd gate

| # | candidate | handoff document | verdict | findings |
| --- | --- | --- | --- | --- |
| W1 | `8d675d99` / wiring at `12049b9b` | `REVIEW_GATE_HANDOFF_8d675d99_20260902.md` | **NO-GO** | 2 CRITICAL — enforcement was an optional argument to `executeTask` defaulting to advisory, so any caller omitting it bypassed the gate on an ENFORCING host; and the executor digested the TASK payload while the gate binds the SUB-payload, so an activated executor would have refused every privileged task. 2 MAJOR — `state` and `history` could contradict each other and only `state` was read; a plaintext `http://` gate URL counted as usable configuration |
| W2 | `0e49e9f1` | `REVIEW_GATE_HANDOFF_0e49e9f1_20260902.md` | **not yet reviewed** | — |

This lineage is remediation of the gate's own central weakness — that nothing consulted it — which by
policy makes it the highest-risk code in the workstream and deserves *more* suspicion than the thing it
fixes. Round 1 bore that out: three findings from the reviewer, and a fourth I found myself that the
reviewer had not reached, which was the most consequential of the four.

**The round-1 lesson, recorded because it is the eleventh instance of one pattern.** Both criticals
survived a green suite for the same reason: every test drove a HELPER with arguments the test chose, so
the tests agreed with my *description* of the wiring rather than measuring the wiring. The unit fixture
even encoded the defect's own shape — `reviewAuthorization` at the top of the task payload — so the
mistake was asserted as correct. W2 adds `executorEffectPoint.test.ts`, which calls `executeTask` itself
with nothing about enforcement passed in.

Still known and unfixed, flagged rather than described around: a *deleted* enforcement record reads as
`DISABLED`, so root on a host defeats activation.

Retrieve any superseded handoff with:

```
git show <commit>:control-center/docs/review-gate-codex-handoff-20260902.md
```

---

## What each round actually cost

Recorded because the pattern matters more than any single finding.

| round | the claim I made | what was true |
| --- | --- | --- |
| A→C | "trust is not input" | every authoritative fact *was* input |
| C→D | the evaluator is "internal" | a comment; `export *` published it |
| D→E | the evaluator is "genuinely unreachable" | no `exports` map; a subpath resolved it |
| D→E | a private constructor secures identity | the minting function was publicly exported |
| E→F | evidence "must match a recorded result" | no recorded result existed anywhere |
| F→G | a rejected digest "can never reach GO" | rejection was scoped to one record; a new `candidateId` bypassed it |
| F→G | a successor "must differ from what it replaces" | it compared paperwork, so a re-run of the same code qualified |
| G→H | rejected content "is refused at registration" | the check, the commit and the ledger write were three operations, so a concurrent GO slipped between them |
| G→H | `contentDigest` covers "the work" | it counted `testPlanVersion`, so editing a label was a remediation — **and my own test asserted this was correct** |
| H→I | C6-1 is "closed" by the widened CAS | the defect was not an ordering problem, so ordering could not fix it; a terminal decision cannot be revoked by a later fact |
| H→I | `requestedReviewerClass` records the reviewer requirement | it was parsed and never consulted; anyone unconflicted could approve |
| I→J | callers cannot supply authoritative state | the package exported the store that writes it, `create` and all |
| I→J | an earlier finding was "either fixed, or raised again" | nothing enforced either branch; a milder second rejection erased a CRITICAL |
| J→K | the store is "off the public surface" | true of the module namespace; the live object was reachable through the exported service |
| J→K | `resolves` is a discharge by a reviewer | it was an order-independent tombstone that could be laid before the finding existed |

**Eight rounds, thirteen claims, each stronger than the mechanism behind it.** Eleven were caught by the
reviewer; two I found myself, one by mutation-checking my own test and one because an assertion written to
be falsifiable actually failed.

**Round 8 turned one of these into a named pattern rather than a list of incidents.** Three separate
times I have built a mediating layer, described it as the boundary, and left the primitive it mediates on
the public surface:

| round | the mediator I built | the primitive I left published |
| --- | --- | --- |
| 3 | `ReviewGateService` | `evaluateTransition` |
| 5 | `TrustedPrincipal` | `principalFromSession` |
| 8 | the service's store contract | `InMemoryReviewGateStore` |
| 9 | `#private` fields and a capability | the capability's own `private constructor` — erased, so anyone could build one |
| 10 | a capability only the module can construct | the service **passes it to the caller-supplied store** |

Before accepting any boundary claim of mine, check what the package actually hands out. The fourth
instance happened **inside the fix for the third**, and my own test caught it — the first time in nine
rounds the suite found something before the reviewer did.

---

## The design judgement, round 9

I asked the reviewer, separately from the verdict, whether the defect rate was converging or whether the
design itself was the problem. The answer is worth quoting, because it reframes everything above:

> "The system repeatedly treats TypeScript visibility, export selection, interfaces, and comments as
> security-capability boundaries. They are packaging and maintainability mechanisms, not robust runtime
> authority boundaries. Continuing to patch the current object graph is likely to produce more variations
> of the same defect."

Candidate K implements that advice rather than patching again: ECMAScript `#private` fields, a
capability object that cannot be constructed outside its module, causal ordering on finding discharge, and
a boundary test that inspects a live service instance instead of a module namespace.

**Two of the five recommendations are not done** — a separately deployed persistence boundary, and
occurrence-scoped rather than id-scoped findings — and they are declared as open in the candidate K
handoff. A third, "define whether application code holding the service is trusted", is an owner decision
and is now the second item on the owner-authority list.

**Three times now a test of mine has certified a hole** rather than caught it — round 4's boundary test
that could not fail, round 6's assertion that a test-plan label constituted work, and round 7's
concurrency test that omitted the one ordering that mattered. A green suite here is evidence that the
assertions I wrote hold, and nothing more.

**And in round 7 I declared a CRITICAL closed and it was not.** I had widened the compare-and-set contract
and reported C6-1 as fixed; the defect was not an ordering problem, so ordering could not touch it. When a
handoff of mine says a finding is closed, that is a claim to re-derive like any other.

**And in round 6 I told the reviewer that the rejection ledger's atomicity was where I would look first.
It was broken.** Naming a weakness is not fixing it, and my ranking of where the risk lies has not
predicted where the defects were. Treat the "where this is weakest" section of any handoff of mine as a
starting point, not a map.

The shape is consistent enough to state as a rule: **I attach a guarantee to the wrong object, then
describe it as though it were attached to the right one.** Round 5 is the cleanest example — rejection was
attached to a database record rather than to the work, and disproving the claim took nothing more than a
different primary key. A reviewer of any future candidate should assume the same failure mode is present
and test the mechanism rather than read the description.

---

## Standing constraints on this workstream

- Production deployment is **frozen**. Production mutations across all eleven candidates: **0**.
- `main` is protected and PR-gated. No pull request has been opened for this branch.
- Not authorised without separate owner instruction: flipping the agent-v2 flag, publishing an agent
  release, creating signing keys, exposing public ports, mutating production data, changing DNS.
- The branch `feat/review-gate-20260902` is pushed. Nothing is merged and nothing is wired into a
  running route.

**Owner action: TWO ITEMS**, both in §I of the current candidate handoff — (1) test provenance needs key
material for an attestation scheme; (2) whether application code holding the service is trusted, which
decides if authoritative mutation needs a separately deployed boundary. Every other item in this
workstream proceeds without owner involvement.
