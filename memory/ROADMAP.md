# Crafters Market — ROADMAP

_Prioritized backlog: P0 > P1 > P2. Blocked items flag the gating credential/decision._

## P0 (next up)

- ~~**Founder Tier Phase 4** (Plus benefits expansion)~~ → SHIPPED in iter171 (3-month Stripe trial, advanced analytics, priority placement boost, custom shop URL picker).
- ~~**Plus trial referral program** (+30 days for 3 referrals)~~ → SHIPPED in iter172.
- **Smart auto-Stripe-Customer at first label purchase** · UNBLOCKS Phase 2B for every maker (not just Plus). IMPLEMENTED in iter63 (see CHANGELOG).
- **Monthly shipping-spend cap** · maker-configurable safety guard. IMPLEMENTED in iter63.
- **Pre-flight address validation** · catches typos before Shippo rate lookup. IMPLEMENTED in iter63.

## P1

- ~~**Per-landing-page analytics**~~ → SHIPPED in iter178 (`/admin/analytics/seo-landing` + WebAnalyticsTab section).
- **Reddit Feed UI** · backend built; BLOCKED awaiting `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` / `REDDIT_USERNAME` / `REDDIT_PASSWORD`.
- **Buyer SMS on DELIVERED** · alongside email; delivery is peak referral moment. **BLOCKED on A2P 10DLC** carrier registration (Twilio creds are wired + verified end-to-end via a test send 2026-04-30; carrier returned error 30034 — Unregistered Number). Will auto-light up the moment A2P brand+campaign approves at https://console.twilio.com/us1/develop/sms/regulatory-compliance/a2p-10dlc (1-3 business days, ~$4/mo + $15 vetting for Sole Proprietor tier).
- ~~**"Notify when restocked" CTA on 0-stock items**~~ → SHIPPED in iter81 (waitlist + auto-fire on stock raise + maker demand banner).


## Trust & Policy Center — Post-Phase D backlog

_Queued items from the Trust & Policy Center v1 project (2026-06-30). These
were carved out because they introduce user-facing functionality or new
DB collections and therefore violate the Phase D freeze._

- **P1 · Cookie Preference Center** — user-facing opt-in/opt-out UI for
  non-essential cookies (analytics, advertising). Wire into the Cookie
  Policy and the GDPR cookie banner. Needs DB (`consent_records`).
- **P1 · Fee & Pricing Policy** — dedicated `/policies/fee-pricing` page.
  Currently referenced in Terms + Maker Agreement prose only. Content is
  ready in `/policy#marketplace` section of the legacy page.
- **P2 · Seller Verification public page** — expand into
  `/policies/seller-verification` once the verification program is
  formalized.
- **P2 · Maker Agreement checkbox with DB opt-in record** — capture
  `{maker_id, agreement_version, accepted_at}` at signup. Re-prompt on
  version bump.
- **P2 · Maker Shop Policy Builder** — configurable Shop Policy defaults
  in the seller dashboard (returns, exchanges, cancellations, processing
  times, shipping, digital downloads, custom orders). Enforces
  marketplace floors defined in the manifest.
- **P2 · Buyer Protection Case Portal** — Buyer/Maker-facing case UI
  replacing the current email-only escalation path.
- **P2 · Product Review Matrix admin UI** — internal moderation dashboard
  backed by `product-review-matrix.md`.
- **P3 · Security Center / Accessibility Statement / Marketplace
  Transparency Report / AI Transparency Center** — Trust Center
  expansion pages.
- **P3 · Trust badges on Listings** — Verified Maker, Founding Seller,
  Buyer Protection, Ships From, Digital Download, Custom Orders
  Available.
- **P3 · Persist OAuth state to database** — shift GSC/GA4 OAuth state
  from in-memory to Mongo so token exchange survives pod redeploys.
- **P3 · Performance audit fixes** — only if funnel metrics show slowness
  is affecting activation (see `phase-d-audits/2026-06-28-perf-baseline.md`).


## P2

- **Google Ads Developer Token** · 22-char token needed for real off-site ad-spend telemetry.
- **DNS record cleanup** · remove unused Brevo / Sender / Mailerlite records once Postmark/Mailgun stability is confirmed.
- **`?tab=orders` deep-linking** on `/maker/dashboard` for email/docs links.
- ~~**Real cohort retention calc** on Workshop Users tab~~ → SHIPPED in iter81 (`community_users.last_seen` aggregation).

## Blocked sections (awaiting external input)

## 🟡 PENDING — Reddit Forum Aggregator (BLOCKED on credentials)
Backend scaffold is **complete and live** at `/app/backend/routers/reddit_feeds.py`,
returning empty posts gracefully until credentials arrive. To activate:

1. Visit https://www.reddit.com/prefs/apps → "create another app"
2. Type: **script** · about_url: `https://craftersmarket.org` · redirect: anything
3. Add to `/app/backend/.env`:
   ```
   REDDIT_CLIENT_ID=<14-char string under app name>
   REDDIT_CLIENT_SECRET=<27-char "secret" field>
   ```
4. `sudo supervisorctl restart backend`
5. Build the Frontend tab in `CommunityPage.jsx`:
   - Add `{ id: "reddit", label: "Reddit" }` to `TABS`
   - New `RedditTab` component that calls `GET /api/community/reddit`
   - Filter chips for the 5 default subs (forhire, CNC, woodworking,
     metalfabrication, 3Dprinting) using `subreddit=` query param
   - "Sort: Hot · New · Top" toggle (`sort=` query param)
   - Each post card: title, r/sub badge, score, comments, link-out to reddit.com
   - Show `configured: false` placeholder ("Reddit feed activates when admin
     adds API keys") until configured
6. Admin UI in `components/admin/SettingsTab.jsx`:
   - List/add/remove subs via `GET|POST|DELETE /api/admin/reddit/subreddits`
   - "Refresh cache" button → `POST /api/admin/reddit/refresh`

Default subs (already seeded): `r/forhire`, `r/CNC`, `r/woodworking`,
`r/metalfabrication`, `r/3Dprinting`.
Cache TTL: 15 min · Sort: hot (default) · Read-only · Link-out only.
Reference: integration playbook returned by integration_playbook_expert_v2
(2026-04-30 session) — confirms script-app + client_credentials grant +
oauth.reddit.com base URL + 60 req/min budget.



