"""Iter78 — Mark-shipped guardrail.

If the seller didn't buy a Shippo label, they MUST provide tracking #
AND carrier when marking shipped. Prevents "ship + ghost" — a maker
clicking Mark Shipped without any way for the buyer to track the
package.
"""
from __future__ import annotations
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


def _base_db(tx: dict) -> MagicMock:
    fake = MagicMock()
    fake.payment_transactions.find_one = AsyncMock(return_value=tx)
    fake.products.find = MagicMock(return_value=MagicMock(
        to_list=AsyncMock(return_value=[{"id": "p1", "slug": "p1-slug"}]),
    ))
    fake.payment_transactions.update_one = AsyncMock()
    return fake


@pytest.mark.asyncio
async def test_ship_rejects_without_tracking_and_no_shippo_label():
    """No Shippo label on the tx + no tracking in the body → 400."""
    from fastapi import BackgroundTasks, HTTPException
    from routers.maker import maker_mark_shipped, OrderShipUpdate

    fake = _base_db({
        "session_id": "cs_1", "id": "ord_1",
        "items": [{"product_id": "p1", "quantity": 1, "title": "T"}],
        # no shippo_tx_id, no existing tracking_number
    })
    bg = BackgroundTasks()
    body = OrderShipUpdate()  # empty
    with patch("routers.maker.db", fake):
        with pytest.raises(HTTPException) as exc:
            await maker_mark_shipped("cs_1", body, bg, slug="mk")
    assert exc.value.status_code == 400
    assert "tracking" in exc.value.detail.lower()
    # No update / no email dispatched
    fake.payment_transactions.update_one.assert_not_awaited()


@pytest.mark.asyncio
async def test_ship_rejects_when_only_carrier_provided_no_tracking():
    from fastapi import BackgroundTasks, HTTPException
    from routers.maker import maker_mark_shipped, OrderShipUpdate

    fake = _base_db({
        "session_id": "cs_2", "id": "ord_2",
        "items": [{"product_id": "p1", "quantity": 1, "title": "T"}],
    })
    bg = BackgroundTasks()
    body = OrderShipUpdate(tracking_carrier="USPS")  # carrier only
    with patch("routers.maker.db", fake):
        with pytest.raises(HTTPException) as exc:
            await maker_mark_shipped("cs_2", body, bg, slug="mk")
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_ship_rejects_when_only_tracking_provided_no_carrier():
    """Equal strictness on both fields — tracking without carrier is
    useless because USPS/UPS/FedEx numbers overlap."""
    from fastapi import BackgroundTasks, HTTPException
    from routers.maker import maker_mark_shipped, OrderShipUpdate

    fake = _base_db({
        "session_id": "cs_3", "id": "ord_3",
        "items": [{"product_id": "p1", "quantity": 1, "title": "T"}],
    })
    bg = BackgroundTasks()
    body = OrderShipUpdate(tracking_number="9400111899...")
    with patch("routers.maker.db", fake):
        with pytest.raises(HTTPException) as exc:
            await maker_mark_shipped("cs_3", body, bg, slug="mk")
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_ship_succeeds_with_tracking_and_carrier():
    """Happy path — both fields supplied manually."""
    from fastapi import BackgroundTasks
    from routers.maker import maker_mark_shipped, OrderShipUpdate

    fake = _base_db({
        "session_id": "cs_4", "id": "ord_4",
        "items": [{"product_id": "p1", "quantity": 1, "title": "T"}],
        "customer_email": "buyer@example.com", "customer_name": "Maya",
    })
    bg = BackgroundTasks()
    body = OrderShipUpdate(
        tracking_number="9400111899", tracking_carrier="USPS",
    )
    with patch("routers.maker.db", fake):
        r = await maker_mark_shipped("cs_4", body, bg, slug="mk")
    assert r["ok"] is True
    assert r["order_status"] == "fulfilled"


@pytest.mark.asyncio
async def test_ship_bypasses_guardrail_when_shippo_label_exists():
    """If a Shippo label was already bought, the tx carries tracking
    automatically — maker should still be able to hit "Mark shipped"
    without re-entering anything."""
    from fastapi import BackgroundTasks
    from routers.maker import maker_mark_shipped, OrderShipUpdate

    fake = _base_db({
        "session_id": "cs_5", "id": "ord_5",
        "items": [{"product_id": "p1", "quantity": 1, "title": "T"}],
        "customer_email": "buyer@example.com",
        "shippo_tx_id": "shippo_abc",
        "shippo_label_url": "https://shippo.../label.pdf",
        "tracking_number": "9400SHIPPO", "tracking_carrier": "USPS",
    })
    bg = BackgroundTasks()
    body = OrderShipUpdate()  # empty — guardrail must allow this
    with patch("routers.maker.db", fake):
        r = await maker_mark_shipped("cs_5", body, bg, slug="mk")
    assert r["ok"] is True


@pytest.mark.asyncio
async def test_ship_bypasses_guardrail_when_tracking_already_stamped():
    """Tracking may land on the tx via the Shippo webhook before the
    maker clicks Mark Shipped. Guardrail should treat pre-stamped
    tracking the same as a fresh manual entry."""
    from fastapi import BackgroundTasks
    from routers.maker import maker_mark_shipped, OrderShipUpdate

    fake = _base_db({
        "session_id": "cs_6", "id": "ord_6",
        "items": [{"product_id": "p1", "quantity": 1, "title": "T"}],
        "customer_email": "buyer@example.com",
        "tracking_number": "PRE-STAMPED",
        "tracking_carrier": "USPS",
    })
    bg = BackgroundTasks()
    body = OrderShipUpdate()
    with patch("routers.maker.db", fake):
        r = await maker_mark_shipped("cs_6", body, bg, slug="mk")
    assert r["ok"] is True
