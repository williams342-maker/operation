"""iter413bz — 404 referrer beacon + admin "top stale links" surface.

A tiny public beacon endpoint that the NotFoundPage hits on mount
whenever a real user lands on a 404. The backend collects the path,
referer, user-agent, and role (when present) into `db.not_found_log`
so the admin Ops Dashboard can surface "Top stale links this week" —
turning silent dead-bookmark drift into actionable ops signal.

No PII; we deliberately do NOT log the user's IP or any signed-in
identity beyond a coarse role label ("maker" / "buyer" / "anon").
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from core import db
from maker_auth import current_admin

router = APIRouter()


def _now() -> datetime:
    return datetime.now(timezone.utc)


class _NotFoundBeacon(BaseModel):
    path: str
    referer: Optional[str] = None
    # `signed_in_role` is the role hint the SPA had in localStorage when
    # the 404 fired — purely for triage ("makers hitting /account vs
    # anons hitting /old-blog-post"). We trust the client here; this is
    # ops-signal, not security.
    signed_in_role: Optional[str] = None


@router.post("/not-found/log")
async def log_not_found(body: _NotFoundBeacon, request: Request):
    """Public beacon. No auth — anyone hitting a 404 (including bots)
    can fire this. We cap the document fields to defend against payload
    abuse, and the admin surface dedupes by path."""
    await db.not_found_log.insert_one({
        "id": str(uuid.uuid4()),
        "path":   (body.path or "")[:512],
        "referer": (body.referer or "")[:1024],
        "user_agent": (request.headers.get("user-agent") or "")[:512],
        "signed_in_role": (body.signed_in_role or "anon")[:16],
        "ts": _now().isoformat(),
    })
    return {"ok": True}


@router.get("/admin/not-found/recent")
async def admin_not_found_recent(_: dict = Depends(current_admin)):
    """Top stale links over the last 7 days, grouped by path so a
    single clustered breakage shows once with a count instead of N
    separate rows. Useful for spotting broken bookmark patterns within
    24h of them appearing."""
    seven_days_ago = (_now() - timedelta(days=7)).isoformat()
    pipe = [
        {"$match": {"ts": {"$gte": seven_days_ago}}},
        {"$group": {
            "_id": "$path",
            "hits": {"$sum": 1},
            "last_seen": {"$max": "$ts"},
            "roles": {"$addToSet": "$signed_in_role"},
            "sample_referer": {"$first": "$referer"},
        }},
        {"$sort": {"hits": -1}},
        {"$limit": 20},
    ]
    rows = []
    async for r in db.not_found_log.aggregate(pipe):
        rows.append({
            "path":           r["_id"] or "—",
            "hits":           r["hits"],
            "last_seen":      r["last_seen"],
            "roles":          [x for x in (r.get("roles") or []) if x],
            "sample_referer": (r.get("sample_referer") or "")[:200],
        })
    total_24h = await db.not_found_log.count_documents({
        "ts": {"$gte": (_now() - timedelta(hours=24)).isoformat()},
    })
    return {"window": "7d", "rows": rows, "total_24h": total_24h}
