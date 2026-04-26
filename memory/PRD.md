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

## What's Implemented (2026-04-26 — fork session, iteration 5)
- ✅ All previous iterations (Phase 1+2+3 from iteration 4: AI assistant, community auth, community page).
- ✅ **3D viewer** — `<model-viewer>` web component (Google's library, lightweight) wired into ProductDetail via a new optional `model_url` field on `Product`. Compass Medallion seeded with a public test GLB. New "3D AVAILABLE" badge + a 5th thumbnail slot to toggle between images and 3D view. Graceful fallback: products without `model_url` show the regular gallery as before.
- ✅ **Avatar upload UI** — buyer header has a clickable avatar that opens a file picker; uploads PNG/JPG/WebP up to 1.5MB to `POST /api/community/me/avatar` (already implemented backend-side). Picture is stored as a base64 data URL on the user record and shown next to the user's name in the buddy list and chat.
- ✅ **AOL AIM-style chat** —
  - Real-time **buddy list** per channel (right-side panel on desktop, top on mobile) — green dot for buyers, orange dot + "M" for makers.
  - **"Signed on / signed off"** system messages and live presence snapshot on connect.
  - **Typing indicator** with bouncing dots ("Sarah is typing…"), debounced WS event.
  - **Sound on new message** (small embedded WAV beep, mute toggle).
  - **Unread badges** wired (counter shows on inactive channel tabs — currently increments only on the active socket; plumbing in place for shadow-sockets).
  - Avatar shown beside maker badge in buddy list when present.
- ✅ **Webhook hardening** — `/webhook/stripe` now flips `download_unlocks.status: pending → active` when Stripe confirms `payment_status=paid` for a session whose unlock row is pending. Download paywall query updated to require `status: 'active'` (not just non-expired).

## Backlog
- 3D viewer for ALL products (currently only Compass Medallion has a model_url — makers can paste GLB URLs once we add that field to the maker dashboard form)
- Stripe Connect for direct maker payouts (still pending — user to enable Connect on Stripe dashboard)
- Shadow WS sockets so unread badges fire for inactive channels (current impl shows the badge wiring; doesn't track unread cross-channel yet)
- Push browser notification when a chat mention `@you` lands while tab is unfocused

## Next Action Items
- (Future) Stripe Connect (still blocked on user)
- (Future) Maker dashboard form to add `model_url` to their own listings
- (Future) Cross-channel unread badge tracking (shadow sockets)
- (Future) `@mentions` + browser notifications in chat
