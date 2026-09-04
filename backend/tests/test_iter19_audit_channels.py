"""iter19 backend regression: removed channels, audit-log endpoint, chat_cleanup ISO parsing."""
import asyncio
import os
import uuid
import pytest
import requests
from urllib.parse import urlparse

import sys
sys.path.insert(0, "/app/backend")

from dotenv import load_dotenv
load_dotenv("/app/backend/.env")

from maker_auth import issue_session_jwt
from chat_cleanup import _parse_iso, clear_idle_rooms
from core import db, now_iso

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # fallback: load from frontend/.env
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL"):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                break

ADMIN_JWT = issue_session_jwt("admin", "team@craftersmarket.org", role="admin")
ADMIN_HEADERS = {"Authorization": f"Bearer {ADMIN_JWT}"}


# --- Channels removed: news-and-events / show-off ---
class TestChannelsRemoved:
    def test_history_rejects_show_off(self):
        r = requests.get(f"{BASE_URL}/api/community/chat/show-off/history", timeout=15)
        assert r.status_code == 404, r.text

    def test_history_rejects_news_and_events(self):
        r = requests.get(f"{BASE_URL}/api/community/chat/news-and-events/history", timeout=15)
        assert r.status_code == 404, r.text

    def test_history_accepts_general(self):
        r = requests.get(f"{BASE_URL}/api/community/chat/general/history", timeout=15)
        assert r.status_code == 200

    def test_buddies_rejects_show_off(self):
        r = requests.get(f"{BASE_URL}/api/community/chat/show-off/buddies", timeout=15)
        assert r.status_code == 404

    def test_channels_set_exact(self):
        # iter413ao — `CHANNELS` constant was removed from routers.community
        # in favor of dynamic per-tier channel lookup (`get_allowed_channels()`
        # in iter300+). Test skipped — replacement coverage lives in
        # test_iter4_ai_community.py + the live community auth flow.
        import pytest
        pytest.skip("CHANNELS constant removed in iter300+ refactor")


# --- WebSocket rejection (4404) for removed channels ---
class TestWebSocketRejection:
    def _ws_url(self, channel):
        u = urlparse(BASE_URL)
        scheme = "wss" if u.scheme == "https" else "ws"
        return f"{scheme}://{u.netloc}/api/ws/chat/{channel}?token={ADMIN_JWT}"

    def test_ws_show_off_rejected(self):
        try:
            from websockets.sync.client import connect
        except ImportError:
            pytest.skip("websockets lib not installed")
        url = self._ws_url("show-off")
        try:
            with connect(url) as ws:
                ws.recv()
                pytest.fail("expected close")
        except Exception as e:
            # 4404 close code is signaled in exception
            assert "4404" in str(e) or "404" in str(e) or "rejected" in str(e).lower(), str(e)

    def test_ws_news_and_events_rejected(self):
        try:
            from websockets.sync.client import connect
        except ImportError:
            pytest.skip("websockets lib not installed")
        url = self._ws_url("news-and-events")
        try:
            with connect(url) as ws:
                ws.recv()
                pytest.fail("expected close")
        except Exception as e:
            assert "4404" in str(e) or "404" in str(e) or "rejected" in str(e).lower(), str(e)


# --- /api/admin/audit-log ---
class TestAuditLog:
    def test_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/admin/audit-log", timeout=15)
        assert r.status_code in (401, 403)

    def test_returns_items_shape(self):
        r = requests.get(f"{BASE_URL}/api/admin/audit-log", headers=ADMIN_HEADERS, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "items" in data and "count" in data
        assert isinstance(data["items"], list)
        assert isinstance(data["count"], int)

    @pytest.mark.asyncio
    async def test_audit_log_reverse_sorted_with_seed(self):
        # Seed a community user with moderation history
        uid = f"user_TEST_{uuid.uuid4().hex[:8]}"
        email = f"TEST_audit_{uuid.uuid4().hex[:6]}@example.com"
        history = [
            {"by": "team@craftersmarket.org", "at": "2026-01-01T10:00:00+00:00",
             "from": "active", "to": "frozen", "reason": "TEST_first"},
            {"by": "team@craftersmarket.org", "at": "2026-01-02T10:00:00+00:00",
             "from": "frozen", "to": "banned", "reason": "TEST_second"},
        ]
        await db.community_users.insert_one({
            "user_id": uid, "email": email, "name": "TEST audit user",
            "moderation_status": "banned",
            "moderation_history": history, "created_at": now_iso(),
        })
        try:
            r = requests.get(f"{BASE_URL}/api/admin/audit-log?limit=500", headers=ADMIN_HEADERS, timeout=15)
            assert r.status_code == 200
            items = r.json()["items"]
            mine = [it for it in items if it.get("user_id") == uid]
            assert len(mine) == 2
            # reverse-sort: newest first
            assert mine[0]["at"] > mine[1]["at"]
            assert mine[0]["to"] == "banned"
            assert mine[0]["reason"] == "TEST_second"
            assert mine[0]["user_email"] == email
        finally:
            await db.community_users.delete_one({"user_id": uid})


# --- chat_cleanup ISO parsing ---
class TestChatCleanupParsing:
    def test_parse_iso_z_suffix(self):
        dt = _parse_iso("2026-01-15T12:00:00Z")
        assert dt is not None and dt.tzinfo is not None

    def test_parse_iso_offset(self):
        dt = _parse_iso("2026-01-15T12:00:00+00:00")
        assert dt is not None and dt.tzinfo is not None

    def test_parse_iso_naive_assumed_utc(self):
        dt = _parse_iso("2026-01-15T12:00:00")
        assert dt is not None and dt.tzinfo is not None

    def test_parse_iso_invalid_returns_none(self):
        assert _parse_iso("not-a-date") is None
        assert _parse_iso(None) is None
        assert _parse_iso("") is None

    def test_clear_idle_function_shape(self):
        """Validated via the HTTP endpoint test below — the in-process db client
        is bound to the FastAPI loop and not directly callable from pytest."""
        pytest.skip("covered by test_clear_idle_endpoint_returns_shape")

    def test_clear_idle_endpoint_admin_only(self):
        r = requests.post(f"{BASE_URL}/api/admin/chat/clear-idle?minutes=60", timeout=15)
        assert r.status_code in (401, 403)

    def test_clear_idle_endpoint_returns_shape(self):
        r = requests.post(
            f"{BASE_URL}/api/admin/chat/clear-idle?minutes=60",
            headers=ADMIN_HEADERS, timeout=15,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "idle_minutes" in data
        assert "cleared" in data
        assert "total_deleted" in data


# --- Regression: settings/applications/maintenance still work ---
class TestRegression:
    def test_public_settings(self):
        r = requests.get(f"{BASE_URL}/api/settings", timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert "maintenance_mode" in d

    def test_admin_me(self):
        r = requests.get(f"{BASE_URL}/api/admin/me", headers=ADMIN_HEADERS, timeout=15)
        assert r.status_code == 200

    def test_forum_categories(self):
        r = requests.get(f"{BASE_URL}/api/community/forum/categories", timeout=15)
        assert r.status_code == 200
        assert "categories" in r.json()
