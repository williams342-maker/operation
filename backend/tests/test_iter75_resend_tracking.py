"""Iter75 — Resend tracking email endpoint + 60s rate-limit + cross-maker isolation."""
from __future__ import annotations
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "+00:00")


@pytest.mark.asyncio
async def test_resend_tracking_email_dispatches_buyer_shipped():
    """Happy path — order has tracking + buyer email, resend should
    schedule send_buyer_shipped via bg + stamp last_tracking_resend_at."""
    from fastapi import BackgroundTasks
    from routers.maker import resend_tracking_email

    fake_db = MagicMock()
    fake_db.payment_transactions.find_one = AsyncMock(return_value={
        "session_id": "cs_1", "id": "ord_1",
        "items": [{"product_id": "p1", "quantity": 1, "title": "Test"}],
        "amount": 149.0,
        "customer_email": "buyer@example.com",
        "customer_name": "Maya",
        "tracking_number": "TRK-1",
        "tracking_carrier": "USPS",
    })
    fake_db.products.find = MagicMock(return_value=MagicMock(
        to_list=AsyncMock(return_value=[{"id": "p1", "slug": "p1-slug"}]),
    ))
    fake_db.payment_transactions.update_one = AsyncMock()

    bg = BackgroundTasks()
    with patch("routers.maker.db", fake_db):
        r = await resend_tracking_email("cs_1", bg, slug="mk")
    assert r["ok"] is True
    fn_names = [t.func.__name__ for t in bg.tasks]
    assert "send_buyer_shipped" in fn_names
    fake_db.payment_transactions.update_one.assert_awaited_once()


@pytest.mark.asyncio
async def test_resend_tracking_rate_limits_within_60s():
    """A second resend within 60s should return 429."""
    from fastapi import BackgroundTasks, HTTPException
    from routers.maker import resend_tracking_email

    recent = (datetime.now(timezone.utc) - timedelta(seconds=10)).isoformat().replace("+00:00", "+00:00")
    fake_db = MagicMock()
    fake_db.payment_transactions.find_one = AsyncMock(return_value={
        "session_id": "cs_2", "id": "ord_2",
        "items": [{"product_id": "p1", "quantity": 1, "title": "T"}],
        "customer_email": "buyer@example.com",
        "tracking_number": "TRK-2", "tracking_carrier": "USPS",
        "last_tracking_resend_at": recent,
    })
    fake_db.products.find = MagicMock(return_value=MagicMock(
        to_list=AsyncMock(return_value=[{"id": "p1", "slug": "p1-slug"}]),
    ))

    bg = BackgroundTasks()
    with patch("routers.maker.db", fake_db):
        with pytest.raises(HTTPException) as exc:
            await resend_tracking_email("cs_2", bg, slug="mk")
    assert exc.value.status_code == 429


@pytest.mark.asyncio
async def test_resend_tracking_400_when_no_tracking_yet():
    from fastapi import BackgroundTasks, HTTPException
    from routers.maker import resend_tracking_email

    fake_db = MagicMock()
    fake_db.payment_transactions.find_one = AsyncMock(return_value={
        "session_id": "cs_3",
        "items": [{"product_id": "p1", "quantity": 1, "title": "T"}],
        "customer_email": "buyer@example.com",
        # no tracking_number
    })
    fake_db.products.find = MagicMock(return_value=MagicMock(
        to_list=AsyncMock(return_value=[{"id": "p1", "slug": "p1-slug"}]),
    ))
    bg = BackgroundTasks()
    with patch("routers.maker.db", fake_db):
        with pytest.raises(HTTPException) as exc:
            await resend_tracking_email("cs_3", bg, slug="mk")
    assert exc.value.status_code == 400
    assert "tracking" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_resend_tracking_404_for_other_makers_order():
    """Cross-maker isolation — maker A can't resend a tracking email
    on an order containing only maker B's items."""
    from fastapi import BackgroundTasks, HTTPException
    from routers.maker import resend_tracking_email

    fake_db = MagicMock()
    fake_db.payment_transactions.find_one = AsyncMock(return_value={
        "session_id": "cs_4",
        # items[].product_id is "OTHER-MAKERS-PRODUCT"
        "items": [{"product_id": "other-product", "quantity": 1, "title": "T"}],
        "customer_email": "buyer@example.com",
        "tracking_number": "TRK", "tracking_carrier": "USPS",
    })
    # I (maker mk) only own p1
    fake_db.products.find = MagicMock(return_value=MagicMock(
        to_list=AsyncMock(return_value=[{"id": "p1", "slug": "p1-slug"}]),
    ))
    bg = BackgroundTasks()
    with patch("routers.maker.db", fake_db):
        with pytest.raises(HTTPException) as exc:
            await resend_tracking_email("cs_4", bg, slug="mk")
    assert exc.value.status_code == 404
