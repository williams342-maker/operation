"""Iter77 — Admin "Refire order emails" bug-fix + tracking email inclusion.

Original bug: the endpoint read from `db.transactions` (0 docs) instead
of `db.payment_transactions` (source of truth for paid orders), so every
REFIRE click returned 404. Fix also hydrates legacy `buyer_email` docs
and falls back to `customer_email` for the current schema.

Additional improvement: when the order is already fulfilled with a
tracking number on file, the refire ALSO fires `send_buyer_shipped`
(iter72 helper) — since "I lost my tracking email" is the most common
reason admins hit REFIRE after fulfillment.

Rate-limit: 30 seconds between refires to protect buyer inbox.
"""
from __future__ import annotations
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


@pytest.mark.asyncio
async def test_refire_reads_from_payment_transactions_not_legacy_collection():
    """Root-cause fix — the endpoint should find orders in
    `payment_transactions` now (was reading from empty `transactions`)."""
    from routers.admin import admin_refire_order_emails

    fake_db = MagicMock()
    # payment_transactions has the order; legacy transactions is empty
    fake_db.payment_transactions.find_one = AsyncMock(return_value={
        "session_id": "cs_1", "id": "ord_1", "amount": 156.99,
        "customer_email": "jane@example.com", "customer_name": "Jane",
        "items": [{"product_id": "p1", "title": "Sign", "quantity": 1, "price": 156.99, "maker_slug": "mk"}],
    })
    fake_db.transactions.find_one = AsyncMock(return_value=None)
    fake_db.makers.find_one = AsyncMock(return_value={"slug": "mk", "name": "MK", "email": "mk@x.com"})
    fake_db.payment_transactions.update_one = AsyncMock()

    # Stub out the actual email dispatch — we just want to verify the
    # endpoint reaches the point where it tries to send.
    with patch("routers.admin.db", fake_db), \
         patch("email_service.send_buyer_receipt", AsyncMock()), \
         patch("email_service.send_maker_new_order", AsyncMock()), \
         patch("email_service.send_ops_new_order", AsyncMock()), \
         patch("email_service.send_buyer_shipped", AsyncMock()):
        r = await admin_refire_order_emails("cs_1", claims={"email": "admin@x.com"})

    assert r["session_id"] == "cs_1"
    assert "buyer_receipt" in r["sent"]
    assert "maker:mk" in r["sent"]
    assert "ops" in r["sent"]
    # No tracking on this order → buyer_shipped should NOT fire
    assert "buyer_shipped" not in r["sent"]


@pytest.mark.asyncio
async def test_refire_includes_buyer_shipped_when_tracking_present():
    """When the order has `tracking_number`, refire ALSO sends the
    tracking/receipt email — resolves the 'check email for tracking'
    use-case the user described."""
    from routers.admin import admin_refire_order_emails

    fake_db = MagicMock()
    fake_db.payment_transactions.find_one = AsyncMock(return_value={
        "session_id": "cs_2", "id": "ord_2", "amount": 156.99,
        "customer_email": "jane@example.com",
        "items": [{"product_id": "p1", "title": "Sign", "quantity": 1, "price": 156.99}],
        "tracking_number": "9334620845500000070826",
        "tracking_carrier": "USPS",
    })
    fake_db.transactions.find_one = AsyncMock(return_value=None)
    fake_db.makers.find_one = AsyncMock(return_value=None)
    fake_db.payment_transactions.update_one = AsyncMock()

    sent_shipped = MagicMock()
    with patch("routers.admin.db", fake_db), \
         patch("email_service.send_buyer_receipt", AsyncMock()), \
         patch("email_service.send_maker_new_order", AsyncMock()), \
         patch("email_service.send_ops_new_order", AsyncMock()), \
         patch("email_service.send_buyer_shipped", AsyncMock(side_effect=sent_shipped)):
        r = await admin_refire_order_emails("cs_2", claims={"email": "admin@x.com"})
    assert "buyer_shipped" in r["sent"]
    sent_shipped.assert_called_once()


@pytest.mark.asyncio
async def test_refire_falls_back_to_legacy_transactions_collection():
    """Defensive — if someone has data ONLY in the old `transactions`
    collection (pre-migration), we shouldn't break them. Read from the
    modern collection first, then fall back."""
    from routers.admin import admin_refire_order_emails

    fake_db = MagicMock()
    fake_db.payment_transactions.find_one = AsyncMock(return_value=None)
    fake_db.transactions.find_one = AsyncMock(return_value={
        "session_id": "cs_legacy", "buyer_email": "legacy@example.com",
        "amount": 50.0, "items": [],
    })
    fake_db.makers.find_one = AsyncMock(return_value=None)
    fake_db.payment_transactions.update_one = AsyncMock()

    with patch("routers.admin.db", fake_db), \
         patch("email_service.send_buyer_receipt", AsyncMock()), \
         patch("email_service.send_maker_new_order", AsyncMock()), \
         patch("email_service.send_ops_new_order", AsyncMock()), \
         patch("email_service.send_buyer_shipped", AsyncMock()):
        r = await admin_refire_order_emails("cs_legacy", claims={"email": "admin@x.com"})
    assert "buyer_receipt" in r["sent"]


@pytest.mark.asyncio
async def test_refire_404_on_unknown_session():
    from fastapi import HTTPException
    from routers.admin import admin_refire_order_emails

    fake_db = MagicMock()
    fake_db.payment_transactions.find_one = AsyncMock(return_value=None)
    fake_db.transactions.find_one = AsyncMock(return_value=None)
    with patch("routers.admin.db", fake_db):
        with pytest.raises(HTTPException) as exc:
            await admin_refire_order_emails("missing", claims={"email": "admin@x.com"})
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_refire_cooldown_returns_429_within_30_seconds():
    from fastapi import HTTPException
    from routers.admin import admin_refire_order_emails

    recent = (datetime.now(timezone.utc) - timedelta(seconds=5)).isoformat().replace("+00:00", "+00:00")
    fake_db = MagicMock()
    fake_db.payment_transactions.find_one = AsyncMock(return_value={
        "session_id": "cs_cool", "amount": 10.0, "items": [],
        "customer_email": "x@x.com",
        "last_admin_refire_at": recent,
    })
    fake_db.transactions.find_one = AsyncMock(return_value=None)

    with patch("routers.admin.db", fake_db):
        with pytest.raises(HTTPException) as exc:
            await admin_refire_order_emails("cs_cool", claims={"email": "admin@x.com"})
    assert exc.value.status_code == 429
