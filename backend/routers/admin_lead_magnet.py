"""iter316a — Admin lead-magnet inbox.

Aggregates the `lead_magnet_subscribers` collection (populated by
`routers/lead_magnet.py`) into a single dashboard card surfacing:

  • total subscriber count
  • 7-day + 30-day deltas (new signups)
  • top conversion sources (UTM)
  • latest 5 signups (email + when + source)
  • drip funnel stats (per-step counts of day0/day3/day7 sends)

Also exposes a CSV export so the operator can pull the full list into
their CRM / Kit.com / Mailchimp without an API integration.

All endpoints require the `content` admin capability (keeps the
super-admin convention used elsewhere in the codebase). Read-only —
no mutations.
"""
from __future__ import annotations

import csv
import io
import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse

from core import db
from maker_auth import require_capability

router = APIRouter()
log = logging.getLogger("crafters.admin.lead_magnet")


def _since_iso(days: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()


@router.get("/admin/lead-magnet/summary")
async def admin_lead_magnet_summary(
    _: dict = Depends(require_capability("content")),
):
    """Aggregate snapshot for the admin inbox card. One round-trip per
    section so the card renders in <1s even with 10k+ subscribers."""
    coll = db.lead_magnet_subscribers
    now = datetime.now(timezone.utc)
    iso_7d = _since_iso(7)
    iso_30d = _since_iso(30)

    total = await coll.count_documents({"magnet": "starter-pack"})
    new_7d = await coll.count_documents(
        {"magnet": "starter-pack", "first_seen_at": {"$gte": iso_7d}},
    )
    new_30d = await coll.count_documents(
        {"magnet": "starter-pack", "first_seen_at": {"$gte": iso_30d}},
    )
    # consent stats — controls drip eligibility
    consented = await coll.count_documents(
        {"magnet": "starter-pack", "consent_marketing": True},
    )

    # Top sources (UTM) — small aggregation, no index needed at this scale.
    sources_raw = [
        d async for d in coll.aggregate([
            {"$match": {"magnet": "starter-pack"}},
            {"$group": {
                "_id": {"$ifNull": ["$source", "direct"]},
                "count": {"$sum": 1},
            }},
            {"$sort": {"count": -1}},
            {"$limit": 8},
        ])
    ]
    top_sources = [
        {"source": (d["_id"] or "direct"), "count": d["count"]}
        for d in sources_raw
    ]

    # Latest 5 signups — for the "live recent activity" strip.
    latest_rows = await coll.find(
        {"magnet": "starter-pack"},
        {"_id": 0, "email": 1, "first_seen_at": 1, "source": 1,
         "campaign": 1, "consent_marketing": 1, "download_count": 1,
         "drip_step": 1, "ip_country": 1},
    ).sort("first_seen_at", -1).limit(5).to_list(5)

    # Drip funnel — counts of subscribers at each step. Step 0 = only
    # received the day-0 download link (initial), 1 = also got day-3,
    # 2 = also got day-7 (full sequence complete). -1 = opted out /
    # already became a maker (suppressed).
    drip_buckets_raw = [
        d async for d in coll.aggregate([
            {"$match": {"magnet": "starter-pack", "consent_marketing": True}},
            {"$group": {
                "_id": {"$ifNull": ["$drip_step", 0]},
                "count": {"$sum": 1},
            }},
        ])
    ]
    drip_buckets = {int(d["_id"]): d["count"] for d in drip_buckets_raw}

    return {
        "total": total,
        "new_7d": new_7d,
        "new_30d": new_30d,
        "consented_to_marketing": consented,
        "top_sources": top_sources,
        "latest_signups": latest_rows,
        "drip": {
            "eligible_audience": consented,
            "step_0_only": drip_buckets.get(0, 0),
            "step_1_day3_sent": drip_buckets.get(1, 0),
            "step_2_day7_sent": drip_buckets.get(2, 0),
            "suppressed": drip_buckets.get(-1, 0),
            # The last_tick_at marker is written by the daily cron in
            # lead_magnet_drip.py so the card can show "drip is alive".
            "last_tick_at": (await db.cron_state.find_one(
                {"key": "lead_magnet_drip"}, {"_id": 0, "last_run_at": 1, "last_summary": 1},
            )) or {},
        },
        "as_of": now.isoformat(),
    }


@router.get("/admin/lead-magnet/subscribers")
async def admin_lead_magnet_subscribers(
    limit: int = Query(200, ge=1, le=2000),
    skip: int = Query(0, ge=0),
    _: dict = Depends(require_capability("content")),
):
    """Paginated subscriber list for the inbox table view. Returns the
    same projection as `summary.latest_signups` so the UI can re-use
    the same row component."""
    rows = await db.lead_magnet_subscribers.find(
        {"magnet": "starter-pack"},
        {"_id": 0, "email": 1, "first_seen_at": 1, "source": 1,
         "medium": 1, "campaign": 1, "consent_marketing": 1,
         "download_count": 1, "submission_count": 1, "drip_step": 1,
         "ip_country": 1, "last_download_at": 1},
    ).sort("first_seen_at", -1).skip(skip).limit(limit).to_list(limit)
    total = await db.lead_magnet_subscribers.count_documents({"magnet": "starter-pack"})
    return {"subscribers": rows, "total": total, "limit": limit, "skip": skip}


@router.get("/admin/lead-magnet/export.csv")
async def admin_lead_magnet_export(
    _: dict = Depends(require_capability("content")),
):
    """Stream a CSV of every subscriber. No pagination — caps at 50k
    rows (>10x the realistic top-end for this funnel). Operator imports
    into Kit.com / Mailchimp / their CRM."""
    rows = await db.lead_magnet_subscribers.find(
        {"magnet": "starter-pack"},
        {"_id": 0, "email": 1, "first_seen_at": 1, "source": 1,
         "medium": 1, "campaign": 1, "consent_marketing": 1,
         "download_count": 1, "submission_count": 1, "drip_step": 1,
         "ip_country": 1, "last_download_at": 1},
    ).sort("first_seen_at", -1).limit(50_000).to_list(50_000)

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow([
        "email", "first_seen_at", "source", "medium", "campaign",
        "consent_marketing", "download_count", "submission_count",
        "drip_step", "country", "last_download_at",
    ])
    for r in rows:
        w.writerow([
            r.get("email") or "",
            r.get("first_seen_at") or "",
            r.get("source") or "",
            r.get("medium") or "",
            r.get("campaign") or "",
            "yes" if r.get("consent_marketing") else "no",
            r.get("download_count") or 0,
            r.get("submission_count") or 0,
            r.get("drip_step") if r.get("drip_step") is not None else 0,
            r.get("ip_country") or "",
            r.get("last_download_at") or "",
        ])
    buf.seek(0)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M")
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="lead-magnet-subscribers-{stamp}.csv"',
            "Cache-Control": "private, no-cache",
        },
    )


@router.post("/admin/lead-magnet/drip/run-now")
async def admin_lead_magnet_drip_run_now(
    dry_run: bool = Query(True, description="If true, just count candidates; don't actually email."),
    _: dict = Depends(require_capability("content")),
):
    """Manual trigger for the drip tick. Useful for ops to verify the
    funnel without waiting for the 14:30 UTC cron. `dry_run=true` (the
    default) returns the candidate counts WITHOUT sending."""
    from lead_magnet_drip import run_drip_tick
    r = await run_drip_tick(dry_run=dry_run)
    return r
