"""iter15 — Maker self-serve listing creation, soft-delete, and restore."""
import os
import sys
import uuid

import pytest
import requests

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")
from maker_auth import (  # noqa: E402
    issue_admin_magic_token, issue_buyer_magic_token, issue_magic_token,
)

BASE = os.environ.get(
    "REACT_APP_BACKEND_URL", "https://active-project-4.preview.emergentagent.com"
).rstrip("/")
API = f"{BASE}/api"


@pytest.fixture(scope="module")
def maker_jwt():
    tok = issue_magic_token("iron-and-oak@craftersmarket.org")
    r = requests.post(f"{API}/maker/auth/verify", json={"token": tok}, timeout=15)
    assert r.status_code == 200
    return r.json()["token"]


@pytest.fixture(scope="module")
def other_maker_jwt():
    tok = issue_magic_token("metalart-pro@craftersmarket.org")
    r = requests.post(f"{API}/maker/auth/verify", json={"token": tok}, timeout=15)
    assert r.status_code == 200
    return r.json()["token"]


def H(jwt):
    return {"Authorization": f"Bearer {jwt}", "Content-Type": "application/json"}


def _payload(title=None, **overrides):
    base = {
        "title": title or f"Iter15 Test {uuid.uuid4().hex[:6]}",
        "category": "Custom Signs",
        "technique": "PLASMA",
        "price": 89.0,
        "description": "End-to-end iter15 test listing.",
        "materials": ["Steel"],
        "in_stock": 5,
    }
    base.update(overrides)
    return base


def _cleanup(slug, jwt):
    """Hard-delete via direct mongo (DELETE endpoint only soft-deletes)."""
    import asyncio
    from motor.motor_asyncio import AsyncIOMotorClient
    async def _go():
        c = AsyncIOMotorClient(os.environ["MONGO_URL"])
        try:
            await c[os.environ["DB_NAME"]].products.delete_one({"slug": slug})
        finally:
            c.close()
    asyncio.run(_go())


# ============================================================================
# 1. Authentication & validation
# ============================================================================
class TestAuth:

    def test_create_requires_auth(self):
        r = requests.post(f"{API}/maker/products", json=_payload(), timeout=15)
        assert r.status_code in (401, 403)

    def test_delete_requires_auth(self):
        r = requests.delete(f"{API}/maker/products/x", timeout=15)
        assert r.status_code in (401, 403)

    def test_buyer_jwt_rejected(self):
        email = f"TEST_iter15_{uuid.uuid4().hex[:6]}@example.com"
        bjwt = requests.post(
            f"{API}/community/auth/magic/verify",
            json={"token": issue_buyer_magic_token(email), "accept_eua": True, "eua_version": "2026-04"},
            timeout=10,
        ).json()["token"]
        r = requests.post(f"{API}/maker/products",
                          headers=H(bjwt), json=_payload(), timeout=15)
        assert r.status_code in (401, 403)

    def test_cannot_delete_other_makers_listing(self, other_maker_jwt):
        # Find any product owned by iron-and-oak
        r = requests.get(f"{API}/products?maker=iron-and-oak", timeout=15)
        slug = r.json()[0]["slug"]
        r = requests.delete(f"{API}/maker/products/{slug}",
                            headers=H(other_maker_jwt), timeout=15)
        assert r.status_code == 403
        assert "your own" in r.json().get("detail", "").lower()

    def test_validation(self, maker_jwt):
        # Negative price
        r = requests.post(f"{API}/maker/products",
                          headers=H(maker_jwt),
                          json=_payload(price=-5), timeout=15)
        assert r.status_code == 400
        assert "Price" in r.json()["detail"]

        # Negative stock
        r = requests.post(f"{API}/maker/products",
                          headers=H(maker_jwt),
                          json=_payload(in_stock=-1), timeout=15)
        assert r.status_code == 400

        # Too many images
        r = requests.post(f"{API}/maker/products",
                          headers=H(maker_jwt),
                          json=_payload(images=["a"] * 6), timeout=15)
        assert r.status_code == 400
        assert "5 images" in r.json()["detail"]

        # Single image too large (>8MB after R2 migration)
        big = "x" * 9_000_000
        r = requests.post(f"{API}/maker/products",
                          headers=H(maker_jwt),
                          json=_payload(images=[big]), timeout=30)
        assert r.status_code == 400
        assert "too large" in r.json()["detail"]


# ============================================================================
# 2. Create flow
# ============================================================================
class TestCreate:

    def test_creates_with_auto_slug(self, maker_jwt):
        title = f"Iter15 Auto Slug {uuid.uuid4().hex[:4]}"
        r = requests.post(f"{API}/maker/products",
                          headers=H(maker_jwt),
                          json=_payload(title=title), timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["title"] == title
        # Auto-slugified from title
        assert body["slug"].startswith("iter15-auto-slug-")
        assert body["maker_slug"] == "iron-and-oak"
        assert body["price"] == 89.0
        assert body["in_stock"] == 5
        assert "id" in body
        # listings_count incremented
        me = requests.get(f"{API}/maker/me", headers=H(maker_jwt), timeout=10).json()
        assert me["listings_count"] >= 1
        _cleanup(body["slug"], maker_jwt)

    def test_slug_collision_appends_suffix(self, maker_jwt):
        title = f"Iter15 Collide {uuid.uuid4().hex[:4]}"
        a = requests.post(f"{API}/maker/products",
                          headers=H(maker_jwt),
                          json=_payload(title=title), timeout=15).json()
        b = requests.post(f"{API}/maker/products",
                          headers=H(maker_jwt),
                          json=_payload(title=title), timeout=15).json()
        assert a["slug"] != b["slug"]
        assert b["slug"].endswith("-2")
        _cleanup(a["slug"], maker_jwt)
        _cleanup(b["slug"], maker_jwt)

    def test_appears_in_public_catalog(self, maker_jwt):
        body = requests.post(f"{API}/maker/products",
                             headers=H(maker_jwt),
                             json=_payload(), timeout=15).json()
        slug = body["slug"]
        # Public catalog
        r = requests.get(f"{API}/products?maker=iron-and-oak", timeout=15)
        slugs = [p["slug"] for p in r.json()]
        assert slug in slugs
        # Direct fetch
        r = requests.get(f"{API}/products/{slug}", timeout=15)
        assert r.status_code == 200
        _cleanup(slug, maker_jwt)


# ============================================================================
# 3. Soft-delete + restore
# ============================================================================
class TestDeleteRestore:

    def test_delete_hides_from_public_but_listing_persists(self, maker_jwt):
        body = requests.post(f"{API}/maker/products",
                             headers=H(maker_jwt),
                             json=_payload(), timeout=15).json()
        slug = body["slug"]
        # Pre-delete: visible in public catalog
        r = requests.get(f"{API}/products?maker=iron-and-oak", timeout=15)
        assert slug in [p["slug"] for p in r.json()]

        # Soft-delete
        r = requests.delete(f"{API}/maker/products/{slug}",
                            headers=H(maker_jwt), timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert body["deleted"] is True
        assert "deleted_at" in body

        # Public catalog must NOT contain it
        r = requests.get(f"{API}/products?maker=iron-and-oak", timeout=15)
        assert slug not in [p["slug"] for p in r.json()]
        # Direct fetch returns 404
        r = requests.get(f"{API}/products/{slug}", timeout=15)
        assert r.status_code == 404
        # But maker portal still shows it
        r = requests.get(f"{API}/maker/products",
                         headers=H(maker_jwt), timeout=15)
        match = next((p for p in r.json() if p["slug"] == slug), None)
        assert match is not None
        assert match.get("deleted_at")
        _cleanup(slug, maker_jwt)

    def test_delete_is_idempotent(self, maker_jwt):
        body = requests.post(f"{API}/maker/products",
                             headers=H(maker_jwt),
                             json=_payload(), timeout=15).json()
        slug = body["slug"]
        r1 = requests.delete(f"{API}/maker/products/{slug}",
                             headers=H(maker_jwt), timeout=15).json()
        assert r1["deleted"] is True
        r2 = requests.delete(f"{API}/maker/products/{slug}",
                             headers=H(maker_jwt), timeout=15).json()
        assert r2.get("already_deleted") is True
        _cleanup(slug, maker_jwt)

    def test_restore_re_publishes(self, maker_jwt):
        body = requests.post(f"{API}/maker/products",
                             headers=H(maker_jwt),
                             json=_payload(), timeout=15).json()
        slug = body["slug"]
        requests.delete(f"{API}/maker/products/{slug}",
                        headers=H(maker_jwt), timeout=15)
        r = requests.post(f"{API}/maker/products/{slug}/restore",
                          headers=H(maker_jwt), timeout=15)
        assert r.status_code == 200
        assert r.json()["slug"] == slug
        # Public catalog shows it again
        r = requests.get(f"{API}/products?maker=iron-and-oak", timeout=15)
        assert slug in [p["slug"] for p in r.json()]
        _cleanup(slug, maker_jwt)

    def test_checkout_blocks_deleted_listings(self, maker_jwt):
        """If a listing is deleted between add-to-cart and pay, checkout returns 410."""
        body = requests.post(f"{API}/maker/products",
                             headers=H(maker_jwt),
                             json=_payload(), timeout=15).json()
        slug = body["slug"]
        requests.delete(f"{API}/maker/products/{slug}",
                        headers=H(maker_jwt), timeout=15)
        # Try the cart quote endpoint with the deleted product
        r = requests.post(
            f"{API}/cart/quote",
            json={"items": [{"product_id": slug, "quantity": 1}],
                  "origin_url": BASE},
            timeout=15,
        )
        assert r.status_code == 410, r.text
        assert "no longer available" in r.json().get("detail", "").lower()
        _cleanup(slug, maker_jwt)


# ============================================================================
# Session teardown: nuke any leftover iter15 test products that escaped
# (e.g. from test failures or soft-delete edge cases). Prevents pollution of
# adjacent test files like test_maker_portal.
# ============================================================================
@pytest.fixture(scope="module", autouse=True)
def _module_cleanup():
    yield
    import asyncio
    from motor.motor_asyncio import AsyncIOMotorClient

    async def _go():
        c = AsyncIOMotorClient(os.environ["MONGO_URL"])
        try:
            await c[os.environ["DB_NAME"]].products.delete_many(
                {"slug": {"$regex": "^iter15-test-"}},
            )
        finally:
            c.close()
    asyncio.run(_go())
