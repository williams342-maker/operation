"""iter366 — Category-aware Merchant attributes.

Covers:
  • smart color derivation (walnut→Brown, oak→Beige, maple→Tan,
    steel→Gray, black powder coat→Black)
  • material derivation from `materials` field and title keywords
  • profile classification: decor/storage → default (no gender/age),
    jewelry boxes → jewelry_storage (color w/ Multi-color fallback),
    worn jewelry / apparel GPC → apparel (unisex/adult defaults)
  • the live Google feed emits g:material/g:color and NEVER emits
    g:gender / g:age_group for decor & boxes; jewelry rows carry the
    apparel attribute set
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


def test_derive_color_and_material():
    from services.merchant_attributes import derive_color, derive_material

    assert derive_color({"title": "Walnut Trinket Box"}) == "Brown"
    assert derive_color({"title": "White Oak Serving Tray"}) == "Beige"
    assert derive_color({"title": "Maple Coaster Set"}) == "Tan"
    assert derive_color({"title": "Steel Address Plaque"}) == "Gray"
    assert derive_color({"title": "Sign with Black Powder Coat finish"}) == "Black"
    assert derive_color({"title": "Ceramic Vase"}) is None

    # iter369 — explicit sources win over keyword scanning:
    # merchant_color (AI auto-fix) first, then the maker's palette.
    assert derive_color({"title": "Walnut Box", "merchant_color": "Clear"}) == "Clear"
    assert derive_color({"title": "Mystery Item", "colors": ["natural", "Black"]}) == "Natural"
    assert derive_color({"title": "Mystery Item", "colors": ["Custom color"]}) is None

    assert derive_material({"title": "Walnut Trinket Box"}) == "Wood"
    assert derive_material({"title": "Steel Address Plaque"}) == "Steel"
    assert derive_material({"title": "Anything", "materials": ["Baltic Birch", "Brass"]}) == "Baltic Birch"


def test_profiles_and_attribute_sets():
    from services.merchant_attributes import merchant_attributes

    # Home decor box → material + derived color, no gender/age_group
    res = merchant_attributes(
        {"title": "Wooden Dragon Trinket Box", "category": "Home Decor"},
        "Home & Garden > Decor > Decorative Trays",
    )
    assert res["profile"] == "default"
    assert res["attributes"]["material"] == "Wood"
    assert "gender" not in res["attributes"]
    assert "age_group" not in res["attributes"]
    assert "gender" in res["suppressed"] and "age_group" in res["suppressed"]

    # Jewelry BOX → jewelry_storage: color always present (fallback)
    res = merchant_attributes(
        {"title": "Engraved Jewelry Box", "category": "Home Decor"},
        "Home & Garden > Decor",
    )
    assert res["profile"] == "jewelry_storage"
    assert res["attributes"]["color"] == "Multi-color"
    assert "gender" not in res["attributes"]

    # Worn jewelry → apparel set with safe defaults
    res = merchant_attributes(
        {"title": "Hand-stamped Pendant", "category": "Jewelry"},
        "Apparel & Accessories > Jewelry > Necklaces",
    )
    assert res["profile"] == "apparel"
    assert res["attributes"]["gender"] == "unisex"
    assert res["attributes"]["age_group"] == "adult"
    assert res["attributes"]["color"] == "Multi-color"
    assert "size" in res["suppressed"]

    # Walnut decor color derived, never blank where it benefits
    res = merchant_attributes({"title": "Walnut Jewelry Box", "category": "Storage"}, "")
    assert res["profile"] == "jewelry_storage"
    assert res["attributes"]["color"] == "Brown"


def _doc(slug, title, category, **extra):
    return {
        "id": str(uuid.uuid4()), "slug": slug, "title": title,
        "description": "Hand-finished piece from our workshop, ready to gift.",
        "price": 60.0, "maker_slug": "test-maker",
        "images": ["http://x/img.jpg"], "in_stock": 4,
        "category": category, "technique": "CNC",
        "status": "published", "deleted_at": None,
        "created_at": "2026-06-11T00:00:00+00:00",
        **extra,
    }


async def test_google_feed_emits_category_aware_attributes():
    from core import db
    from server import app

    tag = uuid.uuid4().hex[:6]
    docs = [
        _doc(f"it366-box-{tag}", "Walnut Dragon Trinket Box", "Home Decor"),
        _doc(f"it366-pendant-{tag}", "Hand-stamped Silver Pendant", "Jewelry",
             gpc_path="Apparel & Accessories > Jewelry > Necklaces"),
    ]
    await db.products.insert_many(docs)
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://t") as c:
            xml = (await c.get("/api/google-merchant/feed.xml")).text
            # Each slug appears twice per item (g:id + g:link) — grab the
            # whole <item> segment instead of splitting on the slug.
            box = next(s for s in xml.split("<item>") if f"it366-box-{tag}" in s)
            assert "<g:material>Wood</g:material>" in box
            assert "<g:color>Brown</g:color>" in box
            assert "<g:gender>" not in box
            assert "<g:age_group>" not in box

            pendant = next(s for s in xml.split("<item>") if f"it366-pendant-{tag}" in s)
            assert "<g:gender>unisex</g:gender>" in pendant
            assert "<g:age_group>adult</g:age_group>" in pendant
            assert "<g:color>" in pendant
            assert "<g:size>" not in pendant
    finally:
        await db.products.delete_many({"slug": {"$regex": f"^it366-.*-{tag}$"}})
