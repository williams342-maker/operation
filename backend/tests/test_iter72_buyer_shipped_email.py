"""Iter72 — Buyer-shipped email (tracking + receipt) on mark-shipped + buy-label."""
from __future__ import annotations
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


# ────────────────────────────────────────────────────────────────────────
# Renderer
# ────────────────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_send_buyer_shipped_includes_tracking_and_receipt():
    from email_service import send_buyer_shipped
    captured = {}

    async def fake_send(to, subj, html):
        captured["to"] = to
        captured["subject"] = subj
        captured["html"] = html
        return {"id": "ok"}

    items = [
        {"title": "Mountain Range Silhouette", "price": 149.0, "quantity": 1},
        {"title": "Rustic Family Name Sign",  "price":  79.0, "quantity": 2},
    ]
    with patch("email_service._send", fake_send):
        await send_buyer_shipped(
            buyer_email="buyer@example.com",
            buyer_name="Maya Chen",
            tracking_number="9405511899223197428490",
            carrier="USPS",
            items=items,
            total=307.0,
            order_id="cs_test_abcdef0123456789",
        )
    assert captured["to"] == "buyer@example.com"
    # Subject mentions both tracking + carrier so mailbox preview is useful
    assert "9405511899223197428490" in captured["subject"]
    assert "USPS" in captured["subject"]
    html = captured["html"]
    # Tracking pill
    assert "9405511899223197428490" in html
    assert "Maya" in html
    # Receipt summary — both line items + total
    assert "Mountain Range Silhouette" in html
    assert "Rustic Family Name Sign" in html
    assert "$307.00" in html
    # Carrier deep-link defaults to USPS when carrier=USPS
    assert "tools.usps.com" in html


@pytest.mark.asyncio
async def test_send_buyer_shipped_uses_provider_url_when_supplied():
    """When Shippo gives us a `tracking_url_provider`, we should use it
    instead of the generic carrier fallback (more accurate)."""
    from email_service import send_buyer_shipped
    captured = {}

    async def fake_send(to, subj, html):
        captured["html"] = html
        return {"id": "ok"}

    with patch("email_service._send", fake_send):
        await send_buyer_shipped(
            buyer_email="x@y.com",
            buyer_name="X",
            tracking_number="TRK-1",
            carrier="USPS",
            tracking_url="https://shippo.example/track/abc",
        )
    assert "shippo.example/track/abc" in captured["html"]
    # Generic fallback NOT used
    assert "tools.usps.com" not in captured["html"]


@pytest.mark.asyncio
async def test_send_buyer_shipped_skips_when_email_missing():
    from email_service import send_buyer_shipped
    r = await send_buyer_shipped(
        buyer_email="", buyer_name="X",
        tracking_number="TRK-1", carrier="USPS",
    )
    assert r is None


@pytest.mark.asyncio
async def test_send_buyer_shipped_carrier_fallbacks_for_ups_fedex():
    """Per-carrier deep-link fallbacks should match the carrier brand."""
    from email_service import send_buyer_shipped

    for carrier, host in [
        ("UPS", "ups.com/track"),
        ("FedEx", "fedex.com/fedextrack"),
        ("DHL Express", "dhl.com"),
    ]:
        captured = {}

        async def fake_send(to, subj, html):
            captured["html"] = html
            return {"id": "ok"}

        with patch("email_service._send", fake_send):
            await send_buyer_shipped(
                buyer_email="x@y.com", buyer_name="X",
                tracking_number="TRK-2", carrier=carrier,
            )
        assert host in captured["html"], f"{carrier} deep-link missing: {host}"


# ────────────────────────────────────────────────────────────────────────
# Maker mark-shipped wiring
# ────────────────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_mark_shipped_schedules_buyer_shipped_email_when_tracking_provided():
    """The first time a maker marks an order as shipped with a tracking
    number, the buyer-shipped email should be scheduled as a bg task and
    the tx doc should be stamped `shipped_email_sent=True` so a re-click
    doesn't double-send."""
    from fastapi import BackgroundTasks
    from routers.maker import maker_mark_shipped, OrderShipUpdate

    fake_db = MagicMock()
    fake_db.payment_transactions.find_one = AsyncMock(return_value={
        "session_id": "cs_1", "id": "ord_1",
        "items": [{"product_id": "p1", "quantity": 1, "price": 149,
                   "title": "Test", "maker_slug": "mk"}],
        "amount": 149.0,
        "customer_email": "buyer@example.com",
        "customer_name": "Maya",
    })
    fake_db.products.find = MagicMock(return_value=MagicMock(
        to_list=AsyncMock(return_value=[{"id": "p1", "slug": "p1-slug"}]),
    ))
    fake_db.payment_transactions.update_one = AsyncMock()

    bg = BackgroundTasks()
    body = OrderShipUpdate(tracking_number="TRK-LIVE-1", tracking_carrier="USPS")
    with patch("routers.maker.db", fake_db):
        r = await maker_mark_shipped("cs_1", body, bg, slug="mk")
    assert r["ok"] is True
    # Two update_one calls: 1) status/tracking, 2) shipped_email_sent flag
    assert fake_db.payment_transactions.update_one.await_count == 2
    second_call_set = fake_db.payment_transactions.update_one.await_args_list[1].args[1]["$set"]
    assert second_call_set["shipped_email_sent"] is True
    # bg task scheduled
    fn_names = [t.func.__name__ for t in bg.tasks]
    assert "send_buyer_shipped" in fn_names


@pytest.mark.asyncio
async def test_mark_shipped_does_not_resend_when_already_sent():
    """If `shipped_email_sent` is already True, no bg task is scheduled."""
    from fastapi import BackgroundTasks
    from routers.maker import maker_mark_shipped, OrderShipUpdate

    fake_db = MagicMock()
    fake_db.payment_transactions.find_one = AsyncMock(return_value={
        "session_id": "cs_2", "id": "ord_2",
        "items": [{"product_id": "p1", "quantity": 1, "price": 149,
                   "title": "Test", "maker_slug": "mk"}],
        "customer_email": "buyer@example.com",
        "tracking_number": "TRK-old",
        "shipped_email_sent": True,
    })
    fake_db.products.find = MagicMock(return_value=MagicMock(
        to_list=AsyncMock(return_value=[{"id": "p1", "slug": "p1-slug"}]),
    ))
    fake_db.payment_transactions.update_one = AsyncMock()

    bg = BackgroundTasks()
    body = OrderShipUpdate(tracking_number="TRK-2", tracking_carrier="USPS")
    with patch("routers.maker.db", fake_db):
        await maker_mark_shipped("cs_2", body, bg, slug="mk")
    fn_names = [t.func.__name__ for t in bg.tasks]
    assert "send_buyer_shipped" not in fn_names


@pytest.mark.asyncio
async def test_mark_shipped_rejects_when_no_tracking_number_supplied():
    """Iter78 guardrail — without tracking # + carrier AND without a
    Shippo label on the tx, the endpoint must 400. Previously this was
    allowed (local pickup), but "ship + ghost" was leaving buyers with
    no way to track their package, so per iter78 tracking is now
    required for all non-Shippo fulfillments."""
    from fastapi import BackgroundTasks, HTTPException
    from routers.maker import maker_mark_shipped, OrderShipUpdate

    fake_db = MagicMock()
    fake_db.payment_transactions.find_one = AsyncMock(return_value={
        "session_id": "cs_3", "id": "ord_3",
        "items": [{"product_id": "p1", "quantity": 1, "price": 149,
                   "title": "Test", "maker_slug": "mk"}],
        "customer_email": "buyer@example.com",
    })
    fake_db.products.find = MagicMock(return_value=MagicMock(
        to_list=AsyncMock(return_value=[{"id": "p1", "slug": "p1-slug"}]),
    ))
    fake_db.payment_transactions.update_one = AsyncMock()

    bg = BackgroundTasks()
    body = OrderShipUpdate()  # no tracking
    with patch("routers.maker.db", fake_db):
        with pytest.raises(HTTPException) as exc:
            await maker_mark_shipped("cs_3", body, bg, slug="mk")
    assert exc.value.status_code == 400
    # No email scheduled
    fn_names = [t.func.__name__ for t in bg.tasks]
    assert "send_buyer_shipped" not in fn_names


@pytest.mark.asyncio
async def test_mark_shipped_skips_email_when_no_buyer_email():
    """Manual orders captured without an email shouldn't crash."""
    from fastapi import BackgroundTasks
    from routers.maker import maker_mark_shipped, OrderShipUpdate

    fake_db = MagicMock()
    fake_db.payment_transactions.find_one = AsyncMock(return_value={
        "session_id": "cs_4", "id": "ord_4",
        "items": [{"product_id": "p1", "quantity": 1, "price": 149,
                   "title": "Test", "maker_slug": "mk"}],
        "customer_email": None,
        "shipping_details": {},
    })
    fake_db.products.find = MagicMock(return_value=MagicMock(
        to_list=AsyncMock(return_value=[{"id": "p1", "slug": "p1-slug"}]),
    ))
    fake_db.payment_transactions.update_one = AsyncMock()

    bg = BackgroundTasks()
    body = OrderShipUpdate(tracking_number="TRK", tracking_carrier="USPS")
    with patch("routers.maker.db", fake_db):
        await maker_mark_shipped("cs_4", body, bg, slug="mk")
    fn_names = [t.func.__name__ for t in bg.tasks]
    assert "send_buyer_shipped" not in fn_names
