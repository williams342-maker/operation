"""iter381 — Most-picked variation options per listing (maker dashboard).

Covers `maker_products_option_stats` aggregation:
  • grouped combos     — variant_id → option_ids → "Group: Label" counts
  • customization-only — custom_option_ids resolved the same way
  • legacy variants    — flat variant label counted under axis1 name
  • weighting by quantity, top-N ordering, empty listings omitted
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

MAKER = f"test-maker-{uuid.uuid4().hex[:8]}"


def _product():
    return {
        "id": str(uuid.uuid4()),
        "slug": f"test-iter381-{uuid.uuid4().hex[:8]}",
        "title": "TEST iter381 Sign",
        "category": "Wall Art",
        "price": 100.0,
        "maker_slug": MAKER,
        "status": "published",
        "variant_axis1_name": "Size",
        "variant_groups": [
            {"id": "g1", "name": "Color", "tracks_inventory": True,
             "options": [{"id": "c1", "label": "Tan", "price_delta": 0},
                         {"id": "c2", "label": "Black", "price_delta": 5}]},
            {"id": "g2", "name": "Font", "tracks_inventory": False,
             "options": [{"id": "f1", "label": "Script", "price_delta": 10},
                         {"id": "f2", "label": "Block", "price_delta": 0}]},
        ],
        "variants": [
            {"id": "v1", "label": "Tan", "in_stock": 3, "option_ids": ["c1"]},
            {"id": "v2", "label": "Black", "in_stock": 2, "option_ids": ["c2"]},
            # legacy flat variant (no option_ids) to exercise axis fallback
            {"id": "v3", "label": "Large", "in_stock": 1, "option_ids": []},
        ],
    }


@pytest.mark.asyncio
async def test_option_stats_aggregation():
    from core import db
    from routers.maker import maker_products_option_stats
    prod = _product()
    tx_ids = []

    def tx(items):
        t = {"id": str(uuid.uuid4()), "session_id": f"cs_test_{uuid.uuid4().hex[:10]}",
             "payment_status": "paid", "items": items}
        tx_ids.append(t["id"])
        return t

    await db.products.insert_one(dict(prod))
    await db.payment_transactions.insert_many([
        # 2 units Tan + Script
        tx([{"product_id": prod["id"], "quantity": 2,
             "variant_id": "v1", "custom_option_ids": ["f1"]}]),
        # 1 unit Black + Block
        tx([{"product_id": prod["id"], "quantity": 1,
             "variant_id": "v2", "custom_option_ids": ["f2"]}]),
        # 1 unit Tan (no custom pick — pre-iter380 order shape)
        tx([{"product_id": prod["id"], "quantity": 1, "variant_id": "v1"}]),
        # legacy flat variant
        tx([{"product_id": prod["id"], "quantity": 1, "variant_id": "v3"}]),
        # unpaid tx must be ignored
        {"id": str(uuid.uuid4()), "session_id": "cs_test_unpaid",
         "payment_status": "initiated",
         "items": [{"product_id": prod["id"], "quantity": 9, "variant_id": "v2"}]},
    ])
    try:
        out = await maker_products_option_stats(slug=MAKER)
        assert prod["slug"] in out
        opts = {o["label"]: o["count"] for o in out[prod["slug"]]["options"]}
        assert opts["Color: Tan"] == 3          # 2 + 1
        assert opts["Color: Black"] == 1
        assert opts["Font: Script"] == 2
        assert opts["Font: Block"] == 1
        assert opts["Size: Large"] == 1         # legacy flat variant via axis1
        # ordered desc — Tan first
        assert out[prod["slug"]]["options"][0]["label"] == "Color: Tan"
    finally:
        await db.products.delete_one({"id": prod["id"]})
        await db.payment_transactions.delete_many(
            {"$or": [{"id": {"$in": tx_ids}}, {"session_id": "cs_test_unpaid"}]})


@pytest.mark.asyncio
async def test_option_stats_empty_for_maker_without_sales():
    from routers.maker import maker_products_option_stats
    out = await maker_products_option_stats(slug=f"no-such-{uuid.uuid4().hex[:6]}")
    assert out == {}
