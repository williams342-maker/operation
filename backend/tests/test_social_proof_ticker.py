"""Unit + light integration smoke tests for the social-proof activity ticker
and the ProductCard / Shop-of-the-Week countdown wiring.

Exercises:
  - `_shipped_ticker_text()` headline generation.
  - `GET /api/activity` returns recent sold/shipped events with location.
"""
import os
import sys
import asyncio

import httpx

# Make the app importable from a pytest run rooted in /app/backend
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from routers.maker import _shipped_ticker_text  # noqa: E402


# ---------------------------------------------------------------------------
# Pure-function tests
# ---------------------------------------------------------------------------
def test_shipped_text_picks_highest_priced_item():
    items = [
        {"title": "Steel address numbers", "price": 59},
        {"title": "Mountain wall art", "price": 149},
        {"title": "Coaster set", "price": 24},
    ]
    out = _shipped_ticker_text(items, "Iron & Oak Studio")
    assert out == "Iron & Oak Studio shipped Mountain wall art"


def test_shipped_text_falls_back_when_items_empty():
    assert _shipped_ticker_text([], "Iron & Oak") == "Iron & Oak shipped an order"


def test_shipped_text_falls_back_when_maker_unknown():
    items = [{"title": "Compass medallion", "price": 219}]
    out = _shipped_ticker_text(items, "")
    assert out == "Just shipped — Compass medallion"


def test_shipped_text_handles_missing_price():
    items = [{"title": "Family sign"}, {"title": "Cribbage board", "price": 38}]
    out = _shipped_ticker_text(items, "Williams CNC")
    # Cribbage board has the higher numeric price (0 vs 38)
    assert out == "Williams CNC shipped Cribbage board"


# ---------------------------------------------------------------------------
# Smoke test against the running backend
# ---------------------------------------------------------------------------
def _api_base() -> str:
    # Pytest runs locally; preview backend port is 8001 inside the pod
    return os.environ.get("API_URL_OVERRIDE") or "http://localhost:8001"


def test_activity_endpoint_returns_recent_social_proof():
    async def go():
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.get(f"{_api_base()}/api/activity?limit=20")
            r.raise_for_status()
            return r.json()

    rows = asyncio.run(go())
    assert isinstance(rows, list) and rows, "ticker should not be empty"
    kinds = {row.get("kind") for row in rows}
    # Verify at least one sold + one shipped exist (seeded in social_proof_v1)
    assert "sold" in kinds, f"expected `sold` events in ticker, got {kinds}"
    assert "shipped" in kinds, f"expected `shipped` events in ticker, got {kinds}"
    # Every row must carry text + location
    for row in rows:
        assert row.get("text"), "every event must have non-empty text"
        assert row.get("location"), "every event must have non-empty location"


def test_makers_endpoint_excludes_test_rows():
    async def go():
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.get(f"{_api_base()}/api/makers")
            r.raise_for_status()
            return r.json()

    makers = asyncio.run(go())
    assert isinstance(makers, list) and makers
    for m in makers:
        slug = m.get("slug") or ""
        assert not slug.startswith(("test-", "iter", "beta-", "TEST_")), (
            f"public makers must exclude test slugs, found {slug}"
        )
        assert m.get("cover"), f"every public maker must have a cover image: {slug}"
