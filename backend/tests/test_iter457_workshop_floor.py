"""iter457 — Workshop Floor knowledge-hub refactor: backend test suite.

Covers:
  • 10-category taxonomy (/community/forum/categories) w/ live counts
  • Public overview aggregate (/community/overview)
  • Category / tag / legacy-tag filtering (/community/forum)
  • Tag follow/unfollow + followed feed (buyer auth)
  • Thread create w/ tag validation + legacy category mapping
  • Admin migration report + safe (no-force) migrate call
  • Migration data integrity check
"""
import os
import pytest
import requests
import subprocess
import json

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://active-project-4.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"



@pytest.fixture(scope="module")
def buyer_jwt():
    """Mint a fresh buyer JWT via the backend helper."""
    script = (
        "import asyncio\n"
        "from dotenv import load_dotenv; load_dotenv('/app/backend/.env')\n"
        "from core import db\n"
        "from maker_auth import issue_session_jwt\n"
        "async def m():\n"
        "    u = await db.community_users.find_one({}, {'_id':0})\n"
        "    print(issue_session_jwt(u.get('user_id') or u.get('id'), u['email'], role='buyer'))\n"
        "asyncio.run(m())\n"
    )
    out = subprocess.check_output(["python3", "-c", script], cwd="/app/backend", stderr=subprocess.DEVNULL)
    return out.decode().strip().splitlines()[-1]


@pytest.fixture(scope="module")
def admin_jwt():
    """Mint a fresh admin JWT via the backend helper."""
    script = (
        "from dotenv import load_dotenv; load_dotenv('/app/backend/.env')\n"
        "from maker_auth import issue_session_jwt\n"
        "print(issue_session_jwt('admin', 'team@craftersmarket.org', role='admin'))\n"
    )
    out = subprocess.check_output(["python3", "-c", script], cwd="/app/backend", stderr=subprocess.DEVNULL)
    return out.decode().strip().splitlines()[-1]


@pytest.fixture(scope="module")
def buyer_headers(buyer_jwt):
    return {"Authorization": f"Bearer {buyer_jwt}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def admin_headers(admin_jwt):
    return {"Authorization": f"Bearer {admin_jwt}", "Content-Type": "application/json"}


# ── 1. Category list ─────────────────────────────────────────────────
class TestCategories:
    EXPECTED = {"marketplace", "getting-started", "woodworking", "laser",
                "plasma-metal", "3d-printing", "handmade-crafts",
                "design-software", "selling", "community"}

    def test_categories_list(self):
        r = requests.get(f"{API}/community/forum/categories", timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        cats = data["categories"]
        assert len(cats) == 10, f"Expected 10 categories, got {len(cats)}"
        ids = {c["id"] for c in cats}
        assert ids == self.EXPECTED, f"Category id mismatch: {ids ^ self.EXPECTED}"
        total = 0
        for c in cats:
            assert "label" in c and isinstance(c["label"], str)
            assert "blurb" in c
            assert isinstance(c["tags"], list) and len(c["tags"]) > 0
            assert isinstance(c["thread_count"], int)
            total += c["thread_count"]
        assert total > 0, "Sum of thread_counts should be > 0 after migration"


# ── 2. Overview aggregate ────────────────────────────────────────────
class TestOverview:
    def test_overview_shape(self):
        r = requests.get(f"{API}/community/overview", timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert isinstance(d["trending_discussions"], list) and len(d["trending_discussions"]) <= 5
        assert isinstance(d["featured_projects"], list) and len(d["featured_projects"]) <= 4
        assert isinstance(d["latest_videos"], list)
        assert isinstance(d["latest_journal"], list) and len(d["latest_journal"]) <= 3
        assert isinstance(d["popular_files"], list) and len(d["popular_files"]) <= 4
        assert isinstance(d["trending_tags"], list)
        if d["trending_tags"]:
            assert "tag" in d["trending_tags"][0] and "count" in d["trending_tags"][0]
        stats = d["stats"]
        for k in ("members", "threads", "replies", "projects", "design_files", "new_members_30d"):
            assert k in stats and isinstance(stats[k], int)
        assert isinstance(d["coming_soon"], list) and len(d["coming_soon"]) == 4


# ── 3. Filter by category / tag / legacy alias ───────────────────────
class TestForumFilters:
    def test_filter_by_category_woodworking(self):
        r = requests.get(f"{API}/community/forum", params={"category": "woodworking"}, timeout=15)
        assert r.status_code == 200
        rows = r.json()
        assert isinstance(rows, list)
        for t in rows:
            assert t["category"] == "woodworking", f"Non-woodworking thread returned: {t.get('id')}"

    def test_filter_by_tag_cnc_router(self):
        r = requests.get(f"{API}/community/forum", params={"tag": "cnc-router"}, timeout=15)
        assert r.status_code == 200
        rows = r.json()
        assert isinstance(rows, list)
        for t in rows:
            assert "cnc-router" in (t.get("tags") or []), f"Thread missing cnc-router tag: {t.get('id')}"

    def test_legacy_tag_alias_general(self):
        """?tag=general should be mapped to community-category threads."""
        r = requests.get(f"{API}/community/forum", params={"tag": "general"}, timeout=15)
        assert r.status_code == 200
        rows = r.json()
        assert isinstance(rows, list)
        for t in rows:
            assert t["category"] == "community", f"Legacy 'general' → non-community thread: {t.get('id')}"


# ── 4. Tag follow / unfollow (buyer auth) ────────────────────────────
class TestTagFollows:
    def test_following_requires_auth(self):
        r = requests.get(f"{API}/community/tags/following", timeout=15)
        assert r.status_code in (401, 403), f"Expected 401/403 got {r.status_code}"

    def test_follow_bad_tag_400(self, buyer_headers):
        r = requests.post(f"{API}/community/tags/not-a-real-tag/follow",
                          headers=buyer_headers, timeout=15)
        assert r.status_code == 400

    def test_follow_flow(self, buyer_headers):
        # Follow
        r = requests.post(f"{API}/community/tags/cnc-router/follow",
                          headers=buyer_headers, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json() == {"ok": True, "following": True}

        # Listed
        r = requests.get(f"{API}/community/tags/following", headers=buyer_headers, timeout=15)
        assert r.status_code == 200
        assert "cnc-router" in r.json()["tags"]

        # Followed feed
        r = requests.get(f"{API}/community/forum-feed/followed", headers=buyer_headers, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert "cnc-router" in d["tags"]
        assert isinstance(d["threads"], list)
        for t in d["threads"]:
            assert "cnc-router" in (t.get("tags") or [])

        # Unfollow (cleanup)
        r = requests.delete(f"{API}/community/tags/cnc-router/follow",
                            headers=buyer_headers, timeout=15)
        assert r.status_code == 200
        assert r.json() == {"ok": True, "following": False}

        # Verify removed
        r = requests.get(f"{API}/community/tags/following", headers=buyer_headers, timeout=15)
        assert "cnc-router" not in r.json()["tags"]


# ── 5. Thread create w/ tag validation + legacy map ──────────────────
class TestThreadCreate:
    CREATED_IDS = []
    CREATED_TITLES = ["TEST_iter457_laser_thread", "TEST_iter457_legacy_machinehelp"]

    def test_create_thread_laser_with_tag_filter(self, buyer_headers):
        payload = {
            "title": "TEST_iter457_laser_thread",
            "body": "Testing tag filter, invalid tag should be dropped.",
            "category": "laser",
            "tags": ["diode", "material-settings", "invalid-tag"],
        }
        r = requests.post(f"{API}/community/forum",
                          headers=buyer_headers, json=payload, timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["category"] == "laser"
        assert set(d["tags"]) == {"diode", "material-settings"}, f"Got {d['tags']}"
        assert "invalid-tag" not in d["tags"]
        self.CREATED_IDS.append(d["id"])

    def test_create_thread_legacy_machine_help_maps_community(self, buyer_headers):
        payload = {
            "title": "TEST_iter457_legacy_machinehelp",
            "body": "Legacy machine-help category should map to community.",
            "category": "machine-help",
            "tags": [],
        }
        r = requests.post(f"{API}/community/forum",
                          headers=buyer_headers, json=payload, timeout=20)
        assert r.status_code == 200, r.text
        assert r.json()["category"] == "community"
        self.CREATED_IDS.append(r.json()["id"])

    def test_create_thread_unknown_category_400(self, buyer_headers):
        payload = {"title": "TEST_iter457_bad_cat", "body": "x", "category": "not-a-cat", "tags": []}
        r = requests.post(f"{API}/community/forum",
                          headers=buyer_headers, json=payload, timeout=20)
        assert r.status_code == 400

    def test_zzz_cleanup(self):
        """Delete threads created above by exact titles."""
        script = (
            "import asyncio\n"
            "from dotenv import load_dotenv; load_dotenv('/app/backend/.env')\n"
            "from core import db\n"
            "async def m():\n"
            "    titles = " + json.dumps(self.CREATED_TITLES) + "\n"
            "    res = await db.forum_threads.delete_many({'title': {'$in': titles}})\n"
            "    print('deleted:', res.deleted_count)\n"
            "asyncio.run(m())\n"
        )
        out = subprocess.check_output(["python3", "-c", script], cwd="/app/backend", stderr=subprocess.DEVNULL)
        assert b"deleted:" in out


# ── 6. Admin migration report + safe migrate ─────────────────────────
class TestMigration:
    def test_report_requires_admin(self):
        r = requests.get(f"{API}/admin/forum/migration-report", timeout=15)
        assert r.status_code in (401, 403)

    def test_migrate_requires_admin(self):
        r = requests.post(f"{API}/admin/forum/migrate", timeout=15)
        assert r.status_code in (401, 403)

    def test_migration_report(self, admin_headers):
        r = requests.get(f"{API}/admin/forum/migration-report", headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("report") is not None
        counts = d["report"]["counts"]
        for k in ("total", "high", "medium", "low_fallback", "review", "skipped_already_migrated"):
            assert k in counts and isinstance(counts[k], int)
        assert counts["skipped_already_migrated"] >= 70
        assert isinstance(d["report"]["by_category"], dict)

    def test_migrate_noforce_idempotent(self, admin_headers):
        r = requests.post(f"{API}/admin/forum/migrate", headers=admin_headers, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        # Since all threads have been migrated: total should be 0 (nothing left to process),
        # and skipped_already_migrated should reflect the migrated pool (>=70).
        assert d["counts"]["total"] == 0, f"noforce migrate processed {d['counts']['total']} unexpected threads"
        assert d["counts"]["skipped_already_migrated"] >= 70


# ── 7. Migration data integrity ──────────────────────────────────────
class TestMigrationDataIntegrity:
    def test_threads_have_legacy_metadata(self):
        script = (
            "import asyncio, json\n"
            "from dotenv import load_dotenv; load_dotenv('/app/backend/.env')\n"
            "from core import db\n"
            "async def m():\n"
            "    total = await db.forum_threads.count_documents({})\n"
            "    migrated = await db.forum_threads.count_documents({'legacy_category': {'$exists': True}})\n"
            "    with_tags = await db.forum_threads.count_documents({'tags': {'$exists': True}})\n"
            "    with_conf = await db.forum_threads.count_documents({'migration_confidence': {'$exists': True}})\n"
            "    replies = await db.forum_replies.count_documents({})\n"
            "    sample = await db.forum_threads.find_one({'legacy_category': {'$exists': True}}, {'_id':0, 'legacy_category':1,'tags':1,'migration_confidence':1,'created_at':1,'user_name':1,'reply_count':1})\n"
            "    print(json.dumps({'total':total,'migrated':migrated,'with_tags':with_tags,'with_conf':with_conf,'replies':replies,'sample':sample}))\n"
            "asyncio.run(m())\n"
        )
        out = subprocess.check_output(["python3", "-c", script], cwd="/app/backend", stderr=subprocess.DEVNULL)
        # last json line
        line = [l for l in out.decode().splitlines() if l.startswith("{")][-1]
        d = json.loads(line)
        assert d["migrated"] >= 70, f"migrated={d['migrated']}"
        assert d["with_tags"] >= 70
        assert d["with_conf"] >= 70
        assert d["replies"] == 222, f"forum_replies expected 222 got {d['replies']}"
        s = d["sample"]
        assert s and "legacy_category" in s and "tags" in s and "migration_confidence" in s
        assert "created_at" in s and "user_name" in s and "reply_count" in s
