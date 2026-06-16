"""Iter 51 — Auto-boost (maker) + Admin feedback reply E2E tests.

Covers:
- GET  /api/maker/auto-boost/status
- PATCH /api/maker/auto-boost  (clamping bounds 3-100 / 1-10)
- POST  /api/admin/feedback/{id}/reply  (subject/message validation, 404, replied_at, auto_resolve)
"""
import os
import sys
import pytest
import requests

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://active-project-4.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


# ---- fixtures ----
@pytest.fixture(scope="module")
def maker_jwt():
    from maker_auth import issue_session_jwt
    return issue_session_jwt("iron-and-oak", "iron-and-oak@craftersmarket.org", "maker")


@pytest.fixture(scope="module")
def admin_jwt():
    from maker_auth import issue_session_jwt
    return issue_session_jwt("admin", "team@craftersmarket.org", "admin")


@pytest.fixture(scope="module")
def maker_client(maker_jwt):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {maker_jwt}", "Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def admin_client(admin_jwt):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {admin_jwt}", "Content-Type": "application/json"})
    return s


# ============= Maker auto-boost =============
class TestAutoBoostStatus:
    def test_status_shape(self, maker_client):
        r = maker_client.get(f"{API}/maker/auto-boost/status")
        assert r.status_code == 200, r.text
        data = r.json()
        for k in ["enabled", "min_orders_30d", "max_per_run", "last_run_at",
                  "total_spent_usd", "next_candidates", "next_run_at"]:
            assert k in data, f"missing {k} in {data}"
        assert isinstance(data["enabled"], bool)
        assert isinstance(data["min_orders_30d"], int)
        assert isinstance(data["max_per_run"], int)
        assert isinstance(data["next_candidates"], list)

    def test_status_requires_auth(self):
        r = requests.get(f"{API}/maker/auto-boost/status")
        assert r.status_code in (401, 403)


class TestAutoBoostUpdate:
    def test_toggle_enabled_persists(self, maker_client):
        # Enable then read back
        r = maker_client.patch(f"{API}/maker/auto-boost", json={"enabled": True})
        assert r.status_code == 200, r.text
        assert r.json().get("applied", {}).get("auto_boost_enabled") is True

        chk = maker_client.get(f"{API}/maker/auto-boost/status").json()
        assert chk["enabled"] is True

        # Disable to clean up
        r2 = maker_client.patch(f"{API}/maker/auto-boost", json={"enabled": False})
        assert r2.status_code == 200
        chk2 = maker_client.get(f"{API}/maker/auto-boost/status").json()
        assert chk2["enabled"] is False

    def test_min_orders_clamped_low(self, maker_client):
        r = maker_client.patch(f"{API}/maker/auto-boost", json={"min_orders_30d": 1})
        assert r.status_code == 200
        assert r.json()["applied"]["auto_boost_min_orders_30d"] == 3

    def test_min_orders_clamped_high(self, maker_client):
        r = maker_client.patch(f"{API}/maker/auto-boost", json={"min_orders_30d": 999})
        assert r.status_code == 200
        assert r.json()["applied"]["auto_boost_min_orders_30d"] == 100

    def test_max_per_run_clamped_low(self, maker_client):
        r = maker_client.patch(f"{API}/maker/auto-boost", json={"max_per_run": 0})
        assert r.status_code == 200
        assert r.json()["applied"]["auto_boost_max_per_run"] == 1

    def test_max_per_run_clamped_high(self, maker_client):
        r = maker_client.patch(f"{API}/maker/auto-boost", json={"max_per_run": 50})
        assert r.status_code == 200
        assert r.json()["applied"]["auto_boost_max_per_run"] == 10

    def test_empty_body_400(self, maker_client):
        r = maker_client.patch(f"{API}/maker/auto-boost", json={})
        assert r.status_code == 400

    def test_reset_to_defaults(self, maker_client):
        # leave a sane state for the rest of the suite
        r = maker_client.patch(f"{API}/maker/auto-boost", json={"min_orders_30d": 10, "max_per_run": 3, "enabled": False})
        assert r.status_code == 200


# ============= Admin feedback reply =============
class TestAdminFeedbackReply:
    @pytest.fixture(scope="class")
    def feedback_id(self, admin_client):
        # Seed a feedback row directly via mongo
        import asyncio
        from core import db
        import secrets
        from datetime import datetime, timezone

        fid = secrets.token_hex(8)
        doc = {
            "id": fid,
            "email": "TEST_feedback_reply@example.com",
            "subject": "TEST seed for reply test",
            "message": "iter51 seed",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "resolved": False,
        }
        asyncio.run(db.beta_feedback.insert_one(doc))
        yield fid
        # Cleanup
        asyncio.run(db.beta_feedback.delete_one({"id": fid}))

    def test_reply_404_for_missing(self, admin_client):
        r = admin_client.post(
            f"{API}/admin/feedback/does-not-exist-zzz/reply",
            json={"subject": "x", "message": "y", "auto_resolve": True},
        )
        assert r.status_code == 404

    def test_reply_400_empty_subject(self, admin_client, feedback_id):
        r = admin_client.post(
            f"{API}/admin/feedback/{feedback_id}/reply",
            json={"subject": "  ", "message": "hi", "auto_resolve": False},
        )
        assert r.status_code == 400

    def test_reply_400_empty_message(self, admin_client, feedback_id):
        r = admin_client.post(
            f"{API}/admin/feedback/{feedback_id}/reply",
            json={"subject": "Re:", "message": "", "auto_resolve": False},
        )
        assert r.status_code == 400

    def test_reply_marks_replied_and_resolved(self, admin_client, feedback_id):
        r = admin_client.post(
            f"{API}/admin/feedback/{feedback_id}/reply",
            json={"subject": "Thanks!", "message": "We hear you.", "auto_resolve": True},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ok") is True
        assert body.get("to") == "TEST_feedback_reply@example.com"
        assert body.get("resolved") is True

        # verify db side-effects
        import asyncio
        from core import db
        doc = asyncio.run(
            db.beta_feedback.find_one({"id": feedback_id}, {"_id": 0})
        )
        assert doc["replied_at"] is not None
        assert doc["resolved"] is True
        assert doc["replied_subject"] == "Thanks!"

        # audit log entry created
        audit = asyncio.run(
            db.admin_audit.find_one({"feedback_id": feedback_id, "kind": "feedback_reply"}, {"_id": 0})
        )
        assert audit is not None
        assert audit["to"] == "TEST_feedback_reply@example.com"

    def test_reply_requires_auth(self, feedback_id):
        r = requests.post(
            f"{API}/admin/feedback/{feedback_id}/reply",
            json={"subject": "x", "message": "y"},
        )
        assert r.status_code in (401, 403)


# ============= Smoke regression =============
class TestRegressionSmoke:
    def test_maker_me(self, maker_client):
        r = maker_client.get(f"{API}/maker/me")
        assert r.status_code == 200
        assert r.json().get("slug") == "iron-and-oak"

    def test_admin_feedback_list(self, admin_client):
        r = admin_client.get(f"{API}/admin/feedback")
        assert r.status_code == 200
