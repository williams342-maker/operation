# Stripe Connect Setup Guide

This is a one-time, ~3-minute task you (the platform owner) need to complete on **stripe.com**. The marketplace code is fully wired up — these instructions just connect the live dashboard to the existing webhook handler so maker onboarding status syncs automatically.

---

## 1. Add the `account.updated` Connect Webhook

The marketplace already has a working webhook handler at:

```
POST {YOUR_PUBLIC_BACKEND_URL}/api/webhook/stripe/connect
```

For the live preview environment this resolves to:

```
https://active-project-4.preview.emergentagent.com/api/webhook/stripe/connect
```

### Steps

1. Go to **<https://dashboard.stripe.com/test/webhooks>** (or the live one if you've moved off test mode).
2. Click **"+ Add endpoint"**.
3. **Endpoint URL** → paste the URL above.
4. **Listen to** → choose **"Events on Connected accounts"** (this is the radio that activates Connect events — DO NOT pick "Account").
5. **Select events** → search and tick **`account.updated`**. That's the only one we need.
6. Click **"Add endpoint"**.
7. On the resulting endpoint detail page, click **"Reveal"** under "Signing secret" and copy the value (looks like `whsec_xxxxxxxxxxxxxxxxxxxxxxxx`).

### Wire the signing secret

Open `/app/backend/.env` and add the line:

```
STRIPE_CONNECT_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxxxxxxxxxx
```

(If you skip this step, the handler falls back to `STRIPE_WEBHOOK_SECRET` so it still works — but a dedicated secret is the recommended setup.)

Then restart the backend:

```bash
sudo supervisorctl restart backend
```

### Verify

Trigger a test event from the Stripe dashboard:

1. On the webhook detail page click **"Send test webhook"**.
2. Pick **`account.updated`**.
3. Hit **"Send test webhook"**.
4. You should see `200 OK` returned, and the response body shows:

```json
{ "received": true, "type": "account.updated", "skipped": "unknown-maker" }
```

(`unknown-maker` is correct for a synthetic test event — the test account ID isn't in our DB. Real events from real makers will show `"maker": "iron-and-oak"` etc.)

---

## 2. (Optional) Move to Live Mode Later

Once you're ready to take real payments:

1. Toggle Stripe dashboard from **Test mode** → **Live mode** (top-right switch).
2. Repeat the steps above on `https://dashboard.stripe.com/webhooks` (no `/test/`).
3. Replace `STRIPE_API_KEY` in `.env` with your live secret key (`sk_live_…`).
4. Replace `STRIPE_WEBHOOK_SECRET` and `STRIPE_CONNECT_WEBHOOK_SECRET` with the live signing secrets.
5. Restart backend.

The code makes no test-vs-live assumptions — same handler, same routes.

---

## What this enables

Once the webhook is live, every time a maker:

- Completes Express onboarding → their `stripe_charges_enabled / payouts_enabled / details_submitted` flip to `true` automatically (without anyone needing to refresh the dashboard).
- Updates their bank info, ID verification, or business details → status syncs.
- Has any account state change at all on Stripe's side → reflected in your `/admin/dashboard` Maker Analytics tab in real time.

Without the webhook, the same data eventually syncs the moment a maker visits their dashboard's "Payouts" tab (because our `/api/maker/stripe/connect/status` route does an on-demand pull). The webhook just makes it instant + works while makers are offline.
