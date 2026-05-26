"""iter233 — Admin "Reply as Workshop Team" quick-action.

POST /api/admin/forum/threads/{thread_id}/team-reply
  - Admin JWT required (403 for buyer/maker/anonymous)
  - Posts with user_name = "Crafters Market Workshop Team"
  - Tagged is_team_reply: true + posted_by_admin: <admin sub>
  - Increments thread reply_count and bumps last_activity_at

All assertions live in one test to avoid the Motor "Event loop is closed"
recurrence noted in the handoff — pytest-asyncio mints a fresh loop per
test, and module-level db imports get bound to the first loop.
"""
import os
import sys
import uuid
from datetime import datetime, timezone

import httpx
import pytest

sys.path.insert(0, "/app/backend")

API = os.environ.get("REACT_APP_BACKEND_URL")
if not API:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                API = line.split("=", 1)[1].strip()
                break


@pytest.mark.asyncio
async def test_admin_team_reply_full_flow():
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    from core import db
    from maker_auth import issue_admin_magic_token

    # 1. Mint admin JWT
    magic = issue_admin_magic_token("team@craftersmarket.org")
    async with httpx.AsyncClient(timeout=10) as c:
        v = await c.post(f"{API}/api/admin/auth/verify", json={"token": magic})
        assert v.status_code == 200, v.text
        jwt = v.json()["token"]

        # 2. Seed an empty fixture thread directly
        tid = "t-" + uuid.uuid4().hex[:10]
        await db.forum_threads.insert_one({
            "id": tid,
            "title": "Pytest fixture — team reply test",
            "body": "Testing the admin team-reply quick action.",
            "tag": "general",
            "category": "general",
            "user_id": "pytest-fixture",
            "user_email": "pytest@craftersmarket.org",
            "user_name": "Pytest Fixture",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "reply_count": 0,
            "is_test_fixture": True,
        })
        try:
            # 3. Anonymous → blocked
            r = await c.post(
                f"{API}/api/admin/forum/threads/{tid}/team-reply",
                json={"body": "no auth attempt", "attachments": []},
            )
            assert r.status_code in (401, 403), r.text

            # 4. Empty body → 400
            r = await c.post(
                f"{API}/api/admin/forum/threads/{tid}/team-reply",
                json={"body": "   ", "attachments": []},
                headers={"Authorization": f"Bearer {jwt}"},
            )
            assert r.status_code == 400, r.text

            # 5. Happy path
            r = await c.post(
                f"{API}/api/admin/forum/threads/{tid}/team-reply",
                json={"body": "Verified team reply for pytest.", "attachments": []},
                headers={"Authorization": f"Bearer {jwt}"},
            )
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["user_name"] == "Crafters Market Workshop Team"
            assert body["user_email"] == "workshop@craftersmarket.org"
            assert body["is_team_reply"] is True
            assert body["thread_id"] == tid

            # 6. Thread reply_count bumped + last_activity_at set
            fetched = await c.get(f"{API}/api/community/forum/{tid}")
            assert fetched.status_code == 200
            thread = fetched.json()["thread"]
            assert thread["reply_count"] == 1
            assert thread.get("last_activity_at"), "expected last_activity_at"
        finally:
            await db.forum_threads.delete_one({"id": tid})
            await db.forum_replies.delete_many({"thread_id": tid})
