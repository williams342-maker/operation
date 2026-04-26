# Crafters Market — Modernized Homepage + Full Marketplace (Handoff Build)

## Original Problem Statement
> "look at my current website craftersmarket.org make it more modern and dynamic"

User selected: **Bold editorial / industrial** aesthetic, animation, modernized for handoff. Then expanded scope to **a + b + c**: full marketplace build, Live Makers ticker enhancement, and P2 backlog.

## Architecture
- **Backend:** FastAPI + MongoDB (Motor), Stripe Checkout (test mode via `emergentintegrations`)
- **Frontend:** React 19 + React Router + Tailwind + Framer Motion + react-fast-marquee
- **Theme:** Anton/JetBrains Mono dark industrial (`#0a0a0a` / `#ff4500`)

## Backend (/app/backend/server.py)
**Collections:** products, makers, reviews, blog_posts, custom_orders, maker_applications, activity_events, payment_transactions

**Endpoints (all `/api`):**
- `GET /products` (filter: category/technique/q/featured/maker), `GET /products/:slug`
- `GET /makers`, `GET /makers/:slug`
- `GET /reviews`, `GET /blog`, `GET /blog/:slug`
- `GET /activity` — live makers ticker feed
- `POST /custom-orders` — custom order brief (creates activity event)
- `POST /maker-applications` — maker apply form (creates activity event)
- `POST /checkout/session` — Stripe checkout (server-side priced from MongoDB; never trusts FE prices)
- `GET /checkout/status/:session_id` — polling endpoint; on `paid`, emits a "sold" activity event
- `POST /webhook/stripe` — Stripe webhook handler

Auto-seeds 6 products, 2 makers, 4 reviews, 3 blog posts, 6 activity events on startup if collections are empty.

## Frontend Pages
- `/` — Animated home (Hero → Showcase → Categories → Process → ForMakers → Reviews → CustomCTA)
- `/shop` — Search + category + technique filters; product grid
- `/shop/:slug` — Product detail with image gallery, qty, add-to-cart, maker callout
- `/makers` — Maker roster grid
- `/makers/:slug` — Maker detail + their listings (cinematic cover hero)
- `/custom-order` — Brief form (name, email, project type, material, size, budget, description)
- `/apply` — Maker application form (multi-select techniques)
- `/journal` + `/journal/:slug` — Blog index + detail
- `/cart` — Cart with qty controls, persistence via localStorage, Stripe checkout button
- `/checkout/success` — Stripe redirect handler with polling (max 8 tries) and cart auto-clear on `paid`

## Highlights
- **Live Activity Ticker** at the top of every page (cycles every 3.5s, refreshes from API every 30s, color-coded by event kind: sold/shipped/listed/applied)
- **Stripe checkout** computes totals server-side, creates `payment_transactions` record before redirect, polls status post-redirect
- **Cart context** via React Context + localStorage
- **All sections** previously hardcoded on home (showcase, reviews) now hydrate from the API with seed fallback

## What's Implemented (2026-01-25)
- Initial bold industrial homepage design (Hero, Showcase, Categories, Process, ForMakers, Reviews, CustomCTA, Footer)
- Full marketplace build with backend, 11 routed pages, Stripe checkout, live activity ticker, cart, custom-order & apply forms, journal

## File Map (key new files)
```
backend/server.py                        # FastAPI app with all routes + seed
frontend/src/lib/api.js                  # axios client
frontend/src/lib/cart.js                 # cart context + localStorage
frontend/src/components/ProductCard.jsx
frontend/src/components/sections/        # 9 home sections + ActivityTicker
frontend/src/pages/                      # 9 routed pages
```

## Backlog
- 3D viewer for CNC pieces (currently using interactive 4-image gallery as proxy)
- Stripe Connect for direct maker payouts (P2 — deferred until user enables Connect on Stripe dashboard)

## What's Implemented (2026-04-25 — fork session, iteration 3)
- ✅ **Stripe checkout polling fix** (iteration_1 P0).
- ✅ **Resend transactional email layer** with verified domain `craftersmarket.org`.
- ✅ **Maker Self-Serve Portal (magic-link)** — `/maker/login`, `/maker/verify`, `/maker/dashboard` with Profile/Listings/Orders tabs.
- ✅ **Stripe webhook URL hardening** — `_public_host()` helper using `PUBLIC_BACKEND_URL`.
- ✅ **SEO**: `GET /api/sitemap.xml` (auto-generated from products/makers/journal slugs), `GET /api/robots.txt`, JSON-LD `Product` schema on `/shop/:slug`, JSON-LD `Organization` schema on `/makers/:slug`, OG/Twitter meta tags via `useStructuredData` hook (`/app/frontend/src/lib/seo.js`).
- ✅ **Shipping/tax engine**: `POST /api/cart/quote` (live preview), per-category flat rates (Wall Art $25 / Custom Signs $35 / Outdoor Art $55, highest-tier-wins), free shipping ≥ $250. Checkout creation rewritten to native `stripe` SDK with `line_items` + `shipping_options` + opt-in `automatic_tax` (graceful fallback if Stripe Tax not enabled). Cart page shows live shipping + free-shipping banner.
- ✅ **Admin Console (magic-link, role-based JWT)**: `/admin/login`, `/admin/verify`, `/admin/dashboard`. Routes: `POST /api/admin/auth/request|verify`, `GET /api/admin/me|maker-applications|custom-orders|orders`, `PATCH /api/admin/maker-applications/{id}` (approve/reject with auto-email), `PATCH /api/admin/custom-orders/{id}` (quote with auto-email). Single admin = `OPS_EMAIL`. Bidirectional role enforcement (maker JWT → 403 on /admin/*, admin JWT → 403 on /maker/me). 23/23 backend + 16/16 frontend tests green.

## Next Action Items
- (Future) Stripe Connect for direct maker payouts — requires Connect enabled on Stripe dashboard
- (Future) split `server.py` (now 953 lines) into routers: `routers/seo.py`, `routers/checkout.py`, `routers/admin.py`
- (Future) audit trail field `decided_by` on application decisions; comma-separated `ADMIN_EMAILS` list
- (Future) 3D viewer for CNC pieces (needs GLB assets)
