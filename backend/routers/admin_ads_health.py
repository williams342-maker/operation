"""iter335.10 — Ad Attribution Health admin endpoint.

Single-shot diagnostic over the last 7 days:
  • Paid sessions total
  • % with at least one click ID (gclid/fbclid/msclkid)
  • Per-channel upload stats from `conversion_upload_log` (% ok vs err)
  • Replay backlog: distinct session_ids still showing `err:` status

Surfaced as one Admin → Ads tab card so the team can see pipeline
health at a glance without grepping mongo.
"""
from __future__ import annotations
import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends

from core import db
from maker_auth import current_admin

router = APIRouter()
log = logging.getLogger("crafters.ads.health")


@router.get("/admin/ads/attribution-health")
async def attribution_health(_: dict = Depends(current_admin)):
    """7-day pipeline-health snapshot.

    `paid_sessions`           — paid transactions in window
    `sessions_with_click_id`  — at least one of gclid/fbclid/msclkid
    `click_id_coverage_pct`   — `with / total` × 100
    `by_channel`              — per platform: total tx with that click ID,
                                conversions uploaded successfully, errored,
                                pending (no log row yet)
    `replay_backlog`          — distinct session_ids with at least one
                                `err:` row still un-recovered
    """
    cutoff_dt = datetime.now(timezone.utc) - timedelta(days=7)
    cutoff_iso = cutoff_dt.isoformat()

    # Paid sessions in window.
    paid_query = {
        "payment_status": "paid",
        "$or": [
            {"updated_at": {"$gte": cutoff_iso}},
            {"created_at": {"$gte": cutoff_iso}},
        ],
    }
    paid_total = await db.payment_transactions.count_documents(paid_query)
    with_any = await db.payment_transactions.count_documents({
        **paid_query,
        "$or": [
            {"gclid": {"$exists": True, "$nin": [None, ""]}},
            {"fbclid": {"$exists": True, "$nin": [None, ""]}},
            {"msclkid": {"$exists": True, "$nin": [None, ""]}},
        ],
    })

    # Per-channel: how many paid sessions HAD this channel's click ID +
    # how many converted (logged ok) / errored.
    by_channel: list[dict] = []
    for ch, click_field in (("google", "gclid"), ("meta", "fbclid"), ("microsoft", "msclkid")):
        with_clickid = await db.payment_transactions.count_documents({
            **paid_query, click_field: {"$exists": True, "$nin": [None, ""]},
        })
        ok = await db.conversion_upload_log.count_documents({
            "channel": ch, "status": "ok",
            "uploaded_at": {"$gte": cutoff_iso},
        })
        errored = await db.conversion_upload_log.count_documents({
            "channel": ch, "status": {"$regex": "^err:"},
            "uploaded_at": {"$gte": cutoff_iso},
        })
        # "Pending" = had the click ID but no log row yet (webhook hasn't
        # processed). Useful early-warning if Stripe → checkout pipeline
        # is bottlenecked.
        pending = max(0, with_clickid - ok - errored)
        upload_rate = round(100.0 * ok / with_clickid, 1) if with_clickid > 0 else None
        by_channel.append({
            "channel": ch,
            "click_field": click_field,
            "paid_with_click_id": with_clickid,
            "uploaded_ok": ok,
            "uploaded_err": errored,
            "pending": pending,
            "upload_rate_pct": upload_rate,
        })

    # Replay backlog — distinct session_ids stuck in err: state.
    backlog_pipeline = [
        {"$match": {
            "status": {"$regex": "^err:"},
            "uploaded_at": {"$gte": cutoff_iso},
        }},
        {"$group": {"_id": "$session_id"}},
        {"$count": "n"},
    ]
    backlog = 0
    async for row in db.conversion_upload_log.aggregate(backlog_pipeline):
        backlog = int(row.get("n") or 0)

    return {
        "window_days": 7,
        "as_of": datetime.now(timezone.utc).isoformat(),
        "paid_sessions": paid_total,
        "sessions_with_click_id": with_any,
        "click_id_coverage_pct": (
            round(100.0 * with_any / paid_total, 1) if paid_total > 0 else None
        ),
        "by_channel": by_channel,
        "replay_backlog": backlog,
    }


# ── iter335.14: Phase 4 channel attribution weights ──────────────────
@router.get("/admin/ads/channel-weights")
async def channel_weights(_: dict = Depends(current_admin)):
    """Returns the most-recently-persisted per-channel attribution
    weights (Google / Meta / Microsoft) plus the raw orders / spend /
    ROAS that produced them. Allocator pulls these to recommend a
    default paid-channel split for makers running multi-channel."""
    from services import channel_attribution
    return await channel_attribution.get_persisted()


@router.post("/admin/ads/channel-weights/recompute")
async def channel_weights_recompute(_: dict = Depends(current_admin)):
    """Manual recompute trigger — same logic the daily cron runs.
    Useful right after a backfill to pull in fresh data."""
    from services import channel_attribution
    return await channel_attribution.recompute_and_persist()
