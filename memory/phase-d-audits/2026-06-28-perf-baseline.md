# Performance Audit Baseline — craftersmarket.org

**Captured:** 2026-06-28 · **Build under test:** prod bundle `main.bbc0492a.js` · **Phase:** D (observation only, no code changes)

**Trigger:** Project owner observation that "the loading screen feels sluggish." **Not** a founder-reported issue, not surfaced by the Activation Funnel. Treated strictly as preemptive evidence-gathering per Phase D rules.

---

## 1. Lighthouse — top-line scores

| Metric                    | Desktop      | Mobile        | Target (good)  |
|---------------------------|-------------:|--------------:|---------------:|
| **Performance score**     | **34 / 100** | **25 / 100**  | ≥ 90           |
| Accessibility             | 96           | 96            | ≥ 90           |
| Best Practices            | 81           | 82            | ≥ 90           |
| SEO                       | 100          | 100           | ≥ 90           |

## 2. Core Web Vitals

| Metric                     | Desktop      | Mobile        | Good threshold |
|----------------------------|-------------:|--------------:|---------------:|
| **FCP**  First Contentful  | 1.2 s        | **9.5 s**     | ≤ 1.8 s        |
| **LCP**  Largest Contentful| **10.5 s**   | **59.9 s** ⚠  | ≤ 2.5 s        |
| **TBT**  Total Blocking    | **990 ms**   | **7,610 ms** ⚠| ≤ 200 ms       |
| **CLS**  Cumulative Layout | 0.055 ✓      | 0.015 ✓       | ≤ 0.1          |
| Speed Index                | 4.7 s        | 13.9 s        | ≤ 3.4 s        |
| TTI                        | 11.0 s       | 63.0 s        | ≤ 3.8 s        |
| TTFB (server)              | 340 ms ✓     | 360 ms ✓      | ≤ 800 ms       |

> Backend root document is fast. Everything *after* the HTML is the problem.

## 3. Network waterfall — totals

- **Total payload (mobile):** 53.9 MB
- **Total payload (desktop):** 53.6 MB
- **Resources requested:** ~170 on first paint
- **Distinct origins:** 18

| Host                                   | Bytes (KB) | # |
|----------------------------------------|----------:|--:|
| craftersmarket.org                     | 41,873   | 59 |
| images.unsplash.com                    | 12,304   | 15 |
| static.prod-images.emergentagent.com   |  3,301   |  2 |
| cdn.craftersmarket.org                 |  2,301   | 12 |
| active-project-4.emergent.host (API)   |    917   | 52 |
| unpkg.com                              |    913   |  1 |
| googletagmanager / analytics           |    472   |  6 |

## 4. Top slowest / heaviest resources

| Bytes (KB) | Type   | Resource                                                                |
|-----------:|--------|-------------------------------------------------------------------------|
| **6,453**  | image  | unsplash photo-1503602642458-232111445657 (single Unsplash hero, no `w=`)|
| **3,714**  | script | /static/js/main.bbc0492a.js (the SPA bundle)                            |
| 3,385      | image  | unsplash photo-1764115424737 (still ~3 MB after `crop=entropy`)         |
| 1,713      | image  | static.prod-images.emergentagent.com/jobs/.../726f3147…                 |
| 1,594      | image  | unsplash photo-1689960253768                                            |
| 1,588      | image  | static.prod-images.emergentagent.com/jobs/.../6ad6ba41…                 |
| 1,015      | image  | /seed-images/featured/fe-rusted-steel-prairie-grass.jpg                 |
| 1,008      | image  | /seed-images/shop-iron-and-oak.png                                      |
| 1,000      | image  | /seed-images/featured/fe-industrial-pipe-bookshelf.jpg                  |
| 992        | image  | /seed-images/featured/fe-walnut-epoxy-river-table.jpg                   |
| 983        | image  | /hero-photos/3-3.jpg (loaded **twice**)                                 |
| 971        | image  | /hero-photos/2-0.jpg                                                    |
| 964        | image  | /seed-images/featured/fe-laser-cut-holiday-ornaments.jpg                |
| 247        | script | unpkg `@google/model-viewer@3.5.0` (3-D viewer, 68 % unused on homepage)|
| 176        | script | googletagmanager gtag                                                   |

## 5. JavaScript bundle

- **Single CRA bundle:** `main.bbc0492a.js` — **940 KB gzip / 3.80 MB uncompressed**
- **712 KB (77 %) of that JS is unused on the homepage** per Lighthouse coverage trace.
- No route-based code splitting — admin/maker dashboards, command palette, chat, founder tools, etc. all ship on the homepage.
- Render-blocking on critical path:
  - `static/css/main.dd18cf6c.css` — 29 KB · cost ~806 ms wait
  - `https://assets.emergent.sh/scripts/emergent-main.js` — 6 KB · cost ~787 ms wait (slow third-party origin)
- `cache-control: public, max-age=300, immutable` on the content-hashed JS/CSS — `immutable` + 5-minute TTL is contradictory; browsers re-validate every 5 min instead of caching for a year.

## 6. Images

- **Estimated savings from "Properly size images":** 38,996 KB.
- **Estimated savings from next-gen formats (AVIF/WebP):** 23,624 KB.
- Almost every image on the homepage is served at full resolution with no `srcset`, no `<picture>`, and no AVIF/WebP variant.
- `/hero-photos/3-3.jpg` is fetched **twice** (983 KB × 2 = 1.97 MB wasted).
- Cache TTL on `/seed-images/*` and `/hero-photos/*` is 300 s — far too short; these are static assets.
- Two `static.prod-images.emergentagent.com` images return `cache-control: ttl=0s` (Lighthouse reading) — effectively no-cache.

## 7. API requests on the homepage

- **52 calls to the API** during initial load — almost every endpoint fetched **twice** (React 18 StrictMode dev-time double-effect *and* duplicate consumer effects ship to production too).
- Backend itself is fast — direct curl p50 timings (production → preview-pod backend):

  | Endpoint                                            | p50    | max    |
  |-----------------------------------------------------|-------:|-------:|
  | `/api/products?technique=PLASMA`                    | 149 ms | 316 ms |
  | `/api/products?featured_example=true`               | 132 ms | 181 ms |
  | `/api/makers`                                       | 121 ms | 133 ms |
  | `/api/products?featured=true`                       | 113 ms | 142 ms |
  | `/api/products?category=Wall+Art`                   | 107 ms | 142 ms |
  | `/api/reviews`                                      | 113 ms | 114 ms |
  | `/api/community/showcase/top-week?limit=6`          | 127 ms | 145 ms |
  | `/api/community/showcase/recent?limit=4`            | 118 ms | 123 ms |
  | `/api/blog-trending`                                | 116 ms | 129 ms |
  | `/api/activity?limit=12`                            | 107 ms | 112 ms |
  | `/api/community/maker-of-the-week`                  | 136 ms | 156 ms |
  | `/api/settings`                                     | 112 ms | 119 ms |
  | `/api/site/velocity`                                | 128 ms | 141 ms |
  | `/api/founders/slots`                               | 111 ms | 117 ms |
  | `/api/shop-of-the-week`                             | 104 ms | 106 ms |

  **No single endpoint is slow.** Total wall-clock pain comes from doing **~50 of them in parallel** at page boot.
- ⚠ **Configuration finding:** the production site at `craftersmarket.org` is calling the **preview backend** `active-project-4.emergent.host` for every API call. Lighthouse measured a 2,033 ms TTFB to that origin (cold preview pod). This is a misconfig — `REACT_APP_BACKEND_URL` in the prod deploy is pointing at the preview pod.

## 8. Render-blocking fonts / CSS / scripts

- Google Fonts CSS loaded synchronously: `https://fonts.googleapis.com/css2?family=Anton&Oswald&Inter&JetBrains+Mono&display=swap` — 4 families × 4 weights each. `display=swap` is set ✓.
- `static/css/main.dd18cf6c.css` (29 KB gzip / 173 KB raw) blocks render for ~806 ms.
- `https://assets.emergent.sh/scripts/emergent-main.js` — small (6 KB) but blocks render ~787 ms because of third-party connection cost.
- `model-viewer.min.js` (247 KB) loaded as `<script type="module">` — not strictly render-blocking but parses on main thread and is unused on the homepage.

## 9. Other diagnostics

- **DOM size: 2,351 elements** (target ≤ 1,500). Suggests most pages-worth of components mount on initial render rather than route-splitting.
- **Main-thread work: 26 s on mobile, 5.8 s on desktop.**
- **JS execution: 9.9 s on mobile, 2.2 s on desktop.**
- CLS is healthy (0.015 mobile / 0.055 desktop) — no need to touch layout stability.
- TTFB to root document is healthy (340 ms).

---

## 10. Ranked recommendations

Sorted by **estimated impact**. For each: risk, scope, and whether it would violate the Phase D feature freeze.

| # | Fix                                                                                                  | Est. impact                       | Risk    | Scope         | Phase D?              |
|--:|------------------------------------------------------------------------------------------------------|-----------------------------------|---------|---------------|-----------------------|
| 1 | **Resize the unsplash + seed images** (serve at displayed resolution, add `srcset` / `<picture>`)    | LCP −40 to −50 s on mobile · −9 to −11 s desktop · −35 to −40 MB payload | low     | image pipeline + minor JSX | compatible — image swap, no behavior change |
| 2 | **Serve images as AVIF/WebP** with JPEG fallback                                                     | −20 MB payload · LCP further −20 to −30 % | low | backend image route + minor JSX | compatible |
| 3 | **Fix `REACT_APP_BACKEND_URL` on prod to point at the prod backend** (not `active-project-4`)        | Removes 2 s TTFB on every API call; large TTI/INP win | low | env var change at deploy time | compatible (config, not feature) |
| 4 | **De-dupe the ~50 homepage API calls** — every endpoint is fetched twice. Remove duplicate `useEffect`s / dependency thrash. | TBT −50 % · API cost halved · INP improvement | medium | frontend hooks audit | compatible — bug fix, not new feature |
| 5 | **Route-based code splitting** — lazy-load `/admin/*`, `/maker/*`, `/founders/*`, `/community/forum/*`, `model-viewer` | −500 to −700 KB JS off homepage · TBT −30 to −50 % · TTI big win | medium | webpack/CRA config + `React.lazy` per route | borderline — pure perf, no UX change |
| 6 | **Fix cache headers on `/seed-images/*` and `/hero-photos/*`** to `max-age=31536000, immutable`     | Repeat-visit LCP near-instant     | low     | nginx/CF rule | compatible (infra config) |
| 7 | **Fix cache header on `static/js/main.<hash>.js` + `main.<hash>.css`** to `max-age=31536000` (drop the 300 s) | Repeat-visit JS cost ≈ 0 | low | CF/nginx       | compatible              |
| 8 | **Defer / lazy-load `@google/model-viewer`** — load only on product pages that need it               | −247 KB JS off homepage           | low     | conditional `<script>` in product detail | compatible |
| 9 | **Self-host or `<link rel=preconnect>` + preload `emergent-main.js`** (or move to async)             | −787 ms render block              | low     | index.html    | compatible              |
| 10| **Reduce DOM size** — code-split below-the-fold sections (recent showcase, blog-trending, activity) into `IntersectionObserver`-mounted islands | TBT, JS execution, main-thread time | medium | component refactor | borderline — touches multiple components |
| 11| **Consolidate homepage API calls** behind a single `/api/homepage-snapshot` aggregator              | Network requests 50 → 1; cleaner waterfall | high (new endpoint) | new backend route + frontend refactor | **violates freeze** — new feature surface |
| 12| **Skeleton loaders** in place of full-page spinner                                                   | Perceived perf only               | low     | UI            | borderline — UX change |
| 13| **Performance Dashboard admin tab**                                                                  | Operational visibility            | medium  | new admin tab | **violates freeze** — new admin surface |

### Severity assessment

- The mobile LCP of **59.9 s** and TBT of **7.6 s** are well past "broken UX". Any founder testing the live site on a phone will perceive it as unusable on a moderate connection.
- However: **TTFB and the backend itself are healthy.** The pain is almost entirely in **image weight + bundle size + duplicate API calls** — three classes of waste, not architectural problems.
- Findings #1, #2, #3, #6, #7 are pure **misconfigurations** (image dimensions, wrong env var, wrong cache headers). They have low risk, are reversible, and don't introduce any new product feature. A reasonable Phase D exception case can be made.
- Findings #4 and #5 are **bug + perf hygiene** (duplicate fetches and lack of code-splitting). Medium risk; could be deferred.
- Findings #11 and #13 (snapshot endpoint, new admin dashboard) clearly violate the freeze and should stay in the post-Phase-D backlog regardless.

---

## 11. Files generated by this audit (kept on the pod for reference)

- `/tmp/perf-audit/lh-desktop.json` — full Lighthouse desktop run
- `/tmp/perf-audit/lh-mobile.json`  — full Lighthouse mobile run
- `/tmp/perf-audit/index.html`      — captured prod index.html
- `/tmp/perf-audit/probe.js`        — Playwright probe (network capture + size accounting)

## 12. Recommendation to the project owner

This is evidence, not action. **Trigger reminder:** preemptive owner observation, not a founder-reported activation blocker. By the Phase D bar ("only build when the data shows a clear bottleneck") this does **not** clear the threshold for an exception.

**Recommended path: strict Phase D.** Log this report, defer all 13 items to the Week-4 review.

Rationale:
- The Activation Funnel is the agreed bottleneck-detector. If homepage perf is actually losing founders, the funnel will show it (e.g. `first_login` count stays low despite high `welcome_delivered`, or `stalled / dormant` rows pile up). Right now the only signal is "feels sluggish to the owner."
- Most of the 13 fixes are misconfigurations (image sizes, cache headers, the prod-points-at-preview backend env var). They will still be cheap to fix at Week 4 — they aren't decaying.
- One item is worth surfacing independently of perf, however: **finding #3, the production frontend calling `active-project-4.emergent.host` for every API call.** That's not a perf concern — it's a deployment misconfiguration. If the preview pod ever goes down or gets reaped, the production homepage breaks. Worth flagging to Emergent Support / a redeploy cycle separately, regardless of Phase D.

**Re-evaluation criteria at Week 4:**
- If the funnel shows founders bouncing before `first_login` AND welcome emails are being opened → strong signal that homepage perf is the cause. Promote items #1, #2, #6, #7 (image + cache fixes).
- If founders are completing `first_login` and stalling at later stages → perf is NOT the bottleneck; this audit gets re-shelved.

Either path is defensible. The point of Phase D is to **let the funnel decide**, not the owner's gut feel — even when the owner's gut feel is probably right.
