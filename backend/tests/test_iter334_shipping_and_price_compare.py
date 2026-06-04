"""iter334 — Live shipping preset rates + AI price comparison.

Validates:
  1. Preset rate endpoint accepts known preset_ids and rejects unknown ones.
  2. Preset rate endpoint requires Shippo config — returns 503 when unset.
  3. Price comparison _build_search_query produces a sensible query string.
  4. Price comparison _call_claude parses canonical JSON and clamps numbers.
  5. Price comparison enforces daily limit.

We mock Shippo + Claude calls so the test stays hermetic and fast.
"""
from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest
from dotenv import load_dotenv
from httpx import AsyncClient, ASGITransport

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "test_database")

pytestmark = pytest.mark.asyncio


# ── unit: query builder ────────────────────────────────────────────────
def test_price_compare_query_builder():
    from routers.ai_price_compare import _build_search_query
    q = _build_search_query({
        "title": "Stainless steel CNC mountain wall art",
        "category": "Wall Art",
        "technique": "PLASMA",
        "materials": ["stainless steel", "powder coat"],
    })
    assert "Stainless steel CNC mountain wall art" in q
    assert "Wall Art" in q
    assert "PLASMA" in q
    assert "stainless steel" in q
    assert "price handmade" in q
    assert len(q) <= 120


def test_price_compare_query_builder_handles_empty():
    from routers.ai_price_compare import _build_search_query
    q = _build_search_query({"title": "", "category": "", "technique": "", "materials": []})
    assert q == "price handmade"


# ── unit: claude response coercion ─────────────────────────────────────
async def test_price_compare_claude_clamps_numbers():
    """Ensures _call_claude bounds + sanitizes Claude's JSON output."""
    from routers.ai_price_compare import _call_claude

    listing = {"slug": "test-listing", "title": "Test", "price": 50, "materials": []}

    # Simulate Claude returning numbers as strings + a flipped range.
    fake_reply = json.dumps({
        "price_low": "120",
        "price_median": "40",   # outside the range — should re-center
        "price_high": "80",
        "currency": "USD",
        "comparables": [
            {"title": "Comp A", "source": "Etsy", "price": "75", "url": "https://etsy.com/a"},
            {"title": "Comp B", "source": "Amazon", "price": "abc", "url": "x"},  # bad price → 0
        ],
        "recommendation": "Looks high.",
    })

    class FakeChat:
        def with_model(self, *a, **k): return self
        async def send_message(self, msg): return fake_reply
    
    # Patch the LlmChat constructor inside emergentintegrations
    with patch("routers.ai_price_compare.EMERGENT_LLM_KEY", "fake-key"):
        with patch("emergentintegrations.llm.chat.LlmChat", return_value=FakeChat()):
            result = await _call_claude(listing, "search content")

    # high/low got swapped because 120 > 80
    assert result["price_low"] == 80.0
    assert result["price_high"] == 120.0
    # median was out of range → recentered
    assert result["price_low"] <= result["price_median"] <= result["price_high"]
    assert result["currency"] == "USD"
    assert result["recommendation"] == "Looks high."
    assert len(result["comparables"]) == 2
    assert result["comparables"][0]["price"] == 75.0
    assert result["comparables"][1]["price"] == 0.0  # bad → coerced


async def test_price_compare_claude_parses_fenced_json():
    """Claude sometimes wraps JSON in ```json fences — we should strip them."""
    from routers.ai_price_compare import _call_claude

    listing = {"slug": "test", "title": "x", "price": 10, "materials": []}
    fake_reply = "```json\n" + json.dumps({
        "price_low": 5, "price_median": 10, "price_high": 15,
        "currency": "USD", "comparables": [],
        "recommendation": "Fine.",
    }) + "\n```"

    class FakeChat:
        def with_model(self, *a, **k): return self
        async def send_message(self, msg): return fake_reply

    with patch("routers.ai_price_compare.EMERGENT_LLM_KEY", "fake-key"):
        with patch("emergentintegrations.llm.chat.LlmChat", return_value=FakeChat()):
            result = await _call_claude(listing, "")

    assert result["price_low"] == 5.0
    assert result["price_median"] == 10.0
    assert result["price_high"] == 15.0


# ── integration: preset rates endpoint ─────────────────────────────────
async def _make_test_maker():
    from core import db
    slug = f"test-maker-{uuid.uuid4().hex[:8]}"
    await db.makers.insert_one({
        "slug": slug, "name": "Test Maker", "email": f"{slug}@test.com",
        "ship_from_address": {
            "name": "Test", "street1": "1 Main St", "city": "Austin",
            "state": "TX", "zip": "78701", "country": "US",
        },
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return slug


def _issue_jwt(slug):
    from maker_auth import issue_session_jwt
    return issue_session_jwt(slug, f"{slug}@test.com")


async def test_preset_rates_rejects_unknown_preset():
    from server import app
    slug = await _make_test_maker()
    token = _issue_jwt(slug)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        with patch("shippo_service.is_configured", return_value=True):
            r = await ac.post(
                "/api/maker/shipping/preset-rates",
                json={"preset_id": "not_a_real_preset"},
                headers={"Authorization": f"Bearer {token}"},
            )
    assert r.status_code == 400, r.text
    assert "preset_id" in r.text.lower() or "unknown" in r.text.lower()

    # Cleanup
    from core import db
    await db.makers.delete_one({"slug": slug})


async def test_preset_rates_503_when_shippo_unset():
    from server import app
    slug = await _make_test_maker()
    token = _issue_jwt(slug)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        with patch("shippo_service.is_configured", return_value=False):
            r = await ac.post(
                "/api/maker/shipping/preset-rates",
                json={"preset_id": "envelope"},
                headers={"Authorization": f"Bearer {token}"},
            )
    assert r.status_code == 503, r.text

    from core import db
    await db.makers.delete_one({"slug": slug})


async def test_preset_rates_returns_live_rates_with_mocked_shippo():
    """Happy path — mocked Shippo returns 2 rates, endpoint surfaces them."""
    from server import app
    slug = await _make_test_maker()
    token = _issue_jwt(slug)

    fake_response = {
        "shipment_id": "fake-sid",
        "rates": [
            {"rate_id": "r1", "provider": "USPS", "servicelevel_name": "Priority",
             "servicelevel_token": "usps_priority", "amount": 7.50,
             "currency": "USD", "estimated_days": 3, "duration_terms": ""},
            {"rate_id": "r2", "provider": "UPS", "servicelevel_name": "Ground",
             "servicelevel_token": "ups_ground", "amount": 12.30,
             "currency": "USD", "estimated_days": 5, "duration_terms": ""},
        ],
        "messages": [],
    }

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        with patch("shippo_service.is_configured", return_value=True):
            with patch("shippo_service.is_test_key", return_value=True):
                with patch("shippo_service.get_rates", return_value=fake_response):
                    r = await ac.post(
                        "/api/maker/shipping/preset-rates",
                        json={"preset_id": "small_box", "to_zip": "94110"},
                        headers={"Authorization": f"Bearer {token}"},
                    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["preset_id"] == "small_box"
    assert len(body["rates"]) == 2
    assert body["rates"][0]["amount"] == 7.50
    assert body["rates"][0]["provider"] == "USPS"
    assert body["using_demo_from"] is False  # we set ship-from on the maker
    assert body["test_mode"] is True
    assert body["to_zip"] == "94110"

    from core import db
    await db.makers.delete_one({"slug": slug})


async def test_preset_rates_uses_demo_from_when_maker_has_no_address():
    from server import app
    from core import db

    slug = f"test-maker-{uuid.uuid4().hex[:8]}"
    await db.makers.insert_one({
        "slug": slug, "name": "T", "email": f"{slug}@t.com",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    token = _issue_jwt(slug)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        with patch("shippo_service.is_configured", return_value=True):
            with patch("shippo_service.is_test_key", return_value=True):
                with patch("shippo_service.get_rates", return_value={"shipment_id": "x", "rates": [], "messages": []}):
                    r = await ac.post(
                        "/api/maker/shipping/preset-rates",
                        json={"preset_id": "envelope"},
                        headers={"Authorization": f"Bearer {token}"},
                    )
    assert r.status_code == 200
    assert r.json()["using_demo_from"] is True

    await db.makers.delete_one({"slug": slug})


# iter334b — parcel overrides
async def test_preset_rates_applies_parcel_overrides():
    """When the editor supplies packed_* dims + weight, the backend should
    pass them to Shippo instead of the preset's canonical values, and
    echo back which fields were overridden."""
    from server import app
    slug = await _make_test_maker()
    token = _issue_jwt(slug)

    captured = {}

    def fake_get_rates(from_addr, to_addr, parcel):
        captured["parcel"] = dict(parcel)
        return {"shipment_id": "x", "rates": [], "messages": []}

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        with patch("shippo_service.is_configured", return_value=True):
            with patch("shippo_service.is_test_key", return_value=True):
                with patch("shippo_service.get_rates", side_effect=fake_get_rates):
                    r = await ac.post(
                        "/api/maker/shipping/preset-rates",
                        json={
                            "preset_id": "medium_box",
                            "length": 14.5, "width": 10, "height": 7.25,
                            "weight": 3.5,
                        },
                        headers={"Authorization": f"Bearer {token}"},
                    )
    assert r.status_code == 200, r.text
    body = r.json()
    # Echo of what was used
    assert body["parcel_used"]["length"] == 14.5
    assert body["parcel_used"]["width"] == 10
    assert body["parcel_used"]["height"] == 7.25
    assert body["parcel_used"]["weight"] == 3.5
    assert set(body["parcel_overrides"]) == {"length", "width", "height", "weight"}
    # And the underlying Shippo call got the overrides, not the preset.
    assert captured["parcel"]["length"] == 14.5
    assert captured["parcel"]["weight"] == 3.5

    from core import db
    await db.makers.delete_one({"slug": slug})


async def test_preset_rates_partial_overrides_fall_back_to_preset():
    """If the maker only overrides weight, length/width/height come from the preset."""
    from server import app
    slug = await _make_test_maker()
    token = _issue_jwt(slug)

    captured = {}

    def fake_get_rates(from_addr, to_addr, parcel):
        captured["parcel"] = dict(parcel)
        return {"shipment_id": "x", "rates": [], "messages": []}

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        with patch("shippo_service.is_configured", return_value=True):
            with patch("shippo_service.is_test_key", return_value=True):
                with patch("shippo_service.get_rates", side_effect=fake_get_rates):
                    r = await ac.post(
                        "/api/maker/shipping/preset-rates",
                        json={"preset_id": "small_box", "weight": 1.5},
                        headers={"Authorization": f"Bearer {token}"},
                    )
    assert r.status_code == 200
    body = r.json()
    assert body["parcel_overrides"] == ["weight"]
    # small_box preset: 8.625 × 5.375 × 1.625, 0.75 lbs → length/width/height
    # should still be the preset, weight should be the override.
    assert captured["parcel"]["length"] == 8.625
    assert captured["parcel"]["width"] == 5.375
    assert captured["parcel"]["weight"] == 1.5

    from core import db
    await db.makers.delete_one({"slug": slug})


async def test_preset_rates_rejects_silly_overrides():
    """Weight > 150 lb and dims > 120 in should be rejected by Pydantic."""
    from server import app
    slug = await _make_test_maker()
    token = _issue_jwt(slug)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        with patch("shippo_service.is_configured", return_value=True):
            r = await ac.post(
                "/api/maker/shipping/preset-rates",
                json={"preset_id": "envelope", "weight": 9999},
                headers={"Authorization": f"Bearer {token}"},
            )
    assert r.status_code == 422  # Pydantic validation

    from core import db
    await db.makers.delete_one({"slug": slug})


# ── integration: price-compare daily limit ─────────────────────────────
async def test_price_compare_rate_limit():
    """5 fresh runs/day/listing should block the 6th."""
    from server import app
    from core import db
    from routers.ai_price_compare import PRICE_COMPARE_DAILY_LIMIT

    slug = f"test-maker-{uuid.uuid4().hex[:8]}"
    listing_slug = f"test-listing-{uuid.uuid4().hex[:8]}"
    await db.makers.insert_one({
        "slug": slug, "name": "T", "email": f"{slug}@t.com",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    await db.products.insert_one({
        "slug": listing_slug, "maker_slug": slug, "title": "Test Listing",
        "category": "Wall Art", "technique": "PLASMA", "price": 100.0,
        "materials": [], "created_at": datetime.now(timezone.utc).isoformat(),
    })

    # Pre-seed PRICE_COMPARE_DAILY_LIMIT comparison rows so we're already
    # at the cap. Mark them old enough that the 24h cache MISSES.
    from datetime import timedelta
    old = (datetime.now(timezone.utc) - timedelta(hours=48)).isoformat()
    today = datetime.now(timezone.utc).isoformat()
    for i in range(PRICE_COMPARE_DAILY_LIMIT):
        await db.price_comparisons.insert_one({
            "maker_slug": slug, "listing_slug": listing_slug,
            "created_at": today,  # within today → counts toward limit
            "generated_at": today,
            "price_low": 50, "price_median": 100, "price_high": 150,
            "currency": "USD", "comparables": [], "recommendation": "x",
            "from_cache": False,
        })
    # Add an OLD cached row so cache misses (older than 24h).
    await db.price_comparisons.insert_one({
        "maker_slug": slug, "listing_slug": listing_slug,
        "created_at": old, "generated_at": old,
        "price_low": 1, "price_median": 1, "price_high": 1,
        "currency": "USD", "comparables": [], "recommendation": "stale",
        "from_cache": False,
    })

    token = _issue_jwt(slug)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # Force refresh so we don't hit the 24h cache.
        r = await ac.post(
            f"/api/maker/listings/{listing_slug}/price-compare",
            json={"force_refresh": True},
            headers={"Authorization": f"Bearer {token}"},
        )
    assert r.status_code == 429, r.text
    assert "limit" in r.text.lower()

    # Cleanup
    await db.makers.delete_one({"slug": slug})
    await db.products.delete_one({"slug": listing_slug})
    await db.price_comparisons.delete_many({"maker_slug": slug})


async def test_price_compare_404_for_unknown_listing():
    from server import app
    from core import db

    slug = f"test-maker-{uuid.uuid4().hex[:8]}"
    await db.makers.insert_one({
        "slug": slug, "name": "T", "email": f"{slug}@t.com",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    token = _issue_jwt(slug)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            "/api/maker/listings/nonexistent-listing/price-compare",
            json={},
            headers={"Authorization": f"Bearer {token}"},
        )
    assert r.status_code == 404

    await db.makers.delete_one({"slug": slug})


async def test_price_compare_cache_hit_returns_immediately():
    """If a comparison exists within 24h, return it without calling Jina/Claude."""
    from server import app
    from core import db
    from routers.ai_price_compare import _call_claude  # noqa — we won't call this

    slug = f"test-maker-{uuid.uuid4().hex[:8]}"
    listing_slug = f"test-listing-{uuid.uuid4().hex[:8]}"
    await db.makers.insert_one({
        "slug": slug, "name": "T", "email": f"{slug}@t.com",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    await db.products.insert_one({
        "slug": listing_slug, "maker_slug": slug, "title": "X",
        "category": "Wall Art", "price": 100.0, "materials": [],
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    fresh = datetime.now(timezone.utc).isoformat()
    await db.price_comparisons.insert_one({
        "maker_slug": slug, "listing_slug": listing_slug,
        "created_at": fresh, "generated_at": fresh,
        "price_low": 80, "price_median": 100, "price_high": 120,
        "currency": "USD",
        "comparables": [{"title": "C1", "source": "Etsy", "price": 95, "url": "https://e.com/1"}],
        "recommendation": "cached!",
        "from_cache": False,
    })
    token = _issue_jwt(slug)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            f"/api/maker/listings/{listing_slug}/price-compare",
            json={},
            headers={"Authorization": f"Bearer {token}"},
        )
    assert r.status_code == 200
    body = r.json()
    assert body["from_cache"] is True
    assert body["recommendation"] == "cached!"
    assert body["price_median"] == 100

    await db.makers.delete_one({"slug": slug})
    await db.products.delete_one({"slug": listing_slug})
    await db.price_comparisons.delete_many({"maker_slug": slug})
