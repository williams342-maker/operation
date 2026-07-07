# Crafters Market — App Store Submission Checklist

Companion to `/app/docs/IOS_BUILD_GUIDE.md`. Work top-to-bottom; items marked
⚠️ are the ones most likely to cause a rejection if skipped.

---

## 1. Accounts & app record

- [ ] Enroll in the **Apple Developer Program** ($99/yr): https://developer.apple.com/programs/enroll/
      Use a business enrollment if you have a D-U-N-S number (shows "Crafters Market LLC" as the seller instead of a personal name).
- [ ] App Store Connect → *My Apps* → **+ New App**
  - Platform: iOS · Name: **Crafters Market** · Language: English (U.S.)
  - Bundle ID: `org.craftersmarket.app` · SKU: `craftersmarket-ios-1`
- [ ] Replace `TEAMID` in `frontend/public/.well-known/apple-app-site-association` with your real Team ID and **redeploy the website**. Verify:
  `curl -s https://craftersmarket.org/.well-known/apple-app-site-association` returns the JSON.
  Note: the file may be served as `application/octet-stream`; Apple's CDN generally accepts this. Validate after deploy with `https://app-site-association.cdn-apple.com/a/v1/craftersmarket.org` — if it errors on content-type, contact Emergent support to add an `application/json` header override for that path.

## 2. ⚠️ Sign in with Apple (Guideline 4.8)

The app offers **Google login**. Apple requires that any app using a
third-party login also offer **Sign in with Apple** (or an equivalent
privacy-focused option) — this is one of the most common rejection reasons.

Options (pick one before submitting):
- [ ] **Add Sign in with Apple** to the website's sign-in page (works via web OAuth; ask Emergent to implement it).
- [ ] **Hide Google login when inside the iOS app** and rely on email/password only (the `cm-native-ios` class on `<html>` makes this a one-line CSS/JS change) — email/password-only apps are exempt from 4.8.

## 3. ⚠️ Guideline 4.2 (minimum functionality) defense

Apple sometimes rejects webview apps as "just a website." Already built in and
worth listing in your **Review Notes**:
- Native pull-to-refresh with haptic feedback
- Native iOS share sheet for products, maker shops, referrals, and community posts
- Haptic feedback when saving/favoriting maker drops
- Branded native offline screen with retry (not a browser error)
- Universal links — product/shop links from email open directly in the app
- Native camera & photo library integration for listing/order photos
- Swipe-back navigation gesture, native splash & loading experience

Suggested review note: *"Crafters Market is a handmade-goods marketplace with
native share, haptics, offline handling, deep links, and camera integration.
User accounts, messaging, seller tools, and Stripe checkout are core
interactive features, not static web content."*

## 4. App privacy (nutrition labels)

App Store Connect → App Privacy. Declare (matches the existing privacy policy):
- [ ] **Contact Info** — email, name (account creation) — linked to user
- [ ] **User Content** — photos, messages, reviews/posts — linked to user
- [ ] **Purchases** — purchase history (orders) — linked to user
- [ ] **Identifiers** — user ID — linked to user
- [ ] **Usage Data** — product interaction (GA4 analytics) — may be used for analytics; declare tracking only if you enable cross-app ad tracking (currently: No)
- [ ] Privacy Policy URL: `https://craftersmarket.org/policies/privacy`  *(verify exact path)*

## 5. ⚠️ Account deletion (Guideline 5.1.1(v))

Already compliant — the platform has universal in-app account deletion plus the
public deletion page. In the review notes, point to:
- In-app: Account → Delete Account
- Web: `https://craftersmarket.org/account/delete`

## 6. ⚠️ Demo account for App Review

Reviewers must be able to log in without creating an account.
- [ ] Create a dedicated reviewer account (buyer role, with an order history if possible) and enter it in App Store Connect → *App Review Information*.
- [ ] Never delete/expire this account while the app is live.

## 7. Payments (Guideline 3.1.1 vs 3.1.3(e))

Crafters Market sells **physical handmade goods**, which **must** use external
payment (Stripe) and must **not** use Apple In-App Purchase. No action needed —
just don't add IAP. If a reviewer asks, cite Guideline **3.1.3(e): Goods and
Services Outside of the App / physical goods**.

## 8. Store listing assets

- [ ] **Screenshots** (required sizes; take from Simulator with ⌘S):
  - iPhone 6.9" (iPhone 16 Pro Max): 1320×2868 — 3 to 10 shots
  - iPad 13" (iPad Pro): 2064×2752 — required because the app supports iPad
- [ ] Suggested shots: home/hero, shop grid, product detail, maker shop, custom order flow, community feed.
- [ ] **Description**: reuse the Google Play listing copy from `/app/docs/PLAY_COMPLIANCE_CHECKLIST.md`, adapted for iOS.
- [ ] Keywords (100 chars): `handmade,crafts,marketplace,artisan,custom order,maker,gifts,craft fair,handcrafted`
- [ ] Support URL: `https://craftersmarket.org` · Marketing URL (optional): same
- [ ] Age rating questionnaire → expect **4+** (UGC questions: answer Yes to user-generated content, Yes to reporting/blocking/moderation — all already built).
- [ ] Category: **Shopping** (secondary: Lifestyle)

## 9. UGC compliance (Guideline 1.2) — already built ✅

Apple requires the same UGC safeguards Google Play does. Already live:
content reporting, user blocking, admin moderation queue, EULA/terms.
Mention these in review notes if asked.

## 10. Pre-flight technical checks

- [ ] Build & run on a real iPhone: login, browse, favorite (feel the haptic), share a product (native sheet appears), upload a photo, Stripe checkout, pull-to-refresh.
- [ ] Airplane mode at launch → branded offline screen → re-enable network → Try Again works.
- [ ] Tap a `https://craftersmarket.org/...` product link from Notes/Mail → opens in the app (only works after AASA has your real Team ID and the app was installed fresh).
- [ ] External link (e.g., a maker's Instagram) opens in Safari, not in-app.
- [ ] iPad: layout renders correctly in both orientations.
- [ ] TestFlight build tested by at least one person.

## 11. After approval

- [ ] Add the App Store badge/link next to the Google Play badge on the website + Beta Testing page.
- [ ] Later: enable push notifications (see build guide §"Enabling push later").
- [ ] Web updates ship instantly without review; only native shell changes need a new build (bump `CURRENT_PROJECT_VERSION` each upload).
