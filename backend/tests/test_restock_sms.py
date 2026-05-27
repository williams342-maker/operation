"""iter266 regression: SMS-channel restock waitlist.

Covers the new optional phone + sms_consent_at fields end-to-end:
  1. Signup with phone+consent persists the normalized E.164 + consent ts.
  2. Signup without phone/consent stays email-only (no regression).
  3. `fire_restock_notifications_if_needed` queues an SMS background task
     for every entry that has both phone+consent (and is opted-in), and
     skips entries that don't.
  4. Re-submitting the same email with a phone upgrades the existing
     waitlist row in-place (instead of duplicating or dropping the new
     phone silently).
"""
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import BackgroundTasks

from core import db


TEST_SLUG = "_pytest_restock_sms_prod"
TEST_PRODUCT_ID = "_pytest_restock_sms_pid"
TEST_EMAIL_A = "_pytest_restock_a@example.com"
TEST_EMAIL_B = "_pytest_restock_b@example.com"
TEST_PHONE_E164 = "+15550009876"


async def _cleanup():
    await db.products.delete_many({"id": TEST_PRODUCT_ID})
    await db.restock_waitlist.delete_many({"product_id": TEST_PRODUCT_ID})
    await db.makers.delete_many({"slug": "_pytest_restock_maker"})


async def _seed_oos_product():
    await db.products.delete_many({"id": TEST_PRODUCT_ID})
    await db.products.insert_one({
        "id": TEST_PRODUCT_ID,
        "slug": TEST_SLUG,
        "title": "Test Walnut Box",
        "maker_slug": "_pytest_restock_maker",
        "status": "published",
        "deleted_at": None,
        "in_stock": 0,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    await db.makers.update_one(
        {"slug": "_pytest_restock_maker"},
        {"$set": {"slug": "_pytest_restock_maker", "name": "Test Maker"}},
        upsert=True,
    )


@pytest.mark.asyncio
async def test_signup_without_phone_stays_email_only():
    """Backward-compat: omitting phone leaves the entry email-only."""
    from routers.restock_waitlist import join_restock_waitlist
    from models import RestockWaitlistCreate
    await _cleanup()
    await _seed_oos_product()
    with patch("routers.restock_waitlist.send_buyer_restock_signup",
               new_callable=AsyncMock):
        bg = BackgroundTasks()
        entry = await join_restock_waitlist(
            TEST_SLUG,
            RestockWaitlistCreate(buyer_email=TEST_EMAIL_A, buyer_name="A"),
            bg,
        )
    assert entry.buyer_email == TEST_EMAIL_A
    assert entry.phone is None
    assert entry.sms_consent_at is None
    row = await db.restock_waitlist.find_one(
        {"buyer_email": TEST_EMAIL_A}, {"_id": 0},
    )
    assert row["phone"] is None
    await _cleanup()


@pytest.mark.asyncio
async def test_signup_with_phone_persists_normalized_e164():
    """10-digit US phone → +1xxx normalization; consent ts persisted."""
    from routers.restock_waitlist import join_restock_waitlist
    from models import RestockWaitlistCreate
    await _cleanup()
    await _seed_oos_product()
    consent_iso = "2026-05-27T17:00:00Z"
    with patch("routers.restock_waitlist.send_buyer_restock_signup",
               new_callable=AsyncMock), \
         patch("sms_service.send_sms", new_callable=AsyncMock) as fake_sms:
        fake_sms.return_value = {"sent": True, "status": "queued"}
        bg = BackgroundTasks()
        entry = await join_restock_waitlist(
            TEST_SLUG,
            RestockWaitlistCreate(
                buyer_email=TEST_EMAIL_A,
                phone="5550009876",  # raw 10-digit US
                sms_consent_at=consent_iso,
            ),
            bg,
        )
        # BackgroundTasks queues the call but doesn't execute it until
        # the response is sent. Drain manually so we can assert on it.
        await bg()
    assert entry.phone == TEST_PHONE_E164
    assert entry.sms_consent_at == consent_iso
    assert fake_sms.await_count == 1
    body = fake_sms.await_args.kwargs["body"]
    assert "restock list" in body.lower()
    assert "STOP" in body
    await _cleanup()


@pytest.mark.asyncio
async def test_re_signup_with_phone_upgrades_existing_row():
    """Email-only signup, then second signup adds phone → row upgraded."""
    from routers.restock_waitlist import join_restock_waitlist
    from models import RestockWaitlistCreate
    await _cleanup()
    await _seed_oos_product()
    with patch("routers.restock_waitlist.send_buyer_restock_signup",
               new_callable=AsyncMock), \
         patch("sms_service.send_sms", new_callable=AsyncMock):
        bg = BackgroundTasks()
        await join_restock_waitlist(
            TEST_SLUG,
            RestockWaitlistCreate(buyer_email=TEST_EMAIL_A),
            bg,
        )
        # Second submission with phone
        await join_restock_waitlist(
            TEST_SLUG,
            RestockWaitlistCreate(
                buyer_email=TEST_EMAIL_A,
                phone="+15550009876",
                sms_consent_at="2026-05-27T17:05:00Z",
            ),
            bg,
        )
    rows = await db.restock_waitlist.find(
        {"buyer_email": TEST_EMAIL_A}, {"_id": 0},
    ).to_list(10)
    assert len(rows) == 1, "Should NOT have created a duplicate row"
    assert rows[0]["phone"] == TEST_PHONE_E164
    assert rows[0]["sms_consent_at"] == "2026-05-27T17:05:00Z"
    await _cleanup()


@pytest.mark.asyncio
async def test_fire_restock_sends_email_plus_sms_when_consented():
    """Drain queue: one buyer with SMS opt-in gets BOTH email + SMS;
    another buyer without SMS gets ONLY email."""
    from routers.restock_waitlist import fire_restock_notifications_if_needed
    await _cleanup()
    await _seed_oos_product()
    # Buyer A — email + SMS opted in
    await db.restock_waitlist.insert_one({
        "id": "row_a", "product_id": TEST_PRODUCT_ID,
        "product_slug": TEST_SLUG, "product_title": "Test Walnut Box",
        "maker_slug": "_pytest_restock_maker",
        "buyer_email": TEST_EMAIL_A, "buyer_name": "A",
        "phone": TEST_PHONE_E164,
        "sms_consent_at": "2026-05-27T17:00:00Z",
        "created_at": "2026-05-27T16:00:00Z",
        "notified_at": None,
    })
    # Buyer B — email only
    await db.restock_waitlist.insert_one({
        "id": "row_b", "product_id": TEST_PRODUCT_ID,
        "product_slug": TEST_SLUG, "product_title": "Test Walnut Box",
        "maker_slug": "_pytest_restock_maker",
        "buyer_email": TEST_EMAIL_B, "buyer_name": "B",
        "phone": None, "sms_consent_at": None,
        "created_at": "2026-05-27T16:00:00Z",
        "notified_at": None,
    })
    with patch("email_service.send_buyer_restocked",
               new_callable=AsyncMock) as fake_email, \
         patch("sms_service.send_sms", new_callable=AsyncMock) as fake_sms:
        fake_sms.return_value = {"sent": True, "status": "queued"}
        bg = BackgroundTasks()
        n = await fire_restock_notifications_if_needed(
            product_id=TEST_PRODUCT_ID,
            prev_stock=0, new_stock=5, bg=bg,
        )
        await bg()
    assert n == 2
    assert fake_email.await_count == 2  # both buyers emailed
    assert fake_sms.await_count == 1   # only Buyer A texted
    sms_to = fake_sms.await_args.kwargs["to"]
    assert sms_to == TEST_PHONE_E164
    body = fake_sms.await_args.kwargs["body"]
    assert "back in stock" in body.lower()
    # Both rows marked notified, idempotent
    rows = await db.restock_waitlist.find(
        {"product_id": TEST_PRODUCT_ID}, {"_id": 0},
    ).to_list(10)
    assert all(r["notified_at"] for r in rows)
    await _cleanup()


@pytest.mark.asyncio
async def test_fire_restock_no_op_when_stock_didnt_transition():
    """5 → 10 stock change shouldn't fire anything."""
    from routers.restock_waitlist import fire_restock_notifications_if_needed
    bg = BackgroundTasks()
    n = await fire_restock_notifications_if_needed(
        product_id=TEST_PRODUCT_ID,
        prev_stock=5, new_stock=10, bg=bg,
    )
    assert n == 0
