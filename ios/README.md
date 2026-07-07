# Crafters Market — iOS app (Capacitor)

Native iOS shell for https://craftersmarket.org. Counterpart to the Android
TWA in `/app/android`. Bundle ID: `org.craftersmarket.app`.

- **Build instructions (Mac required for final build):** `/app/docs/IOS_BUILD_GUIDE.md`
- **App Store submission checklist:** `/app/docs/APP_STORE_CHECKLIST.md`

Quick start on a Mac:

```bash
cd ios            # this folder
npm install
npx cap sync ios
cd ios/App && pod install
open App.xcworkspace
```

Key files:
- `capacitor.config.json` — remote URL, allowed navigation (Stripe, Google auth), splash/status bar config
- `ios/App/App/CraftersViewController.swift` — pull-to-refresh, loading overlay, offline screen, haptics
- `ios/App/App/AppDelegate.swift` — universal link handling
- `ios/App/App/App.entitlements` — associated domains (deep links)
- `ios/App/App/Info.plist` — camera/photo/microphone permission strings
- Web-side hooks: `/app/frontend/src/lib/nativeBridge.js`
