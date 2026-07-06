# Google Play Digital Asset Links — Insertion Procedure

**Status (iter426):** placeholder in place. Not to be replaced until the
first `.aab` is uploaded to Play Console.

**File:** `frontend/public/.well-known/assetlinks.json`

Currently:

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "org.craftersmarket.app",
      "sha256_cert_fingerprints": [
        "REPLACE_WITH_PLAY_APP_SIGNING_SHA256"
      ]
    }
  }
]
```

---

## What you MUST do — after the first Play Store upload

1. Upload your signed `.aab` to Google Play Console (Internal Testing track
   is fine — you don't need a live production release for the signing
   certificate to be generated).
2. **Play Console → Release → Setup → App integrity**.
3. Scroll to **App signing key certificate**. Copy the value labelled
   **SHA-256 certificate fingerprint** (48-character colon-separated hex,
   e.g. `1A:2B:3C:...`).
4. Paste that exact string into `sha256_cert_fingerprints[0]` in
   `frontend/public/.well-known/assetlinks.json`.
5. **Do NOT** use the *upload* key fingerprint or your local debug key.
   Google Play re-signs every APK with their own key after upload — only
   the "App signing key" fingerprint validates on the installed app.
6. Redeploy the frontend so the file is served publicly at:
   `https://craftersmarket.org/.well-known/assetlinks.json`
7. Verify with:
   ```
   curl -s https://craftersmarket.org/.well-known/assetlinks.json | jq .
   ```
   Confirm it returns your JSON array (not a 404 or the SPA fallback).
8. In Play Console, run **App integrity → Digital Asset Links → Verify** —
   Google fetches the URL and confirms domain ownership.

---

## Why we ship a placeholder

Google Play issues **each developer a different App Signing SHA-256** the
first time you upload a bundle. We cannot know it in advance. Shipping a
placeholder with clear replacement instructions is standard practice.

## If you also plan to publish a debug / test build

You may add MULTIPLE fingerprints to the `sha256_cert_fingerprints`
array — one entry per key. Example:

```json
"sha256_cert_fingerprints": [
  "AA:BB:CC:...",   // Play App Signing (production)
  "DD:EE:FF:..."    // internal test build key
]
```

## Package name

Current `package_name`: `org.craftersmarket.app`. If you change it in
`bubblewrap.config.js` or the TWA manifest, update the value here too.

## Notes

- assetlinks.json is served from the FRONTEND (React SPA) — the file lives
  in `public/.well-known/` so Create React App copies it verbatim to
  `build/.well-known/` on `yarn build`.
- The nginx / ingress config must NOT rewrite `.well-known/*` to the SPA
  index.html. Google's TWA verifier expects the RAW JSON bytes.
- Verify in preview before pushing to production:
  ```
  curl -s https://active-project-4.preview.emergentagent.com/.well-known/assetlinks.json
  ```
