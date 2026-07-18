# Crafters Market — Production Deploy Environment Variables

> **Last synced from preview `/app/backend/.env`**: 2026-04-28
>
> ⚠️ **Treat this file as a secret.** Do not commit it to a public repo.
> It exists only to make copy-pasting into Emergent's deploy env panel painless.
>
> **How to use**: Emergent Dashboard → Deploy → Environment Variables → Backend
> → paste each `KEY=value` line. After all keys are saved, click **Redeploy**.

---

## 🔴 CRITICAL — Must be set or backend won't boot / core features break

```
MONGO_URL=mongodb://localhost:27017
DB_NAME=test_database
CORS_ORIGINS=*
MAKER_AUTH_SECRET=cm_maker_auth_v1_a91f7e2c4b8d6e3f5a1c9d7b2e8f4a6c
PUBLIC_BACKEND_URL=https://api.craftersmarket.org
PUBLIC_SITE_URL=https://craftersmarket.org
SITE_URL=https://craftersmarket.org
FRONTEND_URL=https://craftersmarket.org
```

> 💡 `MONGO_URL` and `DB_NAME` are **auto-managed by Emergent** — leave the values
> Emergent injects, do NOT paste these two from preview. Same for `CORS_ORIGINS`
> if Emergent's deploy already sets it.
>
> 💡 `PUBLIC_BACKEND_URL` should point at your **deployed** API host (whatever
> Emergent assigns post-deploy, or your custom domain like `api.craftersmarket.org`).
> Don't paste the preview URL.

---

## 📧 EMAIL — fixes the "no emails on production" issue

```
EMAIL_PROVIDER=postmark
EMAIL_FALLBACK_PROVIDER=mailtrap
SENDER_EMAIL=team@craftersmarket.org
SENDER_NAME=Crafters Market
OPS_EMAIL=team@craftersmarket.org
ADMIN_EMAILS=team@craftersmarket.org

POSTMARK_API_KEY=56748bae-5e41-4cb7-b63e-dd0dfbf6509c
POSTMARK_MESSAGE_STREAM=outbound
MAILTRAP_API_KEY=226dcf41ddabcc6899631cfd46909723
RESEND_API_KEY=re_ZSJycn9s_PrNexZgLUj5rjpDbh7EToDLs
MAILERSEND_API_KEY=mlsn.315937b0c3947de2d64ec4da98a830c6a49089d54ea6b7a476f4aa5f337718b5
SENDER_API_KEY=eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJhdWQiOiIxIiwianRpIjoiOTViYTFiN2U2MTViNmFkZDBhYzU0N2NmYWI4ZTQ4MjkwMjM5NjczOTM3YjNiM2U4MWM0Y2RjYmZlY2ZkYTE5NWJkZGZhZWFlMDY2NGZjNTQiLCJpYXQiOjE3NzcyNDM4NzguODM2MTIyLCJuYmYiOjE3NzcyNDM4NzguODM2MTI0LCJleHAiOjQ5MzA4NDM4NzguODM0MjAxLCJzdWIiOiIxMDY5MjE1Iiwic2NvcGVzIjpbXX0.k8682mwmmRZANt1Ua8JBDSVtqJ9gOD5ASzyvVAddb7qhBAifnI9aCc7Mpsj2Ljal-NozcrBbfXWeZLD3HhZe2pCR3oIe0xajUqIdYrjxtYAvBlJlInJF0L_vDJuf6n0NFiUfvvNfGDmWvLD-H3WdD5tyX16Hx46cwqAUozcw0zI8mcRNxadZCL0vtoOEagJxXjrDF9I_DxCFJtmiOyaG4Y5V4SIzBQX-EPU1NwZ9BQU9zfz2UX5NhD5tDJenM2xaPc86asJTVLs2zc7MSFfj5kOdZkr10KDv3My-mgRwfft1_wyM7B-gRBcrHMe8ZZtXD5_VVaSIf-mLtIi-OxiRvfaKf-3GoeII3duynNG3CmSphdSicueeD1a4WJqxvz1hjSwBx3v4abdEbBTbXokJBil7KUd1wwwkOUEVXmTYfNFksgJypAw1tGijaYTliAUKoEMEawKLIbC3-cHaS8xLG7QF9La9KgHV0yhqFifm-4jvSB8nxVH7k8_gJWZ7GBjnItWsUUpK4-D2F5yBS3ko8SnyIpRAXN7EwaxL-eewLHZBpaXlLQWeGt7pF9XThJk1nn0n2IznR4DdzemsM-8bvauuvcNiRngGpTBfL-s--HBJB9Wxx0RXPFwKQ_irov6Y-1f612D2V6_Su_430k1MQ_mpfdNGEYqlMhYJVZ2sbq8
BREVO_API_KEY=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
```

> 💡 With these 2 things in place, the email pipeline will work on prod:
> 1. `EMAIL_PROVIDER=postmark` (primary, working)
> 2. `EMAIL_FALLBACK_PROVIDER=mailtrap` (fallback, DNS still pending — will activate once verified)
>
> The new admin dashboard badge will read 🟢 **OK** on prod once new traffic flows.

---

## 💳 PAYMENTS

```
STRIPE_API_KEY=sk_test_51DS4nCIntHVUtFLRqYfMKdtEtCfITn7IKR7llc9NdWi37nKc8MbGYosHDTZp7QYtbzXve3VrnfDQAmXc1zRABwPE00MIpdswZg
STRIPE_WEBHOOK_SECRET=whsec_LmeDpXl93m9oCKtqxbLsgqEMOLCXjG6n
STRIPE_CONNECT_WEBHOOK_SECRET=whsec_t4kuMW59Yn73Ge0p8jVwhQBTVranLMSW
```

> 💡 ⚠️ **These are TEST keys.** When you're ready to take real money on production,
> swap to `sk_live_...` keys + the live webhook secrets. Don't deploy real
> commerce on test keys.

---

## 🗄️ STORAGE (Cloudflare R2 / CDN)

```
R2_ACCOUNT_ID=aa3fa3f40f26c77fa088283f992dc963
R2_ACCESS_KEY_ID=f3c34f29b264338bde8d6159d28422cf
R2_SECRET_ACCESS_KEY=1f1926deacda6d8db2c4438b4583d5e7f2e0b68b608418e92d2f2b017806df00
R2_BUCKET=craftersmarket-assets
R2_PUBLIC_URL=https://cdn.craftersmarket.org
```

---

## 🤖 AI / LLMs (Emergent Universal Key)

```
EMERGENT_LLM_KEY=<redacted-rotate-before-use>
EMERGENT_AUTH_URL=https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data
```

---

## 🔐 AUTH POLICY

```
ENABLE_BUYER_PASSWORD_AUTH=true
ENABLE_MAKER_PASSWORD_AUTH=true
ENABLE_ADMIN_PASSWORD_AUTH=true
ADMIN_PASSWORD_ROTATION_DAYS=30
```

---

## 🔑 ADMIN PASSWORD SEED (so you can sign in with the same password as preview)

```
ADMIN_INIT_EMAIL=team@craftersmarket.org
ADMIN_INIT_PASSWORD_HASH=$2b$12$81vloSCT/GqxRCdtN29IP.RTJmn0trULuaiJ5F3qD9AmYHyP4RbCy
```

> 💡 This is a bcrypt hash — you cannot reverse it, but it IS the hash of the
> password you set. The seeder writes it on first boot only (idempotent — won't
> overwrite a password the admin later changes from the UI).

---

## 💼 MARKETPLACE ECONOMICS (defaults — change only if you want different fees)

```
PLATFORM_FEE_BPS=500
PROCESSING_FEE_BPS=300
LISTING_FEE_CENTS=20
LISTING_FREE_QUOTA=10
LISTING_EXPIRY_DAYS=120
PROMOTION_WEEKLY_FEE_CENTS=500
PLUS_MONTHLY_LISTING_QUOTA=15
PLUS_PLATFORM_FEE_BPS=400
PLUS_PRICE_USD=12
OFFSITE_AD_FEE_BPS=1200
OFFSITE_ATTRIBUTION_TTL_DAYS=30
```

---

## 📱 SOCIAL & RETENTION (optional — only set if you want these features live)

```
BUFFER_API_KEY=wCPwiRCsORt7pPUKR4WWYxmAvRMy0LLUawXpVItdQ9r
BUFFER_ORG_ID=69ee74bab3eb4d0e37bacd4e
BUFFER_AUTO_PUBLISH=true
KIT_API_KEY=kit_94a313addfdebdf3436a57b112fba176
```

---

## ✅ Post-deploy verification checklist

After redeploy completes, in this order:

1. Open `https://craftersmarket.org/admin/dashboard`
2. Sign in with email + password (will use the seeded hash above)
3. Glance at the new **EMAIL · STATUS** badge in the header
   - 🟢 OK → done, emails working
   - 🟡 DEGRADED → primary failing, fallback delivering — fine for now
   - 🔴 DOWN → hover the badge, the tooltip names the missing env var
4. From the admin Email Status tab, click **Send Test Email** to verify end-to-end
5. (Optional) From the admin Settings tab, confirm the Beta Signup toggle works

If anything looks off, share the badge tooltip text and I'll pinpoint the exact issue.

## PayPal webhook IDs (3-webhook architecture · 2026-07-11)
Set in the PRODUCTION deploy env (values = webhook IDs from the PayPal dashboard, live app):
- `PAYPAL_WEBHOOK_ID_LIVE=52475674DX0564514` — /api/webhooks/paypal (disputes + primary payout events)
- `PAYPAL_CHECKOUT_WEBHOOK_ID=682704233P629433F` — /api/paypal/webhook (checkout/captures/refunds)
- `PAYPAL_PAYOUT_STATUS_WEBHOOK_ID=5RA57991ES0012142` — /api/webhooks/paypal/payout-status (rare payout statuses)
Preview keeps these last two EMPTY (falls back to PAYPAL_WEBHOOK_ID_SANDBOX).
