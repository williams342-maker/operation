"""Regression: social auto-post eligibility + queue (iter271).

Covers:
  1. Eligibility decision tree (inaugural founder → founder → plus → none)
  2. `enqueue_listing` dedup behavior
  3. End-to-end: maker publishes a listing → queue row inserted iff eligible
  4. Admin endpoints (mark-published, skip, eligibility-counts)
"""
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from core import db
from social_auto_post_service import eligibility_for, enqueue_listing


API = "http://localhost:8001"
TEST_MAKER_SLUG = "_pytest_social_maker"
TEST_PRODUCT_SLUG = "_pytest_social_product"
TEST_PRODUCT_ID = "_pytest_social_pid"


async def _cleanup():
    await db.makers.delete_many({"slug": TEST_MAKER_SLUG})
    await db.products.delete_many({"slug": TEST_PRODUCT_SLUG})
    await db.social_auto_post_queue.delete_many({"maker_slug": TEST_MAKER_SLUG})


async def _seed_maker(*, tier: str = "free",
                     founder_status: str = None,
                     founder_expires_at: str = None,
                     subscription_status: str = "free"):
    await db.makers.update_one(
        {"slug": TEST_MAKER_SLUG},
        {"$set": {
            "slug": TEST_MAKER_SLUG, "name": "Test Maker",
            "tier": tier, "founder_status": founder_status,
            "founder_expires_at": founder_expires_at,
            "subscription_status": subscription_status,
            "deleted_at": None,
        }},
        upsert=True,
    )


async def _seed_product():
    await db.products.update_one(
        {"slug": TEST_PRODUCT_SLUG},
        {"$set": {
            "id": TEST_PRODUCT_ID, "slug": TEST_PRODUCT_SLUG,
            "title": "Walnut Box", "price": 49.0,
            "maker_slug": TEST_MAKER_SLUG, "status": "published",
            "deleted_at": None, "in_stock": 5,
            "images": ["https://cdn.example.com/walnut.jpg"],
        }},
        upsert=True,
    )


# ───── 1. Pure eligibility decision tree ─────
def test_eligibility_inaugural_founder():
    m = {"tier": "founder", "founder_status": "inaugural"}
    e = eligibility_for(m)
    assert e["eligible"] is True
    assert e["tier"] == "inaugural_founder"
    assert e["upsell"] is None


def test_eligibility_regular_founder_active():
    """Regular founder with future founder_expires_at → eligible."""
    future = (datetime.now(timezone.utc) + timedelta(days=180)).isoformat().replace("+00:00", "Z")
    e = eligibility_for({"tier": "founder", "founder_status": "regular",
                         "founder_expires_at": future})
    assert e["eligible"] is True
    assert e["tier"] == "founder"


def test_eligibility_regular_founder_expired_falls_through():
    """Expired regular founder is NOT eligible (unless they also have Plus)."""
    past = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat().replace("+00:00", "Z")
    e = eligibility_for({"tier": "founder", "founder_status": "regular",
                         "founder_expires_at": past})
    assert e["eligible"] is False
    assert e["tier"] == "none"


def test_eligibility_plus_active():
    e = eligibility_for({"tier": "standard", "subscription_status": "active"})
    assert e["eligible"] is True
    assert e["tier"] == "plus"


def test_eligibility_free_maker_sees_upsell():
    e = eligibility_for({"tier": "standard", "subscription_status": "free"})
    assert e["eligible"] is False
    assert e["tier"] == "none"
    assert "Founder" in (e["upsell"] or "") and "$12" in (e["upsell"] or "")


def test_eligibility_handles_none():
    e = eligibility_for(None)
    assert e["eligible"] is False
    assert e["tier"] == "none"


# ───── 2. enqueue_listing ─────
@pytest.mark.asyncio
async def test_enqueue_skipped_for_ineligible_maker():
    await _cleanup()
    await _seed_maker(tier="standard", subscription_status="free")
    await _seed_product()
    r = await enqueue_listing(TEST_PRODUCT_SLUG)
    assert r["queued"] is False
    assert r["reason"] == "not_eligible"
    n = await db.social_auto_post_queue.count_documents(
        {"maker_slug": TEST_MAKER_SLUG})
    assert n == 0
    await _cleanup()


@pytest.mark.asyncio
async def test_enqueue_succeeds_for_inaugural_founder():
    await _cleanup()
    await _seed_maker(tier="founder", founder_status="inaugural")
    await _seed_product()
    r = await enqueue_listing(TEST_PRODUCT_SLUG)
    assert r["queued"] is True
    assert r["tier"] == "inaugural_founder"
    row = await db.social_auto_post_queue.find_one(
        {"id": r["id"]}, {"_id": 0})
    assert row["status"] == "pending"
    assert row["product_title"] == "Walnut Box"
    assert row["image_url"].startswith("https://")
    assert set(row["channels"]) >= {"instagram", "pinterest", "facebook"}
    await _cleanup()


@pytest.mark.asyncio
async def test_enqueue_is_idempotent():
    """Calling twice for the same pending slug only creates one row."""
    await _cleanup()
    await _seed_maker(tier="standard", subscription_status="active")  # Plus
    await _seed_product()
    r1 = await enqueue_listing(TEST_PRODUCT_SLUG)
    r2 = await enqueue_listing(TEST_PRODUCT_SLUG)
    assert r1["queued"] is True
    assert r2["queued"] is False
    assert r2["reason"] == "already_queued"
    assert r2["id"] == r1["id"]
    n = await db.social_auto_post_queue.count_documents(
        {"maker_slug": TEST_MAKER_SLUG})
    assert n == 1
    await _cleanup()


@pytest.mark.asyncio
async def test_enqueue_re_queues_after_admin_marks_published():
    """If admin marks the previous queue row as published and the
    maker re-publishes (e.g. price change), a NEW queue row should
    appear — only `pending` rows block re-queue."""
    await _cleanup()
    await _seed_maker(tier="founder", founder_status="inaugural")
    await _seed_product()
    r1 = await enqueue_listing(TEST_PRODUCT_SLUG)
    await db.social_auto_post_queue.update_one(
        {"id": r1["id"]}, {"$set": {"status": "published"}})
    r2 = await enqueue_listing(TEST_PRODUCT_SLUG)
    assert r2["queued"] is True
    assert r2["id"] != r1["id"]
    await _cleanup()


# ───── 3. End-to-end through listing_notify ─────
@pytest.mark.asyncio
async def test_listing_publish_hook_queues_for_eligible_maker():
    """notify_listing_published should fire enqueue_listing for Plus makers."""
    from listing_notify import notify_listing_published
    await _cleanup()
    await _seed_maker(tier="standard", subscription_status="active")
    await _seed_product()
    with patch("email_service.send_maker_listing_published",
               new_callable=AsyncMock), \
         patch("email_service.send_ops_new_listing",
               new_callable=AsyncMock):
        r = await notify_listing_published(TEST_PRODUCT_SLUG)
    assert r["sent"] is True
    # The queue row should be there
    n = await db.social_auto_post_queue.count_documents(
        {"product_slug": TEST_PRODUCT_SLUG, "status": "pending"})
    assert n == 1
    await _cleanup()


@pytest.mark.asyncio
async def test_listing_publish_hook_does_NOT_queue_for_free_maker():
    from listing_notify import notify_listing_published
    await _cleanup()
    await _seed_maker(tier="standard", subscription_status="free")
    await _seed_product()
    with patch("email_service.send_maker_listing_published",
               new_callable=AsyncMock), \
         patch("email_service.send_ops_new_listing",
               new_callable=AsyncMock):
        r = await notify_listing_published(TEST_PRODUCT_SLUG)
    assert r["sent"] is True
    n = await db.social_auto_post_queue.count_documents(
        {"product_slug": TEST_PRODUCT_SLUG})
    assert n == 0, "Free-tier makers must NOT be auto-queued."
    await _cleanup()


# ───── 4. Admin endpoints ─────
@pytest.mark.asyncio
async def test_admin_endpoints_require_auth():
    """Admin queue + mutate routes are JWT-gated."""
    async with httpx.AsyncClient(timeout=10) as c:
        for path in [
            "/api/admin/social-auto-post/queue",
            "/api/admin/social-auto-post/some-id/mark-published",
            "/api/admin/social-auto-post/some-id/skip",
            "/api/admin/social-auto-post/eligibility-counts",
        ]:
            method = "POST" if "mark" in path or "skip" in path else "GET"
            r = await c.request(method, f"{API}{path}")
            assert r.status_code in (401, 403), f"{method} {path} → {r.status_code}"
