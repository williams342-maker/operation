"""iter375 — Variable-priced listings (base $0 + priced variants) must not
be flagged as errors or dropped from catalog feeds.

Covers:
  • Admin zombie checker (/admin/products/incomplete) does NOT flag a
    base-$0 listing whose variants carry positive effective prices,
    but still flags a true $0 listing with no variants.
  • Google Merchant feed.xml includes the variable-priced listing with
    the MIN effective variant price.
  • admin_feeds_health._has_price honors variant pricing.
"""
import os
import sys
import uuid

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
os.environ["DB_NAME"] = "test_database"
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
sys.path.insert(0, "/app/backend")

import pytest
from httpx import ASGITransport, AsyncClient

pytestmark = pytest.mark.asyncio


def test_has_price_with_variant_pricing():
    from routers.admin_feeds_health import _has_price
    # absolute override on variant
    assert _has_price({"price": 0, "variants": [{"price": 25}]}) is True
    # base + delta
    assert _has_price({"price": 0, "variants": [{"price_delta": 12.5}]}) is True
    # true zero
    assert _has_price({"price": 0, "variants": []}) is False
    assert _has_price({"price": 0}) is False
    # normal base price still works
    assert _has_price({"price": 40}) is True


async def test_zombie_checker_and_merchant_feed():
    from core import db
    from maker_auth import issue_session_jwt
    from server import app

    suffix = uuid.uuid4().hex[:8]
    variable_slug = f"iter375-variable-{suffix}"
    zombie_slug = f"iter375-zombie-{suffix}"
    await db.products.insert_many([
        {
            "slug": variable_slug, "title": "Variable Priced Sign",
            "description": "Price depends on size — see variants. " * 3,
            "price": 0.0, "status": "published", "deleted_at": None,
            "in_stock": 5, "maker_slug": "iron-and-oak",
            "images": ["https://example.com/x.jpg"], "category": "Wall Art",
            "variants": [
                {"id": "v1", "label": "Small", "price": 25.0, "price_delta": 0, "in_stock": 3},
                {"id": "v2", "label": "Large", "price": 60.0, "price_delta": 0, "in_stock": 2},
            ],
        },
        {
            "slug": zombie_slug, "title": "True Zombie",
            "description": "no price at all",
            "price": 0.0, "status": "published", "deleted_at": None,
            "in_stock": 1, "maker_slug": "iron-and-oak",
            "images": ["https://example.com/y.jpg"], "category": "Wall Art",
            "variants": [],
        },
    ])
    admin_jwt = issue_session_jwt("admin", "team@craftersmarket.org", role="admin")
    hdrs = {"Authorization": f"Bearer {admin_jwt}"}
    transport = ASGITransport(app=app)
    try:
        async with AsyncClient(transport=transport, base_url="http://t") as c:
            r = await c.get("/api/admin/products/incomplete", headers=hdrs)
            assert r.status_code == 200, r.text
            flagged = {it["slug"]: it["issues"] for it in r.json()["items"]}
            assert variable_slug not in flagged, "variable-priced listing wrongly flagged"
            assert "zero_price" in flagged.get(zombie_slug, [])

            # Google Merchant feed: variable-priced listing present with
            # the min effective variant price; true zombie absent.
            r = await c.get("/api/google-merchant/feed.xml")
            assert r.status_code == 200
            xml = r.text
            assert variable_slug in xml
            seg = xml.split(variable_slug, 1)[1][:2000]
            assert "25.00 USD" in seg
            assert zombie_slug not in xml
    finally:
        await db.products.delete_many({"slug": {"$in": [variable_slug, zombie_slug]}})
