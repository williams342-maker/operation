"""iter334x — Meta Ads ROAS admin tile.

Mirror of `admin_google_roas.py` for Meta. Uses LIVE ad-spend data from
the synced `ad_spend` collection (populated by `routers/meta_ads.py`
daily cron) and revenue attributed via the `fbclid` URL parameter.

Endpoint
--------
GET /api/admin/ads/meta-roas?days=7
  Returns same shape as the Google variant — `attributed_orders`,
  `attributed_revenue`, `ad_spend_usd`, `ad_spend_days_with_data`,
  `roas`, `sample[]`, `top_campaigns[]`.
"""
from __future__ import annotations
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends

from core import db
from maker_auth import current_admin

router = APIRouter()


@router.get("/admin/ads/meta-roas")
async def meta_roas(days: int = 7, _admin: dict = Depends(current_admin)):
    """Aggregate Meta-attributed paid revenue + Meta Ads spend from
    `ad_spend` rows → ROAS. Read-only reporting endpoint."""
    days = max(1, min(90, int(days)))
    now = datetime.now(timezone.utc)
    start_dt = now - timedelta(days=days)
    start_iso = start_dt.isoformat()
    start_date = start_dt.strftime("%Y-%m-%d")
    end_date = now.strftime("%Y-%m-%d")

    # ─── Attributed revenue: txns w/ fbclid + paid + within window ──
    cursor = db.payment_transactions.find(
        {
            "fbclid": {"$exists": True, "$nin": [None, ""]},
            "payment_status": "paid",
            "created_at": {"$gte": start_iso},
        },
        {"_id": 0, "session_id": 1, "fbclid": 1, "amount": 1,
         "currency": 1, "created_at": 1, "items": 1},
    ).sort([("created_at", -1)]).limit(1000)

    attributed_orders = 0
    attributed_revenue = 0.0
    sample = []
    async for tx in cursor:
        attributed_orders += 1
        attributed_revenue += float(tx.get("amount") or 0)
        if len(sample) < 10:
            fid = tx.get("fbclid") or ""
            sample.append({
                "session_id": tx.get("session_id"),
                # Masked — fbclids embed user-identifiable session data.
                "fbclid": (fid[:24] + "…") if len(fid) > 24 else fid,
                "amount": float(tx.get("amount") or 0),
                "created_at": tx.get("created_at"),
                "item_count": len(tx.get("items") or []),
            })

    # ─── Ad spend: sum `ad_spend.spend_usd` for platform=meta in window ──
    spend_cursor = db.ad_spend.find(
        {
            "platform": "meta",
            "date": {"$gte": start_date, "$lte": end_date},
        },
        {"_id": 0, "campaign_name": 1, "date": 1, "spend_usd": 1,
         "clicks": 1, "impressions": 1, "conversions": 1},
    )

    total_spend = 0.0
    days_with_data: set[str] = set()
    by_campaign: dict[str, dict] = {}
    async for r in spend_cursor:
        spend = float(r.get("spend_usd") or 0)
        total_spend += spend
        if r.get("date"):
            days_with_data.add(r["date"])
        name = r.get("campaign_name") or "—"
        if name not in by_campaign:
            by_campaign[name] = {
                "name": name, "spend": 0.0, "clicks": 0,
                "impressions": 0, "conversions": 0,
            }
        by_campaign[name]["spend"] += spend
        by_campaign[name]["clicks"] += int(r.get("clicks") or 0)
        by_campaign[name]["impressions"] += int(r.get("impressions") or 0)
        by_campaign[name]["conversions"] += int(r.get("conversions") or 0)

    top_campaigns = sorted(
        ({**c, "spend": round(c["spend"], 2)} for c in by_campaign.values()),
        key=lambda c: c["spend"],
        reverse=True,
    )[:5]

    roas = round(attributed_revenue / total_spend, 2) if total_spend > 0 else None

    return {
        "days": days,
        "window_start": start_date,
        "window_end": end_date,
        "attributed_orders": attributed_orders,
        "attributed_revenue": round(attributed_revenue, 2),
        "ad_spend_usd": round(total_spend, 2),
        "ad_spend_days_with_data": len(days_with_data),
        "roas": roas,
        "sample": sample,
        "top_campaigns": top_campaigns,
    }
