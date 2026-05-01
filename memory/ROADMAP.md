# Crafters Market — ROADMAP

_Prioritized backlog: P0 > P1 > P2. Blocked items flag the gating credential/decision._

## P0 (next up)

- **Smart auto-Stripe-Customer at first label purchase** · UNBLOCKS Phase 2B for every maker (not just Plus). IMPLEMENTED in iter63 (see CHANGELOG).
- **Monthly shipping-spend cap** · maker-configurable safety guard. IMPLEMENTED in iter63.
- **Pre-flight address validation** · catches typos before Shippo rate lookup. IMPLEMENTED in iter63.

## P1

- **Reddit Feed UI** · backend built; BLOCKED awaiting `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` / `REDDIT_USERNAME` / `REDDIT_PASSWORD`.
- **Buyer SMS on DELIVERED** · alongside email; delivery is peak referral moment. **BLOCKED on A2P 10DLC** carrier registration (Twilio creds are wired + verified end-to-end via a test send 2026-04-30; carrier returned error 30034 — Unregistered Number). Will auto-light up the moment A2P brand+campaign approves at https://console.twilio.com/us1/develop/sms/regulatory-compliance/a2p-10dlc (1-3 business days, ~$4/mo + $15 vetting for Sole Proprietor tier).
- ~~**"Notify when restocked" CTA on 0-stock items**~~ → SHIPPED in iter81 (waitlist + auto-fire on stock raise + maker demand banner).

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



