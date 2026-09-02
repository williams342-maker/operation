# Forge authority chain — PARKED, uncertified. Do not enable.

**Status as of 2026-09-02.** The Forge authority chain is **disabled, uncertified, and parked for human
security review.** Nothing in it is enabled, nothing is deployed, and no part of it should be turned on.

This note exists on `main` because the full record does not. Everything below is a summary; the detailed
account lives on an unmerged branch, and until it is merged this file is the only way to discover any of it
from `main`.

| | |
| --- | --- |
| Full status document | `control-center/docs/forge-chain-status-20260901.md` on branch `review/forge-chain-20260901` |
| Pull request | **#33** (open, not draft, currently `CONFLICTING` against `main` through ordinary drift) |
| Code parked at | `a5137860d3f5ab7b0cd582e3b5eb92f3614b812f` |
| Branch head | `b3902b51` — the status-document commit itself |
| Scope | 30 files |

## Why it is parked

Three independent certification rounds, each returning **NO-GO**. Every round found an authority hole, and
each hole was a **relocation of the previous one** rather than a new mistake:

| Round | The hole |
| --- | --- |
| 1 | The operator supplied `verified: true` in an evidence file, and it was believed. |
| 2 | Real cryptography — but the operator supplied both trust anchors as input **paths**. |
| 3 | Anchors came from `loadConfig()`, whose path is `$CONTROL_CENTER_AGENT_CONFIG` or `process.cwd()`. Both belong to the caller. |

Each fix was locally correct and globally insufficient. **That track record, not any individual defect, is
why work stopped.** The remaining items are known and written down; what is not known is whether a fourth
pass by the same author would introduce a fourth relocation.

**The recommendation is a human security reviewer before any further remediation.** The author of the
candidate cannot certify it, and three rounds of author-side remediation are the evidence for that rather
than an abundance of caution.

## The rule that has to hold

> **Evidence is input. Trust is not.** Every trust anchor and every measured identity must come from a
> fixed, root-owned path — never from the operator-supplied file, never from an environment variable, never
> relative to the working directory, and never through a general-purpose helper that honours any of those.

The recurring failure was never in the cryptography. It was in *where the inputs come from*.

## What has never run

Stated plainly, because a green test suite hides it:

- The container images have **never been built** — no Docker daemon was available.
- The producer has **never executed** — running it means publishing images, which is owner-gated.
- The integrated happy path has **never completed end to end**, in CI or on a host. Every passing
  integration test injects verified evidence through a test seam; only the cryptographic layer has been
  exercised against genuine material.
- **No agent has ever consumed a Forge manifest**, because none exists to consume.

## What is proven

Real, and worth keeping: canonicalization by explicit ordered-field join; Sigstore verification against the
genuine published `v0.1.2-operate` bundle and the real trusted root; `subjectCoversDocument()`, which is the
only thing standing between "signed" and "signed **this**" — `Verifier.verify()` accepted deliberately
corrupted bytes without it; anchored and escaped SAN matching; fixture byte-stability via `.gitattributes`;
and replay markers that release only what the current invocation created.

## Related

`W10 — Independent review of the authority chain` in `handoff-work-order-20260901.md` is the owner-gated
work item this blocks on.

**Do not delete `review/forge-chain-20260901`.** It carries the only copy of the full status document and
the three-round review history.
