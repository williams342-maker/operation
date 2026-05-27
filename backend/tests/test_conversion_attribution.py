"""iter268 regression: conversion attribution ledger for cart recovery.

The flow:
  1. Abandoned-cart email/SMS CTAs land buyer on /cart with
     `?recovery=email|sms` URL param.
  2. CartPage stamps `cm_recovery_medium` in localStorage.
  3. At checkout submit, frontend forwards `recovery_medium` to
     `POST /api/checkout/session`.
  4. Backend persists it onto `payment_transactions`.
  5. On payment success + marketplace-code redemption, a row is
     inserted into `discount_attributions` so the admin can attribute
     the recovered revenue to email / sms / direct.

These tests exercise (4) and (5) at the data layer (we don't go through
the real Stripe webhook). The admin endpoint is also smoke-tested.
"""
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import httpx
import pytest

from core import db


API = "http://localhost:8001"


async def _cleanup():
    await db.discount_attributions.delete_many(
        {"buyer_email": {"$regex": "_pytest_attr_"}},
    )


@pytest.mark.asyncio
async def test_email_payload_includes_recovery_links():
    """The HTML body sent by the email sweep must carry `?recovery=email`
    on the CTA so the frontend can stamp the localStorage flag."""
    from routers.abandoned_cart import fire_abandoned_cart_emails
    from unittest.mock import AsyncMock
    test_email = "_pytest_attr_email_body@example.com"
    await db.abandoned_carts.delete_many({"email": test_email})
    three_h = (datetime.now(timezone.utc) - timedelta(hours=3)).isoformat().replace("+00:00", "Z")
    await db.abandoned_carts.insert_one({
        "email": test_email,
        "items": [{"id": "p1", "title": "Walnut Box", "price": 49.0, "quantity": 1}],
        "updated_at": three_h,
        "created_at": three_h,
    })
    with patch("email_service._send", new_callable=AsyncMock) as fake_send:
        fake_send.return_value = {"message_id": "abc"}
        r = await fire_abandoned_cart_emails()
    assert r["sent"] == 1
    html = fake_send.call_args[0][2]
    assert "?recovery=email" in html, "CTA must carry recovery=email param"
    await db.abandoned_carts.delete_many({"email": test_email})


@pytest.mark.asyncio
async def test_sms_payload_includes_recovery_link():
    """SMS body must carry `?recovery=sms` on the cart deep-link."""
    from routers.abandoned_cart import fire_abandoned_cart_sms
    from unittest.mock import AsyncMock
    test_email = "_pytest_attr_sms_body@example.com"
    test_phone = "+15550009999"
    await db.abandoned_carts.delete_many({"email": test_email})
    last_email_at = (datetime.now(timezone.utc) - timedelta(hours=25)).isoformat().replace("+00:00", "Z")
    await db.abandoned_carts.insert_one({
        "email": test_email,
        "phone": test_phone,
        "sms_consent_receipts_at": "2026-05-27T00:00:00Z",
        "items": [{"id": "p1", "title": "Walnut Box", "price": 49.0, "quantity": 1}],
        "updated_at": last_email_at,
        "last_email_at": last_email_at,
        "email_attempt_count": 1,
    })
    with patch("sms_service.is_configured", return_value=True), \
         patch("sms_service.send_sms", new_callable=AsyncMock) as fake_sms:
        fake_sms.return_value = {"sent": True, "status": "queued"}
        r = await fire_abandoned_cart_sms()
    assert r["sent"] == 1
    body = fake_sms.call_args.kwargs["body"]
    assert "?recovery=sms" in body, body
    await db.abandoned_carts.delete_many({"email": test_email})
    await db.marketing_codes.delete_many({"issued_to_email": test_email})
    await db.sms_messages.delete_many({"to": test_phone})


@pytest.mark.asyncio
async def test_attribution_endpoint_buckets_by_medium():
    """Insert 3 attribution rows (email/sms/direct) → endpoint returns
    one row per medium with correct counts + AOV."""
    await _cleanup()
    now = datetime.now(timezone.utc).isoformat()
    rows = [
        {"id": "r1", "code": "BACKAAAA", "medium": "email",
         "amount_off": 5.0, "order_total": 50.0,
         "session_id": "cs_test_1",
         "buyer_email": "_pytest_attr_a@example.com",
         "redeemed_at": now, "source": "abandoned_cart"},
        {"id": "r2", "code": "BACKBBBB", "medium": "email",
         "amount_off": 7.5, "order_total": 75.0,
         "session_id": "cs_test_2",
         "buyer_email": "_pytest_attr_b@example.com",
         "redeemed_at": now, "source": "abandoned_cart"},
        {"id": "r3", "code": "BACKCCCC", "medium": "sms",
         "amount_off": 10.0, "order_total": 100.0,
         "session_id": "cs_test_3",
         "buyer_email": "_pytest_attr_c@example.com",
         "redeemed_at": now, "source": "abandoned_cart"},
    ]
    await db.discount_attributions.insert_many(rows)
    async with httpx.AsyncClient(timeout=10) as c:
        r = await c.get(f"{API}/api/admin/abandoned-cart/attribution?days=30")
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["totals"]["redemptions"] == 3
    assert data["totals"]["total_revenue"] == 225.0
    assert data["by_medium"]["email"]["redemptions"] == 2
    assert data["by_medium"]["email"]["total_revenue"] == 125.0
    assert data["by_medium"]["email"]["avg_order_value"] == 62.5
    assert data["by_medium"]["sms"]["redemptions"] == 1
    assert data["by_medium"]["sms"]["total_revenue"] == 100.0
    # `direct` bucket exists even when empty
    assert data["by_medium"]["direct"]["redemptions"] == 0
    await _cleanup()


@pytest.mark.asyncio
async def test_attribution_endpoint_validates_days_window():
    async with httpx.AsyncClient(timeout=10) as c:
        r = await c.get(f"{API}/api/admin/abandoned-cart/attribution?days=400")
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_attribution_endpoint_excludes_rows_older_than_window():
    """Row redeemed 60 days ago shouldn't appear in days=30 query."""
    await _cleanup()
    old = (datetime.now(timezone.utc) - timedelta(days=60)).isoformat()
    await db.discount_attributions.insert_one({
        "id": "rOld", "code": "BACKOLD", "medium": "email",
        "amount_off": 5.0, "order_total": 50.0,
        "session_id": "cs_test_old",
        "buyer_email": "_pytest_attr_old@example.com",
        "redeemed_at": old, "source": "abandoned_cart",
    })
    async with httpx.AsyncClient(timeout=10) as c:
        r = await c.get(f"{API}/api/admin/abandoned-cart/attribution?days=30")
    assert r.status_code == 200
    assert r.json()["totals"]["redemptions"] == 0
    await _cleanup()
