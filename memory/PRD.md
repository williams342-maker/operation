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
- iter6: AI memory bug + cart gift-note persistence — **fixed and verified**
- iter7: Stripe Connect Express + regression sweep — **20/20 backend tests pass**
- iter9 (this run): 5 backlog follow-ups — **10/10 isolated · 140/140 full suite**
  1. `account.updated` Connect webhook (`POST /api/webhook/stripe/connect`) syncs maker.stripe_* fields
  2. Forum @mentions parity with chat (12s poll, ding sound, desktop notif, `data-testid='forum-reply-mentioned'`)
  3. Admin refund flow (`POST /api/admin/orders/{sid}/refund`) — full reversal: refund Stripe charge + reverse all maker transfers + cancel deferred payouts. Idempotent via `idempotency_key`. Admin UI button on Paid Orders tab
  4. E2E unlock flow validated: 5 free downloads → paywall → checkout pre-records pending unlock → webhook activation → unlimited downloads (paid_unlock_active=true)
  5. Buyer Google OAuth backend wiring sanity (invalid session_id → 401, empty body → 422)

## Backlog
- (Optional) Pause forum poll when `document.hidden=true`, resume on `visibilitychange` (perf)
- (Optional) Per-maker analytics tab in admin

## Next Action Items
- (Future) Optional UI polish: pause forum thread polling when tab hidden
- (Future) Verify Emergent Google OAuth happy-path with real Google session (current gating-only verified)
