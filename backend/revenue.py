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

# ───────────────────────── Founders Tier ─────────────────────────
# Free-forever recruiting tier for the first wave of CraftersMarket
# makers. Lower commission than both Standard and Plus, generous free
# listing quota, with a 12-month window that auto-rolls to Standard
# unless the maker is in the inaugural-100 cohort (which is lifetime).
#
# Founder fields stored on the maker doc:
#   tier                = "standard" | "founder" | (Plus is layered on top
#                         via the existing subscription_status field)
#   founder_status      = "inaugural" | "regular" | None
#   founder_started_at  = ISO datetime (when their tier was set to founder)
#   founder_expires_at  = ISO datetime | None   (None means lifetime/inaugural)
#   is_beta_tester      = bool — applies the dual "◆ Beta Tester" badge
#                                  and grants lifetime inaugural status
#   founder_grace_until = ISO datetime — 14-day publish-or-lose-slot window
FOUNDER_PLATFORM_FEE_BPS = int(os.environ.get("FOUNDER_PLATFORM_FEE_BPS", "300"))  # 3%
FOUNDER_MONTHLY_LISTING_QUOTA = int(os.environ.get("FOUNDER_MONTHLY_LISTING_QUOTA", "50"))
FOUNDER_WINDOW_DAYS = int(os.environ.get("FOUNDER_WINDOW_DAYS", "365"))
FOUNDER_GRACE_DAYS = int(os.environ.get("FOUNDER_GRACE_DAYS", "14"))
FOUNDER_INAUGURAL_CAP = int(os.environ.get("FOUNDER_INAUGURAL_CAP", "100"))

# Veteran-owned bonus (iter153): every veteran-owned maker gets $10/mo
# in boosted-listing credit, auto-replenished by the daily scheduler at
# the start of each calendar month. Unused credit DOES NOT roll over.
# Credit is burned BEFORE the cash promotion fee accrues, so a veteran
# can boost 2 listings free per month at the current $5/week price.
VETERAN_MONTHLY_BOOST_CREDIT_CENTS = int(
    os.environ.get("VETERAN_MONTHLY_BOOST_CREDIT_CENTS", "1000")
)

# Plus subscribers pay half the per-listing overage past their quota.
# Standard / Founder pay LISTING_FEE_CENTS; Plus pays this amount instead.
PLUS_LISTING_FEE_CENTS = int(os.environ.get("PLUS_LISTING_FEE_CENTS", "10"))


def is_founder(maker: dict) -> bool:
    """True if the maker currently holds an unexpired Founder slot.

    Inaugural Founders never expire. Regular Founders expire 12 months
    after their `founder_started_at`. Once expired the maker auto-rolls
    to Standard via the daily expiry cron, but this helper is the
    authoritative real-time check used by fee resolution.
    """
    m = maker or {}
    if m.get("tier") != "founder":
        return False
    if m.get("founder_status") == "inaugural":
        return True
    expires = m.get("founder_expires_at")
    if not expires:
        return True
    try:
        return datetime.fromisoformat(expires.replace("Z", "+00:00")) > datetime.now(timezone.utc)
    except (ValueError, AttributeError):
        return True  # malformed — give them the benefit of the doubt


def is_inaugural_founder(maker: dict) -> bool:
    """Founders #1-100 + the original beta testers — lifetime perks."""
    return (maker or {}).get("tier") == "founder" and (
        (maker or {}).get("founder_status") == "inaugural"
    )


def is_plus(maker: dict) -> bool:
    return (maker or {}).get("subscription_status") == "active"


def commission_bps_for(maker: dict) -> int:
    """Plus → 4%; Founder → 3%; everyone else → base 5%.

    Founder is checked AFTER Plus so a Founder who upgrades to Plus pays
    whichever rate is lower for them (currently identical at 300bps in
    practice, but the resolver stays correct if rates diverge later).
    """
    base = int(os.environ.get("PLATFORM_FEE_BPS", "500"))
    if is_founder(maker):
        return min(FOUNDER_PLATFORM_FEE_BPS, PLUS_PLATFORM_FEE_BPS if is_plus(maker) else base)
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
    founder = is_founder(m)
    lifetime = int(m.get("listings_used_lifetime", 0))
    new_lifetime = lifetime + 1
    month_key = current_month_key()
    by_month = dict(m.get("listings_by_month") or {})
    monthly_used = int(by_month.get(month_key, 0))
    new_monthly = monthly_used + 1

    # Tier-aware free quota. Plus wins over Founder when both apply (higher
    # quota), but the same 20¢ overage applies past the quota regardless.
    if plus:
        free_quota = PLUS_MONTHLY_LISTING_QUOTA
        within_free = new_monthly <= free_quota
        free_remaining_after = max(0, free_quota - new_monthly)
    elif founder:
        free_quota = FOUNDER_MONTHLY_LISTING_QUOTA
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
            "founder": founder,
            "monthly_used": new_monthly,
        }
    # Past quota — try burning a pre-paid listing credit before accruing the fee.
    credits = int(m.get("listing_credits", 0) or 0)
    if credits > 0:
        entry = {
            "kind": kind, "slug": product_slug,
            "amount_cents": 0, "ts": now_iso(),
            "note": f"{kind} (used 1 pre-paid credit, {credits - 1} remaining)",
        }
        await db.makers.update_one(
            {"slug": maker_slug},
            {
                "$inc": {
                    "listings_used_lifetime": 1,
                    "listing_credits": -1,
                },
                "$set": {"listings_by_month": by_month},
                "$push": {"charge_history": entry},
            },
        )
        return {
            "charged": False, "amount_cents": 0,
            "free_remaining": 0, "lifetime": new_lifetime,
            "plus": plus, "founder": founder,
            "monthly_used": new_monthly,
            "credits_burned": True, "credits_remaining": credits - 1,
        }
    # No credits — accrue cash fee. Plus subscribers get half-price overage.
    fee_cents = PLUS_LISTING_FEE_CENTS if plus else LISTING_FEE_CENTS
    entry = {
        "kind": kind, "slug": product_slug,
        "amount_cents": fee_cents,
        "ts": now_iso(),
        "note": f"{kind} fee" + (
            f" ({fee_cents}c — Plus quota exceeded, half-price)" if plus
            else " (Founder quota exceeded)" if founder
            else ""
        ),
    }
    await db.makers.update_one(
        {"slug": maker_slug},
        {
            "$inc": {
                "listings_used_lifetime": 1,
                "pending_charges_cents": fee_cents,
            },
            "$set": {"listings_by_month": by_month},
            "$push": {"charge_history": entry},
        },
    )
    return {
        "charged": True, "amount_cents": fee_cents,
        "free_remaining": 0, "lifetime": new_lifetime,
        "plus": plus, "founder": founder,
        "monthly_used": new_monthly,
    }


async def accrue_promotion_charge(maker_slug: str, product_slug: str,
                                  weeks: int = 1) -> dict:
    """Charge the flat promotion fee per week. Veteran-owned makers burn
    their monthly $10 boost credit first; only the remainder accrues as
    a cash charge. Unused credit does not roll over."""
    amount = PROMOTION_WEEKLY_FEE_CENTS * max(1, int(weeks))
    m = await db.makers.find_one(
        {"slug": maker_slug},
        {"_id": 0, "is_veteran_owned": 1, "veteran_boost_credit_cents": 1},
    ) or {}
    # Veteran credit burn — applies before the cash charge accrues. The
    # monthly cron tops `veteran_boost_credit_cents` back up to
    # VETERAN_MONTHLY_BOOST_CREDIT_CENTS at the start of each calendar month.
    credit_used = 0
    if m.get("is_veteran_owned"):
        credit = int(m.get("veteran_boost_credit_cents") or 0)
        credit_used = min(credit, amount)
        if credit_used > 0:
            await db.makers.update_one(
                {"slug": maker_slug},
                {
                    "$inc": {"veteran_boost_credit_cents": -credit_used},
                    "$push": {"charge_history": {
                        "kind": "veteran_boost_credit", "slug": product_slug,
                        "amount_cents": -credit_used, "ts": now_iso(),
                        "note": f"Veteran boost credit applied (-{credit_used}c)",
                    }},
                },
            )
    cash_due = amount - credit_used
    if cash_due > 0:
        entry = {
            "kind": "promotion", "slug": product_slug,
            "amount_cents": cash_due, "ts": now_iso(),
            "note": (
                f"{weeks} week(s) promoted listing"
                + (f" (after -{credit_used}c veteran credit)" if credit_used else "")
            ),
        }
        await db.makers.update_one(
            {"slug": maker_slug},
            {
                "$inc": {"pending_charges_cents": cash_due},
                "$push": {"charge_history": entry},
            },
        )
    return {
        "amount_cents": amount,
        "credit_used_cents": credit_used,
        "cash_accrued_cents": cash_due,
        "weeks": weeks,
    }


async def replenish_veteran_boost_credits() -> dict:
    """Monthly job — reset every veteran-owned maker's boost credit to
    `VETERAN_MONTHLY_BOOST_CREDIT_CENTS` at the start of the calendar
    month. Unused credit does NOT roll over. Idempotent: safe to call
    multiple times in the same month; the field is set, not incremented.
    """
    res = await db.makers.update_many(
        {"is_veteran_owned": True},
        {"$set": {
            "veteran_boost_credit_cents": VETERAN_MONTHLY_BOOST_CREDIT_CENTS,
            "veteran_boost_credit_replenished_at": now_iso(),
        }},
    )
    return {"replenished": res.modified_count,
            "credit_cents": VETERAN_MONTHLY_BOOST_CREDIT_CENTS}


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


async def auto_renew_due_promotions(window_hours: int = 6) -> dict:
    """Hourly sweep: for every product whose `promoted_until` lapses inside
    the next `window_hours` AND has `auto_renew_promotion=True`, add another
    week of promotion. Plus subscribers ride for free; everyone else gets a
    $5 charge accrued to pending balance via `accrue_promotion_charge`.

    Idempotency: extending a still-far-out `promoted_until` is harmless,
    but the time-window guard means each promotion gets renewed at most
    once per cycle. Each renewal is also logged in the maker's
    `charge_history` (via `accrue_promotion_charge`) for audit trail.

    Returns {renewed: int, charged_makers: int, free_renewals: int, errors: int}.
    """
    now = datetime.now(timezone.utc)
    horizon = (now + timedelta(hours=window_hours)).isoformat()
    nowiso = now.isoformat()
    cursor = db.products.find(
        {
            "auto_renew_promotion": True,
            "status": "published",
            "deleted_at": None,
            "promoted_until": {"$gte": nowiso, "$lte": horizon},
        },
        {"_id": 0, "slug": 1, "maker_slug": 1, "promoted_until": 1, "title": 1},
    )
    renewed = charged = free = errors = 0
    async for p in cursor:
        try:
            maker = await db.makers.find_one(
                {"slug": p["maker_slug"]}, {"_id": 0},
            ) or {}
            if is_plus(maker):
                free += 1
                # Log a zero-cost charge entry for transparency.
                await db.makers.update_one(
                    {"slug": p["maker_slug"]},
                    {"$push": {"charge_history": {
                        "kind": "promotion",
                        "slug": p["slug"],
                        "amount_cents": 0,
                        "ts": nowiso,
                        "note": "auto-renew · Plus complimentary week",
                    }}},
                )
            else:
                await accrue_promotion_charge(p["maker_slug"], p["slug"], weeks=1)
                charged += 1
            # Extend from the existing end so we don't lose stub time.
            cur_end = datetime.fromisoformat(p["promoted_until"].replace("Z", "+00:00"))
            new_end = (cur_end + timedelta(days=7)).isoformat()
            await db.products.update_one(
                {"slug": p["slug"]},
                {"$set": {"promoted_until": new_end}},
            )
            renewed += 1
        except Exception:
            errors += 1
    return {
        "renewed": renewed, "charged_makers": charged,
        "free_renewals": free, "errors": errors,
    }
