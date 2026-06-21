"""Admin growth stats — 24h / 7d deltas across opt-in lists.

Surfaces the daily/weekly heartbeat of new signups across:
  - update_subscribers  (the /updates digest list)
  - coming_soon_waitlist (per category — Neon & Light, Furniture)
  - restock_waitlist    (buyer demand for backordered products)
  - beta_feedback       (engagement signal — bug reports + ideas)

One read-only endpoint; the admin dashboard polls it on mount.
"""
from __future__ import annotations

from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends

from core import db
from maker_auth import current_admin

router = APIRouter()


def _iso_window(days: int) -> str:
    """ISO timestamp for "now minus N days" — used as the lower bound on
    `created_at` / `joined_at` lookups. Returns Z-suffix string so it
    compares lex-cleanly against our other ISO strings in MongoDB."""
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()


async def _delta(coll, ts_field: str, days: int, extra: dict | None = None) -> int:
    q: dict = {ts_field: {"$gte": _iso_window(days)}}
    if extra:
        q.update(extra)
    return await db[coll].count_documents(q)


@router.get("/admin/growth-stats")
async def admin_growth_stats(_: dict = Depends(current_admin)):
    """24h + 7d signup deltas + totals for opt-in lists.

    Response shape:
      {
        "as_of": ISO,
        "stats": [
          {"key": "update_subscribers", "label": "Update subs",
           "total": int, "d1": int, "d7": int},
          {"key": "coming_soon_neon",    "label": "Neon waitlist", ...},
          ...
        ]
      }
    """
    stats = []

    # /updates digest list
    sub_total = await db.update_subscribers.count_documents({"unsubscribed_at": None})
    stats.append({
        "key": "update_subscribers",
        "label": "Update subs",
        "total": sub_total,
        "d1": await _delta("update_subscribers", "subscribed_at", 1, {"unsubscribed_at": None}),
        "d7": await _delta("update_subscribers", "subscribed_at", 7, {"unsubscribed_at": None}),
    })

    # Coming-soon waitlists (per category)
    for cat_id, key, label in (
        ("Neon & Light", "coming_soon_neon", "Neon waitlist"),
        ("Furniture",     "coming_soon_furniture", "Furniture waitlist"),
    ):
        stats.append({
            "key": key,
            "label": label,
            "total": await db.coming_soon_waitlist.count_documents({"category": cat_id}),
            "d1": await _delta("coming_soon_waitlist", "joined_at", 1, {"category": cat_id}),
            "d7": await _delta("coming_soon_waitlist", "joined_at", 7, {"category": cat_id}),
        })

    # Restock waitlist (buyer demand for backordered products)
    stats.append({
        "key": "restock_waitlist",
        "label": "Restock signups",
        "total": await db.restock_waitlist.count_documents({"notified_at": None}),
        "d1": await _delta("restock_waitlist", "created_at", 1, {"notified_at": None}),
        "d7": await _delta("restock_waitlist", "created_at", 7, {"notified_at": None}),
    })

    # Beta feedback (engagement / bug-report velocity)
    stats.append({
        "key": "beta_feedback",
        "label": "Founding Access feedback",
        "total": await db.beta_feedback.count_documents({}),
        "d1": await _delta("beta_feedback", "created_at", 1),
        "d7": await _delta("beta_feedback", "created_at", 7),
    })

    return {
        "as_of": datetime.now(timezone.utc).isoformat(),
        "stats": stats,
    }
