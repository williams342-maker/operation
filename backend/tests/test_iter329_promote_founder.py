"""iter329 — Regression test for the ApprovedMakersTab shadowing fix.

Backend contract for POST /api/admin/founders/promote must remain:
  - given a valid admin JWT + an existing standard-tier maker
  - POSTing {slug, is_beta_tester:false} returns 200 with body containing:
      tier == 'founder', founder_status == 'inaugural' (or 'regular'),
      a monotonic founder_number, founder_started_at, founder_grace_until
      (~14d out), and founder_expires_at == None (inaugural = lifetime).
  - The maker doc in DB is updated to tier='founder'.
"""
import os
import uuid
import random
import string

import pytest
import requests
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("/app/backend/.env")
# Frontend .env carries the public URL; fall back to reading it directly.
if not os.environ.get("REACT_APP_BACKEND_URL"):
    load_dotenv("/app/frontend/.env")

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE}/api"


def _admin_jwt() -> str:
    """Mint an admin JWT via the magic-link helper and exchange it."""
    from maker_auth import issue_admin_magic_token  # noqa: E402
    magic = issue_admin_magic_token(os.environ["OPS_EMAIL"])
    r = requests.post(f"{API}/admin/auth/verify", json={"token": magic}, timeout=15)
    r.raise_for_status()
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_token():
    return _admin_jwt()


@pytest.fixture(scope="module")
def mongo():
    client = MongoClient(os.environ["MONGO_URL"])
    return client[os.environ["DB_NAME"]]


@pytest.fixture()
def seed_maker(mongo):
    """Insert a standard-tier maker; guarantee cleanup even on failure."""
    rand = "".join(random.choices(string.ascii_lowercase + string.digits, k=6))
    slug = f"ux-promote-fix-{rand}"
    email = f"test-{slug}@example.com"
    doc = {
        "id": str(uuid.uuid4()),
        "slug": slug,
        "name": f"UX Promote Test {rand}",
        "shop_name": f"UX Promote Test {rand} Studio",
        "email": email,
        "tier": "standard",
        "status": "approved",
        "is_beta_tester": False,
        "approved_at": "2026-01-01T00:00:00+00:00",
        "location": "Testville, TX",
    }
    mongo.makers.insert_one(doc)
    yield {"slug": slug, "email": email, "name": doc["name"]}
    # ---- cleanup ----
    mongo.makers.delete_many({"slug": slug})
    mongo.activity_events.delete_many({"id": {"$regex": f"^founder-{slug}-"}})
    mongo.mail_log.delete_many({"to": email})  # if such collection exists
    mongo.email_log.delete_many({"to": email})


def test_promote_success_returns_expected_fields(admin_token, seed_maker, mongo):
    payload = {"slug": seed_maker["slug"], "is_beta_tester": False}
    r = requests.post(
        f"{API}/admin/founders/promote",
        json=payload,
        headers={"Authorization": f"Bearer {admin_token}"},
        timeout=30,
    )
    assert r.status_code == 200, r.text
    body = r.json()

    # Response contract
    assert body.get("ok") is True
    assert body["tier"] == "founder"
    assert body["founder_status"] in ("inaugural", "regular")
    assert isinstance(body["founder_number"], int)
    assert body["founder_number"] >= 1
    assert body["founder_started_at"]
    assert body["founder_grace_until"]
    # Inaugural = lifetime (no expiry); regular = 365d expiry.
    if body["founder_status"] == "inaugural":
        assert body["founder_expires_at"] is None
    # is_beta_tester echoed back
    assert body["is_beta_tester"] is False

    # DB reflects promotion (maker tier == 'founder')
    doc = mongo.makers.find_one({"slug": seed_maker["slug"]})
    assert doc is not None
    assert doc["tier"] == "founder"
    assert doc["founder_number"] == body["founder_number"]


def test_promote_missing_maker_returns_404(admin_token):
    r = requests.post(
        f"{API}/admin/founders/promote",
        json={"slug": f"does-not-exist-{uuid.uuid4().hex[:8]}", "is_beta_tester": False},
        headers={"Authorization": f"Bearer {admin_token}"},
        timeout=15,
    )
    assert r.status_code == 404


def test_promote_requires_admin_auth():
    r = requests.post(
        f"{API}/admin/founders/promote",
        json={"slug": "any", "is_beta_tester": False},
        timeout=15,
    )
    assert r.status_code in (401, 403)


def test_promote_is_idempotent(admin_token, seed_maker, mongo):
    """Re-promoting the same maker should reuse the existing founder_number."""
    headers = {"Authorization": f"Bearer {admin_token}"}
    payload = {"slug": seed_maker["slug"], "is_beta_tester": False}

    r1 = requests.post(f"{API}/admin/founders/promote", json=payload, headers=headers, timeout=30)
    assert r1.status_code == 200
    n1 = r1.json()["founder_number"]

    r2 = requests.post(f"{API}/admin/founders/promote", json=payload, headers=headers, timeout=30)
    assert r2.status_code == 200
    n2 = r2.json()["founder_number"]

    assert n1 == n2, "founder_number must be stable across re-promotions"
