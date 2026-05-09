"""Tests for the community-upload boost-credit reward.

Covers:
  - `grant_weekly_boost_credit` is idempotent within an ISO week.
  - `grant_weekly_boost_credit` no-ops for unknown maker_slugs.
  - `GET /api/maker/boost-credits` returns unredeemed/unexpired credits.
  - `POST /api/maker/boost-credits/{id}/redeem` extends `promoted_until`
    by 24 hours and stamps `consumed_at`.
"""
import os
import sys
import asyncio
from datetime import datetime, timedelta, timezone

import httpx

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from core import db  # noqa: E402
from maker_auth import issue_session_jwt  # noqa: E402
from routers.community import grant_weekly_boost_credit  # noqa: E402

API = "http://localhost:8001"
TEST_SLUG = "test-credits-maker"


async def _seed_maker():
    await db.makers.delete_one({"slug": TEST_SLUG})
    await db.makers.insert_one({
        "id": f"id-{TEST_SLUG}",
        "slug": TEST_SLUG,
        "name": "Test Credits Maker",
        "initials": "TC",
        "subscription_status": "free",
    })


async def _seed_published_product(slug: str):
    await db.products.delete_one({"slug": slug})
    await db.products.insert_one({
        "id": f"id-{slug}",
        "slug": slug,
        "title": f"{slug} title",
        "maker_slug": TEST_SLUG,
        "category": "wall-art",
        "technique": "PLASMA",
        "price": 99,
        "status": "published",
        "deleted_at": None,
    })


async def _cleanup():
    await db.makers.delete_one({"slug": TEST_SLUG})
    await db.products.delete_many({"maker_slug": TEST_SLUG})
    await db.community_boost_credits.delete_many({"maker_slug": TEST_SLUG})


def test_grant_idempotent_within_iso_week():
    async def go():
        await _seed_maker()
        await db.community_boost_credits.delete_many({"maker_slug": TEST_SLUG})
        first = await grant_weekly_boost_credit(TEST_SLUG)
        assert first is not None
        second = await grant_weekly_boost_credit(TEST_SLUG)
        assert second is None, "second grant within same week must be a no-op"
        n = await db.community_boost_credits.count_documents({"maker_slug": TEST_SLUG})
        assert n == 1
        await _cleanup()
    asyncio.run(go())


def test_grant_unknown_maker_returns_none():
    async def go():
        r = await grant_weekly_boost_credit("does-not-exist-slug")
        assert r is None
    asyncio.run(go())


def test_redeem_extends_promoted_until_and_consumes_credit():
    async def go():
        await _seed_maker()
        await _seed_published_product("test-cred-prod")
        await db.community_boost_credits.delete_many({"maker_slug": TEST_SLUG})
        credit = await grant_weekly_boost_credit(TEST_SLUG)
        assert credit is not None

        tok = issue_session_jwt(TEST_SLUG, f"{TEST_SLUG}@example.com")
        async with httpx.AsyncClient(timeout=10) as c:
            # List credits → should have 1 available
            r = await c.get(
                f"{API}/api/maker/boost-credits",
                headers={"Authorization": f"Bearer {tok}"},
            )
            r.raise_for_status()
            assert r.json()["available"] == 1

            # Redeem against our test product
            r2 = await c.post(
                f"{API}/api/maker/boost-credits/{credit['id']}/redeem",
                json={"product_slug": "test-cred-prod"},
                headers={"Authorization": f"Bearer {tok}"},
            )
            r2.raise_for_status()
            data = r2.json()
            # promoted_until should be ~24h in the future
            until = datetime.fromisoformat(data["promoted_until"].replace("Z", "+00:00"))
            now = datetime.now(timezone.utc)
            delta = until - now
            assert timedelta(hours=23) < delta < timedelta(hours=25), (
                f"expected ~24h boost, got {delta}"
            )

            # Listing now reports 0 credits available
            r3 = await c.get(
                f"{API}/api/maker/boost-credits",
                headers={"Authorization": f"Bearer {tok}"},
            )
            r3.raise_for_status()
            assert r3.json()["available"] == 0
            assert r3.json()["lifetime_earned"] == 1

            # Re-redemption fails (already consumed)
            r4 = await c.post(
                f"{API}/api/maker/boost-credits/{credit['id']}/redeem",
                json={"product_slug": "test-cred-prod"},
                headers={"Authorization": f"Bearer {tok}"},
            )
            assert r4.status_code == 404

        await _cleanup()
    asyncio.run(go())


def test_redeem_rejects_unowned_listing():
    async def go():
        await _seed_maker()
        # Different maker owns the listing
        await db.products.delete_one({"slug": "test-cred-other"})
        await db.products.insert_one({
            "id": "id-other", "slug": "test-cred-other", "title": "Not yours",
            "maker_slug": "someone-else", "category": "wall-art",
            "technique": "PLASMA", "price": 49, "status": "published",
            "deleted_at": None,
        })
        await db.community_boost_credits.delete_many({"maker_slug": TEST_SLUG})
        credit = await grant_weekly_boost_credit(TEST_SLUG)

        tok = issue_session_jwt(TEST_SLUG, f"{TEST_SLUG}@example.com")
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.post(
                f"{API}/api/maker/boost-credits/{credit['id']}/redeem",
                json={"product_slug": "test-cred-other"},
                headers={"Authorization": f"Bearer {tok}"},
            )
            assert r.status_code == 404
        # Credit must still be unconsumed since the redemption failed
        c_doc = await db.community_boost_credits.find_one({"id": credit["id"]}, {"_id": 0})
        assert c_doc.get("consumed_at") is None
        await db.products.delete_one({"slug": "test-cred-other"})
        await _cleanup()
    asyncio.run(go())
