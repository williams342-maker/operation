"""iter334w — Microsoft Ads SDK wrapper.

Isolates the heavy `bingads` SOAP SDK from the route file so unit tests
can monkey-patch `discover_accounts` / `sync_metrics` without ever
importing suds. The actual sync runs in a thread executor because the
SDK is synchronous.

Three public functions:
    * `discover_accounts(access_token)` — post-OAuth, returns the list
      of (customer_id, account_id, name) the user can see. Backs the
      auto-discovery on the callback.
    * `sync_metrics(date_str=None)` — pulls a single day's
      account-level metrics into `ad_spend` (platform="microsoft").
      Called both by the manual-sync admin button and the daily cron.
    * `_authorization_data(...)` — internal helper that primes a fresh
      `AuthorizationData` from the persisted refresh_token.
"""
from __future__ import annotations
import asyncio
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

from core import db, now_iso

logger = logging.getLogger("crafters.bing_ads.sdk")

ENVIRONMENT = "production"  # vs "sandbox" — we never use sandbox.


def _api_environment() -> str:
    return os.environ.get("BING_ENVIRONMENT", ENVIRONMENT).lower()


async def discover_accounts(access_token: str) -> list[dict]:
    """List accounts the OAuth user can manage.

    Run the SOAP call inside `run_in_executor` so we don't block the
    asyncio loop. Returns a list of dicts with `customer_id`,
    `account_id`, `name`."""
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _discover_accounts_sync, access_token)


def _discover_accounts_sync(access_token: str) -> list[dict]:
    """SOAP-flavored — runs in a thread."""
    from bingads.authorization import (
        AuthorizationData, OAuthWebAuthCodeGrant, OAuthTokens,
    )
    from bingads.v13.customer_management import CustomerManagementService

    if not access_token:
        return []

    # Synthesize OAuth tokens object from the access_token we just got.
    # We don't have refresh-flow yet on this code path so this is a
    # short-lived call before the access_token expires.
    grant = OAuthWebAuthCodeGrant(
        client_id=os.environ["BING_CLIENT_ID"],
        client_secret=os.environ["BING_CLIENT_SECRET"],
        redirection_uri="https://login.microsoftonline.com/common/oauth2/nativeclient",
        env=_api_environment(),
    )
    grant.oauth_tokens = OAuthTokens(
        access_token=access_token,
        access_token_expires_in_seconds=3600,
        refresh_token="",  # not needed for one-shot probe
    )

    auth = AuthorizationData(
        account_id=None, customer_id=None,
        developer_token=os.environ["BING_DEVELOPER_TOKEN"],
        authentication=grant,
    )
    svc = CustomerManagementService(
        authorization_data=auth, environment=_api_environment(), version=13,
    )
    out: list[dict] = []
    try:
        # GetAccountsInfo returns all accounts the user can manage —
        # spans all customers (no customer filter).
        accounts = svc.GetAccountsInfo(CustomerId=None, OnlyParentAccounts=False)
        if accounts is None:
            return out
        # SOAP returns a special object; iterate the inner list.
        infos = getattr(accounts, "AccountInfo", None) or accounts
        for a in infos:
            try:
                out.append({
                    "customer_id": str(getattr(a, "CustomerId", "") or ""),
                    "account_id": str(getattr(a, "Id", "") or ""),
                    "name": str(getattr(a, "Name", "") or ""),
                    "number": str(getattr(a, "Number", "") or ""),
                })
            except Exception:  # pragma: no cover - SOAP can return odd shapes
                continue
    except Exception as e:
        logger.warning("[bing_ads.sdk] GetAccountsInfo failed: %s", e)
    return out


async def sync_metrics(date_str: Optional[str] = None) -> dict:
    """Pull a single day's account-level metrics into `ad_spend`.

    Returns a status dict (also written to `integration_sync_log`)
    matching the shape used by Google Ads so the connection card can
    reuse the same UI logic."""
    from routers.ad_spend import upsert_spend

    if date_str is None:
        date_str = (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%d")

    cred = await db.integration_credentials.find_one({"_id": "microsoft_ads"})
    if not cred or not cred.get("refresh_token"):
        return {"status": "skipped", "reason": "not_connected", "date": date_str}

    customer_id = (cred.get("customer_id")
                   or os.environ.get("BING_CUSTOMER_ID", "")).strip()
    account_id = (cred.get("account_id")
                  or os.environ.get("BING_ACCOUNT_ID", "")).strip()
    if not customer_id or not account_id:
        return {
            "status": "skipped",
            "reason": "missing_account_ids",
            "date": date_str,
            "hint": "Set BING_CUSTOMER_ID + BING_ACCOUNT_ID in .env, or reconnect to re-run discovery.",
        }

    log = await db.integration_sync_log.insert_one({
        "provider": "microsoft_ads", "date": date_str,
        "status": "running", "started_at": now_iso(),
    })

    async def _finish(status: str, *, rows: int = 0, error: str = ""):
        await db.integration_sync_log.update_one(
            {"_id": log.inserted_id},
            {"$set": {"status": status, "rows": rows, "error": error,
                      "finished_at": now_iso()}},
        )

    try:
        loop = asyncio.get_running_loop()
        rows = await loop.run_in_executor(
            None, _run_report_sync,
            date_str, cred["refresh_token"], customer_id, account_id,
        )
    except Exception as e:
        logger.exception("[bing_ads.sdk] sync failed: %s", e)
        await _finish("error", error=str(e)[:500])
        return {"status": "error", "date": date_str, "error": str(e)[:500]}

    # Persist each campaign-day row.
    for r in rows:
        await upsert_spend({
            "platform": "microsoft",
            "campaign_id": r["campaign_id"],
            "campaign_name": r["campaign_name"],
            "date": r["date"],
            "spend_usd": r["spend_usd"],
            "clicks": r["clicks"],
            "impressions": r["impressions"],
            "conversions": r["conversions"],
        })

    await _finish("ok", rows=len(rows))
    return {"status": "ok", "date": date_str, "rows": len(rows)}


def _run_report_sync(date_str: str, refresh_token: str,
                     customer_id: str, account_id: str) -> list[dict]:
    """SOAP-side: download a CampaignPerformanceReport for one day.

    The MS Reporting API works async — submit a report request, poll
    until ready, then download the CSV. The SDK has a helper that does
    polling + download in one call.
    """
    import io
    import zipfile
    import csv
    import tempfile

    from bingads.authorization import (
        AuthorizationData, OAuthWebAuthCodeGrant,
    )
    from bingads.v13.reporting import (
        ReportingServiceManager, ReportingDownloadParameters,
    )
    from bingads.v13.reporting.reporting_service_manager import \
        ReportingDownloadOperation  # noqa: F401 - ensure submodule
    # XML request classes (SOAP-style):
    from suds.client import WebFault  # noqa: F401

    grant = OAuthWebAuthCodeGrant(
        client_id=os.environ["BING_CLIENT_ID"],
        client_secret=os.environ["BING_CLIENT_SECRET"],
        redirection_uri="https://login.microsoftonline.com/common/oauth2/nativeclient",
        env=_api_environment(),
    )
    # `request_oauth_tokens_by_refresh_token` mints a fresh access_token
    # from our stored refresh_token — same flow as Google's
    # refresh-then-call pattern.
    grant.request_oauth_tokens_by_refresh_token(refresh_token)

    auth = AuthorizationData(
        account_id=int(account_id),
        customer_id=int(customer_id),
        developer_token=os.environ["BING_DEVELOPER_TOKEN"],
        authentication=grant,
    )

    # Build the report request via the SDK's factory.
    mgr = ReportingServiceManager(
        authorization_data=auth, poll_interval_in_milliseconds=5000,
        environment=_api_environment(),
    )
    factory = mgr.service_client.factory

    rpt = factory.create("CampaignPerformanceReportRequest")
    rpt.Aggregation = "Daily"
    rpt.Format = "Csv"
    rpt.ReturnOnlyCompleteData = False
    rpt.ExcludeReportFooter = True
    rpt.ExcludeReportHeader = True

    scope = factory.create("AccountThroughCampaignReportScope")
    # Microsoft's official Python SDK sample passes AccountIds as a dict
    # literal — suds serializes `{'long': [...]}` into the right
    # ArrayOflong shape regardless of the WSDL's internal namespace.
    # Using `factory.create("ArrayOflong")` fails with
    # `Type not found: 'ArrayOflong'` because that type is namespaced
    # inside the reporting WSDL.
    scope.AccountIds = {"long": [int(account_id)]}
    scope.Campaigns = None
    rpt.Scope = scope

    cols = factory.create("ArrayOfCampaignPerformanceReportColumn")
    for c in ("TimePeriod", "CampaignId", "CampaignName", "Spend",
              "Clicks", "Impressions", "Conversions"):
        cols.CampaignPerformanceReportColumn.append(c)
    rpt.Columns = cols

    time = factory.create("ReportTime")
    cd_from = factory.create("Date")
    cd_to = factory.create("Date")
    y, m, d = date_str.split("-")
    cd_from.Year = int(y)
    cd_from.Month = int(m)
    cd_from.Day = int(d)
    cd_to.Year = int(y)
    cd_to.Month = int(m)
    cd_to.Day = int(d)
    time.CustomDateRangeStart = cd_from
    time.CustomDateRangeEnd = cd_to
    time.ReportTimeZone = "PacificTimeUSCanadaTijuana"
    rpt.Time = time

    with tempfile.TemporaryDirectory() as tmp:
        params = ReportingDownloadParameters(
            report_request=rpt,
            result_file_directory=tmp,
            result_file_name="report.zip",
            overwrite_result_file=True,
            timeout_in_milliseconds=600000,
        )
        result_path = mgr.download_file(params)
        if not result_path:
            return []
        # The downloaded artifact is a ZIP containing one CSV.
        with zipfile.ZipFile(result_path) as zf:
            csv_name = next(
                (n for n in zf.namelist() if n.lower().endswith(".csv")),
                None,
            )
            if not csv_name:
                return []
            raw = zf.read(csv_name).decode("utf-8-sig", errors="ignore")

    out: list[dict] = []
    reader = csv.DictReader(io.StringIO(raw))
    for row in reader:
        try:
            out.append({
                "campaign_id": (row.get("CampaignId") or "").strip(),
                "campaign_name": (row.get("CampaignName") or "").strip(),
                "date": (row.get("TimePeriod") or date_str).strip()[:10],
                "spend_usd": float((row.get("Spend") or "0").replace(",", "") or 0),
                "clicks": int((row.get("Clicks") or "0").replace(",", "") or 0),
                "impressions": int((row.get("Impressions") or "0").replace(",", "") or 0),
                "conversions": float((row.get("Conversions") or "0").replace(",", "") or 0),
            })
        except (ValueError, TypeError) as e:
            logger.warning("[bing_ads.sdk] row parse skipped: %s — %s", row, e)
            continue
    return out
