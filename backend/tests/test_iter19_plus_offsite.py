"""Iter19 — Crafters Plus subscription + off-site ad attribution + per-maker
commission rate. Pure unit tests with Motor mocks for the listing-quota path
and live curl-style integration tests for the rest."""
from __future__ import annotations
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


# ---------------- revenue.py: Plus monthly quota -----------------------------

@pytest.mark.asyncio
async def test_plus_subscriber_uses_monthly_quota_not_lifetime():
    """A Plus subscriber with 50 lifetime listings + 0 in this month should
    still get the next listing FREE (15 free/month resets each month)."""
    import importlib, revenue
    importlib.reload(revenue)
    fake_doc = {
        "slug": "m1",
        "subscription_status": "active",
        "listings_used_lifetime": 50,
        "listings_by_month": {},   # no listings yet this month
        "pending_charges_cents": 0,
    }
    fake_db = MagicMock()
    fake_db.makers.find_one = AsyncMock(return_value=fake_doc)
    fake_db.makers.update_one = AsyncMock()
    with patch.object(revenue, "db", fake_db):
        out = await revenue.accrue_listing_charge("m1", "p")
    assert out["plus"] is True
    assert out["charged"] is False, "Plus subscriber's 1st listing of the month must be free"
    assert out["monthly_used"] == 1


@pytest.mark.asyncio
async def test_plus_subscriber_charges_after_15_in_a_month():
    """Plus subscriber's 16th listing in same month → $0.20 charge."""
    import importlib, revenue
    importlib.reload(revenue)
    month = revenue.current_month_key()
    fake_doc = {
        "slug": "m1",
        "subscription_status": "active",
        "listings_used_lifetime": 15,
        "listings_by_month": {month: 15},
        "pending_charges_cents": 0,
    }
    fake_db = MagicMock()
    fake_db.makers.find_one = AsyncMock(return_value=fake_doc)
    fake_db.makers.update_one = AsyncMock()
    with patch.object(revenue, "db", fake_db):
        out = await revenue.accrue_listing_charge("m1", "p16")
    assert out["plus"] is True
    assert out["charged"] is True
    assert out["amount_cents"] == 20
    assert out["monthly_used"] == 16


def test_commission_bps_for_plus_vs_free():
    import importlib, revenue
    importlib.reload(revenue)
    assert revenue.commission_bps_for({"subscription_status": "active"}) == 400
    assert revenue.commission_bps_for({"subscription_status": "free"}) == 500
    assert revenue.commission_bps_for({}) == 500


# ---------------- stripe_connect.fee_breakdown_cents -------------------------

def test_fee_breakdown_plus_keeps_more_than_free():
    """Same $100 sale: free maker keeps $92 (8% off), Plus maker keeps $93 (7%)."""
    from routers.stripe_connect import fee_breakdown_cents
    free = fee_breakdown_cents(100.00, {"subscription_status": "free"})
    plus = fee_breakdown_cents(100.00, {"subscription_status": "active"})
    assert free["net_cents"] == 9200
    assert plus["net_cents"] == 9300, f"Plus net should be $93.00, got {plus}"
    assert plus["commission_cents"] == 400  # 4%
    assert free["commission_cents"] == 500  # 5%


def test_external_attribution_charges_extra_12pct():
    """Off-site attribution adds 12% on top of commission + processing.
    On $100: 5% commission + 3% processing + 12% off-site = 20% → $80 to maker."""
    from routers.stripe_connect import fee_breakdown_cents
    free = fee_breakdown_cents(100.00, {"subscription_status": "free"},
                               external_attribution=True)
    assert free["offsite_cents"] == 1200
    assert free["net_cents"] == 8000


def test_external_attribution_skipped_when_maker_opted_out():
    from routers.stripe_connect import fee_breakdown_cents
    out = fee_breakdown_cents(
        100.00,
        {"subscription_status": "free", "external_ads_opt_out": True},
        external_attribution=True,
    )
    assert out["offsite_cents"] == 0
    assert out["net_cents"] == 9200   # same as no attribution
