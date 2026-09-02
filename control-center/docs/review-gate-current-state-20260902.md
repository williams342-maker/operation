# Review gate — Workstream A current-state map

> ## RETRACTED IN PART, 2026-09-02, after independent review
>
> **B1 and B4 below are FALSE.** Codex reviewed the candidate this document justifies and falsified its
> headline finding. Verified against base `07244a83`: **every approval route already enforces
> approver/author separation**, and a test for it already exists.
>
> | route | check present at base |
> | --- | --- |
> | `configurationRoutes.ts:123` | `assertApproverSeparation(plan.createdByUserId.toHexString(), ...)` |
> | `agentUpgradeRoutes.ts:28` | `createdByUserId.equals(approver)` -> "cannot approve the same plan" |
> | `agentUpgradeRoutes.ts:68` | `createdByUserId.equals(actorId(req))` -> "cannot approve the same plan" |
> | `agentUpgradeRoutes.ts:83` | `createdByUserId.equals(actorId(req))` -> "cannot approve the same rollout" |
>
> ```ts
> // apps/api/src/configurationDeployment.ts:23
> export function assertApproverSeparation(createdBy: string, approvedBy: string) {
>   if (createdBy === approvedBy) throw new Error("Deployment creator cannot approve the same plan");
> }
> // apps/api/test/configurationDeployment.test.ts:13
> test("approver separation is mandatory", ...)
> ```
>
> **How the error was made.** I searched for `createdByUserId.*approvedByUserId`, `!== createdByUserId`
> and `selfApprov`. The real checks use different parameter names (`createdBy`, `approvedBy`) and
> `.equals()`. I searched for the shape I expected the check to have, found nothing, and reported the
> absence of a pattern as the absence of a behaviour. Three times today the same mistake produced a wrong
> conclusion; this is the one that reached a document.
>
> **What survives.** B2 and B3 are still accurate as *role* observations — no role is restricted to
> approving without also being able to author — but they are NOT evidence of self-approval, because the
> per-route identity checks catch it regardless of role. B5 stands: there is still no reviewer concept,
> no verdict, no findings, no remediation lineage.
>
> **What this changes about the work.** The gate is not closing an open self-approval hole, because there
> isn't one. Its justification is narrower and should be stated as such: it adds candidate identity,
> review lifecycle, and findings/remediation, which genuinely do not exist. Sections 3 and 4 below are
> left unedited as the original record; read them through this retraction.


**Date:** 2026-09-02
**Scope:** OpsWorkbench control-center (`control-center/`) at `main` `07244a83`
**Method:** read-only inspection of tracked source. No behaviour changed.
**Purpose:** §A of the mandatory-review-gate handoff — establish what exists, and specifically
*every path that can mark a candidate ready, approved, or deployable*, before building anything.

---

## 1. Headline  *(CORRECTED — see the retraction above)*

**There is no review workflow to extend. There are two approval workflows, and BOTH enforce
approver/author separation already.**

The original text of this line claimed neither enforced independence. That was wrong: every approval
route calls a separation check, and one of them is already unit-tested. What is genuinely absent is a
*reviewer* concept — verdicts, findings, remediation lineage — not a self-approval guard.

The handoff asks whether smoke-test success can substitute for independent review. In this codebase the
question does not arise in that form: **there is no smoke-test concept in the API at all** — no `smoke`,
no `testsPassed`, no test-result gate anywhere in `apps/api/src`. Nothing advances on a test result
because nothing reads one.

What exists instead is *human* approval on two subsystems, each already refusing an approver who is
the author. See the retraction for the four routes and the existing test.

---

## 2. What already exists and is worth building on

Two durable approval state machines, both in `apps/api/src/models.ts`, both already carrying the
ingredients the handoff's `ReviewCandidate` needs:

```
ConfigurationDeploymentPlanDoc
    state: pending_approval | approved | queued | running | succeeded | failed | rolled_back | cancelled
    expectedConfigurationDigest, changeDigest, approvalExpiresAt
    createdByUserId, approvedByUserId, approvedAt

AgentUpgradePlanDoc
    state: awaiting_approval | queued | upgrading | validating | complete | failed | rolled_back
           | cancelled | expired
    planDigest, expectedServerUpdatedAt
    createdByUserId, approvedByUserId, approvedAt

AgentRolloutDoc
    state: awaiting_approval | running | paused | cancelled | complete | failed
    rolloutDigest, perServerPlanDigests, failureThreshold, expiresAt
    createdByUserId, approvedByUserId, approvedAt
```

These are genuinely useful: content digests are already bound, approver identity is already recorded,
approvals already expire, and the transitions already use compare-and-set (`updateOne` filtered on the
current state, with `if (!updated.modifiedCount) → 409`). Workstream C should extend this pattern rather
than introduce a parallel lifecycle.

---

## 3. BYPASS INVENTORY

### B1 — Nothing compares the approver to the author *(no self-approval prevention)*

`approvedByUserId` is recorded but never checked against `createdByUserId`. In the plan-approval path the
same value is used for both:

```ts
// apps/api/src/agentUpgradeRoutes.ts:70
createTask({ ..., createdByUserId: actorId(req) })
collections.agentUpgradePlans.updateOne(
  { _id: plan._id, state: "awaiting_approval", planDigest: body.planDigest },
  { $set: { state: "queued", approvedByUserId: actorId(req), ... } })
```

A search across all of `apps/` and `packages/` for any comparison of those two fields returns nothing.
**An author can approve their own work, everywhere, today.**

### B2 — The separation of duties that exists is nominal, not effective

Configuration deployment does split the permissions, which looks like separation of duties:

| route | permission |
| --- | --- |
| `POST /configuration/deployment-plans` | `configuration:deploy-non-production` |
| `POST /configuration/deployment-plans/:id/approve` | `configuration:approve-non-production` |

But no role separates them. From `packages/shared/src/rbac.ts`:

| role | deploy | approve | agent:update |
| --- | --- | --- | --- |
| Owner | yes | yes | yes |
| Administrator | yes | yes | yes |
| Developer | no | no | no |
| Viewer | no | no | no |

Both permissions are held by exactly the same two roles, and the other two roles hold neither. **There is
no role that can deploy but not approve, or approve but not deploy**, so the split cannot separate anyone
from anything. It is a distinction with no assignment behind it.

### B3 — Agent upgrades do not even split the permission

`POST /agent-upgrades/plans` and `POST /agent-upgrades/plans/:id/approve` both require `agent:update`.
Same for `/rollouts` and `/rollouts/:id/approve`. The subsystem that moves agent binaries onto servers has
strictly weaker separation than the one that deploys configuration.

### B4 — No test asserts any of this

A search of every test directory for a self-approval, same-user, or cannot-approve assertion returns
nothing. Workstream H items 6 and 7 have no existing coverage to build on, and B1–B3 could regress
silently today.

### B5 — There is no reviewer concept at all

No `verdict`, no `reviewer` identity distinct from an approver, no finding record, no remediation
linkage, and no state between "created" and "approved". `NO_GO`, `REMEDIATION_REQUIRED` and
`READY_FOR_OWNER_DECISION` have no equivalents. The handoff's state machine is not a refinement of what
exists — it is new.

---

## 4. What this means for the build

1. **Workstream C is additive, not a rewrite.** The compare-and-set + digest + expiry pattern in the
   existing plan documents is sound and should carry the new states.
2. **B1 is the cheapest high-value fix and belongs first.** Rejecting `approvedByUserId ===
   createdByUserId` is a small guard that closes self-approval on three document types at once, and it is
   testable without any new infrastructure.
3. **B2 is a policy question, not only a code one.** Adding an independence check in code is necessary but
   not sufficient while one human holds both permissions; the role table needs a reviewer role that can
   approve without being able to author.
4. **The absence of a smoke-test path is good news.** The handoff's central worry — smoke success
   substituting for review — cannot happen here yet, and the work is to keep it that way as tests are
   wired in, rather than to unpick an existing shortcut.

---

## 5. Scope and honesty notes

- This map covers `control-center/` only. The `backend/` service in this repository has its own CI gate
  (`backend-tests`, `backend-lint`) and is not part of the Forge candidate pipeline.
- The parked Forge authority chain (PR #33, `review/forge-chain-20260901`) is a *different* candidate and
  is not covered here. See `forge-chain-PARKED.md`.
- Nothing in this document has been verified by executing the routes. It is a source-level map, derived by
  reading and by AST/grep inspection, and the bypasses are claims about code paths rather than about
  observed behaviour. Workstream H is where they become demonstrated.
- **Production mutations: 0.** Read-only throughout.
