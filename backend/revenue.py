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


def expiry_iso_from_now(days: int = LISTING_EXPIRY_DAYS) -> str:
    return (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()


def promotion_until_iso(weeks: int = 1) -> str:
    return (datetime.now(timezone.utc) + timedelta(days=7 * weeks)).isoformat()


async def accrue_listing_charge(maker_slug: str, product_slug: str,
                                kind: str = "listing_publish") -> dict:
    """Accrue a listing fee to the maker's pending charges IFF lifetime usage
    is past the free quota. Returns a dict describing the accrual:
        {charged: bool, amount_cents: int, free_remaining: int, lifetime: int}
    """
    m = await db.makers.find_one({"slug": maker_slug}, {"_id": 0})
    if not m:
        return {"charged": False, "amount_cents": 0, "free_remaining": 0, "lifetime": 0}
    lifetime = int(m.get("listings_used_lifetime", 0))
    new_lifetime = lifetime + 1
    if new_lifetime <= LISTING_FREE_QUOTA:
        await db.makers.update_one(
            {"slug": maker_slug},
            {"$inc": {"listings_used_lifetime": 1}},
        )
        return {
            "charged": False, "amount_cents": 0,
            "free_remaining": LISTING_FREE_QUOTA - new_lifetime,
            "lifetime": new_lifetime,
        }
    # Past the free quota — accrue the fee.
    entry = {
        "kind": kind, "slug": product_slug,
        "amount_cents": LISTING_FEE_CENTS,
        "ts": now_iso(),
        "note": f"{kind} fee",
    }
    await db.makers.update_one(
        {"slug": maker_slug},
        {
            "$inc": {
                "listings_used_lifetime": 1,
                "pending_charges_cents": LISTING_FEE_CENTS,
            },
            "$push": {"charge_history": entry},
        },
    )
    return {
        "charged": True, "amount_cents": LISTING_FEE_CENTS,
        "free_remaining": 0, "lifetime": new_lifetime,
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
