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

## Building without a Mac — Codemagic (recommended for Windows users)

The repo root contains a ready-made **`codemagic.yaml`** with two workflows:

| Workflow | What it does | When it runs |
|---|---|---|
| `ios-testflight` | Builds, signs, and **uploads to TestFlight** | Push a git tag like `ios-v1.0.0`, or start manually |
| `ios-build-only` | Builds a signed `.ipa` artifact, no upload | Start manually |

### One-time setup (~20 minutes, all from Windows)

**A. Get the code on GitHub**
1. In Emergent chat, use **Save to GitHub** to push this project to a repo you own.

**B. Apple Developer portal — verify App ID capabilities**
1. https://developer.apple.com/account/resources/identifiers/list → click `org.craftersmarket.app`.
2. Make sure BOTH capabilities are checked, then Save:
   - ✅ **Sign in with Apple** (done already)
   - ✅ **Associated Domains** ← required because the app uses deep links
     (`App.entitlements` declares `applinks:craftersmarket.org`); signing FAILS without it.

**C. App Store Connect — create the app record + API key**
1. https://appstoreconnect.apple.com → My Apps → **+ New App**:
   Platform iOS · Name **Crafters Market** · Bundle ID `org.craftersmarket.app` · SKU `craftersmarket-ios-1`.
   (TestFlight uploads have nowhere to land without this record.)
2. Users and Access → **Integrations** tab → *App Store Connect API* → Team Keys → **Generate API Key**:
   - Name: `Codemagic` · Access: **App Manager**
   - **Download the `.p8` file** (one-time download — keep it safe)
   - Note the **Key ID** (on the key row) and **Issuer ID** (top of the page).

**D. Codemagic — connect everything**
1. Sign up at https://codemagic.io (free tier includes macOS build minutes) → **Add application** → pick your GitHub repo → select **codemagic.yaml** when asked.
2. Teams → your team → **Integrations → Developer Portal → Manage keys → Add key**:
   - Name it exactly **`codemagic`** (the yaml references this name)
   - Issuer ID + Key ID from step C2, upload the `.p8` file.
3. **Certificate private key** — Codemagic needs an RSA key to create your iOS
   Distribution certificate. On Windows, open PowerShell and run:
   ```powershell
   ssh-keygen -t rsa -b 2048 -m PEM -f ios_cert_key -q -N '""'
   ```
   (If prompted for a passphrase, leave it empty.) Open the resulting `ios_cert_key`
   file in Notepad and copy ALL of it (including the BEGIN/END lines). Then in
   Codemagic: your app → **Environment variables** tab →
   - Variable name: `CERTIFICATE_PRIVATE_KEY` · Value: paste the key · check **Secret**
   - Group: type `appstore_credentials` (create it) → Add.
   The build's "Fetch or CREATE App Store signing files" step uses this to
   auto-create the distribution certificate and App Store provisioning profile —
   nothing to make by hand in the Apple portal.

### Required credentials summary

| Item | Where it lives | Used for |
|---|---|---|
| App Store Connect API key (`.p8` + Key ID + Issuer ID) | Codemagic → Integrations, named `codemagic` | Signing files + TestFlight upload |
| App ID `org.craftersmarket.app` w/ Sign in with Apple + Associated Domains | Apple Developer portal | Provisioning profile generation |
| App record in App Store Connect | appstoreconnect.apple.com | TestFlight destination |

No other environment variables are required — bundle ID, scheme, and workspace
paths are hardcoded in `codemagic.yaml`, and the build number auto-increments
from Codemagic's `$BUILD_NUMBER`.

### Run your first build
1. Codemagic dashboard → your app → **Start new build** → workflow **Crafters Market iOS → TestFlight** → Start.
2. ~15–25 min later the build appears in App Store Connect → TestFlight (processing adds another ~15 min).
3. Install the **TestFlight** app on your iPhone → accept your own invite (add yourself as an internal tester on the TestFlight tab) → install Crafters Market.
4. Test on your phone: login (incl. Continue with Apple), browse, favorite (haptic), share (native sheet), photo upload, checkout, pull-to-refresh, airplane-mode offline screen.

For subsequent releases: tag a commit `ios-v1.0.1` (or hit Start new build) — everything else is automatic.

### Codemagic troubleshooting
- **"No matching profiles found"** → the `CERTIFICATE_PRIVATE_KEY` env var is missing/not in group `appstore_credentials` (step D3), or the API key lacks App Manager access, or the Associated Domains capability is missing on the App ID (step B2).
- **"App not found" on TestFlight upload** → App record not created yet (step C1), or the API key lacks App Manager access.
- **Pod install fails** → retry the build; if persistent, bump `xcode: latest` to a pinned version (e.g. `xcode: 16.4`) in `codemagic.yaml`.
- Build logs live under the build's **xcodebuild logs** artifact.

---

## Options if you don't own a Mac (alternatives)

1. **Cloud CI build (recommended)** — Codemagic, fully configured above via `codemagic.yaml`.
2. **Borrow / rent a Mac** — any Apple Silicon or Intel Mac running macOS 13+.
3. **Cloud Mac desktop** — [MacStadium](https://www.macstadium.com), [MacinCloud](https://www.macincloud.com), or AWS EC2 Mac instances (hourly rental, remote desktop into a Mac).

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
ermissions, Capacitor upgrades).
