"""iter440 — PayPal order-pipeline parity with Stripe.

A successfully captured PayPal order flows through the SAME downstream
workflow as a Stripe-paid order:
  • payment_transactions record (session_id = pp_<internal_id>) so buyer,
    maker, admin order views + sales analytics all pick it up automatically
  • inventory decremented exactly once (atomic finalize claim)
  • marketplace commission recorded per maker in db.maker_payouts —
    commission is calculated from the GROSS maker subtotal (identical to the
    Stripe policy in stripe_connect.fee_breakdown_cents); PayPal's actual
    processing fee (gross/fee/net) is recorded separately for accounting
  • buyer receipt + maker new-order + ops emails (once only)
  • activity ticker + admin push + digital delivery + discount bookkeeping
  • refund / reversal / dispute status propagation

Idempotency: finalize claims `finalized: False → True` atomically on
db.paypal_orders, so webhook retries + duplicate capture callbacks can never
duplicate stock changes, emails, commission entries, or orders.
"""
import httpx
from fastapi import HTTPException

from core import db, logger, now_iso


def _srb_cents(d: dict | None) -> int:
    try:
        return int(round(float((d or {}).get("value") or 0) * 100))
    except (TypeError, ValueError):
        return 0


async def record_paypal_fees(internal_id: str, srb: dict) -> None:
    """Persist PayPal's gross / fee / net breakdown (idempotent $set)."""
    gross = _srb_cents(srb.get("gross_amount"))
    fee = _srb_cents(srb.get("paypal_fee"))
    net = _srb_cents(srb.get("net_amount"))
    if not gross:
        return
    fees = {"gross_cents": gross, "paypal_fee_cents": fee,
            "net_cents": net, "recorded_at": now_iso()}
    await db.paypal_orders.update_one({"id": internal_id}, {"$set": {"paypal_fees": fees}})
    await db.payment_transactions.update_one(
        {"session_id": f"pp_{internal_id}"}, {"$set": {"paypal_fees": fees}},
    )


async def apply_paypal_refund(internal_id: str, refund_id: str | None,
                              amount: float, kind: str = "refunded") -> None:
    """Shared by the webhook (REFUNDED/REVERSED) and the admin refund action."""
    session_id = f"pp_{internal_id}"
    await db.paypal_orders.update_one(
        {"id": internal_id},
        {"$set": {"status": kind, "refund_id": refund_id, f"{kind}_at": now_iso()}},
    )
    await db.payment_transactions.update_one(
        {"session_id": session_id},
        {"$set": {"refund_status": kind, "refund_id": refund_id,
                  "refund_amount": amount, "refunded_at": now_iso()}},
    )
    await db.maker_payouts.update_many(
        {"session_id": session_id, "status": "deferred"},
        {"$set": {"status": "cancelled", "updated_at": now_iso()}},
    )


async def refund_paypal_session(session_id: str) -> dict:
    """Admin-initiated full refund of a PayPal capture. Idempotent."""
    from .paypal_webhooks import _access_token, _config, paypal_configured
    internal_id = session_id[3:] if session_id.startswith("pp_") else session_id
    doc = await db.paypal_orders.find_one({"id": internal_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "PayPal order not found.")
    tx = await db.payment_transactions.find_one({"session_id": f"pp_{internal_id}"}, {"_id": 0})
    if tx and tx.get("refund_status") in ("refunded", "reversed"):
        return {"already_refunded": True, "refund_id": tx.get("refund_id")}
    capture_id = doc.get("capture_id")
    if not capture_id:
        raise HTTPException(400, "Order has no capture to refund.")
    if not paypal_configured():
        raise HTTPException(503, "PayPal is not configured.")
    cfg = _config()
    token = await _access_token(cfg)
    async with httpx.AsyncClient(timeout=25) as client:
        r = await client.post(
            f"{cfg['base']}/v2/payments/captures/{capture_id}/refund",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json",
                     "PayPal-Request-Id": f"refund-{internal_id}"},
            json={},
        )
    refund_id = None
    if r.status_code in (200, 201):
        refund_id = (r.json() or {}).get("id")
    else:
        body = r.json() if r.content else {}
        issues = [d.get("issue") for d in (body.get("details") or [])]
        if "CAPTURE_FULLY_REFUNDED" not in issues:
            logger.error("[paypal-refund] failed · capture=%s · HTTP %s", capture_id, r.status_code)
            raise HTTPException(502, "PayPal refund failed — check the PayPal dashboard.")
    amount = doc["amounts_cents"]["total"] / 100.0
    await apply_paypal_refund(internal_id, refund_id, amount, kind="refunded")
    return {"refund_id": refund_id, "amount": amount, "provider": "paypal"}


async def finalize_paypal_order(internal_id: str, trigger: str = "unknown",
                                captured_amount_cents: int | None = None) -> str:
    """Run the full paid-order pipeline for a captured PayPal order — once.

    Returns a short machine-readable result string that the webhook stores
    as its processing_result.
    """
    doc = await db.paypal_orders.find_one({"id": internal_id}, {"_id": 0})
    if not doc:
        return "missing_internal_order"
    if doc.get("status") == "amount_mismatch":
        return "amount_mismatch_blocked"

    expected = int(doc["amounts_cents"]["total"])
    if captured_amount_cents is not None and captured_amount_cents != expected:
        await db.paypal_orders.update_one(
            {"id": internal_id},
            {"$set": {"status": "amount_mismatch",
                      "amount_mismatch": {"expected_cents": expected,
                                          "captured_cents": captured_amount_cents,
                                          "flagged_at": now_iso(), "trigger": trigger}}},
        )
        logger.error("[paypal-finalize] AMOUNT MISMATCH · order=%s · captured=%s expected=%s",
                     internal_id, captured_amount_cents, expected)
        return f"amount_mismatch:{captured_amount_cents}!={expected}"

    # Atomic once-only claim — retries/duplicates stop here.
    claim = await db.paypal_orders.find_one_and_update(
        {"id": internal_id, "finalized": {"$ne": True}},
        {"$set": {"finalized": True, "finalized_at": now_iso(), "finalized_trigger": trigger}},
    )
    if not claim:
        return "already_finalized"

    session_id = f"pp_{internal_id}"
    total = expected / 100.0
    summary = doc.get("summary") or " | ".join(
        f"{it.get('title')} × {it.get('quantity', 1)}" for it in doc.get("items", []))
    buyer = (doc.get("payer_email") or doc.get("customer_email") or "").lower() or None
    cart_items = doc.get("cart_items") or [
        {"product_id": it.get("product_id"), "quantity": it.get("quantity", 1)}
        for it in doc.get("items", [])
    ]
    ship = doc.get("shipping_address")
    ship_details = None
    if ship:
        ship_details = {
            "name": (ship.get("name") or "").strip(),
            "phone": (ship.get("phone") or "").strip() or None,
            "address": {
                "line1": (ship.get("line1") or "").strip(),
                "line2": (ship.get("line2") or "").strip() or None,
                "city": (ship.get("city") or "").strip(),
                "state": (ship.get("state") or "").strip(),
                "postal_code": (ship.get("postal_code") or "").strip(),
                "country": (ship.get("country") or "US").strip().upper(),
            },
        }

    # 1. Order record — the source of truth every order view + analytics reads.
    import uuid as _uuid
    from core import POLICY_VERSION
    quote = doc.get("quote") or {}
    tx_doc = {
        "id": str(_uuid.uuid4()),
        "session_id": session_id,
        "payment_provider": "paypal",
        "paypal_order_id": doc.get("paypal_order_id"),
        "paypal_capture_id": doc.get("capture_id"),
        "paypal_environment": doc.get("environment"),
        "paypal_fees": doc.get("paypal_fees"),
        "amount": total,
        "subtotal": quote.get("subtotal"),
        "shipping": quote.get("shipping"),
        "currency": "usd",
        "items": cart_items,
        "summary": summary,
        "customer_email": buyer,
        "gift_note": doc.get("gift_note"),
        "shipping_details": ship_details,
        "discount_code": doc.get("discount_code"),
        "payment_status": "paid",
        "status": "complete",
        "order_status": "pending",
        "policy_version": doc.get("policy_version") or POLICY_VERSION,
        "policy_accepted_at": doc.get("created_at"),
        "created_at": now_iso(),
        "paid_at": now_iso(),
    }
    await db.payment_transactions.update_one(
        {"session_id": session_id}, {"$setOnInsert": tx_doc}, upsert=True,
    )

    steps: list[str] = ["tx_created"]
    from core import custom_options_summary, effective_variant_price

    # 2. Build receipt lines grouped by maker (mirrors the Stripe path).
    email_items: list[dict] = []
    by_maker: dict[str, list] = {}
    for ci in cart_items:
        pid = ci.get("product_id")
        p = await db.products.find_one({"id": pid}, {"_id": 0}) \
            or await db.products.find_one({"slug": pid}, {"_id": 0})
        if not p:
            continue
        m_doc = await db.makers.find_one(
            {"slug": p["maker_slug"]}, {"_id": 0, "name": 1, "slug": 1}) or {}
        line_title = p["title"]
        unit_price = float(p.get("price") or 0)
        vid = ci.get("variant_id")
        if vid:
            v = next((x for x in (p.get("variants") or []) if x.get("id") == vid), None)
            if v:
                unit_price = effective_variant_price(p.get("price"), v)
                if v.get("label"):
                    line_title = f"{line_title} — {v['label']}"
        c_label, c_delta = custom_options_summary(p, ci.get("custom_option_ids") or [])
        if c_label:
            line_title = f"{line_title} · {c_label}"
            unit_price = round(unit_price + c_delta, 2)
        line = {
            "title": line_title,
            "price": unit_price,
            "quantity": ci.get("quantity", 1),
            "maker_slug": p["maker_slug"],
            "maker_name": m_doc.get("name") or p["maker_slug"],
            "personalization_text": ci.get("personalization_text"),
            "personalization_image_url": ci.get("personalization_image_url"),
            "color_choice": ci.get("color_choice"),
        }
        email_items.append(line)
        by_maker.setdefault(p["maker_slug"], []).append(line)

    # 3. Commission ledger — SAME policy as Stripe: commission is computed
    #    from the GROSS maker subtotal (before payment-processing fees), plus
    #    the standard processing recovery, via fee_breakdown_cents. Payout is
    #    deferred (PayPal funds land on the platform account; makers are paid
    #    manually or via future PayPal Payouts).
    try:
        from routers.stripe_connect import (
            PLATFORM_FEE_BPS, PROCESSING_FEE_BPS, fee_breakdown_cents,
        )
        for maker_slug, lines in by_maker.items():
            subtotal = sum(float(ln["price"]) * int(ln["quantity"]) for ln in lines)
            m = await db.makers.find_one({"slug": maker_slug}, {"_id": 0})
            fees = fee_breakdown_cents(subtotal, m, bool(doc.get("external_attribution")))
            await db.maker_payouts.update_one(
                {"session_id": session_id, "maker_slug": maker_slug},
                {"$setOnInsert": {
                    "session_id": session_id, "maker_slug": maker_slug,
                    "provider": "paypal",
                    "paypal_order_id": doc.get("paypal_order_id"),
                    "amount": round(subtotal, 2),
                    "amount_cents": fees["net_cents"],
                    "gross_cents": fees["gross_cents"],
                    "commission_cents": fees["commission_cents"],
                    "commission_bps": fees["commission_bps"],
                    "processing_cents": fees["processing_cents"],
                    "platform_fee_bps": PLATFORM_FEE_BPS,
                    "processing_fee_bps": PROCESSING_FEE_BPS,
                    "status": "deferred",
                    "reason": "paypal-manual-payout",
                    "updated_at": now_iso(),
                }}, upsert=True,
            )
        steps.append("commission_recorded")
    except Exception as e:
        logger.exception("[paypal-finalize] commission recording failed · %s", e)

    # 3b. Makers without a PayPal email get an immediate "add your PayPal
    #     email" heads-up (once; the daily cron sends 3/7/14-day reminders).
    try:
        from .paypal_payouts import nudge_paypal_email_needed
        for maker_slug in by_maker:
            await nudge_paypal_email_needed(maker_slug)
    except Exception as e:
        logger.warning("[paypal-finalize] payout-email nudge skipped · %s", e)

    # 4. Inventory — exactly once (we're inside the atomic claim).
    low_by_maker: dict = {}
    try:
        from .checkout import _decrement_stock_and_collect_low
        low_by_maker = await _decrement_stock_and_collect_low(cart_items, by_maker)
        steps.append("stock_decremented")
    except Exception as e:
        logger.exception("[paypal-finalize] stock decrement failed · %s", e)

    # 5. Emails — buyer receipt, per-maker order alert, ops alert, low stock.
    try:
        import email_service
        if buyer:
            await email_service.send_buyer_receipt(buyer, summary, total, email_items, session_id)
        await email_service.send_ops_new_order(summary, total, email_items, buyer)
        for maker_slug, lines in by_maker.items():
            m = await db.makers.find_one({"slug": maker_slug}, {"_id": 0})
            if not m or not m.get("email"):
                continue
            m_subtotal = sum(float(ln["price"]) * int(ln["quantity"]) for ln in lines)
            await email_service.send_maker_new_order(m["email"], m["name"], lines, m_subtotal, buyer)
        for maker_slug, low_lines in (low_by_maker or {}).items():
            if not low_lines:
                continue
            m = await db.makers.find_one({"slug": maker_slug}, {"_id": 0})
            if m and m.get("email"):
                await email_service.send_maker_low_stock(m["email"], m["name"], low_lines)
        steps.append("emails_sent")
    except Exception as e:
        logger.exception("[paypal-finalize] email dispatch failed · %s", e)

    # 6. Activity ticker + admin push (parity with the Stripe live-order ping).
    try:
        from models import ActivityEvent
        await db.activity_events.insert_one({
            **ActivityEvent(kind="sold", text=f"{summary} sold to a buyer",
                            location="Crafters Market").model_dump(),
            "amount": total, "session_id": session_id,
        })
        from routers.push import notify_admins_new_order
        await notify_admins_new_order(f"💰 New order — ${total:.2f}",
                                      f"{summary} · via PayPal")
        steps.append("activity_recorded")
    except Exception as e:
        logger.warning("[paypal-finalize] activity/push skipped · %s", e)

    # 7. Discount bookkeeping (same increment rules as Stripe).
    code = (doc.get("discount_code") or "").strip()
    if code:
        try:
            upd = await db.discount_codes.update_one(
                {"code": code}, {"$inc": {"uses_count": 1}, "$set": {"last_used_at": now_iso()}})
            if upd.modified_count == 0:
                await db.marketing_codes.update_one(
                    {"code": code},
                    {"$inc": {"uses_count": 1},
                     "$set": {"last_used_at": now_iso(), "active": False}})
            steps.append("discount_counted")
        except Exception as e:
            logger.warning("[paypal-finalize] discount bookkeeping failed · %s", e)

    # 8. Digital delivery — mint token-gated download links (parity).
    try:
        from digital_delivery import mint_download_token
        digital_downloads: list[dict] = []
        for ci in cart_items:
            p = await db.products.find_one(
                {"id": ci.get("product_id")},
                {"_id": 0, "slug": 1, "title": 1, "listing_type": 1, "digital_files": 1},
            ) or await db.products.find_one(
                {"slug": ci.get("product_id")},
                {"_id": 0, "slug": 1, "title": 1, "listing_type": 1, "digital_files": 1},
            )
            if not p or p.get("listing_type") not in ("digital", "both"):
                continue
            for f in (p.get("digital_files") or []):
                token, exp = mint_download_token(session_id, f["id"])
                digital_downloads.append({
                    "file_id": f["id"], "filename": f.get("filename") or "file",
                    "size_bytes": f.get("size_bytes") or 0, "ext": f.get("ext") or "",
                    "product_slug": p.get("slug") or "", "product_title": p.get("title") or "",
                    "token": token, "expires_at_unix": exp, "downloads": 0,
                })
        if digital_downloads:
            await db.payment_transactions.update_one(
                {"session_id": session_id},
                {"$set": {"digital_downloads": digital_downloads}})
            if buyer:
                import email_service
                await email_service.send_buyer_digital_downloads(buyer, summary, digital_downloads)
            steps.append("digital_delivered")
    except Exception as e:
        logger.exception("[paypal-finalize] digital delivery failed · %s", e)

    await db.paypal_orders.update_one(
        {"id": internal_id}, {"$set": {"finalize_steps": steps}})
    logger.info("[paypal-finalize] order finalized · id=%s · trigger=%s · steps=%s",
                internal_id, trigger, ",".join(steps))
    return "finalized"
