"""Revenue ledger unit tests — exercises listing-fee accrual, promotion charge,
and pending-charge settlement on payout. Uses Motor mocks to avoid a real DB."""
from __future__ import annotations
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


@pytest.fixture(autouse=True)
def _reset_revenue_module_state():
    # Each test gets fresh imports so module-level constants reflect monkeypatched env.
    import importlib, revenue
    importlib.reload(revenue)
    yield


@pytest.mark.asyncio
async def test_first_10_listings_are_free_then_charge_kicks_in():
    """Lifetime usage 9 → next publish is free (10/10), 10 → next publish charges $0.20."""
    import revenue
    fake_doc = {"slug": "m1", "listings_used_lifetime": 9, "pending_charges_cents": 0}
    fake_db = MagicMock()
    fake_db.makers.find_one = AsyncMock(return_value=fake_doc)
    fake_db.makers.update_one = AsyncMock()
    with patch.object(revenue, "db", fake_db):
        # 10th listing — still free
        out = await revenue.accrue_listing_charge("m1", "p10")
        assert out["charged"] is False
        assert out["free_remaining"] == 0
        assert out["lifetime"] == 10
        assert out["plus"] is False
        # Now simulate the doc reflecting 10 used listings
        fake_doc["listings_used_lifetime"] = 10
        out2 = await revenue.accrue_listing_charge("m1", "p11")
        assert out2["charged"] is True
        assert out2["amount_cents"] == 20    # default LISTING_FEE_CENTS
        assert out2["lifetime"] == 11


@pytest.mark.asyncio
async def test_promotion_charge_accrues_weekly_fee():
    """Promotion charge is flat $5 × weeks."""
    import revenue
    fake_db = MagicMock()
    fake_db.makers.update_one = AsyncMock()
    with patch.object(revenue, "db", fake_db):
        out = await revenue.accrue_promotion_charge("m1", "p1", weeks=3)
        assert out == {"amount_cents": 1500, "weeks": 3}
        # Asserts $inc and $push were both used
        kwargs = fake_db.makers.update_one.call_args
        upd = kwargs[0][1]
        assert upd["$inc"]["pending_charges_cents"] == 1500
        assert upd["$push"]["charge_history"]["kind"] == "promotion"


@pytest.mark.asyncio
async def test_settle_drains_pending_up_to_gross_amount():
    """If maker has $1.00 pending and gross is $0.40, settle deducts only $0.40."""
    import revenue
    fake_doc = {"slug": "m1", "pending_charges_cents": 100}
    fake_db = MagicMock()
    fake_db.makers.find_one = AsyncMock(return_value=fake_doc)
    fake_db.makers.update_one = AsyncMock()
    with patch.object(revenue, "db", fake_db):
        out = await revenue.settle_pending_charges("m1", gross_cents=40)
    assert out == {"deducted_cents": 40, "remaining_pending_cents": 60}


@pytest.mark.asyncio
async def test_settle_no_op_when_nothing_pending():
    import revenue
    fake_db = MagicMock()
    fake_db.makers.find_one = AsyncMock(return_value={"slug": "m1", "pending_charges_cents": 0})
    fake_db.makers.update_one = AsyncMock()
    with patch.object(revenue, "db", fake_db):
        out = await revenue.settle_pending_charges("m1", gross_cents=100)
    assert out == {"deducted_cents": 0, "remaining_pending_cents": 0}
    fake_db.makers.update_one.assert_not_called()


def test_fee_breakdown_default_5_plus_29_plus_fixed_30():
    """$100 sale → $5 commission + $2.90 + $0.30 processing → $91.80 to maker (free tier).

    Mirrors Stripe's published "2.9% + $0.30" so we recoup their actual cost
    instead of eating fixed-fee shortfall on cheap items.
    """
    from routers.stripe_connect import fee_breakdown_cents
    out = fee_breakdown_cents(100.00, {"subscription_status": "free"})
    assert out["gross_cents"] == 10000
    assert out["commission_cents"] == 500
    assert out["processing_cents"] == 320           # 290 pct + 30 fixed
    assert out["processing_pct_cents"] == 290
    assert out["processing_fixed_cents"] == 30
    assert out["net_cents"] == 9180


def test_fee_breakdown_tiny_order_caps_fixed_fee():
    """$0.40 sale → fees can never exceed gross. We let % go to zero before
    we'd ever take fixed-fee that would push net negative."""
    from routers.stripe_connect import fee_breakdown_cents
    out = fee_breakdown_cents(0.40, {"subscription_status": "free"})
    assert out["gross_cents"] == 40
    # Commission = 5% of 40 = 2. Processing pct = 2.9% of 40 = 1.
    # Fixed would be 30 but capped to remaining = 40 - 2 - 1 = 37.
    # So processing = 1 + min(30, 37) = 31. Net = 40 - 2 - 31 = 7.
    assert out["net_cents"] >= 0, "maker should never owe money"
    assert out["processing_fixed_cents"] <= 30


def test_expiry_iso_returns_utc_ts_120_days_ahead():
    from revenue import expiry_iso_from_now, LISTING_EXPIRY_DAYS
    from datetime import datetime, timezone
    iso = expiry_iso_from_now()
    parsed = datetime.fromisoformat(iso)
    delta_days = (parsed - datetime.now(timezone.utc)).days
    # Allow ±1 day for clock drift across test runs.
    assert LISTING_EXPIRY_DAYS - 1 <= delta_days <= LISTING_EXPIRY_DAYS + 1
