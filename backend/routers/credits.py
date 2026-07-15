"""Listing-credit packs — one-time Stripe Checkout purchases that pre-pay
listing fees in bulk (cheaper than per-listing $0.20 cash settlements).

Pricing tiers (env-overridable):
  - 10 credits  → $1.50  (saves $0.50 vs cash · 25% off)
  - 50 credits  → $7.00  (saves $3.00 vs cash · 30% off)
  - 200 credits → $24.00 (saves $16.00 vs cash · 40% off)

Credits land on `maker.listing_credits` and are burned BEFORE accruing cash
fees in `revenue.accrue_listing_charge`. Credits never expire.
"""
from __future__ import annotations
from config import env_get
import os

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from core import db, logger, now_iso, public_host
from maker_auth import current_maker_slug
from routers.subscriptions import _stripe

router = APIRouter()

# pack_id → (credits, price_cents, label)
CREDIT_PACKS: dict[str, tuple[int, int, str]] = {
    "small":  (int(env_get("CREDIT_PACK_SMALL_QTY", "10")),
               int(env_get("CREDIT_PACK_SMALL_CENTS", "150")),
               "10-pack · $1.50"),
    "medium": (int(env_get("CREDIT_PACK_MEDIUM_QTY", "50")),
               int(env_get("CREDIT_PACK_MEDIUM_CENTS", "700")),
               "50-pack · $7.00"),
    "large":  (int(env_get("CREDIT_PACK_LARGE_QTY", "200")),
               int(env_get("CREDIT_PACK_LARGE_CENTS", "2400")),
               "200-pack · $24.00"),
}


class StartCreditCheckoutResp(BaseModel):
    checkout_url: str


@router.get("/maker/credits/packs")
async def list_credit_packs(slug: str = Depends(current_maker_slug)):
    """Surface available packs + the maker's current credit balance.
    Used by the BillingTab to render the buy buttons + "Credits: 12" pill."""
    m = await db.makers.find_one({"slug": slug}, {"_id": 0, "slug": 1, "listing_credits": 1})
    if not m:
        raise HTTPException(404, "Maker not found.")
    return {
        "current_credits": int(m.get("listing_credits", 0) or 0),
        "packs": [
            {
                "id": pack_id, "credits": qty, "price_cents": cents,
                "price_usd": cents / 100.0, "label": label,
                "per_credit_cents": round(cents / qty, 2),
            }
            for pack_id, (qty, cents, label) in CREDIT_PACKS.items()
        ],
    }


@router.post("/maker/credits/checkout", response_model=StartCreditCheckoutResp)
async def start_credit_checkout(
    request: Request, pack: str, slug: str = Depends(current_maker_slug),
):
    """Create a Stripe Checkout session for a one-time credit pack purchase.
    On success the maker is redirected back with `?credits=success&session_id=…`,
    which the frontend POSTs to `/maker/credits/finalize` to grant credits.
    """
    api_key = env_get("STRIPE_API_KEY")
    if not api_key:
        raise HTTPException(503, "Stripe is not configured.")
    pack_id = (pack or "").lower()
    if pack_id not in CREDIT_PACKS:
        raise HTTPException(400, f"Unknown pack '{pack}'. "
                                  f"Available: {', '.join(CREDIT_PACKS)}")
    m = await db.makers.find_one({"slug": slug}, {"_id": 0})
    if not m:
        raise HTTPException(404, "Maker not found.")

    qty, cents, label = CREDIT_PACKS[pack_id]
    s = _stripe()
    host = public_host(request)

    session = s.checkout.Session.create(
        mode="payment",
        # `customer_email` (not `customer`) so makers without a Plus sub can
        # still buy credits without forcing customer creation.
        customer_email=m.get("email"),
        line_items=[{
            "price_data": {
                "currency": "usd",
                "product_data": {
                    "name": f"Crafters Market · {label}",
                    "description": f"{qty} listing credits — pre-paid, never expire",
                },
                "unit_amount": cents,
            },
            "quantity": 1,
        }],
        success_url=f"{host}/maker/dashboard?tab=billing&credits=success&session_id={{CHECKOUT_SESSION_ID}}",
        cancel_url=f"{host}/maker/dashboard?tab=billing&credits=canceled",
        metadata={"maker_slug": slug, "kind": "listing_credits",
                  "pack_id": pack_id, "qty": str(qty)},
        payment_intent_data={"metadata": {"maker_slug": slug, "kind": "listing_credits",
                                          "pack_id": pack_id, "qty": str(qty)}},
    )

    # Track the pending purchase so finalize can be idempotent + audit-trailable.
    await db.credit_pack_purchases.insert_one({
        "session_id": session.id,
        "maker_slug": slug,
        "pack_id": pack_id,
        "qty": qty,
        "amount_cents": cents,
        "status": "pending",
        "created_at": now_iso(),
    })
    logger.info("credit-pack checkout opened: maker=%s pack=%s qty=%d",
                slug, pack_id, qty)
    return {"checkout_url": session.url}


@router.post("/maker/credits/finalize")
async def finalize_credit_purchase(session_id: str, slug: str = Depends(current_maker_slug)):
    """Idempotent: verify Stripe session is paid, grant credits once.
    Frontend calls this from the BillingTab when it sees `?credits=success&session_id=…`.
    """
    purchase = await db.credit_pack_purchases.find_one(
        {"session_id": session_id, "maker_slug": slug}, {"_id": 0},
    )
    if not purchase:
        raise HTTPException(404, "Purchase not found.")
    if purchase["status"] == "fulfilled":
        # Already granted — return current state without double-crediting.
        m = await db.makers.find_one({"slug": slug}, {"_id": 0, "listing_credits": 1})
        return {"already_fulfilled": True,
                "credits": int((m or {}).get("listing_credits", 0))}

    # Verify with Stripe before crediting.
    s = _stripe()
    sess = s.checkout.Session.retrieve(session_id)
    if sess.get("payment_status") != "paid":
        raise HTTPException(402, f"Payment not complete (status={sess.get('payment_status')}).")

    qty = int(purchase["qty"])
    await db.credit_pack_purchases.update_one(
        {"session_id": session_id},
        {"$set": {"status": "fulfilled", "fulfilled_at": now_iso()}},
    )
    await db.makers.update_one(
        {"slug": slug},
        {
            "$inc": {"listing_credits": qty},
            "$push": {"charge_history": {
                "kind": "credits_purchased",
                "slug": purchase["pack_id"],
                "amount_cents": -int(purchase["amount_cents"]),  # negative = inflow
                "ts": now_iso(),
                "note": f"Bought {qty} listing credits ({purchase['pack_id']} pack)",
            }},
        },
    )
    m = await db.makers.find_one({"slug": slug}, {"_id": 0, "listing_credits": 1})
    new_balance = int((m or {}).get("listing_credits", 0))
    logger.info("credit-pack fulfilled: maker=%s qty=%d new_balance=%d",
                slug, qty, new_balance)
    return {"already_fulfilled": False, "credited": qty, "credits": new_balance}
