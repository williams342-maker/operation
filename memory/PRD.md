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

## What's Implemented (2026-04-26 — fork session, iteration 6)
- ✅ All previous iterations.
- ✅ **Maker-owned product PATCH** — `PATCH /api/maker/products/{slug}` (new `MakerProductUpdate` model: title, description, price, in_stock, model_url, images). Cross-maker isolation enforced (403). Inline 3D-model URL editor on each card in the maker dashboard's Listings tab — paste a `.glb` URL, click Save, "✓ Saved" appears. Buyers immediately see the "3D AVAILABLE" badge + 3D thumbnail toggle on the product page.
- ✅ **Cross-channel unread badges** — Community chat now opens 4 SHADOW WebSockets in parallel (one per accessible channel). Inactive channels accumulate unread + mention counts; active channel auto-resets on entry.
- ✅ **@mentions** — case-insensitive detection on `@<myname>`. Mentioned messages render with an orange left-border (`data-testid='chat-line-mentioned'`) + higher-pitch ding. Inactive channel tabs show `@` in the badge instead of a number when mentions > 0.
- ✅ **Browser desktop notifications** — `Notification` API. "Enable desktop notifications" CTA appears when permission is `default`; once granted, every mention or any message received while tab is unfocused fires a desktop notif (clicking it focuses the tab and switches to the relevant channel).
- ✅ **Bug found and fixed during testing** — stale-closure bug in shadow WS handlers (captured `channel` instead of current). Fixed with `activeChannelRef = useRef(channel)` updated in the channel-effect.
- ✅ **Iteration test results**: 11/11 backend tests + frontend fixes verified.

## Backlog
- Stripe Connect (still pending — user to enable on Stripe dashboard)
- 3D viewer for ALL products (now self-serve via maker dashboard — backlog complete in spirit; just needs makers to fill in URLs)

## Next Action Items
- (Future) Stripe Connect (still blocked on user)
- (Future) Showcase: option to tag the original product/maker on a buyer post (auto-link to /shop/{slug})
- (Future) AI assistant: persistence of session_id across page navs (currently per-session only) so the conversation stays warm
- (Future) Per-thread mentions in forum (mirror chat behavior)
