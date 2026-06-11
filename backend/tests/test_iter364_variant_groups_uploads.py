"""iter364 — Variation groups + customer photo uploads.

Covers:
  • Product persists/serves `variant_groups` + combo variants carrying
    `option_ids`, `sku`, and per-combo price override.
  • /cart/quote prices a combo as base + summed option deltas, and
    honours the per-combination absolute override when set.
  • /personalization/files rejects disallowed extensions.
  • CartItem accepts `personalization_upload_ids` (≤10).
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


def _grouped_product(slug: str) -> dict:
    """Listing: Color (Tan +0 / Brown +5) × Engraving (Front +0 / Both +10)."""
    g_color = {"id": "g-color", "name": "Color", "options": [
        {"id": "o-tan", "label": "Tan", "price_delta": 0.0, "image": None},
        {"id": "o-brown", "label": "Brown", "price_delta": 5.0, "image": None},
    ]}
    g_engr = {"id": "g-engr", "name": "Engraving", "options": [
        {"id": "o-front", "label": "Front only", "price_delta": 0.0, "image": None},
        {"id": "o-both", "label": "Both sides", "price_delta": 10.0, "image": None},
    ]}
    combos = []
    for c in g_color["options"]:
        for e in g_engr["options"]:
            combos.append({
                "id": f"v-{c['id']}-{e['id']}",
                "label": f"{c['label']} / {e['label']}",
                "price": None,
                "price_delta": c["price_delta"] + e["price_delta"],
                "in_stock": 3,
                "sku": f"SKU-{c['label'][:2]}-{e['label'][:2]}".upper(),
                "option_ids": [c["id"], e["id"]],
            })
    # Edge case: per-combo absolute override on Brown/Both (would be 55).
    combos[-1]["price"] = 49.0
    return {
        "id": str(uuid.uuid4()), "slug": slug, "title": "Grouped Variations Test",
        "price": 40.0, "maker_slug": "test-maker", "images": ["http://x/i.jpg"],
        "status": "published", "deleted_at": None,
        "variant_groups": [g_color, g_engr], "variants": combos,
        "created_at": "2026-06-11T00:00:00+00:00",
    }


async def test_product_serves_variant_groups_and_combo_pricing():
    from core import db
    from server import app

    slug = f"iter364-{uuid.uuid4().hex[:8]}"
    await db.products.insert_one(_grouped_product(slug))
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://t") as c:
            r = await c.get(f"/api/products/{slug}")
            assert r.status_code == 200
            body = r.json()
            assert len(body["variant_groups"]) == 2
            assert body["variant_groups"][0]["name"] == "Color"
            assert len(body["variants"]) == 4
            tan_both = next(v for v in body["variants"] if v["label"] == "Tan / Both sides")
            assert tan_both["option_ids"] == ["o-tan", "o-both"]
            assert tan_both["price_delta"] == 10.0
            assert tan_both["sku"] == "SKU-TA-BO"

            # Quote: Tan/Both = base 40 + 10 = 50
            r = await c.post("/api/cart/quote", json={
                "items": [{"product_id": slug, "quantity": 1, "variant_id": tan_both["id"]}],
                "origin_url": "http://t",
            })
            assert r.status_code == 200
            assert r.json()["subtotal"] == 50.0

            # Quote: Brown/Both has absolute override 49 (not 40+15=55)
            brown_both = next(v for v in body["variants"] if v["label"] == "Brown / Both sides")
            r = await c.post("/api/cart/quote", json={
                "items": [{"product_id": slug, "quantity": 2, "variant_id": brown_both["id"]}],
                "origin_url": "http://t",
            })
            assert r.status_code == 200
            assert r.json()["subtotal"] == 98.0

            # No variant selected on a variant-ful product → 400
            r = await c.post("/api/cart/quote", json={
                "items": [{"product_id": slug, "quantity": 1}],
                "origin_url": "http://t",
            })
            assert r.status_code == 400
    finally:
        await db.products.delete_one({"slug": slug})


async def test_upload_rejects_bad_extension():
    from server import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://t") as c:
        r = await c.post(
            "/api/personalization/files",
            files={"file": ("malware.exe", b"MZ......", "application/octet-stream")},
        )
        assert r.status_code == 400
        assert "JPG" in r.json()["detail"]


async def test_cart_item_accepts_upload_ids():
    from models import CartItem

    ids = [str(uuid.uuid4()) for _ in range(3)]
    ci = CartItem(product_id="p1", quantity=1, personalization_upload_ids=ids)
    assert ci.personalization_upload_ids == ids
    # >10 ids must fail validation
    with pytest.raises(Exception):
        CartItem(product_id="p1", personalization_upload_ids=[str(uuid.uuid4()) for _ in range(11)])
