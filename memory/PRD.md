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

## Recently Shipped (2026-04-26)
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
- **Plus banner upload UI** — `Maker.banner_image_url` exists in the model but no upload endpoint yet; surface in profile editor.
- **Real off-site ad spend** — currently attribution-only. To actually drive traffic from Google/Meta, wire Google Ads / Meta Marketing APIs (requires user credentials + ad budget).
- **Subscription billing portal** — Stripe Customer Portal link so makers can update their card / view invoices.
- (UX) Surface "soft-delete does NOT refund listing fee" disclosure in BillingTab.

## Backlog (other)
- (Deferred) Refactor `MakerDashboard.jsx` (~1500 lines) into per-component files
- (UX) Replace native `window.confirm()` on listing delete + promote
- (Awaiting DNS) Custom CDN domain `cdn.craftersmarket.org` — guide ready at `/app/memory/R2_CUSTOM_DOMAIN_SETUP.md`
- (Optional analytics) Cohort retention, bounce-rate-by-page, Discord/Slack live-visitor ping

## Next Action Items
- Whenever convenient: DNS step for `cdn.craftersmarket.org` then `swap_r2_host.py`
- (Optional) Plus banner upload + Stripe Customer Portal (small wins)
