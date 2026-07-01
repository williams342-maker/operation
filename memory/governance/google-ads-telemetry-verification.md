# Google Ads Conversion Telemetry — Post-Label Verification Checklist

**Status:** Awaiting three conversion labels from Google Ads account.
**Owner:** Engineering (Emergent build agent) + Marketing/Founder.
**Last updated:** 2026-06-30

---

## Trigger

Run this checklist **immediately after** the three Google Ads conversion labels are pasted into the codebase. Do not consider the Trust & Policy Center launch complete until every item below is verified.

---

## Step 1 — Wire the Three Labels

Open `/app/frontend/src/lib/googleAdsConversions.js` and populate:

```js
const GOOGLE_ADS_CONVERSION_LABEL_APPLICATION = "<paste label 1>"; // Founding Seller Application submitted
const GOOGLE_ADS_CONVERSION_LABEL_SIGNUP      = "<paste label 2>"; // Maker Registration Complete
const GOOGLE_ADS_CONVERSION_LABEL_PURCHASE    = "<paste label 3>"; // Marketplace Sale completed
```

Label format: 11–20 char alphanumeric (e.g. `AbCd_-EfGh1234`) — the segment **after** the slash in `AW-18195416932/AbCd_-EfGh1234`.

Verify:

- ✅ Three placeholders are strings (not arrays, not comments).
- ✅ No extra whitespace inside the quotes.
- ✅ Comments still accurately describe the mapping.

## Step 2 — Update Any GTM / gtag Container Configuration

If the marketing team maintains a Google Tag Manager container (rather than raw gtag), also update:

- ✅ Any Conversion Tracking tags in GTM for `purchase`, `signup_buyer`, `signup_maker`.
- ✅ GTM tag firing triggers still reference the correct DOM events / dataLayer pushes.
- ✅ Preview GTM in Debug mode before publishing the container.

## Step 3 — Server-Side Conversion Events (If Applicable)

If server-side conversions are wired (Enhanced Conversions API or backend-fired):

- ✅ Backend conversion sender picks up label from the same environment source, not duplicated in two places.
- ✅ Server-side event includes the same `transaction_id` used by the client-side gtag call for de-duplication.
- ✅ Personally Identifying data (email, phone) is hashed with SHA-256 before submission.

## Step 4 — Event Dispatch Verification (Application)

Fire a real Maker application submission on preview:

- ✅ `trackConversion("signup_maker", {...})` executes.
- ✅ Google Ads Tag Assistant shows the conversion event.
- ✅ Chrome DevTools → Network tab shows an outbound request to `googleads.g.doubleclick.net` or `google-analytics.com/g/collect` with `event=conversion` and `send_to=AW-18195416932/<APPLICATION_LABEL>`.
- ✅ No duplicate events fire (Application should fire once per submission, not per page render).

## Step 5 — Event Dispatch Verification (Signup)

Complete a real Maker registration (or Buyer registration if that maps to `signup_buyer`) on preview:

- ✅ `trackConversion("signup_buyer", {...})` executes.
- ✅ Tag Assistant shows the conversion event.
- ✅ Fires exactly once per registration completion.

## Step 6 — Event Dispatch Verification (Purchase)

Complete a real Stripe test-mode purchase on preview:

- ✅ `trackConversion("purchase", { value, currency, transaction_id })` executes on CheckoutSuccess.
- ✅ Value and currency match the actual Order total (Buyer-paid, not commission).
- ✅ `transaction_id` matches the Crafters Market Order ID (used for chargeback attribution + de-duplication).
- ✅ Fires exactly once per completed purchase — refresh CheckoutSuccess and confirm no re-fire.

## Step 7 — Google Ads Console Confirmation

- ✅ Open Google Ads → Tools → Measurement → Conversions.
- ✅ Each of the three conversion actions shows recent activity within 3 hours of the test fires (Google Ads reporting lag is typically < 3 hours).
- ✅ Attribution model is set as intended (marketplace default: Data-Driven; fallback: Last Click).
- ✅ Conversion values match the fired amounts.

## Step 8 — De-Duplication Sanity

- ✅ Fire the same Purchase event twice with the same `transaction_id` and confirm only one is counted.
- ✅ Confirm server-side + client-side pair (if both configured) count as one via matching `transaction_id`.

## Step 9 — Regressions

- ✅ Existing gtag page-view and enhanced-measurement events still fire.
- ✅ `add_to_cart`, `lead_custom_order`, `lead_contact` no-op events remain no-ops (labels are still empty by design).
- ✅ Console shows no gtag-related JS errors.

## Step 10 — Documentation Update

- ✅ CHANGELOG.md entry with the wire date, tester name, and PASS/FAIL per step.
- ✅ Redact the actual label strings in any public-facing docs (label preview form `AbC…234` is fine — the labels are not secret but they are noisy).
- ✅ Update the Trust & Policy Center release sequence to mark step 4 (Add Google Ads conversion labels) and step 5 (Verify conversion telemetry) as complete.

---

## Rollback

If any Step 4–8 fails:

1. Revert the label strings to `""` in `googleAdsConversions.js` (returns the events to no-op mode).
2. Do not proceed to launch until Tag Assistant confirms firing.
3. Escalate to marketing/founder to reissue labels or reconfigure the Google Ads conversion actions.

---

## Notes on the `googleAdsConversions.js` Helper

- `trackConversion(action, params)` is safe to call with empty labels — it becomes a no-op and logs to console in dev mode.
- The helper already strips `event_id` and rewrites it as gtag's `transaction_id` for de-duplication.
- Failures inside `gtag()` are caught silently — telemetry must never block a Buyer or Maker flow.
- `listConversionStatus()` returns a `{action, wired, label_preview}` list suitable for a future admin "Conversion Coverage" report.
