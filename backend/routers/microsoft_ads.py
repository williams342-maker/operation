"""iter334w — Microsoft Ads (Bing) OAuth + daily sync.

Mirror of `routers/google_ads.py` for Microsoft Advertising. Provides:

  • OAuth start/callback flow → persists `refresh_token` long-term so the
    daily sync runs unattended.
  • Status endpoint → backs the `MicrosoftAdsConnectionCard.jsx` admin
    UI (config-ready vs connected vs error states).
  • Disconnect endpoint → clears the persisted token.
  • Manual sync trigger → backfills a single date on demand.

Required env vars (all live in `/app/backend/.env`):
    BING_DEVELOPER_TOKEN       From developers.ads.microsoft.com → Account.
    BING_CLIENT_ID             Azure App registration → Application (client) ID.
    BING_CLIENT_SECRET         Azure App registration → Certificates & secrets.
    BING_CUSTOMER_ID           Numeric — from ads.microsoft.com URL `?cid=...`
                               Optional — auto-discovered post-OAuth.
    BING_ACCOUNT_ID            Numeric — from ads.microsoft.com URL `?aid=...`
                               Optional — auto-discovered post-OAuth.

Auto-discovery: after the OAuth callback we call `GetCustomersInfo` /
`GetAccountsInfo` and store the first hit on the credential row when env
isn't pre-set. Ops can override later by editing the cred row directly.
"""
from __future__ import annotations
import logging
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from core import db, now_iso
from maker_auth import current_admin

logger = logging.getLogger("crafters.bing_ads")
router = APIRouter()

# ── OAuth endpoints (Microsoft v2.0, common tenant for personal MSAs) ──
AUTH_URI = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
TOKEN_URI = "https://login.microsoftonline.com/common/oauth2/v2.0/token"
# Permissions: manage MS Ads + offline_access for refresh token.
SCOPES = ["https://ads.microsoft.com/msads.manage", "offline_access"]


def _redirect_uri() -> str:
    """Resolve the OAuth redirect URI. Explicit env wins; otherwise
    derived from `PUBLIC_BACKEND_URL` so dev/preview/prod each get the
    correct host without per-env config."""
    explicit = (os.environ.get("BING_REDIRECT_URI") or "").strip()
    if explicit:
        return explicit
    base = (os.environ.get("PUBLIC_BACKEND_URL") or "").rstrip("/")
    if not base:
        return ""
    return f"{base}/api/admin/integrations/microsoft-ads/oauth/callback"


def _config_ok() -> tuple[bool, list[str]]:
    """Return (ready, missing_keys). Used by the status endpoint so the
    admin sees exactly which env vars still need a value.

    NOTE: `BING_CUSTOMER_ID` + `BING_ACCOUNT_ID` are NOT required pre-OAuth
    — we discover them after the user signs in. They're only flagged
    missing if discovery fails too (handled at sync time)."""
    needed = {
        "BING_DEVELOPER_TOKEN": os.environ.get("BING_DEVELOPER_TOKEN"),
        "BING_CLIENT_ID": os.environ.get("BING_CLIENT_ID"),
        "BING_CLIENT_SECRET": os.environ.get("BING_CLIENT_SECRET"),
    }
    if not _redirect_uri():
        needed["BING_REDIRECT_URI"] = None
    missing = [k for k, v in needed.items() if not (v or "").strip()]
    return (len(missing) == 0, missing)


# ── OAuth flow ────────────────────────────────────────────────────────
class OauthStartResponse(BaseModel):
    authorization_url: str
    state: str


@router.get("/admin/integrations/microsoft-ads/oauth/start",
            response_model=OauthStartResponse)
async def oauth_start(_: dict = Depends(current_admin)):
    ready, missing = _config_ok()
    if not ready:
        raise HTTPException(
            400,
            f"Microsoft Ads OAuth not configured. Missing env vars: {', '.join(missing)}",
        )

    state = secrets.token_urlsafe(32)
    await db.integration_oauth_states.insert_one({
        "_id": state,
        "provider": "microsoft_ads",
        "created_at": now_iso(),
        "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=10))
            .isoformat().replace("+00:00", "Z"),
    })

    params = {
        "client_id": os.environ["BING_CLIENT_ID"],
        "response_type": "code",
        "redirect_uri": _redirect_uri(),
        "scope": " ".join(SCOPES),
        # Microsoft's v2.0 endpoint rejects multi-value `prompt` (unlike
        # Google's `consent select_account`). Use a single value —
        # `select_account` is the more useful of the two since it
        # surfaces the account picker after first consent.
        "prompt": "select_account",
        "state": state,
    }
    return OauthStartResponse(
        authorization_url=f"{AUTH_URI}?{urlencode(params)}",
        state=state,
    )


@router.get("/admin/integrations/microsoft-ads/oauth/callback")
async def oauth_callback(
    code: Optional[str] = Query(default=None),
    state: Optional[str] = Query(default=None),
    error: Optional[str] = Query(default=None),
    error_description: Optional[str] = Query(default=None),
):
    """Exchange the auth code for tokens, auto-discover customer/account IDs,
    persist everything, then 302 back to the admin Ads tab."""
    site = (os.environ.get("PUBLIC_SITE_URL") or "").rstrip("/")
    err_redirect = f"{site}/admin/dashboard?tab=ads&microsoft_ads=error"

    if error:
        logger.warning("[bing_ads] OAuth callback error: %s — %s", error, error_description)
        return RedirectResponse(f"{err_redirect}&reason={error}", status_code=302)
    if not code or not state:
        return RedirectResponse(f"{err_redirect}&reason=missing_code", status_code=302)

    state_doc = await db.integration_oauth_states.find_one({"_id": state})
    if not state_doc or state_doc.get("provider") != "microsoft_ads":
        return RedirectResponse(f"{err_redirect}&reason=bad_state", status_code=302)
    await db.integration_oauth_states.delete_one({"_id": state})

    import httpx
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(TOKEN_URI, data={
                "code": code,
                "client_id": os.environ["BING_CLIENT_ID"],
                "client_secret": os.environ["BING_CLIENT_SECRET"],
                "redirect_uri": _redirect_uri(),
                "grant_type": "authorization_code",
                "scope": " ".join(SCOPES),
            })
            if resp.status_code != 200:
                logger.error("[bing_ads] token exchange %s: %s",
                             resp.status_code, resp.text[:500])
                return RedirectResponse(
                    f"{err_redirect}&reason=exchange_{resp.status_code}",
                    status_code=302,
                )
            tok = resp.json()
    except Exception as e:
        logger.exception("[bing_ads] token exchange failed: %s", e)
        return RedirectResponse(f"{err_redirect}&reason=exchange_failed",
                                status_code=302)

    refresh_token = tok.get("refresh_token")
    if not refresh_token:
        # Most likely cause: missing `offline_access` scope, or app
        # registration didn't include the mobile/native redirect platform.
        logger.warning("[bing_ads] no refresh_token in response. Keys: %s",
                       list(tok.keys()))
        return RedirectResponse(f"{err_redirect}&reason=no_refresh_token",
                                status_code=302)

    # Auto-discover customer_id + account_id via the Customer Management
    # SOAP service. Falls back to env vars if discovery fails.
    customer_id = (os.environ.get("BING_CUSTOMER_ID") or "").strip()
    account_id = (os.environ.get("BING_ACCOUNT_ID") or "").strip()
    discovered: list[dict] = []
    try:
        from .microsoft_ads_sdk import discover_accounts
        discovered = await discover_accounts(tok.get("access_token") or "")
        if discovered:
            customer_id = customer_id or str(discovered[0].get("customer_id") or "")
            account_id = account_id or str(discovered[0].get("account_id") or "")
            logger.info("[bing_ads] discovered %d account(s); chose customer=%s account=%s",
                        len(discovered), customer_id, account_id)
    except Exception as e:
        # Discovery is best-effort; ops can fill env vars later.
        logger.warning("[bing_ads] account discovery failed: %s", e)

    await db.integration_credentials.update_one(
        {"_id": "microsoft_ads"},
        {"$set": {
            "provider": "microsoft_ads",
            "refresh_token": refresh_token,
            "access_token": tok.get("access_token"),
            "token_type": tok.get("token_type"),
            "scope": tok.get("scope"),
            "connected_at": now_iso(),
            "customer_id": customer_id or None,
            "account_id": account_id or None,
            "discovered_accounts": discovered[:10],  # show in UI
        }},
        upsert=True,
    )
    logger.info("[bing_ads] OAuth connected; refresh_token persisted.")
    return RedirectResponse(
        f"{site}/admin/dashboard?tab=ads&microsoft_ads=connected",
        status_code=302,
    )


# ── Status / disconnect ───────────────────────────────────────────────
class MicrosoftAdsStatus(BaseModel):
    connected: bool
    config_ready: bool
    missing_env: list[str]
    connected_at: Optional[str] = None
    last_sync_at: Optional[str] = None
    last_sync_status: Optional[str] = None
    last_sync_error: Optional[str] = None
    rows_synced_yesterday: int = 0
    customer_id: Optional[str] = None
    account_id: Optional[str] = None
    discovered_accounts: list = []
    redirect_uri: Optional[str] = None


@router.get("/admin/integrations/microsoft-ads/status",
            response_model=MicrosoftAdsStatus)
async def status(_: dict = Depends(current_admin)):
    ready, missing = _config_ok()
    cred = await db.integration_credentials.find_one(
        {"_id": "microsoft_ads"}, {"_id": 0},
    )
    last = await db.integration_sync_log.find_one(
        {"provider": "microsoft_ads"},
        sort=[("started_at", -1)],
        projection={"_id": 0},
    )
    yest = (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%d")
    rows = await db.ad_spend.count_documents({
        "platform": "microsoft", "date": yest,
    })
    return MicrosoftAdsStatus(
        connected=bool(cred and cred.get("refresh_token")),
        config_ready=ready,
        missing_env=missing,
        connected_at=(cred or {}).get("connected_at"),
        last_sync_at=(last or {}).get("finished_at") or (last or {}).get("started_at"),
        last_sync_status=(last or {}).get("status"),
        last_sync_error=(last or {}).get("error"),
        rows_synced_yesterday=rows,
        customer_id=(cred or {}).get("customer_id"),
        account_id=(cred or {}).get("account_id"),
        discovered_accounts=(cred or {}).get("discovered_accounts") or [],
        redirect_uri=_redirect_uri() or None,
    )


@router.post("/admin/integrations/microsoft-ads/disconnect")
async def disconnect(_: dict = Depends(current_admin)):
    r = await db.integration_credentials.delete_one({"_id": "microsoft_ads"})
    return {"deleted": r.deleted_count}


# ── Manual sync trigger ────────────────────────────────────────────────
@router.post("/admin/integrations/microsoft-ads/sync")
async def manual_sync(
    date: Optional[str] = Query(default=None),
    _: dict = Depends(current_admin),
):
    """Backfill a single date. Defaults to yesterday so the UI lights up
    after first connect without waiting for the daily cron."""
    from .microsoft_ads_sdk import sync_metrics
    return await sync_metrics(date_str=date)


# ── Bulk backfill (one-time, after first ad spend) ─────────────────────
@router.post("/admin/integrations/microsoft-ads/backfill")
async def backfill(
    days: int = Query(default=30, ge=1, le=90),
    _: dict = Depends(current_admin),
):
    """Pull the last N days of campaign-level metrics into `ad_spend`.

    Used after a campaign first goes live so the admin tile fills in
    history immediately instead of waiting for the daily cron to walk
    forward one day at a time. Runs synchronously day-by-day (each call
    is ~3-8s against the MS Reporting API), so 30 days takes 2-4 min.

    Caps at 90 days to keep request budget bounded and because the
    Bing Reporting API throttles large historical pulls aggressively.

    Returns a summary `{status, days_requested, days_ok, days_skipped,
    days_error, total_rows, results: [...]}` so the UI can render a
    progress toast / per-day breakdown.
    """
    from .microsoft_ads_sdk import sync_metrics

    today = datetime.now(timezone.utc).date()
    results: list[dict] = []
    total_rows = 0
    n_ok = n_skip = n_err = 0

    # Walk yesterday → N days back (today's data isn't final yet so skip it).
    for i in range(1, days + 1):
        d = (today - timedelta(days=i)).strftime("%Y-%m-%d")
        try:
            r = await sync_metrics(date_str=d)
        except Exception as e:  # defensive — sync_metrics already wraps
            r = {"status": "error", "date": d, "error": str(e)[:200]}
        results.append(r)
        if r.get("status") == "ok":
            n_ok += 1
            total_rows += int(r.get("rows") or 0)
        elif r.get("status") == "skipped":
            n_skip += 1
        else:
            n_err += 1

    return {
        "status": "ok" if n_err == 0 else "partial",
        "days_requested": days,
        "days_ok": n_ok,
        "days_skipped": n_skip,
        "days_error": n_err,
        "total_rows": total_rows,
        "results": results,
    }
