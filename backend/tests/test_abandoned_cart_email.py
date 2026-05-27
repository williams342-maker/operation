"""Regression: email-based abandoned-cart sweep (iter264)."""
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest

from core import db


TEST_EMAIL = "_pytest_cart_email@example.com"


async def _cleanup():
    await db.abandoned_carts.delete_many({"email": TEST_EMAIL})
    await db.marketing_codes.delete_many({"issued_to_email": TEST_EMAIL})


def _items() -> list[dict]:
    return [
        {"id": "p1", "title": "Wood Steampunk Box", "price": 49.0,
         "image": "https://example.com/box.jpg", "quantity": 1},
        {"id": "p2", "title": "Brass Compass", "price": 19.0, "quantity": 1},
    ]


def _patch_send():
    """`_send` is imported lazily inside fire_abandoned_cart_emails to
    break a circular import. Patch at the source module instead."""
    return patch("email_service._send", new_callable=AsyncMock)


@pytest.mark.asyncio
async def test_first_nudge_fires_after_2h_no_discount():
    """Cart updated 3h ago → first nudge sends, no discount code, attempt_count=1."""
    from routers.abandoned_cart import fire_abandoned_cart_emails
    await _cleanup()
    three_hours_ago = (datetime.now(timezone.utc) - timedelta(hours=3)).isoformat().replace("+00:00", "Z")
    await db.abandoned_carts.insert_one({
        "email": TEST_EMAIL,
        "items": _items(),
        "updated_at": three_hours_ago,
        "created_at": three_hours_ago,
    })
    with _patch_send() as fake_send:
        fake_send.return_value = {"message_id": "abc"}
        r = await fire_abandoned_cart_emails()
    assert r["sent"] == 1
    assert fake_send.call_count == 1
    subject, html = fake_send.call_args[0][1], fake_send.call_args[0][2]
    assert "still in your cart" in subject.lower()
    assert "10% off" not in subject.lower()  # no discount on first nudge
    assert "Wood Steampunk Box" in html  # spotlight is highest-price
    row = await db.abandoned_carts.find_one({"email": TEST_EMAIL}, {"_id": 0})
    assert row["email_attempt_count"] == 1
    await _cleanup()


@pytest.mark.asyncio
async def test_discount_nudge_fires_after_24h_with_code():
    """Cart updated 25h ago with attempt_count=1 → discount nudge + code created."""
    from routers.abandoned_cart import fire_abandoned_cart_emails
    await _cleanup()
    twenty_five_hours_ago = (datetime.now(timezone.utc) - timedelta(hours=25)).isoformat().replace("+00:00", "Z")
    await db.abandoned_carts.insert_one({
        "email": TEST_EMAIL,
        "items": _items(),
        "updated_at": twenty_five_hours_ago,
        "created_at": twenty_five_hours_ago,
        "email_attempt_count": 1,
    })
    with _patch_send() as fake_send:
        fake_send.return_value = {"message_id": "abc"}
        r = await fire_abandoned_cart_emails()
    assert r["sent"] == 1
    subject, html = fake_send.call_args[0][1], fake_send.call_args[0][2]
    assert "10% off" in subject.lower()
    assert "BACK" in html  # discount code surfaces in the body
    row = await db.abandoned_carts.find_one({"email": TEST_EMAIL}, {"_id": 0})
    assert row["email_attempt_count"] == 2
    assert row["discount_code_issued"].startswith("BACK")
    # Code must be persisted in marketing_codes so checkout can honour it
    code_row = await db.marketing_codes.find_one(
        {"issued_to_email": TEST_EMAIL}, {"_id": 0},
    )
    assert code_row is not None
    assert code_row["scope"] == "marketplace_wide"
    assert code_row["discount_pct"] == 10.0
    assert code_row["active"] is True
    await _cleanup()


@pytest.mark.asyncio
async def test_does_not_double_fire_within_window():
    """Cart updated 3h ago with attempt_count=1 → no nudge (already sent)."""
    from routers.abandoned_cart import fire_abandoned_cart_emails
    await _cleanup()
    three_hours_ago = (datetime.now(timezone.utc) - timedelta(hours=3)).isoformat().replace("+00:00", "Z")
    await db.abandoned_carts.insert_one({
        "email": TEST_EMAIL,
        "items": _items(),
        "updated_at": three_hours_ago,
        "email_attempt_count": 1,
    })
    with _patch_send() as fake_send:
        r = await fire_abandoned_cart_emails()
    assert r["sent"] == 0
    assert fake_send.call_count == 0
    await _cleanup()


@pytest.mark.asyncio
async def test_skips_checked_out_carts():
    """Cart that already converted → never gets a re-engagement email."""
    from routers.abandoned_cart import fire_abandoned_cart_emails
    await _cleanup()
    three_hours_ago = (datetime.now(timezone.utc) - timedelta(hours=3)).isoformat().replace("+00:00", "Z")
    await db.abandoned_carts.insert_one({
        "email": TEST_EMAIL,
        "items": _items(),
        "updated_at": three_hours_ago,
        "checked_out_at": three_hours_ago,
    })
    with _patch_send() as fake_send:
        r = await fire_abandoned_cart_emails()
    assert r["sent"] == 0
    assert fake_send.call_count == 0
    await _cleanup()


@pytest.mark.asyncio
async def test_skips_under_2h_carts():
    """Cart updated 1h ago → too fresh, no nudge."""
    from routers.abandoned_cart import fire_abandoned_cart_emails
    await _cleanup()
    one_hour_ago = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat().replace("+00:00", "Z")
    await db.abandoned_carts.insert_one({
        "email": TEST_EMAIL,
        "items": _items(),
        "updated_at": one_hour_ago,
    })
    with _patch_send() as fake_send:
        r = await fire_abandoned_cart_emails()
    assert r["sent"] == 0
    assert fake_send.call_count == 0
    await _cleanup()
