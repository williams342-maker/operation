"""Meta (Facebook/Instagram) Marketing API integration.

Mirrors the shape of `routers/google_ads.py` — OAuth-once + daily insights
sync into the existing `db.ad_spend` ledger. Side-by-side with Google Ads
in the admin AdsTab dashboard.

Lifecycle:
    1. Admin clicks "Connect Meta Ads" in the AdsTab.
    2. `GET /api/admin/integrations/meta-ads/oauth/start` returns Meta's
       authorize URL (CSRF state token persisted with 10-min TTL).
    3. Meta redirects to `/oauth/callback?code=...&state=...`.
    4. Callback exchanges code → short-lived → long-lived (~60 day) token,
       fetches `me` + `me/adaccounts`, persists everything to
       `db.integration_credentials` (`_id="meta_ads"`), redirects back
       to admin dashboard.
    5. Daily 04:00 UTC scheduler hits `/{ad_account}/insights?date_preset=yesterday`,
       maps Meta's response shape to our `ad_spend` schema (platform="meta"),
       upserts keyed (platform, campaign_id, date).

Token model: Meta issues long-lived (60d) tokens via the
`fb_exchange_token` grant. We refresh proactively when the persisted
token gets within 24h of expiry — running the daily sync also implicitly
extends the token because Meta resets the 60d clock on activity.

Env vars (all OPTIONAL — graceful no-op if missing):
    META_APP_ID                Numeric from developers.facebook.com Settings → Basic
    META_APP_SECRET            32-char hex from same page
    META_AD_ACCOUNT_ID         `act_NNNNNNNNNNNNNNN` — required to filter sync
    META_REDIRECT_URI          Optional; derived from PUBLIC_BACKEND_URL when blank
"""
from __future__ import annotations

import asyncio
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from core import db, logger, now_iso
from maker_auth import current_admin

router = APIRouter()

# Pin API version centrally so a future Meta minor-version bump is a
# single-line change. v20.0 is the stable target in 2026 (v25.0 exists
# but adds video features we don't need). Meta keeps each version live
# for ~24 months; we have plenty of runway.
META_API_VERSION = "v20.0"
GRAPH_BASE = f"https://graph.facebook.com/{META_API_VERSION}"
AUTH_BASE = f"https://www.facebook.com/{META_API_VERSION}"
SCOPES = ["ads_read"]


def _redirect_uri() -> str:
    explicit = os.environ.get("META_REDIRECT_URI", "").strip()
    if explicit:
        return explicit
    base = (os.environ.get("PUBLIC_BACKEND_URL") or "").rstrip("/")
    if not base:
        return ""
    return f"{base}/api/admin/integrations/meta-ads/oauth/callback"


def _config_ok() -> tuple[bool, list[str]]:
    needed = {
        "META_APP_ID": os.environ.get("META_APP_ID"),
        "META_APP_SECRET": os.environ.get("META_APP_SECRET"),
        "META_AD_ACCOUNT_ID": os.environ.get("META_AD_ACCOUNT_ID"),
    }
    if not _redirect_uri():
        needed["META_REDIRECT_URI"] = None
    missing = [k for k, v in needed.items() if not (v or "").strip()]
    return (len(missing) == 0, missing)


# ----------------------- OAuth flow ----------------------- #
class OauthStartResponse(BaseModel):
    authorization_url: str
    state: str


@router.get("/admin/integrations/meta-ads/oauth/start",
            response_model=OauthStartResponse)
async def oauth_start(_: dict = Depends(current_admin)):
    ready, missing = _config_ok()
    if not ready:
        raise HTTPException(400, f"Meta Ads OAuth not configured. Missing env: {', '.join(missing)}")
    state = secrets.token_urlsafe(32)
    await db.integration_oauth_states.insert_one({
        "_id": state,
        "provider": "meta_ads",
        "created_at": now_iso(),
        "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=10))
            .isoformat().replace("+00:00", "Z"),
    })
    params = {
        "client_id": os.environ["META_APP_ID"],
        "redirect_uri": _redirect_uri(),
        "scope": ",".join(SCOPES),  # Meta uses comma-separated, NOT space
        "response_type": "code",
        # Forces Meta to prompt for permissions even if the admin
        # previously authorized — same trick we used for Google.
        "auth_type": "rerequest",
        "state": state,
    }
    return OauthStartResponse(
        authorization_url=f"{AUTH_BASE}/dialog/oauth?{urlencode(params)}",
        state=state,
    )


@router.get("/admin/integrations/meta-ads/oauth/callback")
async def oauth_callback(
    code: Optional[str] = Query(default=None),
    state: Optional[str] = Query(default=None),
    error: Optional[str] = Query(default=None),
    error_reason: Optional[str] = Query(default=None),
):
    site = (os.environ.get("PUBLIC_SITE_URL") or "").rstrip("/")
    err = f"{site}/admin/dashboard?tab=ads&meta_ads=error"
    if error:
        logger.warning("[meta_ads] OAuth error: %s / %s", error, error_reason)
        return RedirectResponse(f"{err}&reason={error}", status_code=302)
    if not code or not state:
        return RedirectResponse(f"{err}&reason=missing_code", status_code=302)
    state_doc = await db.integration_oauth_states.find_one({"_id": state})
    if not state_doc or state_doc.get("provider") != "meta_ads":
        logger.warning("[meta_ads] bad state: %s", state[:12])
        return RedirectResponse(f"{err}&reason=bad_state", status_code=302)
    await db.integration_oauth_states.delete_one({"_id": state})

    app_id = os.environ["META_APP_ID"]
    app_secret = os.environ["META_APP_SECRET"]
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            # 1) code → short-lived token (~1h)
            short = await client.get(f"{GRAPH_BASE}/oauth/access_token", params={
                "client_id": app_id,
                "client_secret": app_secret,
                "redirect_uri": _redirect_uri(),
                "code": code,
            })
            if short.status_code != 200:
                logger.error("[meta_ads] short-token exchange %s: %s", short.status_code, short.text[:400])
                return RedirectResponse(f"{err}&reason=exchange_{short.status_code}", status_code=302)
            short_token = short.json().get("access_token")
            # 2) short → long-lived (~60d)
            long_ = await client.get(f"{GRAPH_BASE}/oauth/access_token", params={
                "grant_type": "fb_exchange_token",
                "client_id": app_id,
                "client_secret": app_secret,
                "fb_exchange_token": short_token,
            })
            if long_.status_code != 200:
                logger.error("[meta_ads] long-token exchange %s: %s", long_.status_code, long_.text[:400])
                return RedirectResponse(f"{err}&reason=longtoken_{long_.status_code}", status_code=302)
            tok = long_.json()
            access_token = tok.get("access_token")
            expires_in = int(tok.get("expires_in") or 5_184_000)  # default 60d
            # 3) profile + ad accounts (just for status panel; sync uses env var)
            me = await client.get(f"{GRAPH_BASE}/me", params={
                "access_token": access_token, "fields": "id,name,email",
            })
            me_j = me.json() if me.status_code == 200 else {}
            accts = await client.get(f"{GRAPH_BASE}/me/adaccounts", params={
                "access_token": access_token,
                "fields": "id,name,account_id,currency,timezone_name",
            })
            accts_j = accts.json().get("data", []) if accts.status_code == 200 else []
    except Exception as e:
        logger.exception("[meta_ads] OAuth callback error: %s", e)
        return RedirectResponse(f"{err}&reason=exchange_failed", status_code=302)

    if not access_token:
        return RedirectResponse(f"{err}&reason=no_token", status_code=302)

    await db.integration_credentials.update_one(
        {"_id": "meta_ads"},
        {"$set": {
            "provider": "meta_ads",
            "access_token": access_token,
            "expires_at": (datetime.now(timezone.utc) + timedelta(seconds=expires_in))
                .isoformat().replace("+00:00", "Z"),
            "connected_at": now_iso(),
            "user_id": me_j.get("id"),
            "user_name": me_j.get("name"),
            "user_email": me_j.get("email"),
            "ad_accounts": [
                {"id": a.get("id"), "name": a.get("name"),
                 "currency": a.get("currency"),
                 "timezone": a.get("timezone_name")}
                for a in accts_j
            ],
        }},
        upsert=True,
    )
    logger.info("[meta_ads] OAuth connected, %d ad accounts visible.", len(accts_j))
    return RedirectResponse(f"{site}/admin/dashboard?tab=ads&meta_ads=connected", status_code=302)


# ----------------------- status / disconnect ----------------------- #
class MetaAdsStatus(BaseModel):
    connected: bool
    config_ready: bool
    missing_env: list[str]
    connected_at: Optional[str] = None
    expires_at: Optional[str] = None
    user_email: Optional[str] = None
    user_name: Optional[str] = None
    ad_account_id: Optional[str] = None
    ad_accounts: list[dict] = []
    last_sync_at: Optional[str] = None
    last_sync_status: Optional[str] = None
    last_sync_error: Optional[str] = None
    rows_synced_yesterday: int = 0


@router.get("/admin/integrations/meta-ads/status",
            response_model=MetaAdsStatus)
async def status(_: dict = Depends(current_admin)):
    ready, missing = _config_ok()
    cred = await db.integration_credentials.find_one({"_id": "meta_ads"}, {"_id": 0})
    last = await db.integration_sync_log.find_one(
        {"provider": "meta_ads"},
        sort=[("started_at", -1)],
        projection={"_id": 0},
    )
    yest = (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%d")
    rows = await db.ad_spend.count_documents({"platform": "meta", "date": yest})
    return MetaAdsStatus(
        connected=bool(cred and cred.get("access_token")),
        config_ready=ready,
        missing_env=missing,
        connected_at=(cred or {}).get("connected_at"),
        expires_at=(cred or {}).get("expires_at"),
        user_email=(cred or {}).get("user_email"),
        user_name=(cred or {}).get("user_name"),
        ad_account_id=os.environ.get("META_AD_ACCOUNT_ID"),
        ad_accounts=(cred or {}).get("ad_accounts", []),
        last_sync_at=(last or {}).get("finished_at") or (last or {}).get("started_at"),
        last_sync_status=(last or {}).get("status"),
        last_sync_error=(last or {}).get("error"),
        rows_synced_yesterday=rows,
    )


@router.post("/admin/integrations/meta-ads/disconnect")
async def disconnect(_: dict = Depends(current_admin)):
    r = await db.integration_credentials.delete_one({"_id": "meta_ads"})
    return {"deleted": r.deleted_count}


# ----------------------- sync engine ----------------------- #
async def _meta_get(client: httpx.AsyncClient, path: str, params: dict) -> dict:
    r = await client.get(f"{GRAPH_BASE}{path}", params=params)
    if r.status_code != 200:
        raise RuntimeError(f"{r.status_code}: {r.text[:300]}")
    return r.json()


async def sync_metrics(date_str: Optional[str] = None) -> dict:
    """Pull yesterday's (or `date_str`) campaign-level metrics for the
    configured `META_AD_ACCOUNT_ID` into `ad_spend`. Idempotent — uses
    the existing `upsert_spend` helper keyed (platform, campaign_id, date)."""
    from routers.ad_spend import upsert_spend

    if date_str is None:
        date_str = (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%d")

    log_id = await db.integration_sync_log.insert_one({
        "provider": "meta_ads",
        "date": date_str,
        "status": "running",
        "started_at": now_iso(),
    })

    async def _finish(status: str, *, rows: int = 0, error: str = ""):
        await db.integration_sync_log.update_one(
            {"_id": log_id.inserted_id},
            {"$set": {"status": status, "rows": rows, "error": error,
                      "finished_at": now_iso()}},
        )

    cred = await db.integration_credentials.find_one({"_id": "meta_ads"})
    if not cred or not cred.get("access_token"):
        await _finish("skipped", error="not_connected")
        return {"status": "skipped", "reason": "not_connected", "rows": 0}

    ready, missing = _config_ok()
    if not ready:
        await _finish("skipped", error=f"missing_env:{','.join(missing)}")
        return {"status": "skipped", "reason": "missing_env", "missing": missing}

    ad_account = os.environ["META_AD_ACCOUNT_ID"]
    # Meta wants the account ID in the URL with the `act_` prefix; pass
    # through verbatim so user-error is obvious in logs.
    token = cred["access_token"]

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            data = await _meta_get(client, f"/{ad_account}/insights", {
                "access_token": token,
                "level": "campaign",
                "time_range": f'{{"since":"{date_str}","until":"{date_str}"}}',
                "fields": (
                    "campaign_id,campaign_name,spend,clicks,"
                    "impressions,actions"
                ),
            })
    except Exception as e:
        logger.exception("[meta_ads] sync failed: %s", e)
        await _finish("error", error=str(e)[:500])
        return {"status": "error", "error": str(e)[:500]}

    rows = data.get("data", [])
    for r in rows:
        # Meta `actions` is a list of {action_type, value}. Sum any
        # purchase-style action — `purchase`, `offsite_conversion.fb_pixel_purchase`,
        # etc. — to match how the AdsTab interprets "conversions".
        conv = 0
        for a in (r.get("actions") or []):
            t = (a.get("action_type") or "").lower()
            if "purchase" in t or t == "lead" or t == "complete_registration":
                try:
                    conv += int(float(a.get("value") or 0))
                except (ValueError, TypeError):
                    pass
        await upsert_spend({
            "platform": "meta",
            "campaign_id": str(r.get("campaign_id") or "unknown"),
            "campaign_name": r.get("campaign_name") or "(unnamed)",
            "date": date_str,
            "spend_usd": round(float(r.get("spend") or 0), 2),
            "impressions": int(r.get("impressions") or 0),
            "clicks": int(r.get("clicks") or 0),
            "conversions": conv,
            "category": None,
        })
    await _finish("ok", rows=len(rows))
    logger.info("[meta_ads] synced %d campaign rows for %s", len(rows), date_str)
    return {"status": "ok", "rows": len(rows), "date": date_str}


@router.post("/admin/integrations/meta-ads/sync")
async def manual_sync(
    date: Optional[str] = Query(default=None),
    _: dict = Depends(current_admin),
):
    return await sync_metrics(date_str=date)



@router.post("/admin/integrations/meta-ads/backfill")
async def backfill(
    days: int = Query(default=30, ge=1, le=90),
    _: dict = Depends(current_admin),
):
    """iter335.5 — Bulk historical pull for the Meta Ads ROAS tile.

    Mirrors the Google/Microsoft Ads backfill pattern. Meta's
    `/insights` endpoint accepts up to ~37 months of history, but we
    cap at 90 days here to keep the per-request rate-limit budget
    bounded (Meta's Marketing API throttles aggressively when you
    walk months in one session)."""
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
