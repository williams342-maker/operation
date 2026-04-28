# Crafters Market — Modernized Homepage + Full Marketplace

## Original Problem Statement
> "look at my current website craftersmarket.org make it more modern and dynamic"

User selected: **Bold editorial / industrial** aesthetic. Scope expanded into a full multi-vendor marketplace with maker portal, admin console, community hub, AI assistant, 3D viewer, transactional emails, and Stripe payouts.

## Architecture
- **Backend:** FastAPI + Motor (async MongoDB), modular routers under `/app/backend/routers/`.
  - `catalog`, `seo`, `checkout`, `maker`, `stripe_connect`, `admin`, `ai`, `community`.
- **Frontend:** React 19 + React Router + Tailwind + Framer Motion + react-fast-marquee + @google/model-viewer.
- **Theme:** Anton/JetBrains Mono dark industrial (`#0a0a0a` / `#ff4500`).
- **Payments:** Native `stripe` SDK (15.0.1) for Connect Express + Checkout Sessions; `emergentintegrations` StripeCheckout for webhook verification.
- **AI:** Emergent LLM Key (Claude Sonnet 4.5) with per-session transcript replay for memory.
- **Auth:** Magic-link (`itsdangerous`) for makers/admins/buyers; JWT for sessions.

## Collections
products · makers · reviews · blog_posts · custom_orders · maker_applications · activity_events · payment_transactions · ai_chats · download_unlocks · maker_payouts · community_users · community_messages · community_threads · community_files

## Public + Private Routes
- `/`, `/shop`, `/shop/:slug`, `/makers`, `/makers/:slug`, `/journal`, `/cart`, `/checkout/success`, `/contact`, `/policy`, `/community`, `/community/login|verify|auth/callback`
- Maker: `/maker/login|verify|dashboard`, `/maker/stripe/return`
- Admin: `/admin/login|verify|dashboard`

## What's Implemented (cumulative)
- ✅ Bold industrial homepage (Hero, Showcase, Categories, Process, ForMakers, Reviews, CustomCTA, Live Activity Ticker)
- ✅ Marketplace: 11 routed pages, Stripe Checkout Sessions, server-priced cart, polling status, cart context + localStorage, custom-order/apply forms, journal
- ✅ Maker self-serve portal: magic-link auth, profile/listing edit (incl. `.glb` 3D model URLs), order viewing
- ✅ Admin console: 4 tabs — Analytics, Users, Listings, Reviews — with magic-link auth + moderator delete
- ✅ Community Hub: WebSockets AIM-style chat (presence, typing, cross-channel unread badges, @mentions, desktop notifs), forums with @mentions, Showcase auto-link to product/maker, monetised design files ($5 unlock after 5 downloads / 6 months)
- ✅ AI Assistant: Emergent LLM Key, persistent session_id (frontend localStorage + backend transcript replay)
- ✅ 3D viewer (`@google/model-viewer`) on product pages
- ✅ Transactional emails via Resend (buyer receipt, ops alert, per-maker alert, magic links)
- ✅ Shipping & tax engine (Stripe `automatic_tax`)
- ✅ SEO module (sitemap.xml, robots.txt, JSON-LD)
- ✅ Cart "gift note" textarea persisted to localStorage (cleared on paid)
- ✅ CheckoutSuccess "create account" prompt for guest buyers
- ✅ **Stripe Connect Express** (2026-04-26):
  - `POST /api/maker/stripe/connect/onboard` creates Express account (idempotent — reuses existing acct_id) and returns Account Link URL
  - `GET /api/maker/stripe/connect/status` syncs charges_enabled / payouts_enabled / details_submitted
  - `POST /api/maker/stripe/connect/dashboard-link` returns Express dashboard login link
  - Checkout Session injects `payment_intent_data.transfer_group` (deterministic per order)
  - On payment success (both webhook + status polling paths) `transfer_to_makers_for_session` runs as background task: groups items by maker, creates one `Transfer` per maker with `idempotency_key=session_id:maker_slug`. Makers without onboarding get a `deferred` row in `db.maker_payouts`. Platform fee = 10% (`PLATFORM_FEE_BPS=1000`)
  - Maker dashboard "Payouts" tab: state machine (Connect → Continue Onboarding → Open Stripe Dashboard) + payout history table
  - `/maker/stripe/return` landing page after Stripe-hosted onboarding

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

## Backlog (revenue-stream items)
- **Listing-credit packs** — alternative to per-payout settlement: prepaid $5/$25/$100 credit packs.
- **Real off-site ad spend** — currently attribution-only. To actually drive traffic from Google/Meta, wire Google Ads / Meta Marketing APIs (requires user credentials + ad budget).
- **Stripe Customer Portal config** — one-time dashboard step (Settings → Billing → Customer Portal). Endpoint already returns friendly 502 if missing.
- (UX) Surface "soft-delete does NOT refund listing fee" disclosure in BillingTab.

## Backlog (other)
- (Deferred) Refactor `MakerDashboard.jsx` (~1500 lines) into per-component files
- (UX) Replace native `window.confirm()` on listing delete + promote
- (Awaiting DNS) Custom CDN domain `cdn.craftersmarket.org` — guide ready at `/app/memory/R2_CUSTOM_DOMAIN_SETUP.md`
- (Optional analytics) Cohort retention, bounce-rate-by-page, Discord/Slack live-visitor ping

## Next Action Items
- 🟢 **P7 — Real off-site ad spend** (Google Ads / Meta Marketing API) — needs user-supplied API credentials.
- 🟡 **P14 — UX polish backlog** still on the table from the offered list:
    - (e) Loading skeletons replacing "Loading…" text on all dashboards
    - (f) Empty-state illustrations with CTAs (e.g. "No orders yet — share your shop link")
    - (g) Mobile responsive pass on `/admin/dashboard` (12-tab bar overflows on phones; needs sticky/scrollable)
    - (j) Scheduled-toggle for site switches ("turn maintenance ON at 02:00 UTC tonight, OFF at 04:00 UTC")
    - (k) Per-channel chat moderation (delete a single message; mute a user from one room only)
    - (l) Order-level admin tools (refund partials, reissue maker email, refire transactional emails)
    - (d) Backend `routers/community.py` domain split (~750 lines → community_auth/forum/chat/showcase)

---

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

## Outstanding Backlog
- **P2** Multi-tier Admin Team & Role Management (spec above).
- **P2** Shopify CSV Import (Etsy mapping done; Shopify needs different mapping).
- **P3** Dormant buyer retention — Kit.com automated tagging + auto-trigger discount.

## Blocked (waiting on user)
- Mailtrap DNS verification in Cloudflare (Postmark covers 100% of mail in the meantime — no buyer impact).
- Google Ads Developer Token (22-char) for off-site ad spend integration.

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





