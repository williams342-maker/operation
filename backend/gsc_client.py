"""Google Search Console URL-Inspection client.

This module wraps Google's URL Inspection API behind a thin, opt-in
helper. When the required service-account credentials are not present
in the environment, every public call short-circuits to None so the
rest of the app keeps working with the sitemap-membership heuristic.

Required env vars (set ALL three to enable):
  • GSC_SERVICE_ACCOUNT_JSON   — full JSON key, single line, no quotes
  • GSC_SITE_URL               — e.g. "https://craftersmarket.org/"
                                  (must match the verified GSC property)
  • GSC_ENABLED                — must be "1" to opt in

Operational notes:
  • Quota = 2 000 URL inspections per site per day. The daily scheduler
    job batches up to 1 500/day, prioritising listings whose
    `gsc_checked_at` is missing or stale (>=7 days).
  • The service-account email must be added to the GSC property as a
    "Full" user before calls will succeed. See README.md.
"""
from __future__ import annotations
import json
import logging
import os
from typing import Optional

logger = logging.getLogger("crafters.gsc")

GSC_SCOPES = ["https://www.googleapis.com/auth/webmasters.readonly"]


def is_gsc_enabled() -> bool:
    """Return True iff all three env vars are present and GSC_ENABLED=1."""
    return (
        (os.environ.get("GSC_ENABLED") or "").strip() == "1"
        and bool((os.environ.get("GSC_SERVICE_ACCOUNT_JSON") or "").strip())
        and bool((os.environ.get("GSC_SITE_URL") or "").strip())
    )


_service = None


def _client():
    """Build (and cache) the Search Console discovery client. Returns None
    when GSC isn't configured so callers can no-op gracefully."""
    global _service
    if _service is not None:
        return _service
    if not is_gsc_enabled():
        return None
    try:
        from google.oauth2 import service_account
        from googleapiclient.discovery import build

        raw = os.environ.get("GSC_SERVICE_ACCOUNT_JSON") or ""
        info = json.loads(raw)
        creds = service_account.Credentials.from_service_account_info(
            info, scopes=GSC_SCOPES,
        )
        _service = build("searchconsole", "v1", credentials=creds, cache_discovery=False)
        logger.info("[gsc] client built (sa=%s)", info.get("client_email", "?"))
        return _service
    except Exception as e:
        logger.exception("[gsc] failed to build client: %s", e)
        return None


def inspect_url(inspection_url: str) -> Optional[dict]:
    """Inspect a single URL via GSC URL Inspection API. Returns the raw
    `inspectionResult` dict on success, None when GSC isn't configured
    or the call failed. Errors are logged + swallowed — never raised."""
    svc = _client()
    if not svc:
        return None
    site_url = os.environ.get("GSC_SITE_URL")
    try:
        body = {
            "inspectionUrl": inspection_url,
            "siteUrl": site_url,
            "languageCode": "en-US",
        }
        resp = svc.urlInspection().index().inspect(body=body).execute()
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
