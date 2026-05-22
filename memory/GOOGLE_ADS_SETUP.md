# Google Ads API · Activation Checklist

Status: **All code is in place** (routers/google_ads.py + GoogleAdsConnectionCard.jsx). The only blocker is the operator-supplied **Developer Token** + OAuth credentials. Once those land in the prod env, the existing daily scheduler job picks up automatically — no further code changes needed.

## What the platform needs (5 env vars)

| Env var | Where to get it | Notes |
|---|---|---|
| `GOOGLE_ADS_DEVELOPER_TOKEN` | https://ads.google.com/aw/apicenter → "Apply for a Standard Access token" | 22-char token. **Requires Google approval** (1-4 business days). Test access (free) is fine for verifying connection, Standard access (also free) is needed for production sync volume. |
| `GOOGLE_ADS_CLIENT_ID` | https://console.cloud.google.com/apis/credentials → OAuth 2.0 Client ID (Web application) | Same project that hosts your other Google APIs is fine. |
| `GOOGLE_ADS_CLIENT_SECRET` | Same OAuth client | Keep secret. |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | Google Ads UI → top-right corner shows your MCC ID | **Strip hyphens** before saving. E.g., `123-456-7890` → `1234567890`. |
| `GOOGLE_ADS_REDIRECT_URI` | _(optional)_ | Auto-derives from `PUBLIC_BACKEND_URL` if blank. Set explicitly only if your backend's external URL differs. |

## Activation sequence

1. Apply for the Developer Token at the API Center link above. Google emails approval within 1-4 business days.
2. While waiting, in Google Cloud Console:
   - Create an OAuth 2.0 Client ID (Web application).
   - Add `https://craftersmarket.org/api/admin/integrations/google-ads/oauth/callback` as an **Authorized redirect URI**.
3. Once approved, paste the 5 env vars into the prod backend deploy environment.
4. `sudo supervisorctl restart backend` (or redeploy).
5. Open Admin → Settings → "Connect Google Ads" card. The amber "missing env vars" banner should be gone.
6. Click **Connect**. Consent screen will request the `https://www.googleapis.com/auth/adwords` scope. Approve.
7. The daily 03:30 UTC scheduler job (`google_ads_daily_sync`) will start pulling yesterday's spend/clicks/impressions/conversions into `db.ad_spend`.
8. The existing **Ads** admin tab will surface the data automatically — no UI work needed.

## Verification (after step 6)

- `GET /api/admin/integrations/google-ads/status` should return `{connected: true, last_sync_at: …}`.
- `POST /api/admin/integrations/google-ads/sync` triggers a manual one-off sync; check Mongo `db.ad_spend` for rows with `platform: "google"`.

## Common 2026 gotchas (already handled in the code)

- `use_proto_plus=True` is mandatory in google-ads ≥14 → set in `_ads_client_from_db()`.
- `login_customer_id` MUST be hyphen-stripped before SDK init → stripped in `_strip_customer_id()`.
- Refresh tokens last only 7 days while OAuth consent is in "Testing" status → status endpoint surfaces "needs reconnect" before silent failures.
- Sync calls run in a thread pool because google-ads SDK is sync-only → `loop.run_in_executor` wrapper.

---
_Doc created 2026-05-22 (iter182). Update when the platform begins to need additional env vars or scopes._
