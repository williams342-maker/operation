"""Restock weekly digest — Sundays 09:00 UTC.

For every maker with at least one open restock waitlist entry, sends a
single summary email listing all their backordered products + waitlist
counts so they know what to prioritize. Idempotent per week: subsequent
runs in the same ISO week are no-ops. State doc:
`system_state.maker_restock_digest`.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from core import db, logger, now_iso

STATE_KEY = "maker_restock_digest"


async def _state() -> dict:
    return await db.system_state.find_one({"key": STATE_KEY}, {"_id": 0}) or {}


async def _set_state(iso_week: str) -> None:
    await db.system_state.update_one(
        {"key": STATE_KEY},
        {"$set": {"key": STATE_KEY, "last_dispatched_week": iso_week, "last_dispatched_at": now_iso()}},
        upsert=True,
    )


def _current_iso_week() -> str:
    """e.g. '2026-W18' — week-anchored idempotency key."""
    now = datetime.now(timezone.utc)
    iso_year, iso_week, _ = now.isocalendar()
    return f"{iso_year}-W{iso_week:02d}"


async def _per_maker_summary() -> list[dict]:
    """Aggregate open waitlist entries grouped by maker."""
    pipeline = [
        {"$match": {"notified_at": None}},
        {"$group": {
            "_id": {"maker_slug": "$maker_slug",
                    "product_id": "$product_id",
                    "product_slug": "$product_slug",
                    "product_title": "$product_title"},
            "count": {"$sum": 1},
            "latest": {"$max": "$created_at"},
        }},
        {"$sort": {"count": -1}},
    ]
    rows = await db.restock_waitlist.aggregate(pipeline).to_list(5000)
    by_maker: dict[str, list[dict]] = {}
    for r in rows:
        slug = r["_id"]["maker_slug"]
        by_maker.setdefault(slug, []).append({
            "product_id": r["_id"]["product_id"],
            "product_slug": r["_id"]["product_slug"],
            "product_title": r["_id"]["product_title"],
            "count": int(r["count"]),
            "latest_signup_at": r.get("latest"),
        })
    summaries = []
    for slug, items in by_maker.items():
        m = await db.makers.find_one(
            {"slug": slug},
            {"_id": 0, "email": 1, "name": 1, "restock_digest_opt_out": 1},
        )
        if not m or not m.get("email"):
            continue
        # iter113 — respect maker-side opt-out from the weekly digest.
        # Default is opted-in (field absent or False).
        if m.get("restock_digest_opt_out"):
            logger.info("[maker_restock_digest] skipping %s (opted out)", slug)
            continue
        summaries.append({
            "maker_slug": slug, "maker_name": m.get("name") or slug,
            "maker_email": m["email"],
            "products": items,
            "total_pending": sum(i["count"] for i in items),
        })
    return summaries


async def run_weekly_restock_digest(*, force: bool = False, dry_run: bool = False,
                                    trigger: str = "cron") -> dict:
    """Send one digest email per maker with open waitlist entries.

    Idempotent: skips if `last_dispatched_week == current_iso_week` unless
    `force=True`. Returns a summary suitable for the cron log.
    """
    week = _current_iso_week()
    state = await _state()
    if not force and state.get("last_dispatched_week") == week:
        return {"ran": True, "skipped": "already_dispatched_this_week",
                "week": week, "makers_notified": 0}

    summaries = await _per_maker_summary()
    if not summaries:
        if not dry_run:
            await _set_state(week)
        return {"ran": True, "week": week, "makers_notified": 0,
                "reason": "no_open_waitlists"}

    notified = 0
    failed = 0
    if not dry_run:
        from email_service import send_maker_restock_digest
        for s in summaries:
            try:
                await send_maker_restock_digest(
                    email=s["maker_email"], name=s["maker_name"],
                    products=s["products"], total_pending=s["total_pending"],
                )
                notified += 1
            except Exception:
                failed += 1
                logger.exception("[maker_restock_digest] send failed for %s", s["maker_email"])
        await _set_state(week)

    logger.info(
        "[maker_restock_digest] week=%s makers=%d notified=%d failed=%d trigger=%s",
        week, len(summaries), notified, failed, trigger,
    )
    return {
        "ran": True,
        "week": week,
        "makers_eligible": len(summaries),
        "makers_notified": notified,
        "failed": failed,
        "dry_run": dry_run,
        "trigger": trigger,
    }
