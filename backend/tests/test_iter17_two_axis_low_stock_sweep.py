"""iter17 — Two-axis variants + per-variant image + low-stock helper + R2 sweep admin endpoint."""
from __future__ import annotations

import asyncio
import os
import sys
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import requests

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")
from maker_auth import issue_admin_magic_token, issue_magic_token  # noqa: E402


def _read_frontend_url() -> str:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                return line.split("=", 1)[1].strip()
    raise RuntimeError("REACT_APP_BACKEND_URL not set")


BASE = (os.environ.get("REACT_APP_BACKEND_URL") or _read_frontend_url()).rstrip("/")
API = f"{BASE}/api"


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def maker_jwt():
    tok = issue_magic_token("iron-and-oak@craftersmarket.org")
    r = requests.post(f"{API}/maker/auth/verify", json={"token": tok}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_jwt():
    tok = issue_admin_magic_token("team@craftersmarket.org")
    r = requests.post(f"{API}/admin/auth/verify", json={"token": tok}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _Hj(jwt):
    return {"Authorization": f"Bearer {jwt}", "Content-Type": "application/json"}


def _H(jwt):
    return {"Authorization": f"Bearer {jwt}"}


def _cleanup_slug(slug: str):
    from motor.motor_asyncio import AsyncIOMotorClient

    async def _go():
        c = AsyncIOMotorClient(os.environ["MONGO_URL"])
        try:
            await c[os.environ["DB_NAME"]].products.delete_one({"slug": slug})
        finally:
            c.close()
    asyncio.run(_go())


# ============================================================================
# 1) Two-axis variants — POST /api/maker/products + GET /api/products/{slug}
# ============================================================================
class TestTwoAxisVariants:
    def test_create_with_two_axis_variants_round_trip(self, maker_jwt):
        title = f"TEST_iter17 TwoAxis {uuid.uuid4().hex[:6]}"
        # Tiny 1x1 PNG data URL (transparent).
        png_data = (
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAA"
            "C0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII="
        )
        payload = {
            "title": title,
            "category": "Wall Art",
            "technique": "PLASMA",
            "price": 100.0,
            "description": "iter17 two-axis test",
            "materials": ["Steel"],
            "in_stock": 5,
            "status": "published",
            "variant_axis1_name": "Size",
            "variant_axis2_name": "Finish",
            "variants": [
                {"label": "12in / Walnut", "price_delta": 0,
                 "in_stock": 5, "axis1": "12in", "axis2": "Walnut",
                 "image": png_data},
                {"label": "12in / Steel", "price_delta": 10,
                 "in_stock": 4, "axis1": "12in", "axis2": "Steel",
                 "image": png_data},
                {"label": "24in / Walnut", "price_delta": 50,
                 "in_stock": 3, "axis1": "24in", "axis2": "Walnut",
                 "image": png_data},
                {"label": "24in / Steel", "price_delta": 60,
                 "in_stock": 2, "axis1": "24in", "axis2": "Steel",
                 "image": png_data},
            ],
        }
        r = requests.post(f"{API}/maker/products",
                          headers=_Hj(maker_jwt), json=payload, timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        slug = body["slug"]
        try:
            assert body["variant_axis1_name"] == "Size"
            assert body["variant_axis2_name"] == "Finish"
            assert len(body["variants"]) == 4
            v0 = body["variants"][0]
            assert v0.get("axis1") == "12in"
            assert v0.get("axis2") == "Walnut"
            assert v0.get("image"), "First variant image missing in create response"

            # Public endpoint round-trip
            r2 = requests.get(f"{API}/products/{slug}", timeout=15)
            assert r2.status_code == 200, r2.text
            pub = r2.json()
            assert pub["variant_axis1_name"] == "Size"
            assert pub["variant_axis2_name"] == "Finish"
            assert len(pub["variants"]) == 4
            assert all(v.get("axis1") and v.get("axis2") for v in pub["variants"])
            assert all(v.get("image") for v in pub["variants"]), \
                "Public endpoint did not return per-variant images"
        finally:
            _cleanup_slug(slug)


# ============================================================================
# 2) _decrement_stock_and_collect_low — product-level (5 → 2 < threshold 3)
# ============================================================================
class TestLowStockHelperProduct:
    def test_product_level_drop_below_threshold(self):
        from routers import checkout as checkout_mod

        slug = "fake-prod"
        prod_doc = {
            "slug": slug,
            "id": "p-1",
            "title": "Fake",
            "maker_slug": "iron-and-oak",
            "in_stock": 5,
            "variants": [],
        }
        # After update_one runs, the "fresh" find_one should return in_stock=2.
        fresh_doc = {**prod_doc, "in_stock": 2}

        find_calls = {"n": 0}

        async def fake_find_one(query, proj=None):
            find_calls["n"] += 1
            # 1st call: lookup pre-update (any of id/slug). 2nd: post-decrement fresh.
            if find_calls["n"] == 1:
                return prod_doc
            return fresh_doc

        async def fake_update_one(query, update):
            res = MagicMock()
            res.modified_count = 1
            return res

        fake_db = MagicMock()
        fake_db.products.find_one = AsyncMock(side_effect=fake_find_one)
        fake_db.products.update_one = AsyncMock(side_effect=fake_update_one)

        with patch.object(checkout_mod, "db", fake_db):
            items = [{"product_id": slug, "quantity": 3}]
            result = asyncio.run(
                checkout_mod._decrement_stock_and_collect_low(
                    items, {"iron-and-oak": []}
                )
            )

        assert "iron-and-oak" in result
        rows = result["iron-and-oak"]
        assert len(rows) == 1, f"Expected 1 low-stock row, got {rows}"
        row = rows[0]
        assert row["slug"] == slug
        assert row["in_stock"] == 2  # 5 - 3 = 2 < threshold 3
        assert row["title"] == "Fake"


# ============================================================================
# 3) _decrement_stock_and_collect_low — variant level (4 → 1 < threshold 3)
# ============================================================================
class TestLowStockHelperVariant:
    def test_variant_drop_below_threshold(self):
        from routers import checkout as checkout_mod

        slug = "fake-prod-v"
        vid = "v-1"
        prod_doc = {
            "slug": slug,
            "id": "p-2",
            "title": "Fake With Variants",
            "maker_slug": "iron-and-oak",
            "in_stock": 100,  # untouched
            "variants": [
                {"id": vid, "label": "12in", "price_delta": 0,
                 "in_stock": 4, "axis1": "12in"},
                {"id": "v-2", "label": "24in", "price_delta": 50,
                 "in_stock": 10},
            ],
        }
        fresh_doc = {
            **prod_doc,
            "variants": [
                {"id": vid, "label": "12in", "price_delta": 0,
                 "in_stock": 1, "axis1": "12in"},
                {"id": "v-2", "label": "24in", "price_delta": 50,
                 "in_stock": 10},
            ],
        }

        n = {"i": 0}

        async def fake_find_one(query, proj=None):
            n["i"] += 1
            return prod_doc if n["i"] == 1 else fresh_doc

        async def fake_update_one(query, update):
            res = MagicMock()
            res.modified_count = 1
            return res

        fake_db = MagicMock()
        fake_db.products.find_one = AsyncMock(side_effect=fake_find_one)
        fake_db.products.update_one = AsyncMock(side_effect=fake_update_one)

        with patch.object(checkout_mod, "db", fake_db):
            items = [{"product_id": slug, "quantity": 3, "variant_id": vid}]
            result = asyncio.run(
                checkout_mod._decrement_stock_and_collect_low(
                    items, {"iron-and-oak": []}
                )
            )

        assert "iron-and-oak" in result
        rows = result["iron-and-oak"]
        assert len(rows) == 1, f"Expected 1 low-stock variant row, got {rows}"
        row = rows[0]
        assert row["slug"] == slug
        assert row["in_stock"] == 1   # 4 - 3 = 1
        assert "12in" in row["title"], f"Variant label missing in title: {row}"


# ============================================================================
# 4) Admin sweep dry-run via REST endpoint
# ============================================================================
class TestAdminR2Sweep:
    def test_dry_run_returns_summary_shape(self, admin_jwt):
        r = requests.post(f"{API}/admin/r2/sweep",
                          headers=_H(admin_jwt), timeout=60)
        assert r.status_code == 200, r.text
        body = r.json()
        for k in ("scanned", "referenced", "orphans", "deleted", "orphan_keys"):
            assert k in body, f"Missing key {k} in sweep response: {body}"
        # Dry-run must not have deleted anything.
        assert body["deleted"] == 0
        assert isinstance(body["orphan_keys"], list)
        assert isinstance(body["scanned"], int)
        assert isinstance(body["referenced"], int)
        assert isinstance(body["orphans"], int)

    def test_sweep_requires_admin(self):
        r = requests.post(f"{API}/admin/r2/sweep", timeout=15)
        assert r.status_code in (401, 403), r.text
