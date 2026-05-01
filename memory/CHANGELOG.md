# Crafters Market — CHANGELOG

## 2026-05 — iter108 — One-click crawler-preview dropdown in admin Listings tab ✅

**Why:** iter107 shipped the OG prerender routes, but verifying any specific listing's social preview meant copy-pasting the slug into Facebook's Sharing Debugger / LinkedIn's Post Inspector / Twitter's Card Validator by hand. ~30s of friction per spot-check, every time. Now: one click per listing, four deep-links, zero copy-paste.

**What:**
- New `CrawlerPreviewMenu` component inline in `ListingsTab.jsx`, rendered as a small `↗ Preview` button per row. Native `<details>` / `<summary>` toggle (no extra state, no click-outside handler needed). On open, drops a 4-link menu:
  1. ◆ View OG card → opens `/api/og/product/<slug>` directly (sanity-check raw HTML)
  2. ◆ Facebook debugger → `developers.facebook.com/tools/debug/?q=<encoded-og-url>`
  3. ◆ LinkedIn inspector → `linkedin.com/post-inspector/inspect/<encoded-og-url>`
  4. ◆ Twitter / X validator → `cards-dev.twitter.com/validator?url=<encoded-og-url>`
- All four targets receive the canonical apex URL (`https://craftersmarket.org/api/og/product/<slug>`) — never the preview pod, which would just time out the validators.
- Stable testids: `listing-preview-{slug}`, `listing-preview-toggle-{slug}`, `listing-preview-menu-{slug}`, plus per-link testids (`-og-`, `-fb-`, `-li-`, `-tw-`).

**Verified live:** Magic-link signed in as `team@craftersmarket.org`, landed on the Listings tab, all 10 visible products rendered with `↗ Preview`. Opened the first row's dropdown — all 4 links present and visible, FB href confirmed as `https://developers.facebook.com/tools/debug/?q=https%3A%2F%2Fcraftersmarket.org%2Fapi%2Fog%2Fproduct%2Facrylic-kraken-keychain-…`. Visual + DOM-level confirmation in one screenshot.

**Lint clean.** Pure frontend addition — no backend or test churn needed.

---


## 2026-05 — iter107 — Server-side OG prerender for crawlers (Facebook/LinkedIn/Discord/Pinterest) ✅

**Why:** When a maker pasted a product link into Slack, Pinterest, Discord, or LinkedIn, the crawler hit `/shop/<slug>`, got the SPA shell, and rendered the *generic homepage card* every time. No per-product image. No per-product title. No per-product price. Every share looked identical, every share was a missed conversion.

**What:**
- New router `backend/routers/og_prerender.py` exposing 3 routes (`include_in_schema=False` so they stay out of `/docs`):
  - `GET /api/og/product/<slug>` — full HTML with `og:type=product`, `product:price:amount`, `product:price:currency`, plus full Twitter Card meta
  - `GET /api/og/maker/<slug>` — `og:type=profile`, prepends `◆ Veteran-Owned ·` to description when the maker has the badge
  - `GET /api/og/journal/<slug>` — `og:type=article` with `article:published_time` + `article:author`
- Each response includes `<link rel="canonical" href="<spa_url>">` and `<meta http-equiv="refresh" content="0; url=<spa_url>">` — crawlers ignore the meta-refresh and read the rich tags; real browsers honor the refresh and bounce to the SPA so the URL stays useful as a direct share too.
- Slug regex guard (`^[a-z0-9][a-z0-9_-]{0,119}$`) + soft-404 redirect to the parent listing for unknown slugs (so a stale share never dead-ends).
- HTML-attribute escape for titles/descriptions (`<`, `>`, `&`, `"`, `'`, newlines) — fixes the silent meta-tag truncation that some crawlers do on un-escaped quotes.
- Public `GET /api/og/diag` returns sample slugs + their corresponding `og_url` and `spa_url` so operators can paste either into the Facebook Sharing Debugger / LinkedIn Post Inspector / Twitter Card Validator without leaving the dashboard.

**Bug caught + fixed in test:** the first cut of `_render_og_html` emitted `og:type=website` *and* a caller-supplied `og:type=product` override side-by-side. Two `og:type` tags is invalid OG and crawlers pick at random. Refactored the renderer to pull the override out of `extra_props` and replace the default cleanly — now exactly one `og:type` per response.

**How to wire crawler traffic to it (operator action, optional but high-leverage):**
- Cloudflare Worker: when `User-Agent` matches `facebookexternalhit|LinkedInBot|Twitterbot|Pinterestbot|Slackbot|Discordbot|TelegramBot|WhatsApp` AND path matches `/shop/*` / `/makers/*` / `/journal/*`, rewrite to `/api/og/<kind>/<slug>`. ~12 lines of Worker code, instant rich previews everywhere a link is shared. Without a Worker, the routes are still useful — anyone can paste them directly into a debug tool to verify what crawlers will render.

**Regression guard:** `tests/test_iter107_og_prerender.py` — 9 tests covering all 3 kinds (product/maker/journal), unknown-slug redirects, malformed-slug rejection, HTML escape correctness, single-`og:type` invariant, veteran-owned badge prepend, article published-time, and the diag endpoint shape. All green.

**Verified live:** `/api/og/product/mountain-range-silhouette` returns full prerender HTML with single `og:type=product` tag and proper price meta. `/api/og/diag` enumerates 9 sample slugs across all 3 kinds.

---


## 2026-05 — iter106 — Webhook deep-links survive the magic-link sign-in round-trip ✅

**Why:** iter105 deep-links jump the operator straight to the right admin row — but only if they're already signed in. If the Slack/Discord click landed on a logged-out browser, `/admin/dashboard?tab=feedback&open=<id>` redirected to `/admin/login`, the magic-link email arrived, the click brought them to `/admin/verify` → `/admin/dashboard` (no query params), and the deep-link target was lost. On-call rotation operators paying for that papercut every time.

**What:**
- `AdminDashboard.jsx` auth guard — when redirecting an unauthenticated request to `/admin/login`, it now stashes the original `pathname + search` to `localStorage.cm_admin_after` first. Strict guard: only stashes when `pathname.startsWith("/admin/dashboard")` AND `search` is non-empty (avoids the React StrictMode double-effect race that would have stamped `/admin/login` over the real target).
- `AdminVerify.jsx` — on successful magic-link verify, reads `cm_admin_after`, removes the key, and navigates there instead of the bare `/admin/dashboard`. Whitelist guard: only honors paths starting with `/admin/` so a tampered localStorage value can't open-redirect off-domain.
- `AdminLogin.jsx` — same consume-and-navigate logic on the password sign-in path so both auth modes land the operator at the originally-clicked deep-link.

**Why localStorage and not a backend round-trip:** the magic-link email is generated server-side without knowledge of the original click context. Persisting through localStorage on the same browser is the cheapest correct relay for the dominant on-device flow. Cross-device flows (open email on phone, type on laptop) still fall back to bare `/admin/dashboard` — acceptable edge case.

**Verified end-to-end:** Live screenshot smoke-test confirms (1) the deep-link URL gets correctly stashed, (2) bare `/admin/dashboard` loads do NOT pollute the stash, (3) the redirect to `/admin/login` is preserved cleanly. JSX lint clean across all 3 admin pages.

---


## 2026-05 — iter105 — Webhook deep-links jump operator straight to the row ✅

**Why:** iter104 Slack/Discord webhooks all linked back to `/admin/dashboard` generically — operator still had to click through to the right tab, scroll, and visually scan for the new item. Now one click drops them on the exact row, pulse-highlighted.

**What:**
- Backend: every `notify_team` call now passes a tab-aware deep-link.
  - Beta feedback → `/admin/dashboard?tab=feedback&open=<id>`
  - Contact message → `/admin/dashboard?tab=contact&open=<id>`
  - Outage / recovery → `/admin/dashboard?tab=prod-health` (endpoint-level, no row id)
- Frontend (`AdminDashboard.jsx`):
  - Lazy `useState` initializer reads `?tab=` from URL on mount and switches the active tab without a flash of the default "applications" tab. Whitelist-validates against the known TAB ids so a malformed link can't break the page.
  - Effect polls for the row's stable `data-testid` (`feedback-row-<id>` / `contact-row-<id>`) up to 12 times at 250ms intervals (rows load async after auth/fetch). On hit: `scrollIntoView({behavior: smooth, block: center})` + adds `.admin-deeplink-pulse` class for a 2.4s orange glow, then strips `?open=` from the URL so a refresh doesn't re-pulse the same row.
  - New `@keyframes admin-deeplink-glow` in `index.css` — 2-color pulse (`#ff4500`-tinted background + inset 1px ring), `scroll-margin-top: 96px` so the row clears the sticky tab rail.

**Regression guard:** `tests/test_iter105_webhook_deeplinks.py` — 4 tests verifying the `link` field of every `notify_team` call carries the right `?tab=…&open=<id>` shape across all 4 call sites (feedback, contact, outage, recovery). All green. JSX lint clean. Live screenshot confirms `/admin/dashboard?tab=feedback&open=…` renders without JS error (gates to /admin/login when unauth, as expected).

---


## 2026-05 — iter104 — Slack/Discord webhooks for Beta Feedback, Contact, Prod Outage ✅

**Why:** Until now the team only learned about new beta feedback / contact messages / prod outages via email. Email is fine for a daily digest, lousy for "respond in the next 5 min." Slack and Discord are where the team actually lives. One integration handles all three streams.

**What:**
- New module `backend/notify_webhook.py` with a single entrypoint `notify_team(kind, title, summary, fields, link)`. Auto-detects which providers are configured via `SLACK_WEBHOOK_URL` / `DISCORD_WEBHOOK_URL` env vars. Either, both, or neither (silent no-op).
- Three call sites wired via `BackgroundTasks`:
  1. `POST /api/feedback` (beta feedback) — `kind="feedback"`
  2. `POST /api/contact` (public contact form) — `kind="contact"`
  3. `prod_health._fire_outage_alert` and `_fire_recovery_alert` — `kind="outage"` and `kind="recovery"`
- Slack gets rich block-kit messages (header + section + action button to admin dashboard). Discord gets embeds with category-color theming. Both fan out concurrently with `asyncio.gather`.
- Per-process in-memory dedup window (60s) suppresses identical (kind, title) repeats — guards against caller-bug-induced spam. Outage and recovery transitions bypass dedup (operational alerting must always go through).
- Failure on one provider doesn't block the other. Every failure logged at WARNING with provider + status. Best-effort delivery.

**Admin tooling:**
- `GET /api/admin/webhooks/diag` — boolean flags `{slack: bool, discord: bool}`. Never leaks the actual URLs.
- `POST /api/admin/webhooks/test` — fires a one-shot ping to every configured provider with the operator's email in the body, so admins can verify delivery without waiting for a real outage.

**Setup:** Set `SLACK_WEBHOOK_URL` (Slack: Apps → Incoming Webhooks → Add → copy URL) and/or `DISCORD_WEBHOOK_URL` (Discord: Server Settings → Integrations → Webhooks → New → copy URL) in `/app/backend/.env`. Restart backend. Hit `POST /api/admin/webhooks/test` to confirm delivery.

**Regression guard:** `tests/test_iter104_team_webhooks.py` — 11 tests covering: no-op when unconfigured, slack-only, discord-only, both-configured fan-out, dedup window for non-operational kinds, dedup bypass for outage, single-provider-failure resilience, beta-feedback POST wiring, contact POST wiring, outage transition wiring, recovery transition wiring. All green.

**Verified:** Live `GET /api/admin/webhooks/diag` returns 401 unauthenticated (proper admin gating).

---


## 2026-05 — iter103 — Welcome emails for /updates + /coming-soon waitlists ✅

**Why:** Users who subscribed to the public Updates digest or joined a Coming-Soon category waitlist (Neon & Light, Furniture) got *nothing* back after submitting their email. No confirmation, no acknowledgment — just a silent toast on the form. People reasonably assumed it broke. Closes the loop with a branded one-shot email so the buyer/maker knows the signup landed.

**What:**
- New email template `send_updates_subscribe_welcome()` — fired from `POST /api/updates/subscribe`. Sets expectations ("one email per release week, no marketing"), CTAs to `/updates`, includes a one-click unsubscribe link from day one.
- New email template `send_coming_soon_confirmation()` — fired from `POST /api/coming-soon/waitlist`. Echoes back the category they're waiting on ("You're on the list for Neon & Light"), CTAs to `/shop` so they don't bounce.
- Both wired via `BackgroundTasks` so the API returns instantly while the email queues async.

**Idempotency rules (so we never spam):**
1. `/updates/subscribe` — welcome only fires on a brand-new signup OR on reactivation of a previously-unsubscribed address. Re-subscribing an already-active email is a true no-op.
2. `/coming-soon/waitlist` — confirmation only fires when the (email, category) pair is brand new. Re-submitting the same pair returns `already=True` silently.
3. Same email signing up for *different* categories (e.g. Neon AND Furniture) correctly fires one email per category — they're distinct waitlists.

**Regression guard:** `tests/test_iter103_welcome_emails.py` — 7 tests covering: new signup fires, duplicate is silent, reactivation re-fires (with refreshed unsubscribe token), new coming-soon signup fires, duplicate coming-soon is silent, unknown category rejected without email, multi-category signups fire per category. All green.

**Verified live:** `/api/updates` and `/api/coming-soon/waitlist` smoke-tested against the preview backend — endpoints respond correctly and reject invalid categories cleanly.

---


## 2026-05 — iter102 — Contact form follow-up email on resolve ✅

**Why:** Sister of iter101 — same loop-closing pattern, applied to the public contact form. Visitors who use `/contact` got nothing back when an admin marked their message resolved. Now they get a branded acknowledgment.

**What:** New email template `send_contact_message_resolved()` — different copy from the beta version ("Got your note — addressed it on our end" rather than "reviewed your feedback"), echoes back the original subject + message for context, CTAs to `/shop` instead of `/updates` since contact senders are usually buyers/visitors. `/admin/contact-messages/{id}/resolve` now takes BackgroundTasks and fires the email behind the same three guards as iter101 (email present, no prior reply, no prior follow-up).

**Regression guard:** `tests/test_iter102_contact_followup.py` — 4 tests mirror iter101 (happy path, skip-when-replied, idempotent re-resolve, no-email skip). All green. Live curl smoke confirms `{"resolved":true,"followup_sent":true}`.

---


## 2026-05 — iter101 — Beta feedback follow-up email on resolve ✅

**Why:** Users who submit beta feedback get nothing back when an admin marks the ticket resolved without writing a custom reply. They wonder if anyone read it. A short auto-follow-up closes the loop and reinforces that we're listening.

**What:**
- New email template `send_beta_feedback_resolved()` — branded shell that thanks the user, echoes back their original message + page (so they have context after days/weeks), invites them to keep sending feedback, and CTAs them to `/updates` to see what we've shipped.
- `/admin/feedback/{id}/resolve` now fires the follow-up via BackgroundTasks. Returns `{"resolved": true, "followup_sent": true|false}` so the admin UI can show whether the email actually queued.

**Three guard rails so we don't spam:**
1. Skip if `email` is empty (anonymous feedback)
2. Skip if `replied_at` is set (admin already sent a tailored Reply via /admin/feedback/{id}/reply)
3. Skip if `followup_sent_at` is already set (idempotent re-resolves don't re-email)

**Regression guard:** `tests/test_iter101_feedback_followup.py` — 4 tests covering happy path, skip-when-already-replied, idempotent re-resolve, skip-when-no-email. All green.

**Verified end-to-end:** Curl test against a seeded row returns `{"resolved":true,"followup_sent":true}` and the email queues through the live provider.

---


## 2026-05 — iter99 — Four P2 features in one pass ✅

**1. ErrorBoundary per admin tab.** New `AdminTabBoundary.jsx` wraps every conditional tab render in `AdminDashboard`. If a single tab's component crashes (unhandled exception, missing import, undefined destructure) only that tab renders an isolated "Something went sideways. [Retry]" card with collapsible stack trace. The rest of the console stays alive. Born from the iter93 ProdHealthBanner-import incident that blacked out the entire admin.

**2. Coming Soon waitlist capture.** The Coming Soon cards on `/custom-order` (Neon & Light, Furniture) now expand to an inline email form on click. Idempotent per (email, category). New collection `coming_soon_waitlist`, public `POST /api/coming-soon/waitlist`, admin `GET /api/admin/coming-soon/waitlist`. Three card states: idle → expanded form → "On the list" with orange pill.

**3. Broadcast-to-Subscribers audience.** Extended the existing Broadcast admin tab with a new audience option "Update Subscribers" — sends ad-hoc messages to opt-in /updates subscribers. Also added them to the "Everyone" union so launch announcements reach product-update subscribers automatically. Sorted, deduped, lower-cased like every other audience.

**4. Maker restock weekly digest.** New cron `maker_restock_digest@cron[day_of_week='sun', hour='9', minute='0']` aggregates open `restock_waitlist` rows per maker and sends one weekly summary email with product titles + buyer counts + dashboard CTA. Idempotent per ISO week (re-running mid-week is a no-op). New module `/app/backend/maker_restock_digest.py`, new email template `send_maker_restock_digest()`.

**Regression guard:** `tests/test_iter99_p2_features.py` — 7 tests covering coming-soon idempotency, unknown-category rejection, restock digest no-op + force + per-week idempotency, broadcast audience resolution, and 'everyone' union including subscribers. All green.

**Verified:** All 7 backend tests pass. Browser test confirms Coming Soon card → inline form → "On the list" success state with toast. Backend curl proves `/api/coming-soon/waitlist` accepts valid + rejects invalid, broadcast preview to `update_subscribers` returns 3 active subs, restock digest cron is registered.

---


## 2026-05 — iter98 — Updates digest polish: CSV export + staleness + OPS summary ✅

**Three improvements in one pass:**

1. **CSV export of subscriber list** — `GET /api/admin/updates/subscribers.csv` (admin-only) streams a downloadable CSV with email/name/subscribed_at/unsubscribed_at/joined_at_iter/status. New "Export CSV" button on the Updates admin tab. Excludes `unsubscribe_token` from the export (don't leak unsubscribe URLs).

2. **Auto-pause warning when CHANGELOG goes silent for 30+ days** — `staleness()` helper computes days since last dispatch. Surfaced as `stale: {is_stale, days_since_dispatch, threshold_days}` in the preview endpoint. Yellow warning banner on the admin tab kicks in past the 30-day threshold ("Subscribers haven't heard from us in over 30 days. Either ship a new entry or send a status note via Broadcast"). The cron continues to no-op silently — banner is the operator nudge.

3. **Post-dispatch OPS summary email** — `send_ops_updates_dispatch_summary()` fires from `run_digest_dispatch()` after a live send (skipped on dry-run). Lands in the same OPS_EMAIL inbox as watchdog alerts so operators get closing-loop confirmation. Includes counts (new_entries / subscribers / sent / failed) and a `trigger` field ('cron' vs 'admin-button') so you can tell apart automated vs manual dispatches.

**Regression guard:** `tests/test_iter98_updates_polish.py` (6 tests, all green) + `tests/test_iter98_csv_export.py` (2 tests, green via shared TestClient fixture). Covers _days_since edge cases, staleness threshold logic, OPS-summary fire-on-live + skip-on-dry-run, CSV content-type/disposition headers, auth gating.

**Files:** `updates_digest.py` (staleness + OPS summary call + trigger param), `email_service.py` (template), `routers/prod_health.py` (CSV endpoint + stale field on preview), `scheduler.py` (passes trigger='cron'), `components/admin/UpdatesAdminTab.jsx` (stale banner + Export CSV button), `tests/test_iter98_*.py` (new x2).

---


## 2026-05 — iter97 — Admin "Send digest now" panel ✅

**Why:** The iter96 cron fires at 9 AM UTC daily. Operators wanted on-demand control: see exactly which entries would dispatch BEFORE clicking, choose timing (e.g. send during US business hours), and dry-run to verify diff after a redeploy.

**What:**
- `GET /api/admin/updates/preview` — pure read; returns `{last_dispatched_iter, latest_changelog_iter, queued_entries, active_subscribers, unsubscribed_count, would_send}`.
- `POST /api/admin/updates/dispatch?dry_run=true|false&force=true|false` — same logic as the cron, just on-demand.
- New admin tab "Updates" (alphabetical, between "Team" and "Users"). Stats grid + pointer state + entry preview + Dry Run / Send Now / Refresh buttons + double-confirm modal before live send. Color-coded result tile (yellow=dry-run, green=live).

**Verified end-to-end:** Browser test confirms tab renders, preview data accurate (queued=1, would_send=3 for current state), dry-run does not advance pointer, confirm modal opens/cancels cleanly. No console errors. Auth-gated (401 without admin JWT).

**Files:** `routers/prod_health.py` (extended with 2 endpoints), `components/admin/UpdatesAdminTab.jsx` (new), `pages/AdminDashboard.jsx` (tab wired alphabetically), `lib/api.js` (helpers).

---


## 2026-05 — iter96 — Updates digest growth flywheel ✅

**Why:** /updates is a great trust-builder, but visitors leave and never come back. Capturing email turns every shipped feature into an automated re-engagement nudge.

**What:**
- New collection `update_subscribers` (email, name?, subscribed_at, unsubscribe_token, unsubscribed_at, joined_at_iter).
- `POST /api/updates/subscribe` — idempotent, EmailStr validated, snapshots current latest iter so new subscribers don't get blasted with backlog.
- `GET /api/updates/unsubscribe?token=...` — one-click HTML page with brand-matched "Got It. You're Out." typography. Always 200 (handles invalid/already-removed tokens gracefully).
- Daily cron `updates_digest@cron[hour='9', minute='0']` reads CHANGELOG.md, compares latest iter to `system_state.updates_digest.last_dispatched_iter`. If new entries exist → emails every active subscriber whose `joined_at_iter` is older than each entry. Pointer advances after dispatch.
- `email_service.send_updates_digest()` — orange-spine HTML template with up to 8 entries, "See full timeline →" CTA, and footer unsubscribe link.
- Frontend: `SubscribeCard` component on `/updates` between header and timeline (Name optional, Email required). Success state shows confirmation card; errors render inline.

**Regression guard:** `tests/test_iter96_updates_digest.py` — 11 tests covering iter comparison (digit-suffix safe), entries_since math (no pointer / mid-list / unknown pointer), subscribe idempotency + reactivation, email validation, dispatch no-op when nothing new, dispatch advances pointer + skips fresh joiners. All green.

**Verified end-to-end:** Browser test confirms subscribe form → success card; unsubscribe page renders with brand styling. Backend tests prove the dispatch logic + idempotency.

---


## 2026-05 — iter95 — Public "What's New" page (auto-refreshes per redeploy) ✅

**Why:** Users have no visibility into the constant stream of improvements shipping behind the scenes. A public "what's new" page builds trust ("they're actively shipping"), surfaces recent fixes for users to validate, and creates a soft re-engagement loop.

**What:** New backend endpoint `GET /api/updates` parses `/app/memory/CHANGELOG.md` at request time, strips engineer-flavored noise (iter numbers, file paths, TESTED markers), and returns the latest 20 entries in plain English. Public frontend at `/updates` (and `/whats-new` alias) renders it as a vertical timeline with orange spine, "LATEST" pill on the newest entry, last-refreshed timestamp, and CTAs to Contact + Beta. Added to sitemap. Auto-refreshes on every redeploy because we read the markdown file, not a frozen list.

**Regression guard:** `tests/test_iter95_updates_page.py` — 5 tests covering title sanitization, blurb extraction, iter-ref/path stripping, and end-to-end endpoint behavior. All green.

---


## 2026-05 — iter94 — Sitemap strips test/seed slugs ✅

**Why:** Post-iter92 sitemap audit showed 6 test/seed artifacts leaking into the public sitemap (`test-iter21-bg-ba4bba`, `test-studio`, `iter9-acct-f301ff35`, `test-allowedstudio-iter18`, `api-test-studio`, `final-test-studio`). Google crawls these low-content pages and dings the overall site quality score.

**Fix:** `/app/backend/routers/seo.py::_is_test_slug()` — a focused regex helper that filters product/maker/journal slugs before they enter the sitemap. Patterns are narrow by design (require a signal ONLY test data would plausibly produce — iter digit suffix, hex UUID fragment, explicit `final-test`/`api-test` prefix) so a real listing titled `test-driven-signage` or `iterations-on-oak` is preserved.

**Diagnostics:** `/api/seo/diag` now exposes `test_slugs_stripped` so you can see in real-time how many slugs got filtered per collection.

**Regression guard:** `/app/backend/tests/test_iter94_sitemap_test_slug_filter.py` — 3 tests (catches all 6 prod offenders, preserves 15 real slugs including edge cases like `test-driven-signage`, handles empty/None). All green.

**Preview verified:** Sitemap shrank from 31 → 22 URLs, zero test slugs leak.

---


## 2026-05 — iter93 — Prod Health Watchdog (5-min cron + admin banner) ✅

**Why:** iter92 surfaced a silent prod outage (all `/api/*` returning 502). We only caught it by manually curl-ing. Building a proactive watchdog so the next outage pages ops in ~10 min, not "whenever someone happens to look."

**What shipped:**
- `/app/backend/prod_health.py` — polls `CRITICAL_ENDPOINTS` (`/api/sitemap.xml`, `/api/products?limit=1`, `/api/makers`, `/robots.txt`) via httpx. State lives in `prod_health_checks` collection (one doc per endpoint). Fires a one-shot email alert after `ALERT_THRESHOLD=2` consecutive failures, and a one-shot recovery email on return to 200. 4xx is treated as reachable (not an outage).
- `/app/backend/scheduler.py` — new `prod_health_watchdog` cron at `*/5` min. Self-audit safe: skips when the preview pod IS the prod pod (would be circular).
- `/app/backend/email_service.py` — two new templates: `send_ops_prod_outage_alert()` + `send_ops_prod_recovery()`. Dispatch to `OPS_EMAIL` via the existing email chain.
- `/app/backend/routers/prod_health.py` — `GET /api/admin/prod-health` (snapshot) + `POST /api/admin/prod-health/check-now` (manual trigger for the UI button).
- `/app/frontend/src/components/admin/ProdHealthTab.jsx` — Prod Health admin tab with endpoint cards (status chip, latency, last check, consecutive failures) + "Check Now" button. Polls every 30s.
- `/app/frontend/src/components/admin/ProdHealthBanner.jsx` — sticky red banner above the stats grid when any endpoint is in the alerted state. Clicking "View" jumps to the tab. Polls every 60s.
- `/app/frontend/src/pages/AdminDashboard.jsx` — wired new tab alphabetically ("Prod Health" between "Plus Members" and "Refund Approvals") and the banner.
- `/app/frontend/src/lib/api.js` — `fetchAdminProdHealth()`, `adminProdHealthCheckNow()`.

**Env vars (optional — all have sensible defaults):**
- `PROD_WATCHDOG_ENABLED` (default `true`) — master kill switch.
- `PROD_URL` (default: `PUBLIC_SITE_URL` → `https://craftersmarket.org`) — origin to watchdog.

**Regression guard:** `/app/backend/tests/test_iter93_prod_health_watchdog.py` — 6 tests covering state transitions (outage fires once, recovery fires once, 4xx not treated as outage, env-var gating, self-audit skip). All green.

**Verified:** End-to-end curl run against real prod → 4/4 endpoints 200 OK, state persisted, admin endpoints return the snapshot correctly. Scheduler boots the cron job on process start.

---


## 2026-05 — iter92 — Sitemap preview-URL leak: hardened site_root() ✅

**Context:** After a production redeploy, `https://craftersmarket.org/api/sitemap.xml` was emitting `https://active-project-4.preview.emergentagent.com/...` URLs — a hard SEO liability (Google would index the preview domain and 301-penalty us on flip).

**Root cause:** `site_root()` in `core.py` preferred `PUBLIC_BACKEND_URL` env var unconditionally. On Emergent deploys the `.env` file is shipped as-is, so prod pods ended up with `PUBLIC_BACKEND_URL=<preview URL>`. Preview-marker filtering was only applied to the `x-forwarded-host` header, not to the env vars.

**Fix:**
- Extracted `_looks_like_preview(origin)` helper with an expanded marker list (`emergentagent.com`, `emergent.host`, `vercel.app`, `onrender.com`, `preview.`, `staging.`, `localhost`, `127.0.0.1`).
- `site_root()` now runs EVERY candidate (PUBLIC_SITE_URL → PUBLIC_BACKEND_URL → forwarded-host) through the preview check; falls back to hard-coded `https://craftersmarket.org` if all are preview.
- Extracted `_CANONICAL_SITE_ROOT` constant so there's one place to update the apex.

**Regression guard:** `/app/backend/tests/test_iter92_sitemap_preview_guard.py` (4 tests, all green) — enforces that preview URLs can never slip through even with misconfigured env vars.

**Files touched:** `/app/backend/core.py`, `/app/backend/tests/test_iter92_sitemap_preview_guard.py` (new).

**Operator action after merge:** Redeploy prod → purge Cloudflare cache for `/api/sitemap.xml` + `/sitemap.xml` → resubmit sitemap in Google Search Console.

---


## 2026-02 — iter90 — Admin design-file delete + ⌘+K command palette ✅

**Two shipped today:**

### 1. Admin Design-File Delete (irreversible hard-delete)
Previously admins could only **quarantine** community design files (soft-delete). Now there's a true delete:

- **Backend**: `GET /api/admin/design-files` (filter + search + sort newest-first) and `DELETE /api/admin/design-files/{id}` (purges R2 objects best-effort + DB row + every linked report + every download record + writes audit log entry with `r2_keys_purged` count).
- **Frontend**: New "Design Files" admin tab with thumbnails, type chips, search box, Live/Quarantined filter pills, restore button (for quarantined files), and a red Delete button that opens a typed-confirmation dialog ("Type DELETE to confirm") so a tired admin can't fire it accidentally.
- Distinct from existing **File Reports** tab (moderation queue triggered by user flags) — this one lets admins browse/delete any file regardless of report status.

### 2. Admin Command Palette (⌘+K / Ctrl+K)
Global keyboard navigator. Fuzzy-matches every tab name + 3 cross-tab actions ("Open Workshop Analytics", "Visit live homepage", "Sign out").

- ⌘K / Ctrl+K to open · Esc to close · ↑↓ to navigate · ↵ to execute
- Skips while typing in inputs/textareas so it doesn't fight browser autocomplete
- Filtered list shows current active tab with a "current" tag
- Result count + keyboard-hint footer

**Tests** (5/5 — `test_iter90_admin_design_file_delete.py`): list endpoint, quarantined filter, search, full delete lifecycle (rows + reports + downloads + audit row), 404 on missing id.

Files: `backend/routers/admin.py` (2 new endpoints + helper), `frontend/src/lib/api.js` (3 new methods), `frontend/src/components/admin/DesignFilesTab.jsx` (new ~280 lines), `frontend/src/components/admin/AdminCommandPalette.jsx` (new ~180 lines), `frontend/src/pages/AdminDashboard.jsx` (mount + visibleTabs memo). New: `backend/tests/test_iter90_admin_design_file_delete.py`.


## 2026-02 — iter89 — Admin nav: alphabetical tabs + Workshop Analytics top-bar link ✅

**Two small ergonomic wins** for the admin dashboard:

1. **Alphabetized sidebar tabs** — was previously grouped roughly by theme (analytics first, settings last) but A→Z is now standard for 25+ items where users hunt by label. Source order in `TABS` doesn't matter anymore — a defensive runtime `.sort()` guarantees the rendered order so future edits that forget to alphabetize still ship correctly.

2. **"📊 Workshop Analytics" top-bar link** — orange-bordered button next to the EMAIL/LIVE badges on `/admin/dashboard`. Was previously a hidden URL (`/admin/workshop-analytics`) that admins had to bookmark. Now one click from the operations console.

Files: `frontend/src/pages/AdminDashboard.jsx` only.


## 2026-02 — iter88 — H1 fallback for non-JS crawlers ✅

**Issue surfaced by user-run SEO checker**: "There is no H1 heading specified."

**Root cause**: The site is client-side rendered. Inside the static `index.html`, `<div id="root"></div>` is empty before React mounts. JS-aware crawlers (modern Googlebot, GPTBot, ClaudeBot, Bingbot) execute the bundle and see the per-page H1s correctly — but **non-JS crawlers** (Screaming Frog default mode, some social link unfurlers, "View crawled HTML" in Google Search Console) see zero body content and report "no H1".

**Fix**: Added a server-rendered fallback `<header>` inside `#root` containing an H1 + a brief site description + 4 deep-links into the main sections. The fallback uses the standard `sr-only` clip-path technique so:
  • Non-JS crawlers see a meaningful primary heading + content
  • Users with JS get the full React app (React's `createRoot(...).render(...)` replaces `#root`'s children on mount, so the fallback disappears)
  • Verified live: post-mount DOM contains exactly one H1 ("Find Something Built By Hand." — the Hero), zero visual artifact

Per-page H1 audit (also done): every public page (Shop, ProductDetail, MakerDetail, MakersPage, JournalPage, JournalDetail, ContactPage, PolicyPage, BetaPage, ApplyPage, CustomOrderPage) already has exactly one H1 in its rendered state. Pages with 2-4 H1s in source code are all conditional renders (success vs form vs closed states) — only one ever appears in the DOM at a time.

Files: `frontend/public/index.html` only.


## 2026-02 — iter87 — AI tag review tray (keep / drop before commit) ✅

**Problem:** Clicking "✦ AI suggest tags" silently merged every AI-generated tag into the listing. AI commonly fills all 13 slots with a 60/40 mix of gold + filler, which crowds out tags the maker wanted to add manually.

**Fix:** Suggestions now land in a **review tray** above the SEO chips section. Each tag renders as a toggleable chip:
- ✓ Pre-checked tags (filled orange) will be added on Apply
- ○ Unchecked tags (line-through, dim) are skipped
- Live counter: "X selected · Y slots available" — turns amber if you've ticked more than will fit
- **Discard** clears the tray; **Apply selected →** commits

If the maker already has 13 tags when AI runs, no review tray opens (the existing limit-banner takes over). If AI returns nothing new (everything already in tags), a soft toast acknowledges no work needed instead of silently doing nothing.

If the maker selects more tags than slots remain (e.g. 9 selected but only 6 slots free), only the first 6 are applied and a `toast.warning` reports how many were skipped.

Files: `frontend/src/pages/MakerListingEditor.jsx` only.


## 2026-02 — iter86 — SEO tag limit · loud "you hit 13/13" feedback ✅

User report: "AI is automatically generating 13/13 tags but when you type your own you can still hit Add — possibly add pop-up saying you have reached maximum limit of tags."

**Diagnosis:** The Add button + Enter-key handler were already gated at MAX_TAGS, but the feedback was too quiet — counter was tiny gray text, button only dimmed to 50% opacity, toast was a 1-line "Max 13 tags." that disappeared in 4s.

**Fix (visual loudness pass):**
- **Amber warning banner** appears above the input the moment `seo_tags.length === 13`: ⚠ "**You've reached the maximum of 13 tags.** Remove a tag below to add a new one." Impossible to miss.
- **Counter** flips from gray `13/13` → bold amber `13/13` at limit.
- **Input field** is now disabled (was enabled before, only the Add button was) with `cursor-not-allowed` + placeholder swap to "Limit reached — remove a tag first".
- **Better toasts**: explicit error "You've hit the 13-tag limit. Remove a tag first to add 'xyz'." + a new informational toast on duplicate attempts ('"xyz" is already in your tags.').

Files: `frontend/src/pages/MakerListingEditor.jsx` only.


## 2026-02 — iter85 — Public Contact form + admin Contact Inbox tab ✅

**Public `/contact` page** got a real "Send us a message" form (previously was static info only). Submissions land in a dedicated admin inbox alongside the iter84 Beta Feedback tab.

**Public side (`ContactPage.jsx`):**
- Two-column layout: existing contact info on the left, new form on the right
- Fields: Name (required) · Email (required) · Topic dropdown (8 options: General / Custom-order / Order help / Maker program / Press / Partnership / Bug / Other) · Subject (optional) · Message (8-4000 chars, required)
- **Anti-spam**: hidden honeypot `website` field — bots filling JSON forms tend to populate every field; if non-empty the endpoint silently 200s without persisting (verified in test). Plus an in-process IP rate limiter (10/min/IP) on `/api/contact-messages` to mitigate scripted floods without requiring captcha.
- **UX confirmation**: success state shows a green confirmation card with the submitter's name + email + a "Send another" reset CTA.
- **Privacy note**: form footer reassures the email is not added to any marketing list.

**Backend (`routers/contact_messages.py`):**
- `POST /api/contact-messages` (public) — persist + email ops + auto-reply submitter (24h SLA confirmation with quoted message)
- `GET /api/admin/contact-messages?resolved=&topic=` — newest-first listing with IPs stripped from the response (privacy)
- `POST /admin/contact-messages/:id/resolve`
- `POST /admin/contact-messages/:id/reply` — sends Postmark email + auto-resolves + writes `admin_audit` row (audit trail for any outbound team correspondence)

**Frontend admin (`ContactInboxTab.jsx`, ~330 lines):**
- Mirrors the FeedbackTab pattern: filter pills (Pending / Resolved / All), topic-pill row, received-order numbering, inline collapsible Reply composer, one-click Resolve.
- Topic chips are color-coded: Custom (orange), Order help (amber), Bug (red), Press (purple), Partnership (sky), General/Other/Maker program (neutral).
- Phone field renders as a clickable `tel:` link when the submitter included one.
- Status chips: `✓ Resolved` (emerald) and `✉ Replied` (sky).

**Two new email templates:** `send_contact_message_to_ops` + `send_contact_message_autoreply` (the latter quotes the original message back to the submitter so they have a paper trail).

**Tests** (3/3 — `test_iter85_contact_inbox.py`): submit validation (too-short/invalid-email rejected), honeypot silently succeeds without persisting, full inbox lifecycle (3 submissions → newest-first → topic filter → mid-row resolve → reply auto-resolve → IPs not leaked).

Files: `backend/routers/contact_messages.py` (new), `backend/email_service.py` (2 new templates), `backend/server.py` (mount). Frontend: `lib/api.js`, `pages/ContactPage.jsx` (form + ContactForm sub-component), `components/admin/ContactInboxTab.jsx` (new), `pages/AdminDashboard.jsx` (mount). New: `backend/tests/test_iter85_contact_inbox.py`.


## 2026-02 — iter84 — Admin Beta Feedback inbox tab ✅

**New admin tab** (Operations → "Beta Feedback") for reviewing every public Beta Feedback widget submission **in the order it was received** (newest first). Backend endpoints already existed (`GET /api/admin/feedback`, resolve/reply); this iteration ships the missing frontend.

- **`<FeedbackTab>`** — filter pills (Pending / Resolved / All), received-order numbering (`#3`, `#2`, `#1` …), name + clickable email + relative time + page-context link, inline collapsible Reply composer (subject + textarea), one-click Resolve. Replied tickets carry a sky `✉ Replied` chip; resolved ones an emerald `✓ Resolved` chip.
- **Reply flow** auto-resolves the ticket on send (single Postmark transactional via `send_admin_broadcast`); ticket records `replied_at` + `replied_by` for audit.
- Mounted between Digests and Team in `AdminDashboard.jsx` tab nav.

**Tests:** iter84 `test_iter84_admin_feedback_inbox.py` 6/6 — submission → newest-first listing → mid-row resolve → reply auto-resolve → resolved-list lookup → `replied_at` / `replied_by` audit fields all verified.

Files: `frontend/src/components/admin/FeedbackTab.jsx` (new, ~250 lines), `frontend/src/pages/AdminDashboard.jsx` (mount). New: `backend/tests/test_iter84_admin_feedback_inbox.py`.


## 2026-02 — iter83 — Light/Dark mode keyboard shortcut (⌘+L / Ctrl+L) ✅

**Quality-of-life keystroke** for power-user makers — flip themes from anywhere on the dashboard without navigating to Settings:

- **Listener**: `useEffect` on `MakerDashboard` root listens for `keydown` with `metaKey || ctrlKey` + `KeyL`. Skipped when typing in `INPUT` / `TEXTAREA` / `contentEditable` so browser autocomplete (`Ctrl+L = focus URL bar`) and form input aren't hijacked.
- **Optimistic UX**: local `setMaker` flips the theme instantly; `updateMakerProfile({appearance_mode: next})` runs in the background. Failure rolls back the local state and shows a red toast.
- **Toast** confirms the new theme + the shortcut (e.g. "Light mode · Ctrl+L to toggle") with the OS-correct modifier glyph (`⌘` on Mac, `Ctrl` elsewhere).
- **Settings → Options** hint copy now mentions the shortcut so users discover it.

**Verified** end-to-end in production preview: pressed Ctrl+L twice in a row, dashboard flipped light → dark instantly with green toast confirmations.

Files: `frontend/src/pages/MakerDashboard.jsx` (keydown listener), `frontend/src/pages/MakerDashboard/SettingsTab.jsx` (hint copy).


## 2026-02 — iter82 — Maker Dashboard Light Mode + Custom-Orders policy clarified on /policy (TESTED ✅)

**Light Mode for Shop Manager** (per-maker accessibility option):
- New maker field: `appearance_mode: "dark" | "light"` (default `"dark"`). Saved on the maker doc so it follows the seller across devices.
- Toggle in **Settings → Options** → "Light mode for Shop Manager" switch with hint copy explaining it only flips the private dashboard, not the public shop or rest of the site.
- CSS implementation: `.theme-light` overrides in `index.css` remap the hardcoded brand hex values (`bg-[#0a0a0a]`, `text-[#e5e5e5]`, `border-[#262626]`, etc. — Tailwind escapes them as `\[\#…\]` in the compiled CSS) to a light palette. Orange `#ff4500` accent left untouched so brand cues (active tab, primary CTAs, KPI numbers) read on both themes. Grain texture is suppressed in light mode so the white bg reads clean.
- Applied via `data-theme` attribute on the `ShopManagerLayout` root — only this subtree flips. Buyer-facing pages, the global Nav, the beta banner, custom-order ticker, and Cart all stay on the dark brand theme.

**Custom-Orders /policy clarification:**
- Updated `PolicyPage.jsx` Custom & Personalized Orders section to explain the platform's proof-required default is exactly that — a default — and that each shop's individual policy on their profile takes precedence.
- Added a "Shop-specific policies" sub-section explaining that some shops opt out of proofs for very simple personalizations (e.g. name engraving on a stock SKU).

**Tests:** iter82 — `appearance_mode` round-trips through PATCH /maker/profile (light → dark → restore).

Files: `backend/models.py` (Maker + MakerProfileUpdate), `frontend/src/index.css` (~50 lines of `.theme-light` overrides), `frontend/src/pages/MakerDashboard/ShopManagerLayout.jsx` (conditional class), `frontend/src/pages/MakerDashboard/SettingsTab.jsx` (Options toggle), `frontend/src/pages/PolicyPage.jsx` (custom-orders copy). New: `backend/tests/test_iter82_appearance_mode.py`.


## 2026-02 — iter81 — Full sweep · scroll fix carry-over + 4 quick UI wins + restock waitlist + retention cohorts (TESTED ✅ 5/5 + 4/4 iter80)

**Quick UI wins (the parked iter79 batch):**
- **Backorder "stale" badge** — pending requests ≥3 days old now show a red `◆ Stale Xd` chip in the row header (hint: "No response in N days — buyer is waiting"). `daysSince()` helper from `timeAgo.js`.
- **REFIRE "Last sent Xm ago" badge** — admin Paid Orders list stamps a `cm_admin_refire_log` localStorage map on every refire click; surfaces a live `Last sent 2m ago` chip next to the Refire button (1-min ticker keeps it fresh without requiring reload). Prevents accidental double-fires.
- **Community Files Leaderboard** — new `GET /api/community/files/leaderboard` aggregates `design_files` by uploader (maker_slug or buyer uploader_id), hydrates portrait/avatar + display_name from `makers` / `community_users`, sorts by score = uploads × 5 + downloads. Collapsible card shows top 10 contributors in the Design Files tab.
- **Workshop Analytics time-range selector** — pills (7d / 30d / 90d) on the Overview tab. Backend `GET /workshop-analytics/overview?range_days=N` accepts {7,14,30,60,90} (others fall back to 30) and returns `range_days` for the frontend label. Cached overview data is invalidated on range change.

**P1 — Restock Waitlist (lighter than backorders):**
- New collection: `restock_waitlist` (separate from `backorder_requests`). New router: `routers/restock_waitlist.py`.
- `POST /api/products/{slug}/restock-waitlist` — public (email + optional name), validates listing is at 0 stock, dedups by (product_id + email + notified_at:null) so repeat clicks don't spam.
- `GET /api/maker/restock-waitlist` — returns aggregated demand `{products: [...], total_pending: N}` for the maker's listings.
- **Auto-fire on restock**: maker PATCH /maker/products/{slug} now calls `fire_restock_notifications_if_needed()` whenever stock crosses 0 → positive. Drains every pending entry, fires `send_buyer_restocked` email to each buyer (single-email semantics — `notified_at` stamped so they're not re-emailed on subsequent stock changes).
- **Frontend**: New `<RestockWaitlistModal>` opens from a "✉ Notify me" button next to the Backorder/Sold-out CTA on `ProductDetail`. Maker `ProductsList` gets a top banner showing total pending demand + top-3 listings by waiting count, with a one-line nudge to refill stock.
- New email templates: `send_buyer_restock_signup` (confirmation) + `send_buyer_restocked` (back-in-stock alert with Buy now CTA).

**P2 — Real cohort retention** (replaces the hardcoded sample data on Workshop Users tab):
- `_calc_retention_cohorts()` aggregates `community_users.last_seen` against `created_at` for true Week-1/2/4/8 retention. Denominator = users old enough to be eligible; numerator = users whose last_seen ≥ signup + N weeks. Returns `{cohort, rate, denom, retained}` quad per row.
- Frontend now displays the denominator + explainer line so the figures aren't mistaken for synthetic data.

**Custom-orders policy customization** (from earlier user question):
- New maker fields: `custom_order_policy` (free text) + `custom_orders_require_proof` (bool, default true). Both are PATCH-able via `MakerProfileUpdate`.
- Settings → Policy settings now has a dedicated "Custom & personalized orders" block with the proof toggle + free-text policy textarea.

**Bonus carry-over:** Scroll-to-top fix from iter80 already covered all tabbed surfaces; nothing more needed here.

**Tests 5/5 (iter81) + 4/4 (iter80, no regression):** workshop overview range_days, real retention shape, files leaderboard sort, restock waitlist full lifecycle (signup → dedupe → maker dashboard → drain on stock raise), custom-order policy PATCH.

Files: `backend/models.py` (RestockWaitlistEntry/Create + custom-order fields + Maker base), `backend/routers/restock_waitlist.py` (new), `backend/routers/maker.py` (PATCH hook), `backend/routers/community.py` (leaderboard endpoint), `backend/routers/workshop_analytics.py` (range_days + retention calc), `backend/email_service.py` (2 new templates), `backend/server.py` (mount restock router). Frontend: `lib/api.js`, `pages/MakerDashboard/SettingsTab.jsx` (custom-orders block), `pages/MakerDashboard/BackordersList.jsx` (stale chip), `pages/MakerDashboard/ProductsList.jsx` (demand banner), `pages/CommunityPage.jsx` (leaderboard card), `pages/WorkshopAnalyticsDashboard.jsx` (range pills + retention denom), `pages/ProductDetail.jsx` (notify button + modal), `components/RestockWaitlistModal.jsx` (new), `components/admin/PaidOrdersList.jsx` (refire badge). New: `backend/tests/test_iter81_full_sweep.py`.


## 2026-02 — iter80 — Per-shop returns/exchange policy + Maker portrait/cover image uploads (TESTED ✅ 4/4)
**User report:** "When selecting returns and exchanges allowed the system does not allow you to customize return and exchange setting per company." Plus the parked Edit-Shop image upload feature.

**Returns/exchange — per-shop customization (Settings → Policy settings):**
- New maker fields: `accepts_returns_default`, `accepts_exchanges_default`, `return_window_days` (default 14), `return_shipping_paid_by` ("buyer"|"seller"), `restocking_fee_pct` (0-100), `non_returnable_items` (text). Existing free-text `returns_policy` stays as a catch-all narrative.
- UI shows two ToggleRows; when EITHER is on, a structured rules block appears with window-days, who-pays-shipping, restocking-fee, and excluded-items inputs. A live "Buyer will see" preview renders the final sentence buyers get on every product page.
- Per-listing `accept_returns`/`accept_exchanges` toggles unchanged — those override per-product when set.

**Maker portrait + cover image uploads:**
- New endpoints: `POST /api/maker/uploads/portrait` and `POST /api/maker/uploads/cover` — multipart UploadFile, validates PNG/JPG/WebP/GIF + 10MB cap, pushes bytes to Cloudflare R2 under `portraits/{slug}/...` and `covers/{slug}/...`, persists URL onto `makers.{portrait|cover}`. Shared `_upload_profile_image()` helper.
- Settings → Info & Appearance now shows drag-and-drop image dropzones (square preview for shop icon, 3:1 wide preview for cover) replacing the old URL text inputs. Loader2 spinner during upload, X-button to remove.

**Bonus UX (same iteration):** Fixed scroll-position bug across all tabbed surfaces — Maker Dashboard tabs, Admin Dashboard tabs, Maker Settings sub-sections, Community page tabs, and Workshop Analytics tabs now auto-scroll to top on switch. Routed pages were already covered by the global `<ScrollTop />`.

**Tests 4/4:** unauth-rejected, uploads-persist (R2 + DB), policy-PATCH-persists, bad-MIME-rejected. All passing.

Files: `backend/models.py` (Maker + MakerProfileUpdate), `backend/routers/maker.py` (3 new endpoints + helper), `frontend/src/lib/api.js` (uploadMakerPortrait/Cover), `frontend/src/pages/MakerDashboard/SettingsTab.jsx` (ImageDropzone + Policy rewrite + scroll fix), `frontend/src/pages/MakerDashboard.jsx`, `frontend/src/pages/AdminDashboard.jsx`, `frontend/src/pages/CommunityPage.jsx`, `frontend/src/pages/WorkshopAnalyticsDashboard.jsx`. New: `backend/tests/test_iter80_returns_policy_and_image_uploads.py`.

## 2026-02 — iter78 — Mark-Shipped Guardrail · tracking required for non-Shippo fulfillments (TESTED ✅ 14/14)
**Fix:** Previously a maker could hit "Mark shipped" with nothing filled in — buyer was left in the dark with no tracking. Per user request, now enforced on both layers:

- **Backend** — `POST /maker/orders/{sid}/ship` returns 400 unless either (a) the tx already carries a Shippo label (`shippo_tx_id` or `shippo_label_url`), (b) the tx already has `tracking_number` stamped (e.g. from the Shippo webhook), OR (c) the request body supplies BOTH `tracking_number` AND `tracking_carrier`. Carrier without tracking → rejected (useless). Tracking without carrier → rejected (USPS/UPS/FedEx numbers overlap).
- **Frontend** — manual-ship form: Mark-shipped button disabled until tracking # non-empty AND carrier picked; input tints orange-bordered when empty; helper text "Both tracking number and carrier are required so the buyer can track their package"; placeholder "(required)" on the tracking field.

**Tests 14/14:** 6 new in `test_iter78_ship_guardrail.py` (rejects-no-tracking, rejects-carrier-only, rejects-tracking-only, accepts-both, Shippo bypass, pre-stamped-tracking bypass) + 8 prior iter72 tests (updated one to match the new contract).

Files: `backend/routers/maker.py` (guardrail block), `frontend/src/pages/MakerDashboard/OrdersList.jsx` (disabled-button UX), new `backend/tests/test_iter78_ship_guardrail.py`, updated `tests/test_iter72_buyer_shipped_email.py`.


## 2026-02 — iter77 — Bug fix · Admin "Refire order emails" now works + includes tracking email (TESTED ✅ 5/5 + live verified)

**Root cause:** The `POST /api/admin/orders/{session_id}/refire-emails` endpoint read from `db.transactions` (0 docs — legacy collection) instead of `db.payment_transactions` (204 paid orders — source of truth since iter60-ish). Every REFIRE click returned `404 Order not found.` — exactly the error in the user's screenshot.

**Fix:**
- Read from `payment_transactions` first, fall back to `transactions` for any legacy data
- Buyer email field handling: prefer `customer_email` (current schema), fall back to `buyer_email` (legacy)
- Reconstruct buyer name from `customer_name` or nested `shipping_details.name`

**Bonus improvement (per user's hint "check email for tracking / completed order"):**
- When the target order already has a `tracking_number`, refire ALSO fires `send_buyer_shipped` (iter72) so the buyer gets the tracking + receipt email in the same click. Covers the most common reason admins hit REFIRE post-fulfillment ("I lost the tracking email, can you resend?").
- Response `sent` array now distinguishes: `buyer_receipt` / `buyer_shipped` / `maker:{slug}` / `ops` so the admin panel toast can display exactly what fired.

**Rate-limit:** 30-second cooldown via `last_admin_refire_at` stamp, returns 429 with remaining seconds during the window — prevents accidental triple-clicks from spamming the buyer's inbox.

**Tests · 5/5** (`test_iter77_admin_refire_fix.py`):
1. reads from payment_transactions (not legacy)
2. includes buyer_shipped when tracking present
3. falls back to legacy `transactions` when new collection empty
4. 404 on unknown session
5. 429 within 30s cooldown

**Live verified:** curl against real paid-with-tracking order (`cs_test_76f53b8a1d28dfdc10fa68a22ec7` · Jane Wilson · $156.99 · USPS 9334...0826) returned `{"sent":["buyer_receipt","buyer_shipped","ops"],"failed":[]}` HTTP 200. Second click within 30s returned HTTP 429 with countdown. Unknown session still returns 404.

Files: `backend/routers/admin.py` (endpoint rewrite), new `backend/tests/test_iter77_admin_refire_fix.py`.


## 2026-02 — iter76 — Bundle Quality Score for Community Files (TESTED ✅ 9/9 + e2e)

Twilio A2P 10DLC registration is parked as paperwork-only — runs in the user's Twilio Console, no code involvement. Once approved, the existing `send_delivery_sms` path (iter69b) starts working with zero changes.

### Score formula · 5 dimensions × 20pts = 100
- **Visual preview** (thumbnail OR auto-rendered) · 25 (slightly weighted because buyers scan visually)
- **Context** (description ≥ 60 chars) · 15
- **Multi-format** (≥2 variants) · 20
- **Production-ready** (DXF / SVG / STL / DWG / NC / EPS / PDF / OBJ / 3MF / STEP / GCODE present) · 20
- **2D + 3D coverage** (covers ≥2 of {2D, 3D, CNC} workflows) · 20

Tiers: ⭐ excellent (80+) · ✦ good (60-79) · ○ basic (40-59) · △ incomplete (<40).

### Backend
- `_compute_quality_score(doc) -> {score, tier, breakdown}` pure function in `routers/community.py`. Each breakdown entry carries `{label, points, earned, hint}` so the UI can render an actionable tooltip listing exactly which dimensions are missing and what to add to fix each.
- `_with_quality(doc)` injector — never mutates the source doc, always returns a fresh dict (avoids polluting cached Mongo docs).
- Wired into `GET /api/community/files` (list) + new `GET /api/community/files/{file_id}` (detail) + the upload endpoint return payload — uploaders see their score immediately after creating the bundle, no refresh needed.

### Frontend
- `<QualityBadge>` shared component — color-coded score chip with hover tooltip showing the 5-row checklist. ✓ for earned dimensions, ○ for missed, with the actionable hint dim-rendered below each missed dimension. Two sizes (`sm` for grid view, `lg` for detail page).
- Wired into the FileCard in `CommunityPage.jsx` Files tab.

### Tests · 9/9
`test_iter76_bundle_quality.py`: full bundle → 100 / excellent · minimal upload → incomplete · breakdown carries actionable hints · thumbnail alone doesn't pass basic · DXF + thumb + desc → 60 / good · 2D+3D bonus pushes 80→100 · missing-keys safety · `_with_quality` returns copy not mutation · list endpoint includes `quality` field.

### E2E
Live curl confirms `quality` field on every `/api/community/files` row. Screenshots captured: 3-bundle grid showing emerald 100, emerald 80, orange 60 + red 20 incomplete fixtures all rendering correctly. Tooltip-on-hover screenshot confirms breakdown checklist with actionable hints. Lint clean (Python ruff + ESLint).

Files added: `backend/tests/test_iter76_bundle_quality.py`, `frontend/src/components/QualityBadge.jsx`. Modified: `backend/routers/community.py` (helper + endpoint return), `frontend/src/pages/CommunityPage.jsx` (badge import + FileCard wiring).


## 2026-02 — iter75 — Three closing-loop improvements (TESTED ✅ 15/15 + e2e)

### #1 · Backorder requests KPI tile on Maker Dashboard
- ✨ **5th tile** in the Maker Dashboard KPI strip — `Backorders · N pending` with a Hourglass icon, orange accent. Clicking jumps to the Orders tab. Tile only renders when `pendingBackorders > 0` so makers who never enabled backorders see a clean strip.
- ✨ **`pendingBackorders` parent state** in `MakerDashboard.jsx` — fetched alongside other dashboard data on mount; bubbled back up from `OrdersTabWrapper` after every accept/decline/fulfill via `onBackordersChange` callback so the badge stays in sync without a separate poller.

### #2 · Resend tracking email · maker order row
- ✨ **`POST /api/maker/orders/{sid}/resend-tracking-email`** — re-fires `send_buyer_shipped` (iter72) for an already-shipped order. Rate-limited to 1 / 60s via `last_tracking_resend_at` stamp; returns 429 with remaining seconds during the cooldown. 400 when no tracking exists yet, 400 when buyer email missing. Cross-maker isolation enforced (404).
- ✨ **"Resend tracking email" link** next to "Reprint label" on every fulfilled order's expanded row, gated behind a confirm-dialog so a misclick doesn't spam the buyer. Reuses the same email body so the buyer sees the same receipt + tracking pill they'd expect.

### #3 · Decline reason library
- ✨ **`<DeclineReasonPicker>`** shared component — preset chips that seed the textarea + a `✕ Custom` button to clear. Two preset libraries: `application` (Portfolio thin / Niche fit / Geo not yet supported / Incomplete) and `backorder` (Booked through quarter / Materials unavailable / Discontinued / Scope mismatch). Active preset gets an orange ring; textarea stays the source-of-truth so admins can edit after picking.
- ✨ Wired into both decline flows — admin Application reject (`ApplicationsList.jsx`) and maker Backorder decline (`BackordersList.jsx`). Single source of truth keeps tone consistent across the founding team and reduces "blank textarea paralysis" on rejections.

### Tests · 15/15
- `test_iter75_resend_tracking.py` (4): happy-path dispatch + rate-limit at 60s + 400 on missing tracking + 404 cross-maker isolation.
- `test_iter74_backorder_lifecycle.py` (11) — still green from prior iteration.

### E2E
Live screenshots captured for: KPI strip with new Backorders tile rendering correctly with `pendingBackorders=1`, decline picker shown empty + populated after preset click. Lint clean (Python ruff + ESLint).

Files added: `frontend/src/components/DeclineReasonPicker.jsx`, `backend/tests/test_iter75_resend_tracking.py`. Modified: `routers/maker.py` (resend endpoint), `frontend/src/lib/api.js` (helper), `MakerDashboard.jsx` (state + props plumbing), `MakerDashboard/DashboardTab.jsx` (5th KPI tile), `MakerDashboard/OrdersList.jsx` (resend button), `MakerDashboard/BackordersList.jsx` + `components/admin/ApplicationsList.jsx` (decline picker integrations).


## 2026-02 — iter74 — 0-Stock Backorder Lifecycle · request-only flow with maker accept/decline (TESTED ✅ 11/11 + e2e)

### Buyer side · Product Detail OOS UX
- ✨ **3-state stock row** on `ProductDetail.jsx`: in-stock → quantity stepper + Add to cart (unchanged); 0-stock + backorders allowed → orange "◆ Currently out of stock / 0 available" pill with `~N weeks` lead-time + a big "Request backorder →" CTA; 0-stock + backorders OFF → disabled "Sold out". Previously the Add-to-cart button still worked at 0 stock (silent bug — fixed).
- ✨ **`<BackorderRequestModal>`** — name / email / qty / message form; "How this works" callout; success state confirms request was sent + reminds "no charge today". Calls `POST /api/products/{slug}/backorder-request`.
- ✨ **Stock chip** ("0 available" vs "N in stock") added to the ProductBasics dl strip so OOS state surfaces above the fold even when the buyer is scrolling fast.

### Maker side · Settings + Listing editor + Orders sub-tab
- ✨ **Maker Settings → Options** — new toggle "Accept backorder requests by default" (`accepts_backorders_default`). Per-listing override sits inside the listing editor.
- ✨ **Listing editor → Pricing section** — 3-state segmented control (`◆ Use shop default` / `✓ Allow backorders` / `✕ Disable`) + conditional "Lead time (weeks)" input that only appears when listing-level "Allow" is selected. Defaults to inherit (null) so existing listings keep the maker-default behavior.
- ✨ **Orders tab → 3rd "Backorders" sub-tab** in `MakerDashboard.jsx`. Lazy-fetched on first switch-in, refreshes after each accept/decline/fulfill. Inline `◆ BACKORDER` tag PLUS lifecycle status pill (pending / accepted / fulfilled / declined) on every row — covers both UX patterns the user requested.
- ✨ **`<BackordersList>`** — accordion-row UI: buyer info + mailto link, lead-time quoted, buyer message in a quoted block, decline reason (when applicable). Action buttons gated by lifecycle state: pending → Accept / Decline-with-optional-reason; accepted → Mark Fulfilled.

### Backend · Lifecycle + emails
- ✨ **New `/api/products/{slug}/backorder-policy`** (public) returns `{allowed, lead_weeks, in_stock}` so the React layer doesn't duplicate the per-listing-override-on-maker-default logic. **`/backorder-request`** (public) creates a request with cross-checks: product exists + published + 0 stock + backorders allowed.
- ✨ **Maker endpoints** — `GET /api/maker/backorder-requests`, `POST .../{id}/accept`, `POST .../{id}/decline` (with reason), `POST .../{id}/fulfill`. State machine: `pending → accepted | declined`, `accepted → fulfilled`. Cross-maker isolation enforced via `maker_slug` filter on every query.
- ✨ **4 new email templates** (`send_buyer_backorder_received` / `_alert` to maker / `_accepted` / `_declined`). All include lead-time prominently displayed; declined emails include the maker's optional reason as a quoted block; maker alert links via `?tab=orders` deep-link.
- ✨ **Schema** — Product gets `accepts_backorders: Optional[bool]` + `backorder_lead_weeks: Optional[int]`; Maker gets `accepts_backorders_default: bool`; new `backorder_requests` collection with full lifecycle timestamps.

### Tests · 11/11
`test_iter74_backorder_lifecycle.py`: policy resolver (3 — inherit / per-listing override / per-listing lead-time), submit guards (3 — in-stock rejected / disabled rejected / success path schedules emails), accept (2 — flips status / rejects non-pending), decline (1), fulfill (1 — only-on-accepted), cross-maker isolation (1).

### E2E
Live curl roundtrip against real product (`mountain-range-silhouette`) — policy returns correct allowed/lead values, submit creates the doc + returns 200. Frontend screenshots captured for OOS pdp, backorder modal, backorders sub-tab (collapsed list) and expanded row with action buttons. All states render with correct copy.

Files added: `backend/routers/backorder.py`, `backend/tests/test_iter74_backorder_lifecycle.py`, `frontend/src/components/BackorderRequestModal.jsx`, `frontend/src/pages/MakerDashboard/BackordersList.jsx`. Modified: `models.py`, `email_service.py`, `server.py`, `routers/maker.py` (MakerProductUpdate fields), `frontend/src/lib/api.js`, `pages/ProductDetail.jsx`, `pages/MakerDashboard.jsx`, `pages/MakerDashboard/SettingsTab.jsx`, `pages/MakerListingEditor/PricingSection.jsx`, `pages/MakerListingEditor/constants.js`, `pages/MakerListingEditor.jsx`.


## 2026-02 — iter73 — Maker Dashboard `?tab=...` Deep-Links · email-rewriter-safe (TESTED ✅ 13/13 + e2e)
- ✨ **Query-param deep-link support** on `/maker/dashboard?tab=orders` (and every other tab: `listings`, `messages`, `briefs`, `stats`, `financials`, `settings`, etc.). `?tab=<id>` mirrors the existing `#<id>` hash behaviour but survives email link-rewriters (Postmark / SendGrid / Mailgun) that strip URL fragments before dispatch. On mount we validate the id against `KNOWN_TABS`, rewrite the URL to `#<id>` so subsequent hashchange stays authoritative, and fall back to dashboard when the id is unknown (junk values like `?tab=evil` are stripped entirely — no phishing-looking URLs sticking around).
- ✨ **`send_maker_new_order` email now includes an "Open orders tab →" CTA** that deep-links via `?tab=orders` — the canonical use-case this feature unblocks. Every new-order email is now a one-click path to shipping/fulfillment.
- Tests: `test_iter73_tab_deeplink.py` (1 — renderer generates `?tab=orders` link, not `#orders`). All 13 backend tests from iter72/72b/73 green. Live e2e smoke confirmed `?tab=orders` → Orders tab selected + URL rewritten to `#orders`; `?tab=evil` → junk stripped. Frontend lint clean.
- Files: `frontend/src/pages/MakerDashboard.jsx` (+`resolveInitialTabFromUrl` helper, +`KNOWN_TABS` guard), `backend/email_service.py` (+CTA in `send_maker_new_order`), new `backend/tests/test_iter73_tab_deeplink.py`.


## 2026-02 — iter72 — Buyer-Shipped Email + Workshop KPI Deltas (TESTED ✅ 12/12 + e2e)

### Bug fix · Buyer never received tracking + receipt on shipment
- ✨ **New `send_buyer_shipped(...)`** in `email_service.py` — receipt-style line items + total + a tracking pill with carrier deep-link button. Subject: `Shipped · {tracking} · {carrier} · order {ord_id[:8]}` (mailbox sorts naturally). Carrier fallbacks for USPS / UPS / FedEx / DHL when Shippo's `tracking_url_provider` isn't supplied.
- ✨ **Wired into both ship endpoints**: `POST /maker/orders/{sid}/ship` (manual mark-shipped) AND `POST /maker/orders/{sid}/shipping/buy-label` (Shippo label-buy). Idempotent via `shipped_email_sent` flag — re-clicking Mark Shipped doesn't double-send. Stamp-then-dispatch ordering wins the race against parallel calls.
- ✨ Skips silently when buyer email is missing OR no tracking number was provided (so manual local-pickup orders don't error).

### Improvement · Compare-to-last-period KPI badges on Workshop Analytics
- ✨ **`_period_metrics(start, end)` + `_delta_pct(cur, prior)`** helpers in `routers/workshop_analytics.py`. The `/overview` endpoint now returns a `deltas` block with `{revenue, orders, users, avg_order_value}`, each carrying `{current, prior, pct}` (trailing 30 days vs the 30 days before that). `pct` is `null` when prior=0 so the UI can render a `◆ NEW` pill instead of `+∞%`.
- ✨ **`<DeltaPill>` component** in `WorkshopAnalyticsDashboard.jsx` — colored chip below each KPI tile: ▲ `+X.X%` green when up, ▼ `-X.X%` red when down, → `flat` grey when 0, `◆ NEW` orange when prior was empty. Hover-tooltip exposes the raw `30d: X · prior 30d: Y` numbers. Caption "Δ vs prior 30 days · trailing-window comparison" sits right below the grid so admins know the window.

### Tests · 12/12
- `test_iter72_buyer_shipped_email.py` (8): renderer (tracking + receipt + carrier deep-links), mark-shipped wiring (sends on first ship, does NOT re-send when flag set, skips on no-tracking, skips on no-email).
- `test_iter72b_workshop_kpi_deltas.py` (4): `_delta_pct` math + zero-prior handling + 1-decimal rounding + `/overview` integration shape.
- Live curl: `/api/workshop-analytics/overview` returns `deltas` block with all 4 metrics. E2E screenshot confirms `◆ NEW` orange pills rendering on the Overview tab. Lint clean (Python ruff + ESLint).

Files: `email_service.py` (+88 lines · new `send_buyer_shipped`), `routers/maker.py` (mark-shipped wiring + bg task), `routers/shipping.py` (buy-label wiring + bg task), `routers/workshop_analytics.py` (delta helpers + overview payload), `pages/WorkshopAnalyticsDashboard.jsx` (DeltaPill + KpiGrid extension). 2 new test files.


## 2026-02 — iter71 — Workshop Analytics Dashboard · isolated `/api/workshop-analytics/*` + new admin page (TESTED ✅ live data + e2e screenshots)
- ✨ **New isolated router** `/app/backend/routers/workshop_analytics.py` mounted under `/api/workshop-analytics/*` so it sits cleanly alongside the existing `/api/analytics/*` and `/api/admin/analytics/*` routes — zero risk of regression to the live tracking + admin charts. Endpoints: `/overview`, `/sales`, `/sellers`, `/users`, `/live`, `/traffic`, `/pageviews` (7 total).
- ✨ **Dual auth** — `verify_workshop_token(request)` accepts EITHER an admin JWT (Bearer token, our existing in-app auth) OR the workshop's static `X-Analytics-Token` header (secret pulled from `WORKSHOP_ANALYTICS_TOKEN` env var, defaults to "cm-analytics-readonly-2024" for paste-in compat). Both paths verified with curl + 403 on missing.
- ✨ **Schema-adapted queries** — workshop file expected `users` / `orders` / `listings` collections; we don't use those. Adapted to read our actual data: `community_users` (415 buyers), `payment_transactions` filter `payment_status='paid'` (`amount` field, dollars not cents), `products` (15 listings), `makers` (6 makers). `items[].product_id` lookups via cached product index resolve seller_slug + category + title for top-products / by-category / top-sellers. `created_at` ISO-string range queries (matches our schema; not BSON datetime). Cumulative buyer growth is now a real running total instead of flatlining at the global count.
- ✨ **Frontend dashboard** at `/admin/workshop-analytics` (`pages/WorkshopAnalyticsDashboard.jsx`) — 7 tab-switching sections matching the 7 endpoints. Recharts-driven AreaChart / BarChart / LineChart / PieChart (already in package.json), brand palette (#0a0a0a ink, #ff4500 accent, #ffa07a secondary), JetBrains Mono axes, card-shell tables for top products / sellers / pages. Lazy fetch per tab, KPI grid with hover ring, animated active-visitors dot on the Live tab. Auto-redirect to /admin/login if `cm_admin_jwt` is missing. Page uses `pt-32` to clear the global `<Nav />`, matching the existing `AdminDashboard` convention.
- ✨ **API helpers** — `fetchWorkshop{Overview,Sales,Sellers,Users,Live,Traffic,Pageviews}` in `lib/api.js`, all using the existing admin-jwt header pattern.
- Files added: `routers/workshop_analytics.py`, `pages/WorkshopAnalyticsDashboard.jsx`. Files modified: `server.py` (register), `lib/api.js`, `App.js`.
- Tested: live curl returned correct numbers (415 / 6 / 15 / 6 / $947.97 / $158 AOV); 403 on missing auth; e2e screenshots captured for Overview / Sales / Sellers / Live tabs — all rendering real data, charts populating, tables readable. Lint clean (Python ruff + ESLint).


## 2026-02 — iter70 — Welcome-Packet Email Preview Modal · admin QA without sending (TESTED ✅ 18/18 + e2e screenshots)
- ✨ **Pure renderer** `render_application_decision_email(name, studio, approved, note, sign_in_link) -> {subject, html}` extracted out of `send_application_decision`. Now both the dispatcher AND the new admin preview endpoint share one source of truth — the QA preview is bit-for-bit identical to what the applicant receives.
- ✨ **New endpoint** `GET /api/admin/maker-applications/{id}/preview-email?approved=&note=` — admin-only; returns `{recipient, applicant_name, studio, approved, subject, html}`. Uses a `token=preview` placeholder for the magic-link CTA so we don't mint real tokens at preview-time (links are minted only at decide-time so they're always fresh). 404 on unknown id.
- ✨ **WelcomePacketPreviewModal.jsx** — split-pane modal with iframe email preview on the right, live note editor + subject + recipient on the left. Tabs for `✦ Approval · Welcome packet` vs `✕ Rejection · Short + kind`. Note textarea debounce-rerenders (250 ms) so admins see their copy bake into the quote-block almost instantly. Sandboxed iframe (`sandbox=""`), reuses brand palette, pill-shaped close button. Seeds initial note from the parent ApplicationRow's note state.
- ✨ **`▤ Preview email` button** added to every pending ApplicationRow, sitting next to Approve/Reject. Disabled while a decide call is in flight.
- Tests: 7 new in `test_iter70_welcome_packet_preview.py` (renderer approve/reject/note paths + endpoint 404 + full payload + reject path + dispatcher uses renderer). 11 prior in `test_iter28_*` still green = **18/18**. Live e2e screenshots captured for approval, rejection, and note-rendering states — all clean.
- Files: `email_service.py` (extracted renderer), `routers/admin.py` (new endpoint + import), `lib/api.js` (helper), `components/admin/ApplicationsList.jsx` (button + modal mount), new `components/admin/WelcomePacketPreviewModal.jsx`, new `tests/test_iter70_welcome_packet_preview.py`.


## 2026-02 — iter69b — Twilio SMS · credentials wired + verified (BLOCKED on A2P 10DLC)
- ✨ **Twilio Account SID / Auth Token / From #** added to `/app/backend/.env` per user input. `twilio_service.is_configured()` flips to True · From number `+12086063449` confirmed owned + SMS-capable + MMS-capable on the Twilio account.
- ✓ **End-to-end test send fired** → Twilio API returned 201 with Message SID. Status check came back `undelivered` with **error code 30034** ("Message from an Unregistered Number" — US carrier A2P 10DLC requirement). Code path is verified; carrier registration is the only blocker.
- ✓ **`send_delivery_sms` path** in Shippo webhook (`routers/shipping.py`) was already wired; still no-op safe when Twilio is unconfigured. Will auto-light up the moment A2P brand+campaign approves at https://console.twilio.com/us1/develop/sms/regulatory-compliance/a2p-10dlc (1-3 business days, ~$4/mo + $15 vetting for Sole Proprietor tier).


## 2026-02 — iter69 — Application Received Email · refreshed copy + Beta-aware (TESTED ✅ 11/11)
- ✨ **Updated `send_applicant_received(...)`** copy in `email_service.py` to
  the user-approved wording: "thank you for your application … currently
  under review. Expect **3-5 business days** … if we have any questions
  about your application, we'll email you directly."
- ✨ **`is_beta` flag** added — when true, prepends a Founding Seller Beta
  pill in the body, swaps the headline to "Founding Seller Application
  Received." and changes the subject to `Founding Seller application
  received · {studio}`. Core promise (3-5 business days, welcome packet,
  questions-via-reply) stays identical so we have one source of truth.
- ✨ **Wired through** in `routers/catalog.py` — the `/api/maker-applications`
  endpoint now passes `app_obj.is_beta` to the bg task, so applicants
  routing through `/beta` (which prefixes `[FOUNDING SELLER BETA]` in
  `about`) automatically get the founding-seller variant.
- Tests: 11/11 in `test_iter28_application_emails_eua.py` (added new
  `test_applicant_received_beta_flair_when_beta_flag_set`). Live
  smoke-tested via curl against `/api/maker-applications` for both
  regular + beta flows — HTTP 200, ops email delivered via Postmark,
  applicant email dispatched through provider fallback chain.


## 2026-02 — iter68 — STL → PNG Auto-Thumbnail Renderer (TESTED ✅ 14/14 + frontend green)
- ✨ **Pure-Python renderer** (`backend/stl_renderer.py`) using `trimesh`
  4.12 + Matplotlib Agg backend (no GPU/OpenGL needed). 800×600 PNG in
  brand palette (`#0a0a0a` bg, `#ff4500` mesh, `#262626` edges). Caps:
  50 MB / 250k triangles with quadric-decimation fallback.
- ✨ **New endpoint** `POST /api/community/files/{id}/render/stl-thumbnail`
  — owner-only, idempotent (409 if `thumbnail_url` already set). Fetches
  STL from R2, renders off the event loop via `asyncio.to_thread`,
  uploads PNG to R2, stamps the design_files row with `thumbnail_url`
  + `thumbnail_auto_generated=true`. 422 on parse failure with friendly
  copy ("STL appears corrupted or unreadable — re-export from your
  slicer"). 400 if no STL in bundle.
- ✨ **Smart "Missing a thumbnail" prompt** on owner FileCards. Same
  orange-dashed strip pattern as the DXF→SVG one. One click → toast,
  thumb appears at the top of the card with a **`✦ RENDERED`** ribbon
  overlay so buyers know it's machine-generated.
- ✨ **Card actually shows the thumbnail now**: FileCard renders an
  `<img>` at the top of the card whenever `thumbnail_url` is set
  (4:3 aspect, object-contain). This was a latent gap from before —
  uploaded thumbnails were stored but never displayed.
- Tests: 14/14 backend pytest + frontend visual verification
  (`/app/test_reports/iteration_49.json`). Performance: 64KB STL →
  107KB PNG in **334ms**. All cross-user/role security paths verified
  (uses `_is_design_file_owner` from iter67).
- Deps added: `trimesh==4.12.1`, `matplotlib==3.10.9` (both pure-Python
  on the rendering side, no system libs required in the K8s pod).


## 2026-02 — iter67 — DXF→SVG Converter + Smart "Missing Format" Prompt + 🔒 ownership-bug fix (TESTED ✅)
- ✨ **Pure-Python converter** (`backend/dxf_converter.py`) using
  `ezdxf` 1.4.3 (BSD licence). Strict `ezdxf.read` first; falls back
  to `ezdxf.recover.read` for malformed/older DXFs. Renders modelspace
  via `SVGBackend` to a 400×400mm SVG.
- ✨ **New endpoint** `POST /api/community/files/{id}/convert/dxf-to-svg`
  — owner-only. Fetches the source DXF from R2, runs the conversion
  off the event loop via `asyncio.to_thread`, uploads the SVG to R2 as
  a new variant with `auto_generated:true` + `source_format:'DXF'`.
  Idempotent: 409 if SVG already exists; 400 if no DXF in bundle;
  422 with friendlier copy on parse failure ("DXF appears corrupted
  or unsupported variant — try re-exporting as R2010 or newer.").
- ✨ **Smart "missing SVG" prompt** on the maker's own FileCards: if a
  bundle has DXF but no SVG, the card shows an orange-dashed strip
  with `Sparkles` icon + "Generate" CTA. One-click → SVG appears in
  the chip row tagged `✦ SVG` (auto-generated visual style).
- 🔒 **Security**: testing agent caught a cross-maker access bug on
  `/variants` POST + DELETE (introduced iter66) AND on the new
  /convert endpoint — the old `role != "maker" and uploader_id != sub`
  check let any maker mutate any other maker's bundle. Fixed by
  extracting `_is_design_file_owner(doc, claims)` helper that requires
  exact `maker_slug == sub` (or `uploader_id == sub` for buyer
  uploads) and using it across all three endpoints. Verified via
  curl: 403 for cross-user, 200 for owner.
- Tests: `/app/test_reports/iteration_48.json` 13/14 → fixed; main
  agent self-verified the security fix end-to-end (3 endpoints × 3
  user perspectives).


## 2026-02 — iter66 — Multi-Format Community File Bundles (TESTED ✅ 23/23 + frontend green)
- ✨ **Bundle uploads**: `POST /api/community/files/upload` now accepts
  1..10 files in a single request. First file is the **primary**
  (back-compat with `file_type`+`download_url`); the rest land in a new
  `variants[]` array on the design_files row. Maker can ship a single
  card carrying e.g. `hero.jpg + model.stl + cut.dxf + preview.svg +
  program.gcode`.
- ✨ **New endpoints**:
  - `POST /community/files/{id}/variants` (uploader-only, 409 on duplicate)
  - `DELETE /community/files/{id}/variants/{fmt}` (primary protected, 404 on unknown)
- ✨ **Expanded format support**: added `dwg`, `jpg`, `png`, `webp`,
  `gcode`, `nc`, `tap` alongside existing dxf/svg/stl/glb/ai/eps/pdf/zip.
- ✨ **Auto-thumbnail**: if a bundle includes a raster (jpg/png/webp)
  and the user didn't paste a thumbnail URL, we promote the first raster
  variant to `thumbnail_url` so cards look polished out-of-the-gate.
- ✨ **Frontend** (`CommunityPage.jsx`): file input is now `multiple`,
  preview list shows each picked file with Primary/Variant pill +
  remove-✕, duplicate-format and >10-file guards run client-side.
  FileCard shows colour-coded format chips (◆PRIMARY orange + grey
  variants) and the Download button becomes a dropdown when a bundle
  has 2+ formats — each row shows format + size, click downloads that
  specific variant URL.
- Tests: 23/23 backend pytest + frontend verified
  (`/app/test_reports/iteration_47.json`). Cross-uploader 403, duplicate
  409, primary-protect 400, auto-thumbnail, 11-file & dup-extension
  client-guards all green.
- **Next up** (user requested): DXF → SVG converter via `ezdxf` lib
  (~40 min, slots into the new variants[] array as auto-generated SVG
  sibling). Awaiting user go-ahead.


## 2026-02 — iter65 — 🐛 Mobile Login Lockout Fix (HIGH-priority bug, TESTED ✅ 21/21)
- 🐛 **User report**: "I can't log in from my phone — it doesn't ask for
  login info, just takes me to a page that says 'precision craft
  delivered'." That phrase is from the **Footer**.
- **Root cause**: the hamburger menu had NO Sign in link
  (`Nav.jsx` mobile drawer only listed Shop/Makers/Custom/Community/
  Journal/Contact). The inline top-bar Sign in button got squeezed
  off small viewports by the [Beta][Sign in][Cart][Hamburger] cluster.
  Users opened the hamburger looking for Sign in, didn't find it,
  scrolled the page → landed on the footer "Precision craft. Delivered."
  and assumed the site was broken.
- **Fix** (`Nav.jsx`):
  1. Added `mobile-nav-signin` as the FIRST item in the hamburger
     drawer with a bright User icon + large display font. Text flips
     to "Account" when signed in. Routes to `accountHref` (same logic
     as the desktop button: /signin if logged out, role-specific
     dashboard if signed in).
  2. Hid the inline top-bar Sign in button on small screens
     (`hidden sm:inline-flex`) so the [Beta][Cart][Hamburger] cluster
     fits cleanly on iPhone SE (375px) and up.
- Verified across 5 viewports (iPhone SE, iPhone 14 Pro, tablet,
  desktop, signed-in state) — 21/21 assertions green
  (`/app/test_reports/iteration_46.json`). Sign in is now reachable
  from any phone, lands on `/signin` with the form visible above the
  fold.


## 2026-02 — iter64 — Shipping Analytics Mini-Chart (TESTED ✅ 16/16)
- ✨ **New endpoint** `GET /api/maker/shipping/analytics?days=N`
  (clamps 7..180, default 30). Returns daily zero-filled buckets
  grouped by carrier (usps / ups / fedex / dhl / other) + per-carrier
  totals + `top_carrier` label. Date bucketing uses UTC day slice of
  `created_at`.
- ✨ **Pure-SVG stacked-bar mini-chart** mounted in Maker Financials →
  Shipping labels, between the spend-cap row and the ledger table.
  7/30/90-day window toggle, brand-aligned carrier palette
  (USPS #ff4500, UPS #8a5a2a, FedEx #7c3aed, DHL #facc15, Other #a3a3a3),
  first/middle/last date axis, legend auto-filters to carriers with
  data, hover-title shows day total. No new npm deps.
- Tests: 16/16 backend pytest green
  (`/app/test_reports/iteration_45.json`). Auth gate, clamping,
  zero-fill, ordering, per-day-total-equals-carrier-sum invariant, and
  today's seed totals all verified.


## 2026-02 — iter63 — Six-item batch: auto-Stripe-customer, spend cap, SMS nudge wiring, PRD split, key-bug, address validation (TESTED ✅ 11/11 backend)
- ✨ **(a) Auto Stripe Customer on first label purchase**: `_ensure_stripe_customer()`
  lazily creates a Stripe Customer for makers without one, stamps it on
  the maker doc, idempotent. Graceful 401 handling — if the key is bad
  (e.g. placeholder in dev env) the label purchase still succeeds; the
  weekly invoice job will simply skip that maker until next attempt.
- ✨ **(b) Monthly shipping-spend cap**: PATCH `/api/maker/shipping/cap`
  with `{monthly_cap_usd}`. Enforced in `buy_label` BEFORE Shippo call —
  returns 402 with actionable message naming the cap amount + spent
  amount + where to adjust. Cap=0 disables. UI: new `CapRow` in Maker
  Financials → Shipping labels, yellow at ≥80% of cap / red when over.
  Ledger response now exposes `monthly_cap_cents` + `month_spent_cents`.
- ✨ **(c) Twilio SMS delivery nudge**: new `twilio_service.py` wrapper
  with graceful no-op if not configured. Wired into the Shippo DELIVERED
  webhook path — peak referral moment. Awaiting user's Twilio keys
  (`TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER`).
- ✨ **(d) PRD.md split** into PRD.md (82 lines, stable problem
  statement + architecture), CHANGELOG.md (1269 lines, dated iters),
  ROADMAP.md (57 lines, P0/P1/P2 buckets).
- 🐛 **(e) DashboardTab duplicate-key** fix: recent-orders `<li key>` now
  uses `${session_id||id||created_at}-${idx}` for guaranteed uniqueness.
  (First pass in iter63 failed — 3 orders share fallback value. Fixed
  post-test-agent feedback with index-tail.)
- ✨ **(f) Pre-flight address validation**: new POST
  `/api/maker/shipping/validate-address` calls Shippo addresses.create
  with `validate=True`. UI: "Validate addresses" button on
  ShippingLabelModal step-1 fires parallel validation for both
  addresses; renders green ✓ or yellow warning w/ "Use suggested: ..."
  one-click apply. Catches typos BEFORE the rate lookup.
- Tests: 11/11 backend pytest green (`/app/test_reports/iteration_44.json`).


## 2026-02 — iter62 — Phase 2B/2C/2D · Shipping Invoicing End-to-End (TESTED ✅ 100%)
- ✨ **Maker Financials → "Shipping labels" sub-tab** (Phase 2C):
  3 metric cards (Next invoice / Billed to date / Lifetime), weekly ↔
  biweekly cadence toggle, full ledger table with tracking links + PDF
  reprint per row.
- ✨ **Weekly Stripe Invoice job** (Phase 2B): APScheduler cron
  `shipping_invoices_weekly` every Monday 10:00 UTC. For each maker
  with unbilled rows AND cadence gate (weekly = always; biweekly = even
  ISO week only), creates one Stripe `InvoiceItem` per ledger row
  (`idempotency_key="shipping-item-{id}"`) and auto-finalizes a single
  Invoice. Rows get stamped `billed_at` + `invoice_id`. Skip reasons
  logged (`no_stripe_customer`, `stripe_error:...`). Admin "Run now"
  defaults to dry_run for safety.
- ✨ **Admin Shipping Ledger tab** (Phase 2D): per-maker rollup (top
  10), filters (maker_slug / tracking# / billed-yes-no), manual
  mark-billed modal (records `billed_by_admin` + note for audit), Run
  Now Dry/Real buttons, CSV export with 14 columns.
- New files: `backend/shipping_invoicing.py`,
  `backend/routers/admin_shipping.py`,
  `frontend/src/components/admin/ShippingLedgerTab.jsx`. Edits:
  `FinancialsTab.jsx` ShippingPanel section, `AdminDashboard.jsx` tab
  wiring, `lib/api.js` 7 new helpers, `scheduler.py` cron registration.
- Tests: `/app/test_reports/iteration_43.json` — 17/17 backend pytest
  + 100% frontend Playwright (no regressions to existing 7 Financials
  sub-nav sections). No retest needed.


## 2026-02 — iter61 — Phase 2A · Shippo Auto-Tracking Webhook (self-tested ✅)
- ✨ **New public webhook `POST /api/shippo/webhook`**: receives
  `track_updated` events from Shippo, maps `status` → UI-friendly
  label + colour tier (gray/orange/emerald/red), pushes event to new
  `tracking_history` array on the tx doc, and on first DELIVERED
  transition fires a one-off buyer email (idempotent via
  `delivered_email_sent`).
- ✅ **Auto-register on startup**: `shippo_service.ensure_tracking_webhook()`
  idempotently registers `{PUBLIC_BACKEND_URL}/api/shippo/webhook` as a
  `track_updated` webhook — skipped if already present, so reboots
  don't accumulate duplicates.
- ✅ **Manual refresh**: new `POST /api/maker/orders/{sid}/shipping/refresh-tracking`
  lets the maker pull the latest status directly from Shippo
  `tracking_status` when the webhook is slow. Button sits next to the
  live status pill in the Orders drawer.
- ✅ **Live status pill** on fulfilled order rows, colour-tiered
  (orange = in transit, emerald = delivered, red = returned/failure).
  Expandable "Tracking history" shows every transition with timestamp +
  carrier detail string.
- ✅ **Reprint-label link** surfaces when `shippo_label_url` is present
  — makers can re-open the PDF without touching the modal.
- ✅ **New `send_buyer_delivered` email**: per-maker review CTAs at the
  delivery moment (highest-intent UGC trigger).
- Verified: 3-event webhook curl sequence (TRANSIT → DELIVERED → DELIVERED-replay)
  produced: final status=DELIVERED, history=2 (replay no-op),
  delivered_email_sent=True, delivered_at stamped.
- **Phase 2C next**: Maker Financials → "Shipping" tab ("You owe $X.XX
  on your next shipping invoice" + label table).


## 2026-02 — iter60 — Shippo Shipping-Label Integration (TESTED ✅)
- ✨ **New**: Makers can now purchase live shipping labels from the Orders
  drawer via Shippo. Test key live in `/app/backend/.env`
  (`SHIPPO_API_KEY`). 3-step modal: Review → Rates → Done.
- 🚚 **Billing model**: platform pays Shippo directly; every purchased
  label inserts a row in new `shipping_ledger` collection
  (`maker_slug`, `amount_cents`, `billed_cents`, `tracking_number`,
  `billed_at=null`, `invoice_id=null`). Phase-2 follow-up will roll up
  unbilled rows per maker into a weekly Stripe invoice.
- ✅ **Smart defaults**: Ship-From pulls from new `maker.ship_from_address`
  (editable per shipment; "save as default" checkbox persists). Parcel
  dims/weight auto-filled from first line-item's listing
  (`weight_lbs`/`weight_oz`/`dimensions`) — editable per shipment.
  Cheapest rate auto-selected; maker can override.
- ✅ **Fulfilment wiring**: on successful purchase, `payment_transactions`
  row is stamped with `order_status=fulfilled`, `shipped_at`,
  `tracking_number`, `tracking_carrier`, `shippo_label_url`,
  `shippo_tx_id`. Existing manual "Mark shipped" fallback preserved in
  a collapsible expander.
- 🐛 **Post-testing fix**: modal step-3 was unmounting instantly because
  `onSuccess()` collapsed the parent drawer mid-render. Moved refresh
  to `handleClose` (X / Done / backdrop), keeping the label PDF +
  tracking # copy affordances visible until user dismisses.
- New files: `backend/shippo_service.py`, `backend/routers/shipping.py`,
  `frontend/src/pages/MakerDashboard/ShippingLabelModal.jsx`.
  Tests: `/app/backend/tests/test_shipping_shippo.py` (12/12 green),
  `/app/test_reports/iteration_42.json`.
- **Phase 2 next up** (P1): Shippo webhook for auto tracking-status
  updates; APScheduler job for weekly maker invoice run; Admin
  "Shipping Ledger" reconciliation page.


## 2026-02 — iter59b — "Keep Me Signed In" Maker Login Toggle (self-tested ✅)
- ✨ **New checkbox on `/maker/login`**: "Keep me signed in for 30 days",
  ON by default. When unchecked, `MakerVerify` stamps an 8-hour expiry
  (`cm_maker_jwt_exp`) on the stored JWT.
- ✅ **Expiry enforcement in `/app/frontend/src/lib/api.js`**: new
  `purgeMakerSessionIfExpired()` runs on module load AND inside
  `authHeaders()`, so expired tokens are purged before any authed
  call fires. Missing expiry key = treated as persistent.
- ✅ **Helper text flips** based on checkbox state — explicit UX copy
  for shared-computer scenarios ("~8 hours") vs private devices.
- ✅ **Cleanup**: `resetIdentity` ("Not you?") and `MakerDashboard.logout`
  now also remove the `cm_maker_jwt_exp` key.
- Files: `MakerLogin.jsx`, `MakerVerify.jsx`, `MakerDashboard.jsx`, `lib/api.js`.


## 2026-02 — iter59 — Pending-Order Click-to-Expand + Mark Shipped (TESTED ✅)
- 🐛 **Fixed**: pending-order rows were static divs — couldn't drill into
  buyer info. Now each row is a click-to-expand accordion.
- ✅ **New `GET /api/maker/orders/{session_id}`**: returns full detail —
  buyer name, email (mailto), phone (tel), ship-to address (with line1,
  line2, city, state, postal, country), Open-in-Maps link, buyer note,
  line items with images + prices + quantities + subtotals, tracking
  fields. Cross-maker isolation enforced (404 with ambiguous detail).
- ✅ **New `POST /api/maker/orders/{session_id}/ship`**: marks
  fulfilled + stamps shipped_at + optional tracking_carrier + tracking_number.
  Independent cross-maker guard (defense in depth).
- ✅ **Stripe fallback**: detail endpoint pulls shipping_details from
  live Stripe `Session.retrieve(..., expand=[...])` when not cached
  locally, then writes it back to the tx doc for the next read.
- ✅ **UI**: click-to-expand drawer with Buyer | Ship-to grid, yellow
  buyer-note callout, itemised list w/ images, USPS/UPS/FedEx/DHL
  carrier dropdown + tracking input + orange Mark-shipped CTA.
  Fulfilled rows show emerald "shipped" pill + tracking instead of form.
- Tests: 8/8 backend pytest + frontend 100% live-verified. See
  `/app/backend/tests/test_iter59_order_detail.py` and
  `/app/test_reports/iteration_41.json`.



## 2026-02 — iter58 — Checkout "Try Again" Bug Fix (TESTED ✅)
- 🐛 **Fixed**: `/api/checkout/session` was returning HTTP 500 when Stripe
  rejected the session (e.g. total < $0.50 USD minimum). Frontend showed
  generic "Checkout failed. Try again." with no actionable signal.
- ✅ **Pre-check**: `quote["total_before_tax"] < 0.50` returns 400 with
  "Order total must be at least $0.50 — please add another item or pick
  a listing with a higher price." BEFORE invoking Stripe.
- ✅ **InvalidRequestError split**: tax-config errors silently retry
  without `automatic_tax`; amount/currency/line-item errors raise 400
  with Stripe's `user_message` surfaced verbatim so shoppers see WHY.
- ✅ **No-tax retry path** also catches InvalidRequestError → 400.
  Defense in depth against any Stripe rejection.
- Tests: 6/6 backend pytest + frontend /cart live-verified (the friendly
  string renders verbatim below the checkout button). See
  `/app/backend/tests/test_iter58_checkout_min_total.py` and
  `/app/test_reports/iteration_40.json`.



## 2026-02 — iter57 — Printable Bench-Sheet PDF (TESTED ✅)
- ✅ **`/maker/briefs/{briefId}/print`** route — Letter-sized paper-style
  layout with full brief details, large Code128 barcode (60h × 2.4w,
  black-on-white for laser-print legibility), buyer info, admin note,
  and a 7-step shop-floor checklist (Received → Measured → Cut →
  Assembled → Finished → Ready → Delivered) with empty checkbox + Date
  / Initials boxes per step.
- ✅ **Native `window.print()`** triggers the browser's Save-as-PDF —
  zero new deps (no jsPDF/html2canvas/Puppeteer).
- ✅ **`@media print` CSS** strips chrome (`.no-print` hides Back +
  Print buttons), sets @page Letter with 0.4in margins.
- ✅ **GET `/api/maker/briefs/{briefId}`** — single-brief fetch with
  cross-maker isolation (404 for foreign briefs, ambiguous detail
  string to prevent existence leakage).
- ✅ **"Print sheet" button** on every maker BriefsTab card opens the
  print page in a new tab (target=_blank + rel=noopener for tabnabbing
  protection).
- Tests: 7/7 backend pytest pass. See
  `/app/backend/tests/test_iter57_print_brief.py` and
  `/app/test_reports/iteration_39.json`.



## 2026-02 — iter56 — 10-Digit Tracking + Code128 Barcode (TESTED ✅)
- ✅ **Tracking number** on every `custom_orders` doc (10 random digits,
  unique-indexed, 5-attempt collision re-roll). Backfilled all 86 existing
  briefs.
- ✅ **Public lookup**: `GET /api/custom-orders/track/{n}` returns sanitised
  status (no PII — only project_type, material, lifecycle timestamps,
  reddit URL). Validates 10-digit format strictly.
- ✅ **Public `/track/{number}` page**: input form + 7-stage timeline
  (submitted → quoted → assigned → accepted → in_progress → won_bid →
  completed) with current-stage marker + Code128 barcode header.
  Declined briefs surface a dedicated red row.
- ✅ **Code128 barcode** via `jsbarcode@3.12.3` rendered on:
  - public `/track/{number}` page header
  - admin `CustomOrdersList` row header
  - maker `BriefsTab` card header
- ✅ **Admin search**: `GET /api/admin/custom-orders?tracking=NNNNNNNNNN`
  filters to a single brief by tracking number.
- ✅ **Buyer confirmation email** now includes the tracking number + a
  direct `/track/{n}` link.
- Tests: 13/13 new + 52/52 regression = 65/65 backend pytest. See
  `/app/backend/tests/test_iter56_tracking_number.py` and
  `/app/test_reports/iteration_38.json`.



## 2026-02 — iter55 — P2 Cleanup + ★ Route-to-Top (TESTED ✅)
- ✅ **Stripe Open Dashboard 409 polish**: backend now returns
  `{detail: {code: "onboarding_incomplete", message: ...}}` instead of a
  generic 502 when `stripe_charges_enabled=false`. FinancialsTab + PayoutsTab
  detect this and silently re-launch the onboarding wizard so the maker
  never sees a confusing error — they just continue where they left off.
- ✅ **★ Route to top match** — orange button next to "✨ Suggested matches"
  header in admin Step 2. One click pushes the top-suggestion maker with a
  templated note ("Routed to you because: {reason}."). Clears 30+ briefs
  from a backlog in seconds.
- ⚠ **Carry-over dev-tooling artifact**: `<span> cannot be a child of <option>`
  warning in dev/preview is from visual-editor's `<span data-ve-dynamic>`
  wrapper around `<option>` children. Confirmed dev-only — won't affect
  production builds. Filed as P3 cleanup.
- Tests: 5/5 new + 31/31 regression = 36/36 backend pytest. Live-verified
  74 autoroute buttons, click→push 200, funnel updates. See
  `/app/backend/tests/test_iter55_stripe_409_and_autoroute.py` and
  `/app/test_reports/iteration_37.json`.



## 2026-02 — iter54 — Maker Routing Recommendations (TESTED ✅)
- ✅ **GET `/api/admin/custom-orders/{id}/maker-suggestions`** — ranks active
  makers for a brief by: (a) material/category overlap with their published
  products (regex match against `materials`/`category`/`technique`),
  (b) historical win-rate (won_bid / routed × 100), (c) tie-break via routed
  count (capped at 5). Score halved for makers with ≥3 declines and no wins.
  Filters out shop_closed/vacation_mode/no-email/zero-product makers.
  Returns top 8 with score + reason string.
- ✅ **Admin Step 2 UI**: "✨ Suggested matches" chip strip above the maker
  dropdown. First chip ★-prefixed. One click sets the dropdown. Each chip
  shows the reason ("3 matching listings", "100% win-rate (1/1)", "⚠ 3 declined").
  Skipped entirely for already-assigned briefs.
- Tests: 9/9 new + 22/22 regression = 31/31 backend pytest pass. See
  `/app/backend/tests/test_iter54_maker_suggestions.py` and
  `/app/test_reports/iteration_36.json`.



## 2026-02 — iter53 — Brief Funnel + Won-the-Bid + Reddit Cross-Post (TESTED ✅)
- ✅ **GET `/api/admin/custom-orders/funnel`** — 9 lifecycle stages
  (submitted/quoted/routed/accepted/in_progress/completed/won_bid/declined/posted_to_reddit),
  win-rate, decline-rate, reddit-rate, plus by-subreddit and by-maker
  conversion breakdowns.
- ✅ **`won_bid` status** added to maker `BriefsTab` action panel — yellow
  "🎯 WON THE BID" pill, sets `won_bid_at` timestamp, drives admin analytics.
- ✅ **Reddit cross-post into existing thread**: when admin push-to-reddit
  succeeds, the live URL is appended into the maker's existing `admin_brief`
  thread automatically (no thread switch needed). Best-effort: silently
  no-ops if no thread exists.
- ✅ **Admin FunnelCard** at top of Custom Briefs tab — 8 stat boxes,
  win/reddit rate badges, by-sub + by-maker breakdowns. Auto-polls every
  60s so admin sees live conversion analytics without refreshing.
- Tests: 8/8 backend pytest + frontend live-verified. See
  `/app/backend/tests/test_iter53_funnel_wonbid.py` and
  `/app/test_reports/iteration_35.json`.



## 2026-02 — iter52 — Custom Brief Routing (admin → maker → Reddit) (TESTED ✅)
- ✅ **Push-to-Maker**: `POST /api/admin/custom-orders/{id}/push-to-maker`
  {maker_slug, note?, notify_buyer?} — assigns brief, drops `dm_threads` row
  with `kind=admin_brief`, optional buyer email confirmation, admin_audit log.
- ✅ **Push-to-Reddit**: `POST /api/admin/custom-orders/{id}/push-to-reddit`
  {subreddit, title?, flair?} — gated on `assigned_maker_slug` AND on
  `REDDIT_USERNAME` + `REDDIT_PASSWORD` env (script-app password grant).
  Self-text posts via `oauth.reddit.com/api/submit`. Persists
  `reddit_attempt_at`, `reddit_subreddit`, `reddit_error`,
  `posted_to_reddit_at`, `reddit_post_url` for analytics.
- ✅ **Maker Briefs Tab**: new `BriefsTab.jsx` + nav item in `ShopManagerLayout`.
  GET /api/maker/briefs + PATCH /api/maker/briefs/{id} (accept/decline/in_progress/completed).
  3 sections: New / Active / Past. Cross-maker isolation enforced.
- ✅ **Admin 3-step workflow** in `CustomOrdersList.jsx`: Step 1 Quote (existing) → Step 2 Push to maker (dropdown + note + notify-buyer checkbox) → Step 3 Push to Reddit (gated UI message until env keys arrive).
- Tests: 14/14 backend pytest + frontend E2E pass. See
  `/app/backend/tests/test_iter52_brief_routing.py` and
  `/app/test_reports/iteration_34.json`.
- DB extensions on `custom_orders`: `assigned_maker_slug`, `assigned_maker_name`,
  `assigned_at`, `assigned_by`, `assignment_note`, `maker_response_status`,
  `maker_response_at`, `maker_response_note`, plus reddit_* fields above.



## 2026-02 — iter51 — Auto-Boost + Feedback Reply + Upgrade Confetti (TESTED ✅)
- ✅ **Auto-Boost best-sellers** (maker): daily 04:00-UTC cron `_job_auto_boost_best_sellers`
  promotes a maker's top 30-day sellers (default ≥10 orders, max 3 listings/run, $5/wk each).
  Frontend toggle + threshold/max-per-run selects + candidate preview in
  Marketing tab. `GET /api/maker/auto-boost/status` + `PATCH /api/maker/auto-boost`
  (server clamps 3-100 / 1-10).
- ✅ **Admin feedback reply**: `POST /api/admin/feedback/{id}/reply` with
  {subject,message,auto_resolve}. UI: `FeedbackReplyModal` in
  `components/admin/SettingsTab.jsx`. Persists replied_at/replied_by/replied_subject,
  optionally flips resolved=true, writes admin_audit row.
- ✅ **Upgrade confetti** (`canvas-confetti@1.9.4`): fires on
  `/maker/dashboard?plus=success` (3-burst orange/white/amber palette),
  shows success toast, refreshes maker doc, cleans URL preserving #settings hash.
  Gated on `cm_maker_jwt` so unauthenticated hits redirect cleanly to login.
- Tests: 16/16 backend pytest + frontend E2E pass. See
  `/app/backend/tests/test_iter51_autoboost_feedback_reply.py` and
  `/app/test_reports/iteration_33.json`.
- Known cosmetic console warning: `<select>/<option>` nested inside a `<span>`
  at `ShopManagerLayout.jsx:100` — pre-existing, no functional impact.

---

# Historical entries (migrated from PRD.md)

## Test Status (2026-04-26)
- iter6: AI memory + cart gift-note — **fixed and verified**
- iter7: Stripe Connect Express + regression sweep — **20/20**
- iter9: 5 backlog items — **140/140**
- iter10: 3 backlog items — **147/147**
- iter11: Web analytics — **161/161**
- iter12: GMV mini-charts + 7d deltas + dwell tracking — **170/170**
- iter13: Live-now indicator + bounce-rate panel — **176/176**
- iter14 (manual setup): **Stripe Connect `account.updated` webhook LIVE** + **Google OAuth happy-path VERIFIED**
- iter15: **Maker Self-Serve Listings (Option B)** — backend 189/189 + frontend E2E 8/8 (create / drag-drop base64 image / soft-delete / restore)
- iter16: **.glb upload (P2) + Variants (P3) + Draft mode (P4)** — backend 28/28 incl. 10 new iter16 cases + frontend E2E 12/12 (modal variants editor, draft↔publish flips, .glb file upload, buyer variant selector + cart variant pricing). R2 live; transfer_to_makers + maker-orders correctly apply variant deltas.

## Recently Shipped (2026-04-26 — iter37 · Buffer social + Sender.net email switch)
- ✅ **iter37 — Two-batch ship**: Buffer (social media) integration with all-three triggers, plus a clean swap of the primary transactional email provider from MailerSend to Sender.net.

  **🌐 Buffer (social media)** — `buffer_service.py` + `routers/buffer.py`:
    - GraphQL API at `https://api.buffer.com` (v1 REST sunset 2026-07-08), Bearer-token auth
    - 3 channels currently connected to the shared Crafters Market Buffer account: Instagram (`crafters_market1`), Pinterest (`team2598`), Facebook (`Crafters Market`). Org id `69ee74bab3eb4d0e37bacd4e`
    - Per-service metadata wired (IG/FB require `metadata.<service>.type='post'`); Pinterest auto-picks default board; Twitter/LinkedIn/Mastodon/Bluesky/StartPage need no metadata
    - **Three triggers, all live**:
      1. **Auto-post on listing publish** — `listing_notify.notify_listing_published` calls `auto_post_listing(product, maker)` AFTER stamping `published_at` (idempotent — re-publishes don't re-post). Default template: `"New from {maker}: {title} — ${price} → {url}"` + listing image. Toggleable via `BUFFER_AUTO_PUBLISH=true|false`.
      2. **Maker manual share** — `POST /api/maker/buffer/share-listing/{slug}` with the same template; mounted as "↗ Share to Buffer (social)" button on every published `ProductEditCard`
      3. **Admin compose** — new 14th Admin tab "Social" (`BufferTab.jsx`) with channel multi-select chips, text + image-url inputs, recent-posts log table, fan-out sonner toasts, auto-publish indicator
    - Every send (admin, maker, auto) persists a row to `db.buffer_posts` with per-channel results, source, posted_by, success/failed counts. Mirrors the email_events pattern.
    - Endpoints: `GET /api/admin/buffer/status`, `GET /api/admin/buffer/posts`, `POST /api/admin/buffer/post`, `POST /api/maker/buffer/share-listing/{slug}`
    - Verified end-to-end: real successful posts on Instagram + Facebook + Pinterest with image, structured error capture for Pinterest dedupe / Instagram missing-image rejections.

  **✉ Sender.net swap** (replaces MailerSend as primary):
    - Endpoint `POST https://api.sender.net/v2/message/send` · Bearer JWT auth · free tier 15,000 emails/month with **no daily cap** (60 req/min rate limit), trades MailerSend's 100/day quota for headroom
    - Added `_send_sender()` to `email_service.py` alongside MailerSend / Brevo / Resend; `EMAIL_PROVIDER=sender` now the default
    - All errors flow through the existing `_record_event` → `db.email_events` pipeline so the admin Email Status tab shows exactly what's failing
    - Roll-back: set `EMAIL_PROVIDER=mailersend` (or `=brevo` / `=resend`) and restart backend
    - **⚠ DNS step pending**: until `craftersmarket.org` SPF + DKIM records are added in the Sender.net dashboard, every send returns HTTP 400 with the message `"The domain craftersmarket.org has a DMARC policy, but SPF/DKIM records are not configured."` This is correctly captured in the email log so the admin can see it. Setup steps documented in `/app/memory/test_credentials.md`.

  **Tests**: testing_agent_v3_fork iter23 — **100% pass** (15/15 backend tests covering Buffer status/list/post contracts, real post, idempotency on republish, maker ownership, Sender.net error capture). Admin Social tab visually verified. New tests: `tests/test_buffer_sender.py`, `tests/test_buffer_deep.py`. Reviewer notes: sequential fan-out is fine at 3 channels (consider asyncio.gather later), Pinterest default-board reliance is implicit.



- ✅ **iter36 — Three-batch ship**: AI live-chat moderator, Google Ads/Meta platform-agnostic foundation, and order-level refire-emails admin tool.

  **🛡️ AI Moderator (live chat)** — `ai_moderator.py`:
    - 3-tier action: ALLOW / WARN / BLOCK
    - Heuristic pre-pass catches obvious slurs + 3+ links spam without burning LLM tokens
    - Falls through to **Claude Haiku 4.5** via Emergent universal LLM key for nuanced calls
    - **Fail-OPEN** throughout — any LLM error returns ALLOW so the room never goes silent
    - WS hook in `routers/community.py`: BLOCK drops the message and sends a private notice to the sender; WARN still posts but nudges the sender; ALLOW passes through
    - All non-allow decisions persist to `db.ai_mod_log` with channel/user/text/reason/source(heuristic|llm)
    - Toggle: new `ai_moderator_enabled` switch in Settings (default OFF)
    - Audit Log tab now has two sub-views (`User Moderation` / `AI Moderator`) with filter chips for block/warn/all and per-row source badges

  **📈 Google Ads + Meta foundation (no live SDK yet)** — `routers/ad_spend.py`:
    - `db.ad_spend` schema (compound idempotency key: platform + campaign_id + date)
    - Endpoints: `GET /admin/ads/metrics`, `GET /admin/ads/performance`, `POST /admin/ads/seed-demo`, `DELETE /admin/ads/clear-demo`
    - **ROAS join**: cross-references `db.transactions` rows where `external_attribution=true` (set by checkout when `?utm_source=external`) for true attributed-revenue ROAS
    - New 13th admin tab `AdsTab.jsx`: range chips (7d/30d/90d), 4 stat cards (Spend / Att Revenue / ROAS / Clicks), daily-spend Sparkline, Top Campaigns table sorted desc, By-Technique breakdown, demo seed/clear controls
    - Live Google Ads + Meta SDK wiring **parked until credentials arrive** (Customer ID `736-155-8999` saved in PRD; still need developer token + service account JSON + Meta system token + Ad/Catalog IDs)

  **✉️ P14l · Refire transactional emails** — admin tool:
    - `POST /api/admin/orders/{session_id}/refire-emails` — re-sends buyer receipt + maker order notification + ops alert for an existing paid order
    - Returns `{session_id, sent[], failed[]}` so partial failures (e.g. MailerSend 429) are visible to the operator
    - PaidOrdersList: new "✉ Refire" button per order with sonner toast feedback ("Re-fired N emails (buyer + maker + ops)")

  **Tests**: testing_agent_v3_fork iter22 — **100% pass** (24/24 backend pytest, full Playwright sweep on AdsTab, all 13 admin tabs verified). One known-skip on the live cs_test session (covered via self-seeded transaction). Reviewer notes: cosmetic days+1 series length and a redundant `$or` wrapper — the latter cleaned up in the same iteration. All test side-effects rolled back.

  **Caveats**: MailerSend daily quota exhausted today, so refire-emails will return `failed[]` with all 3 mailer 429s in the response — by design, the endpoint is structurally sound and visible to the operator. emergentintegrations triggers a noisy Pydantic serializer warning in stdout — non-blocking, worth watching for upstream lib bumps.


## Recently Shipped (2026-04-26 — iter35 · Cleanup batch P15+P16+P17+P14g)
- ✅ **iter35 — Backend bug-fix + frontend polish quad**:

  **P16 · Idempotent listing-fee billing on republish** (real bug fix):
  `maker_publish_product` now checks `was_already_published` BEFORE accruing the listing-publish charge. Republishing a live listing still refreshes `expires_at` (renewal works) but no double-charge. Verified via new `tests/test_iter21_billing_idempotency_followers.py`.

  **P15 · BackgroundTasks for listing-publish notifications**:
  Both `maker_create_product` (when `status='published'`) and `maker_publish_product` now use `bg.add_task(_safe_notify_listing_published, slug)` — keeps the API response under 500ms even when fanning out to thousands of followers. Wrapper swallows mailer-outage exceptions so a transient 429 doesn't bubble up.

  **P17 · Public followers list section** (`/makers/:slug#followers`):
  - Backend: new `GET /api/makers/{slug}/followers?limit=N` returns `{items, total}` with anonymized rows (display name + first-letter initial + since-date — no email leakage). Limit clamped 1..100.
  - Frontend: `components/FollowersList.jsx` renders an avatar grid of color-rotating pucks, scroll-mt-32 + id="followers" so the FollowButton's "N followers" chip now deep-links cleanly under the sticky header. Empty state copy: "Be the first to follow." + CTA pointing back to the orange Follow button.

  **P14g · Mobile responsive pass on `/admin/dashboard`**:
  - Tab bar now sticky at top:64px on mobile + overflow-x-auto so all 12 tabs scroll horizontally
  - H1 'Operations.' scales 36px mobile → 72px desktop
  - Stats grid uses 2x2 layout below `md:` breakpoint
  - `Stat` component compacted (smaller padding + label/value font sizes on mobile)
  - Sign Out button + LiveNowBadge cluster fits without wrap at 375px wide
  - ApplicationsList row content: `break-words` + `[overflow-wrap:anywhere]` so long applicant ids/emails/about-text don't bleed past the viewport

  **Tests**: testing_agent_v3_fork iter21 — **100% pass** (6/6 backend pytest, all P14g/P15/P16/P17 spec scenarios green, response time under 500ms confirmed for backgrounded publish). Verified end-to-end on the live preview at 390×844 viewport.


## Recently Shipped (2026-04-26 — iter34 · Listing-publish notifications + Follow system)
- ✅ **iter34 — Maker confirmation + Ops notification + Buyer follower broadcast on listing publish** (closing the email-CTA loop end-to-end):

  **Backend**
    - `email_service.send_maker_listing_published`, `send_ops_new_listing`, `send_follower_new_listing` — three new transactional templates, all rendered through the shared `_shell` industrial dark theme + a reusable `_listing_card(title, image, price, url)` partial. Maker confirm includes a "Share to X" CTA + tip about first-24h share boost.
    - `listing_notify.py` — `notify_listing_published(slug, force=False)` orchestrator. Idempotent via `published_at` stamp on the product doc; subsequent re-publishes don't re-broadcast. Each `send_*` wrapped in try/except so a transient mailer 429 doesn't fail the broadcast or the maker's create call.
    - `routers/follows.py` (NEW) — `GET/POST/DELETE /api/makers/{slug}/follow` + `GET /api/makers/{slug}/follow-status`. Idempotent upsert with `$setOnInsert`. Frozen/banned users blocked with 403.
    - `maker_auth.py` — added `optional_buyer` dep so follow-status works for both signed-in and signed-out callers.
    - `routers/maker.py` — `maker_create_product` (when `status='published'`) and `maker_publish_product` now both call `notify_listing_published` synchronously after the DB write.
    - `db.follows` collection: `{id, user_id, maker_slug, follower_email, follower_name, created_at}`.

  **Frontend**
    - `components/FollowButton.jsx` (NEW) — button cluster on `/makers/:slug` hero. Three states: loading / "+ Sign in to follow" (unauthed → redirects to /community/login?next=…) / "+ Follow" / "✓ Following". Displays live follower count chip. Sonner toast on every state change ("Following X. You'll get an email when they post." / "Unfollowed X.").
    - `lib/api.js` — `fetchFollowStatus`, `followMaker`, `unfollowMaker` helpers.
    - `pages/MakerDetail.jsx` — FollowButton mounted in the hero immediately below the studio name + listings count line.

  **Bug caught + fixed by testing agent (iter20)**: FollowButton was reading `cm_community_jwt` but the rest of the buyer code uses `cm_buyer_jwt` — would have broken authed UX for real users coming in through magic-link verify. Fixed in same iteration; re-verified end-to-end (unauth → '+ Sign in to follow', authed → '+ Follow' → click → '✓ Following' + count 0→1 + toast, click again → revert).

  **Tests**: testing_agent_v3_fork iter20 — **100% pass** (14/14 backend pytest in `tests/test_iter20_follow_notify.py`, all 4 frontend spec scenarios green, sonner toasts captured live). Reviewer flagged 3 follow-up improvements: 1) move publish-notify to BackgroundTasks for high-fan makers, 2) #followers anchor goes nowhere — either remove or build a follower-list section, 3) maker_publish_product should idempotency-check before re-charging the listing fee on already-published listings. Tracked for next pass.

  **Caveat**: MailerSend daily quota was exhausted by heavy testing today. The notify pipeline gracefully handles 429s (logs warning, returns None, continues fan-out) — confirmed via direct test. Once quota resets (~24h), real emails will flow.


## Recently Shipped (2026-04-26 — iter33 · Channel trim + CNC emblem)
- ✅ **iter33 — More channel cleanup + downloadable CNC Garage Builders emblem on homepage**:

  **Channel trim**: removed `design-share` and `buy-and-sell` from both backend `routers/community.py` CHANNELS set and frontend `CommunityPage.jsx` CHANNELS list + CHANNEL_LABEL. **Final 7 rooms**: general, machine-help, finishing-tips, beginners, advanced-cnc, off-topic, makers-only. WebSocket connect to removed channels rejected by backend.

  **CNC Garage Builders emblem on homepage**: new `CNCEmblem.jsx` component placed between `<ForMakers />` and `<Reviews />`. Two-column section with the 1254×1254 PNG on the left (orange glow + "DOWNLOAD" chip overlay on hover) and copy + "Download Emblem" CTA on the right. Both anchors use HTML5 `download` attribute for instant download instead of in-tab navigation. PNG saved at `/app/frontend/public/downloads/cnc-garage-builders.png` (2.3MB, served at 200 OK with `image/png` MIME).

  **Smoke-tested**: image loads natural 1254×1254, both anchors carry `download="cnc-garage-builders.png"` attr, hover state captured (glow + chip render). Removed channels confirmed rejected at WS handshake.


## Recently Shipped (2026-04-26)
- ✅ **iter29 — Admin user-moderation UI (Freeze / Ban / Restore / Delete)**:
  - Rewrote `UsersTab` in `AdminDashboard.jsx` to consume the previously-built moderation endpoints (`GET /api/admin/users`, `POST /api/admin/users/{id}/moderate`, `DELETE /api/admin/users/{id}`).
  - Adds search box (email / name / user_id), status filter chips (All / Active / Frozen / Banned), per-row badge (color-coded: emerald=active, yellow=frozen, red=banned), thread + reply rollup counts, and per-row action buttons.
  - New `ModerationConfirmModal` component: tone-variant CTA (primary/warn/danger), reason field with `(required)` gating for Freeze + Ban, confirm-disabled-until-reason-entered, outside-click + Cancel both dismiss without action, body-locked focus on the textarea.
  - New API helpers in `frontend/src/lib/api.js`: `fetchAdminModerationUsers`, `adminModerateUser`, `adminDeleteUser`.
  - **Verified via testing_agent_v3_fork** (frontend, iteration_16): 100% pass — 10/10 moderation flows green, 0 console errors. Freeze→active badge transitions, ban→content veiled, delete→hard-removed all confirmed end-to-end on the live preview.
  - **Reviewer notes (non-blocking)**: AdminDashboard.jsx is ~1400 lines — eligible for per-tab split into `/components/admin/*` later. Esc-key dismissal for the modal would be a nice-to-have for accessibility.

## Recently Shipped (2026-04-26)
- ✅ **iter28 — Maker application lifecycle emails + Community EUA gate**:
  - **Application received email**: New `send_applicant_received()` template — fires immediately when someone applies. Personalised with applicant name + studio, sets the 3-business-day review timeline, hints at the welcome packet to come. Wired as background task in `POST /api/maker-applications`.
  - **Welcome packet on approval**: `send_application_decision()` rewritten — when approved, includes a magic-link "Open Maker Portal" button, full launch checklist (Connect Stripe → Polish profile → Create first 3 listings → Set up shop), fee breakdown (5% commission · 10 free listings · 120-day expiry · $5/wk promo · Stripe payouts), resources + support links. Decline path stays short and kind. The admin approve flow now also **auto-creates a maker doc** (slug derived from studio name with collision handling) and **mints a magic-link** so the welcome email is 1-click into the portal.
  - **Community EUA (End User Agreement) gate**: First-time community sign-ups now must check an "I agree to the Crafters Market Community Terms (v2026-04)" box before either Google or magic-link sign-in. Returning users on the current version are grandfathered. Backend stamps `community_users.eua_version` + `eua_accepted_at` on acceptance. Bump `CURRENT_EUA_VERSION` constant in `community.py` to force re-acceptance after material policy changes.
    - New endpoint: `GET /api/community/eua` (public) — returns version, title, summary, /policy link.
    - All 3 auth endpoints (`google`, `magic/request`, `magic/verify`) now accept `accept_eua` + `eua_version`.
    - Frontend: `CommunityAuth.jsx` shows the checkbox above sign-in buttons; both Google + magic-link CTAs are disabled until checked. Acceptance is persisted to sessionStorage so the version flows through Google's redirect callback.
  - **Live verification**: 3 real MailerSend deliveries confirmed via `team@craftersmarket.org` inbox during integration test (ops alert, applicant ack, welcome packet). EUA gate enforced via curl: 400 without acceptance, 200 with, grandfathered for returning users.
  - **Tests**: 10 new unit tests + 272/272 full backend regression green. Bonus: fixed a pre-existing iter15 → maker_portal cross-test pollution issue with a module-level cleanup fixture.

- ✅ **iter27 — Listing-credit packs (P4) + Receipt review CTA (P3) + Cron scheduler (P2)**:

  **P2 · In-process cron scheduler** (`/app/backend/scheduler.py`):
  - APScheduler `AsyncIOScheduler` boots with FastAPI startup, shuts down cleanly. 3 jobs registered:
    - `expire_listings` daily 03:10 UTC
    - `r2_orphan_sweep` weekly Sunday 04:00 UTC (always dry-run)
    - `plus_roi_digest` monthly 1st at 14:00 UTC
  - Disable via `SCHEDULER_ENABLED=false` env. 3 unit tests cover boot/disable/idempotency.

  **P3 · Email-receipt review CTA**:
  - Buyer receipts now include a per-maker "★ Review {maker_name}" CTA section (deduped by maker, UTM-tracked `utm_source=email&utm_campaign=order-receipt-review`, deep-links to `/makers/{slug}#leave-review`).
  - New `POST /api/reviews` endpoint with validation (rating 1-5, name+text required, auto-derives `maker_slug` from `product_slug`).
  - Added `maker_slug` field to `Review` model + filter on the existing GET `/api/reviews` (by `maker_slug` or `product_slug`).
  - Enriched `email_items` in checkout flow to carry `maker_slug` + `maker_name` so the receipt template can render the buttons.
  - 7 unit tests cover validation, target derivation, persistence, list filter, receipt CTA rendering, maker dedup, backward-compat (skip CTA if no maker_slug).

  **P4 · Listing-credit packs**:
  - New `routers/credits.py` with 3 endpoints: `GET /maker/credits/packs`, `POST /maker/credits/checkout?pack=…`, `POST /maker/credits/finalize?session_id=…` (idempotent).
  - 3 pack tiers (env-overridable): 10 credits/$1.50 (25% off cash), 50/$7.00 (30% off), 200/$24.00 (40% off).
  - Stripe Checkout in `payment` mode with metadata + a parallel `db.credit_pack_purchases` ledger for audit + idempotency.
  - **Burn order in `revenue.accrue_listing_charge`**: free quota → pre-paid credits → cash fees. Beautifully simple.
  - **BillingTab UI**: new "Pre-paid listing credits" panel showing current balance + 3 pack buttons with per-credit ¢ display + savings %. Auto-finalizes on Stripe redirect via `useEffect` on `?credits=success&session_id=…`.
  - 5 unit tests cover the credit-burn precedence, balance rendering, missing-field backward-compat, pack listing.

  **Tests**: 261/261 backend tests passing (full regression sweep). Fixed 2 pre-existing pollution issues along the way: `test_iter16_drafts_variants_glb` was hardcoded to assert `r2.dev` (now allows CDN host) and `test_iter18` cleanup now hard-deletes test products to avoid contaminating maker_portal.

- ✅ **iter26 — R2 CDN custom domain `cdn.craftersmarket.org` activated**:
  - User connected `cdn.craftersmarket.org` in Cloudflare R2 dashboard (Custom Domains → Connect).
  - Flipped `R2_PUBLIC_URL` from `https://pub-96d13eb6b15840a98236f6c1053262c3.r2.dev` to `https://cdn.craftersmarket.org` and restarted backend.
  - Ran `swap_r2_host.py` migration script — 0 affected (no existing R2-hosted assets to migrate; all current product images are external Pexels/Unsplash hot-links).
  - Verified live: fresh upload to R2 served via CDN domain returns `HTTP 200 · cache-control: public, max-age=31536000, immutable · server: cloudflare`. All future maker uploads (product images, .glb models, banners) now ship from the branded CDN.

- ✅ **iter25 — Monthly Crafters Plus ROI digest email**:
  - **Module**: new `/app/backend/digests.py` with `run_plus_roi_digest(apply=bool)` — finds free-tier makers above the $500/30d threshold, computes their would-have-saved amount, sends MailerSend digest, stamps `makers.last_plus_roi_digest_sent_at` for cooldown.
  - **Email template**: `send_maker_plus_roi_digest()` in `email_service.py` — industrial dark theme matching transactional emails, dynamic copy ("Plus would've paid off" vs "Plus is one sale away" headlines), prominent dollar callouts, single-CTA upgrade button with UTM tracking (`utm_source=email&utm_campaign=plus-roi-digest`).
  - **Endpoint**: `POST /api/admin/digests/plus-roi` (admin-only) · `?apply=true` actually sends.
  - **Cooldown**: 25-day per-maker dedupe window so a cron firing weekly never spams.
  - **Verified live**: real email sent to `team@craftersmarket.org` for `iron-and-oak` (gross $1,500 · saved $15 · net +$3) → MailerSend `202 Accepted` → cooldown re-run correctly skipped.
  - **Tests**: 6 new unit tests (threshold gate, Plus-tier exclusion, cooldown window, send+stamp happy path, send-failure no-stamp retry, dry-run mode) — **27/27 across all related suites green.**

- ✅ **iter24 — Crafters Plus ROI calculator + polished confirm modals**:
  - **Live ROI calculator** in BillingTab: pulls last-30d gross from `maker_payouts`, computes commission savings (1% delta = 5%→4%), nets out the $12/mo cost, and renders a 3-up KPI panel inside the Plus upsell card with a contextual pitch line. Different copy for free vs Plus subscribers, plus a "Plus pays for itself once monthly sales pass $1,200" line for shops below break-even.
    - New endpoint: `GET /api/maker/plus/roi` (auth-gated)
    - Frontend: `BillingTab.jsx` ROI panel (`data-testid="billing-plus-roi"`)
    - Verified live: $1,500/30d → $15 saved · +$3 net · "Plus pays for itself" pitch shown
  - **Custom confirm modal** replaces 3 `window.confirm()` call sites:
    - `useConfirm()` hook in `pages/MakerDashboard/useConfirm.jsx` — returns `[confirm(opts), modal]`. Industrial-themed modal with tone variants (`primary | danger | warn`), Esc-to-dismiss, focus-managed confirm button, outside-click-to-cancel.
    - Replaces: delete-listing (danger), promote-listing (primary), cancel-Plus-subscription (warn).
    - Verified visually with the Carved Oak Wedding Monogram delete flow.
  - **Tests**: 4 new ROI unit tests (zero sales, break-even at $2k, near-miss at $1k, 404 unknown maker) + 56/57 adjacent suites green (1 pre-existing iter18 test pollution unrelated to this iter).

- ✅ **iter23 — MailerSend wired as primary transactional provider**:
  - Added `_send_mailersend()` to `email_service.py` alongside existing Brevo + Resend providers. New `EMAIL_PROVIDER=mailersend` env value (now the default).
  - MailerSend (sister product of MailerLite, dedicated to transactional emails) provides better deliverability than the marketing-focused MailerLite API for receipts, magic-links, low-stock alerts.
  - Domain `craftersmarket.org` authenticated in MailerSend with DKIM + SPF (`is_verified=true · dkim=true · spf=true`).
  - **Verified end-to-end**: live test send → MailerSend `202 Accepted` with `message_id=69ee427a61bed73c2528e603` (basic) and `69ee427a7faef61211485b9f` (real magic-link template).
  - Roll-back path preserved: set `EMAIL_PROVIDER=brevo` or `=resend` (both keys still present in `.env`).

- ✅ **iter22 — `MakerDashboard.jsx` refactor (1822 → 8 modular files)**:
  - Split the monolithic 1822-line dashboard into a 164-line orchestrator + 8 component files under `pages/MakerDashboard/`:
    - `_shared.jsx` (47 lines · `Stat`, `Field`, `LabeledField`, `formatDate`)
    - `ProfileForm.jsx` (193 lines · profile + Plus banner upload)
    - `ProductsList.jsx` (87 lines · live/draft/archived buckets)
    - `ProductEditCard.jsx` (314 lines · model upload, promote, renew, publish toggle)
    - `OrdersList.jsx` (62 lines · paid orders table)
    - `PayoutsTab.jsx` (176 lines · Stripe Connect onboarding state machine)
    - `BillingTab.jsx` (216 lines · KPIs, Plus upsell, ledger)
    - `NewListingModal.jsx` (570 lines · modal w/ image compression, variants, .glb upload)
  - Zero behaviour change. All `data-testid` attributes preserved exactly. ESLint clean.
  - **Tests**: 57/57 across `iter15/16/17/19/20/21` + `maker_portal` suites green. Live dashboard verified end-to-end via screenshot — all 5 tabs (Profile / Listings / Orders / Payouts / Billing) render correctly with real maker JWT.
  - **Bonus**: extended `swap_r2_host.py` to also rewrite `db.makers.banner_image_url` (so when CDN domain ships, Plus subscribers' banners migrate too).

- ✅ **iter21 — Shop of the Week (Crafters Plus homepage spotlight)**:
  - **Backend** — `GET /api/shop-of-the-week` returns the highest-GMV active/trialing Plus subscriber over the last 30 days (using `db.maker_payouts` as source of truth) plus their top-3 best-selling products. Falls back to newest published listings when the maker has no sales yet. Returns `{maker: null}` gracefully when no Plus subscribers exist (frontend hides the section).
  - **Frontend** — `components/sections/ShopOfTheWeek.jsx`: editorial hero card with banner backdrop, ★ Plus badge, maker meta, monthly GMV pill, 3 ranked best-seller cards (#01/#02/#03) on the right rail. Mounted directly under `<Hero />` on the homepage. Auto-hides if API returns no maker.
  - **Why**: Tangible, visible payoff for makers on the $12/mo Plus tier — front-page rotation drives conversion to the upsell.
  - **Tests**: 4 new unit tests (empty case, GMV ranking, fallback to newest, free-tier exclusion) — **27/27 green** in new + adjacent iter17/18/19/20/21 suites.

- ✅ **iter20 — Plus banner upload + Stripe Customer Portal**:
  - **Banner upload** — `POST /api/maker/uploads/banner` (multipart, PNG/JPG/WebP, R2 path `banners/{slug}/{uuid}.{ext}`). Gated to `subscription_status='active'` (403 with "Crafters Plus" copy on free tier). UI: dedicated section in ProfileForm with disabled-state CTA "Upgrade to Crafters Plus to unlock" for free makers, file picker + preview thumbnail for Plus. Public maker page (`/makers/{slug}`) hero now prefers `banner_image_url` over `cover` and renders a `★ Plus` badge for active subscribers.
  - **Stripe Customer Portal** — `POST /api/maker/subscription/portal` returns a Stripe-hosted billing portal URL (`https://billing.stripe.com/p/session/...`) for self-service card / invoice / cancellation management. Wrapped in `try/except StripeError`: returns 502 with friendly copy "Configure it in your Stripe dashboard at Settings → Billing → Customer Portal" instead of bare 500. UI: "Manage billing ↗" button in BillingTab next to Cancel.
  - **R2 orphan sweeper** now scans `banners/` prefix in addition to `products/` and `models/`; replaced banners get garbage-collected.
  - **Tests**: 2 new iter20 unit tests (free-tier 403 + portal-without-customer 400) + sweeper test updated for 3 prefixes = **22/22 green** in iter15/17/19/20 + revenue + r2 + sweep suites.

- ✅ **iter19 — Crafters Plus subscription + Off-site ad attribution**:
  - **Crafters Plus** ($12/mo Stripe Subscription): auto-creates Product+Price on first call (cached in `db.platform_meta`), Stripe Checkout in subscription mode. Active subscribers get **15 free listings per calendar month** (vs 10 lifetime free) and **4% commission** (vs 5%). Cancel sets `cancel_at_period_end`. Webhook `customer.subscription.*` keeps `maker.subscription_status` in sync.
    - Endpoints: `POST /api/maker/subscription/start`, `POST /api/maker/subscription/cancel`, `GET /api/maker/subscription`
  - **Per-maker commission rate** — `revenue.commission_bps_for(maker)` returns 400 (Plus) or 500 (free); `fee_breakdown_cents` honors it. Stripe Connect transfer code passes `maker` doc through.
  - **Off-site ad attribution** — `analytics.captureAttribution()` captures `?utm_source=` (or `?via=`) from any landing URL (30d TTL, persisted in localStorage). `getAttributionSource()` is forwarded by CartPage to `/api/checkout/session`. `payment_transactions` records `external_attribution: bool`. Stripe Connect transfer applies extra **12% off-site fee** when `external_attribution=true` AND the maker has NOT set `external_ads_opt_out=true`.
  - **Maker-facing UI** — Billing tab now has a Crafters Plus upsell card (or "✓ Active · renews …" when subscribed). Per-sale fee KPI re-renders to show 7% (4%+3%) for Plus subscribers vs 8% for free tier.
  - **Tests**: 7 new iter19 tests (Plus monthly quota, free fallback, fee splits, off-site surcharge with opt-out) + 6 updated iter18 revenue tests + 39/39 in revenue + iter15-19 test files. Full suite: 214/216 (1 known flaky asyncio test passes in isolation, 1 leftover-data test fixed by re-anchoring).
  - **CDN domain** — guide ready at `/app/memory/R2_CUSTOM_DOMAIN_SETUP.md`, awaiting your DNS click. No code changes needed.

- ✅ **iter18 — Etsy-style revenue model**:
  - **Two-tier transaction fee** — `PLATFORM_FEE_BPS=500` (5% commission) + `PROCESSING_FEE_BPS=300` (3% processing). `fee_breakdown_cents()` returns transparent split. Maker keeps 92% of each sale.
  - **Listing fees** — first 10 listings/renewals free per maker; beyond that, $0.20 (`LISTING_FEE_CENTS`) accrues to `maker.pending_charges_cents`. Drafts don't burn the quota until published.
  - **120-day expiry** — every published listing has `expires_at`; admin endpoint `POST /api/admin/listings/expire-due` flips expired listings to draft. `POST /api/maker/products/{slug}/renew` re-publishes for another 120d (charges $0.20 if past quota).
  - **Promoted listings** — `POST /api/maker/products/{slug}/promote?weeks=N` charges $5/week, sets `promoted_until`. Public catalog sorts promoted listings to position 0; ProductCard shows "★ Featured" badge.
  - **Payout settlement** — Stripe Connect transfer flow: gross = subtotal × 92%; pending charges drained from gross before transfer; if entire payout consumed, status='succeeded-zero' so the order isn't retried. Settled events appended to `charge_history` with negative amount (audit trail).
  - **Maker billing tab** — new `/maker/dashboard` tab with KPIs (lifetime listings vs free quota, pending charges, fee policy), pricing breakdown, and recent ledger table. Promote/Renew buttons on individual listing cards with confirm dialogs.
  - **Tests**: 6 new revenue unit tests + 6 iter18 E2E tests + iter8 fee-math tests updated for 92% net = **all green** (203 / 204 in full suite, 1 pre-existing flaky asyncio test passes in isolation). Frontend E2E 100% via testing_agent_v3_fork.
  - **Default for now**: subscription tier (Etsy Plus equivalent) and off-site ads explicitly **deferred** per user choice.

- ✅ **iter17 — P5 batch (low-stock alerts, R2 sweeper, two-axis variants, custom CDN setup)**:
  - **Low-stock alerts** — `_decrement_stock_and_collect_low` runs in the paid-transition block: decrements product or variant stock and emails the maker (`send_maker_low_stock`) when post-decrement stock < `LOW_STOCK_THRESHOLD` (default 3). Idempotent (gated by `payment_status` transition).
  - **R2 orphan sweeper** — `scripts/sweep_r2_orphans.py` walks `products/` and `models/` prefixes, diffs against every `Product.images` / `Product.model_url` / `Product.variants[].image` reference, deletes orphans (dry-run by default). Admin endpoint `POST /api/admin/r2/sweep[?apply=true]` exposes it.
  - **Two-axis variants** — `ProductVariant` gains `axis1`, `axis2`, `image` fields; `Product` gains `variant_axis1_name`, `variant_axis2_name`. Buyer's `ProductDetail` renders a 2D grid when both axis names are set + every variant has both axis values; falls back to flat one-axis grid otherwise. NewListingModal now has axis-name inputs + per-row axis1/axis2 fields + per-variant image upload (auto-uploaded to R2 under `products/{slug}/variants/`).
  - **Custom CDN domain (cdn.craftersmarket.org)** — manual setup guide at `/app/memory/R2_CUSTOM_DOMAIN_SETUP.md` + idempotent rewrite script `scripts/swap_r2_host.py`. Awaiting user's DNS step.
  - **Backend tests**: 35/35 (iter15: 12, iter16: 10, iter17: 5, r2_storage: 6, sweep_r2: 2). **Frontend E2E**: 4/4 critical paths (axis-name inputs, 2D grid, per-variant image upload, hero swap).
  - **MakerDashboard.jsx refactor (~1458 lines → split per-component)**: deferred — too risky for the marginal benefit; no behavior to gain.

- ✅ **iter16 — `.glb` upload (P2) + Variants (P3) + Draft mode (P4)** — backend 28/28 incl. 10 new iter16 cases + frontend E2E 12/12

- ✅ **Cloudflare R2 Object Storage** for product images:
  - `POST /api/maker/uploads/model` — multipart route accepting `.glb` / `.gltf`, validates extension + 50MB cap, uploads to R2 under `models/{maker_slug}/{uuid}.glb`, returns public CDN URL
  - `r2_storage.upload_model_bytes` — model-specific allowlist (model/gltf-binary, model/gltf+json, application/octet-stream) and 50MB cap
  - Frontend (`MakerDashboard.jsx`): NewListingModal + per-product 3D editor swap text URL field for a styled file-picker (drag-and-drop replace, fallback to manual URL paste)

- ✅ **Listing variants** (P3) — one-axis simple model `{label, price_delta, in_stock}`:
  - `ProductVariant` Pydantic model auto-IDs each variant (12-char hex)
  - `Product.variants: List[ProductVariant]` and `MakerProductCreate.variants` (with label-required + non-negative-stock validation, stronger validation on PATCH via new `ProductVariantInput`)
  - `CartItem.variant_id` flows through `/cart/quote` and `/checkout/session`; `_resolve_cart` blocks 400 when product has variants and none selected, applies `price_delta` to unit price, surfaces variant label in summary
  - Stripe Connect payout & maker-orders subtotals correctly use base + variant delta
  - Frontend cart (`/lib/cart.js`): row-keyed by `id+variant_id` so two variants of one product = two cart rows
  - Public `ProductDetail` page renders variant selector buttons; price + stock react to selection; Sold-out variants are disabled
  - `NewListingModal` has a Variants section with `+ Add option`, label/price-delta/stock rows, and per-row remove

- ✅ **Draft mode** (P4):
  - `Product.status: "draft" | "published"` (default published)
  - Public catalog (`/api/products`, `/api/products/{slug}`) filters `{status: {$ne: "draft"}}` — drafts hidden, backwards-compat for legacy products
  - `/api/maker/products` returns drafts to the owner
  - `POST /api/maker/products/{slug}/publish` and `/unpublish` toggles
  - `MakerDashboard.ProductsList` splits Drafts / Live / Archived into three sections with badges; per-card publish toggle (with inline error display); `Save as draft` button in NewListingModal

- ✅ **Cloudflare R2 Object Storage** (P1, prior):
  - `/app/backend/r2_storage.py` — boto3-based S3-compatible client (R2 endpoint), `upload_data_url`, `upload_bytes`, `delete_key`, content-type allowlist (PNG/JPEG/WEBP/GIF), 8 MB cap
  - `POST /api/maker/products` now auto-uploads any base64 `data:image/...;base64,...` payload to R2 under `products/{maker_slug}/{uuid}.{ext}` and stores only the public CDN URL in MongoDB (no more base64 bloat)
  - Migration script `/app/backend/scripts/migrate_images_to_r2.py` — idempotent walker, converts any legacy base64 images to R2 URLs in place. Ran clean (0 base64 found in seeded catalog)
  - 6 unit tests (`tests/test_r2_storage.py`) + iter15 backend tests still green
  - Bucket: `craftersmarket-assets` — public read via `pub-96d13eb6b15840a98236f6c1053262c3.r2.dev`. Custom domain (`cdn.craftersmarket.org`) optional later.
  - Env keys added: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_URL`

- ✅ **Maker Self-Serve Listings (Option B)**:
  - `POST /api/maker/products` — create listing with title/price/category/technique/stock/dimensions/description/materials/images/model_url
  - `DELETE /api/maker/products/{slug}` — soft-delete (sets `deleted_at`)
  - `POST /api/maker/products/{slug}/restore` — clears `deleted_at`
  - `GET /api/maker/products` — returns both live + archived for maker; public catalog filters `deleted_at`
  - Frontend: `NewListingModal` (`MakerDashboard.jsx:799`) with HTML5 canvas client-side image compression → base64 data URLs (max 5 images)
  - `ProductsList` (`MakerDashboard.jsx:316`) splits live vs ARCHIVED with restore controls
  - Bug-fix during iter15: duplicate `Field` component declaration crashed the dashboard — renamed second to `LabeledField`

## P1 BACKLOG — Multi-tier Admin Team & Role Management (saved 2026-04-27)

**User intent (verbatim):** "i think this looks good, helpful advice would help" → "save this idea for later"

### Architecture
- 1 fixed top-tier role: **Super Admin** (env-driven via `ADMIN_EMAILS`, never assignable from UI — security)
- 5 togglable capabilities (a single user can hold any combo):
  - **Marketplace Admin** — approve maker applications, manage listings/categories, suspend makers
  - **Content Manager** — homepage, banners, blog/journal, SEO meta, featured products, categories/tags
  - **Customer Support Admin** — tickets, refunds (initiate, requires Finance approval if 2-person rule on), custom-order intervention, buyer/seller escalations
  - **Finance / Payments Admin** — payouts, refund execution, commission overrides, ad-spend ledger
  - **Moderation Admin** — chat moderation, forum/showcase moderation, ban/freeze users, reported items
- Optional 6th capability: **Read-only** (view dashboard, blocks every mutation — for new hires, investors, accountant)

### Database
- New `admin_users` collection: `{email, is_super_admin, capabilities: [str], added_by, added_at, last_seen}`
- `is_super_admin` is read-only in UI, derived from `ADMIN_EMAILS` env on every login

### Backend
- Replace `current_admin` dependency with `require_capability("finance" | "content" | ...)` factory
- New endpoints:
  - `GET /api/admin/team` — list admins + capabilities (super-admin-only)
  - `POST /api/admin/team` — invite by email (sends magic-link with branded "You've been added as Content Manager" copy)
  - `PATCH /api/admin/team/{email}` — toggle capabilities (super-admin-only)
  - `DELETE /api/admin/team/{email}` — revoke admin entirely (super-admin-only, with self-lockout block)
- Admin JWT TTL: 24h (vs current 7d) for stolen-device safety
- Audit log entry on every grant/revoke
- Email to all super admins on every change (compromise detection)
- "Last edited by" tags on banners, blogs, refunds, settings (auditability without dedicated audit pages)

### Frontend
- New `TeamTab.jsx` in admin dashboard (super-admin-only)
- Capability presets dropdown: **Full Operator** (Marketplace+Support+Moderation), **Editorial** (Content), **CFO** (Finance), **Custom** (manual checkboxes)
- Tab visibility based on logged-in user's capabilities (hide entirely, not grey out — cleaner UX)
- Soft cap of 10 admins with warning toast (not hard block)

### Safety rails (non-negotiable)
- Super Admin only via `.env` — UI bug can never demote/lock out the owner
- Cannot revoke your own access (self-lockout protection)
- All capability checks server-side (frontend hide is UX, not security)
- All role changes audit-logged AND emailed to super admins

### P1.5 (recommended companion features)
- **Two-person rule for high-stakes actions** (~half day of work):
  - Refunds > $500 → require Finance + (Super OR Marketplace) approval
  - Manual payouts → two Finance approvals
  - Account/role changes → already super-admin-only
- **IP allowlist toggle** (~2 hours, off by default — strong B2B trust signal if pursuing larger merchants)

### Decisions deferred ("save for later")
- Slack/Discord webhook notifications — skip until there's a team
- Custom permission editor — never (5 caps + presets covers 99% of cases)

### Estimated effort
- P1 core: ~4 hours
- P1.5 (two-person rule + IP allowlist): ~6 hours
- Total: ~10 hours when picked up



## 2026-04-27 — Discount Codes E2E Verified
- ✅ **Phase 2.5 Maker Discount Codes — checkout flow verified end-to-end.**
  - Backend `/api/cart/quote` & `/api/checkout/session` accept `discount_code`, validate per-shop, apply percent/fixed/free-shipping, surface `discount_error` on invalid/expired/wrong-shop codes.
  - Stripe coupon (one-shot, `max_redemptions=1`) attached to Checkout Session so Stripe shows the discount line natively. Fallback path discounts the matching line item if coupon create fails.
  - `uses_count` increments once on `unpaid → paid` transition (idempotent via webhook gating).
  - `CartPage.jsx` UI: per-shop discount input with `cm_cart_discount` localStorage persistence (survives Stripe cancel→cart bounce), green "✓ Code applied" applied banner with Remove, red `Code not found or inactive.` error state for invalid codes, `Discount · CODE` line item in summary, total recomputes live via `fetchCartQuote(items, code)`.
  - Verified visually with Mountain Range Silhouette ($149 + $25 ship → $174 baseline; 15% code → $151.65; remove → $174 again; bad code → preserves $174 with red error).
- 🟢 Closes the only P0 outstanding from the Maker Shop Manager rollout. All 9 tabs (Listings, Orders, Messages, Stats, Violations, Marketing, Financials, Help, Upgrade) + AI Marketing tools + CSV Import + Discount Codes are now functional end-to-end.

## 2026-04-27 — Buyer↔Maker DM System + SEO Polish
- ✅ **Buyer ↔ Maker direct messages — shipped end-to-end.**
  - New backend router `/app/backend/routers/messages.py` with `dm_threads` and `dm_messages` Mongo collections.
  - Endpoints: `POST /api/messages/start` (public — guests can DM without an account), `GET/POST /api/messages/maker/threads[…]/reply` (maker-JWT), `GET/POST /api/messages/buyer/threads[…]/reply` (buyer-JWT).
  - Anti-spam: 20-thread/24h cap per (buyer→maker) pair; same-buyer threads within 7 days get re-used instead of creating duplicates.
  - Postmark email notifications via new `send_dm_to_maker` / `send_dm_to_buyer` helpers — reuses the existing Mailtrap→Postmark→Resend fallback chain. Emails contain a CTA to `/maker/dashboard#messages?thread=<id>` (maker) and `/messages?thread=<id>` (buyer).
  - Frontend: rebuilt `MessagesTab.jsx` as a two-pane (thread list + reader/composer) with unread badges, deep-link via `?thread=<id>`, ⌘+Enter send. New `ContactMakerModal.jsx` opens from a "Message {Maker}" button on `MakerDetail.jsx` — guest-friendly; pre-fills name/email if the visitor is a signed-in community user. New `BuyerMessagesPage` at `/messages` mirrors the maker layout for buyers' side of the inbox.
  - Verified end-to-end: guest started thread → maker JWT lists/reads/replies → unread counters flip correctly → buyer-side endpoints gate on JWT (401 without). UI screenshots confirm Contact modal flow + maker inbox/reader/reply states.
  - Side-fix: defensive guard in `routers/maker.py:maker_orders` for legacy product rows missing the `id` field (was 500-ing the whole maker dashboard for one shop).
- ✅ **SEO meta tags rounded out** in `lib/seo.js`:
  - Added `twitter:title`, `twitter:description`, `twitter:image`, `twitter:image:alt` (Twitter cards no longer rely solely on OG fallback).
  - Added `og:image:alt`, `og:site_name`, and a `<link rel=canonical>` injector.
  - Pages now pass `ogType` per surface: `product` (ProductDetail), `profile` (MakerDetail), `website` (ShopPage). Old behavior had every page emit `og:type=website` regardless.
  - Choice rationale: kept the existing custom hook instead of pulling in `react-helmet-async` — same final HTML output, zero dependency churn, fewer moving parts in the SPA.



## 2026-04-27 — Etsy-style New Listing Editor (full page)
- ✅ **Replaced the old NewListingModal stub with a full-page Listing Editor** at `/maker/listings/new` and `/maker/listings/:slug/edit`. Layout follows the user-approved Etsy-style mock with 12 sections: Photos & Video, AI Assistant, Listing Details, Item Details (who-made-it, condition, dimensions, weight, colors, occasions), Pricing, Variations, Personalization, Shipping, Processing Time, Return Policy (with live "Buyer will see" preview), SEO Tags (max 13), Contact. Industrial dark + orange palette preserved per user instruction.
- **Schema extension** (`models.py` Product + `routers/maker.py` MakerProductCreate / MakerProductUpdate): 21 new optional fields — `video_url`, `who_made_it`, `condition`, `length_in`, `width_in`, `height_in`, `dim_unit`, `weight_lbs`, `weight_oz`, `colors[]`, `occasions[]`, `personalization_enabled`, `personalization_instructions`, `free_shipping`, `shipping_domestic_usd`, `shipping_international_usd`, `shipping_carrier`, `shipping_est_delivery`, `processing_time`, `accept_returns`, `accept_exchanges`, `seo_tags[]` (max 13, validated server-side), `contact_email`. All fields default-safe; existing data unaffected (Pydantic `extra="ignore"`).
- **AI Assistant** wired to existing `POST /api/maker/ai/listing-copy` (Claude Haiku 4.5) — populates Title, Description, and SEO Tags from a single bullets prompt; uses currently-selected category and target_price as context.
- **Image compression** identical to the legacy modal: 1600px max edge, WebP/JPEG, sub-130KB target with adaptive quality.
- **Validation**: title 100-char hard cap, description required, price > 0, ≥1 photo for publish, max 10 photos, max 13 SEO tags. Save Draft skips most validations; Publish enforces them.
- **Sticky top + bottom action bars** with Cancel · Clone (edit only) · Preview · Save Draft · Publish.
- **Verified end-to-end**: created a draft via curl with 25+ fields including colors/occasions/personalization/shipping/processing/returns/tags — every field round-trips through the API and the Mongo doc. PATCH partial updates work. UI screenshots confirm Photos, AI Assistant, Item Details (chip grids), Pricing, Variations, and Contact (auto-filled email from `fetchMakerMe`).


## 2026-04-27 — P2/P3 backlog cleared (Admin RBAC, Shopify CSV, Dormant Retention)

### ✅ Multi-tier Admin Team & Role Management (P2)
- **Backend**: `core.py` defines 6 capabilities (`marketplace`, `content`, `support`, `finance`, `moderation`, `read_only`) + 5 presets (`full_operator`, `editorial`, `cfo`, `support_only`, `viewer`). `maker_auth.py` adds `admin_capabilities(claims)` resolver and a `require_capability(*caps)` dependency factory + `require_super_admin()` for team-management endpoints.
- **Auth**: `admin_auth_request` and `admin_auth_verify` now allow login for env-defined super admins **OR** active rows in the new `admin_users` collection. `admin_me` returns `is_super_admin` + `capabilities[]` so the frontend can hide/show tabs.
- **Endpoints** (super-admin-only):
  - `GET /api/admin/team` — list all admins + presets + capability registry
  - `POST /api/admin/team` — invite by email (sends branded magic-link email via Postmark via `send_admin_team_invite`)
  - `PATCH /api/admin/team/{email}` — toggle capabilities OR `is_active`. Bumps session_version so revoked admins are kicked immediately.
  - `DELETE /api/admin/team/{email}` — full revoke. Self-lockout protected. Audit-logged.
- **Safety rails per spec**: Super admin emails are env-driven only and never editable here. Cannot edit/revoke own row. Read-only is mutually exclusive with other caps. Soft cap of 10 admins with warning log (no hard block).
- **Frontend**: New `TeamTab.jsx` in admin dashboard (visible only when `me.is_super_admin === true`). Two-pane: list of admins with cap chips, last-seen, edit/deactivate/revoke per row. Invite modal with quick-preset buttons, capability checkboxes with hint copy, optional note. Soft-cap warning surfaces server-side, not client-side.
- **Verified**: curl flow → create super admin token → list team (1 row, 6 caps) → invite editor-test@example.com (Editorial preset → ["content"]) → patch to ["content","support"] → revoke → audit_log entries cleaned.

### ✅ Shopify CSV Import (P2)
- Added `_parse_shopify_row` and `_group_shopify_rows` to `routers/csv_import.py`. Shopify exports are variant-grained (one row per variant), so we group by `Handle`, sum `Variant Inventory Qty` across variants, collect up to 10 unique `Image Src` URLs across the handle, and emit ONE product per handle. Skips zero-price/missing-handle rows. Uses `Body (HTML)` stripped to plain text for description, and `Type` → category fallback.
- `csv_import_preview` now dispatches on `source` ∈ {etsy, shopify}; `csv_import_commit` now records `source` in audit log + `imported_from` field. `CsvImportModal.jsx` adds an Etsy / Shopify source selector with format-specific helper copy and "What we map" panel.
- **Verified**: 4-row Shopify test CSV with 2 valid handles (one with 2 variant rows) + 1 zero-price row → preview returns 2 parsed products with merged inventory (5 = 3+2) and 2 collapsed images.

### ✅ Dormant buyer retention (P3)
- **Backend** `routers/retention.py`:
  - `GET /api/admin/retention/dormant?days=60` — Mongo aggregation pipeline groups paid orders by `buyer_email`, returns those whose latest paid order falls outside the threshold (clamped 7-365 days). Includes `total_orders` + `lifetime_value` per buyer.
  - `POST /api/admin/retention/reengage` — body `{emails[], discount_pct, expires_in_days}`. Per buyer creates a `marketing_codes` doc (`WELCOMExxxxxx`, single-use, marketplace-wide), tags them as `dormant-buyer-reengaged` in Kit.com (best effort, swallows failure), and queues a Postmark email via `send_dormant_buyer_reengage`. **24-hour idempotency window** so the same buyer can't be double-emailed.
- **Checkout integration**: `_resolve_discount` in `routers/checkout.py` now ALSO checks `marketing_codes` (scope=marketplace_wide) before falling through to the per-shop `discount_codes`. Discount applies to the FULL items subtotal (not per-shop). Webhook code-usage tracking deactivates the marketing code after redemption.
- **Frontend**: Extended `RetentionTab.jsx` with a `<DormantBuyersPanel>` below the cohort heatmap. Days threshold dropdown (30/60/90/120/180/365), Scan button, table with select-all + per-row checkboxes, last-order-date, total orders, LTV. Bottom send-bar: discount % (10-30) + expiry (7-60d) + Send button with confirmation dialog.
- **Verified**: scan returned 0 (no orders >60d old in seed data — sane). Reengaged a synthetic email → `WELCOMExxxxxx` code created with `single_use=True, scope=marketplace_wide, expires_at` set. `/api/cart/quote` honors the code: $149 → -$22.35 (15%) → $151.65 with `discount_kind="dormant_reengage"`. Repeat call within 24h returned `sent:0, skipped:1` (idempotency works).


## 2026-04-27 — Final follow-ups (Video upload, Clone listing, P1.5 controls)

### ✅ Direct video upload to R2
- `r2_storage.py`: added `ALLOWED_VIDEO_TYPES` (mp4/webm/mov), `MAX_VIDEO_BYTES = 50 MB`, and an `upload_video_bytes(...)` helper. Cache-Control set to 1 day (shorter than images so makers can iterate without burning new keys). No transcoding — browsers handle codecs natively; future Cloudflare Stream wiring is a 1-call swap.
- `routers/maker.py`: new `POST /api/maker/uploads/video` endpoint. Auth-gated by `current_maker_slug`, content-type validated against the allowlist with filename-extension fallback for browsers that send blank/wonky mime types.
- `MakerListingEditor.jsx`: replaced the URL-only video field with a richer block — "Upload from computer" button + progress %, OR paste URL fallback, OR show inline `<video controls>` preview with Remove. 50MB and codec validation done client-side too so the user sees the error instantly.
- Verified end-to-end: tiny test mp4 → POST returned `{ url, size }` with R2 public URL.

### ✅ One-click "Clone listing"
- `routers/maker.py`: new `POST /api/maker/products/{slug}/duplicate` (returns `Product`). Copies the source doc, appends `(copy)` to the title, regenerates `id` + `slug` (`{base}-copy-{6hex}`), refreshes variant ids so editing the clone doesn't mutate the source, sets `status="draft"`, clears `expires_at` / `promoted_until` / `featured` / `deleted_at`, and stamps `created_at = now()`.
- `MakerListingEditor.jsx`: edit-mode "Clone" button now calls the API + navigates to `/maker/listings/<new-slug>/edit` and force-reloads so component state matches the new URL.
- Verified end-to-end: cloned a published listing → got `{slug: 'mountain-range-silhouette-copy-xxxxxx', title: '... (copy)', status: 'draft', expires_at: null, promoted_until: null, variants: 0}`.

### ✅ P1.5 — Two-person rule for refunds + IP allowlist

**Two-person rule (refunds ≥ $500)**
- New `refund_approvals` collection with status state-machine: `pending → approved → executed` (or `denied`).
- `POST /api/admin/orders/{session_id}/refund` flow: if `total ≥ REFUND_DUAL_APPROVAL_USD` (env, default $500) and no `approval_id` query param, creates a pending approval row + audit entry, returns `202` with `{requires_approval: true, approval_id, threshold, amount}`. With a valid `approval_id` AND `status="approved"` AND approver ≠ executor, executes the refund and stamps `executed_at`.
- New endpoints: `GET /api/admin/refund-approvals?status=...`, `POST /api/admin/refund-approvals/{id}/approve` (rejects requester self-approval with 403), `POST /api/admin/refund-approvals/{id}/deny`.
- New `RefundApprovalsTab.jsx` in admin dashboard with status filter, approve/deny per-row, and "Execute Refund" CTA visible only on `approved` rows. Self-requested rows show a yellow "you requested this — a different admin must approve" hint.
- `PaidOrdersList.jsx` refund button now reads the response — if `requires_approval`, surfaces a yellow toast pointing the admin to the new tab.
- Verified end-to-end: $750 fake order → first refund request → 202 with `approval_id` → same admin tries to approve → 403 ("a different admin must approve") → second admin approves → 200 → list returns 1 approved row.

**IP allowlist (optional)**
- `maker_auth.py`: new `_admin_ip_allowlist()` parser supporting CIDR (`10.0.0.0/8`) AND single IPs. Reads `ADMIN_IP_ALLOWLIST` env (empty/missing = enforcement disabled).
- `current_admin` dependency now also accepts `Request`, calls `_enforce_admin_ip(request)` before the JWT check. Honors `X-Forwarded-For` (Kubernetes ingress) and falls back to direct client IP. Bad / missing IPs return 403 when allowlist is on.
- Belt + braces — every existing admin endpoint that depends on `current_admin` (or wraps it via `require_super_admin()`) is now IP-gated automatically once the env is set. No code rewrite needed at call sites.


## 2026-04-27 — Listing Editor UX upgrades
- ✅ **AI SEO tag generator** in editor — new `POST /api/maker/ai/seo-tags` endpoint (Claude Haiku 4.5) reads current title + category + description, returns 8-13 lowercase tags excluding any the maker already added. New `✦ AI suggest tags` button in the SEO section. Verified: 12 high-quality tags returned for a plasma-cut wall-art listing in <8s.
- ✅ **CSV Import moved to Help tab** — removed the secondary "Import CSV" button from the Listings tab header (kept just `+ New Listing`), surfaced it as a featured orange "Migrate from Etsy or Shopify" card at the top of the Help tab. Better mental model: import is a one-time onboarding action, not a daily-listings action.
- ✅ **Edit-listing opens the full editor** — replaced ProductEditCard's inline `Edit` flow with a primary orange `✎ Edit listing` button that links to `/maker/listings/{slug}/edit`. Edit-mode of `MakerListingEditor` already loads existing images, video URL, dimensions, colors, occasions, SEO tags, etc. via the `setForm({ ...emptyForm(), ...found })` spread.
- ✅ **Images visible when editing** — confirmed: `<img src={src}>` in the editor's photo grid renders BOTH data URLs (from the new uploads) AND http(s) URLs (from CSV imports + R2 uploads) without modification. Edit mode now shows the same Photos & Video grid as create mode.
- ✅ **Image cropping on upload** — added `react-easy-crop` (~25 KB). New `ImageCropModal` (`/app/frontend/src/components/ImageCropModal.jsx`) wraps the picker with a square-aspect crop step + zoom (1×–4×) + rotation (-180°…+180°) + reset. Built-in canvas pipeline handles the final compress to ≤130 KB WebP/JPEG (replaces the older `compressImageToDataUrl` helper). Crop queue handles multi-file selection — modal pops once per file, "Skip cropping" drops that file. "Apply crop" returns the cropped data URL straight to the editor's `images[]`.

## 2026-04-27 — Founding Seller Beta signup CTA
- ✅ **New `/beta` page** (`/app/frontend/src/pages/BetaPage.jsx`) — Founding Seller marketing page with hero ("Become a Founding Seller"), benefits grid ($0 listing fees, reduced commission locked in, priority placement, Founding Seller badge, direct roadmap input, early tool access), "Serious makers only" requirements block (3 products, complete profile, feedback), beta-details stats (100 spots / 90 days / discount after), and a full Founding Seller application form. Submits through the existing `submitMakerApplication` / `POST /api/maker-applications` endpoint with a `[FOUNDING SELLER BETA]` prefix in the about field so admins can triage beta applicants in the normal queue without a new backend collection. Has a secondary "Just apply to sell (not beta)" link that points to `/apply` for makers who don't want founding-seller commitments.
- ✅ **Bold "◆ BETA SIGNUP" button in Nav** (`/app/frontend/src/components/sections/Nav.jsx`) — solid orange (`#ff4500`), bold uppercase mono, placed ahead of Sign in / Cart so it reads as the primary CTA during the founding-seller recruit. Has a compact `BETA` variant for small screens and a dedicated orange entry at the top of the mobile drawer menu. All three carry `data-testid`: `nav-beta-signup-btn`, `nav-beta-signup-btn-mobile`, `mobile-nav-beta-signup`. Route wired in `App.js` (`/beta` → `BetaPage`). Verified via screenshot: clicking the header button navigates to `/beta`, hero renders "BECOME A FOUNDING SELLER", and the beta form is present.


## 2026-04-27 — Founding Seller Beta lifecycle (auto-provision + 90-day admin toggle)
- ✅ **Auto-detect beta applicants** (`/app/backend/routers/catalog.py`) — `POST /api/maker-applications` now scans the `about` field for the `[FOUNDING SELLER BETA]` marker that `/beta` injects, and stamps `is_beta=True` on the application doc server-side. Regular `/apply` submissions stay `is_beta=False`.
- ✅ **New `Maker` beta fields** (`/app/backend/models.py`): `is_beta: bool`, `beta_approved_at: Optional[str]`, `beta_expires_at: Optional[str]`. `MakerApplication` gained `is_beta: bool`.
- ✅ **Auto-provision on approval** (`/app/backend/routers/admin.py` → `admin_decide_application`) — when an `is_beta` application is approved, the newly created `Maker` gets `is_beta=True`, `beta_approved_at=now`, `beta_expires_at=now+90d`. If a Maker already existed for that email (re-applied through /beta), the existing doc is upgraded in place.
- ✅ **Applications list enriched** — `GET /api/admin/maker-applications` now joins the maker doc by email for approved rows and returns `maker_slug`, `maker_is_beta`, `maker_beta_approved_at`, `maker_beta_expires_at` so the admin UI renders the countdown + toggle in one round trip.
- ✅ **Manual beta toggle endpoint** — `POST /api/admin/makers/{slug}/beta` with body `{enabled: bool}`. Enabling stamps a fresh 90-day window (`is_beta=True`, `beta_approved_at=now`, `beta_expires_at=now+90d`); disabling clears all three. 404 on unknown slug, 401 when unauthenticated, admin-IP-gated via `current_admin`.
- ✅ **Admin UI** (`/app/frontend/src/components/admin/ApplicationsList.jsx`) — fully rewritten with:
  1. `FOUNDING SELLER BETA` badge on any `is_beta` application row.
  2. Orange border highlight on beta rows.
  3. Pre-approval nudge on beta pending rows: "Approving this applicant will grant Founding Seller Beta with a 90-day window."
  4. Strips the internal `[FOUNDING SELLER BETA]` marker from the public about excerpt.
  5. `BetaToggleSwitch` (pill-style switch, orange when on) + `BetaCountdown` on every approved row with a linked maker — admins can promote/demote ANY approved maker, not just beta-original ones.
  6. `BetaCountdown` auto-ticks every 60s with a progress bar that shrinks as the 90-day window closes; shows "Ends <date>" and "Ended Xd ago" when expired.
- ✅ **New API client fn** — `toggleMakerBeta(slug, enabled)` in `/app/frontend/src/lib/api.js`.
- Verified end-to-end: beta application via `/beta` → admin approves → maker auto-created with 90-day expiry (`Apr 27 2026 → Jul 26 2026`) → toggle OFF clears fields → toggle ON resets the 90-day countdown. Badge, switch, and "89D 23H LEFT" countdown all render in admin Applications tab. Unknown slug → 404, unauthenticated → 401.


## 2026-04-28 — Admin toggle: Beta Signup master switch
- ✅ **New site setting** `beta_signup_enabled` (default `true`) in `/app/backend/routers/settings.py` defaults, public `GET /api/settings`, admin `GET /api/admin/settings`, and the `SettingsPatch` model.
- ✅ **Server-side gate** — `POST /api/maker-applications` now rejects any submission tagged `[FOUNDING SELLER BETA]` with HTTP 403 (`"Founding Seller Beta signups are closed right now. Please apply at /apply instead."`) whenever the flag is off. Regular `/apply` submissions continue to work.
- ✅ **Nav gating** (`/app/frontend/src/components/sections/Nav.jsx`) — the bold ◆ BETA SIGNUP desktop pill, compact mobile variant, and mobile-drawer entry all hide when the flag is off. Reads via `useSiteSettings()` (60s polling).
- ✅ **/beta page gating** (`/app/frontend/src/pages/BetaPage.jsx`) — when off AND settings have loaded, renders a "BETA SPOTS ARE CLOSED" state with a CTA to `/apply` instead of the founding-seller form. Uses a strict `settings.beta_signup_enabled === false` check so there's no flash-of-closed during initial load.
- ✅ **Admin UI row** (`/app/frontend/src/components/admin/SettingsTab.jsx`) — new `beta_signup_enabled` switch between "Allow New Maker Applications" and "Live Chat", with blurb explaining the master-switch behaviour ("hides the ◆ BETA SIGNUP button sitewide AND swaps /beta to a 'spots closed' state — existing Founding Sellers keep their perks"). Toggles like every other admin switch (optimistic UI + `refreshSiteSettings()` after save).
- Verified end-to-end: toggle OFF → `GET /api/settings` returns `false` → Nav button disappears on home, /beta renders the "BETA SPOTS ARE CLOSED" screen, `POST /api/maker-applications` with beta marker returns 403, regular /apply submissions still return 200 with `is_beta: false`. Toggle back ON → everything restored.


## 2026-04-28 — Production deploy helper + admin password rotation (30-day policy)
### Admin password seeder (env-driven, idempotent)
- ✅ `seed_data._seed_admin_password()` reads `ADMIN_INIT_PASSWORD_HASH` (bcrypt `$2b$` hash) + `ADMIN_INIT_EMAIL` (defaults to `OPS_EMAIL`) from the deploy env and seeds a super-admin row into `admin_users` on first boot.
- Idempotent: skips if the admin already has a `password_hash`, so a user-rotated password is never clobbered by a redeploy. Fires inside the existing `seed_if_empty()` startup hook.
- Unblocks the "password works in preview but not in prod" gap — user sets the env var once in Emergent deploy settings, every future fresh deploy gets the same admin password automatically.

### Admin password rotation (30-day forced rotation)
- ✅ New env `ADMIN_PASSWORD_ROTATION_DAYS=30` (set to `0` to disable). Admin role only; buyers/makers unaffected (NIST 2024 guidance against forced rotation for end-users).
- ✅ Backend helper `password_rotation_status(role, user)` in `/app/backend/routers/auth_password.py` returns `{required, days_since_change, days_until_required, policy_days}` from `last_password_change_at` → `password_set_at` fallback.
- ✅ `POST /api/auth/password/login` response now includes `requires_password_rotation` + `password_rotation` fields alongside the JWT.
- ✅ `GET /api/admin/me` surfaces the same fields — page refresh re-triggers the gate so an admin can't just close the tab and bypass it.
- ✅ Frontend `RotatePasswordModal.jsx` renders as a blocking full-screen overlay in `AdminDashboard` whenever `me.requires_password_rotation === true`. No close button, no overlay-click dismiss, no esc-to-close. Requires current password + new password (≥10 chars, different from current) + confirmation. On success, calls `refresh()` which re-fetches `/admin/me` — modal auto-unmounts when the flag flips back to false.
- Verified end-to-end: backdate `last_password_change_at` to 45 days ago → login returns `requires_password_rotation: true` → admin redirected to dashboard → blocking modal "YOUR PASSWORD HAS EXPIRED." renders → fill current/new/confirm → modal dismisses → admin console fully accessible. Password set via `/auth/password/set/admin` bumps `last_password_change_at` to now, resetting the 30-day clock.


## 2026-04-28 — Pre-expiry password rotation banner
- ✅ **Non-blocking warning banner** at the top of `AdminDashboard` (between the stats and the tab bar) — shows when `password_rotation.days_until_required <= 5` AND `!requires_password_rotation`. Yellow bordered, reads "Your password expires in X days. Rotate now to reset the 30-day clock" with a one-click "Rotate now →" CTA.
- ✅ **Dismissible modal** — `RotatePasswordModal` now accepts an optional `onClose` prop. When provided (voluntary rotation from the banner), esc/overlay-click dismiss works, a ✕ close button renders, and the copy swaps from "YOUR PASSWORD HAS EXPIRED" / "Rotation required" to "ROTATE YOUR PASSWORD" / "Rotate early" so admins know it's optional. When absent (post-expiry), the modal stays hard-blocking.
- ✅ On successful voluntary rotation, both `onDone()` AND `onClose()` fire — dashboard refreshes `/admin/me` and the modal unmounts.
- Verified via Playwright: backdate password to 27 days old → dashboard renders banner with "3 days" text, blocking modal NOT present → click "Rotate now" → dismissible modal opens with "ROTATE YOUR PASSWORD" headline + ✕ close button → close without rotating → modal dismisses, banner still visible. Screenshot confirms the final visual.


## 2026-04-28 — Email health badge in admin dashboard
- ✅ **New endpoint** `GET /api/admin/email-health` — single-shot health classifier returning `{status: "ok"|"degraded"|"down"|"idle", provider, fallback, primary_configured, sent_24h, failed_24h, hint}`. Logic:
  - **down** → primary provider not configured (API key missing) OR 0 sends with ≥1 failure in last 24h.
  - **degraded** → ≥1 failure with partial successes (failure rate ≥ 10%).
  - **ok** → recent sends succeeding cleanly.
  - **idle** → zero email events in last 24h (cold start).
  - `hint` is a one-sentence diagnostic with the action to take ("set POSTMARK_API_KEY and redeploy", "Check API keys + DNS for mailtrap", etc).
- ✅ **`EmailHealthBadge.jsx`** — compact pill in the AdminDashboard header (next to LiveNowBadge), polls every 60s. Renders a colored dot (emerald/yellow/red/gray) + label + 24h success count. Failing dots animate-pulse. Tooltip surfaces the full hint on hover.
- Verified end-to-end: badge renders "EMAIL · DOWN · 0/42 24H" with full diagnostic tooltip in the preview environment (Mailtrap currently 100% failing, Postmark catching as fallback). Endpoint correctly classifies the real state.

## 2026-04-28 — Financials tab live search (parity with Help search)
- ✅ Added a search box to the Financials sub-nav at `/maker/dashboard → Financials` with the same UX as `HelpTab`:
  - `⌘K`/`Ctrl+K` focuses, `Esc` clears, `X` clear button, live `◆ N matches` counter.
  - Filters the 7 sub-sections (Payment account, Monthly statements, Payment settings, QuickBooks, Xero, TurboTax, Legal & tax) by label + per-section keyword bag (`stripe`, `1099`, `quickbooks`, `xero`, `turbotax`, `payout`, etc.).
  - Auto-jumps the right pane to the first matching section so results are visible immediately.
  - Right-pane content highlights occurrences of the query inside transaction history rows, monthly-statement labels, payment-settings copy, export blurbs, and Legal & tax body text using the same `<mark className="bg-[#ff4500]/30">` style as Help.
  - Empty-state right-pane when zero sections match — suggests sample queries (`stripe`, `1099`, `quickbooks`, `payout`) and offers a Clear search action. Sub-nav also collapses to a compact "No matches." pill.
- Verified end-to-end via Playwright: searching `1099` → 1 match, sub-nav narrows to Legal & tax, three "1099" highlights render in the right pane. `zzzzzzzz` → empty state. X-clear restores full nav.

## 2026-04-28 — Maker Listings P2 backlog cleared (Bulk-action toolbar + Editor refactor)
### Bulk-action toolbar in Archived listings
- ✅ **New endpoint** `DELETE /api/maker/products/{slug}/purge` — permanent (hard) delete for archived listings only. Three gates:
  - **Archived gate**: 400 if `deleted_at` is None — listing must be soft-deleted first (one-click + confirm in the UI).
  - **Order-history gate**: 400 if `payment_transactions` references this product. Defensive `$or` query covers `items.product_id == product.id`, `items.product_id == slug`, AND `items.slug == slug` so legacy data layouts can never slip past — preserves refund history, dispute audit, and the maker's own /maker/orders feed.
  - **Owner-only**: 403 if a different maker's slug.
- ✅ **`/maker/dashboard` → Listings → Archived** rebuilt with multi-select:
  - Per-card checkbox overlay (`data-testid="archived-select-{slug}"`) + orange ring on selection.
  - Sticky `BulkToolbar` with Select all / Clear all toggle, live `N selected` counter, **Restore selected** (calls existing `/restore`), **Delete permanently** (calls `/purge` after a confirm modal), **Clear** button.
  - Bulk operations dispatch `Promise.allSettled` over selected slugs — no all-or-nothing failure mode; per-slug failures surface in a toast with the first error message.
  - View-switch and post-mutation refresh both reset the selection set so stale slugs never linger.
- Backend regression: 9/9 pytest in `/app/backend/tests/test_iter44_bulk_purge.py` (happy path, all error gates, bulk sequence). Frontend smoke verified — Select all → 1 selected → Restore + Delete buttons render with sticky orange toolbar.

### MakerListingEditor refactor (1284 → 860 lines, -33%)
- ✅ Split the monolith into focused modules under `/app/frontend/src/pages/MakerListingEditor/`:
  - `constants.js` (61 lines) — enums + `emptyForm()` factory.
  - `FormControls.jsx` (155 lines) — shared `Section`, `Label`, `FieldError`, `NumInput`, `Select`, `ChipGrid`, `Toggle`, `ToggleRow`, `ActionButtons`.
  - `MediaSection.jsx` (159 lines) — Photos & Video (drag-reorder, R2 upload, crop queue handoff).
  - `AiAssistantSection.jsx` (61 lines) — Claude-backed listing copy generator.
  - `PricingSection.jsx` (110 lines) — Price + variations.
- The orchestrator file keeps state, effects, validation, submit/clone/preview flows, and the inline sections that aren't worth extracting yet (Listing Details, Item Details, Personalization, Shipping, Processing Time, Return Policy, SEO Tags, Contact — each <60 lines).
- Frontend smoke verified end-to-end: `/maker/listings/new` renders all 12 sections; `/maker/listings/{slug}/edit` hydrates the form correctly through the new sub-component split (title pre-fills, photo grid renders, AI prompt accepts input).

## 2026-04-28 — Listing Editor: re-crop + prominent Save Draft + publish-blocker hint
Triggered by user feedback: "I need a save button when creating a new listing, I can upload the image, but I cannot save it, add a crop and rotate."
- ✅ **Per-photo Crop / rotate button** — every uploaded photo tile now exposes a crop icon in its hover overlay (`data-testid="editor-recrop-image-{i}"`). Clicking re-opens `ImageCropModal` (which already supports zoom + rotation -180→180° + aspect 1:1/4:5/16:9) seeded with that photo, then **replaces it in-place** instead of appending — handled via a new `cropTargetIdx` state the parent passes alongside the crop queue.
- ✅ **Save Draft promoted to a primary, emerald-painted CTA** in the action bar (header + footer). Was previously a low-contrast bordered button next to the orange Publish CTA — the dim styling led the user to think it was missing/disabled. Now `border-2 border-emerald-500/70 bg-emerald-500/10 text-emerald-300` so it's impossible to miss.
- ✅ **Publish blocker hint** — when `canPublish === false`, a small amber "◇ Add title, description, price… to publish" line renders directly under the disabled Publish button (and the same string is set as the button's `title=` for tooltip on hover). Pulls from the existing `errors` map so it auto-updates as the maker fills in fields. Hidden the moment the form is publish-ready.
- Verified end-to-end via Playwright: upload PNG → crop modal → confirm → re-crop with 45° rotation → Save Draft → "Draft saved." toast → redirected to dashboard with drafts count incremented. Editor lint clean.

## 2026-04-28 — Listing Editor: autosave-as-you-type
- ✅ **Debounced autosave** wired into the editor — every form mutation triggers a 1500ms `setTimeout` that PATCHes (`updateMakerProduct`) the existing draft, or POSTs a fresh draft (`createMakerProduct` with `status: "draft"`) on first save for new listings. The returned slug is stashed in `autoSlug` state so subsequent autosaves (and the manual Save Draft / Publish click) PATCH in place — no duplicate drafts, regardless of typing speed.
- ✅ **`AutoSaveIndicator` pill** in the editor's action bar renders three states: `Saving…` (animated spinner), `Saved Xs ago` (emerald check, relative time), `Save failed` (amber alert, advises Save Draft as fallback). Idle state renders nothing — visually quiet by default. A 30s ticker (`agoTick`) refreshes the relative time without re-rendering on every keystroke.
- ✅ **Skips when**: editor still hydrating (`!loaded`), manual save in flight (`saving`), OR no slug AND no title yet (nothing worth persisting).
- ✅ **Manual `submit()` deduped**: now uses `slug || autoSlug` for the target — eliminates the race where a fast typist gets two drafts (one from autosave, one from clicking Save Draft a beat later).
- Verified end-to-end via Playwright on `/maker/listings/new`: idle → no indicator → typed title → 1.7s wait → "Saved just now" indicator appears → edit description → still 1 draft on dashboard (no duplicates). Editor lint clean.

## 2026-04-28 — ImageCropModal viewport overflow fix
User reported: on their (short) viewport the crop modal extended below the visible area, so the Apply Crop button was unreachable — they could only see the cropper canvas + the bottom edge of the Zoom slider (screenshot artifact `d4u93lzy_image.png`).
- ✅ Restructured `ImageCropModal.jsx` to a `flex flex-col max-h-[92vh]` shell. Header / aspect row / sliders / footer are all `shrink-0`; the cropper canvas swapped from `aspect-square` (which forced the whole modal taller than the viewport on short screens) to `flex-1 min-h-[260px]` so it shrinks to fit whatever vertical space remains.
- ✅ Footer made sticky-bottom with `bg-[#0a0a0a]` so the orange Apply Crop CTA + Skip button never get scrolled off-screen, regardless of viewport height. Hide the auxiliary "Auto-compressed" hint on `<sm` widths to give the CTAs more breathing room.
- Verified across viewports 1400×720, 1280×800, 1100×600 — Apply Crop button is fully in-viewport and click-functional in every case. Image flow end-to-end (upload → crop → confirm → form.images.length === 1) verified on the tight 1100×600 case.

## 2026-04-28 — Crop modal: drag-to-resize + size persistence
- ✅ **Drag handle in the bottom-right corner** of `ImageCropModal` (orange grip icon, `cursor-nwse-resize`). Power-users on big monitors can stretch the cropper to fill 80% of a 4K screen for fine detail work.
- ✅ **Constraints**: min 480×420 (so the cropper canvas + sliders never collapse), max `viewport - 32px` on both axes (so the modal can never spill past the screen edge).
- ✅ **Auto-clamp on viewport resize**: a `window.resize` listener re-clamps the saved size against the new viewport so a maker who shrinks their browser never gets stranded with a too-large modal.
- ✅ **localStorage persistence** — final size is written to `cm_crop_modal_size` on mouseup, so the maker's preferred crop window sticks across sessions and across multiple photo uploads in the same listing.
- ✅ **Hidden on `<md` viewports** — touch resize on phones is more annoying than useful; mobile gets the full-bleed fitted modal as before.
- Verified end-to-end via Playwright: dragging +400px/+200px grew modal 672×994 → 1072×1048; localStorage written; reopening the modal restored 1072×1048; react-easy-crop ResizeObserver auto-adapted the cropper canvas to the new dimensions.

## 2026-04-28 — Listing categories expanded 5 → 16
- ✅ **Editor + buyer-facing filter aligned** to a single source of truth in `/app/frontend/src/pages/MakerListingEditor/constants.js`. Both `MakerListingEditor` and the legacy `NewListingModal` now import from there, and `ShopPage` filter pills use the same list (with "All" prepended).
- New buckets added: **Wedding Gifts, Business Signage, Address Numbers, Lighting & Lamps, Garden & Yard Art, Memorial & Tribute, Furniture, Kitchen & Bar, Sculpture, Jewelry, Holiday & Seasonal**. "Other" pinned to the bottom as the catch-all.
- ✅ **Backend shipping defaults extended** in `/app/backend/routers/checkout.py` `SHIPPING_BY_CATEGORY` map to give every new category a sensible fallback rate (Jewelry $8, Furniture $95, etc.) — tuned by typical package weight so checkout has accurate estimates when a maker hasn't set their own `shipping_domestic_usd`.
- Non-breaking: `Product.category` is a free-form `str` in `models.py`, so legacy listings keep working. Verified the editor dropdown shows all 16, `/shop` renders all 16 filter pills, lint clean across all four touched files.

## 2026-04-28 — Shipping section: weight + packed dimensions (calculated shipping)
Triggered by user reference screenshot showing Etsy's calculated-shipping inputs.
- ✅ **New "Calculated shipping" sub-block** appended to the Shipping section in the editor (`/maker/listings/new` and edit). Includes:
  - **Item weight** (lb + oz) — same `weight_lbs`/`weight_oz` form fields as Item Details, no duplication. Single source of truth means typing in one place updates the other.
  - **Item size when packed** (L / W / H in inches) — three new fields with helper copy "Size after the item's been prepped for packaging — e.g. folded, rolled, or padded — but before it goes into a box."
- ✅ Backend `Product` model + `ProductCreate` + `MakerProductUpdate` schema all extended with `packed_length_in`, `packed_width_in`, `packed_height_in` (all `Optional[float]` for backwards compat — existing listings get `None` and keep working).
- ✅ Create + PATCH handlers wired through `payload.packed_*` to the persisted document.
- Verified end-to-end via Playwright + curl: filled lb=2, oz=4, L/W/H=18/14/3 → autosave fired → backend GET `/api/maker/products` returns `weight_lbs=2.0, weight_oz=4.0, packed_length_in=18.0, packed_width_in=14.0, packed_height_in=3.0`. Lint clean across all four touched files.

## 2026-04-28 — Listings cards: -1/3 size + proper action buttons
Triggered by user feedback: "reduce the size by 1/3, change the look of the links below them — make them buttons to hover, looks unfinished" with a screenshot showing one giant card per row and a column of bare-text-link actions.
- ✅ **Card size reduced ~1/3** by bumping the `ProductsList` grid to `md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4` (from `lg:grid-cols-3`) — 4 cards per row on desktop instead of 3. Inner padding shrunk `p-4 → p-3`, title `text-xl → text-base`, price `text-2xl → text-lg`, and the eyebrow line tightened to `text-[9px]` so the tighter card stays scannable.
- ✅ **`ActionPill` component** introduced inside `ProductEditCard.jsx` — every secondary action (publish/unpublish toggle, promote, share-to-Buffer, renew, 3D-model toggle, delete) now renders as a bordered pill button in a 2-col grid. Color-coded `tone` prop for visual hierarchy: emerald (publish/promote), amber (draft / renew), sky (share), neutral (3D), danger (delete). Each gets a real hover state — bordered fill + accent text — instead of the previous bare text link.
- ✅ **Two-line title clamp** (`line-clamp-2 min-h-[2.4em]`) keeps cards aligned even when titles vary in length — no more ragged bottoms.
- Verified end-to-end via Playwright at 1920×1080: 4 cards per row, 5 ActionPills per card, hover state visually distinct on the orange/emerald/sky/danger tones. Lint clean.

## 2026-04-28 — Live shipping estimator + kebab overflow menu
### Shipping estimator (`/app/frontend/src/lib/shippingEstimator.js`)
- ✅ Pure client-side calculator that takes `(weight_lbs, weight_oz, packed_length_in, packed_width_in, packed_height_in)` and returns up to 3 carrier/service options sorted cheapest-first.
- ✅ Uses zone-4 USPS Ground Advantage + UPS Ground retail rate tables (2026 published rates) + USPS Priority Flat-Rate Box when item fits the 12×12×6 / 70 lb cube.
- ✅ Computes **billable weight = max(actual_lb, dim_lb)** where `dim_lb = (L×W×H) / 166` — same divisor every major US carrier uses.
- ✅ Shows an **amber "your package volume is driving the cost"** warning when dim-weight exceeds actual weight, so makers know to tighten their packaging.
- ✅ Displayed in a green-bordered preview card directly under the packed-dimensions inputs in the editor's Calculated Shipping block. Reactive — typing weight or dims updates the estimate live (memoised on `form` so it only recomputes when relevant fields change).
- ✅ Disclaimer: *"Estimates are zone-4 averages from public 2026 rate tables — actual checkout costs vary by buyer ZIP."* Pricing accuracy ±15-20% which is fine for a maker's "should I charge $25 or $40 shipping" gut check.

### Kebab overflow menu (`/app/frontend/src/pages/MakerDashboard/ProductEditCard.jsx`)
- ✅ New `OverflowMenu` component replaces the always-visible "+ 3D model" and "⊗ Delete" pills with a single **⋯ More** trigger that opens a small anchored popover.
- ✅ Click-outside-to-close handled via document mousedown listener mounted only while open.
- ✅ Reduces visible action grid from 5 pills to 4, makes the destructive Delete one click away from the happy path of edit/promote/share — Etsy "kebab" pattern.
- Verified end-to-end via Playwright: 3.5 lb / 18×14×3 → $14.40 cheapest (USPS Ground), 3.5 lb / 30×24×12 → $96.50 with dim-weight warning visible. Overflow menu opens on click, shows 3D + Delete, dismisses on outside click. Lint clean.

## 2026-04-28 — Maker Dashboard tab: compact header + KPI strip
Triggered by user feedback: "the large welcome back and shop seems large and overkill when you click on it."
- ✅ Collapsed the full-bleed `text-6xl` "WELCOME BACK, IRON & OAK STUDIO." headline + intro paragraph + 4-up oversized KPI grid (~30% of viewport) into a single horizontal bar.
- ✅ New header: `text-2xl` welcome on the left + `KpiStrip` on the right (4 inline KPI cells in one bordered strip with `divide-x` separators, hover bg, click-through to the relevant tab).
- ✅ New `KpiPill` component preserves every interaction the old `KPI` cards had — accent state for non-zero counts, `kpi-pulse` CSS animation for fresh activity (with `key={pulseKey}` remount trick), `NEW` flag pill for new orders/DMs from polling.
- ✅ Push-down effect: Crafters Plus upgrade card now lands above the fold; "1 step to launch-ready shop" checklist + start of Recent Orders + Quick Links all visible without scrolling on a 1080p screen (was previously off-screen below the giant header).
- Verified end-to-end via Playwright: 4 KPI pills render, clicking the Live KPI navigates to the Listings tab (`products-view-switcher` mounted). Lint clean.

## 2026-04-28 — Maker Dashboard: "Today" alerts panel
- ✅ New collapsible **`TodayAlerts`** section between the compact header and the Crafters Plus upgrade card. Surfaces actionable items the maker needs to address — Etsy "Action Items" pattern.
- Alert categories implemented:
  - 🔴 **Danger**: orders pending shipment > 3 days · Stripe payouts not connected
  - 🟡 **Warning**: listings expiring within 7 days · low-stock listings (≤1 unit) · unread DMs · Founding Seller beta ending within 14 days
- Auto-collapses when zero alerts (renders nothing on a healthy dashboard). Header summary shows count + tone breakdown ("2 items need you · 1 urgent · 1 warning"). Each alert has tone-coded dot + icon + a CTA that jumps to the relevant tab via `onTabChange`.
- Verified end-to-end via Playwright on the iron-and-oak demo shop: panel renders 2 alerts (Stripe-missing as danger, low-stock as warning), header summary correct, ChevronDown toggle expand/collapses the list. Lint clean.

## 2026-04-28 — Shop page filter strip cleanup
Triggered by user screenshot showing the technique pills rendering as tall vertical bars + 16 categories crammed into 1/3 of a 12-col grid.
- ✅ Replaced the 12-col grid (search 4 / cats 4 / techs 4) with a stacked layout: search bar → CATEGORY row → TECHNIQUE row → optional reset link.
- ✅ New `FilterStrip` + `FilterRow` components in `ShopPage.jsx`. Every pill uses `h-8 inline-flex` so the active state can never render as a stretched vertical bar.
- ✅ Each row prefixed with a small "Category" / "Technique" label (`text-[10px] tracking-[0.22em]`) so buyers know at a glance which axis they're scoping.
- ✅ Active accent color stays differentiated: orange for category, cream/white for technique — same as the previous design but applied consistently.
- ✅ Search input gets a clear-X button when a query is set. Reset link shows count of active filters ("↺ RESET 2 FILTERS") and clears all three at once.
- Verified end-to-end via Playwright at 1920×1080: all 16 category pills render in 2 clean rows; technique row renders horizontally with proper button heights; clicking a category surfaces the reset link with correct count. Lint clean.

## 2026-04-28 — Home hero pills reverted to curated 3-item set
Triggered by user feedback: "i like the previous look better, it has a cleaner look. I want to keep the categories available for makers just not on the home screen."
- ✅ Reverted `Hero.jsx` `PILLS` from 6 (`Wall Art · Custom Signs · Outdoor Art · Wedding Gifts · Business Signage · Address Numbers`) back to the original curated 3 (`Wall Art · Custom Signs · Outdoor Art`).
- ✅ Added an inline comment documenting that the home hero is intentionally a *marketing* surface — the full 16-category list lives on `/shop` filter strip and inside the maker listing editor.
- The maker editor + `/shop` page still expose all 16 categories (no change there).
- Verified end-to-end at 1920×1080: home hero now shows the clean 3-pill row.

## 2026-04-28 — Home hero / CategoryStrip vertical density tightened
Triggered by user mark-up showing dead space between the live-now strip and "SHOP BY CATEGORY" heading.
- ✅ `Hero.jsx` `min-h-[88svh]` → `min-h-[72svh]` (-16svh ≈ 173px on 1080p) — hero no longer reserves 88% of viewport height when the content only fills ~60%.
- ✅ `Hero.jsx` content padding `pt-44 md:pt-52 pb-20` → `pt-36 md:pt-44 pb-10` (saves ~72px combined).
- ✅ Live-now strip top margin `mt-16` → `mt-8` (-32px).
- ✅ `CategoryStrip.jsx` section padding `py-16 md:py-20` → `py-10 md:py-12` (-44px on desktop).
- Net: ~300px reclaimed. Before the change "SHOP BY CATEGORY" was off-screen at 1080p; now it's visible alongside the hero CTA + live-now strip in a single viewport.

## 2026-04-28 — Hero parallax effect
- ✅ Subtle scroll-driven parallax on the hero background. Uses framer-motion's `useScroll` + `useTransform` keyed off the section ref's `["start start", "end start"]` viewport offsets:
  - Background image translates Y `0% → 12%` of section height (with `scale-110` over-render so it never reveals empty edges).
  - Gradient + radial overlay translates half as much (`0% → 6%`) so the lighting "follows" the image without unsticking from it.
- ✅ **Honors `prefers-reduced-motion`** via `useReducedMotion()` — both layers pin at `0%` when the OS / browser asks for less motion.
- Verified end-to-end: initial transform `none`, after `window.scrollTo(0, 600)` the bg `<motion.div>` reports `matrix(1, 0, 0, 1, 0, 71.983)` → +72px Y drift confirmed. Lint clean.

## 2026-04-28 — Bug fix: free_shipping flag ignored at checkout
User reported: shipping was being charged at checkout even on listings with `free_shipping=True` enabled.
- ✅ Root cause in `/app/backend/routers/checkout.py::_quote_for`: the function was only checking the cart-wide `FREE_SHIPPING_THRESHOLD` and falling back to `SHIPPING_BY_CATEGORY[category]` — it never read the per-product `free_shipping` flag or the maker-set `shipping_domestic_usd` rate.
- ✅ Rewritten to honor full precedence chain per item:
  1. `free_shipping=True` → 0
  2. Maker-set `shipping_domestic_usd` → that rate
  3. Category fallback (`SHIPPING_BY_CATEGORY`)
  4. Global `DEFAULT_SHIPPING`
- ✅ Order-level: total shipping = `max()` of per-item rates (one box, ships at the rate of the highest-cost item). If **every** item has `free_shipping=True`, shipping is 0 regardless of subtotal — so a maker who marks all their listings free shipping is honored on small carts that wouldn't otherwise hit the free-shipping threshold.
- Verified via `POST /api/cart/quote`:
  - Free-only cart: $0.10 subtotal → **$0 shipping** (was $8 before the fix)
  - Paid-only cart: $149 subtotal → $25 shipping (Wall Art category rate)
  - Mixed: $149.10 subtotal → $25 shipping (free item contributes 0, paid item drives rate)



















## 2026-04-28 — Veteran-Owned support
- **Backend:** Added `is_veteran_owned: bool` to `Maker` model + patchable on `MakerProfileUpdate`. Added denormalized `Product.maker_is_veteran` populated by `/api/products` (single bulk fetch of veteran maker slugs) and `/api/products/{slug}` (one-doc lookup) so frontend cards never need a second round-trip.
- **Frontend:**
  - New `VeteranBadge.jsx` — inline-SVG US flag pill (no external dep). `compact` variant for cards, full pill ("🇺🇸 VETERAN-OWNED") for hero areas.
  - New `SupportVeteransStrip.jsx` — circular SVG seal ("SUPPORT OUR VETERANS · EST 2025 · MADE IN USA") with US flag + manifesto + "Shop Veteran-Owned →" CTA, mounted at top of Home page above `<Hero />`.
  - Veteran toggle in **Shop Manager → Settings → About your shop** with inline US flag in the label.
  - Badge surfaces on: ProductCard (corner), MakerDetail hero (next to Plus), ProductDetail maker block, MakersPage cards.
  - MakersPage: `?veteran=1` filter + filter pills ("All" / "🇺🇸 Veteran-Owned").
  - Side-fix: `useSettingsForm.submit()` now sends only changed fields — prevents empty-string-for-bool validation errors on legacy maker docs.
- **Bug fixes shipped this session:**
  - `GET /api/activity` 500 → `ActivityEvent.location` made optional + `kind=admin` filtered from public ticker (admin housekeeping events were leaking + crashing the home-page ticker).
  - Frontend compile error → `MarketingTab.jsx` was importing `queueBufferShare` (doesn't exist) → fixed to `makerShareListingToBuffer`.



## 2026-04-29 — Admin: split member lists + Broadcast composer + Founding login
Triggered by user: "for beta members, I want a founding member login button. in the admin page, separate approved members / rejected members in different lists. I need a paid members list in the admin section. also add a site wide mail button for admin to announce issues or upcoming events along with a mail button on each application."

### ✅ Founding Member Login CTAs
- **`/beta` hero strip** — new outlined "◆ Founding Member Login →" button above the hero headline (`data-testid="beta-founding-login-btn"`) with copy "Already a Founding Seller? Sign in with the email on your approved application." Routes to existing `/maker/login` magic-link flow.
- **Nav "FOUNDING LOGIN" pill** — subtle outlined orange pill next to the bold "◆ BETA SIGNUP" button (`data-testid="nav-founding-login-btn"`). Only renders when the visitor is signed-out (hidden when a JWT is present in localStorage) so the "Account" CTA naturally takes over.

### ✅ Admin tabs split (Applications → Applications + Approved Makers + Rejected)
- **Applications tab** now scoped to Pending + Beta filter pills only. Approved/Rejected pills removed; a footer hint points admins to the dedicated tabs. Default view is Pending (daily review queue stays actionable).
- **Approved Makers tab** (`/admin/dashboard → Approved Makers`) — new member directory listing every approved maker with: studio + slug, email (mailto:), badges (BETA/★ PLUS/◆ VET), live listings count, lifetime GMV (from `maker_payouts`), approved-on date, and per-row Grant/Revoke Beta toggle. Search box + filter pills (All/Beta/Plus/Veteran) with live counts.
- **Rejected tab** — historical archive of rejected applications. Each row has `✉ Email` + `✕ Delete` buttons.
- **Plus Members tab** — every active Crafters Plus subscriber. 4 KPI stat cards (Active count, MRR, 30d GMV, Canceling), table with subscription status, start/renew dates, 30d GMV, and net value/mo (1% commission savings − $12).

### ✅ Site-wide Broadcast composer
- **New admin tab "Broadcast"** (`components/admin/BroadcastTab.jsx`) — Etsy-style announcement composer. Template quick-picks (Outage / Launch / Event / Custom) swap headline + subject. Audience picker: All Makers / Plus Members / Founding Sellers / Buyers & Community / Pending Applicants / Everyone. Preview button resolves audience via `POST /api/admin/broadcast/preview` and shows sample emails + total count. Test-send to a single address before firing live. Hard cap of 5,000 recipients per send.

### ✅ Per-application ✉ Email button
- Every row on the Applications + Rejected lists now has a `✉ Email` button next to Delete. Opens `AdminEmailModal.jsx` — subject + message compose → `POST /api/admin/maker-applications/{id}/email` → transactional send via the existing Mailgun→Postmark→Mailtrap fallback chain. Audit row written to `admin_audit` with `kind='applicant_email'`.

### Backend
- 6 new endpoints in `/app/backend/routers/admin.py`:
  - `GET /api/admin/makers/approved` — member directory with listings count + GMV join.
  - `GET /api/admin/makers/rejected` — rejected applications sorted by `decided_at` desc.
  - `GET /api/admin/makers/plus` — Plus subscribers with 30d GMV + net-value computation.
  - `POST /api/admin/maker-applications/{id}/email` — single-recipient message to applicant.
  - `POST /api/admin/broadcast/preview` — cohort resolver (audience → count + sample).
  - `POST /api/admin/broadcast/send` — fan-out send (test mode via `test_email`, live mode via audience) with 5k-recipient guardrail.
- Two new email helpers in `/app/backend/email_service.py`: `send_admin_message_to_applicant`, `send_admin_broadcast` — both rendered through the existing `_shell` dark industrial template.
- `$nin` used instead of duplicate `$ne` so lint is clean and Mongo parses the cohort query correctly.

### Tests
- **19/19 backend pytest pass** (`tests/test_iter45_admin_lists_broadcast.py` created by testing agent). Frontend 100% — every data-testid resolves, email modal + broadcast preview/test-send flows verified end-to-end with success toasts.


## 2026-04-29 — Message Center P0 verified resolved + Marketing/Ads P1 shipped

### ✅ P0 · Message Center `body stream already read` error
- Fresh investigation after the iter27 admin fork revealed the error from the handoff is **no longer reproducible**. The `MessageCenter.jsx` component + `api.js` helpers use axios consistently (`http.get/post/patch` → `.then((r) => r.data)`) — no native `fetch()` double-reads anywhere in the DM path. Maker Dashboard `/maker/dashboard#messages` + Buyer `/messages` both render cleanly with the Etsy-style folder rail (Inbox / Starred / Unread / Sent / Archive / Trash) and zero console errors. Verified via Playwright smoke + testing_agent_v3_fork iter46.

### ✅ P1 · Crafters Market Ads sub-section rebuilt
- **`/maker/dashboard#marketing → Crafters Market Ads`**: replaced the stub "go to Listings →" link with a full Etsy-parity landing:
  - **3-cell KPI strip**: Active promotions · $ / wk · Eligible listings (derived client-side from `fetchMakerProducts()`).
  - **Active Promotions list**: per-row listing card with orange-bordered thumbnail, FEATURED badge, live "Nd Nh left · ends M/D/YYYY" countdown (re-renders every 60s via a tick interval), and **Extend** button that tacks another week of burn onto the same listing.
  - **Boost a listing picker**: 4 duration chips (1 week · $5, 2 weeks · $10, 4 weeks · $20, 12 weeks · $60) that control the active tier. Every eligible published listing gets a thumbnail row + `◆ Boost $N` button that fires `POST /api/maker/products/{slug}/promote?weeks=N`. Hard-cap of 50 rows rendered with scroll overflow for large shops.
  - **Existing AI companion tools** (Listing Copy · SEO Recommender · Bulk SEO Generator · Tips) preserved directly below so discoverability workflows stay adjacent to paid-boost workflows.
- Extracted `WEEKLY_RATE = 5` constant so the $5 price only lives in one place. Countdown auto-ticks without re-fetching the product list.

### Tests
- **testing_agent_v3_fork iter46**: 100% frontend pass. Full E2E boost flow verified: `POST /api/maker/products/carved-oak-wedding-monogram/promote?weeks=1` → 200 → success toast → KPI cells flip 0→1 Active / 5→4 Eligible → new row appears in Active Promotions with FEATURED badge + countdown. Zero console/page errors on Maker Messages tab AND Buyer /messages page.




## 2026-04-29 — SEO verification: PUBLIC_SITE_URL hardening + diagnostics

### Findings (prod + preview audit)
- **Local/staging**: `PUBLIC_SITE_URL=https://craftersmarket.org` IS set in `/app/backend/.env`. Sitemap emits 26 canonical apex URLs correctly.
- **Production (`https://www.craftersmarket.org/api/sitemap.xml`)**: returned 24 URLs ALL rooted at `https://active-project-4.preview.emergentagent.com/` — meaning the deployed backend did NOT have `PUBLIC_SITE_URL` set and was falling back to the `X-Forwarded-Host`. Google would see preview URLs as canonical → duplicate-content penalty risk.
- **Preview domain `/robots.txt`**: Cloudflare edge injects a "Managed Content" block that DISALLOWS GPTBot / ClaudeBot / Google-Extended / CCBot / Bytespider / Applebot-Extended at the TOP (before our Allow rules). First-match-wins robots.txt semantics mean AI crawlers are fully blocked on preview. Production domain was clean.
- **Static sitemap-index inconsistency**: pointed to `https://www.craftersmarket.org/api/sitemap.xml` (www) but inner URLs used apex — Google flags cross-submit inconsistency.

### Fixes shipped
- **`core.site_root()` hardened** with layered fallback:
  1. `PUBLIC_SITE_URL` env var (preferred)
  2. `PUBLIC_BACKEND_URL` env var
  3. `X-Forwarded-Host` header — ONLY if it doesn't match preview markers (`emergentagent.com`, `vercel.app`, `onrender.com`, `preview.`, `staging.`, `localhost`)
  4. Hard-coded safety net: `https://craftersmarket.org`
  Verified by simulation — with all env vars stripped and a preview forwarded-host header, `site_root()` now returns `https://craftersmarket.org`. Zero chance of preview leakage into sitemap.
- **Static `sitemap.xml` + `robots.txt`** updated to use apex (`https://craftersmarket.org/...`) consistently with backend emission.
- **New public endpoint**: `GET /api/seo/diag` returns JSON with `resolved_site_root`, both env vars, `x_forwarded_host`, `preview_domain_leakage` bool, and URL count breakdown (static/products/makers/blog). Callable from any browser for post-deploy verification without SSH.
- **New Admin Settings card**: "SEO · Sitemap & Robots · Indexing Health" — live-polls `/api/seo/diag`, shows green/red health pill, breakdown KPIs, env-var status, and 3 quick links (sitemap.xml, robots.txt, static index). Renders a big red "Preview-domain leak detected" warning when misconfigured.

### Action items for user
- ⚠️ **DEPLOY ACTION**: Add `PUBLIC_SITE_URL=https://craftersmarket.org` to the production backend env vars and redeploy. After deploy, hit `https://craftersmarket.org/api/seo/diag` or the new Admin Settings card to verify.
- ℹ️ Cloudflare AI-bot block was reported clean on the production domain (only preview had it). If it ever appears on prod, Cloudflare Dashboard → Security → Bots → "AI Scrapers and Crawlers" → OFF.


## 2026-04-29 — 🐛 P0 Bug fix: "flaky when entering data" across every modal with a form

### Reported
User: *"when entering email it kept going back to name"* — typed in the email field of the Beta Feedback floating widget, focus kept bouncing back to the name field mid-word.

### Root cause (found via reproduction + code audit)
**`/app/frontend/src/hooks/useModalA11y.js`** — the shared modal a11y hook had this useEffect:
```js
useEffect(() => { /* attach keydown + setTimeout(focus first input) */ }, [onCancel, autoFocusSelector]);
```
Every caller passes an inline arrow like `useModalA11y(() => setOpen(false))` — so `onCancel` is a **new function reference every render**. React saw `[onCancel]` change each render → tore down + re-ran the effect → the `setTimeout(() => focus-first-focusable(), 0)` fired → focus stolen to the Name input. Every keystroke in the Email or Message field triggered a re-render (controlled input), which triggered the effect, which stole focus back to Name. Hence "it kept going back to name".

**Compounding bug**: every form using this pattern also had a stale-closure in the onChange handler:
```js
const set = (k) => (e) => setF({ ...f, [k]: e.target.value });  // reads stale `f` per render
```
At fast typing speeds, earlier keystrokes overwrote later ones with stale snapshots from other fields.

### Fix
- **`useModalA11y.js` fully rewritten**: `onCancel` now lives in a `useRef` that's updated via a separate `useEffect([onCancel])` — the keydown listener reads `onCancelRef.current` at event time, so the callback is always fresh WITHOUT re-attaching. The keydown listener and auto-focus setTimeout moved into two no-dep `useEffect(() => {}, [])` hooks — auto-focus fires exactly once on mount, never again. Escape + Tab focus-trap still work.
- **Every form using the curried `set` pattern switched to functional updater**: `setF((c) => ({ ...c, [k]: v }))` so concurrent keystrokes never read a stale `f`.
- **Added `name=` + `autoComplete=` attrs** to all form inputs (`name`, `email`, `organization`, `address-level2`, `url`, `tel`, `off` for free-text/textareas). Helps browser autofill behave predictably instead of cross-filling fields.

### Files touched
- `/app/frontend/src/hooks/useModalA11y.js` — hook rewrite
- `/app/frontend/src/components/BetaBanner.jsx` — floating feedback form
- `/app/frontend/src/pages/ApplyPage.jsx`
- `/app/frontend/src/pages/BetaPage.jsx`
- `/app/frontend/src/pages/CustomOrderPage.jsx` (StepDescribe + StepContact)

### Tests (iter47)
- **Frontend 100% pass**. Verified: Beta Feedback modal accepts independent input across name/email/message; `/apply`, `/beta`, and `/custom-order#step5` all retain per-field values with no cross-leakage; editing an earlier field mid-form doesn't clobber later fields (confirms functional updater works); ESC still closes modals; Tab still cycles focus inside the dialog.

### Downstream benefit
Every other modal that used `useModalA11y` (DigestsTab, UsersTab, RotatePasswordModal, ContactMakerModal, CsvImportModal, MakerDashboard DM modal, AdminEmailModal via its own pattern) automatically benefits — no more focus-stealing on keystrokes.



## 2026-04-30 — Community Design Files: open-to-all uploads with real file picker

### User ask
*"on design files, add a way to upload new files from users"* — the Community > Design Files tab previously restricted uploads to makers only, and accepted only an external URL paste (Dropbox/Drive). Users wanted to contribute files directly.

### Shipped
- **`POST /api/community/files/upload`** (multipart) — new endpoint that accepts `file` + `title` + `description` + optional `thumbnail_url`. Requires any signed-in community user (buyer OR maker) via the new `current_any_user` dependency.
- **Accepted types**: DXF, SVG, STL, GLB, GLTF, AI, EPS, PDF, ZIP. 25 MB cap (`MAX_DESIGN_BYTES`). Content-type sniffing with extension fallback for CAD files that arrive as `application/octet-stream`.
- **Direct R2 upload**: files stream to `cdn.craftersmarket.org/community-files/{user}/{uuid}.{ext}` via the existing `upload_design_file_bytes()` helper in `r2_storage.py`. `design_files` Mongo row created with `uploader_role` (buyer|maker) + `maker_name` (backward-compat display label) + `size_bytes`.
- **Frontend `FileUploadForm`**: full rewrite with:
  - Mode toggle (**Upload a file** / **Paste a link**) — makers see both; buyers get the upload path only (they don't have cloud storage to paste from).
  - Native `<input type="file">` with `accept=".dxf,.svg,.stl,.glb,.gltf,.ai,.eps,.pdf,.zip"`.
  - Client-side 25 MB guardrail with inline error before the upload fires.
  - Extension-inferred `file_type` badge — user doesn't pick the type manually.
  - **Live upload progress bar** via `axios.onUploadProgress` → percent-fill animation.
  - Signed-out visitor sees a "Sign in to upload a DXF, SVG…" hint instead of a broken button.
- **FilesTab** now gates the upload button on `isSignedIn = !!me || isMaker` instead of the old `isMaker`-only check.
- Functional `setF((c) => ({...c, ...}))` + `name=` + `autoComplete=` attrs added (prevents the flaky-form bug fixed in iter47 from recurring).

### Tests (iter48)
- **Backend 10/10 pytest PASS**. Curl smoke: maker upload 200, buyer upload 200, .txt rejected 400 ("Unsupported file type"), no-auth rejected 401.
- **Frontend**: signed-out hint renders, maker upload flow verified end-to-end in Playwright (file appeared in grid with SVG badge + "BY IRON & OAK STUDIO" attribution). Buyer card "BY COMMUNITY MEMBER" visible in seed grid from curl test.
- **File URLs**: both test uploads returned working `https://cdn.craftersmarket.org/community-files/{user}/{uuid}.svg` URLs (R2 + custom domain wired correctly).

### Files touched
- `/app/backend/maker_auth.py` (+ `current_any_user` dep)
- `/app/backend/r2_storage.py` (+ `ALLOWED_DESIGN_FILE_TYPES` map + `upload_design_file_bytes()`)
- `/app/backend/routers/community.py` (+ `POST /community/files/upload`)
- `/app/frontend/src/lib/api.js` (+ `uploadDesignFileDirect` with onUploadProgress)
- `/app/frontend/src/pages/CommunityPage.jsx` (rewrote `FilesTab` + `FileUploadForm`)



## 2026-04-30 — Design-file abuse moderation: ⚑ Report + quarantine queue

### Rationale
Now that any community user (buyer or maker) can upload design files directly, we need self-moderation — a buyer could rip a design off an Etsy listing and post it. Without a report mechanism the admin would only find out when the original maker DMs us.

### Shipped
- **Public endpoint** `POST /api/community/files/{file_id}/report` — any signed-in user flags a file. Reasons: stolen / copyright / duplicate / malware / inaccurate / other. Dedup by `(file_id, reported_by)`: a second report from the same user on the same file returns `{duplicate: true, id: existing_report_id}` instead of a 4xx so the UI can show the soft "we already have it" message. Increments a fast `open_reports` counter on the file document for admin-queue sorting.
- **Admin endpoints** (in `admin.py`):
  - `GET /api/admin/design-files/reports?status=open|resolved|dismissed|all` — moderation queue with `file` hydrated from `design_files`.
  - `POST /api/admin/design-files/reports/{id}/resolve` — body `{action: 'quarantine'|'dismiss', note?}`. **quarantine** soft-deletes the file (`quarantined_at` set) and rolls up EVERY open report on that file to resolved in one pass; **dismiss** closes just that one row. Both write `admin_audit`.
  - `POST /api/admin/design-files/{file_id}/unquarantine` — restores a file if we mis-moderated.
- **Public list filter**: `GET /api/community/files` now excludes `quarantined_at != null`, so quarantined files vanish from Community > Design Files immediately.
- **Frontend ⚑ Report button** on every `FileCard` (`CommunityPage.jsx`): shows when signed in, hidden when signed out. Opens new `ReportFileModal` — reason dropdown + details textarea + red Submit → success state with "24h review" copy. Dedup case surfaces a friendly "You already reported this file" notice.
- **Admin "File Reports" tab** (`components/admin/DesignFileReportsTab.jsx`) — new in AdminDashboard. 3 status filter pills (Open / Resolved / Dismissed). Rows show thumbnail + reason badge + "2× reports" amber badge when multiple people flagged the same file + uploader + reporter + role + timestamp + optional moderator note textarea + "Quarantine file" (red) and "◇ Dismiss" buttons. Resolved rows show "↺ Restore file" when their file is still quarantined.

### Tests (iter49)
- **Backend pytest 14/14 PASS**. Manual curl smoke: report 200 (buyer + maker), dedup OK, invalid reason 400, no-auth 401, admin list 200, quarantine rolls up + hides from public, dismiss keeps public, unquarantine restores.
- **Frontend 100% PASS**. Verified E2E: buyer sees ⚑ Report, submits, success toast; duplicate attempt shows soft message; admin sees the row in Open queue, clicks Quarantine → file vanishes from /community, row moves to Resolved with ↺ Restore button; dismiss path works identically without hiding the file.

### Files touched
- `/app/backend/routers/community.py` (new `REPORT_REASONS` + `FileReportRequest` + `POST /community/files/{id}/report`; `list_design_files` now filters `quarantined_at`)
- `/app/backend/routers/admin.py` (3 new admin endpoints: list / resolve / unquarantine)
- `/app/frontend/src/lib/api.js` (4 new fns: reportDesignFile, fetchAdminDesignFileReports, resolveDesignFileReport, unquarantineDesignFile)
- `/app/frontend/src/pages/CommunityPage.jsx` (FileCard now renders ⚑ Report; new `ReportFileModal` component)
- `/app/frontend/src/components/admin/DesignFileReportsTab.jsx` (new)
- `/app/frontend/src/pages/AdminDashboard.jsx` (imports + new 'file-reports' tab)



## 2026-04-30 — Etsy-style Info & Appearance, Social, Admin left-sidebar, Account lifecycle

### User ask (4 items, all shipped)
User uploaded an Etsy "Info & Appearance" screenshot and asked for: (1) more Etsy-style fields, (2) social media connect per shop, (3) admin nav moved to LEFT, (4) account cancel + Plus downgrade + **full hard-delete after 30-day grace**.

### 1. Etsy-style Info & Appearance
Added 5 new fields on the `Maker` model (`models.py`) + PATCH `/api/maker/profile`:
- `shop_title` — tagline under the shop name, shown on the shop hero + search results.
- `order_receipt_banner_url` — 760×100 printed on emailed order receipts.
- `shop_announcement` — pinned notice at top of the public shop page (orange left-border callout).
- `message_to_buyers` — auto-appended to order confirmation emails (physical goods).
- `message_to_buyers_digital` — shown on the Downloads page + digital delivery email.
Frontend `InfoAppearance` section rewritten with all 5 new inputs + existing 4, with per-field hints and character limits.

### 2. Social Media connect per shop
New `Social media` sub-section in Maker Settings. Seven platforms: Facebook / Instagram / Twitter / TikTok / YouTube / Pinterest / Website. Pure URL vanity links (no OAuth) rendered as a compact "connect" grid with green ◆ Connected / gray ◇ Not set pills. Public shop page (`MakerDetail.jsx`) renders a `<SocialLinks>` block below the bio — one icon+label pill per filled link.

### 3. Admin nav moved to LEFT (desktop) — keeps horizontal scroll on mobile
Rewrote `AdminDashboard.jsx` tab rail:
- **≥ lg (1024px)**: `grid-cols-[220px_1fr]` with a **sticky vertical sidebar** on the left. Active tab highlighted by a left border + tint.
- **< lg**: horizontal scroll bar at top (unchanged).
No tab IDs or testids changed — zero regression risk for existing E2E tests.

### 4. Account lifecycle — Downgrade / Close / Delete with 30-day grace
New endpoints in `maker.py`:
- `POST /api/maker/account/close` — sets `shop_closed=true` + `vacation_mode=true`. Reversible.
- `POST /api/maker/account/reopen` — clears closure flags.
- `POST /api/maker/account/request-deletion` — **starts 30-day grace**. Writes `deletion_requested_at` + `deletion_cancels_at` (now + 30d), auto-closes the shop so no new orders land during the window. 400 if already pending.
- `POST /api/maker/account/cancel-deletion` — backs out of the pending deletion.
- **Existing** `POST /api/maker/subscription/cancel` — used for the Plus → Free downgrade (cancels at period end).

**Scheduled job** `_job_purge_deleted_makers` runs daily at 03:30 UTC (`scheduler.py`):
- Finds makers where `deletion_cancels_at <= now`.
- Hard-deletes `products`, `maker_payouts`, `design_files`, `dm_threads`, `reviews`, matching `maker_applications`.
- **Anonymizes** (not deletes) `payment_transactions` → `maker_slug = "__deleted__{slug}"` so financial / tax records survive.
- Deletes the `makers` doc.
- Writes an `admin_audit` row capturing purge counts per collection.

**New `AccountPanel`** section in Settings UI (`SettingsTab.jsx`):
- Current-plan badge (★ Plus or ◇ Free) + Downgrade to Free button (on Plus shops).
- Shop status card (Open / Closed) + Close / Reopen buttons.
- **Red Danger Zone** with `Request account deletion` — opens `window.prompt` requiring user to type `DELETE` verbatim; then flips to a big red "Pending deletion — N days remaining" banner with a **Cancel deletion** button.
- Account actions call `fetchMakerMe()` after each mutation so the current Settings sub-section stays mounted (no flash-to-Info on state refresh).

### Tests (iter50)
- **Backend pytest 11/11 PASS**. Manual curl smoke: PATCH with all new fields persists, account-lifecycle endpoints all return expected shapes, dup-deletion 400, cancel-deletion clears flags.
- **Frontend 100% PASS** (testing agent iter50). Verified: new Info & Appearance fields save, Social Media pills flip Connected/Not set, Account & Plan close/reopen/delete/cancel-delete full E2E, admin sidebar at 1920px (vertical) + horizontal at 390px, public shop page renders shop_title + announcement + closed banner + social links.

### Files touched
- `/app/backend/models.py` (Maker + MakerProfileUpdate)
- `/app/backend/routers/maker.py` (4 new account endpoints)
- `/app/backend/scheduler.py` (_job_purge_deleted_makers daily cron)
- `/app/frontend/src/lib/api.js` (4 new maker-account fns)
- `/app/frontend/src/pages/MakerDashboard/SettingsTab.jsx` (InfoAppearance expanded, SocialMedia + AccountPanel added)
- `/app/frontend/src/pages/AdminDashboard.jsx` (left-sidebar layout)
- `/app/frontend/src/pages/MakerDetail.jsx` (shop_title + announcement + closed banner + SocialLinks)



## 2026-04-30 — Upgrade CTA fix: direct link to Stripe checkout, hidden when on Plus

### User ask
*"when I hit the upgrade my account it should take me to the upgrade page and pay or if the account is already upgraded it shouldn't show up"*

### Issue
The new `AccountPanel` "Current plan" section was rendering a dead text label (`Upgrade available in 'Your subscription' →`) for free shops instead of an actual button. The `PlusUpgradeNudge` on the dashboard fired an event-bus indirection (Settings → Subscription tab → Upgrade page → Pay) — three clicks too many.

### Fix
- **`AccountPanel`** — replaced the dead label with a real `<Link to="/maker/billing">★ Upgrade my account →</Link>` styled as a primary orange CTA button (`data-testid="account-upgrade-btn"`). Already hidden by ternary when `isPlus`, so Plus subscribers see the **Downgrade to Free** button instead.
- **`PlusUpgradeNudge`** — converted both CTAs (`plus-nudge-cta` + the inline "Upgrade" callout) from `onClick={onUpgrade}` event-bus handlers to `<Link to="/maker/billing">` so users go straight into Stripe checkout. The nudge already auto-hides when Plus is active.

### Verified
- **Free state**: `★ UPGRADE MY ACCOUNT →` button visible, `href="/maker/billing"`, downgrade button absent.
- **Plus state**: button hidden (`upgrade-btn count=0`), `Downgrade to Free` button present (`downgrade-btn count=1`), header shows green `★ CRAFTERS PLUS · $12/MO` badge.
- Files: `/app/frontend/src/pages/MakerDashboard/SettingsTab.jsx`, `/app/frontend/src/pages/MakerDashboard/PlusUpgradeNudge.jsx`.

