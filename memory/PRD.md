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
- Admin dashboard (review custom orders + maker applications)
- Real shipping calculator + tax engine in checkout
- SEO sitemap + structured data
- Stripe Connect for direct maker payouts (P2)
- Stripe webhook URL: derive from REACT_APP_BACKEND_URL instead of internal request.base_url (minor; carry-over from iteration_1)

## What's Implemented (2026-04-25 — fork session)
- ✅ **Stripe checkout polling fix:** `/api/checkout/status/:session_id` now uses the native `stripe` SDK (`stripe.checkout.Session.retrieve`) bypassing the buggy `emergentintegrations` Pydantic wrapper. PAID session anchor verified end-to-end.
- ✅ **Resend transactional email layer:** verified domain `craftersmarket.org`, helpers for buyer receipt, ops alert, custom-order ack, maker application alert, and per-maker order alerts (`/app/backend/email_service.py`).
- ✅ **Maker Self-Serve Portal (magic-link auth):**
  - Backend: `maker_auth.py` (itsdangerous magic token, 15 min · PyJWT HS256 session, 7 d). Routes: `POST /api/maker/auth/request`, `POST /api/maker/auth/verify`, `GET /api/maker/me`, `GET /api/maker/products`, `GET /api/maker/orders`, `PATCH /api/maker/profile`. Cross-maker isolation enforced.
  - Frontend: `/maker/login`, `/maker/verify`, `/maker/dashboard` (Profile / Listings / Orders tabs). JWT stored in `localStorage.cm_maker_jwt`. Footer "Maker Login" link wired up.
  - 18/18 backend pytest cases pass · 11/11 Playwright UI flows pass (iteration_2).

## Next Action Items
- (Future) Stripe Connect for direct maker payouts
- (Optional) Use `REACT_APP_BACKEND_URL` for the Stripe webhook URL builder
- (Future) Admin dashboard for reviewing custom-orders + maker applications
