"""Lightweight analytics event ingestion.

POST /api/analytics/events  → append a click / funnel event
POST /api/analytics/events (batched via `events`: [...]) also supported

We keep this endpoint deliberately permissive — anonymous OK. Bot-heavy
traffic is filtered out by a UA string sniff + rate limiting is left to
the ingress (existing global limits apply).

Schema stored in `db.analytics_events`:
  {
    id, event_type, path, referrer, user_agent,
    session_id, visitor_id, user_id?, shop_id?, listing_id?,
    created_at
  }

Only tracked types (whitelisted):
  page_view · apply_click · maker_application_submitted · email_verified
  shop_created · listing_created · add_to_cart · checkout_started
  order_completed · portfolio_click
"""
from __future__ import annotations
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Request, Header
from pydantic import BaseModel, Field

from core import db, now_iso

router = APIRouter(prefix="", tags=["analytics-events"])

ALLOWED_TYPES = {
    "page_view", "apply_click", "maker_application_submitted",
    "email_verified", "shop_created", "listing_created",
    "add_to_cart", "checkout_started", "order_completed",
    "portfolio_click",
}


class EventIn(BaseModel):
    event_type: str = Field(..., min_length=1, max_length=64)
    path: Optional[str] = Field(None, max_length=500)
    referrer: Optional[str] = Field(None, max_length=500)
    session_id: Optional[str] = Field(None, max_length=64)
    visitor_id: Optional[str] = Field(None, max_length=64)
    user_id: Optional[str] = Field(None, max_length=64)
    shop_id: Optional[str] = Field(None, max_length=64)
    listing_id: Optional[str] = Field(None, max_length=64)
    props: Optional[dict] = None


def _is_bot(ua: str | None) -> bool:
    if not ua: return False
    lo = ua.lower()
    return any(m in lo for m in ("bot", "spider", "crawler", "headless", "lighthouse"))


@router.post("/analytics/events")
async def track_event(evt: EventIn, request: Request,
                      user_agent: str | None = Header(default=None,
                                                     alias="User-Agent")):
    t = (evt.event_type or "").strip().lower()
    if t not in ALLOWED_TYPES:
        # Silently ignore unknown event types so a rogue client can't fill
        # our collection with junk. Return 200 to keep the beacon simple.
        return {"ok": True, "ignored": True}
    if _is_bot(user_agent):
        return {"ok": True, "ignored": True, "reason": "bot"}
    doc = {
        "id": uuid.uuid4().hex,
        "event_type": t,
        "path":       (evt.path or "")[:500] or None,
        "referrer":   (evt.referrer or "")[:500] or None,
        "session_id": evt.session_id,
        "visitor_id": evt.visitor_id,
        "user_id":    evt.user_id,
        "shop_id":    evt.shop_id,
        "listing_id": evt.listing_id,
        "props":      evt.props or None,
        "user_agent": (user_agent or "")[:500] or None,
        "created_at": now_iso(),
    }
    try:
        await db.analytics_events.insert_one(doc)
    except Exception:
        # Never let a tracking failure break the caller
        return {"ok": True, "stored": False}
    return {"ok": True, "stored": True}
