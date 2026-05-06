"""Smoke tests for the buyer push notifier (`notify_buyer_push`).

Replaces the deprecated SMS delivery nudge — verifies that:
  - Without VAPID configured, the helper no-ops cleanly.
  - With no matching subscription, the helper no-ops cleanly.
  - With a (mock-failing) subscription, the helper attempts a send and
    cleans up dead endpoints.
"""
import os
import sys
import asyncio
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from core import db  # noqa: E402
from routers.push import notify_buyer_push  # noqa: E402


TEST_EMAIL = "test-buyer-push@example.com"


async def _seed_sub():
    await db.push_subscriptions.delete_many({"email": TEST_EMAIL})
    await db.push_subscriptions.insert_one({
        "id": "test-sub-1",
        "endpoint": "https://example.test/push/test-buyer",
        "p256dh": "BMOCK_p256dh",
        "auth": "BMOCK_auth",
        "email": TEST_EMAIL,
        "role": "buyer",
        "created_at": "2026-05-06T00:00:00+00:00",
        "updated_at": "2026-05-06T00:00:00+00:00",
    })


async def _cleanup():
    await db.push_subscriptions.delete_many({"email": TEST_EMAIL})


def test_no_vapid_configured_returns_skip():
    async def go():
        with patch("routers.push.VAPID_PRIVATE_PEM", ""):
            r = await notify_buyer_push(TEST_EMAIL, "T", "B")
            assert r == {"sent": 0, "total": 0, "pruned": 0, "skipped": "vapid_missing"}
    asyncio.run(go())


def test_no_email_returns_skip():
    async def go():
        with patch("routers.push.VAPID_PRIVATE_PEM", "fake-vapid-key"):
            r = await notify_buyer_push("", "T", "B")
            assert r == {"sent": 0, "total": 0, "pruned": 0, "skipped": "no_email"}
    asyncio.run(go())


def test_no_subscriptions_for_email_returns_skip():
    async def go():
        with patch("routers.push.VAPID_PRIVATE_PEM", "fake-vapid-key"):
            r = await notify_buyer_push("nobody-here@example.com", "T", "B")
            assert r == {"sent": 0, "total": 0, "pruned": 0, "skipped": "no_subs"}
    asyncio.run(go())


def test_send_failure_prunes_dead_endpoints():
    async def go():
        await _seed_sub()
        # Simulate a 410 Gone from the push service → endpoint should be pruned
        def fake_send_one(_sub, _payload):
            return False, "WebPushException:410:Gone"
        with patch("routers.push.VAPID_PRIVATE_PEM", "fake-vapid-key"), \
             patch("routers.push._send_one", side_effect=fake_send_one):
            r = await notify_buyer_push(TEST_EMAIL, "Title", "Body", url="/x")
            assert r["total"] == 1
            assert r["sent"] == 0
            assert r["pruned"] == 1

        # Verify the row was actually deleted
        leftover = await db.push_subscriptions.count_documents({"email": TEST_EMAIL})
        assert leftover == 0
        await _cleanup()
    asyncio.run(go())
