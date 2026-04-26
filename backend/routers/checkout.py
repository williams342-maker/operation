"""Stripe checkout: cart quote, session creation, status polling, webhook handler."""
import os
import uuid
from emergentintegrations.payments.stripe.checkout import StripeCheckout
from fastapi import APIRouter, BackgroundTasks, HTTPException, Request

from core import STRIPE_API_KEY, db, logger, now_iso, public_host
from email_service import (
    send_buyer_receipt, send_maker_low_stock,
    send_maker_new_order, send_ops_new_order,
)
from models import ActivityEvent, CheckoutRequest

router = APIRouter()

LOW_STOCK_THRESHOLD = int(os.environ.get("LOW_STOCK_THRESHOLD", "3"))


async def _decrement_stock_and_collect_low(
    items: list, by_maker_slug: dict
) -> dict[str, list[dict]]:
    """Decrement product / variant stock for a paid order. For any listing
    whose remaining stock falls below `LOW_STOCK_THRESHOLD`, append a row to
    the returned dict keyed by maker_slug. Idempotency: callers should run this
    only once per session (gated upstream by `payment_status` transition).
    """
    low_by_maker: dict[str, list[dict]] = {s: [] for s in by_maker_slug.keys()}
    for ci in items:
        pid = ci.get("product_id")
        qty = max(1, int(ci.get("quantity", 1)))
        variant_id = ci.get("variant_id")
        prod = await db.products.find_one({"id": pid}, {"_id": 0}) \
            or await db.products.find_one({"slug": pid}, {"_id": 0})
        if not prod:
            continue
        slug = prod["slug"]
        maker_slug = prod.get("maker_slug")
        if variant_id and prod.get("variants"):
            # Decrement the matching variant's in_stock atomically.
            res = await db.products.update_one(
                {"slug": slug, "variants.id": variant_id},
                {"$inc": {"variants.$.in_stock": -qty}},
            )
            if res.modified_count:
                fresh = await db.products.find_one({"slug": slug}, {"_id": 0})
                v = next((x for x in (fresh.get("variants") or []) if x.get("id") == variant_id), None)
                if v and v.get("in_stock", 0) < LOW_STOCK_THRESHOLD:
                    low_by_maker.setdefault(maker_slug, []).append({
                        "title": f"{prod['title']} — {v.get('label', '')}",
                        "in_stock": max(0, v.get("in_stock", 0)),
                        "slug": slug,
                    })
        else:
            # No variant on the line: decrement product-level stock.
            res = await db.products.update_one(
                {"slug": slug},
                {"$inc": {"in_stock": -qty}},
            )
            if res.modified_count:
                fresh = await db.products.find_one({"slug": slug}, {"_id": 0})
                if fresh and fresh.get("in_stock", 0) < LOW_STOCK_THRESHOLD:
                    low_by_maker.setdefault(maker_slug, []).append({
                        "title": prod["title"],
                        "in_stock": max(0, fresh.get("in_stock", 0)),
                        "slug": slug,
                    })
    return low_by_maker

# ---- Shipping config ----
SHIPPING_BY_CATEGORY = {
    "Wall Art": 25.0,
    "Custom Signs": 35.0,
    "Outdoor Art": 55.0,
}
DEFAULT_SHIPPING = 30.0
FREE_SHIPPING_THRESHOLD = 250.0


async def _resolve_cart(items: list) -> list[dict]:
    """Resolve cart items to product docs + qty. Raises 400 on invalid items."""
    out = []
    for ci in items:
        pid = ci.product_id if hasattr(ci, "product_id") else ci.get("product_id")
        qty = ci.quantity if hasattr(ci, "quantity") else ci.get("quantity", 1)
        variant_id = (
            ci.variant_id if hasattr(ci, "variant_id")
            else ci.get("variant_id") if isinstance(ci, dict) else None
        )
        prod = await db.products.find_one({"id": pid}, {"_id": 0})
        if not prod:
            prod = await db.products.find_one({"slug": pid}, {"_id": 0})
        if not prod:
            raise HTTPException(400, f"Invalid product: {pid}")
        if prod.get("deleted_at"):
            raise HTTPException(
                410,            # Gone — listing was withdrawn after add-to-cart
                f"This listing is no longer available: {prod.get('title', pid)}",
            )
        if prod.get("status") == "draft":
            raise HTTPException(
                410, f"This listing is not available: {prod.get('title', pid)}"
            )

        # Variant resolution: if the product has variants OR a variant_id was
        # passed, the buyer must select one and the variant determines effective
        # price + stock.
        variant = None
        variants = prod.get("variants") or []
        if variants:
            if not variant_id:
                raise HTTPException(
                    400,
                    f"Please choose an option for {prod.get('title', pid)}.",
                )
            for v in variants:
                if v.get("id") == variant_id:
                    variant = v
                    break
            if not variant:
                raise HTTPException(400, "Selected variant no longer exists.")
            effective_price = float(prod["price"]) + float(variant.get("price_delta", 0))
            prod = {
                **prod,
                "price": round(effective_price, 2),
                "_variant_id": variant["id"],
                "_variant_label": variant.get("label", ""),
                "_base_title": prod.get("title", ""),
                "title": f"{prod.get('title', '')} — {variant.get('label', '')}",
            }
        out.append({"product": prod, "quantity": max(1, int(qty))})
    return out


def _quote_for(resolved: list[dict]) -> dict:
    subtotal = round(sum(r["product"]["price"] * r["quantity"] for r in resolved), 2)
    if subtotal >= FREE_SHIPPING_THRESHOLD:
        shipping = 0.0
    else:
        shipping = max(
            (SHIPPING_BY_CATEGORY.get(r["product"]["category"], DEFAULT_SHIPPING)
             for r in resolved),
            default=DEFAULT_SHIPPING,
        )
    shipping = round(shipping, 2)
    return {
        "subtotal": subtotal,
        "shipping": shipping,
        "free_shipping_threshold": FREE_SHIPPING_THRESHOLD,
        "free_shipping_eligible": subtotal >= FREE_SHIPPING_THRESHOLD,
        "total_before_tax": round(subtotal + shipping, 2),
    }


@router.post("/cart/quote")
async def cart_quote(req: CheckoutRequest):
    if not req.items:
        return {"subtotal": 0.0, "shipping": 0.0,
                "free_shipping_threshold": FREE_SHIPPING_THRESHOLD,
                "free_shipping_eligible": False, "total_before_tax": 0.0}
    resolved = await _resolve_cart(req.items)
    return _quote_for(resolved)


@router.post("/checkout/session")
async def create_checkout(req: CheckoutRequest, http_request: Request):
    if not req.items:
        raise HTTPException(400, "Cart is empty")
    resolved = await _resolve_cart(req.items)
    quote = _quote_for(resolved)
    if quote["total_before_tax"] <= 0:
        raise HTTPException(400, "Invalid total")

    success_url = f"{req.origin_url}/checkout/success?session_id={{CHECKOUT_SESSION_ID}}"
    cancel_url = f"{req.origin_url}/cart"

    import stripe as stripe_sdk
    stripe_sdk.api_key = STRIPE_API_KEY

    line_items = []
    for r in resolved:
        p = r["product"]
        line_items.append({
            "price_data": {
                "currency": "usd",
                "product_data": {
                    "name": p["title"],
                    "description": (p.get("description") or "")[:300],
                    "images": p.get("images", [])[:1],
                },
                "unit_amount": int(round(float(p["price"]) * 100)),
            },
            "quantity": r["quantity"],
        })

    if quote["shipping"] > 0:
        shipping_options = [{
            "shipping_rate_data": {
                "display_name": "Standard shipping",
                "type": "fixed_amount",
                "fixed_amount": {
                    "amount": int(round(quote["shipping"] * 100)),
                    "currency": "usd",
                },
                "delivery_estimate": {
                    "minimum": {"unit": "business_day", "value": 5},
                    "maximum": {"unit": "business_day", "value": 10},
                },
            }
        }]
    else:
        shipping_options = [{
            "shipping_rate_data": {
                "display_name": "Free shipping",
                "type": "fixed_amount",
                "fixed_amount": {"amount": 0, "currency": "usd"},
                "delivery_estimate": {
                    "minimum": {"unit": "business_day", "value": 5},
                    "maximum": {"unit": "business_day", "value": 10},
                },
            }
        }]

    line_summary = " | ".join(f"{r['product']['title']} × {r['quantity']}" for r in resolved)

    # transfer_group ties the charge to later Transfer.create() calls per-maker.
    # We use a deterministic pre-id (we don't know the session id yet) — Stripe
    # accepts any string. Replace with the real session.id after we have it.
    pre_transfer_group = f"order_{uuid.uuid4().hex}"

    session_kwargs = {
        "mode": "payment",
        "payment_method_types": ["card"],
        "line_items": line_items,
        "shipping_options": shipping_options,
        "shipping_address_collection": {"allowed_countries": ["US", "CA"]},
        "success_url": success_url,
        "cancel_url": cancel_url,
        "payment_intent_data": {
            "transfer_group": pre_transfer_group,
            "metadata": {"transfer_group": pre_transfer_group},
        },
        "metadata": {
            "summary": line_summary[:480],
            "customer_email": req.customer_email or "",
            "gift_note": (req.gift_note or "")[:480],
            "transfer_group": pre_transfer_group,
        },
    }
    try_with_tax = os.environ.get("STRIPE_AUTOMATIC_TAX", "true").lower() == "true"
    try:
        if try_with_tax:
            kwargs_tax = {**session_kwargs, "automatic_tax": {"enabled": True}}
            if req.customer_email:
                kwargs_tax["customer_email"] = req.customer_email
            session = stripe_sdk.checkout.Session.create(**kwargs_tax)
        else:
            raise RuntimeError("automatic_tax disabled by env")
    except Exception as e:  # pragma: no cover
        logger.warning("automatic_tax not available, retrying without it: %s", e)
        if req.customer_email:
            session_kwargs["customer_email"] = req.customer_email
        session = stripe_sdk.checkout.Session.create(**session_kwargs)

    total = quote["total_before_tax"]
    # Attribution: anything other than "internal"/empty is treated as off-site
    # for the 12% surcharge in stripe_connect transfers.
    attr_source = (req.attribution_source or "").strip()[:50] or None
    is_external = bool(attr_source) and attr_source.lower() not in ("internal", "direct", "self")
    await db.payment_transactions.insert_one({
        "id": str(uuid.uuid4()),
        "session_id": session.id,
        "amount": total,
        "subtotal": quote["subtotal"],
        "shipping": quote["shipping"],
        "currency": "usd",
        "items": [ci.model_dump() for ci in req.items],
        "summary": line_summary,
        "customer_email": req.customer_email,
        "gift_note": req.gift_note,
        "transfer_group": pre_transfer_group,
        "attribution_source": attr_source,
        "external_attribution": is_external,
        "payment_status": "initiated",
        "status": "open",
        "created_at": now_iso(),
    })
    return {"url": session.url, "session_id": session.id, "amount": total,
            "subtotal": quote["subtotal"], "shipping": quote["shipping"]}


@router.get("/checkout/status/{session_id}")
async def checkout_status(session_id: str, http_request: Request, bg: BackgroundTasks):
    tx = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})
    fallback_amount = int(round(float(tx["amount"]) * 100)) if tx and tx.get("amount") else 0

    # If our webhook already recorded this as paid, trust the DB — it's the
    # authoritative record of payment. Stripe sessions can expire/return stale
    # status long after the webhook fires.
    if tx and tx.get("payment_status") == "paid":
        return {
            "status": tx.get("status", "complete"),
            "payment_status": "paid",
            "amount_total": fallback_amount,
            "currency": tx.get("currency", "usd"),
        }

    try:
        import stripe as stripe_sdk
        stripe_sdk.api_key = STRIPE_API_KEY
        sess = stripe_sdk.checkout.Session.retrieve(session_id)
        result = {
            "status": getattr(sess, "status", None) or "open",
            "payment_status": getattr(sess, "payment_status", None) or "unpaid",
            "amount_total": getattr(sess, "amount_total", None) or 0,
            "currency": getattr(sess, "currency", None) or "usd",
        }
    except Exception as e:
        logger.warning("status retrieve failed (%s) — using local fallback", e)
        if not tx:
            return {"status": "open", "payment_status": "unpaid", "amount_total": 0, "currency": "usd"}
        result = {
            "status": tx.get("status", "open"),
            "payment_status": tx.get("payment_status", "unpaid"),
            "amount_total": fallback_amount,
            "currency": tx.get("currency", "usd"),
        }

    if tx and tx.get("payment_status") != result["payment_status"]:
        # Never downgrade an already-paid record (webhook is authoritative);
        # only persist transitions that move *toward* paid.
        if tx.get("payment_status") == "paid" and result["payment_status"] != "paid":
            return {
                "status": tx.get("status", "complete"),
                "payment_status": "paid",
                "amount_total": fallback_amount,
                "currency": tx.get("currency", "usd"),
            }
        await db.payment_transactions.update_one(
            {"session_id": session_id},
            {"$set": {"payment_status": result["payment_status"],
                      "status": result["status"],
                      "updated_at": now_iso()}}
        )
        if result["payment_status"] == "paid" and tx.get("payment_status") != "paid":
            summary = tx.get("summary", "Order")
            await db.activity_events.insert_one(
                ActivityEvent(kind="sold",
                              text=f"{summary} sold to a buyer",
                              location="Crafters Market").model_dump()
            )
            email_items = []
            by_maker: dict[str, list] = {}
            for ci in tx.get("items", []):
                p = await db.products.find_one({"id": ci["product_id"]}, {"_id": 0}) \
                    or await db.products.find_one({"slug": ci["product_id"]}, {"_id": 0})
                if not p:
                    continue
                m_doc = await db.makers.find_one(
                    {"slug": p["maker_slug"]}, {"_id": 0, "name": 1, "slug": 1},
                ) or {}
                line = {
                    "title": p["title"],
                    "price": p["price"],
                    "quantity": ci.get("quantity", 1),
                    "maker_slug": p["maker_slug"],
                    "maker_name": m_doc.get("name") or p["maker_slug"],
                }
                email_items.append(line)
                by_maker.setdefault(p["maker_slug"], []).append(line)
            buyer = tx.get("customer_email")
            total_amount = float(tx.get("amount", 0))
            bg.add_task(send_ops_new_order, summary, total_amount, email_items, buyer)
            if buyer:
                bg.add_task(send_buyer_receipt, buyer, summary, total_amount, email_items)
            for maker_slug, lines in by_maker.items():
                m = await db.makers.find_one({"slug": maker_slug}, {"_id": 0})
                if not m or not m.get("email"):
                    continue
                subtotal = sum(float(line["price"]) * int(line["quantity"]) for line in lines)
                bg.add_task(send_maker_new_order,
                            m["email"], m["name"], lines, subtotal, buyer)
            # Decrement stock & queue a low-stock email for any listing that
            # just crossed below LOW_STOCK_THRESHOLD (default 3).
            low_by_maker = await _decrement_stock_and_collect_low(
                tx.get("items", []), by_maker
            )
            for maker_slug, low_lines in low_by_maker.items():
                if not low_lines:
                    continue
                m = await db.makers.find_one({"slug": maker_slug}, {"_id": 0})
                if not m or not m.get("email"):
                    continue
                bg.add_task(send_maker_low_stock, m["email"], m["name"], low_lines)
            # Stripe Connect: transfer each maker's share to their connected acct
            from routers.stripe_connect import transfer_to_makers_for_session
            bg.add_task(transfer_to_makers_for_session, session_id)
    return result


@router.post("/webhook/stripe")
async def stripe_webhook(request: Request):
    body = await request.body()
    sig = request.headers.get("Stripe-Signature", "")
    host_url = public_host(request)
    webhook_url = f"{host_url}/api/webhook/stripe"
    stripe = StripeCheckout(api_key=STRIPE_API_KEY, webhook_url=webhook_url)
    try:
        evt = await stripe.handle_webhook(body, sig)
    except Exception as e:
        logger.exception("webhook fail: %s", e)
        return {"received": False}
    # Update local payment_transactions row (regular product purchases)
    await db.payment_transactions.update_one(
        {"session_id": evt.session_id},
        {"$set": {"payment_status": evt.payment_status, "updated_at": now_iso()}}
    )
    # Also activate any download unlocks tied to this session.
    if evt.payment_status == "paid":
        await db.download_unlocks.update_one(
            {"session_id": evt.session_id, "status": "pending"},
            {"$set": {"status": "active", "activated_at": now_iso()}},
        )
        # Stripe Connect: transfer each maker's share for this session.
        try:
            from routers.stripe_connect import transfer_to_makers_for_session
            await transfer_to_makers_for_session(evt.session_id)
        except Exception as e:
            logger.exception("connect transfer failed: %s", e)
    return {"received": True}
