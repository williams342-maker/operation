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

## What's Implemented (2026-04-26 — fork session, iteration 4)
- ✅ All previous iterations (checkout, emails, maker portal, SEO, shipping, admin, refactor, polish).
- ✅ **AI Assistant** — floating chat widget on every page (bottom-right, repositioned above Emergent badge). Uses `EMERGENT_LLM_KEY` + `claude-sonnet-4-5-20250929` via `emergentintegrations.LlmChat`. Multi-turn via `session_id`. System prompt grounds it in current product catalog. Detects custom-order intake and auto-POSTs `/api/ai/submit-brief` with extracted contact + brief.
- ✅ **Buyer/Community auth** — magic link (Resend, frictionless signup) + Emergent Google OAuth. `cm_buyer_jwt` in localStorage with `role='buyer'`. Routes: `/api/community/auth/magic/{request|verify}`, `/api/community/auth/google`, `/api/community/me`.
- ✅ **Community page** at `/community` with 4 tabs:
  - **Showcase** — buyer-posted gallery cards (image URL + title + description) with like counts.
  - **Design Files** — DXF/SVG/STL/GLB downloads. Maker-only upload. Buyer paywall: 5 free downloads / 6 months, $5 unlocks unlimited (Stripe checkout).
  - **Forum** — threaded discussions, tags `general/makers/help/showcase`. Buyer-only post + reply.
  - **Live Chat** — real WebSocket at `/api/ws/chat/{channel}` with 4 channels; `makers-only` is gated to maker JWTs (closes WS with code 4403 for buyers, 4401 for missing token).
- ✅ **`/contact` page** — email/IG/location, custom-order + apply CTAs.
- ✅ **`/policy` page** — 4 sections (Privacy, Terms, Shipping, Returns).
- ✅ Nav updated: added Community + Contact links; Footer Privacy/Terms/Contact now route to /policy and /contact.
- ✅ **Iteration test results**: 26/26 backend pytest passing, ~92% frontend Playwright. Two minor issues caught and fixed: AI launcher overlap with Emergent badge (repositioned), makers-only blocked-state copy improved.
- ✅ Bug fix found by testing agent: 5 ObjectId-leak 500s in `routers/community.py` — fixed by popping `_id` before returning inserted docs.

## Backlog
- 3D viewer for CNC pieces (needs GLB assets from user)
- Stripe Connect for direct maker payouts (waiting on user to enable Connect on Stripe dashboard)
- Avatar upload UI in CommunityPage (backend `/api/community/me/avatar` already in place — needs a frontend dropzone)
- Webhook to flip `download_unlocks.status: pending → active` on payment success (currently the success_url returns the buyer to /community without re-checking; harmless but would tighten audit)
- Unread badge on chat channels

## Next Action Items
- (Future) Stripe Connect (still blocked)
- (Future) 3D viewer (need GLB asset)
- (Future) Add unread/typing indicators to live chat
- (Future) Add avatar upload UI on Community page
