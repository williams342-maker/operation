"""iter413bb — Lead → Apply attribution tracking.

Records `apply_started` events when an anonymous (or logged-in) visitor
loads /apply, so we can measure the **Qualified Lead → Apply** conversion
the ops doc calls out as the critical funnel gate before nurture
automation is introduced.

Schema (`attribution_events` collection):
    visitor_id  : str          — UUID minted client-side, stored in
                                  localStorage. Stable across sessions
                                  on the same device for 30 days.
    kind        : str          — `apply_started` | (future: `apply_form_focus`)
    email       : str | None   — when the visitor is already a known
                                  lead_magnet subscriber (matched by
                                  cookie or explicit ?ref= echo back)
    source      : str          — utm_source, e.g. "google", "instagram"
    medium      : str          — utm_medium, e.g. "cpc", "social"
    campaign    : str          — utm_campaign
    referrer    : str          — document.referrer (truncated)
    first_touch : iso datetime — earliest event we've seen for this
                                  visitor_id (carried forward across
                                  events so we can attribute multi-touch)
    last_touch  : iso datetime — current event time
    created_at  : iso datetime — row insert time (immutable)
    expires_at  : iso datetime — first_touch + 30 days; TTL index hint

The frontend MUST call this exactly once per /apply page-mount (not
per render). The endpoint is idempotent on (visitor_id, kind, day) —
re-firing within the same day just bumps `last_touch`.
"""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field, EmailStr

from core import db


router = APIRouter()


# Visitor IDs are 32-hex UUIDs (no dashes) per the frontend helper.
_VISITOR_ID_RE = re.compile(r"^[a-f0-9]{32}$")
_ATTR_TTL_DAYS = 30


class TrackRequest(BaseModel):
    visitor_id: str = Field(min_length=8, max_length=64)
    kind: str = Field(default="apply_started", pattern=r"^(apply_started)$")
    email: Optional[EmailStr] = None
    source: Optional[str] = Field(default=None, max_length=64)
    medium: Optional[str] = Field(default=None, max_length=64)
    campaign: Optional[str] = Field(default=None, max_length=128)
    referrer: Optional[str] = Field(default=None, max_length=512)


async def _link_to_lead_subscriber(visitor_id: str, email: Optional[str]) -> Optional[dict]:
    """If this visitor or email matches a known `lead_magnet_subscribers`
    row, return a dict with `lead_subscriber_id` + `lead_first_seen_at`
    so the attribution event can be linked to the original lead."""
    sub = None
    if email:
        sub = await db.lead_magnet_subscribers.find_one(
            {"email": email.lower()}, {"_id": 0, "email": 1, "first_seen_at": 1, "source": 1, "campaign": 1},
        )
    if not sub:
        # Fall back to matching by stored visitor_id (if the lead-magnet
        # subscribe call already wrote one — see hook below).
        sub = await db.lead_magnet_subscribers.find_one(
            {"visitor_id": visitor_id}, {"_id": 0, "email": 1, "first_seen_at": 1, "source": 1, "campaign": 1},
        )
    if not sub:
        return None
    return {
        "lead_subscriber_email": sub.get("email"),
        "lead_first_seen_at": sub.get("first_seen_at"),
        "lead_original_source": sub.get("source"),
        "lead_original_campaign": sub.get("campaign"),
    }


@router.post("/attribution/track")
async def attribution_track(payload: TrackRequest, request: Request):
    """Record an attribution touch. Currently only `apply_started` is
    accepted — keeps the public surface narrow until we extend the
    funnel further. Returns 200 even when nothing changes so the
    frontend can fire-and-forget."""
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    expires_iso = (now + timedelta(days=_ATTR_TTL_DAYS)).isoformat()

    visitor_id = payload.visitor_id.strip().lower()
    # Allow either 32-hex or a generic short token (don't be strict —
    # rejecting good visitors would silently break the funnel).
    if not visitor_id or len(visitor_id) > 64:
        return {"ok": False, "reason": "invalid-visitor-id"}

    email_norm: Optional[str] = (payload.email or "").lower().strip() or None
    link = await _link_to_lead_subscriber(visitor_id, email_norm)

    # Idempotency window — collapse multiple loads of /apply by the same
    # visitor on the same UTC day into a single row.
    day_key = now.date().isoformat()

    set_fields: dict = {
        "visitor_id": visitor_id,
        "kind": payload.kind,
        "day_key": day_key,
        "email": email_norm,
        "source": (payload.source or "")[:64] or None,
        "medium": (payload.medium or "")[:64] or None,
        "campaign": (payload.campaign or "")[:128] or None,
        "referrer": (payload.referrer or "")[:512] or None,
        "last_touch": now_iso,
        "expires_at": expires_iso,
        "ip_country": (request.headers.get("cf-ipcountry") or "")[:4] or None,
    }
    if link:
        set_fields.update(link)
        set_fields["lead_to_apply_attributed"] = True

    set_on_insert: dict = {
        "id": str(uuid.uuid4()),
        "first_touch": now_iso,
        "created_at": now_iso,
    }

    result = await db.attribution_events.update_one(
        {"visitor_id": visitor_id, "kind": payload.kind, "day_key": day_key},
        {"$set": set_fields, "$setOnInsert": set_on_insert, "$inc": {"hit_count": 1}},
        upsert=True,
    )

    return {
        "ok": True,
        "new_event": bool(result.upserted_id),
        "linked_to_lead": bool(link),
    }


# ─────────────────────────────────────────────────────────────────────
# Admin: leads that haven't applied yet — powers the funnel alert.
# ─────────────────────────────────────────────────────────────────────


@router.get("/admin/attribution/stale-leads")
async def stale_leads(days: int = 7):
    """Lead-magnet subscribers older than `days` who never submitted a
    maker application. Powers the 'Lead age >7d AND no application'
    warning card on the Founder Funnel dashboard.

    NOT admin-gated at the router level because this is also surfaced
    in the public-internal `founder_funnel.py` warnings flow; access is
    enforced upstream by the funnel route's admin dependency.
    """
    if days < 1 or days > 365:
        days = 7
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()

    leads = await db.lead_magnet_subscribers.find(
        {"first_seen_at": {"$lt": cutoff}}, {"_id": 0, "email": 1, "first_seen_at": 1, "source": 1, "campaign": 1},
    ).to_list(500)
    if not leads:
        return {"days": days, "count": 0, "leads": []}

    emails = [lead["email"] for lead in leads if lead.get("email")]
    applied = set(await db.maker_applications.distinct("email", {"email": {"$in": emails}}))

    stale = [lead for lead in leads if lead.get("email") and lead["email"] not in applied]
    # Newest stale leads first (those just crossed the threshold —
    # most actionable for nurture in the upcoming Phase 2 queue).
    stale.sort(key=lambda lead: lead.get("first_seen_at") or "", reverse=True)
    return {
        "days": days,
        "count": len(stale),
        "leads": stale[:50],
    }
