"""Iteration 29 — chat moderation + scheduled site-switch backend tests.

Covers:
- PATCH /api/admin/settings with maintenance_scheduled_on/off (set + clear)
- Scheduler `_job_apply_scheduled_toggles` flips maintenance_mode + clears the field
- Admin chat messages: GET (auth required) + DELETE (404 path)
- Per-channel mutes: POST (idempotent) + GET + DELETE (404 path)
- WebSocket mute lookup: db.chat_mutes structure compatible with router gate
"""
import asyncio
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests

sys.path.insert(0, "/app/backend")

from dotenv import load_dotenv  # noqa: E402
load_dotenv("/app/backend/.env")

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/") or \
    open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split("\n")[0].strip()


@pytest.fixture(scope="module")
def admin_headers():
    from maker_auth import issue_admin_magic_token
    tok = issue_admin_magic_token("team@craftersmarket.org")
    r = requests.post(f"{BASE_URL}/api/admin/auth/verify", json={"token": tok}, timeout=15)
    assert r.status_code == 200, r.text
    jwt = r.json()["token"]
    return {"Authorization": f"Bearer {jwt}", "Content-Type": "application/json"}


# ---------------- Maintenance schedule PATCH ----------------
class TestMaintenanceSchedule:
    def test_patch_set_and_clear_scheduled_fields(self, admin_headers):
        future = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
        r = requests.patch(
            f"{BASE_URL}/api/admin/settings",
            headers=admin_headers,
            json={"maintenance_scheduled_on": future, "maintenance_scheduled_off": future},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["maintenance_scheduled_on"] == future
        assert body["maintenance_scheduled_off"] == future

        # Clear with empty string
        r2 = requests.patch(
            f"{BASE_URL}/api/admin/settings",
            headers=admin_headers,
            json={"maintenance_scheduled_on": "", "maintenance_scheduled_off": ""},
            timeout=15,
        )
        assert r2.status_code == 200, r2.text
        b2 = r2.json()
        assert b2["maintenance_scheduled_on"] is None
        assert b2["maintenance_scheduled_off"] is None


# ---------------- Scheduler job: integration test directly ----------------
class TestScheduledTogglesJob:
    def test_past_scheduled_on_flips_and_clears(self, admin_headers):
        """Set maintenance_scheduled_on to a past time, run the job once,
        verify maintenance_mode flipped to True and field cleared."""
        async def run():
            from core import db
            past = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
            await db.site_settings.update_one(
                {"_id": "global"},
                {"$set": {
                    "maintenance_scheduled_on": past,
                    "maintenance_mode": False,
                }},
                upsert=True,
            )
            from scheduler import _job_apply_scheduled_toggles
            await _job_apply_scheduled_toggles()
            doc = await db.site_settings.find_one({"_id": "global"})
            return doc

        doc = asyncio.run(run())
        assert doc["maintenance_mode"] is True
        assert doc["maintenance_scheduled_on"] is None

        # Cleanup: turn it back off
        requests.patch(
            f"{BASE_URL}/api/admin/settings",
            headers=admin_headers,
            json={"maintenance_mode": False},
            timeout=15,
        )


# ---------------- Admin chat messages ----------------
class TestAdminChatMessages:
    def test_get_messages_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/admin/chat/messages?channel=general", timeout=10)
        assert r.status_code in (401, 403)

    def test_get_messages_admin_ok(self, admin_headers):
        r = requests.get(
            f"{BASE_URL}/api/admin/chat/messages?channel=general",
            headers=admin_headers, timeout=15,
        )
        assert r.status_code == 200
        body = r.json()
        assert body["channel"] == "general"
        assert isinstance(body["items"], list)

    def test_delete_unknown_message_404(self, admin_headers):
        r = requests.delete(
            f"{BASE_URL}/api/admin/chat/messages/{uuid.uuid4()}",
            headers=admin_headers, timeout=10,
        )
        assert r.status_code == 404

    def test_delete_real_message_then_verify_gone(self, admin_headers):
        # Use sync pymongo to avoid motor event-loop reuse issues across pytest runs
        from pymongo import MongoClient
        from datetime import datetime, timezone
        client = MongoClient(os.environ["MONGO_URL"])
        db_sync = client[os.environ["DB_NAME"]]
        mid = str(uuid.uuid4())
        db_sync.chat_messages.insert_one({
            "id": mid, "channel": "general",
            "user_email": "test_chatmod@example.com",
            "user_name": "TEST", "text": "hello", "kind": "message",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        r = requests.delete(
            f"{BASE_URL}/api/admin/chat/messages/{mid}",
            headers=admin_headers, timeout=10,
        )
        assert r.status_code == 200
        assert r.json()["deleted"] is True
        # Should now 404
        r2 = requests.delete(
            f"{BASE_URL}/api/admin/chat/messages/{mid}",
            headers=admin_headers, timeout=10,
        )
        assert r2.status_code == 404


# ---------------- Per-channel mutes ----------------
class TestChatMutes:
    test_email = "test_mute@example.com"
    test_channel = "general"

    def test_create_list_and_idempotent(self, admin_headers):
        # Create
        r = requests.post(
            f"{BASE_URL}/api/admin/chat/mute",
            headers=admin_headers,
            json={"user_email": self.test_email, "channel": self.test_channel,
                  "minutes": 30, "reason": "TEST_first"},
            timeout=10,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["user_email"] == self.test_email
        assert body["channel"] == self.test_channel
        assert body["expires_at"] is not None
        assert body["reason"] == "TEST_first"

        # Idempotent — second call updates
        r2 = requests.post(
            f"{BASE_URL}/api/admin/chat/mute",
            headers=admin_headers,
            json={"user_email": self.test_email, "channel": self.test_channel,
                  "reason": "TEST_updated"},
            timeout=10,
        )
        assert r2.status_code == 200
        assert r2.json()["reason"] == "TEST_updated"
        assert r2.json()["expires_at"] is None  # no minutes => indefinite

        # List
        rl = requests.get(f"{BASE_URL}/api/admin/chat/mutes", headers=admin_headers, timeout=10)
        assert rl.status_code == 200
        items = rl.json()["items"]
        match = [m for m in items if m["user_email"] == self.test_email and m["channel"] == self.test_channel]
        assert len(match) == 1
        assert match[0]["reason"] == "TEST_updated"

    def test_unmute_and_404_after(self, admin_headers):
        r = requests.delete(
            f"{BASE_URL}/api/admin/chat/mute/{self.test_email}/{self.test_channel}",
            headers=admin_headers, timeout=10,
        )
        assert r.status_code == 200
        assert r.json()["unmuted"] is True

        r2 = requests.delete(
            f"{BASE_URL}/api/admin/chat/mute/{self.test_email}/{self.test_channel}",
            headers=admin_headers, timeout=10,
        )
        assert r2.status_code == 404

    def test_ws_mute_lookup_structure(self, admin_headers):
        """Spot-check the Mongo lookup the WS gate uses works for per-channel scope."""
        from pymongo import MongoClient
        client = MongoClient(os.environ["MONGO_URL"])
        db_sync = client[os.environ["DB_NAME"]]
        email = "test_wslookup@example.com"
        requests.post(
            f"{BASE_URL}/api/admin/chat/mute",
            headers=admin_headers,
            json={"user_email": email, "channel": "general"},
            timeout=10,
        )
        in_general = db_sync.chat_mutes.find_one({"user_email": email, "channel": "general"})
        in_wins = db_sync.chat_mutes.find_one({"user_email": email, "channel": "wins"})
        db_sync.chat_mutes.delete_many({"user_email": email})
        assert in_general is not None, "Mute should exist for #general"
        assert in_wins is None, "Mute should NOT bleed into #wins"
