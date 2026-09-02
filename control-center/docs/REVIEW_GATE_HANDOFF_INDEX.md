# Review gate — candidate lineage index

**Objective:** build the mandatory review gate described in the OpsWorkbench Forge handoff, such that a
release candidate cannot reach owner decision without an independent reviewer's verdict against a
specific, immutable candidate identity.

**Current disposition:** ENGINEERING COMPLETE / REVIEW READY — candidate F, awaiting round-5 review.

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
| F | `05162ac1` + this commit | `REVIEW_GATE_HANDOFF_05162ac1_20260902.md` | *pending round 5* | — |

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

**Four rounds, five claims, each stronger than the mechanism behind it.** Three were caught by the
reviewer, one by a mutation check I ran on my own test, and one I found while writing the fix for another.
A reviewer of any future candidate should assume the same failure mode is present and test the mechanism
rather than read the description.

---

## Standing constraints on this workstream

- Production deployment is **frozen**. Production mutations across all six candidates: **0**.
- `main` is protected and PR-gated. No pull request has been opened for this branch.
- Not authorised without separate owner instruction: flipping the agent-v2 flag, publishing an agent
  release, creating signing keys, exposing public ports, mutating production data, changing DNS.
- The branch `feat/review-gate-20260902` is pushed. Nothing is merged and nothing is wired into a
  running route.

**Owner action: None.**
