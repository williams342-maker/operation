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
- ✅ **Onboarding Package — `/welcome` 5-step flow + welcome email (iter249, 2026-02-26):** Built per the founder's full spec + figma mock. Five steps with progress dots, skip-everywhere ("Just browsing"), and animated step transitions: (1) Welcome hero "A marketplace where makers don't get buried", (2) Choose Your Path (Buyer / Maker / Supporter cards), (3) Three value cards (Visibility Without Algorithms · Built for Makers · Community First), (4) First Action (path-specific: maker = profile/upload/connect; buyer/supporter = follow 3 / save 1 / profile photo) — clicking opens the destination in a new tab + marks the step server-side, (5) 5-stop tour with prev/next/skip, lands on the role-appropriate dashboard. Backend `/api/onboarding/{start,step,me,skip}` persists state in `onboarding_states` collection keyed by JWT sub or anonymous `anon_id`. Welcome email fires on first `/start` call with email+user_type — uses founder's exact copy from email-template.txt rendered in the existing dark-aesthetic `_shell`. Community auth (Google + magic-link) now returns `is_new_signup` flag and the frontend routes first-time buyers to `/welcome` instead of straight to `/community`. Testing: backend 15/15 pytest pass · frontend 100% on desktop, mobile required pt-32→pt-40 padding bump to clear the fixed Nav (fixed). Files: `/app/backend/routers/onboarding.py`, `/app/frontend/src/pages/Welcome.jsx`, `/app/backend/routers/community_auth.py` (is_new_signup wiring), `/app/frontend/src/pages/CommunityAuth.jsx` (auto-redirect).
- ✅ **Admin merge button + email provider cleanup (iter248, 2026-02-26):** Built `MergeWilliamsAccountsCard` in the Admin → Settings tab — wraps the existing `/api/admin/merge-williams/{preview,commit}` endpoints with a 3-click UI (preview plan → confirm bar → commit). Shows live DB state (maker email · buyer row to delete · historical row count) and a green "Already merged" banner when no-op. Idempotent + admin-JWT gated. Same flow now runs on prod without curl. Removed 6 unused email provider env keys (`RESEND_API_KEY`, `BREVO_API_KEY`, `POSTMARK_API_KEY`, `POSTMARK_MESSAGE_STREAM`, `SENDER_API_KEY`, `MAILERSEND_API_KEY`) since they were deleted from Cloudflare DNS. Active chain is now just **mailgun → mailtrap fallback**. Email audit card now shows green ✓ Nothing to clean up. Testing agent iter72: **100% backend + 100% frontend pass**.
- ✅ **One-click Role Switcher in Nav (iter247, 2026-02-26):** When the user holds JWTs for multiple roles in localStorage (admin + maker + buyer), the nav's "Account" pill becomes a dropdown listing each role with icon + color accent, the current one marked `◆ now`. Click any to jump to that dashboard, click "Sign out of all" to clear every JWT and bounce to home. Closes on Escape + outside click + after selection. Mobile-safe (hidden under sm breakpoint; falls through to the existing mobile drawer). Testing agent iter71 reports **9/9 scenarios pass, 0 issues**.
- ✅ **Williams account merge (iter246, 2026-02-26):** `williams1cnc@gmail.com` (maker login) merged into `williams342@gmail.com` (admin + buyer) — Option A from the user-facing merge prompt. Maker shop `williams-cnc` rebound to the new email (Founder tier + 5 products intact, slug unchanged). Zombie `community_users` row for the old email deleted (verified 0 downstream activity). 33 historical rows rewritten (1 maker_application + 29 login_attempts + 3 audit_log). Idempotent dry-run + commit script at `/app/backend/scripts/merge_williams_accounts.py`. Preview verified end-to-end — magic-link to `williams342@gmail.com` lands in Williams CNC maker dashboard with all 5 products. **PRODUCTION: STILL PENDING** — same script needs to be run against prod Mongo (separate DB instance).
- ✅ **GA4 OAuth secret rotated (iter245, 2026-02-26):** Original secret was paste-exposed during initial setup. Rotated via Google Cloud Console (`Crafters Market Web client 2 → + ADD SECRET`), new value saved to `/app/backend/.env`, old secret deleted from GCP. Preview verified `ok: true` post-rotation; production redeployed and confirmed live. Refresh token in `db.ga4_oauth` survived the rotation cleanly (no re-auth needed) because access tokens are minted on-demand from `client_id + new_secret + refresh_token`.
- ✅ **Maker Studio UX polish — Generate moved under prompt + Refine elevated + Blank-canvas entry (iter244, 2026-02-26):** Generate Design button now sits directly under the prompt textarea (was previously below template grid; user reported "it gets lost"). Refine-with-AI block now appears under Generate the moment a design exists — cyan-bordered call-out with Enter-key submit, so the natural flow is Generate → Refine → Refine → done. New "◇ Or start with a blank canvas" button gives makers a non-AI entry point (stamps an empty 14×6 rounded-border canvas with 2 top-corner holes, then the full ElementsEditor + DragOverlay mount). Verified via screenshot.
- ✅ **GA4 Live Analytics — OAuth user-creds mode (iter244, 2026-02-26):** Service-account auth was permanently blocked by Google's "doesn't match a Google Account" rejection in GA4's Property Access Management UI (even after enabling the GA4 Data API on the GCP project). Pivoted to OAuth user-creds flow — reuses the existing `Crafters Market Web client 2` OAuth client (client_id `239405833611-lpcmj47ufbela6s5o6dgjfcgnap3s4o0`). New endpoints `GET/POST /api/admin/ga4/{status,oauth-start,oauth-callback,disconnect}` in `/app/backend/routers/ga4_oauth.py`. Refactored `routers/ga4_analytics.py::_client()` with priority resolution: OAuth refresh-token from `db.ga4_oauth` → fallback to service-account JSON. Diag now reports `active_mode: oauth|service_account|none`. Verified end-to-end on preview AND production — connected as `williams343@gmail.com`, returning real numbers (194 users / 251 sessions / 1,220 page views over 7d; Meta paid = 82 sessions/week leading source; Google organic only 1 session/week — SEO opportunity). Production redirect: `https://craftersmarket.org/api/admin/ga4/oauth-callback`.
- ✅ **Maker Studio drag-to-position on the preview canvas (iter243, 2026-02-26):** New `DragOverlay` component overlays transparent hit-boxes on each `design.operation` in the SVG preview. Click & drag any shape or text element on the canvas to reposition it — only a ghost outline tracks the pointer during drag (no backend chatter), and on pointer-up exactly ONE `/api/studio/render` call commits the new x/y. Positions clamp to [0..1] so elements can't escape the canvas. Hover shows cyan outline + label; active drag shows orange outline + live `x%, y%` coordinates. Auto-scrolls preview into view on first design load. `/api/studio/render` is now public (anonymous-OK) since `render_svg` is deterministic geometry with no AI cost — visitors can fully experiment with templates + drag before signing in. Tested 100% frontend pass via testing agent iter70 (clamp, single-render-per-drag, shape+text drag, resize-resilient, slider↔handle two-way sync all verified).
- ✅ **Maker Studio Elements Editor (iter242, 2026-02-26):** Direct, AI-quota-free manipulation of every shape, text, border style/thickness, and mounting-hole config on the Studio canvas. New `ElementsEditor` panel inside `MakerStudio.jsx` lists every operation as a compact row with edit/delete buttons, exposes `+ Shape` and `+ Text` insert buttons (4-element cap enforced), and provides full per-element controls (primitive/font/content + x/y/w/h/size sliders). Collapsible Border section (5 styles + thickness) and Holes section (0–4 count chips, diameter, placement). Mutations to `design` state trigger the existing `/api/studio/render` effect for instant preview updates. Frontend tested 100% (testing agent iter69) — no backend changes.
- ✅ **Maker Studio Phase 7 — Kit Gallery + Bundle ZIP download (iter241, 2026-02-26):** New public discovery hub at `/kits` listing every public design kit with cover thumbnail, file count, and client-side search. One-click bundle download on every kit page: `GET /api/studio/kits/by-slug/<slug>/bundle.zip` streams a ZIP containing per-design `.svg` + `.dxf` (regenerated deterministically from `design_intent` JSON via `render_svg`/`render_dxf` — independent of R2 storage state) plus a top-level `README.txt` with curator credit, machining notes (material/depth), and per-file prompt history. Old kit docs missing `slug` are silently filtered from the index (defensive fix for legacy data). Nav mega-menu + mobile drawer now expose "Design kits → /kits". Backend 9/9 pytest passing (`test_iter241_kits_bundle.py`); frontend 100% smoke pass.
- ✅ **Grow With Us cinematic landing page (iter232, 2026-02-26):** Single-file React route at `/grow` (683-line `GrowWithUs.jsx`) with Framer Motion scroll animations, in-view animated count-up counters, 4-phase public roadmap (DONE → IN PROGRESS → UPCOMING → FUTURE), founder letter section, dark cinematic aesthetic (#0a0a0a + #ff4500 orange + #00ffff cyan accents). Backend endpoint `GET /api/grow/traction` returns live marketplace counts (makers/products/community/forum/clips/showcase + roadmap_pct) with 60s in-memory cache. Tested 7/7 backend pytest passing + 100% frontend smoke (0 console errors, mobile 375px no overflow). Routed via `App.js` `/grow`. Files: `/app/backend/routers/grow_page.py`, `/app/frontend/src/pages/GrowWithUs.jsx`, `/app/design_guidelines.json`.
- ✅ **Community Showcase — maker video clips (2026-02, this iter):** Makers can upload short video clips alongside (or instead of) photos. Native R2 hosting + HTML5 `<video controls>` playback — no third-party dependencies.
  - New endpoint `POST /api/community/showcase/upload-video` (maker-only role gate). 50 MB / ≈60 s cap. Allowed: mp4 / webm / mov / m4v.
  - `ShowcasePost` extended with `video_url`; `create_showcase` now accepts buyer OR maker JWTs (extends the surface for makers; buyer photo flow unchanged).
  - Showcase cards render the video player with the poster image as fallback + "◆ Video" badge in the top-left. `RecentShowcaseStrip` (home + product pages) also tags video posts.
  - Video-only posts allowed for makers (no images required); buyers still must attach at least one image.
  - Frontend: maker-detection via `cm_maker_jwt` reveals the picker UI; size/format validated client-side + progress meter.
  - Regression: `/app/backend/tests/test_showcase_video.py` (3/3 passing — role gate, full round-trip with cleanup, bad-extension rejection).
- ✅ **Founder email signature kit (2026-02):** New tile under `Marketing → Founder card`. Live HTML preview with the maker's Gemini card thumbnail + name + Founder badge + UTM-tagged shop link + "/founders" recruiting link. Four export paths: **Copy for Gmail/Apple Mail** (rich `ClipboardItem` text/html + text/plain, falls back to raw HTML), **Copy raw HTML**, **Copy plain text**, **Download .htm** (for Outlook desktop signature import). Table-based markup so Outlook renders correctly. Includes paste-location cheatsheet for all 4 major clients. Founder-only gating.
- ✅ **Founder Card share kit on maker dashboard (2026-02):** Marketing → Founder card sub-nav. Founder-only (double-gated). Live preview + one-click X/Facebook/LinkedIn share buttons with pre-composed pitch + Download card + Copy text. File: `/app/frontend/src/pages/MakerDashboard/Marketing/FounderCardSection.jsx`.
- ✅ **Founder Marketing Kit (2026-02):** Recruiting toolkit for the first 100 inaugural Founders.
  - `EtsyComparisonTable` (`/founders`): side-by-side fee math at $5K / $25K / $75K GMV bands → "You save" callouts ($432 · $1,919 · $5,613/yr).
  - `FoundersWall` (`/founders`): live grid of approved Founders with veteran (yellow dot) + beta-tester (emerald dot) markers; numbered chips link to maker shop pages.
  - `/api/founders/card/{slug}`: shareable social card generated via Gemini Nano Banana (`gemini-3.1-flash-image-preview`), cached in `db.founder_cards` keyed on (slug, founder_number) so re-promotes auto-bust the cache. Mime-type now sniffed from magic bytes (Gemini returns JPEG, not PNG — fixed in this iter).
  - `/press` page (PressPage.jsx) with live fact sheet (reads `/api/founders/slots`), 3 pitch angles, brand colors, downloadable logo, press-contact card.
  - Footer "Press" link added.
  - Regression: `/app/backend/tests/test_founder_marketing_kit.py` (3/3 passing).
- ✅ **Founders Tier Phase 1-3 (2026-02):** Replaces old Beta. 3% commission · 50 free listings/mo · 100 lifetime "inaugural" slots · 12-month rolling for #101+ · veteran $10/mo boost credit · Plus $15/mo boost credit · 24h SLA badge · auto-promote on application · half-price Plus overage · live-activity events · admin Replenish UI · welcome/expiry/manual-promote emails · 14-day grace cron + expiry cron · DB migration script.
- ✅ **Live mode (2026-02):** Stripe (Connect payouts, webhooks, test data cleanup, SDK dict-access bug fix), Shippo (real shipping labels + auto Customer creation + 5% platform markup), Meta Ads OAuth (production redirect mismatch fixed). Admin live-order toast + Web Push notifications wired.
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

