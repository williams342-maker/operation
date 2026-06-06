"""iter334v — Combined "All Ads ROAS" admin tile.

Sums attributed revenue + ad spend across Microsoft (msclkid + ops-entered
spend) and Google (gclid + synced ad_spend) into a single all-paid-channel
ROAS number. Sits at the top of the Analytics tab above the individual
platform cards.

Endpoint
--------
GET /api/admin/ads/all-roas?days=7
  Returns:
    {
      days: 7,
      window_start: "...",
      total_attributed_orders: <int>,
      total_attributed_revenue: <float, USD>,
      total_ad_spend_usd: <float, USD>,
      roas: <float or null when spend==0>,
      breakdown: [
        { platform: "microsoft", orders, revenue, spend, roas },
        { platform: "google",    orders, revenue, spend, roas },
      ]
    }
"""
from __future__ import annotations
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends

from core import db
from maker_auth import current_admin

router = APIRouter()


async def _platform_aggregate(platform: str, days: int, start_iso: str,
                              start_date: str, end_date: str) -> dict:
    """Return {orders, revenue, spend} for one platform.

    - `microsoft` reads revenue from txns w/ msclkid, spend from
      `ops_settings.bing_ad_spend` (ops-entered).
    - `google` reads revenue from txns w/ gclid, spend from `ad_spend`
      rows (synced).
    """
    if platform == "microsoft":
        click_field = "msclkid"
        spend_doc = await db.ops_settings.find_one({"_id": "bing_ad_spend"}, {"_id": 0})
        spend = float((spend_doc or {}).get("amount_usd") or 0)
    else:  # google
        click_field = "gclid"
        # Sum platform=google ad_spend rows in the date window.
        pipeline = [
            {"$match": {
                "platform": "google",
                "date": {"$gte": start_date, "$lte": end_date},
            }},
            {"$group": {"_id": None, "total": {"$sum": "$spend_usd"}}},
        ]
        agg = await db.ad_spend.aggregate(pipeline).to_list(length=1)
        spend = float(agg[0]["total"]) if agg else 0.0

    cursor = db.payment_transactions.find(
        {
            click_field: {"$exists": True, "$nin": [None, ""]},
            "payment_status": "paid",
            "created_at": {"$gte": start_iso},
        },
        {"_id": 0, "amount": 1},
    )
    orders = 0
    revenue = 0.0
    async for tx in cursor:
        orders += 1
        revenue += float(tx.get("amount") or 0)

    return {
        "platform": platform,
        "orders": orders,
        "revenue": round(revenue, 2),
        "spend": round(spend, 2),
        "roas": round(revenue / spend, 2) if spend > 0 else None,
    }


@router.get("/admin/ads/all-roas")
async def all_roas(days: int = 7, _admin: dict = Depends(current_admin)):
    """Combined Microsoft + Google paid-channel ROAS."""
    days = max(1, min(90, int(days)))
    now = datetime.now(timezone.utc)
    start_dt = now - timedelta(days=days)
    start_iso = start_dt.isoformat()
    start_date = start_dt.strftime("%Y-%m-%d")
    end_date = now.strftime("%Y-%m-%d")

    ms = await _platform_aggregate("microsoft", days, start_iso, start_date, end_date)
    gg = await _platform_aggregate("google", days, start_iso, start_date, end_date)

    total_orders = ms["orders"] + gg["orders"]
    total_revenue = round(ms["revenue"] + gg["revenue"], 2)
    total_spend = round(ms["spend"] + gg["spend"], 2)
    roas = round(total_revenue / total_spend, 2) if total_spend > 0 else None

    return {
        "days": days,
        "window_start": start_date,
        "total_attributed_orders": total_orders,
        "total_attributed_revenue": total_revenue,
        "total_ad_spend_usd": total_spend,
        "roas": roas,
        "breakdown": [ms, gg],
    }
