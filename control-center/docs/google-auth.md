# Control Panel — Google Sign-In (primary auth)

Google Identity Services (GIS) ID-token sign-in for the OpsWorkbench Control Panel.
Magic-link/password remain as fallbacks. No client secret is used; the browser
uses only the public client_id.

## Routes (mounted under `/api`)
- `GET /api/auth/google/start` → `{ enabled, clientId?, nonce? }`. Issues a one-time
  `cc_google_nonce` httpOnly cookie (5 min) used for replay protection. When
  `GOOGLE_OAUTH_CLIENT_ID` is unset, returns `{ enabled: false }` and the UI shows
  only the password form.
- `POST /api/auth/google` `{ credential }` → verifies the Google ID token, applies
  the owner allowlist, and on success establishes the same secure `cc_session` +
  CSRF as password login. Rate-limited (added to the auth limiter).

**There is no OAuth redirect URI** — GIS returns the ID token to the page via the
button callback, so only an *authorized JavaScript origin* is required.

## Configuration (env)
- `GOOGLE_OAUTH_CLIENT_ID` — the public OAuth **Web** client id
  (`….apps.googleusercontent.com`). Store in the host env/secret store, **not** in git.
- No client secret is required for ID-token verification.
- Absent/empty → Google sign-in is disabled (feature-flagged off); password/magic
  paths are unaffected.

## Google Cloud setup
1. APIs & Services → Credentials → Create OAuth client ID → **Web application**.
2. **Authorized JavaScript origins:** `https://opsworkbench.org` (add
   `http://localhost:5173` for local dev). **No** Authorized redirect URI needed.
3. Copy the **Client ID** into `GOOGLE_OAUTH_CLIENT_ID` on the API host.

## Authorization model (unchanged)
Google authenticates *identity*; **AutomateX authorizes**. The verified, `email_verified`
Google email must match an existing, non-disabled user in the org (the `users`
collection is the allowlist). A Google account with **no matching user is denied**
(HTTP 403). No user is auto-created. Roles/permissions apply exactly as before.

## Security controls
- RS256 signature verified against Google's JWKS (fetched via `undici`, cached 1h,
  refetched on kid miss); claims checked: `iss` ∈ google, `aud === GOOGLE_OAUTH_CLIENT_ID`,
  `exp` (60s skew), `iat`, `email_verified === true`, and `nonce` == the httpOnly cookie.
- Session cookie is httpOnly + Secure (prod) + SameSite=Lax, 30-min, hashed CSPRNG token;
  per-session CSRF. Logout invalidates the session server-side. Unauthenticated `/dashboard`
  still gates to login (unchanged).

## Rollback
- **Instant disable, no redeploy:** unset `GOOGLE_OAUTH_CLIENT_ID` → `/auth/google`
  returns 404 and the button auto-hides; password/magic sign-in continue.
- **Full revert:** revert this commit. No DB schema/index/data changes were made, so
  removal is complete and side-effect-free.

## Tests
`apps/api/test/googleAuth.test.ts` — 10 unit tests (valid path + audience/expiry/nonce/
unverified-email/issuer/tamper/alg/unknown-key failures), self-contained (generates a
keypair, signs tokens, injects the JWKS). Run: `npm --workspace apps/api test`.
