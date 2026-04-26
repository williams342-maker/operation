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

## Recently Shipped (2026-04-26 — iter36 · AI Moderator + Ads Foundation + Refire Emails)
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
