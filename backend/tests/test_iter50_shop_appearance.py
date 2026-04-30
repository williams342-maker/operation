"""
Iter50 - Maker shop Info & Appearance + Social Media + Account lifecycle (close/reopen/delete)
Tests:
 - PATCH /api/maker/profile persists new fields
 - GET  /api/maker/me returns them
 - POST /api/maker/account/close + reopen
 - POST /api/maker/account/request-deletion (+ dup 400)
 - POST /api/maker/account/cancel-deletion (+ 400 when no pending)
 - GET  /api/makers/{slug} public shop exposes the new fields
"""
import os
import time
import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://active-project-4.preview.emergentagent.com").rstrip("/")
SLUG = "iron-and-oak"


@pytest.fixture(scope="module")
def maker_jwt():
    from maker_auth import issue_session_jwt  # noqa
    return issue_session_jwt(SLUG, f"{SLUG}@craftersmarket.org", role="maker")


@pytest.fixture(scope="module")
def session(maker_jwt):
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json", "Authorization": f"Bearer {maker_jwt}"})
    return s


# --- Info & Appearance --------------------------------------------------------
class TestInfoAppearance:
    def test_patch_new_fields_persists(self, session):
        payload = {
            "shop_title": "Precision CNC Since 2019",
            "order_receipt_banner_url": "https://cdn.craftersmarket.org/banner.jpg",
            "shop_announcement": "Holiday sale — 15% off all live-edge tables.",
            "message_to_buyers": "Thanks for supporting a small shop!",
            "message_to_buyers_digital": "Your download link expires in 30 days.",
            "social_facebook": "https://facebook.com/ironandoak",
            "social_instagram": "https://instagram.com/ironandoak",
            "social_twitter": "https://twitter.com/ironandoak",
            "social_tiktok": "https://tiktok.com/@ironandoak",
            "social_youtube": "https://youtube.com/@ironandoak",
            "social_pinterest": "https://pinterest.com/ironandoak",
            "website_url": "https://ironandoak.example.com",
        }
        r = session.patch(f"{BASE_URL}/api/maker/profile", json=payload)
        assert r.status_code == 200, r.text

        # GET to verify persistence
        g = session.get(f"{BASE_URL}/api/maker/me")
        assert g.status_code == 200, g.text
        data = g.json()
        for k, v in payload.items():
            assert data.get(k) == v, f"Field {k} mismatch: expected {v!r}, got {data.get(k)!r}"

    def test_public_maker_shows_fields(self, session):
        r = requests.get(f"{BASE_URL}/api/makers/{SLUG}")
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("shop_title") == "Precision CNC Since 2019"
        assert "Holiday sale" in (data.get("shop_announcement") or "")
        assert data.get("social_instagram", "").endswith("ironandoak")


# --- Account lifecycle --------------------------------------------------------
class TestAccountLifecycle:
    def test_01_close_shop(self, session):
        r = session.post(f"{BASE_URL}/api/maker/account/close", json={})
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("ok") is True
        # verify
        g = session.get(f"{BASE_URL}/api/maker/me").json()
        assert g.get("shop_closed") is True
        assert g.get("vacation_mode") is True
        assert g.get("shop_closed_at")

    def test_02_public_shows_closed_banner_field(self, session):
        r = requests.get(f"{BASE_URL}/api/makers/{SLUG}")
        assert r.status_code == 200
        assert r.json().get("shop_closed") is True

    def test_03_reopen_shop(self, session):
        r = session.post(f"{BASE_URL}/api/maker/account/reopen", json={})
        assert r.status_code == 200, r.text
        g = session.get(f"{BASE_URL}/api/maker/me").json()
        assert g.get("shop_closed") in (False, None)

    def test_04_request_deletion(self, session):
        # ensure clean
        session.post(f"{BASE_URL}/api/maker/account/cancel-deletion", json={})
        r = session.post(f"{BASE_URL}/api/maker/account/request-deletion", json={})
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("days_remaining") == 30
        g = session.get(f"{BASE_URL}/api/maker/me").json()
        assert g.get("deletion_requested_at")
        assert g.get("deletion_cancels_at")
        # request-deletion also closes the shop
        assert g.get("shop_closed") is True

    def test_05_dup_deletion_returns_400(self, session):
        r = session.post(f"{BASE_URL}/api/maker/account/request-deletion", json={})
        assert r.status_code == 400, r.text

    def test_06_cancel_deletion(self, session):
        r = session.post(f"{BASE_URL}/api/maker/account/cancel-deletion", json={})
        assert r.status_code == 200, r.text
        g = session.get(f"{BASE_URL}/api/maker/me").json()
        assert not g.get("deletion_requested_at")
        assert not g.get("deletion_cancels_at")

    def test_07_cancel_deletion_no_pending_400(self, session):
        r = session.post(f"{BASE_URL}/api/maker/account/cancel-deletion", json={})
        assert r.status_code == 400, r.text

    def test_08_reopen_after_deletion_cancel(self, session):
        # reopen to leave shop in good state for other tests
        session.post(f"{BASE_URL}/api/maker/account/reopen", json={})
        g = session.get(f"{BASE_URL}/api/maker/me").json()
        assert g.get("shop_closed") in (False, None)


# --- Audit row for deletion ---------------------------------------------------
class TestAuditRow:
    def test_audit_row_written(self, session):
        # write once
        session.post(f"{BASE_URL}/api/maker/account/cancel-deletion", json={})
        r = session.post(f"{BASE_URL}/api/maker/account/request-deletion", json={})
        assert r.status_code == 200
        # inspect via mongo directly
        from motor.motor_asyncio import AsyncIOMotorClient
        import asyncio

        async def _check():
            client = AsyncIOMotorClient(os.environ["MONGO_URL"])
            db = client[os.environ["DB_NAME"]]
            doc = await db.admin_audit.find_one(
                {"kind": "maker_deletion_requested", "actor": SLUG},
                sort=[("created_at", -1)],
            )
            return doc

        doc = asyncio.get_event_loop().run_until_complete(_check())
        assert doc is not None, "admin_audit row missing"
        # cleanup
        session.post(f"{BASE_URL}/api/maker/account/cancel-deletion", json={})
        session.post(f"{BASE_URL}/api/maker/account/reopen", json={})
