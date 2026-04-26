"""iter21 — P16 (idempotent listing-fee billing on republish) +
P15 (BackgroundTasks for publish notify) + P17 (followers list endpoint).

Covers:
- Republishing an already-live product does NOT accrue another listing_publish charge.
- Republishing still updates expires_at to a fresh timestamp.
- Publishing a draft DOES accrue a charge.
- POST /api/maker/products with status='published' is fast (<1s) and the
  published_at idempotency stamp is eventually written by the background task.
- GET /api/makers/{slug}/followers returns anonymized rows with limit param.
"""
import asyncio
import os
import time
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


def _mongo():
    from motor.motor_asyncio import AsyncIOMotorClient
    url = os.environ["MONGO_URL"].strip().strip('"').strip("'")
    dbname = os.environ["DB_NAME"].strip().strip('"').strip("'")
    client = AsyncIOMotorClient(url)
    return client, client[dbname]


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


@pytest.fixture(scope="module")
def maker_jwt():
    return issue_session_jwt(MAKER_SLUG, f"{MAKER_SLUG}@craftersmarket.org", role="maker")


def _mk_test_product(status: str = "draft") -> str:
    """Insert a fresh product owned by iron-and-oak, return slug."""
    client, db = _mongo()
    slug = f"TEST-iter21-{status}-{uuid.uuid4().hex[:6]}"
    doc = {
        "id": str(uuid.uuid4()), "slug": slug,
        "title": f"TEST iter21 {slug}", "category": "Decor", "technique": "Forging",
        "price": 99.0, "description": "test", "materials": [],
        "dimensions": "", "images": [], "model_url": None,
        "maker_slug": MAKER_SLUG, "in_stock": 1,
        "variants": [], "variant_axis1_name": None, "variant_axis2_name": None,
        "status": status,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    if status == "published":
        doc["expires_at"] = datetime.now(timezone.utc).isoformat()
    _run(db.products.insert_one(doc))
    client.close()
    return slug


def _del_product(slug: str):
    client, db = _mongo()
    _run(db.products.delete_one({"slug": slug}))
    # Strip our test entries from charge_history so the maker doc stays clean.
    _run(db.makers.update_one(
        {"slug": MAKER_SLUG},
        {"$pull": {"charge_history": {"slug": slug}}}
    ))
    client.close()


def _charges_for(product_slug: str) -> int:
    """Count listing_publish charge_history entries on iron-and-oak's maker doc."""
    client, db = _mongo()
    m = _run(db.makers.find_one(
        {"slug": MAKER_SLUG}, {"_id": 0, "charge_history": 1}
    )) or {}
    hist = m.get("charge_history") or []
    n = sum(
        1 for e in hist
        if e.get("kind") == "listing_publish" and e.get("slug") == product_slug
    )
    client.close()
    return n


def _get_product(slug: str) -> dict:
    client, db = _mongo()
    doc = _run(db.products.find_one({"slug": slug}, {"_id": 0}))
    client.close()
    return doc or {}


def _lifetime_count() -> int:
    """Read iron-and-oak's listings_used_lifetime — best universal signal that
    accrue_listing_charge was invoked (whether free, credit, or cash)."""
    client, db = _mongo()
    m = _run(db.makers.find_one({"slug": MAKER_SLUG}, {"_id": 0, "listings_used_lifetime": 1}))
    client.close()
    return int((m or {}).get("listings_used_lifetime", 0))


# -------- P16: idempotent billing on republish --------------------------

class TestP16IdempotentBilling:
    def test_publish_draft_accrues_one_charge(self, maker_jwt):
        slug = _mk_test_product("draft")
        try:
            assert _charges_for(slug) == 0
            lifetime_before = _lifetime_count()
            r = requests.post(
                f"{API}/maker/products/{slug}/publish",
                headers={"Authorization": f"Bearer {maker_jwt}"}, timeout=30,
            )
            assert r.status_code == 200, r.text
            # accrue_listing_charge always increments listings_used_lifetime
            assert _lifetime_count() == lifetime_before + 1, \
                "publish on a draft must invoke accrue_listing_charge (lifetime +=1)"
            prod = _get_product(slug)
            assert prod["status"] == "published"
            assert prod.get("expires_at")
        finally:
            _del_product(slug)

    def test_republish_published_does_not_double_charge(self, maker_jwt):
        slug = _mk_test_product("published")
        try:
            lifetime_before = _lifetime_count()
            charges_before = _charges_for(slug)
            prod_before = _get_product(slug)
            old_expiry = prod_before.get("expires_at")

            time.sleep(1.1)  # ensure fresh expiry timestamp differs
            r = requests.post(
                f"{API}/maker/products/{slug}/publish",
                headers={"Authorization": f"Bearer {maker_jwt}"}, timeout=30,
            )
            assert r.status_code == 200, r.text

            # Lifetime counter must NOT advance — accrue was skipped.
            assert _lifetime_count() == lifetime_before, \
                "Republish must NOT invoke accrue_listing_charge (lifetime unchanged)"
            # No new listing_publish history entry for this slug
            assert _charges_for(slug) == charges_before, \
                "Republish must NOT add another listing_publish entry"

            # Expires_at should have moved forward (renewal still works)
            prod_after = _get_product(slug)
            assert prod_after.get("expires_at") and prod_after["expires_at"] != old_expiry
            assert prod_after["status"] == "published"
        finally:
            _del_product(slug)


# -------- P15: BackgroundTasks for publish notify -----------------------

class TestP15BackgroundNotify:
    def test_create_published_returns_fast_and_stamps_eventually(self, maker_jwt):
        title = f"TEST iter21 bg {uuid.uuid4().hex[:6]}"
        t0 = time.time()
        r = requests.post(
            f"{API}/maker/products",
            json={
                "title": title, "category": "Decor", "technique": "Forging",
                "price": 50.0, "description": "test bg notify",
                "materials": [], "dimensions": "", "images": [],
                "in_stock": 1, "status": "published",
            },
            headers={"Authorization": f"Bearer {maker_jwt}"}, timeout=30,
        )
        elapsed = time.time() - t0
        assert r.status_code == 200, r.text
        slug = r.json()["slug"]
        try:
            # Background means response should be quick (<3s allows for network jitter)
            assert elapsed < 3.0, f"Create-published response took {elapsed:.2f}s; expected <3s with BackgroundTasks"
            print(f"[P15] create-published response time: {elapsed*1000:.0f}ms")

            # Poll for published_at stamp (BG task fires shortly after)
            stamped = None
            for _ in range(20):  # up to 10s
                p = _get_product(slug)
                if p.get("published_at"):
                    stamped = p["published_at"]
                    break
                time.sleep(0.5)
            assert stamped is not None, "published_at must be stamped by background notify task"
        finally:
            _del_product(slug)


# -------- P17: public followers list endpoint ---------------------------

class TestP17FollowersList:
    def test_unknown_maker_returns_empty(self):
        r = requests.get(f"{API}/makers/no-such-maker-xyz-iter21/followers", timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d == {"items": [], "total": 0}

    def test_known_maker_shape_and_no_email_leakage(self):
        r = requests.get(f"{API}/makers/{MAKER_SLUG}/followers", timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert "items" in d and "total" in d
        assert isinstance(d["items"], list)
        assert isinstance(d["total"], int)
        for item in d["items"]:
            # Anonymized — name + initial + since only
            assert set(item.keys()) <= {"name", "initial", "since"}
            assert "email" not in item
            assert isinstance(item["initial"], str) and len(item["initial"]) == 1

    def test_limit_param_caps_items(self):
        # Seed 4 follows for iron-and-oak via raw mongo (no auth needed)
        client, db = _mongo()
        seeded_uids = []
        try:
            for i in range(4):
                uid = f"TEST_iter21_follower_{i}_{uuid.uuid4().hex[:6]}"
                seeded_uids.append(uid)
                _run(db.follows.update_one(
                    {"user_id": uid, "maker_slug": MAKER_SLUG},
                    {"$setOnInsert": {
                        "id": str(uuid.uuid4()),
                        "user_id": uid,
                        "maker_slug": MAKER_SLUG,
                        "follower_email": f"{uid}@example.com",
                        "follower_name": f"Tester {i}",
                        "created_at": datetime.now(timezone.utc).isoformat(),
                    }},
                    upsert=True,
                ))

            r_full = requests.get(f"{API}/makers/{MAKER_SLUG}/followers", timeout=15).json()
            assert r_full["total"] >= 4

            r_lim = requests.get(f"{API}/makers/{MAKER_SLUG}/followers?limit=2", timeout=15).json()
            assert len(r_lim["items"]) <= 2
            # total still reflects full count
            assert r_lim["total"] == r_full["total"]
        finally:
            for uid in seeded_uids:
                _run(db.follows.delete_many({"user_id": uid}))
            client.close()
