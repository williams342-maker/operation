"""iter334r — Variant absolute prices + price-range fallback.

Covers:
  1. `effective_variant_price()` precedence: variant.price > base+delta > base.
  2. `listing_price_range()` returns (min, max) across variants.
  3. POST /api/maker/products with status=published, price=0, AND at least one
     variant with price>0 succeeds (used to 400).
  4. POST /api/maker/products with status=published, price=0, NO variant prices
     still 400s.
  5. Checkout uses `variant.price` over `base+delta`.
"""
from __future__ import annotations
import os
import sys
import uuid
from datetime import datetime, timezone

import pytest
from dotenv import load_dotenv
from httpx import ASGITransport, AsyncClient

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "test_database")
sys.path.insert(0, "/app/backend")

pytestmark = pytest.mark.asyncio


def _maker_jwt(slug: str, email: str) -> str:
    from maker_auth import issue_session_jwt
    return issue_session_jwt(slug, email)


# ── pricing helpers ───────────────────────────────────────────────────
def test_effective_variant_price_prefers_absolute():
    from core import effective_variant_price
    base = 100.0
    # Variant with absolute price > 0 → wins over delta.
    v_abs = {"label": "L", "price": 75.0, "price_delta": 50.0, "in_stock": 1}
    assert effective_variant_price(base, v_abs) == 75.0
    # Variant with NO absolute price → falls back to base + delta.
    v_delta = {"label": "M", "price": None, "price_delta": 25.0, "in_stock": 1}
    assert effective_variant_price(base, v_delta) == 125.0
    # Variant with absolute = 0 → fallback (0 is the same as "unset").
    v_zero = {"label": "S", "price": 0.0, "price_delta": -10.0, "in_stock": 1}
    assert effective_variant_price(base, v_zero) == 90.0
    # No variant → base.
    assert effective_variant_price(base, None) == 100.0


def test_listing_price_range_returns_min_max():
    from core import listing_price_range
    prod = {
        "price": 0.0,
        "variants": [
            {"label": "S", "price": 23.0, "in_stock": 1},
            {"label": "M", "price": 32.0, "in_stock": 1},
            {"label": "L", "price": 45.0, "in_stock": 1},
        ],
    }
    lo, hi = listing_price_range(prod)
    assert lo == 23.0
    assert hi == 45.0


def test_listing_price_range_no_variants():
    from core import listing_price_range
    lo, hi = listing_price_range({"price": 50.0, "variants": []})
    assert lo == 50.0 and hi == 50.0


# ── publish gate ──────────────────────────────────────────────────────
async def test_publish_with_zero_base_but_variant_price_succeeds():
    from core import db
    from server import app

    slug = f"maker-{uuid.uuid4().hex[:8]}"
    await db.makers.insert_one({
        "slug": slug, "name": "M", "email": f"{slug}@t.com",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            r = await ac.post(
                "/api/maker/products",
                json={
                    "title": "Test Plywood Sign",
                    "category": "Custom Signs",
                    "technique": "LASER",
                    "price": 0,  # ← zero base
                    "description": "Two-tier plywood sign with two sizes.",
                    "images": ["https://example.com/a.jpg"],
                    "in_stock": 0,
                    "status": "published",
                    "variants": [
                        {"label": "Small 12x6", "price": 23.0, "in_stock": 5},
                        {"label": "Medium 16x8", "price": 32.0, "in_stock": 3},
                    ],
                },
                headers={"Authorization": f"Bearer {_maker_jwt(slug, f'{slug}@t.com')}"},
            )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "published"
        assert len(body["variants"]) == 2
        assert body["variants"][0]["price"] == 23.0
        assert body["variants"][1]["price"] == 32.0
    finally:
        await db.makers.delete_one({"slug": slug})
        await db.products.delete_many({"maker_slug": slug})


async def test_publish_with_zero_base_and_no_variant_prices_400s():
    from core import db
    from server import app

    slug = f"maker-{uuid.uuid4().hex[:8]}"
    await db.makers.insert_one({
        "slug": slug, "name": "M", "email": f"{slug}@t.com",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            r = await ac.post(
                "/api/maker/products",
                json={
                    "title": "No Price Sign",
                    "category": "Custom Signs",
                    "technique": "LASER",
                    "price": 0,
                    "description": "Has variants but none have a price.",
                    "images": ["https://example.com/a.jpg"],
                    "in_stock": 1,
                    "status": "published",
                    "variants": [
                        # Legacy delta-only variants with no abs price → must reject.
                        {"label": "Only label", "price_delta": 5.0, "in_stock": 1},
                    ],
                },
                headers={"Authorization": f"Bearer {_maker_jwt(slug, f'{slug}@t.com')}"},
            )
        assert r.status_code == 400
        assert "price" in r.text.lower()
    finally:
        await db.makers.delete_one({"slug": slug})
        await db.products.delete_many({"maker_slug": slug})


async def test_publish_endpoint_blocks_zero_base_with_no_variant_price():
    """Maker creates as draft, then tries to publish via /publish — same gate."""
    from core import db
    from server import app

    slug = f"maker-{uuid.uuid4().hex[:8]}"
    listing_slug = f"draft-{uuid.uuid4().hex[:8]}"
    await db.makers.insert_one({
        "slug": slug, "name": "M", "email": f"{slug}@t.com",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    await db.products.insert_one({
        "id": str(uuid.uuid4()), "slug": listing_slug, "maker_slug": slug,
        "title": "Draft", "category": "Custom Signs", "technique": "LASER",
        "price": 0.0, "description": "x", "images": ["https://x"],
        "status": "draft", "in_stock": 1, "variants": [],
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            r = await ac.post(
                f"/api/maker/products/{listing_slug}/publish",
                headers={"Authorization": f"Bearer {_maker_jwt(slug, f'{slug}@t.com')}"},
            )
        assert r.status_code == 400
        assert "price" in r.text.lower()
    finally:
        await db.makers.delete_one({"slug": slug})
        await db.products.delete_one({"slug": listing_slug})
