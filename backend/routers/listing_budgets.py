"""
iter315 — Per-listing marketing budgets (Option A).

Lets makers set a monthly $-cap per listing. A daily scheduler tick
auto-renews the existing $5/wk boost as long as the listing has budget
remaining for the calendar month. Resets MTD spend on the 1st.

Why this instead of External Google/Meta budgets?
- Reuses the existing on-site boost machinery (no Google Ads API write
  access needed — that's blocked on brand verification right now).
- Same per-listing budget concept can later layer onto a Stripe-wallet
  external-ads model (Option C) without rewriting this router.

Data model (`db.maker_listing_budgets`):
    {
        "maker_slug": str,
        "product_slug": str,
        "monthly_cap_cents": int,        # 0 = paused
        "auto_renew": bool,              # if false, cap is just a tracker
        "spent_cents": int,              # MTD
        "period_start": "YYYY-MM-01",    # rolled by the cron
        "last_renewed_at": iso str | None,
        "created_at": iso str,
        "updated_at": iso str,
    }

Compound unique index: (maker_slug, product_slug).
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from core import db, now_iso
from maker_auth import current_maker_slug

router = APIRouter()
log = logging.getLogger("crafters.listing_budgets")

PROMOTION_WEEKLY_FEE_CENTS = 500  # mirrors revenue.py — keeps router self-contained


def _month_key(dt: Optional[datetime] = None) -> str:
    """`YYYY-MM-01` string used as the budget period anchor.

    Stored on every row so a renew tick can detect "new month → reset"
    in O(1) without a separate cron job.
    """
    dt = dt or datetime.now(timezone.utc)
    return dt.strftime("%Y-%m-01")


# ─── Models ──────────────────────────────────────────────────────────

class ListingBudgetIn(BaseModel):
    monthly_cap_cents: int = Field(..., ge=0, le=1_000_00)  # max $1000/mo per listing
    auto_renew: bool = True


class ListingBudgetOut(BaseModel):
    maker_slug: str
    product_slug: str
    monthly_cap_cents: int
    auto_renew: bool
    spent_cents: int
    period_start: str
    last_renewed_at: Optional[str] = None
    # Decorated for the UI — not stored in Mongo:
    product_title: Optional[str] = None
    promoted_until: Optional[str] = None
    impressions_mtd: Optional[int] = None
    conversions_mtd: Optional[int] = None


# ─── Maker endpoints ─────────────────────────────────────────────────

@router.get("/maker/listing-budgets")
async def maker_list_budgets(slug: str = Depends(current_maker_slug)):
    """All budgets for the caller. Decorates with current listing
    title + promoted_until + MTD impressions/conversions so the UI can
    render a single table without N+1 lookups."""
    period = _month_key()
    rows = await db.maker_listing_budgets.find(
        {"maker_slug": slug},
        {"_id": 0},
    ).sort("product_slug", 1).to_list(500)

    # Drop stale-period rows down to a fresh "$0 spent this month" view
    # without a database write. The scheduler tick will persist the
    # reset; reads stay correct in the meantime.
    for r in rows:
        if r.get("period_start") != period:
            r["spent_cents"] = 0
            r["period_start"] = period

    if not rows:
        return {"budgets": [], "period_start": period,
                "promotion_weekly_fee_cents": PROMOTION_WEEKLY_FEE_CENTS}

    # Batch-load the product titles + promoted_until in ONE query.
    slugs = [r["product_slug"] for r in rows]
    prods = await db.products.find(
        {"slug": {"$in": slugs}, "maker_slug": slug},
        {"_id": 0, "slug": 1, "title": 1, "promoted_until": 1},
    ).to_list(len(slugs))
    by_slug = {p["slug"]: p for p in prods}

    # MTD impressions + conversions — single aggregation each.
    month_start_iso = datetime.now(timezone.utc).replace(
        day=1, hour=0, minute=0, second=0, microsecond=0
    ).isoformat()
    impressions = {
        d["_id"]: d["count"]
        async for d in db.events.aggregate([
            {"$match": {
                "type": "product_view",
                "product_slug": {"$in": slugs},
                "created_at": {"$gte": month_start_iso},
            }},
            {"$group": {"_id": "$product_slug", "count": {"$sum": 1}}},
        ])
    }
    conversions = {
        d["_id"]: d["count"]
        async for d in db.events.aggregate([
            {"$match": {
                "type": "product_buy",
                "product_slug": {"$in": slugs},
                "created_at": {"$gte": month_start_iso},
            }},
            {"$group": {"_id": "$product_slug", "count": {"$sum": 1}}},
        ])
    }

    for r in rows:
        p = by_slug.get(r["product_slug"], {})
        r["product_title"] = p.get("title")
        r["promoted_until"] = p.get("promoted_until")
        r["impressions_mtd"] = impressions.get(r["product_slug"], 0)
        r["conversions_mtd"] = conversions.get(r["product_slug"], 0)

    total_cap = sum(r["monthly_cap_cents"] for r in rows)
    total_spent = sum(r["spent_cents"] for r in rows)
    return {
        "budgets": rows,
        "period_start": period,
        "promotion_weekly_fee_cents": PROMOTION_WEEKLY_FEE_CENTS,
        "total_monthly_cap_cents": total_cap,
        "total_spent_cents": total_spent,
    }


@router.put("/maker/listing-budgets/{product_slug}", response_model=ListingBudgetOut)
async def maker_upsert_budget(
    product_slug: str,
    body: ListingBudgetIn,
    slug: str = Depends(current_maker_slug),
):
    """Create or update a per-listing budget. Owner-gated — the caller
    must own the product. `monthly_cap_cents=0` is a valid pause state
    (keeps the row for history/spend display but disables auto-renew)."""
    prod = await db.products.find_one(
        {"slug": product_slug, "maker_slug": slug, "deleted_at": {"$in": [None, ""]}},
        {"_id": 0, "slug": 1, "status": 1},
    )
    if not prod:
        raise HTTPException(404, "Product not found or not yours.")
    if prod.get("status") != "published":
        raise HTTPException(400, "Only published listings can have budgets.")

    now = now_iso()
    period = _month_key()
    update_doc = {
        "$set": {
            "monthly_cap_cents": body.monthly_cap_cents,
            "auto_renew": body.auto_renew if body.monthly_cap_cents > 0 else False,
            "updated_at": now,
        },
        "$setOnInsert": {
            "maker_slug": slug,
            "product_slug": product_slug,
            "spent_cents": 0,
            "period_start": period,
            "last_renewed_at": None,
            "created_at": now,
        },
    }
    await db.maker_listing_budgets.update_one(
        {"maker_slug": slug, "product_slug": product_slug},
        update_doc,
        upsert=True,
    )
    saved = await db.maker_listing_budgets.find_one(
        {"maker_slug": slug, "product_slug": product_slug}, {"_id": 0},
    )
    return saved


@router.delete("/maker/listing-budgets/{product_slug}")
async def maker_delete_budget(
    product_slug: str,
    slug: str = Depends(current_maker_slug),
):
    r = await db.maker_listing_budgets.delete_one(
        {"maker_slug": slug, "product_slug": product_slug},
    )
    return {"deleted": r.deleted_count}


# ─── Scheduler tick (called from scheduler.py daily 03:30 UTC) ───────

async def renew_listing_budgets_tick() -> dict:
    """Daily cron entrypoint. Two passes:

    1. **Period roll** — any row whose `period_start` != current month
       gets `spent_cents` reset to 0 and `period_start` updated. No
       charges yet.
    2. **Auto-renew** — for each row with `auto_renew=True` AND
       `spent_cents + PROMOTION_WEEKLY_FEE_CENTS <= monthly_cap_cents`,
       check whether the listing's `promoted_until` is within 24h. If
       so, accrue another $5 week of promotion and bump it forward.

    The 24h-window check is what keeps us at ≤1 charge per week per
    listing even though this tick runs daily.
    """
    period = _month_key()
    now = datetime.now(timezone.utc)
    now_iso_str = now.isoformat()
    renew_window_iso = (now.replace(microsecond=0)).isoformat()

    # Pass 1: period roll. Done in one query.
    rolled = await db.maker_listing_budgets.update_many(
        {"period_start": {"$ne": period}},
        {"$set": {"spent_cents": 0, "period_start": period, "last_renewed_at": None}},
    )

    # Pass 2: walk auto-renew candidates one-by-one (we need to call
    # the accrue helper + product update per-row).
    candidates = await db.maker_listing_budgets.find(
        {
            "auto_renew": True,
            "monthly_cap_cents": {"$gte": PROMOTION_WEEKLY_FEE_CENTS},
        },
        {"_id": 0},
    ).to_list(5000)

    renewed = 0
    skipped_capped = 0
    skipped_active = 0
    errors = 0
    from revenue import accrue_promotion_charge, promotion_until_iso

    for r in candidates:
        # Budget headroom check (cents).
        if r["spent_cents"] + PROMOTION_WEEKLY_FEE_CENTS > r["monthly_cap_cents"]:
            skipped_capped += 1
            continue

        prod = await db.products.find_one(
            {"slug": r["product_slug"], "maker_slug": r["maker_slug"]},
            {"_id": 0, "slug": 1, "promoted_until": 1, "status": 1, "deleted_at": 1},
        )
        if not prod or prod.get("status") != "published" or prod.get("deleted_at"):
            continue

        # Skip if listing is still promoted for > 24h. Renew only when
        # the existing promotion is about to lapse (≤24h remaining) or
        # not promoted at all. Keeps us to one charge/wk regardless of
        # cron frequency.
        promo_until = prod.get("promoted_until")
        if promo_until and promo_until > renew_window_iso:
            from datetime import timedelta
            if (datetime.fromisoformat(promo_until.replace("Z", "+00:00"))
                    - now) > timedelta(hours=24):
                skipped_active += 1
                continue

        try:
            await accrue_promotion_charge(r["maker_slug"], r["product_slug"], weeks=1)
            await db.products.update_one(
                {"slug": r["product_slug"]},
                {"$set": {"promoted_until": promotion_until_iso(1)}},
            )
            await db.maker_listing_budgets.update_one(
                {"maker_slug": r["maker_slug"], "product_slug": r["product_slug"]},
                {"$inc": {"spent_cents": PROMOTION_WEEKLY_FEE_CENTS},
                 "$set": {"last_renewed_at": now_iso_str}},
            )
            renewed += 1
        except Exception as e:
            log.exception("[listing_budgets] auto-renew %s/%s failed: %s",
                          r["maker_slug"], r["product_slug"], e)
            errors += 1

    return {
        "rolled_periods": rolled.modified_count,
        "candidates": len(candidates),
        "renewed": renewed,
        "skipped_capped": skipped_capped,
        "skipped_active": skipped_active,
        "errors": errors,
    }
