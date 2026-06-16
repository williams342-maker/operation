"""Iter53 — Funnel analytics + won_bid maker status + reddit cross-post code-path.

Coverage:
- GET /api/admin/custom-orders/funnel (admin-only) returns correct shape
- PATCH /api/maker/briefs/{id} status='won_bid' → 200 + won_bid_at set,
  and funnel won_bid count increments immediately.
- Verify the reddit cross-post code-path EXISTS in admin_push_to_reddit
  (lazy static-import check — no live reddit call).
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
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                break

ADMIN_EMAIL = "team@craftersmarket.org"
MAKER_SLUG = "iron-and-oak"
MAKER_EMAIL = "iron-and-oak@craftersmarket.org"


@pytest.fixture(scope="session")
def admin_headers():
    tok = issue_session_jwt("admin", ADMIN_EMAIL, "admin")
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="session")
def maker_headers():
    tok = issue_session_jwt(MAKER_SLUG, MAKER_EMAIL, "maker")
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


def _create_brief(suffix=""):
    payload = {
        "name": f"TEST_iter53{suffix}",
        "email": f"TEST_iter53{suffix}@example.com",
        "project_type": "Walnut shelf",
        "material": "walnut",
        "size": "30x10x6",
        "budget": "$300",
        "timeline": "4 weeks",
        "quantity": "1",
        "policy_accepted": True,
        "description": "Custom wall shelf for the kitchen.",
    }
    r = requests.post(f"{BASE_URL}/api/custom-orders", json=payload, timeout=30)
    assert r.status_code in (200, 201), f"create brief failed: {r.status_code} {r.text}"
    data = r.json()
    return data.get("id") or data.get("order_id") or data.get("custom_order_id")


# ---------------- Funnel endpoint shape + auth ----------------
class TestFunnelEndpoint:
    def test_funnel_requires_admin_auth(self):
        r = requests.get(f"{BASE_URL}/api/admin/custom-orders/funnel", timeout=10)
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}"

    def test_funnel_rejects_maker_token(self, maker_headers):
        r = requests.get(
            f"{BASE_URL}/api/admin/custom-orders/funnel",
            headers=maker_headers, timeout=10,
        )
        assert r.status_code in (401, 403)

    def test_funnel_returns_full_shape(self, admin_headers):
        r = requests.get(
            f"{BASE_URL}/api/admin/custom-orders/funnel",
            headers=admin_headers, timeout=15,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        # top-level keys
        for key in ("stages", "win_rate", "decline_rate", "reddit_post_rate",
                    "by_subreddit", "by_maker"):
            assert key in data, f"missing top-level key {key}"
        # 9 required stages
        for stage in ("submitted", "quoted", "routed", "accepted", "in_progress",
                      "completed", "won_bid", "declined", "posted_to_reddit"):
            assert stage in data["stages"], f"missing stage {stage}"
            assert isinstance(data["stages"][stage], int)
            assert data["stages"][stage] >= 0
        # rate types
        assert isinstance(data["win_rate"], (int, float))
        assert 0.0 <= float(data["win_rate"]) <= 1.0
        assert isinstance(data["decline_rate"], (int, float))
        assert isinstance(data["reddit_post_rate"], (int, float))
        # lists
        assert isinstance(data["by_subreddit"], list)
        assert isinstance(data["by_maker"], list)
        # shapes of each sub-row (best-effort — only assert if any exists)
        for row in data["by_maker"]:
            for k in ("maker_slug", "routed", "won", "declined", "win_rate"):
                assert k in row
        for row in data["by_subreddit"]:
            for k in ("subreddit", "posted", "won", "win_rate"):
                assert k in row


# ---------------- won_bid PATCH + funnel increment ----------------
class TestWonBidStatus:
    @classmethod
    def setup_class(cls):
        cls.brief_id = _create_brief("_wonbid")
        tok = issue_session_jwt("admin", ADMIN_EMAIL, "admin")
        h = {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}
        r = requests.post(
            f"{BASE_URL}/api/admin/custom-orders/{cls.brief_id}/push-to-maker",
            json={"maker_slug": MAKER_SLUG},
            headers=h, timeout=20,
        )
        assert r.status_code == 200

    def test_patch_won_bid_accepted(self, maker_headers):
        r = requests.patch(
            f"{BASE_URL}/api/maker/briefs/{self.brief_id}",
            json={"status": "won_bid"},
            headers=maker_headers, timeout=10,
        )
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "won_bid"

    def test_won_bid_at_persisted(self, maker_headers):
        r = requests.get(f"{BASE_URL}/api/maker/briefs",
                         headers=maker_headers, timeout=10)
        assert r.status_code == 200
        match = next((x for x in r.json() if x.get("id") == self.brief_id), None)
        assert match is not None
        assert match.get("maker_response_status") == "won_bid"
        assert match.get("won_bid_at"), "won_bid_at timestamp must be set"

    def test_funnel_reflects_won_bid(self, admin_headers):
        r = requests.get(
            f"{BASE_URL}/api/admin/custom-orders/funnel",
            headers=admin_headers, timeout=15,
        )
        assert r.status_code == 200
        data = r.json()
        assert data["stages"]["won_bid"] >= 1
        # iron-and-oak should appear in by_maker with at least 1 won
        entry = next((x for x in data["by_maker"]
                      if x.get("maker_slug") == MAKER_SLUG), None)
        assert entry is not None, "iron-and-oak should appear in by_maker"
        assert entry["won"] >= 1
        assert entry["routed"] >= entry["won"]
        assert 0.0 < entry["win_rate"] <= 1.0


# ---------------- Reddit cross-post code-path (static) ----------------
class TestRedditCrossPostCodePath:
    """No live reddit creds in this env. Verify the cross-post block
    exists in admin.py source so push-to-reddit will append to the
    existing dm_thread on success."""
    def test_cross_post_block_exists(self):
        src = open("/app/backend/routers/admin.py").read()
        # must contain a lookup for existing admin_brief thread tied to the order
        assert 'db.dm_threads.find_one(' in src
        assert '"custom_order_id": order_id' in src
        assert '"kind": "admin_brief"' in src
        # inserts a message with the Reddit URL
        assert 'db.dm_messages.insert_one(' in src
        assert 'Brief is now live on r/' in src
        # updates thread counters
        assert '"unread_for_maker": 1' in src
        assert '"message_count": 1' in src
        assert '"last_sender": "admin"' in src

    def test_cross_post_only_runs_on_success(self):
        """The cross-post block must be AFTER the 502 raise so it only
        executes when reddit returned ok."""
        src = open("/app/backend/routers/admin.py").read()
        idx_502 = src.find('raise HTTPException(502, result.get("error")')
        idx_cross = src.find("Cross-post the live Reddit URL")
        assert idx_502 != -1 and idx_cross != -1
        assert idx_cross > idx_502, \
            "cross-post block must be AFTER the 502 raise so failure no-ops"


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
                {"email": {"$regex": "^TEST_iter53"}}, {"id": 1}
            ).to_list(50)
            ids = [r["id"] for r in res if r.get("id")]
            if ids:
                await d.custom_orders.delete_many({"id": {"$in": ids}})
                await d.dm_threads.delete_many({"custom_order_id": {"$in": ids}})
                await d.admin_audit.delete_many({"order_id": {"$in": ids}})
        try:
            asyncio.run(_do())
        except RuntimeError:
            asyncio.run(_do())
    except Exception as e:
        print(f"cleanup warning: {e}")
