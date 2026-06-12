"""iter380 — Variation groups: separate inventory tracking from display options.

Covers:
  • VariantGroup.tracks_inventory defaults True; accepts False.
  • CartItem accepts custom_option_ids (≤20).
  • core.custom_options_summary resolves labels + price deltas from
    customization-only groups and ignores tracked groups.
  • checkout._resolve_cart:
      - 400 when a customization-only group pick is missing
      - folds the custom delta into the unit price + appends labels
      - combined tracked-combo + custom-pick pricing
      - all-groups-customization-only listings need no variant_id
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
from fastapi import HTTPException


# ---------- Model layer ----------

def test_variant_group_tracks_inventory_default():
    from models import VariantGroup
    g = VariantGroup(name="Color")
    assert g.tracks_inventory is True
    g2 = VariantGroup(name="Font", tracks_inventory=False)
    assert g2.tracks_inventory is False


def test_cart_item_accepts_custom_option_ids():
    from models import CartItem
    ci = CartItem(product_id="x", custom_option_ids=["a", "b"])
    assert ci.custom_option_ids == ["a", "b"]
    with pytest.raises(Exception):
        CartItem(product_id="x", custom_option_ids=[f"o{i}" for i in range(21)])


# ---------- core.custom_options_summary ----------

PROD = {
    "variant_groups": [
        {"id": "g1", "name": "Color", "tracks_inventory": True,
         "options": [{"id": "c1", "label": "Tan", "price_delta": 5}]},
        {"id": "g2", "name": "Font", "tracks_inventory": False,
         "options": [{"id": "f1", "label": "Script", "price_delta": 10},
                     {"id": "f2", "label": "Block", "price_delta": 0}]},
        {"id": "g3", "name": "Finish", "tracks_inventory": False,
         "options": [{"id": "x1", "label": "Matte", "price_delta": 2.5}]},
    ],
}


def test_custom_options_summary_resolves_labels_and_delta():
    from core import custom_options_summary
    label, delta = custom_options_summary(PROD, ["f1", "x1"])
    assert label == "Font: Script · Finish: Matte"
    assert delta == 12.5


def test_custom_options_summary_ignores_tracked_groups():
    from core import custom_options_summary
    # c1 belongs to a TRACKED group — must not be matched.
    label, delta = custom_options_summary(PROD, ["c1"])
    assert label is None and delta == 0.0


def test_custom_options_summary_empty():
    from core import custom_options_summary
    assert custom_options_summary(PROD, []) == (None, 0.0)


# ---------- checkout._resolve_cart ----------

def _mk_product(**over):
    base = {
        "id": str(uuid.uuid4()),
        "slug": f"test-{uuid.uuid4().hex[:8]}",
        "title": "Walnut Sign",
        "price": 100.0,
        "maker_slug": "test-maker",
        "status": "published",
        "in_stock": 5,
        "variants": [],
        "variant_groups": [],
    }
    base.update(over)
    return base


@pytest.mark.asyncio
async def test_resolve_cart_requires_custom_pick():
    from core import db
    from routers.checkout import _resolve_cart
    prod = _mk_product(variant_groups=[
        {"id": "g2", "name": "Font", "tracks_inventory": False,
         "options": [{"id": "f1", "label": "Script", "price_delta": 10}]},
    ])
    await db.products.insert_one(dict(prod))
    try:
        with pytest.raises(HTTPException) as ei:
            await _resolve_cart([{"product_id": prod["id"], "quantity": 1}])
        assert ei.value.status_code == 400
        assert "Font" in ei.value.detail
    finally:
        await db.products.delete_one({"id": prod["id"]})


@pytest.mark.asyncio
async def test_resolve_cart_prices_custom_pick_no_variant_needed():
    from core import db
    from routers.checkout import _resolve_cart
    prod = _mk_product(variant_groups=[
        {"id": "g2", "name": "Font", "tracks_inventory": False,
         "options": [{"id": "f1", "label": "Script", "price_delta": 10},
                     {"id": "f2", "label": "Block", "price_delta": 0}]},
    ])
    await db.products.insert_one(dict(prod))
    try:
        out = await _resolve_cart([{
            "product_id": prod["id"], "quantity": 1,
            "custom_option_ids": ["f1"],
        }])
        p = out[0]["product"]
        assert p["price"] == 110.0
        assert "Font: Script" in p["title"]
        assert p["_custom_options_label"] == "Font: Script"
    finally:
        await db.products.delete_one({"id": prod["id"]})


@pytest.mark.asyncio
async def test_resolve_cart_combined_tracked_combo_plus_custom():
    from core import db
    from routers.checkout import _resolve_cart
    prod = _mk_product(
        variant_groups=[
            {"id": "g1", "name": "Color", "tracks_inventory": True,
             "options": [{"id": "c1", "label": "Tan", "price_delta": 5}]},
            {"id": "g2", "name": "Font", "tracks_inventory": False,
             "options": [{"id": "f1", "label": "Script", "price_delta": 10}]},
        ],
        variants=[{"id": "v1", "label": "Tan", "price": None,
                   "price_delta": 5, "in_stock": 3, "option_ids": ["c1"]}],
    )
    await db.products.insert_one(dict(prod))
    try:
        out = await _resolve_cart([{
            "product_id": prod["id"], "quantity": 2,
            "variant_id": "v1", "custom_option_ids": ["f1"],
        }])
        p = out[0]["product"]
        # 100 base + 5 combo delta + 10 custom delta
        assert p["price"] == 115.0
        assert p["_variant_id"] == "v1"
        assert "Tan" in p["title"] and "Font: Script" in p["title"]
    finally:
        await db.products.delete_one({"id": prod["id"]})


@pytest.mark.asyncio
async def test_resolve_cart_legacy_groups_unaffected():
    """Listings whose groups all track inventory behave exactly as before."""
    from core import db
    from routers.checkout import _resolve_cart
    prod = _mk_product(
        variant_groups=[
            {"id": "g1", "name": "Color",
             "options": [{"id": "c1", "label": "Tan", "price_delta": 0}]},
        ],
        variants=[{"id": "v1", "label": "Tan", "price": None,
                   "price_delta": 0, "in_stock": 3, "option_ids": ["c1"]}],
    )
    await db.products.insert_one(dict(prod))
    try:
        out = await _resolve_cart([{
            "product_id": prod["id"], "quantity": 1, "variant_id": "v1",
        }])
        assert out[0]["product"]["price"] == 100.0
    finally:
        await db.products.delete_one({"id": prod["id"]})
