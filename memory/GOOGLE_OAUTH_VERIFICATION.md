# Google OAuth Happy-Path Verification

The Google sign-in flow is fully wired up; what's left is a one-time end-to-end test that requires a real Google account click. Code-side verification (gating, error handling, callback rendering) was already covered by `test_iter9_followups.py::TestGoogleOAuthBackend`. This guide walks the human steps.

---

## What's Already Verified

✅ `/community/login` renders `[data-testid='community-google-btn']`
✅ Button links to the Emergent OAuth URL builder (`auth.emergentagent.com/?redirect=…`)
✅ `/community/auth/callback` route renders `[data-testid='community-auth-callback']`
✅ `POST /api/community/auth/google` rejects garbage session_id with 401
✅ `POST /api/community/auth/google` rejects empty body with 422
✅ Backend exchanges Emergent session_id for user profile and mints a buyer JWT

## What Needs You

The actual Google account-picker click — neither I nor the test agent have a real Google account session available.

---

## Steps (~2 minutes)

1. Open <https://active-project-4.preview.emergentagent.com/community/login> in a regular (non-incognito) Chrome/Firefox tab where you're already signed into Google.
2. Click the **"Continue with Google"** button (data-testid: `community-google-btn`).
3. Stripe-hosted page: Emergent will redirect you to Google's account picker. Pick the Google account you want associated with the Crafters Market community.
4. Google asks for permission to share your name + email + profile picture. Click **"Continue"**.
5. You'll redirect back to `https://active-project-4.preview.emergentagent.com/community/auth/callback#session_id=…`.
6. The callback page should auto-exchange the session_id for a buyer JWT and route you to `/community`.

---

## What to Look For

✅ **Success:** you land on `/community` and see your name in the top-right (or in the chat presence list).
✅ **localStorage** has `cm_buyer_jwt` and `cm_buyer_email` populated.
✅ Open `/admin/dashboard` → Users tab → your Google email shows up in the community users list.

❌ **If you see** "Could not verify your Google session" → the Emergent session_id wasn't honored. Most likely: the redirect URL needs to be added to the Emergent auth allow-list. Email Emergent support with the redirect URL.

❌ **If you land on `/community/login` again** → the callback URL fragment (`#session_id=…`) wasn't captured. Open browser devtools → Console → check for errors in `CommunityAuthCallback`.

---

## After Verification

Once verified, magic-link will remain the default for now. Both flows work — Google OAuth is useful for buyers who don't want to wait for an email.

If you'd like to make Google OAuth the **primary** sign-in (with magic-link as a fallback "sign in by email instead" link), let me know and I'll swap the priority on the `/community/login` page (~5 min change).
