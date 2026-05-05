# Publishing Crafters Market to Google Play (TWA)

This guide takes the existing PWA at https://craftersmarket.org and ships it
to Google Play as an installable Android app — using **Bubblewrap**, Google's
official CLI for generating Trusted Web Activities (TWAs).

A TWA is essentially a thin native shell that opens your live website in
Chrome with no browser chrome. Same code, same backend, same updates.
When you push a new version of the website, Android users get the update
instantly — you only re-publish to Play Store when you change icons,
permissions, or native config.

> **Time budget:** 90 min first time (most of it is Play Console paperwork).
> Subsequent updates: ~10 min.

> **You'll need (one-time):**
> - A Mac/Linux/Windows dev machine (NOT this Emergent pod — it doesn't have Android Studio)
> - Node.js ≥ 18
> - JDK 17 (`brew install openjdk@17` on Mac, `apt install openjdk-17-jdk` on Linux)
> - **Google Play Console account: $25 one-time signup** ([play.google.com/console](https://play.google.com/console))
> - 1024×500 feature graphic + at least 2 phone screenshots (we'll reuse what you have)

---

## Step 1 — Confirm the PWA is live in production

Already done if you redeployed `craftersmarket.org` from Emergent. Verify:

```bash
curl -sI https://craftersmarket.org/manifest.webmanifest        # 200
curl -sI https://craftersmarket.org/service-worker.js           # 200
curl -s https://craftersmarket.org/manifest.webmanifest | jq .name  # "Crafters Market"
```

If any of those fail, redeploy from Emergent first — Bubblewrap pulls
the manifest from the live URL.

---

## Step 2 — Install Bubblewrap on your dev machine

```bash
npm install -g @bubblewrap/cli
bubblewrap doctor    # verifies JDK + Android SDK
```

If `doctor` complains about missing Android SDK, Bubblewrap will offer
to download it for you (~1.5 GB). Accept and continue.

---

## Step 3 — Initialize the TWA project

Pick a clean folder OUTSIDE this repo (e.g. `~/cm-android/`):

```bash
mkdir -p ~/cm-android && cd ~/cm-android
bubblewrap init --manifest=https://craftersmarket.org/manifest.webmanifest
```

Bubblewrap will prompt you. Use these answers:

| Prompt | Answer |
|---|---|
| Domain | `craftersmarket.org` |
| Application name | `Crafters Market` |
| Short name | `Crafters` |
| Package ID | `org.craftersmarket.app` *(reverse-domain — pick this carefully, it's permanent)* |
| Display mode | `standalone` |
| Status bar color | `#0a0a0a` |
| Icon URL | `https://craftersmarket.org/icons/icon-512.png` *(default — accept)* |
| Maskable icon URL | `https://craftersmarket.org/icons/icon-maskable-512.png` |
| Notification delegation | `Yes` *(critical — lets the TWA receive your VAPID web pushes)* |
| Signing key | `Create a new one` *(unless you already have one)* |
| Keystore password | **Pick a strong password and SAVE IT** to a password manager |
| Key alias | `android` *(default)* |
| Key password | Same password is fine for first key |

This produces, in `~/cm-android/`:
- `twa-manifest.json` — Bubblewrap config (commit this if you version-control)
- `android.keystore` — **YOUR SIGNING KEY. Back this up. If you lose it, you can never update the app.**
- `app/` — generated Android Studio project

---

## Step 4 — Get your signing fingerprint

```bash
cd ~/cm-android
bubblewrap fingerprint
```

You'll see something like:
```
SHA-256: AB:CD:EF:01:23:45:...
```

**Copy that whole SHA-256 line.** You need it for Step 5.

---

## Step 5 — Host `assetlinks.json` on craftersmarket.org

This is the security handshake — Chrome won't trust your TWA unless your
domain explicitly delegates to your app's signing key.

I've already added a placeholder at:
`/app/frontend/public/.well-known/assetlinks.json`

Edit that file — replace `REPLACE_WITH_YOUR_SHA256_FINGERPRINT_FROM_BUBBLEWRAP`
with the SHA-256 from Step 4 (keep the colons, e.g. `AB:CD:EF:...`).

Then redeploy from Emergent. Verify it's live:

```bash
curl https://craftersmarket.org/.well-known/assetlinks.json
```

Should return JSON containing your fingerprint. Google's verifier:
https://developers.google.com/digital-asset-links/tools/generator

---

## Step 6 — Build the release bundle (.aab)

Back on your dev machine:

```bash
cd ~/cm-android
bubblewrap build
```

This produces:
- `app-release-bundle.aab` — what you upload to Play Store
- `app-release-signed.apk` — for sideloading + testing

---

## Step 7 — Test on a real Android device first

```bash
# With your phone in USB-debug mode + connected:
bubblewrap install
```

Or transfer `app-release-signed.apk` to your phone and tap to install.
Verify:
- App launches full-screen (no Chrome address bar)
- Push notifications work (if you opted in via the install prompt)
- Login + checkout flow works end-to-end

If you see the URL bar at the top, your assetlinks.json is wrong —
re-check Step 5.

---

## Step 8 — Create the Play Console listing (one-time)

Go to https://play.google.com/console → **Create app**:

| Field | Value |
|---|---|
| App name | `Crafters Market` |
| Default language | English (United States) |
| App or game | App |
| Free or paid | Free |
| Declarations | Tick all 3 |

Then walk the left sidebar top-to-bottom — Play won't let you publish
until every section is green. Quick guide:

**Store listing**
- Short description (80 char): *"Hand-built CNC art and custom signs from vetted independent makers."*
- Full description (4000 char): paste your homepage hero copy + the "What you can buy" section from your `index.html` SEO body
- App icon: upload `frontend/public/icons/icon-512.png` (512×512)
- Feature graphic (1024×500): create one with your hero image — Canva works
- Phone screenshots: minimum 2, 1080×1920 — use Chrome DevTools mobile emulation on your live site, take 4–6 screenshots of: home, shop, product detail, cart, checkout success
- Category: Shopping
- Email: `team@craftersmarket.org`
- Privacy policy URL: `https://craftersmarket.org/policy/privacy` *(make sure that page exists)*

**App content** (compliance forms — answer honestly)
- Privacy policy: same URL as above
- Ads: No
- Content rating: complete the questionnaire (answer No to everything for shopping app → likely "Everyone")
- Target audience: 18+ (you sell goods, simpler)
- Data safety: declare what you collect (email, payment info via Stripe). Stripe is a "third-party processor."
- News app: No
- COVID-19 contact tracing: No
- Government app: No

**Production → Create new release**
- Upload `app-release-bundle.aab` from Step 6
- Release name auto-fills from version
- Release notes: *"Initial release. Browse and shop hand-built CNC art."*
- Save → Review release → Start rollout to production

**First review takes 1–7 days.** Use Internal Testing track to test
faster: same upload flow, but adds testers via email and skips review.

---

## Step 9 — Future updates

When you change app config (icons, permissions, name) bump the version:

```bash
cd ~/cm-android
bubblewrap update                    # pulls latest manifest from your domain
bubblewrap build                     # builds new .aab
# upload to Play Console → Production → Create new release → upload .aab
```

When you change just website code/UI/content — **do nothing**. The TWA
opens your live site, so updates ship the moment you redeploy from Emergent.

---

## Things that will burn 30 minutes if you skip them

1. **Back up `android.keystore` to 1Password / iCloud Keychain / a USB stick**.
   Lose it → can never update the app → start over with a new package ID.
2. **Pick the package ID once, never change it.** `org.craftersmarket.app` is permanent.
3. **Test on a real device before Play Console.** Address-bar visible = assetlinks broken.
4. **Privacy policy page must be reachable** before review or Play rejects.
5. **Use Internal Testing track first.** Production review = days. Internal = minutes.

---

## What to send me back

After Step 4, paste me your SHA-256 fingerprint and I'll fill the
`assetlinks.json` for you so you don't have to edit it manually.
