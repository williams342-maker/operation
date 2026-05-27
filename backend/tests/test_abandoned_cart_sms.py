"""Regression: SMS-channel abandoned-cart sweep (iter265)."""
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


def _stub_telnyx():
    """Pretend Telnyx is configured + return a queued Message."""
    cfg = patch("sms_service.is_configured", return_value=True)
    api = patch("sms_service._cfg", return_value={
        "api_key": "KEYxxx", "messaging_profile_id": "MGxxx", "public_key": ""
    })
    return cfg, api


@pytest.mark.asyncio
async def test_sms_unconfigured_returns_noop():
    """No Telnyx env → sweep returns short-circuit dict, no side effects."""
    from routers.abandoned_cart import fire_abandoned_cart_sms
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

    cfg_patch, api_patch = _stub_telnyx()
    with cfg_patch, api_patch, patch("sms_service.telnyx") as fake_telnyx_mod:
        fake_msg = type("FakeMsg", (), {"id": "sms_fake_1", "status": "queued"})()
        fake_telnyx_mod.Message.create.return_value = fake_msg
        r = await fire_abandoned_cart_sms()

    assert r["sent"] == 1, r
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

    cfg_patch, api_patch = _stub_telnyx()
    with cfg_patch, api_patch, patch("sms_service.telnyx") as fake_telnyx_mod:
        fake_msg = type("FakeMsg", (), {"id": "sms_fake_2", "status": "queued"})()
        fake_telnyx_mod.Message.create.return_value = fake_msg
        r = await fire_abandoned_cart_sms()

    assert r["sent"] == 1
    # Body sent to Telnyx must contain the discount code
    call_args = fake_telnyx_mod.Message.create.call_args
    body_sent = call_args.kwargs["text"]
    assert "10% off" in body_sent
    cart = await db.abandoned_carts.find_one({"email": TEST_EMAIL}, {"_id": 0})
    assert cart["sms_attempt_count"] == 2
    assert cart["discount_code_issued"].startswith("BACK")
    code_row = await db.marketing_codes.find_one({"issued_to_email": TEST_EMAIL})
    assert code_row is not None and code_row["active"]
    await _cleanup()


@pytest.mark.asyncio
async def test_sms_skips_carts_without_consent():
    """No `sms_consent_cart_nudges_at` field → cart is not even looked at."""
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
    cfg_patch, api_patch = _stub_telnyx()
    with cfg_patch, api_patch, patch("sms_service.telnyx") as fake_telnyx_mod:
        r = await fire_abandoned_cart_sms()
    assert r["sent"] == 0
    assert fake_telnyx_mod.Message.create.call_count == 0
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

    cfg_patch, api_patch = _stub_telnyx()
    with cfg_patch, api_patch, patch("sms_service.telnyx") as fake_telnyx_mod:
        r = await fire_abandoned_cart_sms()
    assert r["sent"] == 0
    assert fake_telnyx_mod.Message.create.call_count == 0
    await _cleanup()
