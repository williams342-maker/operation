"""Google Ads API integration — OAuth + daily metrics sync.

Why this lives separate from `routers/ad_spend.py`:
    `ad_spend.py` is the platform-agnostic ledger + dashboard query layer
    that already powers the admin Ads tab. This module is the *source*
    that writes Google rows into that ledger so the existing UI just
    works once an admin connects their Google Ads MCC.

Lifecycle:
    1. Admin clicks "Connect Google Ads" in the AdsTab.
    2. Frontend hits `GET /api/admin/integrations/google-ads/oauth/start`
       which returns a Google authorize URL (with a CSRF state token).
    3. Browser redirects through Google's consent screen and lands on
       `GET /api/admin/integrations/google-ads/oauth/callback?code=…&state=…`.
    4. Callback exchanges the code for a refresh_token, persists it to
       `db.integration_credentials` (`_id="google_ads"`), then 302s back
       to `/admin/dashboard?tab=ads&google_ads=connected`.
    5. The daily 03:30 UTC scheduler pulls yesterday's campaign-level
       spend/clicks/impressions/conversions via GAQL and upserts them
       into `db.ad_spend` keyed (platform=google, campaign_id, date).
    6. The existing AdsTab metrics endpoint reads `ad_spend` and the
       data shows up immediately — no UI work needed beyond the
       connection card itself.

Env-var contract (all OPTIONAL — module is a graceful no-op when any are
missing so preview pods stay healthy):
    GOOGLE_ADS_DEVELOPER_TOKEN          22-char token from Ads API Center
    GOOGLE_ADS_CLIENT_ID                OAuth Web client (Cloud Console)
    GOOGLE_ADS_CLIENT_SECRET            OAuth Web client secret
    GOOGLE_ADS_LOGIN_CUSTOMER_ID        Manager (MCC) customer ID, no hyphens
    GOOGLE_ADS_REDIRECT_URI             https://<host>/api/admin/integrations/google-ads/oauth/callback
                                        (auto-derived from PUBLIC_BACKEND_URL when blank)

2026 catches baked into this module:
    - `use_proto_plus=True` is mandatory in google-ads ≥14; we set it.
    - `login_customer_id` MUST be hyphen-stripped before SDK init.
    - Refresh tokens last only 7 days while the OAuth consent screen is
      in "Testing" status — the connection-status endpoint surfaces this
      so an admin sees "needs reconnect" before a sync silently fails.
    - Sync calls run in a thread pool because google-ads SDK is sync-only
      and would otherwise block FastAPI's event loop.
"""
from __future__ import annotations

import asyncio
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, RedirectResponse
from pydantic import BaseModel

from config import env_get, settings
from core import db, logger, now_iso
from maker_auth import current_admin

router = APIRouter()


# iter269 — Public route that serves the pre-built "Design documentation"
# PDF required by Google Ads API Center's Basic Access application. We
# can't gate it behind admin auth because the reviewer at Google needs
# to download the file the operator uploads — and uploading from a
# logged-in admin browser only works if the file URL is browser-reachable
# anyway. Stays public; the content has no secrets in it.
@router.get("/google-ads/design-doc.pdf")
async def google_ads_design_doc():
    """Returns the PDF design document used in Google's Basic Access
    application form. Static asset — never regenerated at request time."""
    import os as _os
    pdf_path = _os.path.join(_os.path.dirname(__file__), "_google_ads_design_doc.pdf")
    if not _os.path.exists(pdf_path):
        raise HTTPException(404, "Design doc not bundled with this deploy.")
    return FileResponse(
        pdf_path,
        media_type="application/pdf",
        filename="crafters_market_google_ads_api_design.pdf",
    )


# ---------------- Config helpers ---------------- #
def _redirect_uri() -> str:
    """Resolve the OAuth redirect URI. Explicit env var wins; otherwise
    we derive from PUBLIC_BACKEND_URL so dev/preview/prod each get the
    correct host without redeploying."""
    return settings.google_ads_redirect()


def _config_ok() -> tuple[bool, list[str]]:
    """Return (ready, missing_keys). Used by the status endpoint so the
    admin sees exactly which env vars still need a value."""
    needed = {
        "GOOGLE_ADS_DEVELOPER_TOKEN": settings.google_ads_developer_token,
        "GOOGLE_ADS_CLIENT_ID": settings.google_ads_client_id,
        "GOOGLE_ADS_CLIENT_SECRET": settings.google_ads_client_secret,
        "GOOGLE_ADS_LOGIN_CUSTOMER_ID": settings.google_ads_login_customer_id,
    }
    if not _redirect_uri():
        needed["GOOGLE_ADS_REDIRECT_URI"] = None
    missing = [k for k, v in needed.items() if not (v or "").strip()]
    return (len(missing) == 0, missing)


SCOPES = ["https://www.googleapis.com/auth/adwords"]
AUTH_URI = "https://accounts.google.com/o/oauth2/auth"
TOKEN_URI = "https://oauth2.googleapis.com/token"


# ---------------- OAuth flow ---------------- #
class OauthStartResponse(BaseModel):
    authorization_url: str
    state: str


@router.get("/admin/integrations/google-ads/oauth/start",
            response_model=OauthStartResponse)
async def oauth_start(_: dict = Depends(current_admin)):
    """Mint a CSRF state token and return Google's consent URL."""
    ready, missing = _config_ok()
    if not ready:
        raise HTTPException(
            400,
            f"Google Ads OAuth not configured. Missing env vars: {', '.join(missing)}",
        )

    state = secrets.token_urlsafe(32)
    # Persist state with a 10-minute TTL. We store it in Mongo (not
    # in-memory) so the callback can land on a different uvicorn worker
    # and still validate.
    await db.integration_oauth_states.insert_one({
        "_id": state,
        "provider": "google_ads",
        "created_at": now_iso(),
        "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=10))
            .isoformat().replace("+00:00", "Z"),
    })

    params = {
        "client_id": settings.google_ads_client_id,
        "redirect_uri": _redirect_uri(),
        "response_type": "code",
        "scope": " ".join(SCOPES),
        # `access_type=offline` is what causes Google to issue a
        # refresh_token alongside the access_token. Without it we'd
        # get an access_token only and the daily sync would fail.
        "access_type": "offline",
        # `prompt=consent select_account` — iter314d:
        # • `consent` forces Google to re-issue a refresh_token even
        #   when the admin has previously authorized this OAuth app
        #   (Google de-dupes refresh tokens by default).
        # • `select_account` forces Google to show the account picker
        #   instead of silently using whichever Google account the
        #   browser is currently signed in to. Prevents the wrong-account
        #   trap (e.g. signed in as williams342 when you mean
        #   williams1cnc — the Google Ads account owner).
        "prompt": "consent select_account",
        "state": state,
    }
    return OauthStartResponse(
        authorization_url=f"{AUTH_URI}?{urlencode(params)}",
        state=state,
    )


@router.get("/admin/integrations/google-ads/oauth/callback")
async def oauth_callback(
    code: Optional[str] = Query(default=None),
    state: Optional[str] = Query(default=None),
    error: Optional[str] = Query(default=None),
):
    """Exchange the OAuth `code` for tokens and persist the refresh_token.

    Public endpoint (no admin guard) because Google's consent flow can't
    forward auth headers — but we authenticate via the CSRF `state` we
    minted server-side in `oauth_start`. After persistence we 302 back
    to the AdsTab so the admin lands on a connected dashboard.
    """
    site = (env_get("PUBLIC_SITE_URL") or "").rstrip("/")
    err_redirect = f"{site}/admin/dashboard?tab=ads&google_ads=error"

    if error:
        logger.warning("[google_ads] OAuth callback returned error: %s", error)
        return RedirectResponse(f"{err_redirect}&reason={error}", status_code=302)
    if not code or not state:
        logger.warning("[google_ads] OAuth callback missing code/state. code=%s state=%s",
                       bool(code), bool(state))
        return RedirectResponse(f"{err_redirect}&reason=missing_code", status_code=302)

    state_doc = await db.integration_oauth_states.find_one({"_id": state})
    if not state_doc or state_doc.get("provider") != "google_ads":
        logger.warning("[google_ads] OAuth callback got bad/expired state: %s (doc_found=%s)",
                       state[:12], bool(state_doc))
        return RedirectResponse(f"{err_redirect}&reason=bad_state", status_code=302)
    # Single-use state — delete immediately to prevent replay
    await db.integration_oauth_states.delete_one({"_id": state})
    logger.info("[google_ads] OAuth callback state validated, exchanging code…")

    # Exchange code → tokens. We use httpx directly rather than
    # google-auth-oauthlib's Flow because we already have httpx in the
    # tree and the request shape is trivial.
    import httpx
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(TOKEN_URI, data={
                "code": code,
                "client_id": settings.google_ads_client_id,
                "client_secret": settings.google_ads_client_secret,
                "redirect_uri": _redirect_uri(),
                "grant_type": "authorization_code",
            })
            if resp.status_code != 200:
                # Surface Google's error JSON so the operator (and us)
                # can see exactly why the exchange was rejected. The
                # body usually has `{"error":"invalid_grant", ...}`.
                logger.error(
                    "[google_ads] token exchange returned %s: %s",
                    resp.status_code, resp.text[:500],
                )
                return RedirectResponse(
                    f"{err_redirect}&reason=exchange_{resp.status_code}",
                    status_code=302,
                )
            tok = resp.json()
    except Exception as e:
        logger.exception("[google_ads] token exchange failed: %s", e)
        return RedirectResponse(f"{err_redirect}&reason=exchange_failed", status_code=302)

    refresh_token = tok.get("refresh_token")
    if not refresh_token:
        # Most common cause: the OAuth app already issued a refresh
        # token to this account previously and Google de-dupes. Fix is
        # to revoke at https://myaccount.google.com/permissions then
        # click Connect again.
        logger.warning(
            "[google_ads] OAuth callback: token exchange OK but no refresh_token in response. "
            "Keys returned: %s. Likely deduped by Google — admin must revoke at "
            "https://myaccount.google.com/permissions and reconnect.",
            list(tok.keys()),
        )
        return RedirectResponse(
            f"{err_redirect}&reason=no_refresh_token",
            status_code=302,
        )

    await db.integration_credentials.update_one(
        {"_id": "google_ads"},
        {"$set": {
            "provider": "google_ads",
            "refresh_token": refresh_token,
            "access_token": tok.get("access_token"),
            "scope": tok.get("scope"),
            "token_type": tok.get("token_type"),
            "connected_at": now_iso(),
            "login_customer_id": (
                settings.google_ads_login_customer_id.replace("-", "")
            ),
        }},
        upsert=True,
    )
    logger.info("[google_ads] OAuth connected, refresh_token persisted.")
    return RedirectResponse(
        f"{site}/admin/dashboard?tab=ads&google_ads=connected",
        status_code=302,
    )


# ---------------- Status / disconnect ---------------- #
class GoogleAdsStatus(BaseModel):
    connected: bool
    config_ready: bool
    missing_env: list[str]
    connected_at: Optional[str] = None
    last_sync_at: Optional[str] = None
    last_sync_status: Optional[str] = None
    last_sync_error: Optional[str] = None
    rows_synced_yesterday: int = 0
    login_customer_id: Optional[str] = None
    # iter269 — surfaced so the admin UI can show the exact URI that
    # needs to be added to the OAuth Web Client's "Authorized redirect
    # URIs" list in Google Cloud Console. This is the #1 source of
    # `Error 400: redirect_uri_mismatch` during OAuth.
    redirect_uri: Optional[str] = None


@router.get("/admin/integrations/google-ads/status",
            response_model=GoogleAdsStatus)
async def status(_: dict = Depends(current_admin)):
    ready, missing = _config_ok()
    cred = await db.integration_credentials.find_one(
        {"_id": "google_ads"}, {"_id": 0},
    )
    last = await db.integration_sync_log.find_one(
        {"provider": "google_ads"},
        sort=[("started_at", -1)],
        projection={"_id": 0},
    )
    yest = (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%d")
    rows = await db.ad_spend.count_documents({
        "platform": "google",
        "date": yest,
    })
    return GoogleAdsStatus(
        connected=bool(cred and cred.get("refresh_token")),
        config_ready=ready,
        missing_env=missing,
        connected_at=(cred or {}).get("connected_at"),
        last_sync_at=(last or {}).get("finished_at") or (last or {}).get("started_at"),
        last_sync_status=(last or {}).get("status"),
        last_sync_error=(last or {}).get("error"),
        rows_synced_yesterday=rows,
        login_customer_id=(cred or {}).get("login_customer_id"),
        redirect_uri=_redirect_uri() or None,
    )


@router.post("/admin/integrations/google-ads/disconnect")
async def disconnect(_: dict = Depends(current_admin)):
    """Revoke local creds. We don't call Google's revoke endpoint —
    that's the admin's call from their account dashboard if they want to
    fully sever access. Here we just stop using the token."""
    r = await db.integration_credentials.delete_one({"_id": "google_ads"})
    return {"deleted": r.deleted_count}


# ---------------- Sync engine ---------------- #
def _gaql_campaign_metrics(date_str: str) -> str:
    """GAQL — campaign-level metrics for one specific day."""
    return f"""
        SELECT
            campaign.id,
            campaign.name,
            segments.date,
            metrics.cost_micros,
            metrics.clicks,
            metrics.impressions,
            metrics.conversions
        FROM campaign
        WHERE segments.date = '{date_str}'
        ORDER BY campaign.id
    """


def _run_gaql_sync(date_str: str, refresh_token: str,
                   login_customer_id: str,
                   operating_customer_id: str) -> list[dict]:
    """Synchronous metrics fetch — called inside `run_in_executor`.

    `login_customer_id` is the manager (MCC) account the OAuth refresh
    token authenticates through. `operating_customer_id` is the actual
    ad-running account whose campaigns we want metrics for. For
    non-MCC setups, both IDs are the same."""
    # Lazy import so the module loads even when google-ads isn't
    # installed (prevents preview-pod boot failures pre-rollout).
    from google.ads.googleads.client import GoogleAdsClient

    client = GoogleAdsClient.load_from_dict({
        "developer_token": settings.google_ads_developer_token,
        "client_id": settings.google_ads_client_id,
        "client_secret": settings.google_ads_client_secret,
        "refresh_token": refresh_token,
        "login_customer_id": login_customer_id,
        "use_proto_plus": True,
    })
    svc = client.get_service("GoogleAdsService")
    out: list[dict] = []
    stream = svc.search_stream(
        customer_id=operating_customer_id,
        query=_gaql_campaign_metrics(date_str),
    )
    for batch in stream:
        for row in batch.results:
            out.append({
                "campaign_id": str(row.campaign.id),
                "campaign_name": str(row.campaign.name),
                "date": str(row.segments.date),
                "spend_usd": int(row.metrics.cost_micros) / 1_000_000.0,
                "clicks": int(row.metrics.clicks),
                "impressions": int(row.metrics.impressions),
                "conversions": float(row.metrics.conversions),
            })
    return out


async def sync_metrics(date_str: Optional[str] = None) -> dict:
    """Pull yesterday's (or `date_str`) campaign metrics into ad_spend.

    Returns a small status dict that's also written to
    `integration_sync_log` for surface in the connection-status card.
    """
    from routers.ad_spend import upsert_spend

    if date_str is None:
        date_str = (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%d")

    log_id = await db.integration_sync_log.insert_one({
        "provider": "google_ads",
        "date": date_str,
        "status": "running",
        "started_at": now_iso(),
    })

    async def _finish(status: str, *, rows: int = 0, error: str = ""):
        await db.integration_sync_log.update_one(
            {"_id": log_id.inserted_id},
            {"$set": {
                "status": status,
                "rows": rows,
                "error": error,
                "finished_at": now_iso(),
            }},
        )

    cred = await db.integration_credentials.find_one({"_id": "google_ads"})
    if not cred or not cred.get("refresh_token"):
        await _finish("skipped", error="not_connected")
        return {"status": "skipped", "reason": "not_connected", "rows": 0}

    ready, missing = _config_ok()
    if not ready:
        await _finish("skipped", error=f"missing_env:{','.join(missing)}")
        return {"status": "skipped", "reason": "missing_env", "missing": missing}

    login_customer_id = (
        cred.get("login_customer_id")
        or settings.google_ads_login_customer_id
    ).replace("-", "")

    # iter334t — Operating customer ID is the ad-running account whose
    # campaigns we sync. For MCC setups this differs from login_customer_id
    # (which is the manager). Falls back to login_customer_id when only
    # one account is involved (no MCC).
    operating_customer_id = (
        cred.get("operating_customer_id")
        or settings.google_ads_customer_id
        or login_customer_id
    ).replace("-", "")

    try:
        loop = asyncio.get_running_loop()
        rows = await loop.run_in_executor(
            None,
            _run_gaql_sync,
            date_str,
            cred["refresh_token"],
            login_customer_id,
            operating_customer_id,
        )
    except Exception as e:
        logger.exception("[google_ads] sync failed: %s", e)
        await _finish("error", error=str(e)[:500])
        return {"status": "error", "error": str(e)[:500]}

    for r in rows:
        await upsert_spend({
            "platform": "google",
            "campaign_id": r["campaign_id"],
            "campaign_name": r["campaign_name"],
            "date": r["date"],
            "spend_usd": round(r["spend_usd"], 2),
            "impressions": r["impressions"],
            "clicks": r["clicks"],
            "conversions": int(r["conversions"]),
            "category": None,
        })
    await _finish("ok", rows=len(rows))
    logger.info("[google_ads] synced %d campaign rows for %s", len(rows), date_str)
    return {"status": "ok", "rows": len(rows), "date": date_str}


@router.post("/admin/integrations/google-ads/sync")
async def manual_sync(
    date: Optional[str] = Query(default=None),
    _: dict = Depends(current_admin),
):
    """Admin-trigger sync for a specific date (default: yesterday).
    Useful for backfilling after first connection or after a sync error."""
    return await sync_metrics(date_str=date)



@router.post("/admin/integrations/google-ads/backfill")
async def backfill(
    days: int = Query(default=30, ge=1, le=90),
    _: dict = Depends(current_admin),
):
    """iter335.5 — Bulk historical pull for the Google Ads ROAS tile.

    Mirrors the Microsoft Ads backfill pattern: walks yesterday → N
    days back (capped at 90 to bound Google Ads API request cost),
    calls `sync_metrics(date_str)` per day, returns a per-day result
    array so the UI can render progress. Idempotent — already-synced
    rows in `ad_spend` are upserted by (platform, campaign_id, date).
    """
    today = datetime.now(timezone.utc).date()
    results: list[dict] = []
    total_rows = 0
    n_ok = n_skip = n_err = 0

    for i in range(1, days + 1):
        d = (today - timedelta(days=i)).strftime("%Y-%m-%d")
        try:
            r = await sync_metrics(date_str=d)
        except Exception as e:
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
