"""Off-site ad spend reporting (platform-agnostic foundation).

Schema (`db.ad_spend`):
  {
    id: uuid,
    platform: "google" | "meta",
    campaign_id: str,
    campaign_name: str,
    category: str | null,           # marketplace category bucket (PLASMA/LASER/...)
    date: "YYYY-MM-DD",             # daily-rollup
    spend_usd: float,
    impressions: int,
    clicks: int,
    conversions: int,               # platform-reported (often noisy)
    created_at: ISO,
    updated_at: ISO,
  }
  unique index: (platform, campaign_id, date)

ROAS = attributed_revenue / spend
where attributed_revenue is computed from `transactions` with
`external_attribution=true` between the same date range.
"""
from __future__ import annotations

import random
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from core import db, logger, now_iso
from maker_auth import current_admin

router = APIRouter()


# ---------------- Repo helpers ----------------
async def upsert_spend(row: dict) -> None:
    """Idempotent upsert keyed on (platform, campaign_id, date)."""
    await db.ad_spend.update_one(
        {
            "platform": row["platform"],
            "campaign_id": row["campaign_id"],
            "date": row["date"],
        },
        {
            "$set": {
                **row,
                "updated_at": now_iso(),
            },
            "$setOnInsert": {
                "id": str(uuid.uuid4()),
                "created_at": now_iso(),
            },
        },
        upsert=True,
    )


async def _attributed_revenue(start_iso: str, end_iso: str) -> float:
    """Sum of paid transactions with external_attribution=true between dates.

    `external_attribution` is set by checkout.py when ?utm_source=external is
    on the buyer's referrer — see /app/backend/models.py:104.
    """
    cursor = db.transactions.find(
        {
            "external_attribution": True,
            "status": "paid",
            "created_at": {"$gte": start_iso, "$lt": end_iso},
        },
        {"_id": 0, "amount": 1},
    )
    total = 0.0
    async for t in cursor:
        total += float(t.get("amount", 0))
    return round(total, 2)


# ---------------- Public-shape models ----------------
class MetricsSummary(BaseModel):
    spend: float
    impressions: int
    clicks: int
    conversions: int
    attributed_revenue: float
    roas: float
    days: int


# ---------------- Admin endpoints ----------------
@router.get("/admin/ads/metrics", response_model=MetricsSummary)
async def admin_ads_metrics(
    days: int = Query(30, ge=1, le=365),
    platform: Optional[str] = Query(None, regex="^(google|meta)$"),
    _: dict = Depends(current_admin),
):
    """Aggregate spend metrics for the last N days, optionally per-platform."""
    end_dt = datetime.now(timezone.utc)
    start_dt = end_dt - timedelta(days=days)
    start_iso = start_dt.date().isoformat()

    flt: dict = {"date": {"$gte": start_iso}}
    if platform:
        flt["platform"] = platform

    spend = impressions = clicks = conversions = 0.0
    cursor = db.ad_spend.find(flt, {"_id": 0})
    async for r in cursor:
        spend += float(r.get("spend_usd", 0))
        impressions += int(r.get("impressions", 0) or 0)
        clicks += int(r.get("clicks", 0) or 0)
        conversions += int(r.get("conversions", 0) or 0)

    rev = await _attributed_revenue(start_dt.isoformat(), end_dt.isoformat())
    roas = round(rev / spend, 2) if spend > 0 else 0.0

    return MetricsSummary(
        spend=round(spend, 2),
        impressions=int(impressions),
        clicks=int(clicks),
        conversions=int(conversions),
        attributed_revenue=rev,
        roas=roas,
        days=days,
    )


@router.get("/admin/ads/performance")
async def admin_ads_performance(
    days: int = Query(30, ge=1, le=365),
    _: dict = Depends(current_admin),
):
    """Return per-campaign + per-category breakdowns + a daily spend timeseries."""
    end_dt = datetime.now(timezone.utc)
    start_dt = end_dt - timedelta(days=days)
    start_iso = start_dt.date().isoformat()

    cursor = db.ad_spend.find({"date": {"$gte": start_iso}}, {"_id": 0})
    by_campaign: dict[tuple, dict] = {}
    by_category: dict[str, dict] = {}
    daily: dict[str, float] = {}
    async for r in cursor:
        cid = (r.get("platform"), r.get("campaign_id"))
        c = by_campaign.setdefault(cid, {
            "platform": r.get("platform"),
            "campaign_id": r.get("campaign_id"),
            "campaign_name": r.get("campaign_name"),
            "category": r.get("category"),
            "spend": 0.0, "impressions": 0, "clicks": 0, "conversions": 0,
        })
        c["spend"] += float(r.get("spend_usd", 0))
        c["impressions"] += int(r.get("impressions", 0) or 0)
        c["clicks"] += int(r.get("clicks", 0) or 0)
        c["conversions"] += int(r.get("conversions", 0) or 0)

        cat = r.get("category") or "uncategorized"
        cb = by_category.setdefault(cat, {"category": cat, "spend": 0.0, "clicks": 0})
        cb["spend"] += float(r.get("spend_usd", 0))
        cb["clicks"] += int(r.get("clicks", 0) or 0)

        d = r.get("date")
        if d:
            daily[d] = daily.get(d, 0.0) + float(r.get("spend_usd", 0))

    # Order campaigns by spend desc; round + add CTR.
    campaigns = []
    for c in by_campaign.values():
        c["spend"] = round(c["spend"], 2)
        c["ctr"] = round((c["clicks"] / c["impressions"]) * 100, 2) if c["impressions"] else 0.0
        c["cpc"] = round(c["spend"] / c["clicks"], 2) if c["clicks"] else 0.0
        campaigns.append(c)
    campaigns.sort(key=lambda x: -x["spend"])

    cats = sorted(
        ({"category": k, "spend": round(v["spend"], 2), "clicks": v["clicks"]}
         for k, v in by_category.items()),
        key=lambda x: -x["spend"],
    )

    series = []
    cursor_date = start_dt.date()
    end_date = end_dt.date()
    while cursor_date <= end_date:
        s = cursor_date.isoformat()
        series.append({"date": s, "spend": round(daily.get(s, 0.0), 2)})
        cursor_date += timedelta(days=1)

    return {
        "days": days,
        "campaigns": campaigns[:50],
        "categories": cats,
        "daily": series,
    }


@router.post("/admin/ads/seed-demo")
async def admin_seed_demo(
    days: int = Query(14, ge=1, le=90),
    claims: dict = Depends(current_admin),
):
    """Generates synthetic ad-spend data so the admin Ads tab has something
    to render before live API credentials arrive. Idempotent — clears the
    last `days` of demo rows before re-seeding."""
    rng = random.Random(20260426)
    today = date.today()
    cutoff_iso = (today - timedelta(days=days)).isoformat()
    await db.ad_spend.delete_many({
        "campaign_id": {"$regex": "^demo-"},
        "date": {"$gte": cutoff_iso},
    })
    campaigns = [
        ("google", "demo-pmax-plasma", "Performance Max · Plasma", "PLASMA", 7.50, 0.012),
        ("google", "demo-pmax-laser", "Performance Max · Laser", "LASER", 5.20, 0.018),
        ("google", "demo-search-makers", "Search · Custom Makers", None, 3.40, 0.022),
        ("meta", "demo-adv-shopping", "Advantage+ Shopping", None, 6.80, 0.014),
        ("meta", "demo-retargeting", "Retargeting · Cart Abandoners", None, 2.10, 0.030),
    ]
    rows = 0
    for d in range(days):
        day_iso = (today - timedelta(days=d)).isoformat()
        for platform, cid, name, cat, base_spend, ctr in campaigns:
            jitter = rng.uniform(0.6, 1.4)
            spend = round(base_spend * jitter, 2)
            impressions = int(spend * rng.uniform(140, 220))
            clicks = max(1, int(impressions * (ctr * rng.uniform(0.7, 1.3))))
            conv = int(clicks * rng.uniform(0.01, 0.05))
            await upsert_spend({
                "platform": platform,
                "campaign_id": cid,
                "campaign_name": name,
                "category": cat,
                "date": day_iso,
                "spend_usd": spend,
                "impressions": impressions,
                "clicks": clicks,
                "conversions": conv,
            })
            rows += 1
    logger.info("[ads] %s seeded %d demo rows over %d days", claims["email"], rows, days)
    return {"rows": rows, "days": days, "campaigns": len(campaigns)}


@router.delete("/admin/ads/clear-demo")
async def admin_clear_demo(_: dict = Depends(current_admin)):
    """Wipe all rows whose campaign_id starts with 'demo-'. Use this once your
    real Google Ads / Meta data is flowing so the dashboard isn't double-counting."""
    r = await db.ad_spend.delete_many({"campaign_id": {"$regex": "^demo-"}})
    return {"deleted": r.deleted_count}
