"""GA4 Live Analytics — admin-only realtime + 7d snapshot endpoints.

iter226 — surfaces Google Analytics 4 data directly inside the admin
dashboard so operators don't need to pop open the GA web UI to see
traffic spikes. Authenticated via a service account JSON key stored at
`/app/backend/secrets/ga4_service_account.json` (read-only on disk,
gitignored).

Endpoints:
  GET /api/admin/ga4/diag           → quick health probe (auth + perms)
  GET /api/admin/ga4/realtime       → activeUsers (last 30 min)
  GET /api/admin/ga4/summary-7d     → totalUsers / sessions / pageViews
  GET /api/admin/ga4/top-pages-7d   → top 10 pagePathPlusQueryString
  GET /api/admin/ga4/top-sources-7d → top 10 sessionSourceMedium

Design notes:
  * The GA4 Python client is synchronous gRPC — every endpoint pushes
    the call through `run_in_threadpool` so the FastAPI event loop
    stays responsive under load.
  * Client construction is lru_cached so we reuse the gRPC channel.
  * Property ID is hardcoded constant; we don't expose it through env
    because changing the property is a deliberate ops event, not a
    config tweak.
  * Errors are translated into friendly admin-facing copy:
      - PermissionDenied with "has not been used in project" → "enable the API"
      - Other PermissionDenied → "service account not added as Viewer"
      - ResourceExhausted → "GA4 quota hit, try again later"
"""
from __future__ import annotations
from config import env_get

import os
from functools import lru_cache
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool

from core import db, logger
from maker_auth import current_admin

router = APIRouter()

GA4_PROPERTY_ID = "535632204"
GA4_PROPERTY_RESOURCE = f"properties/{GA4_PROPERTY_ID}"
GA4_KEY_PATH = Path(env_get(
    "GA4_SERVICE_ACCOUNT_JSON_PATH",
    "/app/backend/secrets/ga4_service_account.json",
))


@lru_cache(maxsize=1)
def _client():
    """Singleton BetaAnalyticsDataClient.

    Auth-mode resolution (highest priority first):
      1. OAuth refresh-token from `db.ga4_oauth` — set via the
         /admin/ga4/oauth-* flow. Bypasses every service-account quirk.
      2. Service account JSON at GA4_KEY_PATH — legacy fallback.

    Cache is invalidated by callers (`_client.cache_clear()`) whenever
    the OAuth token is connected/disconnected so the next call rebuilds.
    """
    from google.analytics.data_v1beta import BetaAnalyticsDataClient

    # Try OAuth user-creds first. We hit Mongo synchronously here because
    # the function is itself cached behind lru_cache — it runs at most
    # once per uvicorn worker until cache_clear() is called.
    try:
        import pymongo
        client_id = (env_get("GSC_OAUTH_CLIENT_ID") or "").strip()
        client_secret = (env_get("GSC_OAUTH_CLIENT_SECRET") or "").strip()
        mongo_url = env_get("MONGO_URL")
        db_name = env_get("DB_NAME")
        if mongo_url and db_name and client_id and client_secret:
            with pymongo.MongoClient(mongo_url, serverSelectionTimeoutMS=2000) as mc:
                doc = mc[db_name].ga4_oauth.find_one({"_id": "singleton"})
            if doc and doc.get("refresh_token"):
                from google.oauth2.credentials import Credentials
                creds = Credentials.from_authorized_user_info({
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "refresh_token": doc["refresh_token"],
                    "scopes": ["https://www.googleapis.com/auth/analytics.readonly"],
                })
                logger.info("[ga4] using OAuth user creds (%s)", doc.get("connected_email") or "anon")
                return BetaAnalyticsDataClient(credentials=creds)
    except Exception as e:
        logger.warning("[ga4] OAuth creds lookup failed, falling back to service account: %s", e)

    # Legacy fallback — service account JSON.
    logger.info("[ga4] using service account JSON at %s", GA4_KEY_PATH)
    return BetaAnalyticsDataClient.from_service_account_json(str(GA4_KEY_PATH))


def _friendly_ga4_error(exc: Exception) -> str:
    """Translate the gory gRPC stack into one line of operator copy.

    The two failure modes that matter:
      1. "API has not been used in project X" — user enabled service
         account but never enabled the GA4 Data API on the GCP project.
         Fix: one-click in console.developers.google.com.
      2. Generic PermissionDenied — service account email isn't a
         Viewer on the GA4 property.
    """
    msg = str(exc)
    # Mode 1: API not enabled on the GCP project
    if "has not been used" in msg or "it is disabled" in msg:
        # Extract the enable URL from the gRPC message — Google embeds it.
        enable_url = "https://console.developers.google.com/apis/api/analyticsdata.googleapis.com/overview"
        import re
        m = re.search(r"https://console\.developers\.google\.com/apis/api/analyticsdata\.googleapis\.com/overview\?project=\d+", msg)
        if m:
            enable_url = m.group(0)
        return (
            f"GA4 Data API isn't enabled on your Google Cloud project yet. "
            f"Click here to enable it (one click, then wait ~30s): {enable_url}"
        )
    # Mode 2: API enabled but service account lacks property access
    if "PERMISSION_DENIED" in msg or "permission" in msg.lower():
        return (
            f"GA4 rejected the service account (PERMISSION_DENIED). Add "
            f"`gsc-inspector@impactful-ring-477013-g0.iam.gserviceaccount.com` as a "
            f"Viewer on property {GA4_PROPERTY_ID} (GA4 → Admin → Property Access Management)."
        )
    # Mode 3: quota
    if "RESOURCE_EXHAUSTED" in msg or "Quota" in msg:
        return "GA4 quota hit for this property. Wait 1 hour and retry, or upgrade to GA360."
    # Mode 4: bad property ID
    if "INVALID_ARGUMENT" in msg and "properties/" in msg:
        return f"GA4 property `{GA4_PROPERTY_ID}` is invalid or you don't own it."
    # Catch-all — clip the stack
    return f"GA4 error: {type(exc).__name__}: {msg[:300]}"


# ═══════════════════════════════════════════════════════════════════════
# Diag — admin can verify GA4 connectivity in one click before staring at
# the empty Realtime card and assuming the widget is broken.
# ═══════════════════════════════════════════════════════════════════════
@router.get("/admin/ga4/diag")
async def ga4_diag(_: dict = Depends(current_admin)):
    """One-shot health probe: confirms auth works + property is accessible."""
    # Detect which auth mode is in play.
    oauth_doc = await db.ga4_oauth.find_one({"_id": "singleton"}, {"_id": 0, "refresh_token": 0})
    sa_present = GA4_KEY_PATH.exists()
    active_mode = "oauth" if oauth_doc else ("service_account" if sa_present else "none")

    if active_mode == "none":
        return {
            "ok": False,
            "property_id": GA4_PROPERTY_ID,
            "active_mode": "none",
            "reason": "No GA4 credentials configured. Connect with your Google "
                      "account from the admin GA4 panel (recommended), or place "
                      f"a service account JSON at {GA4_KEY_PATH}.",
        }

    # Cheapest possible probe — runReport with one metric, no dimensions.
    try:
        from google.analytics.data_v1beta.types import (
            RunReportRequest, DateRange, Metric,
        )
        req = RunReportRequest(
            property=GA4_PROPERTY_RESOURCE,
            metrics=[Metric(name="activeUsers")],
            date_ranges=[DateRange(start_date="1daysAgo", end_date="today")],
        )
        resp = await run_in_threadpool(_client().run_report, req)
        sample = int(resp.rows[0].metric_values[0].value) if resp.rows else 0
        out = {
            "ok": True,
            "property_id": GA4_PROPERTY_ID,
            "active_mode": active_mode,
            "sample_active_users_24h": sample,
        }
        if active_mode == "oauth":
            out["connected_email"] = oauth_doc.get("connected_email")
        else:
            try:
                import json
                with open(GA4_KEY_PATH) as f:
                    sa = json.load(f)
                out["client_email"] = sa.get("client_email", "—")
                out["project_id"] = sa.get("project_id", "—")
            except Exception:
                pass
        return out
    except Exception as e:
        out = {
            "ok": False,
            "property_id": GA4_PROPERTY_ID,
            "active_mode": active_mode,
            "reason": _friendly_ga4_error(e),
        }
        if active_mode == "oauth":
            out["connected_email"] = oauth_doc.get("connected_email")
        return out


# ═══════════════════════════════════════════════════════════════════════
# Realtime — active users right now (last 30 min window)
# ═══════════════════════════════════════════════════════════════════════
@router.get("/admin/ga4/realtime")
async def ga4_realtime(_: dict = Depends(current_admin)):
    try:
        from google.analytics.data_v1beta.types import (
            RunRealtimeReportRequest, Metric,
        )
        req = RunRealtimeReportRequest(
            property=GA4_PROPERTY_RESOURCE,
            metrics=[Metric(name="activeUsers")],
        )
        resp = await run_in_threadpool(_client().run_realtime_report, req)
        active = 0
        if resp.totals:
            active = int(resp.totals[0].metric_values[0].value)
        elif resp.rows:
            active = sum(int(r.metric_values[0].value) for r in resp.rows)
        return {"active_users": active}
    except Exception as e:
        raise HTTPException(502, _friendly_ga4_error(e))


# ═══════════════════════════════════════════════════════════════════════
# 7-day summary — users / sessions / page-views aggregate
# ═══════════════════════════════════════════════════════════════════════
@router.get("/admin/ga4/summary-7d")
async def ga4_summary_7d(_: dict = Depends(current_admin)):
    try:
        from google.analytics.data_v1beta.types import (
            RunReportRequest, DateRange, Metric,
        )
        req = RunReportRequest(
            property=GA4_PROPERTY_RESOURCE,
            metrics=[
                Metric(name="totalUsers"),
                Metric(name="sessions"),
                Metric(name="screenPageViews"),
            ],
            date_ranges=[DateRange(start_date="7daysAgo", end_date="today")],
        )
        resp = await run_in_threadpool(_client().run_report, req)
        if not resp.rows:
            return {"total_users": 0, "sessions": 0, "page_views": 0}
        row = resp.rows[0]
        return {
            "total_users": int(row.metric_values[0].value),
            "sessions": int(row.metric_values[1].value),
            "page_views": int(row.metric_values[2].value),
        }
    except Exception as e:
        raise HTTPException(502, _friendly_ga4_error(e))


# ═══════════════════════════════════════════════════════════════════════
# Top pages (7d) — pagePathPlusQueryString × screenPageViews
# ═══════════════════════════════════════════════════════════════════════
@router.get("/admin/ga4/top-pages-7d")
async def ga4_top_pages_7d(limit: int = 10, _: dict = Depends(current_admin)):
    try:
        from google.analytics.data_v1beta.types import (
            RunReportRequest, DateRange, Dimension, Metric, OrderBy,
        )
        req = RunReportRequest(
            property=GA4_PROPERTY_RESOURCE,
            dimensions=[Dimension(name="pagePathPlusQueryString")],
            metrics=[Metric(name="screenPageViews")],
            date_ranges=[DateRange(start_date="7daysAgo", end_date="today")],
            order_bys=[OrderBy(
                metric=OrderBy.MetricOrderBy(metric_name="screenPageViews"),
                desc=True,
            )],
            limit=max(1, min(limit, 50)),
        )
        resp = await run_in_threadpool(_client().run_report, req)
        pages = [
            {
                "page_path": r.dimension_values[0].value,
                "page_views": int(r.metric_values[0].value),
            }
            for r in resp.rows
        ]
        return {"pages": pages}
    except Exception as e:
        raise HTTPException(502, _friendly_ga4_error(e))


# ═══════════════════════════════════════════════════════════════════════
# Top sources (7d) — sessionSourceMedium × sessions
# ═══════════════════════════════════════════════════════════════════════
@router.get("/admin/ga4/top-sources-7d")
async def ga4_top_sources_7d(limit: int = 10, _: dict = Depends(current_admin)):
    try:
        from google.analytics.data_v1beta.types import (
            RunReportRequest, DateRange, Dimension, Metric, OrderBy,
        )
        req = RunReportRequest(
            property=GA4_PROPERTY_RESOURCE,
            dimensions=[Dimension(name="sessionSourceMedium")],
            metrics=[Metric(name="sessions")],
            date_ranges=[DateRange(start_date="7daysAgo", end_date="today")],
            order_bys=[OrderBy(
                metric=OrderBy.MetricOrderBy(metric_name="sessions"),
                desc=True,
            )],
            limit=max(1, min(limit, 50)),
        )
        resp = await run_in_threadpool(_client().run_report, req)
        sources = [
            {
                "source_medium": r.dimension_values[0].value,
                "sessions": int(r.metric_values[0].value),
            }
            for r in resp.rows
        ]
        return {"sources": sources}
    except Exception as e:
        raise HTTPException(502, _friendly_ga4_error(e))
