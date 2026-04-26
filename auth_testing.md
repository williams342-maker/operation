# Auth Testing Playbook (Emergent Google Auth)

This is the testing playbook from `integration_playbook_expert_v2`. The testing
agent should read this file before testing community login.

## Backend
- Auth endpoints (no `/api` prefix shown — we use the `/api` prefix):
  - `POST /api/community/auth/google` — body `{session_id}` → returns `{token, user}`
  - `POST /api/community/auth/magic/request` — body `{email, origin_url}` → 200 (no enumeration)
  - `POST /api/community/auth/magic/verify` — body `{token}` → returns `{token, user}`
  - `GET /api/community/me` — Bearer JWT → returns the buyer profile

## Frontend
- `/community/login` shows two buttons: "Sign in with Google" + email magic-link form.
- Google flow:
  - Click "Sign in with Google" →
    `https://auth.emergentagent.com/?redirect=${window.location.origin}/community/auth/callback`
  - Callback reads `#session_id=…` from URL fragment, POSTs to `/api/community/auth/google`,
    stores returned JWT in `localStorage.cm_buyer_jwt`, navigates to `/community`.
  - REMINDER: redirect URL must be derived dynamically from `window.location.origin`. No
    fallbacks. No hardcoded URLs. Hardcoding breaks the auth.
- Magic link flow: identical to maker/admin flows, but role="buyer".

## Test identities
- Use any Google account in test mode. The session_id from
  `https://auth.emergentagent.com/?redirect=…` returns to the callback URL.
- For magic-link: any email works (auto-signup on first use).

## Common pitfalls
- Race condition: handle `session_id=` in URL fragment **synchronously during render**,
  not in `useEffect`.
- Don't proxy the Google call through the frontend — backend must hit
  `https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data`.
- Backend must accept `Authorization: Bearer <jwt>` (we don't use httpOnly cookies for
  this app — JWT in `localStorage` keeps the pattern consistent with maker/admin).

## See also
- `/app/memory/test_credentials.md` — current test creds
