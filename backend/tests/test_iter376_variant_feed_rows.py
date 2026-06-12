"""iter376 — Per-variant Google Merchant feed rows.

A listing with variants now emits one <item> per variant with:
  • unique g:id (product id + 8-char variant suffix, ≤50 chars)
  • shared g:item_group_id (the product's google id)
  • exact effective price per variant (override or base+delta)
  • per-variant availability from variant stock
  • g:color / g:size derived from named variant groups
Listings WITHOUT variants still emit the single row (iter365 regression
suites cover that shape).
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


def test_variant_gid_caps_at_50():
    from routers.shop_feeds import _variant_gid
    long_slug = "a" * 80
    gid = _variant_gid(long_slug, "44088ff5ec55")
    assert len(gid) <= 50
    assert gid.endswith("-44088ff5")
    # short slugs keep readable ids
    assert _variant_gid("flag-sign", "v1") == "flag-sign-v1"


def test_variant_option_attrs_maps_color_and_size():
    from routers.shop_feeds import _variant_option_attrs
    p = {"variant_groups": [
        {"name": "Color", "options": [{"id": "o-tan", "label": "Tan"}]},
        {"name": "Size", "options": [{"id": "o-sm", "label": "Small"}]},
        {"name": "Engraving", "options": [{"id": "o-front", "label": "Front only"}]},
    ]}
    out = _variant_option_attrs(p)
    assert out["o-tan"] == ("color", "Tan")
    assert out["o-sm"] == ("size", "Small")
    assert "o-front" not in out  # non color/size groups don't map


async def test_feed_emits_one_item_per_variant():
    from core import db
    from server import app

    slug = f"iter376-variant-feed-{uuid.uuid4().hex[:8]}"
    await db.products.insert_one({
        "slug": slug, "title": "Leather Keychain",
        "description": "Custom pawprint keychain, price varies by size. " * 2,
        "price": 0.0, "status": "published", "deleted_at": None,
        "in_stock": 9, "maker_slug": "iron-and-oak",
        "images": ["https://example.com/k.jpg"], "category": "Accessories",
        "variant_groups": [
            {"id": "g-size", "name": "Size", "options": [
                {"id": "o-sm", "label": "Small", "price_delta": 0},
                {"id": "o-lg", "label": "Large", "price_delta": 0},
            ]},
        ],
        "variants": [
            {"id": "aaaa1111", "label": "Small", "price": 18.0,
             "in_stock": 5, "option_ids": ["o-sm"]},
            {"id": "bbbb2222", "label": "Large", "price": 32.0,
             "in_stock": 0, "option_ids": ["o-lg"]},
        ],
    })
    transport = ASGITransport(app=app)
    try:
        async with AsyncClient(transport=transport, base_url="http://t") as c:
            r = await c.get("/api/google-merchant/feed.xml")
        assert r.status_code == 200
        xml = r.text
        assert f"<g:id>{slug}-aaaa1111</g:id>" in xml
        assert f"<g:id>{slug}-bbbb2222</g:id>" in xml
        assert xml.count(f"<g:item_group_id>{slug}</g:item_group_id>") == 2

        small = xml.split(f"{slug}-aaaa1111", 1)[1][:1600]
        assert "<g:price>18.00 USD</g:price>" in small
        assert "<g:availability>in_stock</g:availability>" in small
        assert "<g:size>Small</g:size>" in small
        assert "Leather Keychain — Small" in small

        large = xml.split(f"{slug}-bbbb2222", 1)[1][:1600]
        assert "<g:price>32.00 USD</g:price>" in large
        assert "<g:availability>out_of_stock</g:availability>" in large
        assert "<g:size>Large</g:size>" in large
    finally:
        await db.products.delete_one({"slug": slug})
