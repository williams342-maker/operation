# Review gate — candidate lineage index

**Objective:** build the mandatory review gate described in the OpsWorkbench Forge handoff, such that a
release candidate cannot reach owner decision without an independent reviewer's verdict against a
specific, immutable candidate identity.

**Current disposition:** ENGINEERING IN PROGRESS — REVIEW READY. Candidate G, awaiting round-6 review.

**Owner action: ONE ITEM OPEN** — see §I of the candidate G handoff. Full test provenance needs key
material for an attestation scheme, which is outside my standing authority. Everything else in this
workstream continues without owner involvement.

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
| G | `ac9fb611` + this commit | `REVIEW_GATE_HANDOFF_ac9fb611_20260902.md` | *pending round 6* | — |

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

**Five rounds, seven claims, each stronger than the mechanism behind it.** Five were caught by the
reviewer; two I found myself, one by mutation-checking my own test and one because an assertion written to
be falsifiable actually failed.

The shape is consistent enough to state as a rule: **I attach a guarantee to the wrong object, then
describe it as though it were attached to the right one.** Round 5 is the cleanest example — rejection was
attached to a database record rather than to the work, and disproving the claim took nothing more than a
different primary key. A reviewer of any future candidate should assume the same failure mode is present
and test the mechanism rather than read the description.

---

## Standing constraints on this workstream

- Production deployment is **frozen**. Production mutations across all six candidates: **0**.
- `main` is protected and PR-gated. No pull request has been opened for this branch.
- Not authorised without separate owner instruction: flipping the agent-v2 flag, publishing an agent
  release, creating signing keys, exposing public ports, mutating production data, changing DNS.
- The branch `feat/review-gate-20260902` is pushed. Nothing is merged and nothing is wired into a
  running route.

**Owner action: None.**
