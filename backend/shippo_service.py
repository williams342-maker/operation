"""Shippo SDK wrapper — thin layer around goshippo SDK v3.9.

Exposes three primitives the shipping router needs:
    * `get_rates(from_addr, to_addr, parcel)`  → live shipment + rate list
    * `buy_label(rate_id)`                     → transaction w/ PDF + tracking#
    * `get_tracking(carrier_token, tracking)`  → live status (used by Phase 2)

Deliberately dict-in / dict-out so the router can stay Pydantic-centric
without importing Shippo's components namespace everywhere. Raises
`ShippoError` (a plain ValueError subclass) on any failure so FastAPI
handlers can translate to clean 4xx responses instead of leaking SDK
stack traces.
"""
from __future__ import annotations
import os
from typing import Optional
from shippo import Shippo
from shippo.models import components

from core import logger


class ShippoError(ValueError):
    """All Shippo failures bubble up as this so routers can 400-wrap cleanly."""


def _client() -> Shippo:
    key = os.environ.get("SHIPPO_API_KEY")
    if not key:
        raise ShippoError("SHIPPO_API_KEY not configured on this deployment.")
    return Shippo(api_key_header=key)


def is_configured() -> bool:
    return bool(os.environ.get("SHIPPO_API_KEY"))


def is_test_key() -> bool:
    key = os.environ.get("SHIPPO_API_KEY", "")
    return key.startswith("shippo_test_")


# ─────────────────────────── address helpers ───────────────────────────
def _address_payload(addr: dict) -> components.AddressCreateRequest:
    """Normalise a dict into a Shippo AddressCreateRequest.

    Accepts a loose shape because the same helper handles both our stored
    `maker.ship_from_address` (internal keys) AND a `shipping_details.address`
    block pulled from Stripe (`line1`, `postal_code`).
    """
    # stripe-style keys → shippo-style
    street1 = addr.get("street1") or addr.get("line1") or ""
    street2 = addr.get("street2") or addr.get("line2") or ""
    zip_ = addr.get("zip") or addr.get("postal_code") or ""
    country = (addr.get("country") or "US").upper()
    # "United States" → "US" — Shippo only accepts 2-letter codes.
    if len(country) > 2:
        country = {"UNITED STATES": "US", "USA": "US"}.get(country.upper(), country[:2])
    return components.AddressCreateRequest(
        name=addr.get("name") or "",
        company=addr.get("company") or "",
        street1=street1,
        street2=street2 or "",
        city=addr.get("city") or "",
        state=addr.get("state") or "",
        zip=zip_,
        country=country,
        phone=addr.get("phone") or "",
        email=addr.get("email") or "",
    )


def _parcel_payload(p: dict) -> components.ParcelCreateRequest:
    return components.ParcelCreateRequest(
        length=str(p.get("length") or 10),
        width=str(p.get("width") or 8),
        height=str(p.get("height") or 4),
        distance_unit=components.DistanceUnitEnum.IN,
        weight=str(p.get("weight") or 1),
        mass_unit=components.WeightUnitEnum.LB,
    )


# ─────────────────────────── public helpers ────────────────────────────
def get_rates(from_addr: dict, to_addr: dict, parcel: dict) -> dict:
    """Create a shipment and return all available rates sorted cheapest-first.

    Returns
    -------
    {
      "shipment_id": "...",
      "rates": [
         {"rate_id", "provider", "servicelevel_name", "servicelevel_token",
          "amount", "currency", "estimated_days", "duration_terms"},
         ...
      ],
      "messages": [ ... ]   # Shippo validation warnings (non-fatal)
    }
    """
    try:
        ship = _client().shipments.create(components.ShipmentCreateRequest(
            address_from=_address_payload(from_addr),
            address_to=_address_payload(to_addr),
            parcels=[_parcel_payload(parcel)],
            async_=False,
        ))
    except Exception as e:
        logger.exception("[shippo] create shipment failed")
        raise ShippoError(f"Couldn't fetch rates from Shippo: {e}")

    rates = []
    for r in (ship.rates or []):
        rates.append({
            "rate_id": r.object_id,
            "provider": getattr(r, "provider", "") or "",
            "servicelevel_name": getattr(r.servicelevel, "name", "") if getattr(r, "servicelevel", None) else "",
            "servicelevel_token": getattr(r.servicelevel, "token", "") if getattr(r, "servicelevel", None) else "",
            "amount": float(r.amount or 0),
            "currency": r.currency or "USD",
            "estimated_days": getattr(r, "estimated_days", None),
            "duration_terms": getattr(r, "duration_terms", "") or "",
        })
    rates.sort(key=lambda x: x["amount"] or 99999)

    # Normalise `messages` (validation hints) into plain dicts — components
    # are dataclass-ish and won't JSON-serialise straight.
    msgs = []
    for m in (getattr(ship, "messages", None) or []):
        msgs.append({
            "source": getattr(m, "source", "") or "",
            "code": getattr(m, "code", "") or "",
            "text": getattr(m, "text", "") or "",
        })

    return {
        "shipment_id": ship.object_id,
        "rates": rates,
        "messages": msgs,
    }


def buy_label(rate_id: str, label_file_type: str = "PDF_4x6") -> dict:
    """Purchase a label at the given rate.

    Returns
    -------
    {
      "transaction_id", "status", "tracking_number", "tracking_url_provider",
      "label_url", "rate_amount", "currency", "provider", "servicelevel",
      "messages"
    }
    """
    try:
        tx = _client().transactions.create(components.TransactionCreateRequest(
            rate=rate_id,
            label_file_type=getattr(components.LabelFileTypeEnum, label_file_type, components.LabelFileTypeEnum.PDF_4X6),
            async_=False,
        ))
    except Exception as e:
        logger.exception("[shippo] buy label failed")
        raise ShippoError(f"Label purchase failed: {e}")

    status = getattr(tx, "status", "")
    # SDK returns an enum; cast to plain string for JSON.
    status_str = status.value if hasattr(status, "value") else str(status)
    if status_str.upper() != "SUCCESS":
        # Surface the first validation message so the UI can show it.
        msgs = getattr(tx, "messages", None) or []
        first_msg = getattr(msgs[0], "text", "") if msgs else ""
        raise ShippoError(f"Shippo rejected the label purchase: {first_msg or status_str}")

    rate = getattr(tx, "rate", None)
    return {
        "transaction_id": tx.object_id,
        "status": status_str,
        "tracking_number": getattr(tx, "tracking_number", "") or "",
        "tracking_url_provider": getattr(tx, "tracking_url_provider", "") or "",
        "label_url": getattr(tx, "label_url", "") or "",
        "commercial_invoice_url": getattr(tx, "commercial_invoice_url", "") or "",
        "rate_amount": _rate_amount(rate),
        "currency": _rate_currency(rate),
        "provider": _rate_provider(rate),
        "servicelevel_name": _rate_servicelevel(rate),
        "test": bool(getattr(tx, "test", False)),
    }


def _rate_amount(rate) -> float:
    if rate is None:
        return 0.0
    try:
        return float(getattr(rate, "amount", 0) or 0)
    except Exception:
        return 0.0


def validate_address(addr: dict) -> dict:
    """Run Shippo's address validation. Returns:
        {"is_valid": bool, "messages": [...], "suggested": {...|null}}
    The suggested block is Shippo's corrected recommendation; present it
    to the user as a "Did you mean…?" hint before they click Get Rates.
    """
    try:
        a = _client().addresses.create(components.AddressCreateRequest(
            name=addr.get("name") or "",
            company=addr.get("company") or "",
            street1=addr.get("street1") or "",
            street2=addr.get("street2") or "",
            city=addr.get("city") or "",
            state=addr.get("state") or "",
            zip=addr.get("zip") or addr.get("postal_code") or "",
            country=(addr.get("country") or "US").upper()[:2],
            phone=addr.get("phone") or "",
            email=addr.get("email") or "",
            validate=True,
        ))
    except Exception as e:
        raise ShippoError(f"Address validation failed: {e}")
    vr = getattr(a, "validation_results", None)
    messages = []
    for m in (getattr(vr, "messages", None) or []):
        messages.append({
            "source": getattr(m, "source", "") or "",
            "code": getattr(m, "code", "") or "",
            "text": getattr(m, "text", "") or "",
            "type": getattr(m, "type", "") or "",
        })
    is_valid = bool(getattr(vr, "is_valid", False))
    # Shippo's validation also returns the normalised address as the
    # response body itself; surface the key fields as `suggested` so the
    # UI can one-click accept corrections.
    suggested = {
        "name": getattr(a, "name", "") or "",
        "street1": getattr(a, "street1", "") or "",
        "street2": getattr(a, "street2", "") or "",
        "city": getattr(a, "city", "") or "",
        "state": getattr(a, "state", "") or "",
        "zip": getattr(a, "zip", "") or "",
        "country": getattr(a, "country", "") or "",
    }
    return {"is_valid": is_valid, "messages": messages, "suggested": suggested}





def _rate_currency(rate) -> str:
    return getattr(rate, "currency", "USD") if rate is not None else "USD"


def _rate_provider(rate) -> str:
    return getattr(rate, "provider", "") if rate is not None else ""


def _rate_servicelevel(rate) -> str:
    sl = getattr(rate, "servicelevel", None)
    return getattr(sl, "name", "") if sl is not None else ""


def get_tracking(carrier_token: str, tracking_number: str) -> Optional[dict]:
    """Fetch the latest tracking status. Used by the webhook / poll cron.

    Returns None if Shippo can't find the shipment yet (common right after
    label purchase before the carrier has scanned it).
    """
    try:
        t = _client().tracking_status.get(carrier=carrier_token, tracking_number=tracking_number)
    except Exception as e:
        logger.info("[shippo] tracking lookup failed: %s", e)
        return None
    if not t:
        return None
    ts = getattr(t, "tracking_status", None)
    return {
        "tracking_number": tracking_number,
        "carrier_token": carrier_token,
        "status": getattr(ts, "status", "") if ts else "",
        "status_details": getattr(ts, "status_details", "") if ts else "",
        "status_date": str(getattr(ts, "status_date", "") or "") if ts else "",
        "eta": str(getattr(t, "eta", "") or ""),
    }


def ensure_tracking_webhook(public_url: str) -> dict:
    """Idempotently register `public_url` as a `track_updated` webhook.

    Shippo treats webhooks as unique on (url, event). We list existing
    webhooks and skip creation if one already points at our URL for that
    event. This avoids accumulating duplicates on every backend reboot
    when a dev restarts the stack.
    """
    if not is_configured():
        return {"registered": False, "reason": "SHIPPO_API_KEY missing"}
    if not public_url:
        return {"registered": False, "reason": "empty public_url"}
    try:
        c = _client()
        existing = c.webhooks.list_webhooks()
        results = getattr(existing, "results", None) or []
        for w in results:
            if getattr(w, "url", "") == public_url and getattr(w, "event", "") == "track_updated":
                return {"registered": True, "webhook_id": w.object_id, "created": False}
        # Not found → create.
        w = c.webhooks.create_webhook(components.WebhookUpdateRequest(
            url=public_url,
            event=components.WebhookEventTypeEnum.TRACK_UPDATED,
            active=True,
            is_test=is_test_key(),
        ))
        logger.info("[shippo] registered tracking webhook url=%s id=%s", public_url, getattr(w, "object_id", ""))
        return {"registered": True, "webhook_id": getattr(w, "object_id", ""), "created": True}
    except Exception as e:
        logger.warning("[shippo] webhook registration failed (non-fatal): %s", e)
        return {"registered": False, "reason": str(e)}
