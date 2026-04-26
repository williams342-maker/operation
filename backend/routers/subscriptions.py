"""Crafters Plus — maker subscription tier ($12/mo).

Stripe Subscriptions: a Stripe Customer is created on first call, then a
Subscription against an auto-managed Price object. Webhook events keep
`maker.subscription_status` in sync.

Lifecycle:
    free → (start) → active → (cancel) → canceled → (start again) → active
    active → (payment fails) → past_due → (paid) → active

Endpoints:
    POST /api/maker/subscription/start   → returns Stripe Checkout URL
    POST /api/maker/subscription/cancel  → cancels at period end
    GET  /api/maker/subscription         → current status + plan info

Webhook (mounted on /api/stripe/connect/webhook in stripe_connect.py) handles
    customer.subscription.created/updated/deleted, invoice.payment_succeeded
"""
from __future__ import annotations
import os
from typing import Optional

import stripe
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from core import STRIPE_API_KEY, db, logger, now_iso, public_host
from maker_auth import current_maker_slug
from revenue import (
    PLUS_MONTHLY_LISTING_QUOTA, PLUS_PLATFORM_FEE_BPS, PLUS_PRICE_USD,
)

router = APIRouter()


def _stripe():
    stripe.api_key = STRIPE_API_KEY
    return stripe


PLUS_PRICE_ID_CACHE: Optional[str] = None
PLUS_PRODUCT_ID_CACHE: Optional[str] = None


async def _get_or_create_plus_price() -> str:
    """Find or create the recurring Stripe Price for Crafters Plus.

    Caches in-process so we don't round-trip Stripe on every subscribe. We
    also persist the IDs in `db.platform_meta` so a process restart doesn't
    duplicate Products / Prices in Stripe.
    """
    global PLUS_PRICE_ID_CACHE, PLUS_PRODUCT_ID_CACHE
    if PLUS_PRICE_ID_CACHE:
        return PLUS_PRICE_ID_CACHE

    meta = await db.platform_meta.find_one({"key": "plus_subscription"}, {"_id": 0})
    if meta and meta.get("price_id"):
        PLUS_PRICE_ID_CACHE = meta["price_id"]
        PLUS_PRODUCT_ID_CACHE = meta.get("product_id")
        return PLUS_PRICE_ID_CACHE

    s = _stripe()
    product = s.Product.create(
        name="Crafters Plus",
        description=(
            f"Maker subscription · {PLUS_MONTHLY_LISTING_QUOTA} free listings/mo · "
            f"{PLUS_PLATFORM_FEE_BPS / 100:.1f}% commission · advanced analytics · "
            "custom shop banner"
        ),
        metadata={"tier": "plus"},
    )
    price = s.Price.create(
        unit_amount=PLUS_PRICE_USD * 100,
        currency="usd",
        recurring={"interval": "month"},
        product=product.id,
    )
    await db.platform_meta.update_one(
        {"key": "plus_subscription"},
        {"$set": {
            "key": "plus_subscription",
            "product_id": product.id,
            "price_id": price.id,
            "created_at": now_iso(),
        }},
        upsert=True,
    )
    PLUS_PRICE_ID_CACHE = price.id
    PLUS_PRODUCT_ID_CACHE = product.id
    return price.id


async def _ensure_stripe_customer(maker: dict) -> str:
    """Idempotently create a Stripe Customer for the maker."""
    if maker.get("stripe_customer_id"):
        return maker["stripe_customer_id"]
    s = _stripe()
    cust = s.Customer.create(
        email=maker.get("email"),
        name=maker.get("name") or maker["slug"],
        metadata={"maker_slug": maker["slug"], "kind": "maker_subscription"},
    )
    await db.makers.update_one(
        {"slug": maker["slug"]},
        {"$set": {"stripe_customer_id": cust.id}},
    )
    return cust.id


class StartSubscriptionResp(BaseModel):
    checkout_url: str


@router.post("/maker/subscription/start", response_model=StartSubscriptionResp)
async def start_subscription(request: Request, slug: str = Depends(current_maker_slug)):
    """Create a Stripe Checkout session in subscription mode and redirect the
    maker to pay. On success the webhook flips `subscription_status` to active.
    """
    if not STRIPE_API_KEY:
        raise HTTPException(503, "Stripe is not configured.")
    m = await db.makers.find_one({"slug": slug}, {"_id": 0})
    if not m:
        raise HTTPException(404, "Maker not found.")
    if m.get("subscription_status") == "active":
        raise HTTPException(400, "You're already on Crafters Plus.")

    s = _stripe()
    price_id = await _get_or_create_plus_price()
    customer_id = await _ensure_stripe_customer(m)

    host = public_host(request)
    success_url = f"{host}/maker/dashboard?plus=success"
    cancel_url = f"{host}/maker/dashboard?plus=canceled"

    session = s.checkout.Session.create(
        mode="subscription",
        customer=customer_id,
        line_items=[{"price": price_id, "quantity": 1}],
        success_url=success_url,
        cancel_url=cancel_url,
        metadata={"maker_slug": slug, "kind": "plus_subscription"},
        subscription_data={"metadata": {"maker_slug": slug}},
    )
    return {"checkout_url": session.url}


@router.post("/maker/subscription/cancel")
async def cancel_subscription(slug: str = Depends(current_maker_slug)):
    """Cancel at the end of the current period. Maker keeps Plus benefits
    until then; webhook flips status to 'canceled' on actual termination.
    """
    if not STRIPE_API_KEY:
        raise HTTPException(503, "Stripe is not configured.")
    m = await db.makers.find_one({"slug": slug}, {"_id": 0})
    if not m or not m.get("stripe_subscription_id"):
        raise HTTPException(400, "No active subscription to cancel.")
    s = _stripe()
    sub = s.Subscription.modify(
        m["stripe_subscription_id"], cancel_at_period_end=True,
    )
    return {
        "status": "scheduled-cancel",
        "cancels_at": getattr(sub, "current_period_end", None),
    }


class PortalResp(BaseModel):
    url: str


@router.post("/maker/subscription/portal", response_model=PortalResp)
async def customer_portal(request: Request, slug: str = Depends(current_maker_slug)):
    """Stripe Customer Portal — lets the maker self-serve card updates,
    invoices, payment-method changes, and cancellation. Returns a single-use
    URL valid for ~30 minutes."""
    if not STRIPE_API_KEY:
        raise HTTPException(503, "Stripe is not configured.")
    m = await db.makers.find_one({"slug": slug}, {"_id": 0})
    if not m or not m.get("stripe_customer_id"):
        raise HTTPException(400, "Subscribe first to manage billing.")
    s = _stripe()
    return_url = f"{public_host(request)}/maker/dashboard?tab=billing"
    try:
        session = s.billing_portal.Session.create(
            customer=m["stripe_customer_id"],
            return_url=return_url,
        )
    except stripe.error.InvalidRequestError as e:
        # "No configuration provided" is the most common — Stripe portal
        # requires a one-time dashboard configuration.
        msg = str(getattr(e, "user_message", None) or e)
        logger.warning("billing portal config missing for maker=%s: %s", slug, msg)
        raise HTTPException(
            502,
            "Billing portal is not configured yet. Configure it in your "
            "Stripe dashboard at Settings → Billing → Customer Portal.",
        )
    except stripe.error.StripeError as e:
        logger.exception("billing portal Stripe error for maker=%s: %s", slug, e)
        raise HTTPException(502, "Billing portal is temporarily unavailable.")
    return {"url": session.url}


@router.get("/maker/subscription")
async def get_subscription(slug: str = Depends(current_maker_slug)):
    m = await db.makers.find_one({"slug": slug}, {"_id": 0})
    if not m:
        raise HTTPException(404, "Maker not found.")
    return {
        "status": m.get("subscription_status", "free"),
        "renews_at": m.get("subscription_renews_at"),
        "started_at": m.get("subscription_started_at"),
        "stripe_subscription_id": m.get("stripe_subscription_id"),
        "plan": {
            "name": "Crafters Plus",
            "price_usd": PLUS_PRICE_USD,
            "monthly_listing_quota": PLUS_MONTHLY_LISTING_QUOTA,
            "commission_bps": PLUS_PLATFORM_FEE_BPS,
            "perks": [
                f"{PLUS_MONTHLY_LISTING_QUOTA} free listings/month",
                f"{PLUS_PLATFORM_FEE_BPS / 100:.1f}% commission (vs 5%)",
                "Advanced shop analytics",
                "Custom shop banner image",
                "Off-site ad surcharge waived (when opted in)",
            ],
        },
    }


# ---------------- Webhook handlers (called from stripe_connect.py) -----------

async def handle_subscription_event(event_type: str, obj: dict) -> bool:
    """Returns True if handled. Dispatch table for subscription lifecycle."""
    if event_type in ("customer.subscription.created", "customer.subscription.updated"):
        await _sync_sub_to_maker(obj)
        return True
    if event_type == "customer.subscription.deleted":
        await _on_sub_deleted(obj)
        return True
    return False


def _maker_slug_from_sub(obj: dict) -> Optional[str]:
    md = obj.get("metadata") or {}
    return md.get("maker_slug")


async def _sync_sub_to_maker(obj: dict) -> None:
    slug = _maker_slug_from_sub(obj)
    if not slug:
        # Fallback: lookup by customer
        customer_id = obj.get("customer")
        if not customer_id:
            return
        m = await db.makers.find_one({"stripe_customer_id": customer_id}, {"_id": 0})
        if not m:
            return
        slug = m["slug"]
    status = obj.get("status") or "active"
    # Stripe statuses: active, past_due, unpaid, canceled, incomplete, trialing
    persisted_status = "active" if status in ("active", "trialing") else status
    period_end = obj.get("current_period_end")
    period_start = obj.get("current_period_start") or obj.get("start_date")
    from datetime import datetime, timezone
    await db.makers.update_one(
        {"slug": slug},
        {"$set": {
            "subscription_status": persisted_status,
            "stripe_subscription_id": obj.get("id"),
            "subscription_renews_at": (
                datetime.fromtimestamp(period_end, tz=timezone.utc).isoformat()
                if period_end else None
            ),
            "subscription_started_at": (
                datetime.fromtimestamp(period_start, tz=timezone.utc).isoformat()
                if period_start else None
            ),
        }},
    )
    logger.info("plus subscription synced for maker=%s status=%s",
                slug, persisted_status)


async def _on_sub_deleted(obj: dict) -> None:
    slug = _maker_slug_from_sub(obj)
    if not slug:
        return
    await db.makers.update_one(
        {"slug": slug},
        {"$set": {
            "subscription_status": "canceled",
            "stripe_subscription_id": None,
            "subscription_renews_at": None,
        }},
    )
    logger.info("plus subscription canceled for maker=%s", slug)
