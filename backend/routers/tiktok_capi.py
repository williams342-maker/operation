"""iter413cf — TikTok Events API 2.0 (server-side conversion tracking).

Mirrors browser TikTok Pixel fires from FastAPI handlers so ad-blockers
+ iOS tracking restrictions don't silently zero out reported
conversions. Sends the SAME `event_id` the browser pixel already
fires so TikTok server-side-deduplicates the two — single attributed
conversion, never doubles.

Pattern intentionally mirrors `routers/meta_capi.py` line-for-line so
both surfaces evolve together (matching call sites, same env-var
shape, same admin diag tile).

Surface:
  • Internal Python helper `send_tiktok_event()` — call from any
    handler that knows a real conversion just happened (Stripe webhook,
    /apply submit, etc.)
  • `GET /admin/tiktok-capi/status` — surfaces whether the access
    token is wired (powers the admin diag card)

Required env vars:
  TIKTOK_PIXEL_ID            e.g. "D8UP6SJC77UCR7H8US60"
  TIKTOK_CAPI_ACCESS_TOKEN   Long-lived token from Events Manager →
                             Settings → Events API → Generate Access Token

Optional env vars:
  TIKTOK_CAPI_TEST_CODE      When set, TikTok routes events to the
                             "Test Events" view so you can verify
                             shapes without polluting production
                             conversion totals.

Internal action-name → TikTok standard-event mapping (mirrors the
browser-side mapping in `frontend/src/lib/tiktokPixel.js`):
  purchase            → CompletePayment
  add_to_cart         → AddToCart
  signup_buyer        → CompleteRegistration
  signup_maker        → CompleteRegistration  (with description tag)
  lead_custom_order   → SubmitForm
  lead_contact        → Contact
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


log = logging.getLogger("tiktok_capi")
router = APIRouter()


TIKTOK_API_URL = "https://business-api.tiktok.com/open_api/v1.3/event/track/"


# Same taxonomy the browser pixel uses. Keep these two maps in sync.
_TIKTOK_EVENT_MAP = {
    "purchase": "CompletePayment",
    "add_to_cart": "AddToCart",
    "signup_buyer": "CompleteRegistration",
    "signup_maker": "CompleteRegistration",
    "lead_custom_order": "SubmitForm",
    "lead_contact": "Contact",
}


def _sha256(value: Optional[str]) -> Optional[str]:
    """TikTok requires SHA-256 hashed PII (lowercase, trimmed) for
    email + phone. External_id is also hashed per TikTok guidance."""
    if not value:
        return None
    norm = value.strip().lower()
    return hashlib.sha256(norm.encode("utf-8")).hexdigest()


def _capi_config() -> dict:
    pixel_id = (os.environ.get("TIKTOK_PIXEL_ID") or "").strip()
    token = (os.environ.get("TIKTOK_CAPI_ACCESS_TOKEN") or "").strip()
    test_code = (os.environ.get("TIKTOK_CAPI_TEST_CODE") or "").strip() or None
    return {
        "pixel_id": pixel_id,
        "token": token,
        "test_code": test_code,
        "configured": bool(pixel_id and token),
    }


async def send_tiktok_event(
    *,
    event_name: str,
    event_id: str,
    email: Optional[str] = None,
    phone: Optional[str] = None,
    external_id: Optional[str] = None,
    client_ip: Optional[str] = None,
    user_agent: Optional[str] = None,
    ttclid: Optional[str] = None,        # _ttclid (TikTok click id)
    ttp: Optional[str] = None,           # _ttp browser cookie
    event_source_url: Optional[str] = None,
    value: Optional[float] = None,
    currency: Optional[str] = None,
    content_id: Optional[str] = None,
    content_name: Optional[str] = None,
    custom_data: Optional[dict] = None,
) -> dict:
    """Fire a single server-side TikTok conversion. Returns a dict with
    {sent, status_code, response, dedup_id, configured}. Always
    succeeds — analytics MUST not crash a payment flow.

    `event_name` accepts either our internal action key (e.g. 'purchase')
    OR a TikTok standard-event name directly (e.g. 'CompletePayment').
    The mapper is permissive so call sites stay readable."""
    cfg = _capi_config()
    if not cfg["configured"]:
        return {
            "sent": False, "configured": False,
            "reason": "TIKTOK_PIXEL_ID or TIKTOK_CAPI_ACCESS_TOKEN missing",
        }

    # Permissive resolver: accept either our internal key or a raw
    # TikTok event name. Falls through to the supplied string if it's
    # already a standard event so future events don't need a map edit.
    tt_event = _TIKTOK_EVENT_MAP.get(event_name, event_name)

    # ── user context ────────────────────────────────────────────────
    user: dict = {}
    if email:
        h = _sha256(email)
        if h:
            user["email"] = h
    if phone:
        h = _sha256(phone)
        if h:
            user["phone"] = h
    if external_id:
        h = _sha256(external_id)
        if h:
            user["external_id"] = h
    if client_ip:
        user["ip"] = client_ip
    if user_agent:
        user["user_agent"] = user_agent[:512]
    if ttclid:
        user["ttclid"] = ttclid
    if ttp:
        user["ttp"] = ttp

    # ── event properties ────────────────────────────────────────────
    properties: dict = dict(custom_data or {})
    if value is not None:
        properties["value"] = float(value)
    if currency:
        properties["currency"] = currency.upper()
    if content_id:
        properties["content_id"] = str(content_id)
        properties.setdefault("content_type", "product")
    if content_name:
        properties["content_name"] = str(content_name)[:200]

    # ── envelope ────────────────────────────────────────────────────
    data_row: dict = {
        "event": tt_event,
        "event_time": int(time.time()),
        "event_id": event_id,
        "user": user,
        "properties": properties,
    }
    if event_source_url:
        data_row["page"] = {"url": event_source_url}

    body: dict = {
        "event_source": "web",
        "event_source_id": cfg["pixel_id"],
        "data": [data_row],
    }
    if cfg["test_code"]:
        body["test_event_code"] = cfg["test_code"]

    headers = {
        "Content-Type": "application/json",
        "Access-Token": cfg["token"],
    }

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.post(TIKTOK_API_URL, json=body, headers=headers)
            # TikTok returns {"code": 0, "message": "OK", ...} on success;
            # HTTP 200 alone is not enough — they also encode app-level
            # errors in the body. Treat code=0 as the success signal.
            ok_http = resp.status_code == 200
            payload = {}
            try:
                payload = resp.json()
            except Exception:
                payload = {"text": resp.text[:500]}
            ok_app = bool(ok_http and isinstance(payload, dict) and payload.get("code") == 0)
            if not ok_app:
                log.warning(
                    "[tiktok-capi] non-ok response: http=%s code=%s msg=%s",
                    resp.status_code, payload.get("code"), payload.get("message"),
                )
            return {
                "sent": ok_app,
                "configured": True,
                "status_code": resp.status_code,
                "response": payload,
                "dedup_id": event_id,
                "test_mode": bool(cfg["test_code"]),
                "tiktok_event": tt_event,
            }
    except Exception as e:
        log.warning("TikTok Events API fire failed: %s", e)
        return {"sent": False, "configured": True, "error": str(e), "dedup_id": event_id}


@router.get("/admin/tiktok-capi/status")
async def tiktok_capi_status(_admin: dict = Depends(_current_admin)):
    """Surfaces whether the TikTok Events API access token + Pixel ID
    are wired. Powers the admin diag card."""
    cfg = _capi_config()
    return {
        "configured": cfg["configured"],
        "pixel_id_present": bool(cfg["pixel_id"]),
        "token_present": bool(cfg["token"]),
        "test_mode": bool(cfg["test_code"]),
        "pixel_id_preview": (
            f"{cfg['pixel_id'][:4]}…{cfg['pixel_id'][-4:]}"
            if cfg["pixel_id"] and len(cfg["pixel_id"]) > 8 else cfg["pixel_id"] or "—"
        ),
        "token_preview": (
            f"{cfg['token'][:4]}…{cfg['token'][-4:]}"
            if cfg["token"] and len(cfg["token"]) > 8 else "—"
        ),
    }
