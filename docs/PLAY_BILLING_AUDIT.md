# Google Play Billing Audit — Crafters Market Android App

**Status:** AUDIT ONLY. No implementation. Reviewed against Google Play
[Payments policy](https://support.google.com/googleplay/android-developer/answer/9858738)
and [October 2024 updates](https://developer.android.com/distribute/best-practices/monetize).

**Rule of thumb (per Play policy):**
- **Physical goods, real-world services, shipping** → Stripe / any PSP is
  ALLOWED. Play Billing is explicitly *not required*.
- **Digital goods consumed inside the app** → **Play Billing is REQUIRED**
  when the sale is initiated within an Android app distributed via Play.
  A 15% (small dev) or 30% (>$1M/yr) service fee applies.

---

## 1. Purchases INSIDE the Android app — inventory

Every place a user can spend money inside the app today:

| # | Surface | Route / Feature | Payload | Kind | Play policy |
|---|---|---|---|---|---|
| 1 | Product checkout | `/product/:slug` → Stripe Checkout | Physical craft (wood sign, pottery, jewelry, etc.) shipped to buyer | **Physical goods** | ✅ Stripe allowed |
| 2 | Custom order intake | `/custom` → `POST /api/custom-orders` → Stripe invoice | Bespoke physical piece, shipped | **Physical goods** | ✅ Stripe allowed |
| 3 | Cart checkout | `/cart` → Stripe Checkout | Cart of physical items | **Physical goods** | ✅ Stripe allowed |
| 4 | Digital-file downloads (paywalled DXF / SVG kits) | `/community` → `unlockDownloadsCheckout` → Stripe | Digital design file for CNC / laser | **DIGITAL** | ⚠️ **See §2** |
| 5 | Promoted listing / Listing boost | Maker Dashboard → Ads → "Promote" ($5/wk per listing) | On-platform ad placement | **Digital service (in-app functionality boost)** | ⚠️ **See §2** |
| 6 | Featured slot / Founder tier | Maker application flow → Founder pricing | Access-level upgrade with platform perks | **DIGITAL subscription** | ⚠️ **See §2** |
| 7 | Auto-boost renewal | scheduled — $5/wk pending balance | Same as #5, recurring | **DIGITAL service** | ⚠️ **See §2** |
| 8 | Plus membership (buyer-side) | `/plus` — future | Perks tier | **DIGITAL subscription** | ⚠️ **See §2** |
| 9 | AI ad-creative credits | Maker Dashboard → AI tools | Digital content generation | **DIGITAL, one-off** | ⚠️ **See §2** |
| 10 | Founding-Access lifetime pass | Founder application → paid slot | Digital access tier | **DIGITAL** | ⚠️ **See §2** |

---

## 2. Play Billing decision matrix

For each ⚠️ row above we have three real options once we ship the Android
app:

### Option A — Keep Stripe, hide the surface on Android
Detect UA (`navigator.userAgent.includes("wv") && Android`) and hide any
"Buy" button that isn't a physical-goods checkout. The user completes
those purchases in a browser (`craftersmarket.org` outside the app).
- ✅ Zero engineering, zero fees.
- ❌ Poor UX; may still get flagged by Play if the app *promotes* the
  feature without offering an in-app purchase path.

### Option B — Wrap Stripe checkout in an external browser tab
For Digital rows: open Stripe Checkout via Chrome Custom Tab, not inside
the app's TWA WebView. Google's [Nov 2024 clarification](https://support.google.com/googleplay/android-developer/answer/9858738)
still labels this as circumvention when the purchase is *initiated* by
the app; risk of policy strike.
- ⚠️ Grey area — not recommended for anything above a few $/mo revenue.

### Option C — Implement Google Play Billing alongside Stripe
Wire Play Billing SDK (or the `@google-play/billing` W3C API for TWAs) for
Digital surfaces only. Stripe remains the sole PSP for Physical goods.
- ✅ Fully compliant.
- ❌ 15-30% Play fee on digital revenue; requires SKU catalog mirror on
  Play Console; requires reconciliation with our Stripe-based reporting.

---

## 3. Recommendation

**Ship Physical-goods-only first.** All ten rows above except #1–#3 are
either low-revenue or opt-in maker features. For the Play submission we
should:

1. **Feature-flag** rows #4–#10 to `hidden=true` when the app detects it
   is running inside the TWA (via a `?src=android-app` build-time param
   or by reading a marker `META` tag we inject at build time).
2. **Do NOT** remove any surface from the web — buyers/makers visiting
   `craftersmarket.org` in Chrome retain full Stripe purchase paths.
3. Prepare a **Play Billing v7 wiring PR** as a follow-up sprint so
   Digital surfaces can be enabled on Android without a policy strike
   when we're ready to accept the fee.

---

## 4. What we WILL NOT do

- We will not roll our own IAP.
- We will not use Stripe Checkout inside the Android WebView to sell any
  Digital SKU listed in §1 (rows #4–#10).
- We will not accept crypto for Digital SKUs from the Android app.

---

## 5. Files that host Digital-purchase surfaces (for the follow-up sprint)

- `frontend/src/pages/CommunityPage.jsx` — design-file paywall
- `frontend/src/pages/MakerDashboard/Ads/*` — promoted-listing flows
- `frontend/src/pages/MakerDashboard/AutoBoost*` — recurring promotions
- `frontend/src/pages/FoundersPage.jsx` — Founder tier upgrade
- `frontend/src/pages/Plus*` — buyer membership
- `frontend/src/pages/MakerDashboard/AiAdCreative*` — AI credits

Backend endpoints powering the above are in:
- `backend/routers/stripe_*.py`
- `backend/routers/ai_ad_creative.py`
- `backend/routers/promoted_listings.py`
- `backend/routers/founders.py`

## 6. Reviewer disclosure

When submitting to Play we should include in the review notes:

> "Version 1.0 of Crafters Market for Android sells physical handmade
> goods only. All Digital surfaces (design files, promoted listings,
> subscriptions) are hidden inside the Android app and only accessible
> via the web at craftersmarket.org. Google Play Billing wiring is on
> the roadmap for a future release."

This transparency dramatically reduces policy-review risk.
