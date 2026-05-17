# Crafters Market — Modernized Homepage + Full Marketplace

_See `/app/memory/CHANGELOG.md` for dated release log and `/app/memory/ROADMAP.md` for the prioritized backlog. This file is kept stable for original problem statement + architecture + personas._

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
- ✅ **Maker journal authoring + 6 new seed entries (iter137, 2026-02):** `POST/GET/DELETE /api/maker/journal*` endpoints + `MakerJournalEditor` page at `/maker/journal/new`. Vetted makers publish directly to the public Journal feed (no admin queue) — `created_by_maker` stamped for audit. Public Journal expanded from 3 → 9 entries with diverse buyer + maker topics. Tested 13/13 (test_iter137_maker_journal.py).
- ✅ **Processing Profiles synced to DB (iter135, 2026-02):** `Maker.processing_profiles` field + `PATCH /api/maker/profile` round-trip means custom ship-time presets now carry across devices/browsers. ProcessingProfilePicker auto-migrates legacy localStorage values on first mount. Plus dashboard alert audit fixed beta-countdown stale-field bug (`maker_beta_expires_at` → `beta_expires_at`).
- ✅ **Google Ads live integration scaffold (iter134, 2026-02):** Full OAuth refresh-token flow + daily 03:30 UTC sync into the existing `ad_spend` ledger. Admin "Connect Google Ads" card on AdsTab walks operators through missing env vars, connect / manual-sync / disconnect actions, last-sync surfacing. Graceful no-op when env vars unset. Backend: `/app/backend/routers/google_ads.py` + `_job_google_ads_daily_sync` in scheduler. Frontend: `/app/frontend/src/components/admin/GoogleAdsConnectionCard.jsx`. New deps frozen: `google-ads==30.1.0`, `google-auth-oauthlib==1.4.0`. Env-var slots seeded blank in `.env`. Pending: user obtains 22-char developer token from Google Ads MCC API Center + OAuth client ID/secret from Cloud Console; then a single redeploy + Connect click finishes wiring.
- ✅ **Story Template generator (iter133, 2026-02):** One-click 1080×1920 PNG export per published listing — composites hero image, maker brand pill, product title, price, scan-to-shop QR code (UTM-tagged) with Pillow + qrcode. Endpoint `GET /api/products/{slug}/story-card.png` (public, edge-cached 1h, attachment filename). Maker UI exposes the download in 3 places: dashboard listings action grid (`product-story-card-<slug>`), Listing Editor "Share kit" section for published items (`editor-download-story-template`), and Marketing → Story templates subnav (`story-template-download-<slug>`). Drives organic IG/TikTok reach without forcing makers into a separate tool.
- ✅ **Pinterest/Twitter/FB share + auto-SEO tags + listing template (iter129):** Every design file gets `seo_tags[]` + `seo_description` auto-generated from title+description on upload (heuristic-based, no LLM). Surfaced as #tag chips on FileCards + as `article:tag` / `keywords` / JSON-LD on a new `/api/og/community/file/{id}` prerender route for Pinterest/Twitter/Facebook crawlers. ShareFileRow on every FileCard with Pinterest/X/Facebook/IG-caption/Copy-link buttons. MakerListingEditor description gets a "✦ Use template" pre-fill button.
- ✅ **Settle-now + payout schedule + upload preview + auto DXF→SVG (iter128):** Plus members can `POST /api/maker/billing/settle-now` to invoice accrued balance immediately. Live payout schedule indicator on Financials → Payment settings. Upload form renders real previews (raster blob URL, inline SVG, EXT placeholder). Auto-generate SVG checkbox during upload (default ON when DXF present without SVG sibling). Kit.com auto-discount verified shipped (iter120, working).
- ✅ **Pay structure (iter126):** Maker payout schedule env-configurable on Stripe Connect onboard (default weekly/Friday/+7d delay). Monthly Plus charge-clearing job (`charge_clearing.py`) auto-invoices accrued listing/promo fees on the 1st @ 15:00 UTC; admin preview + manual-run endpoints under `/api/admin/billing/charge-clearing/*`.
- ✅ **Community design-file edit (iter126):** `PATCH /api/community/files/{id}` + Edit modal on FileCard for title/description/thumbnail. Same ownership rule as variants endpoints; files themselves stay immutable through this path.
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

## Recent Marketing/Engagement Layer (iter92→iter103, 2026-05)
- ✅ Prod Health Watchdog cron + Admin banner
- ✅ SEO sitemap hardened (preview URL strip + test-slug filter)
- ✅ Marketing landing pages (`/launch`, `/makers-beta`, `/for-makers`)
- ✅ Public `/updates` page driven by `CHANGELOG.md`
- ✅ Updates digest flywheel: subscribe / unsubscribe / daily cron / admin send-now / CSV export / stale banner / OPS summary
- ✅ Coming-Soon waitlist UI/API for Neon & Furniture
- ✅ Admin Broadcast → Subscribers
- ✅ Maker weekly Restock digest cron
- ✅ Admin Growth Stats Heartbeat bar (24h / 7d)
- ✅ Beta feedback follow-up email on resolve (iter101)
- ✅ Contact form follow-up email on resolve (iter102)
- ✅ Welcome emails on /updates and /coming-soon waitlist signups (iter103)
- ✅ Slack/Discord webhooks for Beta Feedback / Contact / Prod Outages (iter104)
- ✅ Webhook deep-links jump operator to the highlighted admin row (iter105)
- ✅ Webhook deep-links survive magic-link sign-in round-trip (iter106)
- ✅ Server-side OG prerender routes for crawlers (iter107)
- ✅ One-click crawler-preview dropdown in admin Listings tab (iter108)
- ✅ Canonical-host 301 redirect middleware (www ↔ apex SEO consolidation, iter109)
- ✅ Tightened SEO copy across meta description, OG, Twitter, JSON-LD (iter110)
- ✅ IndexNow on-demand search-engine ping (Bing/Yandex/Naver/Seznam/Yep) + admin card (iter111)
- ✅ "It's live" launch button on Coming Soon admin tab — auto-emails the waitlist (iter112)
- ✅ Maker-side opt-out toggle for the weekly Restock digest (iter113)
- ✅ Multi-image upload + AI description help on Community Showcase (iter114)
- ✅ AI showcase description vision upgrade — Claude Haiku 4.5 reads the buyer's photos (iter115)
- ✅ "Recently shared by buyers" discovery strip on Home + Product pages (iter116)
- ✅ Showcase analytics: view + click tracking + admin leaderboard with source attribution (iter117)

## Next Action Items
*(All P1/P2/P3s from the original handoff backlog are now shipped or blocked on user paperwork.)*

## Blocked (paperwork)
- Twilio A2P 10DLC, Affirm/Klarna BNPL, Reddit OAuth, Google Ads dev token

## Optional ops (no code from the agent — operator's call)
- Cloudflare Worker for crawler-UA → iter107 OG prerender mapping
- Cloudflare Bulk Redirect for non-`/api` URLs (complements iter109)
- Slack/Discord webhook URLs in prod backend env (iter104 fan-out goes live)
- `CANONICAL_HOST` env var for prod (iter109 middleware activates)
- 🟡 **P14 — UX polish backlog** still on the table from the offered list:
    - (e) Loading skeletons replacing "Loading…" text on all dashboards
    - (f) Empty-state illustrations with CTAs (e.g. "No orders yet — share your shop link")
    - (g) Mobile responsive pass on `/admin/dashboard` (12-tab bar overflows on phones; needs sticky/scrollable)
    - (j) Scheduled-toggle for site switches ("turn maintenance ON at 02:00 UTC tonight, OFF at 04:00 UTC")
    - (k) Per-channel chat moderation (delete a single message; mute a user from one room only)
    - (l) Order-level admin tools (refund partials, reissue maker email, refire transactional emails)
    - (d) Backend `routers/community.py` domain split (~750 lines → community_auth/forum/chat/showcase)

---

## Outstanding Backlog
- **P2** Deploy Cloudflare Worker from `/app/docs/cloudflare-worker-prerender.md` (user-side dashboard step) — now fully paired with iter120's SEO-rich per-slug routes.
- **P2** Apply DNS cleanup from `/app/docs/dns-cleanup.md` (user-side, removes Brevo/Sender/Mailerlite stale records + tightens SPF). ✅ shipped 2026-05-17 (iter145: full DNS hardening + Mailgun migration · SPF/DMARC/DKIM added · stale records removed).
- **P2** Submit sitemap to GSC + Bing per `/app/docs/seo-submission-checklist.md` (user-side, ~25 min).
- **P2** Flip `Auto Offsite Backup` AND `Auto Recovery Drill` toggles ON in admin Settings, then verify tomorrow's 03:15 UTC backup + Apr 1 drill cron land cleanly.
- **P2** Walk through Secrets Rotation tab and click "Mark rotated" on every credential rotated this year so timers start from the right baseline.
- **P3** ~~Capability-aware tab redirects: when a non-super admin clicks a deep-link to a tab they don't have caps for, redirect to the first visible tab instead of just hiding the sidebar entry.~~ ✅ shipped 2026-02 (iter143: URL sync + explanatory toast + stale `?open=` strip).
- **P3** ~~Auto-rotate API keys / Stripe webhook signing keys via the new audit log we now ship — weekly Slack summary of overdue secrets.~~ ✅ shipped 2026-02 (iter142: daily Slack+Discord+email + one-click Stripe webhook auto-rotate w/ dual-secret overlap).

## Blocked (waiting on user)
- Mailtrap DNS verification in Cloudflare (Postmark covers 100% of mail in the meantime — no buyer impact).
- Google Ads Developer Token (22-char) for off-site ad spend integration.

