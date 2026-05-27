"""Regression: SMS-channel abandoned-cart sweep (iter265).

Telnyx is patched at the `sms_service.send_sms` boundary (rather than the
inner `telnyx.Message.create`) because `import telnyx` is lazy — done
inside `send_sms` itself — so `sms_service.telnyx` doesn't exist as a
module attribute at patch-time.

Likewise `is_configured` is patched explicitly per-test (rather than
relying on env-var presence) so the suite is deterministic regardless of
whether TELNYX_API_KEY is set in `.env`.
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
    """Patch the boundary `fire_abandoned_cart_sms` actually calls."""
    return patch("sms_service.send_sms", new_callable=AsyncMock)


def _patch_is_configured(configured: bool = True):
    return patch("sms_service.is_configured", return_value=configured)


@pytest.mark.asyncio
async def test_sms_unconfigured_returns_noop():
    """Telnyx unconfigured → sweep returns short-circuit dict, no DB scan."""
    from routers.abandoned_cart import fire_abandoned_cart_sms
    with _patch_is_configured(False):
        r = await fire_abandoned_cart_sms()
    assert r.get("reason") == "telnyx_unconfigured"
    assert r["sent"] == 0


@pytest.mark.asyncio
async def test_first_sms_nudge_fires_after_1h():
    """Cart updated 90min ago + consent → first SMS sends, attempt=1."""
    from routers.abandoned_cart import fire_abandoned_cart_sms
    await _cleanup()
    ninety_min_ago = (datetime.now(timezone.utc) - timedelta(minutes=90)).isoformat().replace("+00:00", "Z")
    await db.abandoned_carts.insert_one({
        "email": TEST_EMAIL,
        "phone": TEST_PHONE,
        "sms_consent_cart_nudges_at": "2026-05-27T00:00:00Z",
        "items": _items(),
        "updated_at": ninety_min_ago,
    })

    with _patch_is_configured(True), _patch_send_sms() as fake_send:
        fake_send.return_value = {"sent": True, "status": "queued", "message_sid": "sms_fake_1"}
        r = await fire_abandoned_cart_sms()

    assert r["sent"] == 1, r
    assert fake_send.call_count == 1
    body = fake_send.call_args.kwargs["body"]
    assert "Wood Steampunk Box" in body
    assert "STOP" in body  # opt-out instructions
    assert "10% off" not in body  # no discount on first nudge
    cart = await db.abandoned_carts.find_one({"email": TEST_EMAIL}, {"_id": 0})
    assert cart["sms_attempt_count"] == 1
    await _cleanup()


@pytest.mark.asyncio
async def test_discount_sms_nudge_fires_after_24h_with_code():
    """Cart 25h old + attempt=1 → discount SMS + code persisted."""
    from routers.abandoned_cart import fire_abandoned_cart_sms
    await _cleanup()
    twenty_five_h = (datetime.now(timezone.utc) - timedelta(hours=25)).isoformat().replace("+00:00", "Z")
    await db.abandoned_carts.insert_one({
        "email": TEST_EMAIL,
        "phone": TEST_PHONE,
        "sms_consent_cart_nudges_at": "2026-05-27T00:00:00Z",
        "items": _items(),
        "updated_at": twenty_five_h,
        "sms_attempt_count": 1,
    })

    with _patch_is_configured(True), _patch_send_sms() as fake_send:
        fake_send.return_value = {"sent": True, "status": "queued", "message_sid": "sms_fake_2"}
        r = await fire_abandoned_cart_sms()

    assert r["sent"] == 1
    body = fake_send.call_args.kwargs["body"]
    assert "10% off" in body
    assert "BACK" in body  # discount code surfaces in SMS body
    cart = await db.abandoned_carts.find_one({"email": TEST_EMAIL}, {"_id": 0})
    assert cart["sms_attempt_count"] == 2
    assert cart["discount_code_issued"].startswith("BACK")
    code_row = await db.marketing_codes.find_one({"issued_to_email": TEST_EMAIL})
    assert code_row is not None and code_row["active"]
    await _cleanup()


@pytest.mark.asyncio
async def test_sms_skips_carts_without_consent():
    """No `sms_consent_cart_nudges_at` field → cart is excluded by the query."""
    from routers.abandoned_cart import fire_abandoned_cart_sms
    await _cleanup()
    three_h_ago = (datetime.now(timezone.utc) - timedelta(hours=3)).isoformat().replace("+00:00", "Z")
    await db.abandoned_carts.insert_one({
        "email": TEST_EMAIL,
        "phone": TEST_PHONE,
        # Notice: no sms_consent_cart_nudges_at field
        "items": _items(),
        "updated_at": three_h_ago,
    })
    with _patch_is_configured(True), _patch_send_sms() as fake_send:
        r = await fire_abandoned_cart_sms()
    assert r["sent"] == 0
    assert fake_send.call_count == 0
    await _cleanup()


@pytest.mark.asyncio
async def test_sms_skips_opted_out_numbers():
    """Cart with phone that's in `sms_optouts` → skipped."""
    from routers.abandoned_cart import fire_abandoned_cart_sms
    await _cleanup()
    ninety_min_ago = (datetime.now(timezone.utc) - timedelta(minutes=90)).isoformat().replace("+00:00", "Z")
    await db.sms_optouts.insert_one({"phone": TEST_PHONE, "source": "manual"})
    await db.abandoned_carts.insert_one({
        "email": TEST_EMAIL,
        "phone": TEST_PHONE,
        "sms_consent_cart_nudges_at": "2026-05-27T00:00:00Z",
        "items": _items(),
        "updated_at": ninety_min_ago,
    })

    with _patch_is_configured(True), _patch_send_sms() as fake_send:
        r = await fire_abandoned_cart_sms()
    assert r["sent"] == 0
    assert fake_send.call_count == 0
    await _cleanup()
