"""Iter72b — Workshop Analytics period-over-period KPI deltas."""
from __future__ import annotations
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


def test_delta_pct_basic_growth():
    from routers.workshop_analytics import _delta_pct
    assert _delta_pct(120, 100) == 20.0
    assert _delta_pct(80, 100) == -20.0
    assert _delta_pct(100, 100) == 0.0


def test_delta_pct_returns_none_when_prior_is_zero():
    """Avoid divide-by-zero / infinite-growth noise — UI shows a `NEW` pill."""
    from routers.workshop_analytics import _delta_pct
    assert _delta_pct(50, 0) is None
    assert _delta_pct(0, 0) is None


def test_delta_pct_rounds_to_one_decimal():
    from routers.workshop_analytics import _delta_pct
    # 333 vs 100 = 233% growth, 1.234 vs 1 = 23.4% growth
    assert _delta_pct(333, 100) == 233.0
    assert _delta_pct(1.234, 1) == 23.4


@pytest.mark.asyncio
async def test_overview_endpoint_includes_deltas_block():
    """Smoke — overview should surface a `deltas` dict with 4 metrics
    each carrying current/prior/pct keys."""
    from routers.workshop_analytics import overview

    fake_db = MagicMock()
    fake_db.community_users.count_documents = AsyncMock(side_effect=[
        100,  # total_users
        20,   # _period_metrics current users
        15,   # _period_metrics prior users
    ])
    fake_db.payment_transactions.count_documents = AsyncMock(return_value=10)
    fake_db.products.count_documents = AsyncMock(return_value=5)
    fake_db.makers.count_documents = AsyncMock(return_value=3)

    # Two aggregates per period_metrics call (paid+revenue), plus one for
    # all-time revenue, plus one per month for the 12-month chart, plus
    # the new_users monthly aggregate. We just need them to return shape-
    # valid empty results so the endpoint doesn't raise.
    async def empty_to_list(_=None):
        return []

    def aggregate_returning_empty(*a, **kw):
        cursor = MagicMock()
        cursor.to_list = empty_to_list
        return cursor
    fake_db.payment_transactions.aggregate = MagicMock(side_effect=aggregate_returning_empty)
    fake_db.community_users.aggregate = MagicMock(side_effect=aggregate_returning_empty)

    with patch("routers.workshop_analytics.db", fake_db):
        r = await overview(_={"role": "admin"})

    assert "deltas" in r
    for k in ("revenue", "orders", "users", "avg_order_value"):
        assert k in r["deltas"]
        d = r["deltas"][k]
        assert "current" in d
        assert "prior" in d
        assert "pct" in d  # may be None when prior=0, but the key must exist
