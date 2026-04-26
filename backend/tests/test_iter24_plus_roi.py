"""Iter24 — Live Crafters Plus ROI calculator endpoint."""
from __future__ import annotations
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


def _async_find(rows):
    cursor = MagicMock()
    cursor.sort = MagicMock(return_value=cursor)
    cursor.to_list = AsyncMock(return_value=rows)
    return MagicMock(return_value=cursor)


@pytest.mark.asyncio
async def test_plus_roi_zero_sales():
    """Maker with no recent sales: net benefit should be -$12 (just the cost)."""
    from routers.maker import maker_plus_roi
    fake_db = MagicMock()
    fake_db.makers.find_one = AsyncMock(return_value={
        "slug": "fresh-shop", "subscription_status": "free",
        "listings_by_month": {}, "pending_charges_cents": 0, "charge_history": [],
    })
    fake_db.maker_payouts.find = _async_find([])
    with patch("routers.maker.db", fake_db):
        r = await maker_plus_roi(slug="fresh-shop")
    assert r["gross_30d"] == 0
    assert r["commission_savings"] == 0.0
    assert r["net_benefit"] == -12.0
    assert r["is_break_even"] is False


@pytest.mark.asyncio
async def test_plus_roi_break_even_at_high_volume():
    """Maker doing $2,000/30d: 1% savings = $20, net of $12 = +$8 → break-even."""
    from routers.maker import maker_plus_roi
    fake_db = MagicMock()
    fake_db.makers.find_one = AsyncMock(return_value={
        "slug": "busy-shop", "subscription_status": "free",
        "listings_by_month": {}, "pending_charges_cents": 0, "charge_history": [],
    })
    fake_db.maker_payouts.find = _async_find([
        {"amount": 1000.0},
        {"amount": 1000.0},
    ])
    with patch("routers.maker.db", fake_db):
        r = await maker_plus_roi(slug="busy-shop")
    assert r["gross_30d"] == 2000.0
    assert r["commission_savings"] == 20.0   # 1% of $2,000
    assert r["net_benefit"] == 8.0
    assert r["is_break_even"] is True


@pytest.mark.asyncio
async def test_plus_roi_just_below_break_even():
    """At $1,000/30d sales: $10 saved, net = -$2 (still close)."""
    from routers.maker import maker_plus_roi
    fake_db = MagicMock()
    fake_db.makers.find_one = AsyncMock(return_value={
        "slug": "growing-shop", "subscription_status": "free",
        "listings_by_month": {}, "pending_charges_cents": 0, "charge_history": [],
    })
    fake_db.maker_payouts.find = _async_find([{"amount": 1000.0}])
    with patch("routers.maker.db", fake_db):
        r = await maker_plus_roi(slug="growing-shop")
    assert r["commission_savings"] == 10.0
    assert r["net_benefit"] == -2.0
    assert r["is_break_even"] is False


@pytest.mark.asyncio
async def test_plus_roi_returns_404_for_unknown_maker():
    from fastapi import HTTPException
    from routers.maker import maker_plus_roi
    fake_db = MagicMock()
    fake_db.makers.find_one = AsyncMock(return_value=None)
    with patch("routers.maker.db", fake_db):
        with pytest.raises(HTTPException) as exc:
            await maker_plus_roi(slug="unknown")
    assert exc.value.status_code == 404
