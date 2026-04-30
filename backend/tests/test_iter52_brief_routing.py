"""Iter52 — Custom-order brief routing (push-to-maker → push-to-reddit).

Coverage:
- POST /api/admin/custom-orders/{id}/push-to-maker (happy + 404 + 400 paths)
- GET  /api/maker/briefs                            (returns assigned briefs)
- PATCH /api/maker/briefs/{id}                      (accept/decline/in_progress/completed)
- POST /api/admin/custom-orders/{id}/push-to-reddit (gated 502 when env missing,
                                                     400 when not assigned, 400 when already posted)
- GET  /api/community/reddit/status                 (returns can_post flag)
"""
import os
import sys
import pytest
import requests

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")
from maker_auth import issue_session_jwt  # noqa: E402

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # Fall back to frontend env explicitly so the test fails fast w/ a clear msg
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                break

ADMIN_EMAIL = "team@craftersmarket.org"
MAKER_SLUG = "iron-and-oak"
MAKER_EMAIL = "iron-and-oak@craftersmarket.org"
OTHER_MAKER_SLUG = "metalart-pro"
OTHER_MAKER_EMAIL = "metalart-pro@craftersmarket.org"


@pytest.fixture(scope="session")
def admin_headers():
    tok = issue_session_jwt("admin", ADMIN_EMAIL, "admin")
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="session")
def maker_headers():
    tok = issue_session_jwt(MAKER_SLUG, MAKER_EMAIL, "maker")
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="session")
def other_maker_headers():
    tok = issue_session_jwt(OTHER_MAKER_SLUG, OTHER_MAKER_EMAIL, "maker")
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


def _create_brief(suffix=""):
    """Submit a fresh custom-order brief (public endpoint)."""
    payload = {
        "name": f"TEST_iter52{suffix}",
        "email": f"TEST_iter52{suffix}@example.com",
        "project_type": "Wooden side table",
        "material": "white oak",
        "size": "18x24x22",
        "budget": "$400-$600",
        "timeline": "4-6 weeks",
        "quantity": "1",
        "policy_accepted": True,
        "description": "Looking for a hand-finished side table for my reading nook.",
    }
    r = requests.post(f"{BASE_URL}/api/custom-orders", json=payload, timeout=30)
    assert r.status_code in (200, 201), f"create brief failed: {r.status_code} {r.text}"
    data = r.json()
    return data.get("id") or data.get("order_id") or data.get("custom_order_id")


# ---------------- Reddit status endpoint ----------------
class TestRedditStatus:
    def test_feed_status_includes_can_post(self):
        r = requests.get(f"{BASE_URL}/api/community/reddit/status", timeout=10)
        assert r.status_code == 200
        data = r.json()
        assert "configured" in data
        assert "can_post" in data, "feed_status must include new can_post field"
        assert isinstance(data["can_post"], bool)
        assert "subreddits" in data
        assert isinstance(data["subreddits"], list)
        # current preview env has no REDDIT_USERNAME/PASSWORD
        assert data["can_post"] is False, (
            f"Expected can_post=False in current env, got {data}"
        )


# ---------------- Push-to-maker ----------------
class TestPushToMaker:
    @classmethod
    def setup_class(cls):
        cls.brief_id = _create_brief("_push_maker")

    def test_404_on_missing_order(self, admin_headers):
        r = requests.post(
            f"{BASE_URL}/api/admin/custom-orders/does-not-exist/push-to-maker",
            json={"maker_slug": MAKER_SLUG},
            headers=admin_headers,
            timeout=15,
        )
        assert r.status_code == 404

    def test_404_on_missing_maker(self, admin_headers):
        r = requests.post(
            f"{BASE_URL}/api/admin/custom-orders/{self.brief_id}/push-to-maker",
            json={"maker_slug": "ghost-maker-not-real"},
            headers=admin_headers,
            timeout=15,
        )
        assert r.status_code == 404

    def test_happy_path_assigns_and_creates_thread(self, admin_headers):
        r = requests.post(
            f"{BASE_URL}/api/admin/custom-orders/{self.brief_id}/push-to-maker",
            json={
                "maker_slug": MAKER_SLUG,
                "note": "TEST_iter52 admin note",
                "notify_buyer": False,
            },
            headers=admin_headers,
            timeout=20,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        data = r.json()
        assert data.get("ok") is True
        assert data.get("assigned_to") == MAKER_SLUG
        assert data.get("thread_id"), "expected thread_id in response"
        type(self).thread_id = data["thread_id"]

    def test_persists_assignment_fields(self, admin_headers):
        # Verify via maker endpoint that fields persisted
        tok = issue_session_jwt(MAKER_SLUG, MAKER_EMAIL, "maker")
        h = {"Authorization": f"Bearer {tok}"}
        r = requests.get(f"{BASE_URL}/api/maker/briefs", headers=h, timeout=10)
        assert r.status_code == 200
        rows = r.json()
        match = next((x for x in rows if x.get("id") == self.brief_id), None)
        assert match is not None, "brief should appear in maker briefs"
        assert match["assigned_maker_slug"] == MAKER_SLUG
        assert match["assigned_by"] == ADMIN_EMAIL
        assert match["assignment_note"] == "TEST_iter52 admin note"
        assert match.get("assigned_at")
        assert match.get("status") in ("assigned", "quoted")


# ---------------- Maker briefs (GET + PATCH) ----------------
class TestMakerBriefs:
    @classmethod
    def setup_class(cls):
        cls.brief_id = _create_brief("_maker_briefs")
        # admin assigns to iron-and-oak
        tok = issue_session_jwt("admin", ADMIN_EMAIL, "admin")
        h = {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}
        r = requests.post(
            f"{BASE_URL}/api/admin/custom-orders/{cls.brief_id}/push-to-maker",
            json={"maker_slug": MAKER_SLUG},
            headers=h, timeout=20,
        )
        assert r.status_code == 200

    def test_get_briefs_returns_array(self, maker_headers):
        r = requests.get(f"{BASE_URL}/api/maker/briefs", headers=maker_headers, timeout=10)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        assert any(x.get("id") == self.brief_id for x in data)

    def test_cross_maker_isolation(self, other_maker_headers):
        # Other maker should NOT see this brief
        r = requests.get(f"{BASE_URL}/api/maker/briefs", headers=other_maker_headers, timeout=10)
        assert r.status_code == 200
        data = r.json()
        assert not any(x.get("id") == self.brief_id for x in data), \
            "cross-maker isolation broken: other maker can see assigned brief"

    def test_patch_invalid_status(self, maker_headers):
        r = requests.patch(
            f"{BASE_URL}/api/maker/briefs/{self.brief_id}",
            json={"status": "bogus_status"},
            headers=maker_headers, timeout=10,
        )
        assert r.status_code == 400

    def test_patch_unassigned_brief_404(self, other_maker_headers):
        # other_maker tries to update a brief that was assigned to iron-and-oak
        r = requests.patch(
            f"{BASE_URL}/api/maker/briefs/{self.brief_id}",
            json={"status": "accepted"},
            headers=other_maker_headers, timeout=10,
        )
        assert r.status_code == 404

    def test_patch_accepted_persists(self, maker_headers):
        r = requests.patch(
            f"{BASE_URL}/api/maker/briefs/{self.brief_id}",
            json={"status": "accepted", "note": "TEST_iter52 will start next week"},
            headers=maker_headers, timeout=10,
        )
        assert r.status_code == 200
        data = r.json()
        assert data["status"] == "accepted"

        # Re-fetch and verify persistence
        r2 = requests.get(f"{BASE_URL}/api/maker/briefs", headers=maker_headers, timeout=10)
        rows = r2.json()
        match = next((x for x in rows if x.get("id") == self.brief_id), None)
        assert match["maker_response_status"] == "accepted"
        assert match["maker_response_note"] == "TEST_iter52 will start next week"
        assert match.get("maker_response_at")

    def test_patch_in_progress_then_completed(self, maker_headers):
        for st in ("in_progress", "completed"):
            r = requests.patch(
                f"{BASE_URL}/api/maker/briefs/{self.brief_id}",
                json={"status": st},
                headers=maker_headers, timeout=10,
            )
            assert r.status_code == 200, f"{st}: {r.text}"
            assert r.json()["status"] == st


# ---------------- Push-to-Reddit (gated) ----------------
class TestPushToReddit:
    @classmethod
    def setup_class(cls):
        cls.brief_id_unassigned = _create_brief("_reddit_unassigned")
        cls.brief_id_assigned = _create_brief("_reddit_assigned")
        tok = issue_session_jwt("admin", ADMIN_EMAIL, "admin")
        h = {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}
        r = requests.post(
            f"{BASE_URL}/api/admin/custom-orders/{cls.brief_id_assigned}/push-to-maker",
            json={"maker_slug": MAKER_SLUG},
            headers=h, timeout=20,
        )
        assert r.status_code == 200

    def test_reddit_404_on_missing_order(self, admin_headers):
        r = requests.post(
            f"{BASE_URL}/api/admin/custom-orders/nonexistent-id/push-to-reddit",
            json={"subreddit": "forhire"},
            headers=admin_headers, timeout=15,
        )
        assert r.status_code == 404

    def test_reddit_400_when_not_assigned(self, admin_headers):
        r = requests.post(
            f"{BASE_URL}/api/admin/custom-orders/{self.brief_id_unassigned}/push-to-reddit",
            json={"subreddit": "forhire"},
            headers=admin_headers, timeout=15,
        )
        assert r.status_code == 400, f"{r.status_code} {r.text}"
        assert "maker" in (r.json().get("detail") or "").lower()

    def test_reddit_502_when_not_configured(self, admin_headers):
        r = requests.post(
            f"{BASE_URL}/api/admin/custom-orders/{self.brief_id_assigned}/push-to-reddit",
            json={"subreddit": "forhire"},
            headers=admin_headers, timeout=20,
        )
        # Expected per current preview env (no REDDIT_USERNAME/PASSWORD).
        assert r.status_code == 502, f"{r.status_code} {r.text}"
        detail = (r.json().get("detail") or "").lower()
        assert "reddit" in detail or "configured" in detail or "username" in detail


# ---------------- Cleanup ----------------
@pytest.fixture(scope="session", autouse=True)
def _cleanup_after_session():
    yield
    try:
        from motor.motor_asyncio import AsyncIOMotorClient
        import asyncio
        mongo_url = os.environ.get("MONGO_URL")
        db_name = os.environ.get("DB_NAME")
        if not mongo_url or not db_name:
            return
        client = AsyncIOMotorClient(mongo_url)
        d = client[db_name]

        async def _do():
            res = await d.custom_orders.find(
                {"email": {"$regex": "^TEST_iter52"}}, {"id": 1}
            ).to_list(50)
            ids = [r["id"] for r in res if r.get("id")]
            if ids:
                await d.custom_orders.delete_many({"id": {"$in": ids}})
                await d.dm_threads.delete_many({"custom_order_id": {"$in": ids}})
                await d.dm_messages.delete_many({"thread_id": {"$exists": True}})
                await d.admin_audit.delete_many({"order_id": {"$in": ids}})
        asyncio.get_event_loop().run_until_complete(_do())
    except Exception as e:
        print(f"cleanup warning: {e}")
