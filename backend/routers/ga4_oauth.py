"""GA4 OAuth admin endpoints — sign in with your own Google account flow.

Bypasses the service-account "doesn't match a Google Account" hell. The
admin signs in with their personal Gmail (which already has Viewer+ access
on the GA4 property), grants the analytics.readonly scope, and we cache
the refresh_token in `db.ga4_oauth`. From then on `ga4_analytics._client()`
uses Credentials.from_authorized_user_info() to mint short-lived access
tokens automatically.

Endpoints:
  • GET  /admin/ga4/status          — connection state + which mode is active
  • GET  /admin/ga4/oauth-start     — returns Google authorization URL
  • GET  /admin/ga4/oauth-callback  — Google redirect; stores refresh_token
  • POST /admin/ga4/disconnect      — revokes the stored token

OAuth client is the SAME one used for GSC (env vars `GSC_OAUTH_CLIENT_ID`
+ `GSC_OAUTH_CLIENT_SECRET`). User only needs to add one new redirect URI
to that client: `{PUBLIC_SITE_URL}/api/admin/ga4/oauth-callback`.
"""
from __future__ import annotations
import logging
import os
import secrets
import time
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse

from core import db, now_iso
from maker_auth import current_admin

logger = logging.getLogger("crafters.ga4.oauth")
router = APIRouter()

GA4_SCOPES = ["https://www.googleapis.com/auth/analytics.readonly"]

# In-memory CSRF state map — tiny single-admin scenario, no Mongo needed.
_oauth_state: dict[str, float] = {}
_STATE_TTL_SECONDS = 600


def _prune_states() -> None:
    now = time.time()
    for k, ts in list(_oauth_state.items()):
        if now - ts > _STATE_TTL_SECONDS:
            _oauth_state.pop(k, None)


def _redirect_uri() -> str:
    """Computed at request time so a hot-reloaded env var picks up."""
    site = (os.environ.get("PUBLIC_SITE_URL") or "").rstrip("/")
    if not site:
        site = (os.environ.get("PUBLIC_BACKEND_URL") or "").rstrip("/")
    return f"{site}/api/admin/ga4/oauth-callback"


def _oauth_configured() -> bool:
    return bool(
        (os.environ.get("GSC_OAUTH_CLIENT_ID") or "").strip()
        and (os.environ.get("GSC_OAUTH_CLIENT_SECRET") or "").strip()
    )


@router.get("/admin/ga4/oauth-start")
async def ga4_oauth_start(_: dict = Depends(current_admin)):
    """Return the Google authorization URL for the admin to visit."""
    if not _oauth_configured():
        raise HTTPException(
            500,
            "OAuth client not configured. GSC_OAUTH_CLIENT_ID + "
            "GSC_OAUTH_CLIENT_SECRET env vars must be set (we reuse the GSC client).",
        )
    client_id = (os.environ.get("GSC_OAUTH_CLIENT_ID") or "").strip()
    redirect_uri = _redirect_uri()

    _prune_states()
    state = secrets.token_urlsafe(24)
    _oauth_state[state] = time.time()

    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": " ".join(GA4_SCOPES),
        "access_type": "offline",      # we need a refresh_token
        "prompt": "consent",           # force refresh_token even on re-auth
        "include_granted_scopes": "true",
        "state": state,
    }
    return {
        "authorization_url": f"https://accounts.google.com/o/oauth2/v2/auth?{urlencode(params)}",
        "redirect_uri": redirect_uri,
    }


@router.get("/admin/ga4/oauth-callback")
async def ga4_oauth_callback(request: Request):
    """Google redirects here after the admin consents.

    NOT admin-auth-gated — Google itself triggered the redirect, the
    CSRF `state` proves it came from our own start endpoint."""
    code = request.query_params.get("code")
    state = request.query_params.get("state")
    err = request.query_params.get("error")

    def _result_page(success: bool, message: str) -> HTMLResponse:
        color = "#10b981" if success else "#ef4444"
        title = "GA4 connected" if success else "Connection failed"
        return HTMLResponse(
            f"""<!doctype html><meta charset="utf-8"><title>{title}</title>
<body style="background:#0a0a0a;color:#e5e5e5;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
  <div style="max-width:460px;padding:32px;border:1px solid #262626;background:#0d0d0d;text-align:center">
    <div style="font-size:32px;color:{color};margin-bottom:12px">{'✓' if success else '✗'}</div>
    <h1 style="font-size:18px;margin:0 0 12px;text-transform:uppercase;letter-spacing:0.18em">{title}</h1>
    <p style="font-size:13px;color:#a3a3a3;line-height:1.6;margin:0 0 18px">{message}</p>
    <p style="font-size:11px;color:#525252">This tab will close automatically.</p>
  </div>
  <script>
    try {{
      if (window.opener) {{
        window.opener.postMessage({{type:"ga4-oauth", success: {str(success).lower()}}}, "*");
      }}
    }} catch(e) {{}}
    setTimeout(() => window.close(), 2500);
  </script>
</body>"""
        )

    if err:
        return _result_page(False, f"Google reported: {err}")
    if not code or not state:
        return _result_page(False, "Missing code or state parameter.")
    if state not in _oauth_state:
        return _result_page(False, "Invalid or expired state — re-open the connect window and try again.")
    _oauth_state.pop(state, None)

    client_id = (os.environ.get("GSC_OAUTH_CLIENT_ID") or "").strip()
    client_secret = (os.environ.get("GSC_OAUTH_CLIENT_SECRET") or "").strip()
    redirect_uri = _redirect_uri()

    try:
        import httpx as _httpx
        async with _httpx.AsyncClient(timeout=15) as c:
            r = await c.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "code": code,
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "redirect_uri": redirect_uri,
                    "grant_type": "authorization_code",
                },
            )
            r.raise_for_status()
            tok = r.json()
    except Exception as e:
        logger.exception("[ga4] token exchange failed")
        return _result_page(False, f"Token exchange failed: {e}")

    refresh_token = tok.get("refresh_token")
    if not refresh_token:
        return _result_page(
            False,
            "Google did not return a refresh token. Open "
            "myaccount.google.com → Security → Third-party access → "
            "revoke this app, then retry.",
        )

    # Fetch the connected account email for display.
    connected_email = ""
    try:
        import httpx as _httpx
        async with _httpx.AsyncClient(timeout=10) as c:
            r = await c.get(
                "https://www.googleapis.com/oauth2/v2/userinfo",
                headers={"Authorization": f"Bearer {tok.get('access_token')}"},
            )
            if r.status_code == 200:
                connected_email = r.json().get("email", "")
    except Exception:
        pass

    await db.ga4_oauth.update_one(
        {"_id": "singleton"},
        {"$set": {
            "refresh_token": refresh_token,
            "connected_email": connected_email,
            "connected_at": now_iso(),
            "scopes": GA4_SCOPES,
        }},
        upsert=True,
    )
    # Bust the cached client so the next API call picks up OAuth creds.
    try:
        from routers.ga4_analytics import _client
        _client.cache_clear()
    except Exception:
        pass

    return _result_page(
        True,
        f"Connected as {connected_email or 'your Google account'}. "
        "The live-analytics widget will start showing real numbers immediately.",
    )


@router.get("/admin/ga4/status")
async def ga4_status(_: dict = Depends(current_admin)):
    """Auth-mode + connection state for the admin UI panel."""
    doc = await db.ga4_oauth.find_one({"_id": "singleton"}, {"_id": 0, "refresh_token": 0})
    sa_path = os.environ.get("GA4_SERVICE_ACCOUNT_JSON_PATH", "/app/backend/secrets/ga4_service_account.json")
    sa_present = os.path.exists(sa_path)
    return {
        "oauth_configured": _oauth_configured(),
        "oauth_connected": bool(doc),
        "oauth_connection": doc or None,
        "service_account_present": sa_present,
        "redirect_uri": _redirect_uri(),
        "active_mode": "oauth" if doc else ("service_account" if sa_present else "none"),
    }


@router.post("/admin/ga4/disconnect")
async def ga4_disconnect(_: dict = Depends(current_admin)):
    """Forget the stored refresh-token. Next API call falls back to the
    service account JSON if present, else 503."""
    await db.ga4_oauth.delete_one({"_id": "singleton"})
    try:
        from routers.ga4_analytics import _client
        _client.cache_clear()
    except Exception:
        pass
    return {"ok": True}
