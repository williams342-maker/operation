# Emergent to OpsWorkbench comparison backlog

Last reviewed: 2026-07-26

## Product direction

Emergent's strongest pattern is immediate, plain-language intent capture followed by a visible building experience. OpsWorkbench should adapt that speed while retaining organization scoping, provider allowlists, cost estimates, immutable evidence, explicit approvals, isolated previews, and a separately authorized production release.

## Prioritized findings

| Priority | Finding | Emergent observation | OpsWorkbench position and decision | Security, cost, and acceptance criteria |
| --- | --- | --- | --- | --- |
| P0 complete | Plain-language project intake | A large prompt is the primary entry point and accepts broad goals immediately. | Adapted: a required objective now starts the website workflow; format selection is optional and inferred deterministically before bounded discovery. | Objective is organization-scoped, capped at 4,000 characters, omitted from audit metadata, uses no provider credits, and cannot execute or deploy. API and UI must return the same objective and inferred type. |
| P0 next | Conversational plan refinement | The builder behaves like an ongoing conversation and keeps project context visible. | Improve: add a versioned conversation timeline over the existing discovery answers, approvals, and artifacts; allow revision of earlier answers with downstream invalidation. | Every turn must be org-scoped and attributed. Editing an approved input must invalidate dependent artifacts and require reapproval. No tool execution from chat text. |
| P0 next | Plan summary before generation | Intent moves quickly into construction, with assumptions often implicit. | Improve: show a compact preflight containing objective, inferred scope, assumptions, missing decisions, expected artifacts, credits, tests, and production boundary. | Fail closed on missing required decisions. Acceptance: the plan digest changes when any scoped input changes and approval binds to that digest. |
| P1 | Resume and memory | Recent apps provide a fast path back into prior work. | Adapt: saved workflows already exist; add search, objective excerpts, last decision, next required action, and ownership indicators. | Queries remain org-scoped; sensitive discovery text is not exposed in cross-role lists. Keyboard navigation and clear empty states required. |
| P1 | Build progress and repair | Build activity is visible and failures can be discussed in context. | Improve: map workforce roles, artifact versions, validation checks, and failures into a single progress timeline with a bounded repair proposal. | Repairs are proposals until separately approved. Evidence must identify the failed check and affected artifact; retries require idempotency keys. |
| P1 | Preview feedback loop | Preview is central to the creation loop. | OpsWorkbench has sandboxed desktop/mobile preview. Improve with per-section comments, viewport presets, accessibility findings, and before/after artifact comparison. | Preview remains sandboxed; comments and artifacts are versioned and org-scoped. Approved artifacts cannot be silently replaced. |
| P1 | Onboarding and navigation | The home screen focuses attention on starting or resuming a build. | Adapt: add role-aware first-run guidance and a persistent “next safe action” without hiding operations, audit, or governance surfaces. | No onboarding shortcut may bypass permissions or approval gates. Acceptance includes owner, admin, operator, and viewer journeys. |
| P1 | Integration readiness | Integrations are presented as capabilities available to a project. | Improve: unify configured, authorized, reachable, stale, revoked, and partial states across settings and workflows. | Server-side organization-scoped source of truth; secrets never reach the browser. Execution-time authorization and revoked-token tests required. |
| P1 | Credit transparency | Credits are prominent during AI use. | OpsWorkbench estimates and actual usage exist. Improve with per-step estimates, reserved versus spent credits, provider/model attribution, and history. | Atomic ledger entries, org scope, idempotent charging, hard limits, and no paid call before a displayed estimate where estimation is possible. |
| P2 | Multi-mode creation | Full-stack, mobile, landing-page, and brainstorming modes are quick choices. | Adapt as intent presets that configure bounded workflows, not unrestricted execution modes. | Presets may narrow scope only; they cannot grant new permissions. Each preset needs explicit artifact and completion criteria. |
| P2 | Deployment experience | Publishing is visible as the natural end of a build. | Improve staging handoff and deployment evidence, but intentionally retain a separate production approval. | No production action from the builder. Approval must bind environment, artifact hash, plan digest, actor, expiry, and rollback evidence. |
| P2 | Artifact library | Apps and generated outputs are easy to revisit. | Improve with an org-scoped artifact library for briefs, plans, previews, validation reports, and downloads. | Immutable versions, retention controls, content hashes, safe download headers, role checks, and audit events. |
| P2 | Notifications | Builder feedback is immediate and task oriented. | Add in-app notifications for questions, approvals, failed validation, expiring approvals, stale credentials, and completed staging work. | Deduplicate events, respect role and org boundaries, provide preferences, and never include secrets or full sensitive prompt text. |
| P3 | Help and accessibility | Examples and starter prompts reduce blank-page friction. | Improve with accessible examples, field-level help, focus management, reduced-motion behavior, and WCAG 2.2 AA validation evidence. | Examples must be original and non-proprietary. Automated checks plus keyboard and screen-reader acceptance tests. |

## Implemented increment: objective-first intake

- The create-workflow API accepts a 12–4,000 character objective and an optional explicit format.
- If no format is selected, a deterministic, provider-free classifier recommends business, store, landing page, redesign, or connected-project planning.
- The normalized objective is stored in the organization-scoped workflow and displayed throughout discovery and saved-workflow resumption.
- Audit evidence records only the type, whether it was selected or inferred, and objective length; it does not duplicate the objective text.
- Existing discovery, cost, preview, staging, and production-approval boundaries remain unchanged.

## Validation

- Unit coverage verifies objective normalization and representative type inference.
- API test suite: 101 passed, 0 failed, 2 database-dependent tests skipped by their existing guard.
- Web validation: 19 Vitest checks and 34 component/source checks passed; the production-mode Vite build completed.
- API and web TypeScript checks pass after building the shared package.
- Lint completed with no errors and three pre-existing unused-variable warnings outside this change.
- Production was not modified or deployed.
