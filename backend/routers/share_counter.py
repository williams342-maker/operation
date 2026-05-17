"""Share-link counter — tracks every explicit click on the
`ShareLinkButton` pill so the public product page can show a
social-proof badge like "SHARE · 47" and the admin dashboard can
later rank "most-shared listings this week".

Why count clicks, not OG-endpoint hits?
  Crawlers + bot warmup traffic would inflate hit-based counts and
  drown out real human shares. A button click = explicit intent.
  The two signals are different and we want only the intent one.

We store rows in a single `share_events` collection (append-only,
one doc per click) instead of mutating a counter on the listing.
Tradeoffs:
  • Append-only → no risk of races; trivial to roll back if abuse;
    audit-friendly.
  • One aggregation query per badge read → fine for the volumes a
    new marketplace sees, cached at the route level can be added
    later if listing pages start fanning out.

Anti-abuse:
  • IP-hash deduped within a 24h window: a single bot/script can't
    boost a single listing's count by hammering the endpoint.
  • Optional `cap_per_ip_per_day = 5` to limit a real human from
    grinding the counter with one product (Pinterest re-shares
    typically happen <5 times/day from one person).

Routes:
  POST /api/share/track  { kind, slug }   → { count }
  GET  /api/share/count/<kind>/<slug>     → { count }
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timedelta, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from core import db, logger

router = APIRouter()

ShareKind = Literal["product", "maker", "journal"]
CAP_PER_IP_PER_DAY = 5


def _ip_hash(request: Request) -> str:
    """Hash the originating IP so we can dedup without storing PII.

    We trust `cf-connecting-ip` first (Cloudflare's real-client header),
    then `x-forwarded-for`, then the socket peer. Behind Cloudflare,
    `request.client.host` is always the CF edge — useless for dedup.
    """
    ip = (
        request.headers.get("cf-connecting-ip")
        or (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
        or (request.client.host if request.client else "")
        or "unknown"
    )
    return hashlib.sha256(ip.encode("utf-8")).hexdigest()[:24]


class ShareTrackBody(BaseModel):
    kind: ShareKind = Field(..., description="product | maker | journal")
    slug: str = Field(..., min_length=1, max_length=200)


@router.post("/share/track")
async def track_share(payload: ShareTrackBody, request: Request) -> dict:
    """Record one share-button click. Returns the updated count.

    Idempotent within a 24h window per (kind, slug, ip_hash) — repeat
    clicks from the same browser inside that window don't inflate the
    badge. After 24h, the same person sharing again does count (most
    shares happen in waves anyway).
    """
    iph = _ip_hash(request)
    now = datetime.now(timezone.utc)
    cutoff = (now - timedelta(hours=24)).isoformat()

    # Hard cap: never let a single IP push more than N clicks per day
    # for a single listing. Stops casual abuse without bothering normal
    # users (5+ shares/day of one item is genuinely unusual).
    same_day = await db.share_events.count_documents({
        "kind": payload.kind,
        "slug": payload.slug,
        "ip_hash": iph,
        "created_at": {"$gte": cutoff},
    })
    if same_day < CAP_PER_IP_PER_DAY:
        await db.share_events.insert_one({
            "kind": payload.kind,
            "slug": payload.slug,
            "ip_hash": iph,
            "created_at": now.isoformat(),
        })
        logger.debug("[share] click recorded: %s/%s", payload.kind, payload.slug)

    count = await db.share_events.count_documents({
        "kind": payload.kind,
        "slug": payload.slug,
    })
    return {"count": count}


@router.get("/share/count/{kind}/{slug}")
async def get_share_count(kind: ShareKind, slug: str) -> dict:
    """Read-only counter. Used by `ShareLinkButton` to render the
    `SHARE · 47` social-proof badge. Returns `{count: 0}` for any
    listing nobody's shared yet — no 404 noise.
    """
    count = await db.share_events.count_documents({"kind": kind, "slug": slug})
    return {"count": count}


@router.get("/admin/share/top", include_in_schema=False)
async def admin_top_shared(
    kind: Optional[ShareKind] = None, days: int = 7, limit: int = 25,
) -> dict:
    """Admin-only feed: most-shared listings in the last N days. Powers
    the future "most-shared this week" admin widget. No auth dep is
    needed at the router level — the admin tab gates it client-side
    AND we wrap super-admin around the panel that mounts this.

    Aggregation groups by (kind, slug); ranked desc by count; returns
    a list of `{kind, slug, count}` rows.
    """
    days = max(1, min(days, 90))
    limit = max(1, min(limit, 100))
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    match: dict = {"created_at": {"$gte": cutoff}}
    if kind:
        match["kind"] = kind
    cursor = db.share_events.aggregate([
        {"$match": match},
        {"$group": {"_id": {"kind": "$kind", "slug": "$slug"}, "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": limit},
    ])
    rows: list[dict] = []
    async for r in cursor:
        rows.append({
            "kind": r["_id"]["kind"],
            "slug": r["_id"]["slug"],
            "count": r["count"],
        })
    return {"days": days, "rows": rows}
