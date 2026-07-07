# Crafters Market — iOS Build Guide (Windows → Mac Handoff)

The iOS app lives in `/app/ios`. It is a **Capacitor shell** that loads
https://craftersmarket.org inside a native WKWebView — the same approach as the
Android TWA in `/app/android`, but with extra native features (pull-to-refresh,
offline screen, haptics, native share sheet, universal links, push framework).

Everything in this repo is ready. The **only** thing that requires a Mac is the
final compile/sign/upload step, because Apple ships its build toolchain (Xcode)
exclusively on macOS.

---

## What's already configured (no action needed)

| Item | Value |
|---|---|
| Bundle ID | `org.craftersmarket.app` (matches Android package ID) |
| App name | Crafters Market |
| Loads | `https://craftersmarket.org/?utm_source=ios-app` |
| Min iOS | 14.0 |
| Devices | iPhone + iPad (`TARGETED_DEVICE_FAMILY = 1,2`) |
| Theme | Dark `#0a0a0a`, light status bar text |
| App icon | 1024×1024 brand icon (from `icons/icon-512.png`) |
| Splash | Dark 2732×2732 with centered monogram, 1.5s fade |
| Native touches | Pull-to-refresh (with haptic), branded loading spinner, offline screen with Try Again button, swipe-back navigation gesture |
| Permissions | Camera, Photo Library (read + add), Microphone — all with App-Review-ready usage strings in `Info.plist` |
| Deep links | Associated Domains entitlement (`applinks:craftersmarket.org`) + AASA file served from the website |
| External links | Any navigation outside craftersmarket.org / Stripe / Google auth opens in Safari automatically (`allowNavigation` in `capacitor.config.json`) |
| Stripe | `*.stripe.com` allowed in-app so checkout completes without leaving the app |
| Push | `@capacitor/push-notifications` plugin installed but **dormant** — see "Enabling push later" below |
| Encryption export | `ITSAppUsesNonExemptEncryption = false` (standard HTTPS only) |

Web-side native hooks (already live in the React frontend):
- `frontend/src/lib/nativeBridge.js` — detects the native shell, routes
  `navigator.share` through the **native iOS share sheet**, exposes
  `nativeHaptic()`, and sets the status bar style.
- Haptic feedback fires when a user saves/favorites a maker drop.
- These are no-ops in normal browsers; nothing changes for web users.

---

## Options if you don't own a Mac

1. **Borrow / rent a Mac** — any Apple Silicon or Intel Mac running macOS 13+.
2. **Cloud Mac** — [MacStadium](https://www.macstadium.com), [MacinCloud](https://www.macincloud.com), or AWS EC2 Mac instances (hourly rental, remote desktop into a Mac).
3. **CI build service** — [Codemagic](https://codemagic.io), [Bitrise](https://bitrise.io), or GitHub Actions `macos` runners can build & upload to App Store Connect from your repo without you ever touching a Mac. Codemagic has a free tier and first-class Capacitor support.

---

## One-time Mac setup

```bash
# 1. Install Xcode 15+ from the Mac App Store, then:
sudo xcodebuild -license accept
xcode-select --install

# 2. Install Node 18+ (https://nodejs.org) and CocoaPods:
sudo gem install cocoapods
# If gem fails on newer macOS, use Homebrew instead: brew install cocoapods
```

## Build steps

```bash
# 1. Get the code onto the Mac (Save to GitHub from Emergent, then clone)
git clone <your-repo-url> && cd <repo>/ios

# 2. Install JS dependencies and sync native project
npm install
npx cap sync ios

# 3. Install iOS native dependencies
cd ios/App
pod install

# 4. Open in Xcode  (ALWAYS the .xcworkspace, never .xcodeproj)
open App.xcworkspace
```

### In Xcode

1. **Signing** — Select the `App` target → *Signing & Capabilities* tab →
   check *Automatically manage signing* → choose your Team (appears after you
   enroll in the [Apple Developer Program](https://developer.apple.com/programs/), $99/yr).
2. **Associated Domains** — the entitlement is already in the project and the
   AASA file already carries the real Team ID (`PMFM2873UR`). Just make sure the
   website has been **redeployed** since 2026-07-07 so Apple's CDN can fetch
   `https://craftersmarket.org/.well-known/apple-app-site-association`.
3. **Run on Simulator** — pick an iPhone 16 simulator, press ▶. Verify:
   login, browsing, add-to-cart, checkout, image upload (photo library),
   pull-to-refresh, airplane-mode offline screen.
4. **Run on a real device** (recommended before submitting) — plug in an
   iPhone, select it as the destination, press ▶.

### Archive & upload to App Store Connect

1. In Xcode: destination dropdown → *Any iOS Device (arm64)*.
2. Menu: **Product → Archive**.
3. When the Organizer opens: **Distribute App → App Store Connect → Upload**.
4. The build appears in [App Store Connect](https://appstoreconnect.apple.com)
   → your app → TestFlight tab (processing takes ~15–30 min).
5. Test via TestFlight on your own phone, then submit for review from the
   *App Store* tab.

> Full submission requirements (screenshots, privacy labels, review notes,
> Sign in with Apple) are in `/app/docs/APP_STORE_CHECKLIST.md`.

---

## Enabling push notifications later

The plugin is compiled in but never registers, so it has zero App Review impact
today. When you're ready:

1. Apple Developer portal → *Certificates, Identifiers & Profiles* → *Keys* →
   create an **APNs Auth Key** (.p8) — note the Key ID and Team ID.
2. Xcode → App target → *Signing & Capabilities* → **+ Capability** →
   *Push Notifications* (and *Background Modes → Remote notifications* if you
   want silent pushes).
3. Web side: in `nativeBridge.js`, call
   `Capacitor.Plugins.PushNotifications.requestPermissions()` then `.register()`
   after login, and POST the device token to a new backend endpoint.
4. Backend: send pushes via APNs HTTP/2 API using the .p8 key (or Firebase
   Cloud Messaging, which the Android app can share).

## Versioning

- Marketing version: `MARKETING_VERSION` in Xcode (e.g. 1.0 → 1.1).
- Build number: `CURRENT_PROJECT_VERSION` — must increase for every upload,
  same rule as `appVersionCode` on Android.

## Updating the app

Because the shell loads the live website, **web changes ship instantly with no
App Store review**. You only need a new build/submission when you change the
native shell itself (icons, plugins, permissions, Capacitor upgrades).
