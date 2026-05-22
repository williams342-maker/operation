"""Google Search Console URL-Inspection client.

Two auth paths are supported (tried in order):

  1. **OAuth refresh-token** stored in `db.gsc_oauth` (set up via the
     admin "Connect GSC" button). This is the easier path — admin
     signs in with a Google account that already has GSC access for
     the property. No service-account email to add to GSC at all.

  2. **Service account** (`GSC_SERVICE_ACCOUNT_JSON` env). Falls back
     here if no OAuth token is stored. Requires the SA email to be
     added to the GSC property as a Full user.

When neither path is configured, `is_gsc_enabled()` returns False and
every public call short-circuits to None so the app keeps working
with the sitemap-membership heuristic.

Required env vars depending on which path you choose:

  OAuth path:
    • GSC_ENABLED                  = "1"
    • GSC_SITE_URL                 = "https://craftersmarket.org/"
    • GSC_OAUTH_CLIENT_ID          = OAuth 2.0 client ID
    • GSC_OAUTH_CLIENT_SECRET      = OAuth 2.0 client secret
    • GSC_OAUTH_REDIRECT_URI       = "https://<your-host>/api/admin/gsc/oauth-callback"

  Service-account path:
    • GSC_ENABLED                  = "1"
    • GSC_SITE_URL                 = "https://craftersmarket.org/"
    • GSC_SERVICE_ACCOUNT_JSON     = full JSON key, single line

Operational notes:
  • Quota = 2 000 URL inspections per site per day. The daily scheduler
    job batches up to 1 500/day, prioritising listings whose
    `gsc_checked_at` is missing or stale (>=7 days).
"""
from __future__ import annotations
import json
import logging
import os
from typing import Optional

logger = logging.getLogger("crafters.gsc")

GSC_SCOPES = ["https://www.googleapis.com/auth/webmasters"]


def is_gsc_enabled() -> bool:
    """True iff `GSC_ENABLED=1` + `GSC_SITE_URL` is set + at least one
    auth path (OAuth refresh-token in DB OR service-account JSON env)
    is configured. Sync helper — does NOT check DB; use
    `is_gsc_runtime_ready()` for that."""
    if (os.environ.get("GSC_ENABLED") or "").strip() != "1":
        return False
    if not (os.environ.get("GSC_SITE_URL") or "").strip():
        return False
    if (os.environ.get("GSC_SERVICE_ACCOUNT_JSON") or "").strip():
        return True
    # OAuth path requires client_id+secret env vars; the refresh-token
    # itself is checked at client-build time against the DB.
    if (
        (os.environ.get("GSC_OAUTH_CLIENT_ID") or "").strip()
        and (os.environ.get("GSC_OAUTH_CLIENT_SECRET") or "").strip()
    ):
        return True
    return False


_service = None


async def _load_oauth_creds():
    """Return google.oauth2.credentials.Credentials built from the OAuth
    refresh-token stored in MongoDB, or None if no token has been saved."""
    try:
        from core import db
        doc = await db.gsc_oauth.find_one({"_id": "singleton"}, {"_id": 0})
        if not doc or not doc.get("refresh_token"):
            return None
        from google.oauth2.credentials import Credentials
        return Credentials(
            token=None,
            refresh_token=doc["refresh_token"],
            token_uri="https://oauth2.googleapis.com/token",
            client_id=os.environ.get("GSC_OAUTH_CLIENT_ID"),
            client_secret=os.environ.get("GSC_OAUTH_CLIENT_SECRET"),
            scopes=GSC_SCOPES,
        )
    except Exception as e:
        logger.warning("[gsc] OAuth creds load failed: %s", e)
        return None


def _load_service_account_creds():
    raw = (os.environ.get("GSC_SERVICE_ACCOUNT_JSON") or "").strip()
    if not raw:
        return None
    try:
        from google.oauth2 import service_account
        info = json.loads(raw)
        return service_account.Credentials.from_service_account_info(
            info, scopes=GSC_SCOPES,
        )
    except Exception as e:
        logger.exception("[gsc] service-account creds load failed: %s", e)
        return None


async def _client():
    """Build the Search Console discovery client. Prefers OAuth refresh-
    token (admin UI flow) over service-account JSON (env-only flow)."""
    global _service
    if _service is not None:
        return _service
    if (os.environ.get("GSC_ENABLED") or "").strip() != "1":
        return None
    try:
        from googleapiclient.discovery import build
        creds = await _load_oauth_creds()
        source = "oauth"
        if not creds:
            creds = _load_service_account_creds()
            source = "service-account"
        if not creds:
            return None
        _service = build("searchconsole", "v1", credentials=creds, cache_discovery=False)
        logger.info("[gsc] client built (source=%s)", source)
        return _service
    except Exception as e:
        logger.exception("[gsc] failed to build client: %s", e)
        return None


def _reset_client_cache():
    """Call after connect/disconnect so the next request rebuilds."""
    global _service
    _service = None


async def inspect_url(inspection_url: str) -> Optional[dict]:
    """Inspect a single URL via GSC URL Inspection API. Returns the raw
    `inspectionResult` dict on success, None when GSC isn't configured
    or the call failed. Errors are logged + swallowed — never raised."""
    svc = await _client()
    if not svc:
        return None
    site_url = os.environ.get("GSC_SITE_URL")
    try:
        body = {
            "inspectionUrl": inspection_url,
            "siteUrl": site_url,
            "languageCode": "en-US",
        }
        # The Google client's .execute() is sync; run in a thread to avoid
        # blocking the asyncio event loop during the daily sweep.
        import asyncio as _aio
        loop = _aio.get_running_loop()
        resp = await loop.run_in_executor(
            None,
            lambda: svc.urlInspection().index().inspect(body=body).execute(),
        )
        return resp.get("inspectionResult") or None
    except Exception as e:
        logger.warning("[gsc] inspect_url(%s) failed: %s", inspection_url, e)
        return None


def map_to_tier(inspection_result: dict) -> str:
    """Distil a raw GSC `inspectionResult` into our existing 3-tier badge
    schema. Verdict + coverage_state are the load-bearing fields.

      • verdict=PASS AND coverage mentions "indexed" → "established"
      • verdict=FAIL OR coverage indicates non-indexability → "not_in_sitemap"
        (semantic match for our existing tier — listing is effectively
        invisible to search)
      • Anything else (PARTIAL, NEUTRAL, transitional) → "submitted"
    """
    idx = (inspection_result or {}).get("indexStatusResult") or {}
    verdict = (idx.get("verdict") or "").upper()
    coverage = (idx.get("coverageState") or "").lower()
    if verdict == "PASS" and "indexed" in coverage:
        return "established"
    if verdict == "FAIL" or "blocked" in coverage or "noindex" in coverage:
        return "not_in_sitemap"
    return "submitted"



# ============================================================================
# Sitemap submission — Google's officially-supported "re-crawl me" hook.
# Throttled per-sitemap to stay polite (Google rate-limits anyway).
# ============================================================================

SITEMAP_SUBMIT_THROTTLE_MIN = 60  # don't re-submit more than once per hour


async def submit_sitemap(sitemap_url: str | None = None) -> dict:
    """Submit `sitemap_url` (default: `<GSC_SITE_URL>sitemap.xml`) to Google
    Search Console. Returns `{ok, status, throttled, error, sitemap}`.

    Best-effort + throttled — never raises. The Search Console API accepts
    the submission and Google schedules a sitemap re-fetch (usually within
    a few hours). Actual crawling of newly-discovered URLs follows on
    Google's normal schedule.

    Requires the OAuth refresh-token (or service account) to have the
    `webmasters` write scope. If only `webmasters.readonly` was granted
    (pre-iter180 connections), the API returns 403 and we surface a clear
    reconnect message.
    """
    from datetime import datetime, timedelta, timezone

    from core import db, now_iso

    site_url = (os.environ.get("GSC_SITE_URL") or "").strip()
    if not site_url:
        return {"ok": False, "throttled": False, "sitemap": "",
                "error": "GSC_SITE_URL not configured"}
    target = sitemap_url or f"{site_url.rstrip('/')}/sitemap.xml"

    # Short-circuit before touching Mongo: if there's no GSC client (not
    # connected yet or scope-revoked), there's nothing to ping.
    svc = await _client()
    if not svc:
        return {"ok": False, "throttled": False, "sitemap": target,
                "error": "GSC client unavailable (not connected)"}

    # Throttle: skip if we successfully submitted the same sitemap recently.
    cutoff_iso = (datetime.now(timezone.utc)
                  - timedelta(minutes=SITEMAP_SUBMIT_THROTTLE_MIN)).isoformat()
    recent = await db.gsc_sitemap_log.find_one(
        {"sitemap": target, "ts": {"$gte": cutoff_iso}, "ok": True},
        {"_id": 0, "ts": 1},
    )
    if recent:
        return {"ok": True, "throttled": True, "sitemap": target,
                "last_submit_at": recent["ts"]}

    error = ""
    status = 0
    try:
        import asyncio as _aio
        loop = _aio.get_running_loop()
        # Search Console API: sitemaps.submit(siteUrl=..., feedpath=...).
        # Returns empty body on success (HTTP 200).
        await loop.run_in_executor(
            None,
            lambda: svc.sitemaps().submit(siteUrl=site_url, feedpath=target).execute(),
        )
        status = 200
    except Exception as e:
        error = f"{type(e).__name__}: {e}"
        try:
            from googleapiclient.errors import HttpError
            if isinstance(e, HttpError):
                status = int(e.resp.status)  # type: ignore[attr-defined]
                if status in (401, 403):
                    error = (f"{error} — likely insufficient scope "
                             "(needs `webmasters` write, not readonly). "
                             "Disconnect + reconnect GSC in admin.")
        except Exception:
            pass
        logger.warning("[gsc] sitemap submit failed (%s): %s", target, e)

    ok = 200 <= status < 300
    await db.gsc_sitemap_log.insert_one({
        "sitemap": target,
        "ts": now_iso(),
        "status": status,
        "ok": ok,
        "error": error or None,
    })
    return {
        "ok": ok,
        "throttled": False,
        "sitemap": target,
        "status": status,
        "error": error or None,
    }


async def sitemap_status() -> dict:
    """Latest sitemap-submit audit row for the admin dashboard."""
    from core import db
    doc = await db.gsc_sitemap_log.find_one(
        {}, {"_id": 0}, sort=[("ts", -1)],
    )
    return doc or {}
