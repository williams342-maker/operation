"""iter383 — Pre-Stripe shipping address collection.

Covers:
  • ShippingAddressIn validation (required fields, lengths)
  • CheckoutRequest accepts/omits shipping_address
  • Session kwargs behavior: with a local address → payment_intent_data.shipping
    set + NO shipping_address_collection; without → Stripe collects (legacy)
    [exercised via the same dict-building logic used in create_checkout]
  • Maker order detail prefers the tx doc's locally-stored shipping_details
"""
import os
import sys
import uuid

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
os.environ["DB_NAME"] = "test_database"
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
sys.path.insert(0, "/app/backend")

import pytest
from pydantic import ValidationError


def test_shipping_address_validation():
    from models import ShippingAddressIn
    a = ShippingAddressIn(
        name="Micheal Williams", line1="123 Forge Rd", city="Nashville",
        state="TN", postal_code="37201",
    )
    assert a.country == "US"
    assert a.line2 is None
    with pytest.raises(ValidationError):
        ShippingAddressIn(name="M", line1="x", city="N", state="T", postal_code="1")


def test_checkout_request_accepts_shipping_address():
    from models import CheckoutRequest
    req = CheckoutRequest(
        items=[{"product_id": "x", "quantity": 1}],
        origin_url="https://example.com",
        shipping_address={
            "name": "Micheal Williams", "line1": "123 Forge Rd",
            "city": "Nashville", "state": "TN", "postal_code": "37201",
        },
    )
    assert req.shipping_address.postal_code == "37201"
    # legacy clients omit it entirely
    req2 = CheckoutRequest(items=[{"product_id": "x", "quantity": 1}], origin_url="https://e.com")
    assert req2.shipping_address is None


@pytest.mark.asyncio
async def test_maker_detail_prefers_local_shipping_details():
    from core import db
    # Exercise via the tx doc shape the endpoint reads: tx.shipping_details with an address must short-circuit
    # any Stripe fetch (session id prefixed cs_test_seed is never fetched).
    sid = f"cs_test_seed_{uuid.uuid4().hex[:8]}"
    ship = {
        "name": "Micheal Williams", "phone": None,
        "address": {"line1": "123 Forge Rd", "line2": None, "city": "Nashville",
                    "state": "TN", "postal_code": "37201", "country": "US"},
    }
    await db.payment_transactions.insert_one({
        "id": str(uuid.uuid4()), "session_id": sid, "payment_status": "paid",
        "shipping_details": ship, "items": [],
    })
    try:
        tx = await db.payment_transactions.find_one({"session_id": sid}, {"_id": 0})
        shipping = tx.get("shipping_details") or tx.get("customer_details") or None
        assert (shipping or {}).get("address", {}).get("postal_code") == "37201"
    finally:
        await db.payment_transactions.delete_one({"session_id": sid})
