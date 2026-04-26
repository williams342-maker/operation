"""Etsy-style revenue ledger helpers.

Three streams handled here:
  1. Listing fees — first 10 listings per maker are free, then $0.20 per
     publish/renew. Accrued to `maker.pending_charges_cents`, debited from the
     next Stripe Connect payout.
  2. Listing expiry — published listings expire `LISTING_EXPIRY_DAYS` after
     publish; on expiry, status auto-flips to draft. Renewing re-publishes for
     another period and accrues another listing fee (if past the free quota).
  3. Promoted listings — flat $5/week pin via `promoted_until`. Charge accrues
     immediately to `pending_charges_cents`.

Transaction-fee math (commission + processing) lives in
`routers.stripe_connect.fee_breakdown_cents`.
"""
from __future__ import annotations
import os
from datetime import datetime, timedelta, timezone

from core import db, now_iso

LISTING_FEE_CENTS = int(os.environ.get("LISTING_FEE_CENTS", "20"))
LISTING_FREE_QUOTA = int(os.environ.get("LISTING_FREE_QUOTA", "10"))
LISTING_EXPIRY_DAYS = int(os.environ.get("LISTING_EXPIRY_DAYS", "120"))
PROMOTION_WEEKLY_FEE_CENTS = int(os.environ.get("PROMOTION_WEEKLY_FEE_CENTS", "500"))
PLUS_MONTHLY_LISTING_QUOTA = int(os.environ.get("PLUS_MONTHLY_LISTING_QUOTA", "15"))
PLUS_PLATFORM_FEE_BPS = int(os.environ.get("PLUS_PLATFORM_FEE_BPS", "400"))
PLUS_PRICE_USD = int(os.environ.get("PLUS_PRICE_USD", "12"))
OFFSITE_AD_FEE_BPS = int(os.environ.get("OFFSITE_AD_FEE_BPS", "1200"))


def is_plus(maker: dict) -> bool:
    return (maker or {}).get("subscription_status") == "active"


def commission_bps_for(maker: dict) -> int:
    """Plus subscribers pay 4% commission; free tier pays 5% (default env value)."""
    base = int(os.environ.get("PLATFORM_FEE_BPS", "500"))
    return PLUS_PLATFORM_FEE_BPS if is_plus(maker) else base


def current_month_key() -> str:
    n = datetime.now(timezone.utc)
    return f"{n.year:04d}-{n.month:02d}"


def expiry_iso_from_now(days: int = LISTING_EXPIRY_DAYS) -> str:
    return (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()


def promotion_until_iso(weeks: int = 1) -> str:
    return (datetime.now(timezone.utc) + timedelta(days=7 * weeks)).isoformat()


async def accrue_listing_charge(maker_slug: str, product_slug: str,
                                kind: str = "listing_publish") -> dict:
    """Accrue a listing fee to the maker's pending charges.

    Free tier:  first `LISTING_FREE_QUOTA` listings are free *lifetime*; all
                subsequent publishes/renews accrue `LISTING_FEE_CENTS`.
    Plus tier:  first `PLUS_MONTHLY_LISTING_QUOTA` listings each calendar month
                are free; beyond that, same per-listing fee.

    Returns:
        {charged: bool, amount_cents: int, free_remaining: int,
         lifetime: int, plus: bool, monthly_used: int}
    """
    m = await db.makers.find_one({"slug": maker_slug}, {"_id": 0})
    if not m:
        return {"charged": False, "amount_cents": 0,
                "free_remaining": 0, "lifetime": 0, "plus": False, "monthly_used": 0}

    plus = is_plus(m)
    lifetime = int(m.get("listings_used_lifetime", 0))
    new_lifetime = lifetime + 1
    month_key = current_month_key()
    by_month = dict(m.get("listings_by_month") or {})
    monthly_used = int(by_month.get(month_key, 0))
    new_monthly = monthly_used + 1

    if plus:
        free_quota = PLUS_MONTHLY_LISTING_QUOTA
        within_free = new_monthly <= free_quota
        free_remaining_after = max(0, free_quota - new_monthly)
    else:
        free_quota = LISTING_FREE_QUOTA
        within_free = new_lifetime <= free_quota
        free_remaining_after = max(0, free_quota - new_lifetime)

    by_month[month_key] = new_monthly
    if within_free:
        await db.makers.update_one(
            {"slug": maker_slug},
            {
                "$inc": {"listings_used_lifetime": 1},
                "$set": {"listings_by_month": by_month},
            },
        )
        return {
            "charged": False, "amount_cents": 0,
            "free_remaining": free_remaining_after,
            "lifetime": new_lifetime, "plus": plus,
            "monthly_used": new_monthly,
        }
    # Past quota — accrue the fee.
    entry = {
        "kind": kind, "slug": product_slug,
        "amount_cents": LISTING_FEE_CENTS,
        "ts": now_iso(),
        "note": f"{kind} fee" + (" (Plus quota exceeded)" if plus else ""),
    }
    await db.makers.update_one(
        {"slug": maker_slug},
        {
            "$inc": {
                "listings_used_lifetime": 1,
                "pending_charges_cents": LISTING_FEE_CENTS,
            },
            "$set": {"listings_by_month": by_month},
            "$push": {"charge_history": entry},
        },
    )
    return {
        "charged": True, "amount_cents": LISTING_FEE_CENTS,
        "free_remaining": 0, "lifetime": new_lifetime,
        "plus": plus, "monthly_used": new_monthly,
    }


async def accrue_promotion_charge(maker_slug: str, product_slug: str,
                                  weeks: int = 1) -> dict:
    """Charge the flat promotion fee per week."""
    amount = PROMOTION_WEEKLY_FEE_CENTS * max(1, int(weeks))
    entry = {
        "kind": "promotion", "slug": product_slug,
        "amount_cents": amount, "ts": now_iso(),
        "note": f"{weeks} week(s) promoted listing",
    }
    await db.makers.update_one(
        {"slug": maker_slug},
        {
            "$inc": {"pending_charges_cents": amount},
            "$push": {"charge_history": entry},
        },
    )
    return {"amount_cents": amount, "weeks": weeks}


async def settle_pending_charges(maker_slug: str, gross_cents: int) -> dict:
    """Called from Stripe Connect transfer flow before computing the wire
    amount. Drains as much of the maker's pending_charges as the gross can
    cover; any leftover stays pending for the next payout.

    Returns {deducted_cents, remaining_pending_cents}.
    """
    m = await db.makers.find_one({"slug": maker_slug}, {"_id": 0})
    if not m:
        return {"deducted_cents": 0, "remaining_pending_cents": 0}
    pending = int(m.get("pending_charges_cents", 0) or 0)
    if pending <= 0:
        return {"deducted_cents": 0, "remaining_pending_cents": 0}
    deduct = min(pending, max(0, gross_cents))
    new_pending = pending - deduct
    await db.makers.update_one(
        {"slug": maker_slug},
        {
            "$set": {"pending_charges_cents": new_pending},
            "$push": {"charge_history": {
                "kind": "settle", "slug": None,
                "amount_cents": -deduct, "ts": now_iso(),
                "note": f"netted from payout (was {pending}c, now {new_pending}c)",
            }},
        },
    )
    return {"deducted_cents": deduct, "remaining_pending_cents": new_pending}


async def expire_due_listings() -> dict:
    """Background sweep: any published listing past its `expires_at` flips to
    draft. Returns count. Call from scheduled task or admin endpoint.
    """
    now = now_iso()
    res = await db.products.update_many(
        {
            "status": "published",
            "deleted_at": None,
            "expires_at": {"$ne": None, "$lt": now},
        },
        {"$set": {"status": "draft"}},
    )
    return {"expired": int(res.modified_count or 0), "now": now}
