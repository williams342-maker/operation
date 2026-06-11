"""iter359 — Weighted relevance score for /api/products.

Replaces the legacy 3-tier (promoted → plus → rest) sort with a single
numeric score combining: sales_30d, views_7d, review_avg×√count,
recency decay, new-listing bump, promoted/Plus/featured boosts, and
in-stock + lead-time penalties.

These tests seed a tiny controlled catalog and assert the order
reflects the signal weights — they DON'T pin exact scores (jitter is
intentional) but they DO pin relative ranks.
"""
from __future__ import annotations

import os
import sys
from datetime import datetime, timezone, timedelta

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
os.environ["DB_NAME"] = "test_database"
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
sys.path.insert(0, "/app/backend")

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

pytestmark = pytest.mark.asyncio


SLUG_PREFIX = "iter359-rank-"


def _slug(name): return f"{SLUG_PREFIX}{name}"


def _make_product(name, *, days_old=2, promoted=False, plus=False,
                  featured=False, in_stock=4, lead_time=None):
    created = (datetime.now(timezone.utc) - timedelta(days=days_old)).isoformat()
    promo_until = (
        (datetime.now(timezone.utc) + timedelta(days=14)).isoformat()
        if promoted else None
    )
    return {
        "id": f"id-{name}",
        "slug": _slug(name),
        "title": f"Product {name}",
        "description": "x",
        "category": "Wall Art",
        "technique": "CNC",
        "maker_slug": f"maker-{name}",
        "price": 50.0,
        "images": ["https://x/img.jpg"],
        "in_stock": in_stock,
        "status": "published",
        "deleted_at": None,
        "created_at": created,
        "promoted_until": promo_until,
        "featured": featured,
        # `lead_time_days` is a Maker-side denormalization computed by
        # the router; we seed it onto the product directly so the
        # router pipeline propagates it (the override path sets it
        # when a per-listing value isn't present).
        "lead_time_days": lead_time,
        # Tag the corresponding maker as Plus by writing a real maker
        # row — keeps the denormalization path honest.
    }


@pytest_asyncio.fixture(autouse=True)
async def _isolate_db():
    from core import db
    await db.products.delete_many({"slug": {"$regex": f"^{SLUG_PREFIX}"}})
    await db.makers.delete_many({"slug": {"$regex": f"^maker-{SLUG_PREFIX[:-1]}"}})
    await db.events.delete_many({"product_slug": {"$regex": f"^{SLUG_PREFIX}"}})
    await db.reviews.delete_many({"product_slug": {"$regex": f"^{SLUG_PREFIX}"}})
    # Wipe the in-process products cache so the new sort runs.
    from routers.catalog import clear_list_products_cache
    clear_list_products_cache()
    yield
    await db.products.delete_many({"slug": {"$regex": f"^{SLUG_PREFIX}"}})
    await db.makers.delete_many({"slug": {"$regex": f"^maker-{SLUG_PREFIX[:-1]}"}})
    await db.events.delete_many({"product_slug": {"$regex": f"^{SLUG_PREFIX}"}})
    await db.reviews.delete_many({"product_slug": {"$regex": f"^{SLUG_PREFIX}"}})
    clear_list_products_cache()


async def _fetch_slugs(category_filter=None):
    """Return the ordered list of our test slugs (filtering out any
    other catalog noise the live DB might carry)."""
    from server import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        path = "/api/products"
        if category_filter:
            path += f"?category={category_filter}"
        r = await ac.get(path)
    assert r.status_code == 200, r.text
    return [
        p["slug"] for p in r.json()
        if p["slug"].startswith(SLUG_PREFIX)
    ]


async def test_sales_30d_outranks_freshness():
    """A 60-day-old listing with 5 sales in the last 30d should beat a
    brand-new listing with zero sales/views/reviews (sales is the
    strongest signal at +1.4 × log1p)."""
    from core import db
    iso_5d = (datetime.now(timezone.utc) - timedelta(days=5)).isoformat()
    await db.products.insert_many([
        _make_product("bestseller", days_old=60),
        _make_product("brand_new", days_old=1),
    ])
    # Five buys in the last 30 days for the bestseller.
    await db.events.insert_many([
        {"_id": f"buy-{i}", "type": "product_buy",
         "product_slug": _slug("bestseller"), "created_at": iso_5d}
        for i in range(5)
    ])
    order = await _fetch_slugs()
    assert order[:2] == [_slug("bestseller"), _slug("brand_new")], order


async def test_promoted_beats_unpromoted_when_other_signals_equal():
    from core import db
    await db.products.insert_many([
        _make_product("plain"),
        _make_product("paid", promoted=True),
    ])
    order = await _fetch_slugs()
    assert order[:2] == [_slug("paid"), _slug("plain")], order


async def test_high_quality_reviews_outrank_plus_boost():
    """20 reviews × 5.0★ should easily beat a Plus maker's +0.3
    coefficient. Confirms ranking is NOT pay-to-win."""
    from core import db
    # Seed a Plus shop.
    await db.makers.insert_one({
        "slug": "maker-iter359-rank-plus_shop",
        "subscription_status": "active",
    })
    await db.products.insert_many([
        _make_product("plus_shop"),
        _make_product("loved"),
    ])
    await db.reviews.insert_many([
        {"id": f"rev-{i}", "rating": 5, "text": "great",
         "name": "buyer", "location": "",
         "product_slug": _slug("loved"),
         "published_publicly": True,
         "created_at": datetime.now(timezone.utc).isoformat()}
        for i in range(20)
    ])
    order = await _fetch_slugs()
    assert order.index(_slug("loved")) < order.index(_slug("plus_shop")), order


async def test_out_of_stock_demoted_below_in_stock_peers():
    from core import db
    await db.products.insert_many([
        _make_product("oos", in_stock=0),
        _make_product("ok", in_stock=4),
    ])
    order = await _fetch_slugs()
    assert order.index(_slug("ok")) < order.index(_slug("oos")), order


async def test_featured_boost_lifts_above_default():
    from core import db
    await db.products.insert_many([
        _make_product("default"),
        _make_product("editorial", featured=True),
    ])
    order = await _fetch_slugs()
    assert order.index(_slug("editorial")) < order.index(_slug("default")), order


async def test_promoted_one_star_loses_to_five_star_native():
    """The whole point of the new sort: a paid-but-hated listing
    should NOT outrank a beloved organic listing. 1.5 promo boost
    can be exceeded by enough quality reviews."""
    from core import db
    await db.products.insert_many([
        _make_product("paid_bad", promoted=True),
        _make_product("loved_native"),
    ])
    await db.reviews.insert_many(
        [
            {"id": f"rb-{i}", "rating": 1, "text": "bad",
             "name": "x", "location": "",
             "product_slug": _slug("paid_bad"),
             "published_publicly": True,
             "created_at": datetime.now(timezone.utc).isoformat()}
            for i in range(15)
        ] + [
            {"id": f"rg-{i}", "rating": 5, "text": "great",
             "name": "x", "location": "",
             "product_slug": _slug("loved_native"),
             "published_publicly": True,
             "created_at": datetime.now(timezone.utc).isoformat()}
            for i in range(30)
        ]
    )
    order = await _fetch_slugs()
    assert order.index(_slug("loved_native")) < order.index(_slug("paid_bad")), order
