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

# Crafters Plus introductory trial — every brand-new Plus signup gets
# this many free days before Stripe begins billing. Tracked on the
# maker (`plus_trial_used`) so cancel/re-subscribe can't double-dip.
PLUS_TRIAL_DAYS = 90


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

    # New makers (never used the trial before) get a 3-month free trial.
    # Stripe still collects a card so it can auto-convert when the trial
    # ends. If the maker already used their trial (re-subscribing after
    # cancel), they go straight to paid.
    trial_eligible = not bool(m.get("plus_trial_used"))
    sub_data: dict = {"metadata": {"maker_slug": slug}}
    if trial_eligible:
        sub_data["trial_period_days"] = PLUS_TRIAL_DAYS
        # If a card fails or the maker abandons mid-trial, cancel the
        # subscription rather than leave it past_due. Plus benefits drop
        # cleanly back to free.
        sub_data["trial_settings"] = {
            "end_behavior": {"missing_payment_method": "cancel"},
        }

    session = s.checkout.Session.create(
        mode="subscription",
        customer=customer_id,
        line_items=[{"price": price_id, "quantity": 1}],
        success_url=success_url,
        cancel_url=cancel_url,
        metadata={
            "maker_slug": slug,
            "kind": "plus_subscription",
            "trial_eligible": "true" if trial_eligible else "false",
        },
        subscription_data=sub_data,
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
    is_in_trial = bool(m.get("is_in_trial"))
    # Days remaining in the trial (clamped to >=0). Helps the UI show
    # "Trial ends in 47 days" without recomputing on the frontend.
    trial_days_remaining = None
    trial_end_at = m.get("trial_end_at")
    if is_in_trial and trial_end_at:
        try:
            from datetime import datetime, timezone
            end_dt = datetime.fromisoformat(trial_end_at.replace("Z", "+00:00"))
            now_dt = datetime.now(tz=timezone.utc)
            secs = max(0, int((end_dt - now_dt).total_seconds()))
            trial_days_remaining = secs // 86400
        except Exception:
            trial_days_remaining = None
    return {
        "status": m.get("subscription_status", "free"),
        "renews_at": m.get("subscription_renews_at"),
        "started_at": m.get("subscription_started_at"),
        "stripe_subscription_id": m.get("stripe_subscription_id"),
        "is_in_trial": is_in_trial,
        "trial_end_at": trial_end_at,
        "trial_days_remaining": trial_days_remaining,
        "trial_eligible": not bool(m.get("plus_trial_used")),
        "trial_days": PLUS_TRIAL_DAYS,
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


@router.post("/maker/billing/settle-now")
async def settle_now(slug: str = Depends(current_maker_slug)):
    """Plus-only: invoice this maker's pending listing/promo balance now,
    instead of waiting for the monthly cron sweep.

    Useful for makers cleaning up their ledger before a tax filing or
    before pausing Plus. Idempotent within a calendar month — second
    invocation in the same `YYYY-MM` returns 409 with the existing
    Stripe invoice id.

    Free-tier makers can't use this (no card on file). Their balance
    keeps draining sale-by-sale through the existing Stripe Connect
    transfer settlement.
    """
    if not STRIPE_API_KEY:
        raise HTTPException(503, "Stripe is not configured.")
    m = await db.makers.find_one({"slug": slug}, {"_id": 0})
    if not m:
        raise HTTPException(404, "Maker not found.")
    if m.get("subscription_status") != "active":
        raise HTTPException(
            400,
            "Settle-now requires an active Crafters Plus subscription "
            "(card on file). Free-tier balances drain from sale payouts.",
        )
    if not m.get("stripe_customer_id"):
        raise HTTPException(
            400,
            "No Stripe customer on file. Open Manage billing first to "
            "register a card, then try again.",
        )
    pending = int(m.get("pending_charges_cents") or 0)
    if pending <= 0:
        raise HTTPException(400, "Nothing to settle — your ledger is at $0.")
    from charge_clearing import (
        MIN_CLEAR_CENTS, _batch_key, _already_cleared,
    )
    if pending < MIN_CLEAR_CENTS:
        raise HTTPException(
            400,
            f"Balance is below the ${MIN_CLEAR_CENTS / 100:.2f} minimum — "
            "Stripe's per-invoice fee would eat the entire collection. "
            "Wait until your balance is above the threshold.",
        )
    batch = _batch_key()
    if await _already_cleared(slug, batch):
        # Find the existing invoice id from charge_history.
        history = list(reversed(m.get("charge_history") or []))
        existing = next(
            (h for h in history
             if h.get("kind") == "charge_clearing" and h.get("batch") == batch),
            None,
        )
        raise HTTPException(409, {
            "code": "already_cleared_this_month",
            "message": "You've already settled your ledger this month.",
            "batch": batch,
            "invoice_id": (existing or {}).get("invoice_id"),
        })

    # Drive the same code path as the monthly cron, but for this single
    # maker. We temporarily inline the per-maker logic so we don't have
    # to query every Plus maker just to bill one of them.
    s = _stripe()
    try:
        s.InvoiceItem.create(
            customer=m["stripe_customer_id"],
            amount=pending,
            currency="usd",
            description=f"Listing + promotion fees through {batch} (settle-now)",
            metadata={
                "maker_slug": slug,
                "kind": "charge_clearing",
                "batch": batch,
                "trigger": "settle_now",
            },
        )
        inv = s.Invoice.create(
            customer=m["stripe_customer_id"],
            auto_advance=True,
            collection_method="charge_automatically",
            description=(
                f"Crafters Market listing + promotion fees ({batch}). "
                "Manual settle-now invoice."
            ),
            metadata={
                "maker_slug": slug, "kind": "charge_clearing",
                "batch": batch, "trigger": "settle_now",
            },
        )
        try:
            s.Invoice.finalize_invoice(inv.id)
        except Exception:
            pass
    except Exception as e:
        logger.exception("[settle_now] stripe invoice failed maker=%s: %s", slug, e)
        raise HTTPException(502, "Couldn't create the Stripe invoice. Try again in a moment.")

    await db.makers.update_one(
        {"slug": slug},
        {
            "$set": {"pending_charges_cents": 0},
            "$push": {"charge_history": {
                "kind": "charge_clearing",
                "slug": None,
                "amount_cents": -pending,
                "ts": now_iso(),
                "batch": batch,
                "invoice_id": inv.id,
                "trigger": "settle_now",
                "note": f"Manual settle-now invoiced {pending}c to Stripe ({batch})",
            }},
        },
    )
    logger.info("[settle_now] maker=%s amount=%sc invoice=%s batch=%s",
                slug, pending, inv.id, batch)
    return {
        "ok": True,
        "amount_cents": pending,
        "batch": batch,
        "invoice_id": inv.id,
        "hosted_invoice_url": getattr(inv, "hosted_invoice_url", None),
    }


@router.get("/maker/payout-schedule")
async def get_payout_schedule(slug: str = Depends(current_maker_slug)):
    """Return the maker's current Stripe Connect payout schedule so the
    Billing tab can show "Weekly · Friday · 7 day delay" instead of an
    opaque "your bank gets paid eventually" message.

    Falls back to the env-default schedule (used at account creation
    time) when the maker hasn't connected Stripe yet — same numbers
    they'll get when they do.
    """
    m = await db.makers.find_one({"slug": slug}, {"_id": 0})
    if not m:
        raise HTTPException(404, "Maker not found.")

    # Defaults (mirror stripe_connect.connect_onboard).
    default_interval = os.environ.get("MAKER_PAYOUT_INTERVAL", "weekly").lower()
    default_delay = int(os.environ.get("MAKER_PAYOUT_DELAY_DAYS", "7"))
    default_anchor = os.environ.get("MAKER_PAYOUT_WEEKLY_ANCHOR", "friday")

    if not m.get("stripe_account_id") or not STRIPE_API_KEY:
        return {
            "connected": bool(m.get("stripe_account_id")),
            "source": "default",
            "interval": default_interval,
            "delay_days": default_delay,
            "weekly_anchor": default_anchor if default_interval == "weekly" else None,
            "monthly_anchor": None,
            "payouts_enabled": bool(m.get("stripe_payouts_enabled")),
        }
    try:
        s = _stripe()
        acct = s.Account.retrieve(m["stripe_account_id"])
        sched = (getattr(acct, "settings", None) or {}).get("payouts", {}).get("schedule") or {}
        return {
            "connected": True,
            "source": "stripe",
            "interval": sched.get("interval") or default_interval,
            "delay_days": int(sched.get("delay_days") if sched.get("delay_days") is not None else default_delay),
            "weekly_anchor": sched.get("weekly_anchor"),
            "monthly_anchor": sched.get("monthly_anchor"),
            "payouts_enabled": bool(getattr(acct, "payouts_enabled", False)),
        }
    except Exception as e:
        logger.warning("payout-schedule fetch failed for maker=%s: %s", slug, e)
        return {
            "connected": True,
            "source": "default",
            "interval": default_interval,
            "delay_days": default_delay,
            "weekly_anchor": default_anchor if default_interval == "weekly" else None,
            "monthly_anchor": None,
            "payouts_enabled": bool(m.get("stripe_payouts_enabled")),
            "error": "stripe-unreachable",
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
    if event_type == "customer.subscription.trial_will_end":
        # Stripe fires this ~3 days before the trial converts. We send a
        # heads-up email so the maker can either confirm their card or
        # cancel before being charged.
        await _on_trial_will_end(obj)
        return True
    if event_type == "invoice.payment_succeeded":
        # Charge-clearing invoices stamp metadata.kind = "charge_clearing".
        # We zero the ledger inside `clear_plus_ledger_balances` already,
        # so all this hook does is log the confirmed payment for auditing.
        md = obj.get("metadata") or {}
        if md.get("kind") == "charge_clearing":
            slug = md.get("maker_slug")
            amt_cents = int(obj.get("amount_paid") or 0)
            if slug:
                await db.makers.update_one(
                    {"slug": slug},
                    {"$push": {"charge_history": {
                        "kind": "charge_clearing_paid",
                        "slug": None,
                        "amount_cents": -amt_cents,
                        "ts": now_iso(),
                        "batch": md.get("batch"),
                        "invoice_id": obj.get("id"),
                        "note": f"Stripe confirmed charge-clearing invoice paid ({amt_cents}c)",
                    }}},
                )
                logger.info(
                    "charge_clearing invoice paid maker=%s amount=%sc batch=%s",
                    slug, amt_cents, md.get("batch"),
                )
            return True
        # Sub-renewal invoices fall through (status sync handled above).
        return False
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
    trial_start_ts = obj.get("trial_start")
    trial_end_ts = obj.get("trial_end")
    from datetime import datetime, timezone

    def _iso(ts):
        return (
            datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
            if ts else None
        )

    update: dict = {
        "subscription_status": persisted_status,
        "stripe_subscription_id": obj.get("id"),
        "subscription_renews_at": _iso(period_end),
        "subscription_started_at": _iso(period_start),
        "is_in_trial": status == "trialing",
        "trial_start_at": _iso(trial_start_ts),
        "trial_end_at": _iso(trial_end_ts),
    }
    # First time we see a subscription with a trial attached, lock the
    # maker out of future trials. Idempotent: $set is fine even if it
    # was already true.
    if trial_end_ts:
        update["plus_trial_used"] = True

    await db.makers.update_one({"slug": slug}, {"$set": update})
    logger.info(
        "plus subscription synced for maker=%s status=%s trialing=%s trial_end=%s",
        slug, persisted_status, status == "trialing", _iso(trial_end_ts),
    )

    # Trial referral attribution — credit the referrer when this maker
    # reaches Plus (active or trialing). Idempotent: the helper guards
    # against double-counting via `maker.referral_credited_at`.
    if persisted_status == "active":
        try:
            from routers.referrals import credit_referrer_on_subscribe
            await credit_referrer_on_subscribe(slug)
        except Exception as e:
            logger.exception(
                "plus referral credit hook failed maker=%s: %s", slug, e,
            )


async def _on_trial_will_end(obj: dict) -> None:
    """Send the maker a 'trial ends in 3 days' email so they aren't
    surprised by the conversion charge."""
    slug = _maker_slug_from_sub(obj)
    if not slug:
        customer_id = obj.get("customer")
        if customer_id:
            m = await db.makers.find_one({"stripe_customer_id": customer_id}, {"_id": 0})
            if m:
                slug = m["slug"]
    if not slug:
        return
    m = await db.makers.find_one({"slug": slug}, {"_id": 0})
    if not m or not m.get("email"):
        return
    trial_end_ts = obj.get("trial_end")
    try:
        from email_service import send_maker_trial_ending_soon
        await send_maker_trial_ending_soon(
            maker_email=m["email"],
            maker_name=m.get("name") or m["slug"],
            trial_end_ts=trial_end_ts,
        )
        logger.info("plus trial_will_end email sent maker=%s", slug)
    except Exception as e:
        logger.exception("plus trial_will_end email failed maker=%s: %s", slug, e)


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
            "is_in_trial": False,
        }},
    )
    logger.info("plus subscription canceled for maker=%s", slug)
