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
- iter10: 3 backlog items (forum poll pause, per-maker analytics, Google OAuth wiring) — **147/147**
- iter11: Web analytics — **161/161**
- iter12 (this run): GMV mini-charts + 7d-vs-prior-7d deltas + dwell tracking — **9/9 new · 170/170 full suite**
  1. **Weekly GMV mini-chart**: backend adds `weekly_gmv: [{week_start, total}]` (12 buckets, Mon-anchored, oldest first) to BOTH `/admin/analytics` and `/admin/maker-analytics/{slug}`. Frontend `<Sparkline>` component (CSS-only, zero deps) shows 12 bars with current-week highlighted in orange + auto direction badge (▲ ▼ — / NEW)
  2. **7d-vs-prior-7d deltas**: `/admin/analytics/web` now returns `deltas: {views, visitors, sessions}` each `{current, prior, delta_pct, direction}`. Frontend `<DeltaBadge>` renders ▲ +X% in emerald, ▼ -X% in red, — flat in grey, ✦ NEW in orange. Wired into 3 of 4 headline `<Stat>` cards
  3. **Time-on-page tracking**: `/api/analytics/track` returns `event_id` (UUID); `/api/analytics/dwell` accepts `{event_id, dwell_ms}` and updates the row using `$max` (longest reading wins, never shrinks). Capped at 30 min. Frontend tracker uses `visibilitychange` + `pagehide` + `beforeunload` + `navigator.sendBeacon` for reliable flush. Top Pages now shows `count · 4.2s` average dwell

## Backlog
- (Optional) Live-now indicator (distinct visitor_ids in last 5 min) on admin nav
- (Optional) Bounce-rate panel (sessions with exactly 1 pageview)

## Next Action Items
- (Future) Verify Google OAuth happy-path with a real Google session (one-time human click)
- (Future) Add `account.updated` Connect webhook to your Stripe Dashboard (one-time setup on stripe.com)
