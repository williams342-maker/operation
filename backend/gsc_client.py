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

GSC_SCOPES = ["https://www.googleapis.com/auth/webmasters.readonly"]


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
