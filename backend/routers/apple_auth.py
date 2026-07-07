"""Sign in with Apple — web + iOS WKWebView (App Store Guideline 4.8).

Redirect/form_post flow (works in every browser AND inside the Capacitor
WKWebView, unlike popup mode):

  1. GET  /community/auth/apple/start   → 302 to appleid.apple.com/auth/authorize
  2. Apple POSTs code + id_token (form_post) to /community/auth/apple/callback
  3. Backend verifies the id_token against Apple's JWKS (aud, iss, exp, nonce),
     upserts the buyer — linking by verified email so an Apple sign-in with the
     same address lands on the existing account — and 303-redirects to
     /signin?apple=ok&code=<one-time-code>
  4. Frontend POSTs /community/auth/apple/exchange {code} → standard buyer JWT.

Env (feature-flagged — endpoints 503 and the button hides when unset):
  APPLE_SERVICE_ID   — Services ID from the Apple Developer portal (the aud)
  APPLE_REDIRECT_URI — registered return URL, e.g.
                       https://craftersmarket.org/api/community/auth/apple/callback
"""
import json
import os
import secrets
import urllib.parse
from datetime import datetime, timedelta, timezone

import jwt as pyjwt
from fastapi import APIRouter, BackgroundTasks, Form, HTTPException, Request
from fastapi.responses import RedirectResponse
from jwt import PyJWKClient
from pydantic import BaseModel

from core import db, logger, now_iso
from maker_auth import issue_session_jwt

from .community_auth import _schedule_buyer_signup_mirror, _upsert_buyer
from .community_common import CURRENT_EUA_VERSION

router = APIRouter()

APPLE_SERVICE_ID = (os.environ.get("APPLE_SERVICE_ID") or "").strip()
APPLE_REDIRECT_URI = (os.environ.get("APPLE_REDIRECT_URI") or "").strip()
APPLE_AUTH_URL = "https://appleid.apple.com/auth/authorize"
APPLE_ISSUER = "https://appleid.apple.com"
APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys"

STATE_TTL_MINUTES = 10   # start → callback window
CODE_TTL_MINUTES = 5     # callback → exchange window

_jwks_client: PyJWKClient | None = None


def apple_enabled() -> bool:
    return bool(APPLE_SERVICE_ID and APPLE_REDIRECT_URI)


def _get_jwks_client() -> PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        _jwks_client = PyJWKClient(APPLE_JWKS_URL, cache_keys=True)
    return _jwks_client


def _expired(created_at: str, minutes: int) -> bool:
    try:
        ts = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        return datetime.now(timezone.utc) - ts > timedelta(minutes=minutes)
    except Exception:
        return True


def _signin_error(reason: str) -> RedirectResponse:
    # Relative Location — resolves against whichever host Apple posted to,
    # so the same code works on preview and production.
    return RedirectResponse(
        f"/signin?apple=error&reason={urllib.parse.quote(reason)}", status_code=303
    )


def verify_apple_id_token(id_token: str, expected_nonce: str) -> dict:
    """Verify signature (Apple JWKS), aud, iss, exp, and nonce. Raises on failure."""
    signing_key = _get_jwks_client().get_signing_key_from_jwt(id_token)
    claims = pyjwt.decode(
        id_token,
        signing_key.key,
        algorithms=["RS256", "ES256"],
        audience=APPLE_SERVICE_ID,
        issuer=APPLE_ISSUER,
    )
    if expected_nonce and claims.get("nonce") != expected_nonce:
        raise ValueError("nonce mismatch")
    return claims


@router.get("/community/auth/apple/start")
async def apple_start(eua_version: str = ""):
    """Kick off the Apple flow. `eua_version` carries the buyer's Community
    Terms acceptance through the round-trip (validated at the callback)."""
    if not apple_enabled():
        raise HTTPException(503, "Apple sign-in is not configured.")
    state = secrets.token_urlsafe(24)
    nonce = secrets.token_urlsafe(24)
    await db.apple_auth_states.insert_one({
        "state": state,
        "nonce": nonce,
        "eua_version": eua_version or "",
        "created_at": now_iso(),
    })
    params = {
        "client_id": APPLE_SERVICE_ID,
        "redirect_uri": APPLE_REDIRECT_URI,
        "response_type": "code id_token",
        "scope": "name email",           # scopes require response_mode=form_post
        "response_mode": "form_post",
        "state": state,
        "nonce": nonce,
    }
    return RedirectResponse(f"{APPLE_AUTH_URL}?{urllib.parse.urlencode(params)}", status_code=302)


@router.post("/community/auth/apple/callback")
async def apple_callback(
    state: str = Form(""),
    code: str = Form(""),
    id_token: str = Form(""),
    user: str = Form(""),
    error: str = Form(""),
):
    """Apple's form_post lands here. On success we mint a one-time login code
    and bounce back to /signin for the JWT exchange (keeps tokens out of URLs
    that could end up in logs/history)."""
    if error:
        reason = "cancelled" if error == "user_cancelled_authorize" else error
        return _signin_error(reason)
    if not state or not id_token:
        return _signin_error("missing_response")

    st = await db.apple_auth_states.find_one_and_delete({"state": state})
    if not st or _expired(st.get("created_at", ""), STATE_TTL_MINUTES):
        return _signin_error("state_expired")

    try:
        claims = verify_apple_id_token(id_token, st.get("nonce", ""))
    except Exception as e:
        logger.warning("[apple-auth] id_token verification failed: %s", e)
        return _signin_error("invalid_token")

    sub = claims.get("sub") or ""
    email = (claims.get("email") or "").lower().strip()
    email_verified = claims.get("email_verified") in (True, "true")
    if not sub:
        return _signin_error("invalid_token")
    if not email or not email_verified:
        # Extremely rare (Apple always supplies a verified real-or-relay email
        # when the email scope is granted) but fail safe.
        return _signin_error("email_unavailable")

    # EUA gate — returning users on the current version pass; first-timers
    # must have checked the box before starting (carried via eua_version).
    existing = await db.community_users.find_one({"email": email}, {"_id": 0, "eua_version": 1})
    accepted_now = st.get("eua_version") == CURRENT_EUA_VERSION
    if not ((existing and existing.get("eua_version") == CURRENT_EUA_VERSION) or accepted_now):
        return _signin_error("eua_required")

    # First-auth only: Apple includes a `user` JSON blob with the name.
    name = ""
    if user:
        try:
            n = (json.loads(user).get("name") or {})
            name = " ".join(x for x in [n.get("firstName"), n.get("lastName")] if x).strip()
        except Exception:
            pass

    # Email-keyed upsert = automatic account linking: an Apple sign-in with
    # the same verified email lands on the existing buyer account.
    u = await _upsert_buyer(
        email=email,
        name=name,
        eua_version=CURRENT_EUA_VERSION if accepted_now else "",
    )
    is_new = u.pop("_is_new_signup", False)
    await db.community_users.update_one(
        {"user_id": u["user_id"]},
        {"$set": {"apple_sub": sub, "apple_private_email": claims.get("is_private_email") in (True, "true")}},
    )

    otc = secrets.token_urlsafe(32)
    await db.apple_login_codes.insert_one({
        "code": otc,
        "user_id": u["user_id"],
        "is_new": is_new,
        "created_at": now_iso(),
    })
    return RedirectResponse(f"/signin?apple=ok&code={urllib.parse.quote(otc)}", status_code=303)


class AppleExchangeRequest(BaseModel):
    code: str


@router.post("/community/auth/apple/exchange")
async def apple_exchange(payload: AppleExchangeRequest, request: Request, bg: BackgroundTasks):
    """Swap the single-use login code for the standard buyer session JWT."""
    doc = await db.apple_login_codes.find_one_and_delete({"code": payload.code})
    if not doc or _expired(doc.get("created_at", ""), CODE_TTL_MINUTES):
        raise HTTPException(401, "Sign-in expired — please try Apple sign-in again.")
    user = await db.community_users.find_one({"user_id": doc["user_id"]}, {"_id": 0})
    if not user:
        raise HTTPException(404, "Account not found.")
    token = issue_session_jwt(user["user_id"], user["email"], role="buyer")
    signup_event_id = ""
    if doc.get("is_new"):
        signup_event_id = _schedule_buyer_signup_mirror(
            bg, user=user, request=request, label="apple_oauth",
        )
    return {
        "token": token,
        "user": user,
        "is_new_signup": bool(doc.get("is_new")),
        "signup_event_id": signup_event_id,
    }
