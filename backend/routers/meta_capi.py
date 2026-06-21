"""iter413bl — Meta Conversions API (server-side).

Mirrors browser Meta Pixel fires from FastAPI handlers so ad-blockers
+ iOS tracking restrictions don't silently zero out reported
conversions. Sends the SAME `event_id` the browser pixel already
fires so Meta server-side-deduplicates the two — single attributed
conversion, never doubles.

Surface:
  • Internal Python helper `send_meta_event()` — call from any handler
    that knows a real conversion just happened (Stripe webhook, /apply
    submit, etc.)
  • `GET /admin/meta-capi/status` — surfaces whether the access token
    is wired (powers the admin diag card)

Required env vars:
  META_PIXEL_ID         e.g. "1234567890123456"
  META_CAPI_ACCESS_TOKEN  Long-lived token from Events Manager →
                          Settings → Conversions API → Generate Access Token

Optional env vars:
  META_CAPI_TEST_CODE   When set, Meta routes events to the "Test Events"
                        view so you can verify shapes without polluting
                        production conversion totals.
"""
from __future__ import annotations

import hashlib
import logging
import os
import time
from typing import Optional

import httpx
from fastapi import APIRouter, Depends

from maker_auth import current_admin as _current_admin


log = logging.getLogger("meta_capi")
router = APIRouter()


META_GRAPH_VERSION = "v18.0"


def _sha256(value: Optional[str]) -> Optional[str]:
    """Meta requires SHA-256 hashed PII (lowercase, trimmed)."""
    if not value:
        return None
    norm = value.strip().lower()
    return hashlib.sha256(norm.encode("utf-8")).hexdigest()


def _capi_config() -> dict:
    pixel_id = (os.environ.get("META_PIXEL_ID") or "").strip()
    token = (os.environ.get("META_CAPI_ACCESS_TOKEN") or "").strip()
    test_code = (os.environ.get("META_CAPI_TEST_CODE") or "").strip() or None
    return {
        "pixel_id": pixel_id,
        "token": token,
        "test_code": test_code,
        "configured": bool(pixel_id and token),
    }


async def send_meta_event(
    *,
    event_name: str,
    event_id: str,
    email: Optional[str] = None,
    phone: Optional[str] = None,
    client_ip: Optional[str] = None,
    user_agent: Optional[str] = None,
    fbp: Optional[str] = None,  # _fbp browser cookie
    fbc: Optional[str] = None,  # _fbc browser cookie (click id)
    event_source_url: Optional[str] = None,
    value: Optional[float] = None,
    currency: Optional[str] = None,
    custom_data: Optional[dict] = None,
) -> dict:
    """Fire a single server-side Meta conversion. Returns a dict with
    {sent, status_code, response, dedup_id, configured}. Always
    succeeds — analytics MUST not crash a payment flow."""
    cfg = _capi_config()
    if not cfg["configured"]:
        return {"sent": False, "configured": False, "reason": "META_PIXEL_ID or META_CAPI_ACCESS_TOKEN missing"}

    payload_user_data: dict = {}
    if email:
        h = _sha256(email)
        if h:
            payload_user_data["em"] = [h]
    if phone:
        h = _sha256(phone)
        if h:
            payload_user_data["ph"] = [h]
    if client_ip:
        payload_user_data["client_ip_address"] = client_ip
    if user_agent:
        payload_user_data["client_user_agent"] = user_agent[:512]
    if fbp:
        payload_user_data["fbp"] = fbp
    if fbc:
        payload_user_data["fbc"] = fbc

    cd: dict = dict(custom_data or {})
    if value is not None:
        cd["value"] = float(value)
    if currency:
        cd["currency"] = currency.upper()

    event = {
        "event_name": event_name,
        "event_time": int(time.time()),
        "event_id": event_id,
        "action_source": "website",
        "user_data": payload_user_data,
    }
    if event_source_url:
        event["event_source_url"] = event_source_url
    if cd:
        event["custom_data"] = cd

    body: dict = {"data": [event]}
    if cfg["test_code"]:
        body["test_event_code"] = cfg["test_code"]

    url = (
        f"https://graph.facebook.com/{META_GRAPH_VERSION}/"
        f"{cfg['pixel_id']}/events?access_token={cfg['token']}"
    )
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.post(url, json=body)
            return {
                "sent": resp.status_code == 200,
                "configured": True,
                "status_code": resp.status_code,
                "response": resp.json() if resp.headers.get("content-type", "").startswith("application/json") else resp.text[:500],
                "dedup_id": event_id,
                "test_mode": bool(cfg["test_code"]),
            }
    except Exception as e:
        log.warning("Meta CAPI fire failed: %s", e)
        return {"sent": False, "configured": True, "error": str(e), "dedup_id": event_id}


@router.get("/admin/meta-capi/status")
async def meta_capi_status(_admin: dict = Depends(_current_admin)):
    """Surfaces whether the Conversions API access token + Pixel ID are
    wired. Powers the admin diag card."""
    cfg = _capi_config()
    return {
        "configured": cfg["configured"],
        "pixel_id_present": bool(cfg["pixel_id"]),
        "token_present": bool(cfg["token"]),
        "test_mode": bool(cfg["test_code"]),
        # Redacted previews — long enough to verify the value isn't
        # a typo, short enough not to leak the full secret.
        "pixel_id_preview": (
            f"{cfg['pixel_id'][:3]}…{cfg['pixel_id'][-3:]}"
            if cfg["pixel_id"] and len(cfg["pixel_id"]) > 6 else cfg["pixel_id"] or "—"
        ),
        "token_preview": (
            f"{cfg['token'][:4]}…{cfg['token'][-4:]}"
            if cfg["token"] and len(cfg["token"]) > 8 else "—"
        ),
    }
