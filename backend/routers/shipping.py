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
import uuid
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict

from core import db, logger, now_iso
from maker_auth import current_maker_slug
import shippo_service

router = APIRouter()

# Pass-through today. When we decide to add a handling fee surcharge,
# bump this (e.g. 0.10 for 10%) and the ledger row's `markup_cents`
# reflects the delta. Keeps the invoice math trivially auditable.
SHIPPING_MARKUP_PCT = 0.0


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
    return result


@router.post("/maker/orders/{session_id}/shipping/buy-label")
async def buy_label(session_id: str, body: BuyLabelReq, slug: str = Depends(current_maker_slug)):
    await _assert_owns_order(slug, session_id)
    if not shippo_service.is_configured():
        raise HTTPException(503, "Shippo isn't configured on this deployment.")
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
            "shippo_label_url": label["label_url"],
            "shippo_tx_id": label["transaction_id"],
        }},
    )

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
