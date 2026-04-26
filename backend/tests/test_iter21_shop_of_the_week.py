"""Iter21 — Shop of the Week / Crafters Plus homepage spotlight."""
from __future__ import annotations
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


def _async_find(rows):
    """Build the fluent chain motor returns from `db.collection.find(...)`."""
    cursor = MagicMock()
    cursor.sort = MagicMock(return_value=cursor)
    cursor.to_list = AsyncMock(return_value=rows)
    return MagicMock(return_value=cursor)


@pytest.mark.asyncio
async def test_shop_of_the_week_returns_null_when_no_plus_subscribers():
    """Homepage should hide the section gracefully when nobody is on Plus."""
    from routers.catalog import shop_of_the_week
    fake_db = MagicMock()
    fake_db.makers.find = _async_find([])
    with patch("routers.catalog.db", fake_db):
        result = await shop_of_the_week()
    assert result["maker"] is None
    assert result["products"] == []
    assert result["weekly_gmv"] == 0.0


@pytest.mark.asyncio
async def test_shop_of_the_week_picks_highest_gmv_plus_subscriber():
    """Among 2 Plus shops, the one with higher 30-day payout amount wins."""
    from routers.catalog import shop_of_the_week
    fake_db = MagicMock()
    plus_a = {"slug": "iron-and-oak", "subscription_status": "active",
              "name": "Iron & Oak", "subscription_started_at": "2025-01-01"}
    plus_b = {"slug": "metalart-pro", "subscription_status": "active",
              "name": "MetalArt Pro", "subscription_started_at": "2025-02-01"}
    fake_db.makers.find = _async_find([plus_a, plus_b])
    # B has more GMV → B wins.
    fake_db.maker_payouts.find = _async_find([
        {"maker_slug": "iron-and-oak", "amount": 120.0, "session_id": "s1"},
        {"maker_slug": "metalart-pro", "amount": 500.0, "session_id": "s2"},
        {"maker_slug": "metalart-pro", "amount": 100.0, "session_id": "s3"},
    ])
    fake_db.payment_transactions.find = _async_find([
        {"items": [{"product_id": "p-bench-1", "quantity": 2}]},
        {"items": [{"product_id": "p-table-1", "quantity": 1}]},
    ])
    fake_db.products.find = _async_find([
        {"id": "p-bench-1", "slug": "steel-bench"},
        {"id": "p-table-1", "slug": "oak-table"},
    ])
    with patch("routers.catalog.db", fake_db):
        result = await shop_of_the_week()
    assert result["maker"]["slug"] == "metalart-pro"
    assert result["weekly_gmv"] == 600.0


@pytest.mark.asyncio
async def test_shop_of_the_week_falls_back_to_newest_when_no_sales_yet():
    """A brand-new Plus subscriber with zero sales still appears on homepage."""
    from routers.catalog import shop_of_the_week
    fake_db = MagicMock()
    plus = {"slug": "fresh-shop", "subscription_status": "trialing",
            "name": "Fresh", "subscription_started_at": "2026-02-01"}
    fake_db.makers.find = _async_find([plus])
    fake_db.maker_payouts.find = _async_find([])
    fillers = [
        {"slug": "p1", "title": "P1", "maker_slug": "fresh-shop", "price": 50},
        {"slug": "p2", "title": "P2", "maker_slug": "fresh-shop", "price": 60},
        {"slug": "p3", "title": "P3", "maker_slug": "fresh-shop", "price": 70},
        {"slug": "p4", "title": "P4", "maker_slug": "fresh-shop", "price": 80},
    ]
    fake_db.products.find = _async_find(fillers)
    with patch("routers.catalog.db", fake_db):
        result = await shop_of_the_week()
    assert result["maker"]["slug"] == "fresh-shop"
    assert len(result["products"]) == 3
    assert result["weekly_gmv"] == 0.0


@pytest.mark.asyncio
async def test_shop_of_the_week_excludes_free_tier_makers():
    """Free-tier (subscription_status='free') makers must never appear."""
    from routers.catalog import shop_of_the_week
    fake_db = MagicMock()
    # `find` is called with a filter — emulate by returning [] (free is filtered).
    fake_db.makers.find = _async_find([])
    with patch("routers.catalog.db", fake_db):
        result = await shop_of_the_week()
    assert result["maker"] is None
    # Ensure the actual query asked for active/trialing only.
    call_args, _ = fake_db.makers.find.call_args
    assert call_args[0]["subscription_status"]["$in"] == ["active", "trialing"]
