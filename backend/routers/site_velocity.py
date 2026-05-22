"""Public marketplace velocity stats (iter177).

Powers the homepage "velocity proof" strip. Every number here answers a
buyer's #1 unconscious question — *"is this marketplace alive?"* — with
concrete, recent data pulled from collections the system already
maintains. No new instrumentation required.

Endpoint:
    GET /api/site/velocity   (public, no auth)

Returns:
    {
      "orders_this_week": int,         # paid transactions, last 7 days
      "makers_active_this_week": int,  # makers who shipped OR created
                                       # a product in the last 7 days
      "avg_ship_days": float | null,   # rolling-30d median order→ship
      "custom_orders_this_month": int, # accepted custom orders, last 30d
      "total_makers": int,             # all-time approved makers
      "as_of": str,                    # iso timestamp
    }
"""
from __future__ import annotations
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter

from core import db, now_iso

router = APIRouter()


def _iso_days_ago(days: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()


@router.get("/site/velocity")
async def site_velocity():
    cutoff_7d = _iso_days_ago(7)
    cutoff_30d = _iso_days_ago(30)

    # 1) Paid orders in the last 7 days. We count distinct transaction
    #    docs with `payment_status="paid"`, NOT individual line items.
    orders_this_week = await db.transactions.count_documents({
        "payment_status": "paid",
        "created_at": {"$gte": cutoff_7d},
    })

    # 2) Active makers — anyone who fulfilled a line item OR created a
    #    product in the last 7 days. UNION on slug, no double-count.
    active_slugs: set[str] = set()
    async for row in db.transactions.aggregate([
        {"$match": {"payment_status": "paid", "created_at": {"$gte": cutoff_7d}}},
        {"$unwind": "$items"},
        {"$group": {"_id": "$items.maker_slug"}},
    ]):
        if row["_id"]:
            active_slugs.add(row["_id"])
    async for row in db.products.aggregate([
        {"$match": {"created_at": {"$gte": cutoff_7d}, "is_draft": {"$ne": True}}},
        {"$group": {"_id": "$maker_slug"}},
    ]):
        if row["_id"]:
            active_slugs.add(row["_id"])
    makers_active_this_week = len(active_slugs)

    # 3) Avg ship days — median of (shipped_at - created_at) over the
    #    last 30 days of paid+shipped orders. Median because mean is
    #    skewed by occasional 60-day custom-commission outliers.
    ship_deltas: list[float] = []
    async for tx in db.transactions.find(
        {
            "payment_status": "paid",
            "shipped_at": {"$ne": None, "$exists": True},
            "created_at": {"$gte": cutoff_30d},
        },
        {"_id": 0, "created_at": 1, "shipped_at": 1},
    ):
        try:
            t0 = datetime.fromisoformat(tx["created_at"].replace("Z", "+00:00"))
            t1 = datetime.fromisoformat(tx["shipped_at"].replace("Z", "+00:00"))
            delta = (t1 - t0).total_seconds() / 86400
            if delta >= 0:
                ship_deltas.append(delta)
        except (ValueError, AttributeError, TypeError):
            continue
    avg_ship_days = None
    if ship_deltas:
        ship_deltas.sort()
        m = len(ship_deltas) // 2
        avg_ship_days = round(
            (ship_deltas[m] if len(ship_deltas) % 2 else (ship_deltas[m - 1] + ship_deltas[m]) / 2),
            1,
        )

    # 4) Custom orders accepted (or completed) in the last 30 days.
    #    `custom_orders` doc has `status` field. Accept everything past
    #    "pending" — i.e. the maker has engaged.
    custom_orders_this_month = await db.custom_orders.count_documents({
        "created_at": {"$gte": cutoff_30d},
        "status": {"$in": ["accepted", "in_progress", "completed", "shipped"]},
    })

    # 5) Total approved makers (denominator for "X% active this week"
    #    if the frontend wants it later).
    total_makers = await db.makers.count_documents({
        "is_approved": {"$ne": False},
    })

    return {
        "orders_this_week": int(orders_this_week),
        "makers_active_this_week": int(makers_active_this_week),
        "avg_ship_days": avg_ship_days,
        "custom_orders_this_month": int(custom_orders_this_month),
        "total_makers": int(total_makers),
        "as_of": now_iso(),
    }
