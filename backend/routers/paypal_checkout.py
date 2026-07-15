from config import env_get
"""iter438 — PayPal Checkout (Orders v2), sandbox-first, alongside Stripe.

Server-authoritative flow (browser totals are never trusted):
  POST /api/paypal/checkout/orders           → resolve cart + quote + discount
                                               SERVER-side, create PayPal order
  POST /api/paypal/checkout/orders/{id}/capture → capture on the server,
                                               persist result
  GET  /api/paypal/checkout/config           → public client-id for the JS SDK

Reconciliation: PAYMENT.CAPTURE.COMPLETED webhooks (routers/paypal_webhooks)
match db.paypal_orders via custom_id and stamp `reconciled=True`.
Stripe checkout is untouched — PayPal is an additive second option.
"""
import os
import uuid

import httpx
from fastapi import APIRouter, HTTPException

from core import db, logger, now_iso

from .checkout import CheckoutRequest, _quote_for, _resolve_cart, _resolve_discount
from .paypal_finalize import finalize_paypal_order, record_paypal_fees
from .paypal_webhooks import _access_token, _config, paypal_configured

router = APIRouter()


def _cents(v: float) -> int:
    return int(round(float(v) * 100))


def _usd(cents: int) -> str:
    return f"{cents / 100:.2f}"


@router.get("/paypal/checkout/config")
async def paypal_checkout_config():
    cfg = _config()
    # iter440 — PayPal stays hidden from normal buyers until parity is
    # signed off. Testers force-show via localStorage cm_pp_test=1
    # (checked client-side against `tester_enabled`).
    public = (env_get("PAYPAL_PUBLIC_ENABLED") or "false").strip().lower() == "true"
    return {
        "enabled": paypal_configured() and public,
        "tester_enabled": paypal_configured(),
        "environment": cfg["env"],
        "client_id": cfg["client_id"],  # public identifier, safe for the browser
        "currency": "USD",
    }


@router.post("/paypal/checkout/orders")
async def create_paypal_order(req: CheckoutRequest):
    if not paypal_configured():
        raise HTTPException(503, "PayPal checkout is not configured.")
    if not req.items:
        raise HTTPException(400, "Cart is empty")
    if not req.policy_accepted:
        raise HTTPException(400, "You must accept the Site Policies to checkout.")

    # Server-side pricing — identical rules to the Stripe path.
    resolved = await _resolve_cart(req.items)
    quote = _quote_for(resolved)
    if quote["total_before_tax"] <= 0:
        raise HTTPException(400, "Invalid total")

    discount_doc, discount_amount = None, 0.0
    if (req.discount_code or "").strip():
        discount_doc, discount_amount, derr = await _resolve_discount(
            req.discount_code, resolved, quote,
        )
        if derr or not discount_doc:
            raise HTTPException(400, f"Discount code rejected: {derr or 'unknown error'}")

    item_total_c = sum(_cents(r["product"]["price"]) * r["quantity"] for r in resolved)
    shipping_c = _cents(quote["shipping"])
    discount_c = min(_cents(discount_amount), item_total_c)
    total_c = item_total_c + shipping_c - discount_c
    if total_c < 50:
        raise HTTPException(400, "Order total must be at least $0.50.")

    internal_id = uuid.uuid4().hex
    items_payload = [
        {
            "name": (r["product"]["title"] or "Item")[:127],
            "quantity": str(r["quantity"]),
            "unit_amount": {"currency_code": "USD", "value": _usd(_cents(r["product"]["price"]))},
        }
        for r in resolved
    ]
    order_payload = {
        "intent": "CAPTURE",
        "purchase_units": [{
            "reference_id": internal_id,
            "custom_id": internal_id,
            "invoice_id": f"CM-PP-{internal_id[:12]}",
            "description": "Crafters Market order",
            "items": items_payload,
            "amount": {
                "currency_code": "USD",
                "value": _usd(total_c),
                "breakdown": {
                    "item_total": {"currency_code": "USD", "value": _usd(item_total_c)},
                    "shipping": {"currency_code": "USD", "value": _usd(shipping_c)},
                    "discount": {"currency_code": "USD", "value": _usd(discount_c)},
                },
            },
        }],
    }

    cfg = _config()
    token = await _access_token(cfg)
    async with httpx.AsyncClient(timeout=25) as client:
        r = await client.post(
            f"{cfg['base']}/v2/checkout/orders",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json",
                     "PayPal-Request-Id": internal_id},
            json=order_payload,
        )
    if r.status_code not in (200, 201):
        logger.error("[paypal-checkout] create order failed · HTTP %s", r.status_code)
        raise HTTPException(502, "PayPal could not create the order — please try again.")
    pp = r.json()
    paypal_order_id = pp["id"]

    await db.paypal_orders.insert_one({
        "id": internal_id,
        "paypal_order_id": paypal_order_id,
        "environment": cfg["env"],
        "status": "created",
        "items": [
            {
                "product_id": r["product"].get("id"),
                "title": r["product"].get("title"),
                "price": r["product"].get("price"),
                "quantity": r["quantity"],
                "maker_slug": r["product"].get("maker_slug") or r["product"].get("shop_slug"),
            }
            for r in resolved
        ],
        # iter440 — raw cart lines (variant/personalization/custom options)
        # in the exact shape Stripe stores on payment_transactions, so the
        # finalize pipeline can create an identical order record.
        "cart_items": [ci.model_dump() for ci in req.items],
        "summary": " | ".join(f"{r['product']['title']} × {r['quantity']}" for r in resolved),
        "quote": {k: quote.get(k) for k in ("subtotal", "shipping", "total_before_tax", "digital_only")},
        "discount_code": (req.discount_code or "").strip() or None,
        "amounts_cents": {"item_total": item_total_c, "shipping": shipping_c,
                          "discount": discount_c, "total": total_c},
        "customer_email": (req.customer_email or "").lower() or None,
        "shipping_address": req.shipping_address.dict() if getattr(req, "shipping_address", None) else None,
        "gift_note": getattr(req, "gift_note", None),
        "policy_version": getattr(req, "policy_version", None),
        "reconciled": False,
        "created_at": now_iso(),
    })
    logger.info("[paypal-checkout] order created · internal=%s · paypal=%s · total=%s",
                internal_id, paypal_order_id, _usd(total_c))
    return {"paypal_order_id": paypal_order_id, "internal_id": internal_id, "total": _usd(total_c)}


@router.post("/paypal/checkout/orders/{paypal_order_id}/capture")
async def capture_paypal_order(paypal_order_id: str):
    if not paypal_configured():
        raise HTTPException(503, "PayPal checkout is not configured.")
    doc = await db.paypal_orders.find_one({"paypal_order_id": paypal_order_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Unknown PayPal order.")
    if doc["status"] == "captured":
        # Duplicate capture callback — finalize is idempotent (atomic claim),
        # so this self-heals a first callback that captured but crashed
        # before finalizing, without ever duplicating side effects.
        await finalize_paypal_order(doc["id"], trigger="capture_callback_repeat")
        return {"status": "captured", "internal_id": doc["id"], "capture_id": doc.get("capture_id"),
                "total": _usd(doc["amounts_cents"]["total"])}

    cfg = _config()
    token = await _access_token(cfg)
    async with httpx.AsyncClient(timeout=25) as client:
        r = await client.post(
            f"{cfg['base']}/v2/checkout/orders/{paypal_order_id}/capture",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json",
                     "PayPal-Request-Id": f"cap-{doc['id']}"},
        )
    body = r.json() if r.content else {}
    already = any(
        d.get("issue") == "ORDER_ALREADY_CAPTURED" for d in (body.get("details") or [])
    )
    if r.status_code not in (200, 201) and not already:
        logger.error("[paypal-checkout] capture failed · order=%s · HTTP %s", paypal_order_id, r.status_code)
        raise HTTPException(502, "PayPal could not capture the payment — please try again.")

    pu = (body.get("purchase_units") or [{}])[0]
    captures = ((pu.get("payments") or {}).get("captures") or [{}])
    cap = captures[0]
    cap_status = (cap.get("status") or body.get("status") or "").upper()
    if not already and cap_status not in ("COMPLETED", "PENDING"):
        logger.warning("[paypal-checkout] capture not completed · order=%s · status=%s",
                       paypal_order_id, cap_status)
        raise HTTPException(402, "Payment was not completed.")

    payer = body.get("payer") or {}
    update = {
        "status": "captured",
        "capture_id": cap.get("id"),
        "capture_status": cap_status or "COMPLETED",
        "payer_email": (payer.get("email_address") or "").lower() or None,
        "payer_id": payer.get("payer_id"),
        "captured_at": now_iso(),
    }
    await db.paypal_orders.update_one({"paypal_order_id": paypal_order_id}, {"$set": update})
    logger.info("[paypal-checkout] captured · internal=%s · capture=%s", doc["id"], cap.get("id"))

    # iter440 — record PayPal's actual fee breakdown + run the full paid-order
    # pipeline (order record, stock, commission, emails). Idempotent.
    srb = cap.get("seller_receivable_breakdown")
    if srb:
        await record_paypal_fees(doc["id"], srb)
    captured_cents = None
    try:
        captured_cents = int(round(float((cap.get("amount") or {}).get("value")) * 100))
    except (TypeError, ValueError):
        pass
    fin = await finalize_paypal_order(doc["id"], trigger="capture_callback",
                                      captured_amount_cents=captured_cents)
    if fin.startswith("amount_mismatch"):
        raise HTTPException(409, "Payment amount did not match the order total — contact support.")
    return {"status": "captured", "internal_id": doc["id"], "capture_id": cap.get("id"),
            "total": _usd(doc["amounts_cents"]["total"])}
