"""Regression: SMS-channel abandoned-cart fallback (iter267).

Cart-nudges consent was removed in iter267. Cart-recovery SMS now fires
as a transactional fallback ONLY when:
  1. Telnyx is configured (kill-switched at env-var layer)
  2. The cart has a phone + receipts OR shipping consent (proves the
     buyer wanted SMS for order updates)
  3. An abandoned-cart email reminder has already gone out
     (`last_email_at` is set)
  4. ≥ `hours_after_email` (default 24h) have passed since that email
  5. We haven't already SMS'd this cart (sms_attempt_count == 0)
  6. The buyer hasn't checked out and hasn't replied STOP

`fire_abandoned_cart_sms` is patched at the `sms_service.send_sms`
boundary because `import telnyx` is lazy — the inner module attr
doesn't exist until the first real call.
"""
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest

from core import db


TEST_EMAIL = "_pytest_sms_cart@example.com"
TEST_PHONE = "+15550000123"


async def _cleanup():
    await db.abandoned_carts.delete_many({"email": TEST_EMAIL})
    await db.marketing_codes.delete_many({"issued_to_email": TEST_EMAIL})
    await db.sms_messages.delete_many({"to": TEST_PHONE})
    await db.sms_optouts.delete_many({"phone": TEST_PHONE})


def _items() -> list[dict]:
    return [{"id": "p1", "title": "Wood Steampunk Box", "price": 49.0, "quantity": 1}]


def _patch_send_sms():
    return patch("sms_service.send_sms", new_callable=AsyncMock)


def _patch_is_configured(configured: bool = True):
    return patch("sms_service.is_configured", return_value=configured)


def _iso_hours_ago(hours: float) -> str:
    return (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat().replace("+00:00", "Z")


@pytest.mark.asyncio
async def test_sms_unconfigured_returns_noop():
    """Telnyx unconfigured → sweep returns short-circuit dict, no DB scan."""
    from routers.abandoned_cart import fire_abandoned_cart_sms
    with _patch_is_configured(False):
        r = await fire_abandoned_cart_sms()
    assert r.get("reason") == "telnyx_unconfigured"
    assert r["sent"] == 0


@pytest.mark.asyncio
async def test_sms_fires_24h_after_email_with_receipts_consent():
    """Email sent 25h ago + receipts consent + phone → SMS fires once,
    with discount code, attempt_count=1."""
    from routers.abandoned_cart import fire_abandoned_cart_sms
    await _cleanup()
    await db.abandoned_carts.insert_one({
        "email": TEST_EMAIL,
        "phone": TEST_PHONE,
        "sms_consent_receipts_at": "2026-05-27T00:00:00Z",
        "items": _items(),
        "updated_at": _iso_hours_ago(25),
        "last_email_at": _iso_hours_ago(25),
        "email_attempt_count": 1,
    })
    with _patch_is_configured(True), _patch_send_sms() as fake_send:
        fake_send.return_value = {"sent": True, "status": "queued", "message_sid": "sms_fake_1"}
        r = await fire_abandoned_cart_sms()

    assert r["sent"] == 1, r
    assert fake_send.call_count == 1
    body = fake_send.call_args.kwargs["body"]
    assert "Wood Steampunk Box" in body
    assert "10% off" in body  # fallback always carries the discount
    assert "BACK" in body  # discount code surfaces in the body
    assert "STOP" in body  # opt-out instructions
    cart = await db.abandoned_carts.find_one({"email": TEST_EMAIL}, {"_id": 0})
    assert cart["sms_attempt_count"] == 1
    assert cart["discount_code_issued"].startswith("BACK")
    # Discount code persisted into marketing_codes for checkout honour
    code_row = await db.marketing_codes.find_one({"issued_to_email": TEST_EMAIL})
    assert code_row is not None and code_row["active"]
    await _cleanup()


@pytest.mark.asyncio
async def test_sms_fires_with_shipping_consent_only():
    """Shipping consent (no receipts consent) is also sufficient."""
    from routers.abandoned_cart import fire_abandoned_cart_sms
    await _cleanup()
    await db.abandoned_carts.insert_one({
        "email": TEST_EMAIL,
        "phone": TEST_PHONE,
        "sms_consent_shipping_at": "2026-05-27T00:00:00Z",
        "items": _items(),
        "updated_at": _iso_hours_ago(25),
        "last_email_at": _iso_hours_ago(25),
        "email_attempt_count": 1,
    })
    with _patch_is_configured(True), _patch_send_sms() as fake_send:
        fake_send.return_value = {"sent": True, "status": "queued"}
        r = await fire_abandoned_cart_sms()
    assert r["sent"] == 1
    await _cleanup()


@pytest.mark.asyncio
async def test_sms_skipped_when_no_email_sent_yet():
    """Cart with phone + consent but no email sent → NOT eligible for SMS.
    Email must fire FIRST as a less-intrusive reminder."""
    from routers.abandoned_cart import fire_abandoned_cart_sms
    await _cleanup()
    await db.abandoned_carts.insert_one({
        "email": TEST_EMAIL,
        "phone": TEST_PHONE,
        "sms_consent_receipts_at": "2026-05-27T00:00:00Z",
        "items": _items(),
        "updated_at": _iso_hours_ago(48),
        # Notice: no last_email_at — email never went out for this cart
    })
    with _patch_is_configured(True), _patch_send_sms() as fake_send:
        r = await fire_abandoned_cart_sms()
    assert r["sent"] == 0
    assert fake_send.call_count == 0
    await _cleanup()


@pytest.mark.asyncio
async def test_sms_skipped_when_email_too_recent():
    """Email sent 10h ago → too soon for SMS fallback (need 24h+)."""
    from routers.abandoned_cart import fire_abandoned_cart_sms
    await _cleanup()
    await db.abandoned_carts.insert_one({
        "email": TEST_EMAIL,
        "phone": TEST_PHONE,
        "sms_consent_receipts_at": "2026-05-27T00:00:00Z",
        "items": _items(),
        "updated_at": _iso_hours_ago(10),
        "last_email_at": _iso_hours_ago(10),
        "email_attempt_count": 1,
    })
    with _patch_is_configured(True), _patch_send_sms() as fake_send:
        r = await fire_abandoned_cart_sms()
    assert r["sent"] == 0
    assert fake_send.call_count == 0
    await _cleanup()


@pytest.mark.asyncio
async def test_sms_skipped_without_any_transactional_consent():
    """Phone is on the cart but no receipts/shipping consent → no SMS.
    The phone could have arrived through some other channel; without
    transactional consent we don't have permission to text."""
    from routers.abandoned_cart import fire_abandoned_cart_sms
    await _cleanup()
    await db.abandoned_carts.insert_one({
        "email": TEST_EMAIL,
        "phone": TEST_PHONE,
        # Notice: neither sms_consent_receipts_at nor sms_consent_shipping_at
        "items": _items(),
        "updated_at": _iso_hours_ago(48),
        "last_email_at": _iso_hours_ago(48),
        "email_attempt_count": 1,
    })
    with _patch_is_configured(True), _patch_send_sms() as fake_send:
        r = await fire_abandoned_cart_sms()
    assert r["sent"] == 0
    assert fake_send.call_count == 0
    await _cleanup()


@pytest.mark.asyncio
async def test_sms_does_not_double_fire():
    """sms_attempt_count == 1 → already SMS'd, skip even if eligible."""
    from routers.abandoned_cart import fire_abandoned_cart_sms
    await _cleanup()
    await db.abandoned_carts.insert_one({
        "email": TEST_EMAIL,
        "phone": TEST_PHONE,
        "sms_consent_receipts_at": "2026-05-27T00:00:00Z",
        "items": _items(),
        "updated_at": _iso_hours_ago(48),
        "last_email_at": _iso_hours_ago(48),
        "email_attempt_count": 1,
        "sms_attempt_count": 1,
        "last_sms_at": _iso_hours_ago(20),
    })
    with _patch_is_configured(True), _patch_send_sms() as fake_send:
        r = await fire_abandoned_cart_sms()
    assert r["sent"] == 0
    assert fake_send.call_count == 0
    await _cleanup()


@pytest.mark.asyncio
async def test_sms_skips_opted_out_numbers():
    """Cart with phone that's in `sms_optouts` → skipped (carrier compliance)."""
    from routers.abandoned_cart import fire_abandoned_cart_sms
    await _cleanup()
    await db.sms_optouts.insert_one({"phone": TEST_PHONE, "source": "manual"})
    await db.abandoned_carts.insert_one({
        "email": TEST_EMAIL,
        "phone": TEST_PHONE,
        "sms_consent_receipts_at": "2026-05-27T00:00:00Z",
        "items": _items(),
        "updated_at": _iso_hours_ago(25),
        "last_email_at": _iso_hours_ago(25),
        "email_attempt_count": 1,
    })
    with _patch_is_configured(True), _patch_send_sms() as fake_send:
        r = await fire_abandoned_cart_sms()
    assert r["sent"] == 0
    assert fake_send.call_count == 0
    await _cleanup()


@pytest.mark.asyncio
async def test_sms_reuses_email_arms_discount_code():
    """If the 24h discount email already minted a code for this cart,
    the SMS reuses the same code (one consistent code across channels)."""
    from routers.abandoned_cart import fire_abandoned_cart_sms
    await _cleanup()
    existing_code = "BACKXYZW"
    await db.abandoned_carts.insert_one({
        "email": TEST_EMAIL,
        "phone": TEST_PHONE,
        "sms_consent_receipts_at": "2026-05-27T00:00:00Z",
        "items": _items(),
        "updated_at": _iso_hours_ago(50),
        "last_email_at": _iso_hours_ago(26),
        "email_attempt_count": 2,
        "discount_code_issued": existing_code,
    })
    with _patch_is_configured(True), _patch_send_sms() as fake_send:
        fake_send.return_value = {"sent": True, "status": "queued"}
        r = await fire_abandoned_cart_sms()
    assert r["sent"] == 1
    body = fake_send.call_args.kwargs["body"]
    assert existing_code in body, body
    await _cleanup()
