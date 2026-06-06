"""iter335 — Unified Promotion Engine endpoints.

Public API mounted under `/api/promote/*`.

Routes:
    GET  /promote/wallet                       — balance + recent txns
    POST /promote/wallet/topup                 — Stripe Checkout session
    POST /promote/wallet/subscribe             — Stripe subscription session
    GET  /promote/campaign                     — current plan + allocations
    POST /promote/campaign                     — upsert plan
    POST /promote/campaign/pause
    POST /promote/campaign/resume
    POST /promote/campaign/apply               — trigger allocator now
    POST /promote/campaign/preview             — dry-run allocator (no spend)
    GET  /promote/analytics                    — spend / clicks / orders / ROAS

All endpoints require a valid maker JWT. Wallet credits land via the
Stripe webhook in `routers/checkout.py` which now dispatches
`promote_topup` and `promote_subscription` metadata to the wallet
service.
"""
from __future__ import annotations

import logging
import os
import secrets
from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from core import STRIPE_API_KEY, db, now_iso, public_host
from maker_auth import current_maker_slug
from services import promote_wallet, promote_allocator

router = APIRouter()
log = logging.getLogger("crafters.promote")

PROMOTE_TOPUP_MIN_CENTS = 1000   # $10 floor — keeps Stripe fees < 4% of credit
PROMOTE_TOPUP_MAX_CENTS = 100000 # $1000 cap — fraud guard
PROMOTE_GOALS = {"sales", "traffic", "reach"}


# ── Pydantic models ────────────────────────────────────────────────────
class TopupRequest(BaseModel):
    amount_cents: int = Field(..., ge=PROMOTE_TOPUP_MIN_CENTS,
                              le=PROMOTE_TOPUP_MAX_CENTS)


class SubscribeRequest(BaseModel):
    monthly_cents: int = Field(..., ge=PROMOTE_TOPUP_MIN_CENTS,
                               le=PROMOTE_TOPUP_MAX_CENTS)


class CampaignUpsert(BaseModel):
    budget_cents: int = Field(..., ge=0, le=PROMOTE_TOPUP_MAX_CENTS)
    goal: str = "sales"
    channels: list[str] = ["internal"]  # phase 1 = internal only
    auto_allocate: bool = True
    explicit_listing_slugs: Optional[list[str]] = None


# ── Wallet ─────────────────────────────────────────────────────────────
@router.get("/promote/wallet")
async def get_wallet(maker_slug: str = Depends(current_maker_slug)):
    """Wallet balance + last 25 ledger entries. Idempotent — creates the
    wallet doc on first read so the UI never has to handle a 404."""
    w = await promote_wallet.ensure_wallet(maker_slug)
    txns = await promote_wallet.recent_transactions(maker_slug, limit=25)
    return {
        "maker_slug": maker_slug,
        "balance_cents": int(w.get("balance_cents") or 0),
        "lifetime_funded_cents": int(w.get("lifetime_funded_cents") or 0),
        "lifetime_spent_cents": int(w.get("lifetime_spent_cents") or 0),
        "transactions": txns,
        "subscription": w.get("subscription"),  # {status, monthly_cents, next_renew_at}
    }


@router.post("/promote/wallet/topup")
async def topup(req: TopupRequest, request: Request,
                maker_slug: str = Depends(current_maker_slug)):
    """One-time wallet top-up via Stripe Checkout.

    Returns `{checkout_url, session_id}`. The webhook handler in
    `checkout.py` watches for `metadata.promote_kind == "topup"` and
    calls `promote_wallet.credit()` when the session is paid. We tag
    each session with an `idempotency_key` so re-fired webhooks don't
    double-credit.
    """
    import stripe as stripe_sdk
    stripe_sdk.api_key = STRIPE_API_KEY

    host = public_host(request)
    # Land back on the Promote tab with a flag the FE uses to refetch
    # the wallet balance + show a success toast.
    success_url = f"{host}/maker/dashboard?tab=promote&topup=success&session_id={{CHECKOUT_SESSION_ID}}"
    cancel_url = f"{host}/maker/dashboard?tab=promote&topup=cancelled"

    idem_key = secrets.token_urlsafe(20)
    dollars = req.amount_cents / 100.0
    try:
        sess = stripe_sdk.checkout.Session.create(
            mode="payment",
            payment_method_types=["card"],
            line_items=[{
                "price_data": {
                    "currency": "usd",
                    "unit_amount": int(req.amount_cents),
                    "product_data": {
                        "name": f"Crafters Market — Promote Wallet · ${dollars:.0f}",
                        "description": "Top-up credit applied to your promotion wallet. Used to boost listings on Crafters Market homepage + featured rails.",
                    },
                },
                "quantity": 1,
            }],
            success_url=success_url,
            cancel_url=cancel_url,
            metadata={
                "promote_kind": "topup",
                "maker_slug": maker_slug,
                "amount_cents": str(req.amount_cents),
                "idempotency_key": idem_key,
            },
        )
    except Exception as e:
        log.exception("[promote] topup checkout failed: %s", e)
        raise HTTPException(502, f"Stripe error: {e}")

    # Persist a pending row so the maker can see the in-flight top-up
    # in their ledger even before the webhook fires.
    await db.promote_pending_topups.insert_one({
        "_id": sess.id,
        "session_id": sess.id,
        "maker_slug": maker_slug,
        "amount_cents": int(req.amount_cents),
        "idempotency_key": idem_key,
        "status": "pending",
        "created_at": now_iso(),
    })
    return {"checkout_url": sess.url, "session_id": sess.id}


@router.post("/promote/wallet/subscribe")
async def subscribe(req: SubscribeRequest, request: Request,
                    maker_slug: str = Depends(current_maker_slug)):
    """Recurring monthly wallet refill via Stripe Subscription.

    Stripe creates a $X/month subscription; on every successful invoice,
    the webhook credits the wallet by the same amount. The maker can
    cancel from the Promote page (DELETE /promote/wallet/subscribe).
    """
    import stripe as stripe_sdk
    stripe_sdk.api_key = STRIPE_API_KEY

    host = public_host(request)
    success_url = f"{host}/maker/dashboard?tab=promote&subscribe=success"
    cancel_url = f"{host}/maker/dashboard?tab=promote&subscribe=cancelled"

    dollars = req.monthly_cents / 100.0
    try:
        # Inline price — created on the fly so we don't have to manage
        # a Price catalog in Stripe for every possible $/mo tier.
        sess = stripe_sdk.checkout.Session.create(
            mode="subscription",
            payment_method_types=["card"],
            line_items=[{
                "price_data": {
                    "currency": "usd",
                    "unit_amount": int(req.monthly_cents),
                    "recurring": {"interval": "month"},
                    "product_data": {
                        "name": f"Crafters Market — Promote Plan · ${dollars:.0f}/mo",
                    },
                },
                "quantity": 1,
            }],
            success_url=success_url,
            cancel_url=cancel_url,
            metadata={
                "promote_kind": "subscription",
                "maker_slug": maker_slug,
                "monthly_cents": str(req.monthly_cents),
            },
            subscription_data={
                "metadata": {
                    "promote_kind": "subscription",
                    "maker_slug": maker_slug,
                    "monthly_cents": str(req.monthly_cents),
                },
            },
        )
    except Exception as e:
        log.exception("[promote] subscribe checkout failed: %s", e)
        raise HTTPException(502, f"Stripe error: {e}")
    return {"checkout_url": sess.url, "session_id": sess.id}


@router.delete("/promote/wallet/subscribe")
async def cancel_subscription(maker_slug: str = Depends(current_maker_slug)):
    w = await promote_wallet.ensure_wallet(maker_slug)
    sub = (w or {}).get("subscription") or {}
    sub_id = sub.get("stripe_subscription_id")
    if not sub_id:
        raise HTTPException(404, "No active subscription")
    import stripe as stripe_sdk
    stripe_sdk.api_key = STRIPE_API_KEY
    try:
        stripe_sdk.Subscription.delete(sub_id)
    except Exception as e:
        log.exception("[promote] cancel sub failed: %s", e)
        raise HTTPException(502, f"Stripe error: {e}")
    await db.promotion_wallets.update_one(
        {"_id": maker_slug},
        {"$set": {"subscription.status": "cancelled",
                  "subscription.cancelled_at": now_iso(),
                  "updated_at": now_iso()}}
    )
    return {"status": "cancelled"}


# ── Campaign group ─────────────────────────────────────────────────────
@router.get("/promote/campaign")
async def get_campaign(maker_slug: str = Depends(current_maker_slug)):
    """Returns the maker's single active campaign group + its current
    listing_allocations. Phase 1 supports one plan per maker (Phase 2
    will allow multiple goal-specific campaigns)."""
    doc = await db.campaign_groups.find_one(
        {"maker_slug": maker_slug, "deleted_at": None}
    )
    if not doc:
        return {"campaign": None, "allocations": []}
    doc.pop("_id", None)
    allocations_cur = db.listing_allocations.find(
        {"campaign_id": doc["campaign_id"], "maker_slug": maker_slug}
    ).sort("allocated_cents", -1)
    allocations = []
    async for a in allocations_cur:
        a.pop("_id", None)
        allocations.append(a)
    return {"campaign": doc, "allocations": allocations}


@router.post("/promote/campaign")
async def upsert_campaign(body: CampaignUpsert,
                          maker_slug: str = Depends(current_maker_slug)):
    if body.goal not in PROMOTE_GOALS:
        raise HTTPException(400, f"goal must be one of {sorted(PROMOTE_GOALS)}")
    existing = await db.campaign_groups.find_one(
        {"maker_slug": maker_slug, "deleted_at": None}
    )
    if existing:
        campaign_id = existing["campaign_id"]
        await db.campaign_groups.update_one(
            {"campaign_id": campaign_id},
            {"$set": {
                "budget_cents": int(body.budget_cents),
                "goal": body.goal,
                "channels": body.channels,
                "auto_allocate": bool(body.auto_allocate),
                "explicit_listing_slugs": body.explicit_listing_slugs or [],
                "updated_at": now_iso(),
            }},
        )
    else:
        campaign_id = "camp_" + secrets.token_urlsafe(10)
        await db.campaign_groups.insert_one({
            "campaign_id": campaign_id,
            "maker_slug": maker_slug,
            "budget_cents": int(body.budget_cents),
            "goal": body.goal,
            "channels": body.channels,
            "auto_allocate": bool(body.auto_allocate),
            "explicit_listing_slugs": body.explicit_listing_slugs or [],
            "status": "active",
            "deleted_at": None,
            "created_at": now_iso(),
            "updated_at": now_iso(),
        })
    saved = await db.campaign_groups.find_one({"campaign_id": campaign_id})
    saved.pop("_id", None)
    return {"campaign": saved}


@router.post("/promote/campaign/pause")
async def pause_campaign(maker_slug: str = Depends(current_maker_slug)):
    r = await db.campaign_groups.update_one(
        {"maker_slug": maker_slug, "deleted_at": None},
        {"$set": {"status": "paused", "updated_at": now_iso()}},
    )
    if r.matched_count == 0:
        raise HTTPException(404, "No campaign found")
    return {"status": "paused"}


@router.post("/promote/campaign/resume")
async def resume_campaign(maker_slug: str = Depends(current_maker_slug)):
    r = await db.campaign_groups.update_one(
        {"maker_slug": maker_slug, "deleted_at": None},
        {"$set": {"status": "active", "updated_at": now_iso()}},
    )
    if r.matched_count == 0:
        raise HTTPException(404, "No campaign found")
    return {"status": "active"}


@router.post("/promote/campaign/preview")
async def preview_campaign(body: CampaignUpsert,
                           maker_slug: str = Depends(current_maker_slug)):
    """Dry-run allocator — returns what the spend distribution WOULD look
    like for the given budget without debiting or extending anything.
    Used by the Promote page to show real-time "your budget is being
    distributed:" preview as the maker drags the budget slider."""
    allocations = await promote_allocator.compute_allocations(
        maker_slug, int(body.budget_cents),
        explicit_listing_slugs=body.explicit_listing_slugs,
    )
    return {"allocations": allocations, "budget_cents": int(body.budget_cents)}


@router.post("/promote/campaign/apply")
async def apply_campaign(maker_slug: str = Depends(current_maker_slug)):
    """Run the allocator now (instead of waiting for the daily cron).
    Debits the wallet by the per-listing boost cost and extends
    `promoted_until` so the listings show up boosted immediately."""
    camp = await db.campaign_groups.find_one(
        {"maker_slug": maker_slug, "deleted_at": None, "status": "active"}
    )
    if not camp:
        raise HTTPException(404, "No active campaign")
    result = await promote_allocator.apply_allocations(
        maker_slug, camp["campaign_id"], int(camp.get("budget_cents") or 0),
        explicit_listing_slugs=camp.get("explicit_listing_slugs") or None,
    )
    return result


# ── Analytics ──────────────────────────────────────────────────────────
@router.get("/promote/analytics")
async def analytics(maker_slug: str = Depends(current_maker_slug)):
    """Aggregate Phase 1 metrics: total wallet spend, boost count, plus
    a join against `orders` to compute ROAS for boosted listings.

    Phase 1 ROAS = revenue attributable to listings that were boosted
    during the order window. Phase 1.5 will switch to full
    impression/click/conversion attribution via the adsGateway.
    """
    w = await promote_wallet.ensure_wallet(maker_slug)
    total_spent_cents = int(w.get("lifetime_spent_cents") or 0)

    # Sum boost counts + spend per-listing from listing_allocations.
    per_listing = []
    cursor = db.listing_allocations.find(
        {"maker_slug": maker_slug}
    ).sort("total_spent_cents", -1)
    async for a in cursor:
        a.pop("_id", None)
        per_listing.append(a)

    # Revenue from orders on boosted listings (last 30 days).
    cutoff = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    boosted_slugs = [a["slug"] for a in per_listing if int(a.get("total_boosts") or 0) > 0]
    revenue_cents = 0
    order_count = 0
    if boosted_slugs:
        agg = db.orders.aggregate([
            {"$match": {
                "items.slug": {"$in": boosted_slugs},
                "status": {"$in": ["paid", "shipped", "delivered"]},
            }},
            {"$group": {
                "_id": None,
                "revenue": {"$sum": "$total_cents"},
                "count": {"$sum": 1},
            }},
        ])
        async for row in agg:
            revenue_cents = int(row.get("revenue") or 0)
            order_count = int(row.get("count") or 0)

    roas = (revenue_cents / total_spent_cents) if total_spent_cents > 0 else 0.0
    return {
        "spend_cents": total_spent_cents,
        "revenue_cents": revenue_cents,
        "order_count": order_count,
        "roas": round(roas, 2),
        "boosted_listing_count": len(boosted_slugs),
        "per_listing": per_listing,
        "as_of": cutoff,
    }
