"""iter459 — Order Cancellation & Resolution Workflow (v1).

Maker-initiated cancellations on paid orders always refund through the
order's original payment provider (Stripe / PayPal) — full automation,
no buyer-approval step in v1 (architecture leaves room for it).

Guarantees:
  • Atomic lock — a cancellation can only start once (idempotent).
  • Order isn't marked cancelled until the provider accepts the refund.
  • Inventory restored exactly once (opt-out for damaged goods).
  • Buyer / maker / admin emails fire only after refund acceptance,
    deduped via the same lock.
  • refund_failed keeps the order open + alerts admin.
Admin overrides: cancel any order, cancel WITHOUT refund (mandatory
internal note), edit reason, reopen (before a successful refund).
"""
from __future__ import annotations
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core import db, logger, now_iso
from maker_auth import current_maker_slug, current_admin

router = APIRouter()

ADMIN_NOTIFY_EMAIL = "team@craftersmarket.org"

REASON_GROUPS = [
    ("inventory", "Inventory", [
        ("out-of-stock", "Item out of stock"),
        ("inventory-error", "Inventory error"),
        ("damaged-before-shipment", "Damaged before shipment")]),
    ("production", "Production", [
        ("unable-to-manufacture", "Unable to manufacture"),
        ("equipment-failure", "Equipment failure"),
        ("material-unavailable", "Material unavailable"),
        ("production-delay", "Production delay")]),
    ("customer", "Customer Request", [
        ("buyer-requested", "Buyer requested cancellation"),
        ("incorrect-address", "Buyer entered incorrect address"),
        ("buyer-changed-mind", "Buyer changed their mind"),
        ("ordered-by-mistake", "Buyer ordered by mistake")]),
    ("mutual", "Mutual", [
        ("mutual-agreement", "Buyer and maker agreed to cancel")]),
    ("shipping", "Shipping", [
        ("shipping-unavailable", "Shipping unavailable"),
        ("shipping-cost-too-high", "Shipping cost too high"),
        ("restricted-destination", "Restricted destination")]),
    ("other", "Other", [("other", "Other (explain below)")]),
]
REASON_LABELS = {rid: lbl for _, _, rs in REASON_GROUPS for rid, lbl in rs}
REASON_GROUP_OF = {rid: gid for gid, _, rs in REASON_GROUPS for rid, _ in rs}
ACTIVE_STATUSES = ("refund_processing", "canceled_refunded", "canceled_no_refund")


@router.get("/orders/cancel-reasons")
async def cancel_reasons():
    return {"groups": [
        {"id": gid, "label": glabel,
         "reasons": [{"id": rid, "label": rlbl} for rid, rlbl in rs]}
        for gid, glabel, rs in REASON_GROUPS]}


class CancelReq(BaseModel):
    reason: str
    explanation: str = ""
    note_to_buyer: str = ""
    restore_inventory: bool = True


class AdminCancelReq(CancelReq):
    mode: str = "refund"          # refund | no_refund
    internal_note: str = ""       # mandatory for no_refund


def _validate_reason(reason: str, explanation: str):
    if reason not in REASON_LABELS:
        raise HTTPException(400, "Pick a cancellation reason.")
    if reason == "other" and len((explanation or "").strip()) < 5:
        raise HTTPException(400, "'Other' requires a short explanation.")


async def _lock_cancellation(session_id: str, record: dict) -> Optional[dict]:
    """Atomically start a cancellation — returns the pre-lock tx or None
    when another cancellation is already active (idempotency guard)."""
    return await db.payment_transactions.find_one_and_update(
        {"session_id": session_id,
         "cancellation.status": {"$nin": list(ACTIVE_STATUSES)}},
        {"$set": {"cancellation": record}},
        projection={"_id": 0},
    )


async def _restore_inventory(tx: dict) -> int:
    restored = 0
    for ci in tx.get("items") or []:
        pid = ci.get("product_id")
        qty = int(ci.get("quantity", 1))
        p = await db.products.find_one(
            {"$or": [{"id": pid}, {"slug": pid}]},
            {"_id": 0, "id": 1, "tracks_inventory": 1})
        if not p or p.get("tracks_inventory") is False:
            continue
        vid = ci.get("variant_id")
        if vid:
            await db.products.update_one(
                {"id": p["id"], "variants.id": vid},
                {"$inc": {"variants.$.in_stock": qty}})
        await db.products.update_one({"id": p["id"]}, {"$inc": {"in_stock": qty}})
        restored += qty
    return restored


async def _do_refund(session_id: str) -> dict:
    if session_id.startswith("pp_"):
        from routers.paypal_finalize import refund_paypal_session
        return await refund_paypal_session(session_id)
    from routers.stripe_connect import refund_session
    return await refund_session(session_id)


def _tl(event: str, **kw) -> dict:
    return {"event": event, "at": now_iso(), **kw}


async def _send_emails(tx: dict, cxl: dict, amount: float, provider: str):
    from email_service import _send
    reason_lbl = REASON_LABELS.get(cxl["reason"], cxl["reason"])
    buyer_email = tx.get("customer_email")
    note = (cxl.get("note_to_buyer") or "").strip()
    refunded = cxl["status"] == "canceled_refunded"
    order_ref = tx.get("session_id", "")[-8:]

    if buyer_email:
        refund_block = (
            f"<p><b>Refund amount:</b> ${amount:.2f}<br>"
            f"<b>Refund method:</b> {provider.title()} (original payment method)<br>"
            "Your refund has been issued to your original payment method. "
            "Processing time depends on your bank or payment provider "
            "(typically 3-5 business days).</p>") if refunded else ""
        await _send(
            buyer_email,
            "Your Crafters Market order has been canceled",
            f"<p>Hi,</p><p>Your order <b>#{order_ref}</b> has been canceled.</p>"
            f"<p><b>Reason:</b> {reason_lbl}</p>{refund_block}"
            + (f"<p><b>Message from the maker:</b><br>{note}</p>" if note else "")
            + "<p>Thank you for understanding — the Crafters Market team.</p>")

    # Maker confirmation (all makers with items in the order)
    maker_slugs = {(ci.get("maker_slug") or "") for ci in tx.get("items") or []}
    maker_slugs.discard("")
    if not maker_slugs:
        prods = [ci.get("product_id") for ci in tx.get("items") or []]
        async for p in db.products.find(
                {"$or": [{"id": {"$in": prods}}, {"slug": {"$in": prods}}]},
                {"_id": 0, "maker_slug": 1}):
            maker_slugs.add(p["maker_slug"])
    maker_names = []
    async for m in db.makers.find({"slug": {"$in": list(maker_slugs)}},
                                  {"_id": 0, "email": 1, "name": 1, "slug": 1}):
        maker_names.append(m.get("name") or m["slug"])
        if m.get("email"):
            await _send(
                m["email"], f"Order #{order_ref} canceled",
                f"<p>Order <b>#{order_ref}</b> was successfully canceled.</p>"
                f"<p><b>Reason:</b> {reason_lbl}<br>"
                + (f"<b>Refund processed:</b> ${amount:.2f}<br>" if refunded else "<b>No refund issued</b> (admin resolution).<br>")
                + f"<b>Inventory restored:</b> {'yes' if cxl.get('inventory_restored') else 'no'}</p>"
                "<p>The buyer has been notified.</p>")

    # Admin notification
    await _send(
        ADMIN_NOTIFY_EMAIL,
        f"Order canceled — #{order_ref} (${amount:.2f})",
        f"<p><b>Order:</b> {tx.get('session_id')}<br>"
        f"<b>Maker(s):</b> {', '.join(maker_names) or ', '.join(maker_slugs)}<br>"
        f"<b>Buyer:</b> {buyer_email or '—'}<br>"
        f"<b>Reason:</b> {reason_lbl}"
        + (f" — {cxl.get('explanation')}" if cxl.get("explanation") else "") + "<br>"
        f"<b>Note to buyer:</b> {note or '—'}<br>"
        f"<b>Initiated by:</b> {cxl.get('initiated_by')} ({cxl.get('initiated_by_id')})<br>"
        f"<b>Provider:</b> {provider}<br>"
        f"<b>Refund:</b> {'$%.2f · id %s' % (amount, cxl.get('refund', {}).get('refund_id')) if refunded else 'none'}<br>"
        f"<b>Refund status:</b> {cxl['status']}<br>"
        f"<b>Inventory restored:</b> {'yes' if cxl.get('inventory_restored') else 'no'}<br>"
        f"<b>At:</b> {cxl.get('at')}</p>"
        "<p><a href='https://craftersmarket.org/admin/dashboard?tab=orders'>Open admin orders</a></p>")


async def _execute(tx: dict, session_id: str, body: CancelReq, *,
                   initiated_by: str, initiator_id: str,
                   mode: str = "refund", internal_note: str = "") -> dict:
    amount = float(tx.get("amount") or tx.get("total") or 0)
    provider = tx.get("payment_provider") or ("paypal" if session_id.startswith("pp_") else "stripe")
    record = {
        "id": str(uuid.uuid4()),
        "status": "refund_processing" if mode == "refund" else "canceled_no_refund",
        "reason": body.reason,
        "reason_group": REASON_GROUP_OF.get(body.reason),
        "explanation": (body.explanation or "").strip(),
        "note_to_buyer": (body.note_to_buyer or "").strip(),
        "internal_note": internal_note or None,
        "initiated_by": initiated_by,
        "initiated_by_id": initiator_id,
        "at": now_iso(),
        "amount": amount,
        "provider": provider,
        "inventory_restored": False,
        "refund": None,
        "timeline": [_tl("cancel_requested", by=f"{initiated_by}:{initiator_id}")],
    }
    prev = await _lock_cancellation(session_id, record)
    if prev is None:
        raise HTTPException(409, "A cancellation is already in progress or completed for this order.")

    sets, pushes = {}, []
    if mode == "refund":
        try:
            result = await _do_refund(session_id)
        except HTTPException as e:
            await db.payment_transactions.update_one(
                {"session_id": session_id},
                {"$set": {"cancellation.status": "refund_failed",
                          "cancellation.error": str(e.detail)},
                 "$push": {"cancellation.timeline": _tl("refund_failed", error=str(e.detail))}})
            try:
                from email_service import _send
                await _send(ADMIN_NOTIFY_EMAIL,
                            f"Refund FAILED — action required (order {session_id})",
                            f"<p>Cancellation refund failed for <b>{session_id}</b> "
                            f"(${amount:.2f} via {provider}).</p><p>Error: {e.detail}</p>"
                            "<p>The order remains open in refund_failed state.</p>")
            except Exception:
                pass
            # 409 (not 502) — Cloudflare replaces 502 bodies with its own
            # HTML error page, which would hide the JSON detail from the UI.
            raise HTTPException(409, f"Refund failed — order NOT canceled: {e.detail}")
        record["refund"] = {
            "provider": provider,
            "refund_id": result.get("refund_id"),
            "amount": result.get("amount") or amount,
            "at": now_iso(),
            "provider_response": {k: v for k, v in result.items() if k != "reversals"},
        }
        record["status"] = "canceled_refunded"
        sets["cancellation.refund"] = record["refund"]
        pushes.append(_tl("refund_issued", refund_id=result.get("refund_id"), amount=amount))

    if body.restore_inventory:
        n = await _restore_inventory(tx)
        record["inventory_restored"] = n > 0
        sets["cancellation.inventory_restored"] = n > 0
        pushes.append(_tl("inventory_restored", units=n))
    else:
        pushes.append(_tl("inventory_not_restored"))

    try:
        await _send_emails(tx, record, amount, provider)
        pushes.append(_tl("buyer_notified"))
    except Exception as e:
        logger.warning("[cancel] emails failed for %s: %s", session_id, e)

    pushes.append(_tl("closed"))
    sets.update({"cancellation.status": record["status"],
                 "order_status": "canceled",
                 "refund_status": "refunded" if mode == "refund" else (prev.get("refund_status") or None)})
    await db.payment_transactions.update_one(
        {"session_id": session_id},
        {"$set": sets, "$push": {"cancellation.timeline": {"$each": pushes}}})
    await db.audit_log.insert_one({
        "kind": "order_canceled", "session_id": session_id,
        "actor": f"{initiated_by}:{initiator_id}", "reason": body.reason,
        "mode": mode, "amount": amount, "created_at": now_iso()})
    logger.info("[cancel] %s canceled by %s (%s, mode=%s)", session_id, initiator_id, body.reason, mode)
    return await db.payment_transactions.find_one(
        {"session_id": session_id}, {"_id": 0, "cancellation": 1, "order_status": 1})


# ── Maker ─────────────────────────────────────────────────────────────────────

@router.post("/maker/orders/{session_id}/cancel")
async def maker_cancel_order(session_id: str, body: CancelReq,
                             slug: str = Depends(current_maker_slug)):
    _validate_reason(body.reason, body.explanation)
    tx = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})
    if not tx:
        raise HTTPException(404, "Order not found.")
    if tx.get("payment_status") != "paid":
        raise HTTPException(400, "Only paid orders can be canceled with a refund.")
    if tx.get("order_status") in ("fulfilled", "shipped") or tx.get("shipped_at"):
        raise HTTPException(409, "This order already shipped — contact support to resolve.")
    # Ownership + single-maker guard (a maker can't refund other makers' lines).
    pids = [ci.get("product_id") for ci in tx.get("items") or []]
    owners = set()
    async for p in db.products.find(
            {"$or": [{"id": {"$in": pids}}, {"slug": {"$in": pids}}]},
            {"_id": 0, "maker_slug": 1}):
        owners.add(p["maker_slug"])
    if slug not in owners:
        raise HTTPException(403, "This order doesn't include your products.")
    if owners - {slug}:
        raise HTTPException(409, "Multi-maker order — an admin must handle this cancellation. Use Report Issue.")
    return await _execute(tx, session_id, body, initiated_by="maker", initiator_id=slug)


# ── Admin ─────────────────────────────────────────────────────────────────────

@router.post("/admin/orders/{session_id}/cancel")
async def admin_cancel_order(session_id: str, body: AdminCancelReq,
                             claims: dict = Depends(current_admin)):
    _validate_reason(body.reason, body.explanation)
    if body.mode not in ("refund", "no_refund"):
        raise HTTPException(400, "mode must be refund or no_refund.")
    if body.mode == "no_refund" and len((body.internal_note or "").strip()) < 5:
        raise HTTPException(400, "Cancel-without-refund requires an internal note.")
    tx = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})
    if not tx:
        raise HTTPException(404, "Order not found.")
    if body.mode == "refund" and tx.get("payment_status") != "paid":
        raise HTTPException(400, "Order isn't paid — nothing to refund.")
    return await _execute(tx, session_id, body,
                          initiated_by="admin", initiator_id=claims.get("email", "admin"),
                          mode=body.mode, internal_note=(body.internal_note or "").strip())


class ReasonEdit(BaseModel):
    reason: str
    explanation: str = ""


@router.patch("/admin/orders/{session_id}/cancellation")
async def admin_edit_cancellation(session_id: str, body: ReasonEdit,
                                  claims: dict = Depends(current_admin)):
    _validate_reason(body.reason, body.explanation)
    r = await db.payment_transactions.update_one(
        {"session_id": session_id, "cancellation": {"$ne": None}},
        {"$set": {"cancellation.reason": body.reason,
                  "cancellation.reason_group": REASON_GROUP_OF.get(body.reason),
                  "cancellation.explanation": body.explanation.strip()},
         "$push": {"cancellation.timeline": _tl(
             "reason_edited", by=claims.get("email"), reason=body.reason)}})
    if not r.matched_count:
        raise HTTPException(404, "No cancellation on this order.")
    return {"ok": True}


@router.post("/admin/orders/{session_id}/cancellation/reopen")
async def admin_reopen_order(session_id: str, claims: dict = Depends(current_admin)):
    """Reopen — only before a successful refund (refund_failed or
    no-refund cancellations). Rolls back inventory restoration."""
    tx = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})
    if not tx or not tx.get("cancellation"):
        raise HTTPException(404, "No cancellation on this order.")
    st = tx["cancellation"].get("status")
    if st == "canceled_refunded":
        raise HTTPException(409, "Refund already completed — this order can't be reopened.")
    if tx["cancellation"].get("inventory_restored"):
        for ci in tx.get("items") or []:
            pid, qty = ci.get("product_id"), int(ci.get("quantity", 1))
            p = await db.products.find_one({"$or": [{"id": pid}, {"slug": pid}]},
                                           {"_id": 0, "id": 1})
            if p:
                if ci.get("variant_id"):
                    await db.products.update_one(
                        {"id": p["id"], "variants.id": ci["variant_id"]},
                        {"$inc": {"variants.$.in_stock": -qty}})
                await db.products.update_one({"id": p["id"]}, {"$inc": {"in_stock": -qty}})
    await db.payment_transactions.update_one(
        {"session_id": session_id},
        {"$set": {"cancellation": None, "order_status": "pending"}})
    await db.audit_log.insert_one({
        "kind": "order_cancellation_reopened", "session_id": session_id,
        "actor": claims.get("email"), "previous_status": st, "created_at": now_iso()})
    return {"ok": True, "order_status": "pending"}


@router.get("/admin/orders/cancellation-stats")
async def cancellation_stats(_: dict = Depends(current_admin)):
    paid = await db.payment_transactions.count_documents({"payment_status": "paid"})
    canceled_q = {"cancellation.status": {"$in": ["canceled_refunded", "canceled_no_refund"]}}
    canceled = await db.payment_transactions.count_documents(canceled_q)
    reasons, refund_total, deltas, initiators, by_maker = {}, 0.0, [], {}, {}
    async for tx in db.payment_transactions.find(canceled_q, {"_id": 0}):
        c = tx["cancellation"]
        reasons[c.get("reason")] = reasons.get(c.get("reason"), 0) + 1
        if c.get("refund"):
            refund_total += float(c["refund"].get("amount") or 0)
        grp = c.get("reason_group")
        key = ("buyer_requested" if grp == "customer"
               else "mutual" if grp == "mutual" else c.get("initiated_by", "maker"))
        initiators[key] = initiators.get(key, 0) + 1
        try:
            from datetime import datetime
            t0 = datetime.fromisoformat(tx.get("created_at", "").replace("Z", "+00:00"))
            t1 = datetime.fromisoformat(c.get("at", "").replace("Z", "+00:00"))
            deltas.append((t1 - t0).total_seconds() / 3600)
        except Exception:
            pass
        who = c.get("initiated_by_id") if c.get("initiated_by") == "maker" else None
        if who:
            by_maker[who] = by_maker.get(who, 0) + 1
    top_reasons = sorted(
        ({"reason": r, "label": REASON_LABELS.get(r, r), "count": n} for r, n in reasons.items()),
        key=lambda x: -x["count"])[:8]
    return {
        "paid_orders": paid, "canceled_orders": canceled,
        "cancellation_rate": round(canceled / paid, 4) if paid else 0.0,
        "top_reasons": top_reasons,
        "refund_total": round(refund_total, 2),
        "avg_hours_to_cancel": round(sum(deltas) / len(deltas), 1) if deltas else None,
        "initiators": initiators,
        "by_maker": sorted(({"maker_slug": k, "count": v} for k, v in by_maker.items()),
                           key=lambda x: -x["count"])[:10],
    }
