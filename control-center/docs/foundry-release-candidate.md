# Foundry release candidate — September 15, 2026

Owner request: restore Foundry as the product-building workspace inside OpsWorkbench, through an independently reviewed candidate. This supersedes the earlier W8 decision to archive this integration. It does not authorize deployment, publishing, provider activation, billing, or Forge changes.

## Baseline and integration

- Remote: `https://github.com/williams342-maker/operation.git`.
- Main baseline: `793e4fb48dd66ae12868ee221f1b4d5b6f9e5738`, tree `74d674a616829b388572115cba857fcc438ab8b0`.
- Preserved Foundry: `integration/foundry-consolidated`, commit `470983211a2e160b4c6bf8f3a0b5d5a1ce243b95`, tree `60466be55eb1e800d2fe9b0dacf27e3493c4d8b0`; archived PR #22.
- Shared base: `3ddfe28a624a3156532976b67fbc0a02ed9dee3d`. Main had 403 unique commits and Foundry four. Merge preserves both histories and retains current execution/billing classification checks.
- The supplied Windows checkout was absent. Work uses an isolated recovery checkout; no owner checkout or main branch was edited. No repository AGENTS.md was present in the inspected tree.
- Public production health reported `0.1.15-operate`, commit `512d587e96a8d5dc4287de041c8dd02aa694f34b`, runtime digest `6478d95f17ebc548c860ee99b37959400ef30b115bf726ed0daff40ba41300db`. Its fetched `/assets/index-FipjOHk_.js` was 564089 bytes, SHA-256 `26f0d579faed9cecfffb0b7210c81d79906e45f0fc88db9a9592c03d700d39b9`, with no `/foundry` or `Foundry` markers. This is public-edge evidence; it does not attest host contents or hidden feature flags.

## Functional and security matrix

| Surface | Behavior and controls | Verification |
|---|---|---|
| `/foundry` | Public landing, truthful template capabilities, saved projects for signed-in users | Browser desktop/mobile and axe |
| `/foundry/new` | Prompt capture, validation, tab draft recovery, explicit create, stable retry key | UI and mounted API tests |
| `/foundry/projects`, `/foundry/projects/:id` | Organization-scoped list/read, route state reset, persisted brief and preview | API negative cases and browser navigation |
| Creation | Scoped deterministic ID, request fingerprint, atomic insert, duplicate replay or conflict | Concurrent retry and audit-failure tests |
| Preparation | Template-only generation; preserves saved content/theme; records preparation rather than human approval | API and UI tests |
| Brief/edit APIs | `If-Match` revision required; dirty draft keeps original revision; generated content updated atomically | Stale sequential edit tests |
| Preview | Escaped static HTML, restrictive CSP, sandbox without capabilities, in-document links | Generator tests and rendered browser checks |
| Suggestions | Version-bound deterministic suggestions; append-only accepted/rejected decisions; stale/rejected replay refused | API decision tests |
| Approval | Explicit human action bound to project version and exact artifact digest; atomic history; later editing denied | API bypass/stale/digest tests and browser reload |
| Credits/providers | Upcoming; no mounted credit API or credit-account startup migration; deterministic provider only | Source inspection, provider tests, empty ledger assertion |
| Publishing | Disabled; no agent task, deployment, or provider request from tested flows | API task-count assertion and browser request checks |

## API and data changes

Existing `/api/website-builder/workflows` endpoints remain organization-scoped behind session, CSRF and `ai:use` authorization. Both create endpoints require a UUID `Idempotency-Key`. All existing project mutation endpoints require `If-Match: <project version>`. Final `approve-preview` also requires `artifactSha256` in its JSON body. Existing guided UI callers supply the new preconditions.

Added `POST .../:id/prepare-preview` and `POST .../:id/suggestions`. Creation adds optional `requestHash` and an embedded history event. Suggestion decisions and approval evidence include actor, revision and timestamp; preview approvals include the digest. These changes are additive. Existing legacy workflows remain readable; unsupported and paused states do not auto-advance. There is no destructive migration. Archived credit collection types remain for source compatibility, but credit routes and initialization are inactive.

The provider is a deterministic template planner, not live AI. Preparation never calls human-approval endpoints. An audit-delivery error can return failure after an atomic project write; retrying creation with the same key recovers the one saved project, and its embedded creation evidence remains present.

## Reproduce checks

From `control-center`:

```sh
npm ci
npm run build --workspace @control-center/shared
npm run typecheck
CONTROL_CENTER_RUN_DB_TESTS=true MONGO_URL_TEST=mongodb://127.0.0.1:27189/control_center_test_foundry npm test
npm run build --workspace @control-center/web
CONTROL_CENTER_RUN_DB_TESTS=true MONGO_URL_TEST=mongodb://127.0.0.1:27189/control_center_test_foundry node --import tsx scripts/foundry-local-preview.ts
node scripts/foundry-browser-check.mjs
```

Use a disposable MongoDB and the existing test URL guard; the local preview harness additionally requires loopback. It generates a unique test database and binds HTTP only to `127.0.0.1:4179`. The documented login is deliberately disposable and exists only in that test database. Stop the harness with Ctrl+C to remove its database. Browser defaults to installed Edge; set `FOUNDRY_BROWSER_CHANNEL` for another installed Chromium channel and `FOUNDRY_EVIDENCE_DIR` for screenshots/results. No production fixture or credential is needed.

Run the final full suite on a committed, clean, unchanged tree. Record full commit/tree and status before and after, plus platform-specific skips. Run Linux tests on the same source when Windows cannot exercise POSIX behavior. Final evidence and independent GO must name the exact candidate, not merely this document.

## Limitations and rollback

- Preview is one static document. Planned extra pages, connected forms, catalog/checkout, live AI, credits and provider orchestration are Upcoming.
- Archive/deletion, per-project undo and a dedicated Foundry export UI are explicitly Upcoming. The legacy authorized static-artifact download remains available in the guided builder.
- Automated axe scans inspect the parent application; the script-disabled preview is checked separately for rendering, semantic headings, navigation and isolation. Passing these checks is not a full WCAG certification.
- No production deployment or publishing occurred. Candidate approval grants no deployment authority.
- To abandon this candidate, retain the baseline branch unchanged. If later merged, use a reviewed revert of the integration merge (first parent) or the actual squash commit, according to the chosen merge method. For a separately authorized rollout, deploy the API and web together because writes now require revision headers. Revert both together; retain additive stored project fields/history. Do not delete production data or run credit migrations as rollback.
