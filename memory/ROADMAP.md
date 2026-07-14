# Crafters Market — ROADMAP

_Prioritized backlog: P0 > P1 > P2. Blocked items flag the gating credential/decision._

## P0 (next up)

- **Custom Store URL / Vanity URL (P1 → next)**: per-maker vanity slug (/makers/ugogold). Scoped: extend existing `routers/custom_url.py` (currently Plus-gated — user wants it for EVERY maker), add previous_slugs history + permanent redirects (client Navigate + canonical tag; no SSR 301 available), canonical propagation (MakerDetail resolve-first fetch, sitemap in seo.py uses custom_url, makers directory + product-page links), reserved words (+ 'state', existing list), admin set/reset/history endpoints + controls in ApprovedMakersTab. NOTE: get_maker in catalog.py must resolve custom_url → slug → previous_slugs; MakerDetail must use internal slug for all data APIs.
- **Post-cancellation ops features** (user's stated roadmap): return/refund requests, shipping exceptions, partial refunds, buyer/maker dispute center, order messaging thread, maker-only order notes.

- **Workshop Floor Phase 2 — community engagement features** (per user's approved roadmap): reputation & badges, like/save/follow on content, featured projects curation, weekly/monthly challenges, contributor leaderboard, "Maker of the Week", AI moderation. Then Phase 3 growth tie-ins: listing↔discussion links, buyer product Q&A, build logs, showcase "Buy this item" links, journal→product links.
- **Featured Maker captions backfill**: after user tops up Emergent LLM key balance, hit Retry generation (or POST /regenerate) on promo 7fbbd532… to fill instagram/facebook/x captions with the real product reference image. Production: admin must Generate + Activate a promotion in the prod DB to light up the spotlight there.

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

_Queued items from the Trust & Policy Center v1 project (2026-06-30).
Engineering ship approval received 2026-06-30. **Locked release sequence** below._

### Locked Release Sequence (approved 2026-06-30 · updated after Rocket Lawyer review)

1. Counsel review of Appendix A annotations across all 13 policies (Trust & Policy Center v1 + Accessibility Statement).
2. Remove attorney annotations from `manifest.js`.
3. Publish Trust Center to production (`craftersmarket.org/trust`).
4. Add Google Ads conversion labels (`GOOGLE_ADS_CONVERSION_LABEL_APPLICATION`,
   `_SIGNUP`, `_PURCHASE`) once user retrieves them; also update any GTM/gtag
   event mappings and server-side conversion events.
5. Verify conversion telemetry end-to-end (test funnel event → Google Ads dashboard).
6. ~~**P1 — Publish Fee & Pricing Policy** at `/policies/fee-pricing`~~ → **SHIPPED 2026-06-30 (iter413fp)**. v1.0 standalone Operational Policy: commissions, listing fees, Crafters Plus subscription, Stripe payment-processing, off-site ad fees, Promoted Listings, refunds/chargebacks/adjustments, payout timing, marketplace-facilitator sales tax, prospective-change (30-day notice), and cross-refs to Terms/Maker Agreement/Returns/Buyer Protection/Shipping. Counsel Review Packet regenerated to 127 pages (was 117). Prevents commission changes from requiring edits across multiple documents.
7. **P2 — Cookie Preference Center**. Improves privacy compliance and gives
   users granular consent controls without changing the underlying legal
   policies.
8. **P3 — Maker Agreement DB opt-in**. Provides explicit agreement
   versioning, timestamped acceptance, IP/User-Agent audit trail (where
   appropriate), and future re-acceptance when agreement versions change.
   Strongest long-term legal foundation.
9. **P4 — INFORM Consumers Act automation.** Auto-comply once a Maker
   crosses the 200-new-transactions or $5,000-gross-revenue-in-12-months
   threshold: collect verified bank account / tax ID / working email /
   working phone, and disclose that information (or the seller identity
   summary) as required by the Act. Track threshold crossings server-side.
10. **P5 — Marketplace Facilitator Tax operational verification.** Confirm
    with the payment processor (Stripe Tax or equivalent) that
    marketplace-facilitator sales tax is being calculated, collected, and
    remitted correctly in every applicable state before launch. Not a
    policy rewrite — this is an ops task and a testing pass.
11. **P6 — Accessibility enhancements.** WCAG 2.1 Level AA conformance
    testing, alt-text tooling for Listings, keyboard-nav audit,
    focus-indicator sweep, screen-reader smoke test. Publish an updated
    Accessibility Statement annually.

### Later backlog (order not locked)

- **P3 · Seller Verification public page** — expand into
  `/policies/seller-verification` once the verification program is
  formalized.
- **P3 · Maker Shop Policy Builder** — configurable Shop Policy defaults
  in the seller dashboard (returns, exchanges, cancellations, processing
  times, shipping, digital downloads, Custom Orders). Enforces
  marketplace floors defined in the manifest.
- **P3 · Buyer Protection Case Portal** — Buyer/Maker-facing case UI
  replacing the current email-only escalation path.
- **P3 · Product Review Matrix admin UI** — internal moderation dashboard
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



