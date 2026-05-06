"""Tests for the abandoned-cart re-engagement push.

Covers:
  - `track_cart` no-ops for anonymous users (no auth + no push endpoint).
  - `track_cart` upserts the row when the buyer has a push subscription.
  - `track_cart` clears the row when the cart goes empty.
  - `mark_checked_out` stamps `checked_out_at` so the push won't fire.
  - `fire_abandoned_cart_pushes` only targets carts older than the
    idle window AND not yet pushed AND not checked out, and it stamps
    `last_push_at` so it doesn't double-fire.
"""
import os
import sys
import asyncio
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import httpx

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from core import db  # noqa: E402
from routers.abandoned_cart import (  # noqa: E402
    fire_abandoned_cart_pushes, mark_checked_out,
)


API = "http://localhost:8001"
TEST_EMAIL = "test-abandoned@example.com"
TEST_ENDPOINT = "https://example.test/push/abandoned-test"


async def _seed_push_sub():
    await db.push_subscriptions.delete_many({"email": TEST_EMAIL})
    await db.push_subscriptions.insert_one({
        "id": "test-abandoned-sub",
        "endpoint": TEST_ENDPOINT,
        "p256dh": "BMOCK_p256dh",
        "auth": "BMOCK_auth",
        "email": TEST_EMAIL,
        "role": "buyer",
        "created_at": "2026-05-06T00:00:00+00:00",
        "updated_at": "2026-05-06T00:00:00+00:00",
    })


async def _cleanup():
    await db.push_subscriptions.delete_many({"email": TEST_EMAIL})
    await db.abandoned_carts.delete_many({"email": TEST_EMAIL})


# ─────────────────── HTTP track endpoint ───────────────────
def test_track_cart_noop_when_anonymous():
    async def go():
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.post(f"{API}/api/cart/track", json={"items": [{"id": "x", "title": "T", "price": 1}]})
            r.raise_for_status()
            data = r.json()
            assert data["ok"] is True
            assert data["tracked"] is False
            assert data["reason"] == "no_email"
    asyncio.run(go())


def test_track_cart_upserts_with_push_endpoint():
    async def go():
        await _seed_push_sub()
        async with httpx.AsyncClient(timeout=10) as c:
            payload = {"items": [
                {"id": "p1", "slug": "test-prod", "title": "Test prod", "price": 19.99, "quantity": 2},
            ]}
            r = await c.post(
                f"{API}/api/cart/track",
                json=payload,
                headers={"X-Push-Endpoint": TEST_ENDPOINT},
            )
            r.raise_for_status()
            data = r.json()
            assert data["tracked"] is True
            assert data["items"] == 1
        row = await db.abandoned_carts.find_one({"email": TEST_EMAIL}, {"_id": 0})
        assert row is not None
        assert len(row["items"]) == 1
        assert row["items"][0]["title"] == "Test prod"
        await _cleanup()
    asyncio.run(go())


def test_track_cart_empty_clears_row():
    async def go():
        await _seed_push_sub()
        # Seed an existing row first
        await db.abandoned_carts.insert_one({
            "email": TEST_EMAIL,
            "items": [{"id": "p1", "title": "Old", "price": 9.99}],
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.post(
                f"{API}/api/cart/track",
                json={"items": []},
                headers={"X-Push-Endpoint": TEST_ENDPOINT},
            )
            r.raise_for_status()
            data = r.json()
            assert data["cleared"] is True
        assert await db.abandoned_carts.count_documents({"email": TEST_EMAIL}) == 0
        await _cleanup()
    asyncio.run(go())


# ─────────────────── mark_checked_out ───────────────────
def test_mark_checked_out_stamps_field():
    async def go():
        await db.abandoned_carts.delete_many({"email": TEST_EMAIL})
        await db.abandoned_carts.insert_one({
            "email": TEST_EMAIL,
            "items": [{"id": "p", "title": "x", "price": 5}],
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })
        await mark_checked_out(TEST_EMAIL)
        row = await db.abandoned_carts.find_one({"email": TEST_EMAIL}, {"_id": 0})
        assert row.get("checked_out_at"), "checked_out_at must be stamped"
        await db.abandoned_carts.delete_many({"email": TEST_EMAIL})
    asyncio.run(go())


# ─────────────────── scheduler entrypoint ───────────────────
def _stale_cart_doc(email, items, hours_old, **extras):
    return {
        "email": email,
        "items": items,
        "updated_at": (datetime.now(timezone.utc) - timedelta(hours=hours_old)).isoformat(),
        **extras,
    }


def test_fire_pushes_only_stale_unsent_unchecked_out():
    async def go():
        await db.abandoned_carts.delete_many({"email": {"$regex": "^test-fire-"}})
        items = [{"id": "p1", "title": "Walnut sign", "price": 89, "quantity": 1}]
        # 1) Stale, unsent, not checked out  → SHOULD push
        await db.abandoned_carts.insert_one(_stale_cart_doc("test-fire-stale@example.com", items, hours_old=12))
        # 2) Fresh → SHOULD NOT push
        await db.abandoned_carts.insert_one(_stale_cart_doc("test-fire-fresh@example.com", items, hours_old=2))
        # 3) Stale but already pushed → SHOULD NOT push
        await db.abandoned_carts.insert_one(_stale_cart_doc(
            "test-fire-pushed@example.com", items, hours_old=20,
            last_push_at=datetime.now(timezone.utc).isoformat(),
        ))
        # 4) Stale but checked out → SHOULD NOT push
        await db.abandoned_carts.insert_one(_stale_cart_doc(
            "test-fire-paid@example.com", items, hours_old=20,
            checked_out_at=datetime.now(timezone.utc).isoformat(),
        ))

        # Patch notify_buyer_push to avoid touching VAPID/push gateway.
        # Track which emails got pushed.
        pushed = []

        async def fake_notify(email, title, body, url="/", tag="", icon=None):
            pushed.append(email)
            return {"sent": 1, "total": 1, "pruned": 0}

        with patch("routers.abandoned_cart.notify_buyer_push", side_effect=fake_notify):
            r = await fire_abandoned_cart_pushes(idle_hours=6)

        assert "test-fire-stale@example.com" in pushed
        assert "test-fire-fresh@example.com" not in pushed
        assert "test-fire-pushed@example.com" not in pushed
        assert "test-fire-paid@example.com" not in pushed
        assert r["sent"] == 1

        # last_push_at stamped on the stale row → second sweep is a no-op
        stale_after = await db.abandoned_carts.find_one(
            {"email": "test-fire-stale@example.com"}, {"_id": 0},
        )
        assert stale_after.get("last_push_at"), "last_push_at must be stamped"
        with patch("routers.abandoned_cart.notify_buyer_push", side_effect=fake_notify):
            r2 = await fire_abandoned_cart_pushes(idle_hours=6)
        assert r2["sent"] == 0, "second sweep must not double-fire"

        await db.abandoned_carts.delete_many({"email": {"$regex": "^test-fire-"}})
    asyncio.run(go())
