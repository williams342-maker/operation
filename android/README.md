# Crafters Market — Android APK (Trusted Web Activity)

This folder packages **craftersmarket.org** as a Play Store-ready Android app using **Bubblewrap** (Google's official TWA wrapper). The APK is a thin shell (~1 MB) that loads the live site fullscreen — every web deploy reflects in the app instantly, no Play Store update required.

---

## What you get
- ✅ Real Play Store app, installable from a Play listing
- ✅ Custom icon, splash screen, app shortcuts (Shop / Custom Order / Makers)
- ✅ URL bar hidden when Digital Asset Links verification succeeds
- ✅ Web push notifications, deep links, install prompts — all work
- ✅ Live site reflects instantly — only need a Play Store update for app-level changes (icon, name, native features)

---

## One-time prerequisites (your laptop)

1. **Node.js 18+** — `node -v`
2. **Java JDK 17** — `java -version` (JDK 17 LTS recommended; Bubblewrap prompts to install if missing)
3. **Android SDK** — Bubblewrap auto-installs the build-tools it needs on first run
4. **Bubblewrap CLI**:
   ```bash
   npm install -g @bubblewrap/cli
   bubblewrap doctor       # verifies your toolchain
   ```

---

## Build the APK (~5 minutes)

```bash
# 1. Clone or copy this folder to your laptop:
#    cp -r /app/android ~/crafters-android   (if you're SSH'd into the pod)
#    or download this folder via Save-to-GitHub and clone

cd ~/crafters-android

# 2. Initialize Bubblewrap from the manifest we pre-built for you.
#    This pulls https://craftersmarket.org/manifest.webmanifest and
#    bootstraps an Android Studio project under ./app/.
bubblewrap init --manifest=./twa-manifest.json

# 3. When prompted "Do you want Bubblewrap to install the JDK and Android SDK?", say YES
#    (or point to your existing installs).

# 4. When prompted for keystore details, choose "Create new key":
#    - Path:      ./android.keystore
#    - Alias:     android
#    - Password:  <PICK A STRONG ONE — write it down>
#    - Key password: <can match the keystore password>
#    - Validity:  10000 days (Play Store requires keys valid > Oct 2033)
#    - Name/Org:  Crafters Market / Crafters Market LLC (or your business)

# 5. Build a signed release bundle (.aab) + debug APK:
bubblewrap build
```

When this finishes you'll have:
- `app-release-bundle.aab` ← **upload this to Play Console** (Google Play prefers AAB over APK now)
- `app-release-signed.apk` ← side-loadable APK for direct testing
- `android.keystore` ← **GUARD THIS WITH YOUR LIFE.** If lost, you can never update the app on Play Store again.

---

## Hide the URL bar (Digital Asset Links)

After build, you'll see Bubblewrap print your release SHA-256 fingerprint. It looks like:
```
14:6D:E9:83:C5:73:7E:5A:32:A4:23:42:...
```

Copy that and run (inside this pod, NOT on your laptop):
```bash
cd /app/android
./update-assetlinks.sh "14:6D:E9:83:C5:73:..."
```

This rewrites `/app/frontend/public/.well-known/assetlinks.json` with the real fingerprint. **Then redeploy craftersmarket.org** so the file goes live. Verify it landed:
```bash
curl https://craftersmarket.org/.well-known/assetlinks.json
```

Validate it through Google's checker:
👉 https://developers.google.com/digital-asset-links/tools/generator

Without this step the app still works, but Chrome will show a thin "craftersmarket.org" bar at the top instead of going fullscreen.

---

## Upload to Play Console

1. Go to https://play.google.com/console → **Create app**
2. Choose **App** (not game), default language English-US, free or paid.
3. Fill the basics:
   - App name: `Crafters Market`
   - Short description: `Hand-built CNC metal & wood art. Browse vetted independent makers and order custom pieces.` (max 80 chars — edit as needed)
   - Full description: pull from your site's About page
4. **Set up your app** checklist (this takes ~30 min the first time):
   - Privacy policy URL: `https://craftersmarket.org/policy`
   - App access: "All functionality is available without special access"
   - Ads: usually No
   - Content rating: complete the IARC questionnaire (5 min)
   - Target audience: 18+ (e-commerce / financial transactions)
   - Data safety: declare what you collect (likely: name, email, address, payment via Stripe, device IDs for analytics)
5. **Release → Production → Create new release** → upload `app-release-bundle.aab`
6. Review and rollout. **First review takes 7–14 days** for new developer accounts.

---

## Increment the app version for future releases

Each upload to Play Console needs a **unique higher** `appVersionCode`. Edit `twa-manifest.json`:
```json
"appVersionName": "1.0.1",
"appVersionCode": 2
```
Then re-run `bubblewrap update && bubblewrap build`. Reuse the **same keystore** every time.

---

## When DO I need to push an app update?

99% of changes you make to the website are reflected instantly in the app — no APK rebuild required. You only need to rebuild + re-upload when:
- App icon / splash screen / name changes
- You change `display`, `theme_color`, or `start_url` in the manifest
- Adding a feature that requires native Android APIs (e.g. Google Pay, in-app billing, deeper push customization)
- Annual Play Store target SDK bumps (Google forces this once a year)

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| URL bar still shows after install | Asset Links file mismatch. Re-run `./update-assetlinks.sh` with the **exact** fingerprint Bubblewrap printed, redeploy, and reinstall the app (uninstall first — caching). |
| `bubblewrap build` fails with "JAVA_HOME" error | Bubblewrap installs a portable JDK at `~/.bubblewrap/jdk` — re-run `bubblewrap doctor` and let it set the path. |
| App shows white screen on launch | Service worker is caching too aggressively. Open `chrome://inspect/#service-workers` on a connected device, find craftersmarket.org, click "Unregister". Or bump the SW version in `/app/frontend/public/service-worker.js`. |
| Play Console rejects the AAB for "must target API 34+" | Google bumps target SDK every August. Run `bubblewrap update --skipVersionUpgrade=false` to pull in the latest target. |

---

## Files in this folder

| File | Purpose |
|---|---|
| `twa-manifest.json` | Bubblewrap input — name, package id, icons, theme, shortcuts |
| `update-assetlinks.sh` | One-shot helper that writes your real SHA-256 fingerprint into the served `.well-known/assetlinks.json` |
| `README.md` | This file |

Generated keystore + APK artifacts live alongside these files **on your laptop only** — never commit them to git.
