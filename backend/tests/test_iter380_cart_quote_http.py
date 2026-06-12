"""iter380 — HTTP integration test for /api/cart/quote with custom options.

Inserts a test product with one tracked group (Color) and one customization-only
group (Font, Script +$10), then hits the live cart/quote endpoint to verify:
  - omitting custom_option_ids → 400 with "Please choose Font..."
  - including custom_option_id → 200 with line price = base + delta
  - legacy all-tracked group → still requires variant_id
"""
import os
import sys
import uuid
import asyncio

import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
load_dotenv("/app/backend/.env")
sys.path.insert(0, "/app/backend")

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
QUOTE_URL = f"{BASE_URL}/api/cart/quote"


def _mk_product(**over):
    base = {
        "id": str(uuid.uuid4()),
        "slug": f"test-iter380-{uuid.uuid4().hex[:8]}",
        "title": "TEST iter380 Sign",
        "price": 100.0,
        "maker_slug": "iron-and-oak",
        "status": "published",
        "in_stock": 5,
        "variants": [],
        "variant_groups": [],
        "images": [],
    }
    base.update(over)
    return base


@pytest.fixture
def insert_product():
    from pymongo import MongoClient
    client = MongoClient(os.environ["MONGO_URL"])
    db = client[os.environ.get("DB_NAME", "test_database")]
    inserted = []

    def _insert(prod):
        db.products.insert_one(dict(prod))
        inserted.append(prod["id"])
        return prod

    yield _insert

    for pid in inserted:
        db.products.delete_one({"id": pid})
    client.close()


def test_quote_missing_custom_pick_returns_400(insert_product):
    prod = _mk_product(variant_groups=[
        {"id": "g2", "name": "Font", "tracks_inventory": False,
         "options": [
             {"id": "f1", "label": "Script", "price_delta": 10},
             {"id": "f2", "label": "Block", "price_delta": 0},
         ]},
    ])
    insert_product(prod)

    resp = requests.post(QUOTE_URL, json={
        "items": [{"product_id": prod["id"], "quantity": 1}],
        "origin_url": BASE_URL,
    }, timeout=20)
    assert resp.status_code == 400, f"Expected 400, got {resp.status_code}: {resp.text}"
    body = resp.json()
    msg = body.get("detail") or body.get("message") or ""
    assert "Font" in msg, f"Expected Font in error msg, got: {msg}"


def test_quote_with_custom_pick_prices_correctly(insert_product):
    prod = _mk_product(variant_groups=[
        {"id": "g2", "name": "Font", "tracks_inventory": False,
         "options": [
             {"id": "f1", "label": "Script", "price_delta": 10},
             {"id": "f2", "label": "Block", "price_delta": 0},
         ]},
    ])
    insert_product(prod)

    resp = requests.post(QUOTE_URL, json={
        "items": [{
            "product_id": prod["id"], "quantity": 1,
            "custom_option_ids": ["f1"],
        }],
        "origin_url": BASE_URL,
    }, timeout=20)
    assert resp.status_code == 200, f"got {resp.status_code}: {resp.text}"
    data = resp.json()
    # Inspect quote response for line price = 110
    subtotal = data.get("subtotal") or data.get("subtotal_cents") or data.get("total")
    # Just check there's at least one item and the price reflects +10
    line_items = data.get("items") or data.get("lines") or []
    found = False
    for li in line_items:
        price = li.get("unit_price") or li.get("price") or 0
        if abs(price - 110.0) < 0.01:
            found = True
            break
    # Fallback: check subtotal contains 110
    assert found or (subtotal and abs(float(subtotal) - 110.0) < 0.5), (
        f"Expected line price 110, body: {data}"
    )


def test_quote_legacy_all_tracked_requires_variant_id(insert_product):
    prod = _mk_product(
        variant_groups=[
            {"id": "g1", "name": "Color",
             "options": [{"id": "c1", "label": "Tan", "price_delta": 0}]},
        ],
        variants=[{"id": "v1", "label": "Tan", "price": None,
                   "price_delta": 0, "in_stock": 3, "option_ids": ["c1"]}],
    )
    insert_product(prod)

    # Missing variant_id should fail
    resp = requests.post(QUOTE_URL, json={
        "items": [{"product_id": prod["id"], "quantity": 1}],
        "origin_url": BASE_URL,
    }, timeout=20)
    assert resp.status_code == 400, f"Expected 400, got {resp.status_code}: {resp.text}"

    # With variant_id should succeed
    resp2 = requests.post(QUOTE_URL, json={
        "items": [{"product_id": prod["id"], "quantity": 1, "variant_id": "v1"}],
        "origin_url": BASE_URL,
    }, timeout=20)
    assert resp2.status_code == 200, f"got {resp2.status_code}: {resp2.text}"
