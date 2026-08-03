# Website Builder — extraction audit

**Decision:** the AI Website Builder (and its companion SEO Optimizer) is treated as a **future
standalone product**, not an OpsWorkbench operations-cockpit surface. Its code and functionality are
**preserved as-is**; it is removed from the OpsWorkbench UI-polish scope (no cockpit restyling, dropped
from the polish screenshot set). This audit documents what a clean extraction requires.

Scope of the builder in-repo (all under `control-center/`):
- Backend: `apps/api/src/websiteBuilder.ts`, `websiteBuilderRoutes.ts`, `seoAudit.ts`, `seoAuditRoutes.ts`, `urlDiscovery.ts`
- Frontend: the `WebsiteBuilder` component + `SEO Optimizer` page + `ai-builder`/`seo` nav entries + Overview entry card in `apps/web/src/main.tsx`; API calls in `apps/web/src/api.ts`
- Tests: `apps/api/test/websiteBuilder.test.ts`, `urlDiscovery.test.ts` (+ SEO)

## 1. Dependencies
- **Runtime, third-party:** essentially none. `websiteBuilder.ts` imports only `node:crypto` — generation
  is **deterministic** (no AI provider, no network, no `puppeteer`/`cheerio`/`sharp`). `seoAudit.ts`
  analyzes HTML with plain regex (`analyzeSeoHtml`). The only network egress is the SEO crawler fetching
  **public** URLs via `urlDiscovery.ts`.
- **No shared-package coupling:** `websiteBuilder.ts` and `websiteBuilderRoutes.ts` do **not** import
  `@control-center/shared`. The generator core is self-contained. (Route files use `express` + `zod` +
  local `audit`/`db`/`auth` helpers — see §3.)
- **OpsWorkbench-internal coupling (must be replaced on extraction):** `audit.ts` (audit log), `db.ts`
  (`collections`), `auth.ts` (`requirePermission`, session/CSRF), and `req.orgId`/`req.user` set by the
  OpsWorkbench auth middleware. Small, well-defined seams.
- **NOT coupled:** the agent/task runner, signed tasks, deployment-secret sealing, agent-v2, Cloudflare
  integration, enrollment — the builder touches none of it.

## 2. Data ownership
- **Builder-owned collections:** `website_build_workflows` (`WebsiteBuildWorkflowDoc`) and `seo_audits`
  (`SeoAuditDoc`). These move with the product.
- **Shared/foreign fields inside those docs:** `orgId` (multi-tenant scoping), `createdByUserId` /
  `approvals[].decidedBy` (user identity), and SEO's **optional** `projectId` / `serverId`.
- **Reads into OpsWorkbench-owned data:** `seoAuditRoutes.ts` reads `collections.projects` and
  `collections.servers` to associate an audit with a managed project/server. This is the **only**
  cross-domain read; make it optional/standalone on extraction (audits already accept a bare URL).
- **Recommendation:** on extraction, re-root `orgId`/`userId` to the standalone product's own
  tenant/identity model and drop the `projects`/`servers` association (or reimplement as the product's
  own "site" entity).

## 3. Authentication & authorization
- **Fully coupled to OpsWorkbench today.** All routes are `requirePermission("ai:use")` and are mounted
  under the main API `router`, which applies `requireSession` + `requireCsrf` + org-scoping. Identity
  comes from the OpsWorkbench session (hashed-token cookie) and RBAC role→permission map.
- **Extraction seam:** replace the `requireSession`/`requireCsrf`/`requirePermission("ai:use")` middleware
  with the standalone product's own auth (its own sessions + a single "can build" capability, or a
  simple single-tenant owner login). The route handlers themselves only use `req.orgId` + `req.user._id`
  — swap the middleware and provide those two values from the new auth.

## 4. Deployment APIs
- **None.** The builder does **not** deploy anything. "Production publishing remains disabled"; it
  produces an **isolated preview** (iframe `srcDoc`) and a **static-site artifact** validated in-process
  (`buildStaticSiteArtifact` + `buildValidation`). It never invokes the OpsWorkbench agent/task/signed-task
  system, and it holds no deployment credentials.
- **For the standalone product:** publishing (to hosting/CDN/DNS) is **net-new** work — it does not exist
  yet and is out of the current code. The extraction inherits a *preview-and-download-only* product.

## 5. Storage
- **Generated site artifact is stored INLINE in Mongo** (`WebsiteBuildWorkflowDoc.artifact.html` +
  `sha256`, `bytes`, `filename`, `mimeType`), served by `GET /website-builder/workflows/:id/artifact`
  with `X-Content-Type-Options: nosniff` and a SHA-256 header. No object store, filesystem, or CDN.
- **SEO results** stored in `seo_audits` (per-page findings + crawl metadata).
- **Extraction consideration:** inline-HTML-in-Mongo is fine at preview scale but should move to object
  storage (S3/R2) if the standalone product grows large artifacts or many versions. The 1 MB API body
  cap and Mongo document limits bound current artifacts.

## 6. Domains
- **None today.** No custom domains, DNS, TLS, or hosting — preview is a sandboxed iframe; download is an
  attachment. A standalone product would need to add domain management + hosting (net-new).

## 7. Minimum standalone product shell
To run the builder independently, the minimum is:
1. **API service** — Express app exposing the `website-builder/*` and `seo/*` routes, keeping
   `websiteBuilder.ts` (generator, unchanged), `seoAudit.ts`/`urlDiscovery.ts`, and thin route files.
2. **Datastore** — MongoDB with the two collections (`website_build_workflows`, `seo_audits`) + their
   existing indexes; no other OpsWorkbench collections required once the `projects`/`servers` association
   is dropped.
3. **Own auth** — a standalone session + a single "build" capability (multi-tenant `orgId` optional; can
   start single-tenant). Provide `orgId`/`userId` to handlers via new middleware.
4. **Frontend** — extract the `WebsiteBuilder` React flow + `SEO Optimizer` page and their `api.ts` calls
   into a standalone Vite app; the builder keeps **its own visual language** (it is intentionally *not*
   restyled to the OpsWorkbench cockpit).
5. **Artifact serving** — the existing inline-HTML route (optionally upgraded to object storage).
6. **Not needed:** agent/task runner, signed tasks, deployment-secret sealing, agent-v2, Cloudflare,
   enrollment, the OpsWorkbench RBAC map.

**Effort shape:** the generator/SEO **core is already isolated and dependency-light** — the real work is
(a) swapping the auth/identity seam, (b) removing the `projects`/`servers` reads, (c) standing up a small
standalone frontend, and (d) net-new publishing/domains if the product is to actually host sites. No
OpsWorkbench security-critical subsystems are entangled.

## In OpsWorkbench (this pass)
- The builder stays present and functional (preserved), but is **out of UI-polish scope**: not restyled
  to cockpit tokens, and **removed from the polish screenshot set** (`ai-builder` dropped from the
  authenticated-e2e capture list). Its Overview entry will be reduced to a restrained cockpit link (not a
  gradient marketing card) in the Overview de-marketing increment, while the builder's own pages retain
  their standalone visual language.
