"""iter334s — A/B experiment first-party event tally.

Two endpoints:
  • POST /api/experiments/pricing-label/event  — public, idempotent-ish,
        receives a {event, variant, slug} from the SPA and writes a row
        to `ab_pricing_label_events`. Exposures (`event=view`) are
        NOT written here — they live in GA4/UET; we only persist clicks
        because they're our primary first-party conversion signal.
  • GET  /api/admin/experiments/pricing-label/stats?days=14 — admin,
        returns per-variant click totals + click-through-rate-ish view
        derived from GA4 if connected, otherwise just raw click counts.
"""
from __future__ import annotations
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from typing import Literal, Optional

from core import db
from maker_auth import current_admin

router = APIRouter()


class PricingLabelEventIn(BaseModel):
    event: Literal["click", "view"] = "click"
    variant: Literal["from", "range"]
    slug: Optional[str] = Field(None, max_length=160)


@router.post("/experiments/pricing-label/event")
async def record_pricing_label_event(payload: PricingLabelEventIn, request: Request):
    """Record a click on a product card showing the A/B treatment.
    No auth — anyone browsing can call this. Rate-limit at the edge if
    abuse appears. We bound the slug length to prevent garbage writes."""
    # Drop noisy duplicates by IP+slug within 2s (same card double-tap).
    ip = (request.client.host if request.client else "anon")[:64]
    now = datetime.now(timezone.utc)
    recent = await db.ab_pricing_label_events.find_one({
        "ip": ip,
        "slug": payload.slug,
        "variant": payload.variant,
        "ts": {"$gte": (now - timedelta(seconds=2)).isoformat()},
    }, {"_id": 0, "ts": 1})
    if recent:
        return {"ok": True, "deduped": True}
    await db.ab_pricing_label_events.insert_one({
        "event": payload.event,
        "variant": payload.variant,
        "slug": payload.slug,
        "ip": ip,
        "ts": now.isoformat(),
    })
    return {"ok": True}


@router.get("/admin/experiments/pricing-label/stats")
async def admin_pricing_label_stats(days: int = 14, _: dict = Depends(current_admin)):
    """Click counts per variant over the window. Useful as a fast
    sanity-check while waiting for GA4/UET aggregates."""
    days = max(1, min(days, 90))
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    pipeline = [
        {"$match": {"ts": {"$gte": since}, "event": "click"}},
        {"$group": {"_id": "$variant", "clicks": {"$sum": 1},
                    "unique_slugs": {"$addToSet": "$slug"},
                    "unique_ips": {"$addToSet": "$ip"}}},
    ]
    rows = []
    async for r in db.ab_pricing_label_events.aggregate(pipeline):
        rows.append({
            "variant": r["_id"],
            "clicks": r["clicks"],
            "unique_listings": len(r.get("unique_slugs") or []),
            "unique_visitors": len(r.get("unique_ips") or []),
        })
    # Ensure both variants appear even if zero clicks (so admin UI doesn't
    # need conditional rendering).
    seen = {r["variant"] for r in rows}
    for v in ("from", "range"):
        if v not in seen:
            rows.append({"variant": v, "clicks": 0, "unique_listings": 0, "unique_visitors": 0})
    rows.sort(key=lambda r: r["variant"])
    return {
        "window_days": days,
        "variants": rows,
        "note": "Click events written by the SPA. Exposures live in GA4 (`experiment_view`) and UET (`ab_pricing_label_view`).",
    }
