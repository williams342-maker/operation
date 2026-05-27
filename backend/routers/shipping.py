"""Maker shipping-label router — Shippo integration.

Endpoints
---------
GET    /api/maker/shipping/from-address          saved ship-from (or {})
PATCH  /api/maker/shipping/from-address          persist ship-from on maker doc
GET    /api/maker/orders/{sid}/shipping-defaults { from, to, parcel }
POST   /api/maker/orders/{sid}/shipping/rates    { from, to, parcel } → rates
POST   /api/maker/orders/{sid}/shipping/buy-label {shipment_id, rate_id}
    → purchases a Shippo label, records a row in `shipping_ledger` (so we
      can bill the maker on our weekly invoice run), marks the order
      fulfilled, stamps tracking_number + tracking_carrier + label_url.
POST   /api/maker/orders/{sid}/shipping/refresh-tracking
    → manual poll to Shippo when the webhook is behind; updates tracking_status.
POST   /api/shippo/webhook                       PUBLIC — Shippo track_updated
    → updates order tracking_status + tracking_history; on first DELIVERED
      fires a one-off buyer email (idempotent via `delivered_email_sent`).

Billing model (Phase 1)
-----------------------
Platform pays Shippo directly with its own key. Every purchased label
inserts into `shipping_ledger`:
    { maker_slug, session_id, tx_id (shippo), amount_cents, markup_cents,
      billed_cents, currency, provider, servicelevel, tracking_number,
      label_url, created_at, billed_at=None, invoice_id=None }
A follow-up scheduled job (Phase 2) rolls up unbilled rows per maker and
generates a Stripe invoice (weekly or biweekly, operator-configured).
"""
from __future__ import annotations
import os
import uuid
from typing import Optional
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict

from core import db, logger, now_iso
from maker_auth import current_maker_slug
import shippo_service

router = APIRouter()

# Platform handling-fee on every shipping label, expressed as a fraction.
# 5% covers our Stripe invoice processing (~2.9% + 30¢) plus a small ops
# margin on top. Applied uniformly to all makers regardless of tier; the
# `markup_cents` field on each ledger row records the exact dollar amount
# so the invoice math stays trivially auditable downstream.
#
# To change: set SHIPPING_MARKUP_PCT_OVERRIDE in env (e.g. "0.07" for 7%)
# and restart. Falls back to 0.05 baseline if unset or malformed.
def _resolve_markup_pct() -> float:
    raw = (os.environ.get("SHIPPING_MARKUP_PCT_OVERRIDE") or "").strip()
    if raw:
        try:
            return max(0.0, float(raw))
        except ValueError:
            logger.warning("[shipping] bad SHIPPING_MARKUP_PCT_OVERRIDE=%r — using default", raw)
    return 0.05

SHIPPING_MARKUP_PCT = _resolve_markup_pct()


# ─────────────────────────── models ───────────────────────────
class ShipAddress(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str = ""
    company: str = ""
    street1: str = ""
    street2: str = ""
    city: str = ""
    state: str = ""
    zip: str = ""
    country: str = "US"
    phone: str = ""
    email: str = ""


class Parcel(BaseModel):
    model_config = ConfigDict(extra="ignore")
    length: float = 10
    width: float = 8
    height: float = 4
    weight: float = 1        # pounds
    # kept simple — inches + lbs. Shippo service converts units.


class RateReq(BaseModel):
    model_config = ConfigDict(extra="ignore")
    from_address: ShipAddress
    to_address: ShipAddress
    parcel: Parcel


class BuyLabelReq(BaseModel):
    model_config = ConfigDict(extra="ignore")
    rate_id: str
    label_file_type: str = "PDF_4x6"
    # Client passes the rate metadata from the previously-returned rates
    # list so we can persist it on the tx + ledger even though Shippo's
    # transaction response only carries the rate's object_id back.
    rate_amount: float = 0.0
    rate_currency: str = "USD"
    rate_provider: str = ""
    rate_servicelevel_name: str = ""


# ─────────────────────────── helpers ──────────────────────────
async def _maker_doc(slug: str) -> dict:
    m = await db.makers.find_one({"slug": slug}, {"_id": 0})
    if not m:
        raise HTTPException(404, "Maker not found.")
    return m


async def _ensure_stripe_customer(maker: dict) -> str:
    """Lazily create a Stripe Customer if the maker doesn't have one yet.

    Called on first label purchase so non-Plus makers still get auto
    invoicing. Non-fatal: if Stripe fails, we return '' and log — the
    ledger row still gets written; the weekly invoice job will skip the
    maker with reason='no_stripe_customer' until the next purchase
    retries customer creation. Idempotent via `stripe_customer_id`
    presence check.
    """
    existing = maker.get("stripe_customer_id")
    if existing:
        return existing
    try:
        import stripe as stripe_sdk
        from core import STRIPE_API_KEY
        stripe_sdk.api_key = STRIPE_API_KEY
        cust = stripe_sdk.Customer.create(
            email=maker.get("email") or None,
            name=maker.get("name") or maker["slug"],
            metadata={"maker_slug": maker["slug"], "source": "shipping_label"},
        )
        cid = cust["id"]
        await db.makers.update_one(
            {"slug": maker["slug"]},
            {"$set": {"stripe_customer_id": cid, "updated_at": now_iso()}},
        )
        logger.info("[shipping] auto-created Stripe Customer for maker=%s id=%s", maker["slug"], cid)
        return cid
    except Exception as e:
        logger.warning("[shipping] auto stripe-customer create failed for %s: %s", maker.get("slug"), e)
        return ""


async def _current_month_shipping_spend_cents(slug: str) -> int:
    """Total billed_cents spent this calendar month (UTC), billed or not."""
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()
    cursor = db.shipping_ledger.aggregate([
        {"$match": {"maker_slug": slug, "created_at": {"$gte": month_start}}},
        {"$group": {"_id": None, "total": {"$sum": "$billed_cents"}}},
    ])
    total = 0
    async for row in cursor:
        total = row.get("total") or 0
    return int(total)


async def _assert_owns_order(slug: str, session_id: str) -> dict:
    tx = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})
    if not tx:
        raise HTTPException(404, "Order not found.")
    my_pids = {p["id"] for p in await db.products.find({"maker_slug": slug}, {"_id": 0, "id": 1}).to_list(500) if p.get("id")}
    my_pslugs = {p["slug"] for p in await db.products.find({"maker_slug": slug}, {"_id": 0, "slug": 1}).to_list(500) if p.get("slug")}
    has_my_item = any(
        (ci.get("product_id") in my_pids)
        or (ci.get("product_id") in my_pslugs)
        or (ci.get("product_slug") in my_pslugs)
        for ci in tx.get("items", [])
    )
    if not has_my_item:
        raise HTTPException(404, "Order not found.")
    return tx


def _default_from_address(maker: dict) -> dict:
    """Empty dict with maker name/email seeded — no saved ship-from yet."""
    saved = maker.get("ship_from_address") or {}
    return {
        "name": saved.get("name") or maker.get("name") or "",
        "company": saved.get("company") or maker.get("name") or "",
        "street1": saved.get("street1") or "",
        "street2": saved.get("street2") or "",
        "city": saved.get("city") or "",
        "state": saved.get("state") or "",
        "zip": saved.get("zip") or "",
        "country": saved.get("country") or "US",
        "phone": saved.get("phone") or "",
        "email": saved.get("email") or maker.get("email") or "",
    }


def _default_to_address(tx: dict) -> dict:
    s = tx.get("shipping_details") or {}
    a = s.get("address") or {}
    return {
        "name": s.get("name") or tx.get("customer_name") or "",
        "company": "",
        "street1": a.get("line1") or "",
        "street2": a.get("line2") or "",
        "city": a.get("city") or "",
        "state": a.get("state") or "",
        "zip": a.get("postal_code") or "",
        "country": (a.get("country") or "US").upper(),
        "phone": s.get("phone") or "",
        "email": tx.get("customer_email") or "",
    }


async def _default_parcel(slug: str, tx: dict) -> dict:
    """Pull dims / weight from the first line-item's product.

    `weight_lbs` + `weight_oz` are stored as separate fields. `dimensions`
    is a free-form string (e.g. "10 × 8 × 4 in") — we parse best-effort
    for the 3 numbers; if parsing fails we fall back to a 10×8×4 box.
    """
    pid = None
    for ci in tx.get("items", []) or []:
        pid = ci.get("product_id") or ci.get("product_slug")
        if pid:
            break
    prod = None
    if pid:
        prod = await db.products.find_one(
            {"$or": [{"id": pid}, {"slug": pid}], "maker_slug": slug},
            {"_id": 0, "weight_lbs": 1, "weight_oz": 1, "dimensions": 1},
        )
    weight = 1.0
    length, width, height = 10.0, 8.0, 4.0
    if prod:
        w_lb = float(prod.get("weight_lbs") or 0)
        w_oz = float(prod.get("weight_oz") or 0)
        total_lb = w_lb + (w_oz / 16.0)
        if total_lb > 0:
            weight = round(total_lb, 2)
        dims = prod.get("dimensions") or ""
        nums = _parse_dims(dims)
        if nums and len(nums) >= 3:
            length, width, height = nums[0], nums[1], nums[2]
    return {"length": length, "width": width, "height": height, "weight": weight}


def _parse_dims(s: str) -> list:
    """Lenient number extractor — '10 x 8 x 4 in' → [10, 8, 4]."""
    import re
    try:
        nums = [float(x) for x in re.findall(r"(\d+(?:\.\d+)?)", s or "")]
        return nums[:3]
    except Exception:
        return []


# ─────────────────────────── endpoints ─────────────────────────
@router.get("/maker/shipping/from-address")
async def get_from_address(slug: str = Depends(current_maker_slug)):
    m = await _maker_doc(slug)
    return {
        "configured": shippo_service.is_configured(),
        "test_mode": shippo_service.is_test_key(),
        "address": _default_from_address(m),
    }


@router.patch("/maker/shipping/from-address")
async def patch_from_address(body: ShipAddress, slug: str = Depends(current_maker_slug)):
    addr = body.model_dump()
    # Minimal sanity — must have street + city + state + zip to be usable.
    missing = [k for k in ("name", "street1", "city", "state", "zip") if not (addr.get(k) or "").strip()]
    if missing:
        raise HTTPException(400, f"Missing required: {', '.join(missing)}")
    await db.makers.update_one(
        {"slug": slug},
        {"$set": {"ship_from_address": addr, "updated_at": now_iso()}},
    )
    return {"ok": True, "address": addr}


@router.get("/maker/orders/{session_id}/shipping-defaults")
async def shipping_defaults(session_id: str, slug: str = Depends(current_maker_slug)):
    m = await _maker_doc(slug)
    tx = await _assert_owns_order(slug, session_id)
    return {
        "configured": shippo_service.is_configured(),
        "test_mode": shippo_service.is_test_key(),
        "from_address": _default_from_address(m),
        "to_address": _default_to_address(tx),
        "parcel": await _default_parcel(slug, tx),
    }


@router.post("/maker/orders/{session_id}/shipping/rates")
async def fetch_rates(session_id: str, body: RateReq, slug: str = Depends(current_maker_slug)):
    await _assert_owns_order(slug, session_id)
    if not shippo_service.is_configured():
        raise HTTPException(503, "Shippo isn't configured on this deployment.")
    try:
        result = shippo_service.get_rates(
            from_addr=body.from_address.model_dump(),
            to_addr=body.to_address.model_dump(),
            parcel=body.parcel.model_dump(),
        )
    except shippo_service.ShippoError as e:
        raise HTTPException(400, str(e))
    # Annotate each rate with the platform markup so the UI can display
    # the all-in price the maker will be billed. Keeping the raw carrier
    # amount alongside `billed_amount` so makers can audit the surcharge.
    rates = result.get("rates") if isinstance(result, dict) else None
    if isinstance(rates, list):
        for r in rates:
            try:
                base = float(r.get("amount") or 0)
            except (TypeError, ValueError):
                base = 0.0
            markup = round(base * SHIPPING_MARKUP_PCT, 2)
            r["markup_amount"] = markup
            r["markup_pct"] = SHIPPING_MARKUP_PCT
            r["billed_amount"] = round(base + markup, 2)
    if isinstance(result, dict):
        result["markup_pct"] = SHIPPING_MARKUP_PCT
    return result


@router.post("/maker/orders/{session_id}/shipping/buy-label")
async def buy_label(session_id: str, body: BuyLabelReq, bg: BackgroundTasks, slug: str = Depends(current_maker_slug)):
    await _assert_owns_order(slug, session_id)
    if not shippo_service.is_configured():
        raise HTTPException(503, "Shippo isn't configured on this deployment.")

    # (b) Monthly spend cap guard — if the maker set a cap, block BEFORE
    # we hit Shippo so a label is never purchased they can't afford.
    # Cap=0 means disabled. Check against this-month ledger spend + the
    # buyer-advertised rate amount (in cents).
    maker = await _maker_doc(slug)
    cap_cents = int(maker.get("shipping_monthly_cap_cents") or 0)
    if cap_cents > 0:
        already = await _current_month_shipping_spend_cents(slug)
        incoming_cents = int(round((body.rate_amount or 0) * 100))
        if already + incoming_cents > cap_cents:
            raise HTTPException(
                402,
                f"This label would exceed your monthly shipping cap "
                f"(${cap_cents/100:.2f}). You've spent ${already/100:.2f} "
                f"this month; this label is ${incoming_cents/100:.2f}. "
                f"Raise the cap in Financials → Shipping labels, or "
                f"purchase postage elsewhere for this order.",
            )

    try:
        label = shippo_service.buy_label(body.rate_id, body.label_file_type)
    except shippo_service.ShippoError as e:
        raise HTTPException(400, str(e))

    # Shippo's transaction response includes the rate_id but not the full
    # rate detail, so fall back to the client-supplied values (which came
    # from the /rates response the user saw when clicking Buy). This keeps
    # the ledger + order tx row accurate for billing + tracking UIs.
    provider = label["provider"] or body.rate_provider or ""
    servicelevel = label["servicelevel_name"] or body.rate_servicelevel_name or ""
    amount = label["rate_amount"] or body.rate_amount or 0.0
    currency = label["currency"] or body.rate_currency or "USD"

    # Convert dollars → cents for the ledger (int math avoids float drift).
    amount_cents = int(round((amount or 0) * 100))
    markup_cents = int(round(amount_cents * SHIPPING_MARKUP_PCT))
    billed_cents = amount_cents + markup_cents

    ledger_entry = {
        "id": str(uuid.uuid4()),
        "maker_slug": slug,
        "session_id": session_id,
        "tx_id": label["transaction_id"],
        "provider": provider,
        "servicelevel_name": servicelevel,
        "tracking_number": label["tracking_number"],
        "tracking_url_provider": label["tracking_url_provider"],
        "label_url": label["label_url"],
        "amount_cents": amount_cents,
        "markup_cents": markup_cents,
        "billed_cents": billed_cents,
        "currency": currency,
        "test_mode": bool(label.get("test")),
        "billed_at": None,          # filled by Phase 2 invoice job
        "invoice_id": None,
        "created_at": now_iso(),
    }
    await db.shipping_ledger.insert_one(ledger_entry)

    # (a) Lazy Stripe Customer creation — so the weekly invoice job can
    # later collect from this maker. Fire-and-forget: a Stripe failure
    # here does NOT fail the label purchase (maker's package still
    # ships). Weekly job will just skip them until next purchase.
    try:
        await _ensure_stripe_customer(maker)
    except Exception:
        logger.exception("[shipping] _ensure_stripe_customer wrapper failed")

    # Mirror the existing Mark-Shipped behaviour so the tx moves to the
    # Fulfilled tab and the tracking pill renders immediately.
    await db.payment_transactions.update_one(
        {"session_id": session_id},
        {"$set": {
            "order_status": "fulfilled",
            "shipped_at": now_iso(),
            "updated_at": now_iso(),
            "tracking_number": label["tracking_number"],
            "tracking_carrier": provider,
            "tracking_url_provider": label["tracking_url_provider"],
            "shippo_label_url": label["label_url"],
            "shippo_tx_id": label["transaction_id"],
        }},
    )

    # Buyer notification — send the receipt + tracking email exactly once
    # per order (idempotent via `shipped_email_sent`). We re-load the tx
    # so the items[] / customer_email / amount fields are fresh, then
    # stamp the flag in the same update we use to win the race.
    tx_for_email = await db.payment_transactions.find_one(
        {"session_id": session_id}, {"_id": 0},
    ) or {}
    buyer_email = (
        tx_for_email.get("customer_email")
        or (tx_for_email.get("shipping_details") or {}).get("email")
    )
    if buyer_email and not tx_for_email.get("shipped_email_sent"):
        await db.payment_transactions.update_one(
            {"session_id": session_id, "shipped_email_sent": {"$ne": True}},
            {"$set": {"shipped_email_sent": True, "shipped_email_at": now_iso()}},
        )
        from email_service import send_buyer_shipped
        bg.add_task(
            send_buyer_shipped,
            buyer_email,
            tx_for_email.get("customer_name")
                or (tx_for_email.get("shipping_details") or {}).get("name"),
            label["tracking_number"],
            provider,
            tx_for_email.get("items") or [],
            float(tx_for_email.get("amount") or 0) or None,
            tx_for_email.get("id") or session_id,
            label.get("tracking_url_provider"),
        )

    # iter265 — SMS shipping notice (opt-in only). Mirrors the email
    # path above but is gated by `sms_consent_shipping_at`. Idempotent
    # via dedup_key `shipped:{session_id}` so re-runs of the cron / label
    # endpoint can't double-text.
    buyer_phone_local = tx_for_email.get("customer_phone")
    if (buyer_phone_local and tx_for_email.get("sms_consent_shipping_at")
            and not tx_for_email.get("shipped_sms_sent")):
        await db.payment_transactions.update_one(
            {"session_id": session_id, "shipped_sms_sent": {"$ne": True}},
            {"$set": {"shipped_sms_sent": True, "shipped_sms_at": now_iso()}},
        )
        tracking_no = label["tracking_number"]
        tracking_url = label.get("tracking_url_provider") or ""

        async def _send_shipped_sms(p, num, url, sid):
            from sms_service import send_sms
            body = (
                f"Crafters Market: your order shipped! Tracking {num}"
                + (f" — {url}" if url else "")
                + ". Reply STOP to opt out."
            )
            await send_sms(
                to=p, body=body, kind="order_shipped",
                dedup_key=f"shipped:{sid}",
            )
        bg.add_task(_send_shipped_sms, buyer_phone_local, tracking_no,
                    tracking_url, session_id)

    logger.info(
        "[shipping] maker=%s session=%s tracking=%s amount=$%.2f test=%s",
        slug, session_id, label["tracking_number"], amount_cents / 100, label.get("test"),
    )

    ledger_entry.pop("_id", None)  # paranoia — insert_one mutates the dict
    return {
        "ok": True,
        "label_url": label["label_url"],
        "tracking_number": label["tracking_number"],
        "tracking_url_provider": label["tracking_url_provider"],
        "provider": provider,
        "servicelevel_name": servicelevel,
        "amount": amount,
        "currency": currency,
        "test_mode": bool(label.get("test")),
        "ledger_id": ledger_entry["id"],
    }


# ─────────────────────── tracking-status helpers ───────────────────────
# Maps Shippo's `tracking_status.status` to a simple UI-friendly label +
# colour tier. We keep the raw status on the doc for history/debug, but
# surface the simplified label to the dashboard.
_STATUS_LABEL = {
    "UNKNOWN":    ("Label created", "gray"),
    "PRE_TRANSIT": ("Label created", "gray"),
    "TRANSIT":    ("In transit",     "orange"),
    "DELIVERED":  ("Delivered",      "emerald"),
    "RETURNED":   ("Returned",       "red"),
    "FAILURE":    ("Delivery failed", "red"),
}


async def _apply_tracking_update(session_id: str, status: str, status_details: str, eta: str | None):
    """Idempotent: update the tx doc's tracking_status + append a history
    event. Fires the buyer-delivered email exactly once (guarded by
    `delivered_email_sent`). Returns True if this call caused a status
    transition, False if it was a no-op."""
    tx = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})
    if not tx:
        return False
    prev = tx.get("tracking_status") or ""
    if prev == status:
        return False  # no-op — don't thrash the history array

    label, tier = _STATUS_LABEL.get(status, (status.title() if status else "Unknown", "gray"))
    event = {
        "status": status,
        "label": label,
        "tier": tier,
        "details": status_details or "",
        "eta": eta or "",
        "at": now_iso(),
    }
    await db.payment_transactions.update_one(
        {"session_id": session_id},
        {
            "$set": {
                "tracking_status": status,
                "tracking_status_label": label,
                "tracking_status_tier": tier,
                "tracking_status_eta": eta or "",
                "tracking_updated_at": now_iso(),
            },
            "$push": {"tracking_history": event},
        },
    )

    # One-shot delivery email — idempotent via `delivered_email_sent`.
    if status == "DELIVERED" and not tx.get("delivered_email_sent"):
        try:
            await _send_delivered_email(tx)
        except Exception:
            logger.exception("[shipping] delivered email dispatch failed")
        await db.payment_transactions.update_one(
            {"session_id": session_id},
            {"$set": {"delivered_email_sent": True, "delivered_at": now_iso()}},
        )
    return True


async def _send_delivered_email(tx: dict):
    from email_service import send_buyer_delivered
    to = tx.get("customer_email") or (tx.get("shipping_details") or {}).get("email")
    if not to:
        return
    maker_slugs = list({(it.get("maker_slug") or "") for it in (tx.get("items") or []) if it.get("maker_slug")})
    await send_buyer_delivered(
        buyer_email=to,
        buyer_name=tx.get("customer_name") or (tx.get("shipping_details") or {}).get("name"),
        tracking_number=tx.get("tracking_number") or "",
        carrier=tx.get("tracking_carrier") or "carrier",
        items=tx.get("items") or [],
        maker_slugs=maker_slugs,
    )


async def _send_delivered_push(tx: dict):
    """Browser push companion for the delivered-email. Free, no carrier
    paperwork — replaces the deprecated SMS delivery nudge."""
    from routers.push import notify_buyer_push
    to = (tx.get("customer_email") or (tx.get("shipping_details") or {}).get("email") or "").strip().lower()
    if not to:
        return
    items = tx.get("items") or []
    maker_slugs = list({(it.get("maker_slug") or "") for it in items if it.get("maker_slug")})
    first_maker = maker_slugs[0] if maker_slugs else ""
    headline = ""
    if items:
        try:
            best = max(items, key=lambda it: float(it.get("price") or 0))
            headline = (best.get("title") or "").strip()
        except Exception:
            headline = ""
    title = "Your Crafters Market order was delivered"
    body = (
        f"Loved {headline}? Tap to leave the maker a quick review."
        if headline else "Tap to leave the maker a quick review."
    )
    url = f"/makers/{first_maker}" if first_maker else "/account/orders"
    await notify_buyer_push(to, title, body, url=url, tag="cm-buyer-delivered")


# ─────────────────────── endpoints ───────────────────────
@router.post("/maker/orders/{session_id}/shipping/refresh-tracking")
async def refresh_tracking(session_id: str, slug: str = Depends(current_maker_slug)):
    """Manual pull-through — used when the webhook is slow or missing.
    Queries Shippo `tracking_status` directly and applies whatever comes back."""
    tx = await _assert_owns_order(slug, session_id)
    tracking_number = tx.get("tracking_number")
    carrier = (tx.get("tracking_carrier") or "").lower()
    if not tracking_number:
        raise HTTPException(400, "This order has no tracking number yet.")

    # Shippo wants its carrier TOKEN (e.g. 'usps'). Our `tracking_carrier`
    # column stores the display name ('USPS') since Phase 1 — map common ones.
    carrier_token = _carrier_to_shippo_token(carrier)
    if not carrier_token:
        raise HTTPException(400, f"Unknown carrier '{tx.get('tracking_carrier')}'.")

    result = shippo_service.get_tracking(carrier_token, tracking_number)
    if not result:
        return {"ok": False, "reason": "Shippo has no tracking data yet."}
    changed = await _apply_tracking_update(
        session_id, result.get("status") or "", result.get("status_details") or "", result.get("eta") or "",
    )
    return {"ok": True, "changed": changed, "status": result.get("status"), "eta": result.get("eta")}


def _carrier_to_shippo_token(carrier: str) -> str:
    mapping = {
        "usps":  "usps",
        "ups":   "ups",
        "fedex": "fedex",
        "dhl":   "dhl_express",
        "dhlexpress": "dhl_express",
    }
    return mapping.get((carrier or "").replace(" ", "").lower(), "")


# ─────────────────── PUBLIC webhook (no auth) ───────────────────
@router.post("/shippo/webhook")
async def shippo_webhook(req: Request):
    """Shippo POSTs here whenever a tracked package changes state.

    Payload shape (track_updated):
        { "event": "track_updated", "test": bool, "data": { ...TrackingStatus... } }
    We look up the order by `tracking_number` + apply the status change.
    Always returns 200 to tell Shippo "received" — otherwise Shippo
    retries 2x and eventually drops the event.
    """
    try:
        payload = await req.json()
    except Exception:
        return {"received": True}
    event = payload.get("event") or payload.get("type") or ""
    data = payload.get("data") or payload
    tracking_number = (data or {}).get("tracking_number") or ""
    status_block = (data or {}).get("tracking_status") or {}
    status = (status_block.get("status") or "").upper()
    status_details = status_block.get("status_details") or ""
    eta = (data or {}).get("eta") or ""

    logger.info("[shippo.webhook] event=%s tracking=%s status=%s", event, tracking_number, status)

    if not tracking_number or not status:
        return {"received": True, "reason": "missing tracking_number or status"}

    tx = await db.payment_transactions.find_one({"tracking_number": tracking_number}, {"_id": 0, "session_id": 1})
    if not tx:
        # Not-our-package — Shippo sometimes replays for accounts that
        # share a webhook URL during development. Ack but skip.
        return {"received": True, "reason": "unknown tracking"}

    await _apply_tracking_update(tx["session_id"], status, status_details, eta)
    return {"received": True}


# ───────────────────── Phase 2C · maker ledger view ─────────────────────
@router.get("/maker/shipping/ledger")
async def maker_ledger(slug: str = Depends(current_maker_slug)):
    """Returns the maker's shipping ledger: unbilled pile (next invoice),
    lifetime totals, and the raw rows sorted newest-first."""
    m = await _maker_doc(slug)
    rows = await db.shipping_ledger.find(
        {"maker_slug": slug}, {"_id": 0},
    ).sort("created_at", -1).to_list(500)
    unbilled_cents = sum(r.get("billed_cents", 0) for r in rows if not r.get("billed_at"))
    lifetime_cents = sum(r.get("billed_cents", 0) for r in rows)
    billed_cents = lifetime_cents - unbilled_cents
    unbilled_count = sum(1 for r in rows if not r.get("billed_at"))
    month_spent = await _current_month_shipping_spend_cents(slug)
    return {
        "cadence": m.get("shipping_billing_cadence") or "weekly",
        "currency": rows[0]["currency"] if rows else "USD",
        "unbilled_cents": unbilled_cents,
        "unbilled_count": unbilled_count,
        "lifetime_cents": lifetime_cents,
        "billed_cents": billed_cents,
        "monthly_cap_cents": int(m.get("shipping_monthly_cap_cents") or 0),
        "month_spent_cents": month_spent,
        "rows": rows,
    }


class CadenceUpdate(BaseModel):
    cadence: str  # "weekly" | "biweekly"


@router.patch("/maker/shipping/cadence")
async def set_cadence(body: CadenceUpdate, slug: str = Depends(current_maker_slug)):
    if body.cadence not in ("weekly", "biweekly"):
        raise HTTPException(400, "cadence must be 'weekly' or 'biweekly'")
    await db.makers.update_one(
        {"slug": slug},
        {"$set": {"shipping_billing_cadence": body.cadence, "updated_at": now_iso()}},
    )
    return {"ok": True, "cadence": body.cadence}


class CapUpdate(BaseModel):
    # Dollars — converted to cents server-side so client-side floats don't
    # drift. 0 = disabled. Upper bound is a sanity guard (no $1M caps).
    monthly_cap_usd: float


@router.patch("/maker/shipping/cap")
async def set_cap(body: CapUpdate, slug: str = Depends(current_maker_slug)):
    cents = int(round((body.monthly_cap_usd or 0) * 100))
    if cents < 0:
        raise HTTPException(400, "Cap must be >= 0 (0 disables the cap).")
    if cents > 100_000_00:  # $100,000/mo is the sanity ceiling
        raise HTTPException(400, "Cap must be less than $100,000/mo.")
    await db.makers.update_one(
        {"slug": slug},
        {"$set": {"shipping_monthly_cap_cents": cents, "updated_at": now_iso()}},
    )
    return {"ok": True, "monthly_cap_cents": cents}


@router.post("/maker/shipping/validate-address")
async def validate_address(body: ShipAddress, slug: str = Depends(current_maker_slug)):
    """(f) Pre-flight address validation via Shippo. Used by the modal
    before fetching rates so typos get caught early. Returns either
    `{is_valid: true}` or `{is_valid: false, messages: [...], suggested: {...}}`.
    """
    if not shippo_service.is_configured():
        raise HTTPException(503, "Shippo isn't configured on this deployment.")
    try:
        result = shippo_service.validate_address(body.model_dump())
    except shippo_service.ShippoError as e:
        raise HTTPException(400, str(e))
    return result


# ───────────────────── Shipping analytics (mini-chart) ─────────────────────
@router.get("/maker/shipping/analytics")
async def shipping_analytics(
    days: int = 30,
    slug: str = Depends(current_maker_slug),
):
    """Daily bucket roll-up grouped by carrier. Powers the Maker
    Financials Shipping-labels mini-chart. Returns one row per day for
    the last N days (default 30, clamped to 7..180), even days with
    zero spend — keeps the sparkline visually stable."""
    from datetime import datetime, timedelta, timezone
    days = max(7, min(int(days or 30), 180))

    now = datetime.now(timezone.utc)
    start = (now - timedelta(days=days - 1)).replace(
        hour=0, minute=0, second=0, microsecond=0,
    )
    start_iso = start.isoformat()

    rows = await db.shipping_ledger.find(
        {"maker_slug": slug, "created_at": {"$gte": start_iso}},
        {"_id": 0, "created_at": 1, "provider": 1, "billed_cents": 1},
    ).to_list(5000)

    # Bucket by UTC date + provider bucket.
    # Top-level buckets are deliberately lower-case for FE palette lookup.
    def _prov(p: str) -> str:
        p = (p or "").lower()
        if p.startswith("usps"):
            return "usps"
        if p.startswith("ups"):
            return "ups"
        if p == "fedex":
            return "fedex"
        if p.startswith("dhl"):
            return "dhl"
        return "other"

    series_by_day: dict[str, dict] = {}
    for i in range(days):
        d = (start + timedelta(days=i)).date().isoformat()
        series_by_day[d] = {"date": d, "usps": 0, "ups": 0, "fedex": 0, "dhl": 0, "other": 0, "total": 0, "count": 0}

    totals = {"usps": 0, "ups": 0, "fedex": 0, "dhl": 0, "other": 0, "total": 0, "count": 0}

    for r in rows:
        try:
            day = r["created_at"][:10]
        except Exception:
            continue
        if day not in series_by_day:
            continue  # defensive — out-of-window row
        cents = int(r.get("billed_cents") or 0)
        bucket = _prov(r.get("provider"))
        series_by_day[day][bucket] += cents
        series_by_day[day]["total"] += cents
        series_by_day[day]["count"] += 1
        totals[bucket] += cents
        totals["total"] += cents
        totals["count"] += 1

    series = [series_by_day[d] for d in sorted(series_by_day.keys())]
    # Top carrier by lifetime dollars in the window.
    top = max(("usps", "ups", "fedex", "dhl", "other"), key=lambda k: totals[k]) if totals["count"] else None
    return {
        "days": days,
        "series": series,
        "totals": totals,
        "top_carrier": top,
    }
