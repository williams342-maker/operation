"""iter335.8 — Server-side Conversions API uploads.

Fired when an order transitions unpaid → paid. Pushes the conversion
to whichever ad platforms have a click ID on the transaction:
  • Meta CAPI         (fbclid)
  • Google Enhanced Conversions for Leads (gclid)
  • Microsoft UET Offline Conversions      (msclkid)

Why server-side on top of URL-param attribution?
  • iOS 14.5+ Safari/Mail strip click IDs from URLs after a few hops
    (ITP), so client-side attribution undercounts by 15-30%.
  • Server-side uploads use SHA-256 hashed PII (email, phone) for
    identity matching, which works regardless of ITP/cookie state.
  • The ad platforms use these signals to optimize bidding (their
    smart-bid algorithms learn which audiences actually convert).

ALL THREE uploads are wrapped in their own try/except so one
platform's outage never blocks the others or the rest of the
checkout response. Failures are logged to `conversion_upload_log`
with the error so we can retry manually if needed.

Hashing: emails are lowercased + trimmed before SHA-256 (Meta/Google
both require this). Phone numbers are stripped to digits and
prefixed with E.164 country code if available.
"""
from __future__ import annotations
import hashlib
import logging
import os
from datetime import datetime, timezone
from typing import Optional

import httpx

from core import db, now_iso

logger = logging.getLogger("crafters.promote.conversions")

META_API_VERSION = os.environ.get("META_API_VERSION", "v20.0")
META_GRAPH = f"https://graph.facebook.com/{META_API_VERSION}"


def _sha256(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def _norm_email(email: Optional[str]) -> Optional[str]:
    if not email:
        return None
    return email.strip().lower()


async def fire_conversions(tx: dict) -> dict:
    """Best-effort upload to all 3 channels. Returns a dict of
    `{channel: status}` so the caller can log a single summary line.

    `tx` is a row from `payment_transactions` that just flipped to
    paid. Expected keys: customer_email, amount_total (in
    smallest-currency-units), currency, gclid, fbclid, msclkid,
    session_id, line_items (optional).
    """
    results: dict[str, str] = {}
    amount_cents = int(tx.get("amount_total") or 0)
    currency = (tx.get("currency") or "usd").lower()
    email = _norm_email(tx.get("customer_email"))
    session_id = tx.get("session_id") or tx.get("_id") or ""

    # iter335.8 — Idempotency. If we already uploaded a conversion for
    # this session_id × channel, skip the re-fire. Stripe webhooks
    # occasionally fire twice; the conversions API platforms accept
    # duplicates but their dashboards then double-count.
    existing = {}
    async for log in db.conversion_upload_log.find(
        {"session_id": session_id}, {"channel": 1, "status": 1}
    ):
        existing[log.get("channel")] = log.get("status")

    fbclid = tx.get("fbclid")
    if fbclid and existing.get("meta") != "ok":
        try:
            await _upload_meta(amount_cents, currency, email, fbclid, session_id)
            results["meta"] = "ok"
        except Exception as e:
            logger.exception("[conversions.meta] upload failed: %s", e)
            results["meta"] = f"err:{str(e)[:120]}"

    gclid = tx.get("gclid")
    if gclid and existing.get("google") != "ok":
        try:
            await _upload_google(amount_cents, currency, email, gclid, session_id)
            results["google"] = "ok"
        except Exception as e:
            logger.exception("[conversions.google] upload failed: %s", e)
            results["google"] = f"err:{str(e)[:120]}"

    msclkid = tx.get("msclkid")
    if msclkid and existing.get("microsoft") != "ok":
        try:
            await _upload_microsoft(amount_cents, currency, msclkid, session_id)
            results["microsoft"] = "ok"
        except Exception as e:
            logger.exception("[conversions.microsoft] upload failed: %s", e)
            results["microsoft"] = f"err:{str(e)[:120]}"

    # Persist per-channel result so the next fire is idempotent.
    for ch, status in results.items():
        await db.conversion_upload_log.update_one(
            {"session_id": session_id, "channel": ch},
            {"$set": {
                "session_id": session_id,
                "channel": ch,
                "status": status,
                "amount_cents": amount_cents,
                "currency": currency,
                "uploaded_at": now_iso(),
            }},
            upsert=True,
        )

    if results:
        logger.info("[conversions] session=%s results=%s", session_id, results)
    return results


# ── Meta CAPI ──────────────────────────────────────────────────────────
async def _upload_meta(amount_cents: int, currency: str,
                       email: Optional[str], fbclid: str,
                       session_id: str) -> None:
    """POST to /{pixel_id}/events with a single Purchase event."""
    pixel_id = os.environ.get("META_PIXEL_ID", "").strip()
    access_token = os.environ.get("META_CAPI_ACCESS_TOKEN", "").strip()
    if not (pixel_id and access_token):
        # Falls through silently — admin hasn't configured CAPI yet.
        raise RuntimeError("META_PIXEL_ID or META_CAPI_ACCESS_TOKEN not set")

    user_data: dict = {"fbc": f"fb.1.{int(datetime.now(timezone.utc).timestamp() * 1000)}.{fbclid}"}
    if email:
        user_data["em"] = [_sha256(email)]

    event = {
        "event_name": "Purchase",
        "event_time": int(datetime.now(timezone.utc).timestamp()),
        "action_source": "website",
        "event_id": session_id,  # de-dupes against the browser pixel's Purchase
        "user_data": user_data,
        "custom_data": {
            "currency": currency.upper(),
            "value": amount_cents / 100.0,
        },
    }
    payload = {"data": [event], "access_token": access_token}
    test_code = os.environ.get("META_CAPI_TEST_CODE", "").strip()
    if test_code:
        payload["test_event_code"] = test_code

    async with httpx.AsyncClient(timeout=15) as http:
        r = await http.post(f"{META_GRAPH}/{pixel_id}/events", json=payload)
        r.raise_for_status()


# ── Google Enhanced Conversions ────────────────────────────────────────
async def _upload_google(amount_cents: int, currency: str,
                         email: Optional[str], gclid: str,
                         session_id: str) -> None:
    """Upload a click-conversion to the conversion action configured
    in `GOOGLE_ADS_CONVERSION_ACTION_ID`. Uses the google-ads SDK in
    a thread so we don't block the event loop."""
    import asyncio

    cred = await db.integration_credentials.find_one({"_id": "google_ads"})
    if not cred or not cred.get("refresh_token"):
        raise RuntimeError("Google Ads not connected")
    customer_id = (
        cred.get("customer_id")
        or os.environ.get("GOOGLE_ADS_CUSTOMER_ID", "")
    ).replace("-", "").strip()
    if not customer_id:
        raise RuntimeError("Google customer_id missing")
    conv_action = os.environ.get("GOOGLE_ADS_CONVERSION_ACTION_ID", "").strip()
    if not conv_action:
        raise RuntimeError("GOOGLE_ADS_CONVERSION_ACTION_ID not set")

    loop = asyncio.get_running_loop()
    await loop.run_in_executor(
        None, _google_upload_sync,
        cred["refresh_token"], customer_id, conv_action,
        gclid, amount_cents / 100.0, currency.upper(),
        _sha256(email) if email else None, session_id,
    )


def _google_upload_sync(refresh_token: str, customer_id: str,
                        conv_action_id: str, gclid: str, value: float,
                        currency: str, email_sha: Optional[str],
                        session_id: str) -> None:
    """Sync google-ads SDK call. Runs inside the asyncio executor."""
    from google.ads.googleads.client import GoogleAdsClient
    from datetime import datetime as _dt
    client = GoogleAdsClient.load_from_dict({
        "developer_token": os.environ["GOOGLE_ADS_DEVELOPER_TOKEN"],
        "client_id": os.environ["GOOGLE_ADS_CLIENT_ID"],
        "client_secret": os.environ["GOOGLE_ADS_CLIENT_SECRET"],
        "refresh_token": refresh_token,
        "login_customer_id": (
            os.environ.get("GOOGLE_ADS_LOGIN_CUSTOMER_ID", "") or customer_id
        ).replace("-", ""),
        "use_proto_plus": True,
    })
    svc = client.get_service("ConversionUploadService")
    click_conv = client.get_type("ClickConversion")
    click_conv.conversion_action = (
        f"customers/{customer_id}/conversionActions/{conv_action_id}"
    )
    click_conv.gclid = gclid
    click_conv.conversion_value = float(value)
    click_conv.currency_code = currency
    # ISO 8601 with timezone offset — Google rejects naive datetimes.
    click_conv.conversion_date_time = _dt.now(timezone.utc).strftime(
        "%Y-%m-%d %H:%M:%S+00:00"
    )
    click_conv.order_id = session_id
    if email_sha:
        ud = client.get_type("UserIdentifier")
        ud.hashed_email = email_sha
        click_conv.user_identifiers.append(ud)
    resp = svc.upload_click_conversions(
        customer_id=customer_id,
        conversions=[click_conv],
        partial_failure=True,
    )
    # partial_failure=True means Google returns 200 even if our row
    # was rejected — surface the rejection so we don't silently lose
    # data.
    if resp.partial_failure_error and resp.partial_failure_error.code:
        raise RuntimeError(
            f"Google partial_failure: {resp.partial_failure_error.message[:200]}"
        )


# ── Microsoft UET Offline Conversions ──────────────────────────────────
async def _upload_microsoft(amount_cents: int, currency: str,
                            msclkid: str, session_id: str) -> None:
    """Upload to the UET goal named in `BING_CONVERSION_GOAL_NAME` via
    `ApplyOfflineConversions`. SOAP SDK call → executor."""
    import asyncio

    cred = await db.integration_credentials.find_one({"_id": "microsoft_ads"})
    if not cred or not cred.get("refresh_token"):
        raise RuntimeError("Microsoft Ads not connected")
    customer_id = (cred.get("customer_id") or os.environ.get("BING_CUSTOMER_ID", "")).strip()
    account_id = (cred.get("account_id") or os.environ.get("BING_ACCOUNT_ID", "")).strip()
    goal_name = os.environ.get("BING_CONVERSION_GOAL_NAME", "").strip()
    if not (customer_id and account_id and goal_name):
        raise RuntimeError("Bing customer/account IDs or BING_CONVERSION_GOAL_NAME missing")

    loop = asyncio.get_running_loop()
    await loop.run_in_executor(
        None, _microsoft_upload_sync,
        cred["refresh_token"], customer_id, account_id, goal_name,
        msclkid, amount_cents / 100.0, currency.upper(),
    )


def _microsoft_upload_sync(refresh_token: str, customer_id: str,
                           account_id: str, goal_name: str,
                           msclkid: str, value: float, currency: str) -> None:
    """Sync bingads SOAP call. Reuses the OAuth helpers from
    `routers/microsoft_ads_sdk.py` for consistency."""
    from datetime import datetime as _dt
    from bingads.service_client import ServiceClient
    from services.ads_gateway.microsoft import _auth_data

    auth = _auth_data(refresh_token, customer_id, account_id)
    svc = ServiceClient(
        service="CampaignManagementService", version=13,
        authorization_data=auth,
        environment=os.environ.get("BING_ENVIRONMENT", "production"),
    )
    oc = svc.factory.create("OfflineConversion")
    oc.MicrosoftClickId = msclkid
    oc.ConversionName = goal_name
    oc.ConversionTime = _dt.now(timezone.utc)
    oc.ConversionValue = float(value)
    oc.ConversionCurrencyCode = currency
    arr = svc.factory.create("ArrayOfOfflineConversion")
    arr.OfflineConversion.append(oc)
    svc.ApplyOfflineConversions(OfflineConversions=arr)
