"""iter20 — Follow / unfollow + listing-publish notification fan-out.

Covers:
- follow-status (unauth + buyer JWT)
- POST/DELETE follow (auth, idempotency, frozen user, unknown maker)
- listing_notify.notify_listing_published (sent / not_published / maker_not_found / already_announced)
- create / publish endpoint trigger notify (published_at stamped)
"""
import asyncio
import os
import uuid
from datetime import datetime, timezone

import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
load_dotenv("/app/frontend/.env")
import sys
sys.path.insert(0, "/app/backend")

from maker_auth import issue_session_jwt  # noqa: E402

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"
MAKER_SLUG = "iron-and-oak"


# ---------- shared helpers ---------------------------------------------------

def _buyer_jwt(uid: str, email: str) -> str:
    return issue_session_jwt(uid, email, role="buyer")


@pytest.fixture(scope="module")
def buyer_a():
    uid = f"TEST_buyer_a_{uuid.uuid4().hex[:8]}"
    email = f"TEST_buyer_a_{uid[-8:]}@example.com"
    return {"uid": uid, "email": email, "jwt": _buyer_jwt(uid, email)}


@pytest.fixture(scope="module")
def buyer_b():
    uid = f"TEST_buyer_b_{uuid.uuid4().hex[:8]}"
    email = f"TEST_buyer_b_{uid[-8:]}@example.com"
    return {"uid": uid, "email": email, "jwt": _buyer_jwt(uid, email)}


@pytest.fixture(scope="module")
def buyer_frozen():
    uid = f"TEST_frozen_{uuid.uuid4().hex[:8]}"
    email = f"TEST_frozen_{uid[-8:]}@example.com"
    return {"uid": uid, "email": email, "jwt": _buyer_jwt(uid, email)}


@pytest.fixture(scope="module", autouse=True)
def seed_users(buyer_a, buyer_b, buyer_frozen):
    """Seed community_users docs (active for a/b, frozen for the third)."""
    from motor.motor_asyncio import AsyncIOMotorClient
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ["DB_NAME"]]

    async def _setup():
        for u, status in [
            (buyer_a, "active"),
            (buyer_b, "active"),
            (buyer_frozen, "frozen"),
        ]:
            await db.community_users.update_one(
                {"user_id": u["uid"]},
                {"$set": {
                    "user_id": u["uid"],
                    "email": u["email"],
                    "name": "Test Buyer",
                    "moderation_status": status,
                }},
                upsert=True,
            )

    async def _teardown():
        for u in (buyer_a, buyer_b, buyer_frozen):
            await db.community_users.delete_one({"user_id": u["uid"]})
            await db.follows.delete_many({"user_id": u["uid"]})

    asyncio.get_event_loop().run_until_complete(_setup())
    yield
    asyncio.get_event_loop().run_until_complete(_teardown())
    client.close()


# ---------- follow-status ----------------------------------------------------

class TestFollowStatus:
    def test_unauth_returns_count_only(self):
        r = requests.get(f"{API}/makers/{MAKER_SLUG}/follow-status", timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["is_following"] is False
        assert isinstance(d["follower_count"], int)
        assert d["follower_count"] >= 0

    def test_with_buyer_jwt_reflects_user(self, buyer_a):
        r = requests.get(
            f"{API}/makers/{MAKER_SLUG}/follow-status",
            headers={"Authorization": f"Bearer {buyer_a['jwt']}"},
            timeout=15,
        )
        assert r.status_code == 200
        # Initially not following — confirm field present and bool
        assert r.json()["is_following"] is False


# ---------- POST/DELETE follow -----------------------------------------------

class TestFollowMutations:
    def test_post_without_jwt_is_401(self):
        r = requests.post(f"{API}/makers/{MAKER_SLUG}/follow", timeout=15)
        assert r.status_code == 401

    def test_post_unknown_maker_404(self, buyer_a):
        r = requests.post(
            f"{API}/makers/no-such-maker-xyz/follow",
            headers={"Authorization": f"Bearer {buyer_a['jwt']}"},
            timeout=15,
        )
        assert r.status_code == 404

    def test_frozen_user_403(self, buyer_frozen):
        r = requests.post(
            f"{API}/makers/{MAKER_SLUG}/follow",
            headers={"Authorization": f"Bearer {buyer_frozen['jwt']}"},
            timeout=15,
        )
        assert r.status_code == 403

    def test_follow_increments_then_idempotent(self, buyer_a):
        before = requests.get(f"{API}/makers/{MAKER_SLUG}/follow-status").json()["follower_count"]

        r1 = requests.post(
            f"{API}/makers/{MAKER_SLUG}/follow",
            headers={"Authorization": f"Bearer {buyer_a['jwt']}"},
            timeout=15,
        )
        assert r1.status_code == 200
        d1 = r1.json()
        assert d1["is_following"] is True
        assert d1["follower_count"] == before + 1

        # Idempotent — second call should not increment.
        r2 = requests.post(
            f"{API}/makers/{MAKER_SLUG}/follow",
            headers={"Authorization": f"Bearer {buyer_a['jwt']}"},
            timeout=15,
        )
        assert r2.status_code == 200
        assert r2.json()["follower_count"] == d1["follower_count"]

    def test_delete_decrements(self, buyer_b):
        # First follow
        r1 = requests.post(
            f"{API}/makers/{MAKER_SLUG}/follow",
            headers={"Authorization": f"Bearer {buyer_b['jwt']}"},
            timeout=15,
        )
        assert r1.status_code == 200
        after_follow = r1.json()["follower_count"]

        r2 = requests.delete(
            f"{API}/makers/{MAKER_SLUG}/follow",
            headers={"Authorization": f"Bearer {buyer_b['jwt']}"},
            timeout=15,
        )
        assert r2.status_code == 200
        d2 = r2.json()
        assert d2["is_following"] is False
        assert d2["follower_count"] == after_follow - 1

    def test_status_with_jwt_reflects_following_true(self, buyer_a):
        r = requests.get(
            f"{API}/makers/{MAKER_SLUG}/follow-status",
            headers={"Authorization": f"Bearer {buyer_a['jwt']}"},
            timeout=15,
        )
        assert r.status_code == 200
        # buyer_a still followed from the increment test above.
        assert r.json()["is_following"] is True


# ---------- listing_notify direct calls --------------------------------------

class TestListingNotify:
    """Drive notify_listing_published directly against fresh test products."""

    def _setup_test_product(self, status: str, slug_prefix: str):
        """Create a Product doc directly and return its slug."""
        from motor.motor_asyncio import AsyncIOMotorClient
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]

        slug = f"TEST-iter20-{slug_prefix}-{uuid.uuid4().hex[:6]}"
        doc = {
            "id": str(uuid.uuid4()),
            "slug": slug,
            "title": "Test Listing iter20",
            "category": "Decor",
            "technique": "Forging",
            "price": 99.0,
            "description": "test",
            "materials": [], "dimensions": "", "images": [], "model_url": None,
            "maker_slug": MAKER_SLUG,
            "in_stock": 1,
            "variants": [], "variant_axis1_name": None, "variant_axis2_name": None,
            "status": status,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }

        async def _insert():
            await db.products.insert_one(doc)

        asyncio.get_event_loop().run_until_complete(_insert())
        client.close()
        return slug

    def _cleanup_product(self, slug):
        from motor.motor_asyncio import AsyncIOMotorClient
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]

        async def _del():
            await db.products.delete_one({"slug": slug})

        asyncio.get_event_loop().run_until_complete(_del())
        client.close()

    def test_published_first_call_sends_then_idempotent(self, buyer_a):
        # Ensure buyer_a still follows the maker so follower_count > 0
        slug = self._setup_test_product("published", "pub")
        try:
            from listing_notify import notify_listing_published

            async def _run():
                first = await notify_listing_published(slug)
                second = await notify_listing_published(slug)
                return first, second

            first, second = asyncio.get_event_loop().run_until_complete(_run())
            assert first["sent"] is True
            assert "follower_count" in first and "follower_sent" in first
            assert first["follower_count"] >= 1  # buyer_a is following

            assert second["sent"] is False
            assert second["reason"] == "already_announced"

            # Verify published_at stamped
            from motor.motor_asyncio import AsyncIOMotorClient
            client = AsyncIOMotorClient(os.environ["MONGO_URL"])
            db = client[os.environ["DB_NAME"]]

            async def _fetch():
                return await db.products.find_one({"slug": slug}, {"_id": 0, "published_at": 1})

            doc = asyncio.get_event_loop().run_until_complete(_fetch())
            client.close()
            assert doc and doc.get("published_at")
        finally:
            self._cleanup_product(slug)

    def test_draft_returns_not_published(self):
        slug = self._setup_test_product("draft", "draft")
        try:
            from listing_notify import notify_listing_published

            async def _run():
                return await notify_listing_published(slug)

            r = asyncio.get_event_loop().run_until_complete(_run())
            assert r["sent"] is False
            assert r["reason"] == "not_published"
        finally:
            self._cleanup_product(slug)

    def test_unknown_product(self):
        from listing_notify import notify_listing_published

        async def _run():
            return await notify_listing_published("does-not-exist-xyz-9999")

        r = asyncio.get_event_loop().run_until_complete(_run())
        assert r["sent"] is False
        assert r["reason"] == "product_not_found"

    def test_maker_not_found(self):
        # Insert a product whose maker_slug does not exist.
        from motor.motor_asyncio import AsyncIOMotorClient
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]
        slug = f"TEST-iter20-orphan-{uuid.uuid4().hex[:6]}"
        doc = {
            "id": str(uuid.uuid4()), "slug": slug, "title": "Orphan",
            "category": "Decor", "technique": "Forging",
            "price": 1.0, "description": "x", "materials": [],
            "dimensions": "", "images": [], "model_url": None,
            "maker_slug": "no-such-maker-xyzzy",
            "in_stock": 0, "variants": [], "status": "published",
        }

        async def _insert():
            await db.products.insert_one(doc)

        asyncio.get_event_loop().run_until_complete(_insert())
        client.close()

        try:
            from listing_notify import notify_listing_published

            async def _run():
                return await notify_listing_published(slug)

            r = asyncio.get_event_loop().run_until_complete(_run())
            assert r["sent"] is False
            assert r["reason"] == "maker_not_found"
        finally:
            self._cleanup_product(slug)


# ---------- maker create/publish end-to-end ---------------------------------

class TestMakerCreatePublishHooks:
    @pytest.fixture(scope="class")
    def maker_jwt(self):
        return issue_session_jwt(MAKER_SLUG, f"{MAKER_SLUG}@craftersmarket.org", role="maker")

    def _get_published_at(self, slug):
        from motor.motor_asyncio import AsyncIOMotorClient
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]

        async def _fetch():
            return await db.products.find_one({"slug": slug}, {"_id": 0, "published_at": 1})

        d = asyncio.get_event_loop().run_until_complete(_fetch())
        client.close()
        return d.get("published_at") if d else None

    def _cleanup(self, slug):
        from motor.motor_asyncio import AsyncIOMotorClient
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]

        async def _del():
            await db.products.delete_one({"slug": slug})

        asyncio.get_event_loop().run_until_complete(_del())
        client.close()

    def test_create_published_stamps_published_at(self, maker_jwt):
        title = f"TEST iter20 create {uuid.uuid4().hex[:6]}"
        r = requests.post(
            f"{API}/maker/products",
            json={
                "title": title, "category": "Decor", "technique": "Forging",
                "price": 50.0, "description": "test create-publish",
                "materials": [], "dimensions": "", "images": [],
                "in_stock": 1, "status": "published",
            },
            headers={"Authorization": f"Bearer {maker_jwt}"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        slug = r.json()["slug"]
        try:
            assert self._get_published_at(slug) is not None
        finally:
            self._cleanup(slug)

    def test_publish_draft_stamps_and_idempotent(self, maker_jwt):
        title = f"TEST iter20 publish {uuid.uuid4().hex[:6]}"
        # Create draft first
        r = requests.post(
            f"{API}/maker/products",
            json={
                "title": title, "category": "Decor", "technique": "Forging",
                "price": 50.0, "description": "test publish",
                "materials": [], "dimensions": "", "images": [],
                "in_stock": 1, "status": "draft",
            },
            headers={"Authorization": f"Bearer {maker_jwt}"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        slug = r.json()["slug"]
        try:
            # Draft should NOT have published_at
            assert self._get_published_at(slug) is None

            # Publish
            r2 = requests.post(
                f"{API}/maker/products/{slug}/publish",
                headers={"Authorization": f"Bearer {maker_jwt}"},
                timeout=30,
            )
            assert r2.status_code == 200, r2.text
            stamp1 = self._get_published_at(slug)
            assert stamp1 is not None

            # Publish again — idempotent (same stamp, no re-broadcast).
            r3 = requests.post(
                f"{API}/maker/products/{slug}/publish",
                headers={"Authorization": f"Bearer {maker_jwt}"},
                timeout=30,
            )
            assert r3.status_code == 200
            stamp2 = self._get_published_at(slug)
            assert stamp2 == stamp1, "published_at must not be re-stamped"
        finally:
            self._cleanup(slug)
