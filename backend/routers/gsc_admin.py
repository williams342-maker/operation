"""GSC admin endpoints — OAuth connect flow + status + test inspection.

Lets the admin bypass the "user not found" service-account error by
signing in with their own Google account (which already has GSC access
for the property). The refresh-token Google returns is stored in
`db.gsc_oauth` and used by `gsc_client._client()` for every subsequent
URL Inspection call.

Endpoints:
  • GET  /admin/gsc/status          — current connection state
  • GET  /admin/gsc/oauth-start     — returns Google authorization URL
  • GET  /admin/gsc/oauth-callback  — handles Google redirect, stores token
  • POST /admin/gsc/disconnect      — revokes the stored token
  • POST /admin/gsc/test-inspect    — runs one URL Inspection now (verify)

Storage: a single `db.gsc_oauth` document keyed by `_id: "singleton"`.
Stored fields: `refresh_token`, `client_email_or_account`, `connected_at`,
`scopes`.
"""
from __future__ import annotations
import logging
import os
import secrets
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse, HTMLResponse

from core import db, now_iso
from maker_auth import current_admin
from gsc_client import GSC_SCOPES, _reset_client_cache, inspect_url

logger = logging.getLogger("crafters.gsc.admin")
router = APIRouter()

# In-memory CSRF state. Single-admin scenario so a tiny dict is fine —
# entries auto-expire after 10 minutes. Persisting to Mongo would be
# overkill for a flow that takes 30 seconds.
_oauth_state: dict[str, float] = {}
_STATE_TTL_SECONDS = 600


def _prune_states() -> None:
    import time
    now = time.time()
    for k, ts in list(_oauth_state.items()):
        if now - ts > _STATE_TTL_SECONDS:
            _oauth_state.pop(k, None)


@router.get("/admin/gsc/status")
async def gsc_status(_: dict = Depends(current_admin)):
    """Connection status for the admin UI panel."""
    oauth_configured = bool(
        (os.environ.get("GSC_OAUTH_CLIENT_ID") or "").strip()
        and (os.environ.get("GSC_OAUTH_CLIENT_SECRET") or "").strip()
        and (os.environ.get("GSC_OAUTH_REDIRECT_URI") or "").strip()
    )
    sa_configured = bool((os.environ.get("GSC_SERVICE_ACCOUNT_JSON") or "").strip())
    enabled = (os.environ.get("GSC_ENABLED") or "").strip() == "1"
    site_url = os.environ.get("GSC_SITE_URL") or ""
    doc = await db.gsc_oauth.find_one({"_id": "singleton"}, {"_id": 0, "refresh_token": 0})
    return {
        "enabled": enabled,
        "site_url": site_url,
        "oauth_configured": oauth_configured,
        "service_account_configured": sa_configured,
        "connected": bool(doc),
        "connection": doc or None,
        "redirect_uri": os.environ.get("GSC_OAUTH_REDIRECT_URI") or "",
    }


@router.get("/admin/gsc/oauth-start")
async def gsc_oauth_start(_: dict = Depends(current_admin)):
    """Return the Google authorization URL for the admin to visit.

    Frontend opens this URL in a popup or new tab. After consent, Google
    redirects to `/admin/gsc/oauth-callback?code=...&state=...`."""
    client_id = (os.environ.get("GSC_OAUTH_CLIENT_ID") or "").strip()
    redirect_uri = (os.environ.get("GSC_OAUTH_REDIRECT_URI") or "").strip()
    if not client_id or not redirect_uri:
        raise HTTPException(
            500,
            "GSC OAuth not configured. Set GSC_OAUTH_CLIENT_ID, "
            "GSC_OAUTH_CLIENT_SECRET, and GSC_OAUTH_REDIRECT_URI env vars.",
        )

    import time
    _prune_states()
    state = secrets.token_urlsafe(24)
    _oauth_state[state] = time.time()

    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": " ".join(GSC_SCOPES),
        "access_type": "offline",      # we need a refresh_token
        "prompt": "consent",           # force refresh_token even on re-auth
        "include_granted_scopes": "true",
        "state": state,
    }
    return {
        "authorization_url": f"https://accounts.google.com/o/oauth2/v2/auth?{urlencode(params)}",
    }


@router.get("/admin/gsc/oauth-callback")
async def gsc_oauth_callback(request: Request):
    """Google redirects here after the admin consents. NOT admin-auth'd —
    Google itself triggered the redirect. Validates the CSRF `state`
    against the in-memory set, then exchanges the code for a
    refresh_token via Google's token endpoint."""
    code = request.query_params.get("code")
    state = request.query_params.get("state")
    err = request.query_params.get("error")

    def _result_page(success: bool, message: str) -> HTMLResponse:
        # Tiny self-closing page that posts result back to the opener and
        # closes itself. Falls back to a "you can close this tab" message
        # if the page wasn't opened via window.open().
        color = "#10b981" if success else "#ef4444"
        title = "GSC connected" if success else "Connection failed"
        return HTMLResponse(
            f"""<!doctype html><meta charset="utf-8"><title>{title}</title>
<body style="background:#0a0a0a;color:#e5e5e5;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
  <div style="max-width:420px;padding:32px;border:1px solid #262626;background:#0d0d0d;text-align:center">
    <div style="font-size:32px;color:{color};margin-bottom:12px">{'✓' if success else '✗'}</div>
    <h1 style="font-size:18px;margin:0 0 12px;text-transform:uppercase;letter-spacing:0.18em">{title}</h1>
    <p style="font-size:13px;color:#a3a3a3;line-height:1.6;margin:0 0 18px">{message}</p>
    <p style="font-size:11px;color:#525252">This tab will close automatically.</p>
  </div>
  <script>
    try {{
      if (window.opener) {{
        window.opener.postMessage({{type:"gsc-oauth", success: {str(success).lower()}}}, "*");
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
    redirect_uri = (os.environ.get("GSC_OAUTH_REDIRECT_URI") or "").strip()

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
        logger.exception("[gsc] token exchange failed")
        return _result_page(False, f"Token exchange failed: {e}")

    refresh_token = tok.get("refresh_token")
    if not refresh_token:
        return _result_page(
            False,
            "Google did not return a refresh token. Open Google Account → "
            "Security → 3rd-party access → revoke this app, then retry.",
        )

    # Try to fetch the connected account email for display.
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

    await db.gsc_oauth.update_one(
        {"_id": "singleton"},
        {"$set": {
            "refresh_token": refresh_token,
            "connected_email": connected_email,
            "connected_at": now_iso(),
            "scopes": GSC_SCOPES,
        }},
        upsert=True,
    )
    _reset_client_cache()
    return _result_page(
        True,
        f"Connected as {connected_email or 'your Google account'}. "
        "URL inspections will start running in the next scheduled sweep.",
    )


@router.post("/admin/gsc/disconnect")
async def gsc_disconnect(_: dict = Depends(current_admin)):
    """Forget the stored refresh-token. The next request rebuilds the
    client; if no service-account JSON is configured either, GSC falls
    back to disabled and the sitemap-heuristic resumes."""
    await db.gsc_oauth.delete_one({"_id": "singleton"})
    _reset_client_cache()
    return {"ok": True}


@router.post("/admin/gsc/test-inspect")
async def gsc_test_inspect(
    body: dict | None = None,
    _: dict = Depends(current_admin),
):
    """Run ONE URL Inspection now to verify the connection. Defaults
    to the site root if no slug is provided."""
    slug = (body or {}).get("slug", "").strip()
    site_root = (os.environ.get("PUBLIC_APP_URL") or "https://craftersmarket.org").rstrip("/")
    target = f"{site_root}/shop/{slug}" if slug else f"{site_root}/"
    result = await inspect_url(target)
    if result is None:
        return {"ok": False, "url": target, "reason": "no result (check connection + GSC property URL match)"}
    from gsc_client import map_to_tier
    return {
        "ok": True,
        "url": target,
        "tier": map_to_tier(result),
        "coverage": ((result.get("indexStatusResult") or {}).get("coverageState") or ""),
        "verdict": ((result.get("indexStatusResult") or {}).get("verdict") or ""),
        "last_crawl": ((result.get("indexStatusResult") or {}).get("lastCrawlTime") or ""),
    }
