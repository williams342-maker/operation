"""iter334l — Microsoft Ads ROAS admin tile.

Aggregates `payment_transactions` rows from the last N days where the
buyer landed via Bing Ads (carries a `msclkid` URL parameter that's
persisted at checkout). Pairs with an ops-entered ad spend value to
compute Return On Ad Spend (revenue / spend).

Endpoints
---------
GET  /api/admin/ads/msft-roas?days=7
  Returns:
    {
      days: 7,
      window_start: "...",
      attributed_orders: <int>,
      attributed_revenue: <float, USD>,
      ad_spend_usd: <float, last-known ops value or 0>,
      ad_spend_recorded_at: "..." | None,
      roas: <float or null when spend==0>,
      sample: [ {sid, msclkid, amount, created_at}, ... ]
    }

POST /api/admin/ads/msft-spend  { amount_usd, period_days=7 }
  Ops manually enters the last-window's Microsoft Ads spend (read off
  the Bing Ads UI). Stored in `ops_settings.bing_ad_spend` so the tile
  has both halves of the ROAS math without needing OAuth.
"""
from __future__ import annotations
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from core import db, now_iso
from maker_auth import current_admin

router = APIRouter()


@router.get("/admin/ads/msft-roas")
async def msft_roas(days: int = 7, _admin: dict = Depends(current_admin)):
    """Aggregate Bing-attributed paid revenue + the most recent ops-entered
    spend → ROAS. Read-only — purely a reporting endpoint."""
    days = max(1, min(90, int(days)))
    start = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    cursor = db.payment_transactions.find(
        {
            "msclkid": {"$exists": True, "$nin": [None, ""]},
            "payment_status": "paid",
            "created_at": {"$gte": start},
        },
        {"_id": 0, "session_id": 1, "msclkid": 1,
         "amount": 1, "currency": 1, "created_at": 1, "items": 1},
    ).sort([("created_at", -1)]).limit(1000)

    attributed_orders = 0
    attributed_revenue = 0.0
    sample = []
    async for tx in cursor:
        attributed_orders += 1
        attributed_revenue += float(tx.get("amount") or 0)
        if len(sample) < 10:
            sample.append({
                "session_id": tx.get("session_id"),
                "msclkid": (tx.get("msclkid") or "")[:24] + "…",  # masked for the UI
                "amount": float(tx.get("amount") or 0),
                "created_at": tx.get("created_at"),
                "item_count": len(tx.get("items") or []),
            })

    spend_doc = await db.ops_settings.find_one({"_id": "bing_ad_spend"}, {"_id": 0})
    ad_spend = float((spend_doc or {}).get("amount_usd") or 0)
    spend_recorded_at = (spend_doc or {}).get("recorded_at")
    roas = round(attributed_revenue / ad_spend, 2) if ad_spend > 0 else None

    return {
        "days": days,
        "window_start": start,
        "attributed_orders": attributed_orders,
        "attributed_revenue": round(attributed_revenue, 2),
        "ad_spend_usd": ad_spend,
        "ad_spend_recorded_at": spend_recorded_at,
        "roas": roas,
        "sample": sample,
    }


class _SpendReq(BaseModel):
    amount_usd: float = Field(..., ge=0, le=1_000_000)
    period_days: int = Field(7, ge=1, le=90)
    note: str | None = Field(None, max_length=200)


@router.post("/admin/ads/msft-spend")
async def msft_spend_record(
    body: _SpendReq, _admin: dict = Depends(current_admin),
):
    """Persist the most recent Bing Ads spend entered by ops. Overwrites
    any prior value — we want the LATEST reading, not a history."""
    try:
        await db.ops_settings.replace_one(
            {"_id": "bing_ad_spend"},
            {
                "_id": "bing_ad_spend",
                "amount_usd": float(body.amount_usd),
                "period_days": int(body.period_days),
                "note": (body.note or "").strip() or None,
                "recorded_at": now_iso(),
            },
            upsert=True,
        )
    except Exception as e:
        raise HTTPException(500, f"Failed to record spend: {e}")
    return {"ok": True, "amount_usd": float(body.amount_usd), "recorded_at": now_iso()}
