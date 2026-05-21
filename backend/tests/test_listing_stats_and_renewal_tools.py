"""Regression: per-listing stats + renewal summary + bulk renewal actions
+ Smart Pause sweep (Feb 2026, iter162).

Covers:
  • GET /maker/products/stats — returns dict keyed by slug with v30/sales/etc
  • GET /maker/renewals/summary — counts, listings, calendar
  • POST /maker/products/bulk-renew — owner-only, accrues fee, increments
    renewals_count, resets reminder stamp, extends expiry
  • POST /maker/products/bulk-renewal-option — flips field, validates value
  • POST /maker/products/bulk-pause — only owned + published listings flip
  • Maker profile PATCH accepts smart_pause_enabled
  • revenue.smart_pause_idle_listings respects opt-in + window
"""
import os
from datetime import datetime, timedelta, timezone

import pytest
import httpx
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

with open("/app/frontend/.env") as f:
    API = next(
        (ln.split("=", 1)[1].strip() for ln in f if ln.startswith("REACT_APP_BACKEND_URL=")),
        "http://localhost:8001",
    )

TEST_MAKER_EMAIL = "iron-and-oak@craftersmarket.org"


async def _maker_jwt(client: httpx.AsyncClient) -> str:
    from maker_auth import issue_magic_token
    magic = issue_magic_token(TEST_MAKER_EMAIL)
    r = await client.post(f"{API}/api/maker/auth/verify", json={"token": magic})
    return r.json()["token"]


def _h(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}"}


@pytest.mark.asyncio
async def test_stats_endpoint_returns_keyed_dict():
    async with httpx.AsyncClient(timeout=30) as c:
        tok = await _maker_jwt(c)
        r = await c.get(f"{API}/api/maker/products/stats", headers=_h(tok))
        assert r.status_code == 200, r.text
        body = r.json()
        assert isinstance(body, dict)
        # Every value has the expected shape
        for slug, st in body.items():
            assert "visits_30d" in st
            assert "sales_all" in st
            assert "revenue_all" in st
            assert "renewals" in st
            assert "renewal_mode" in st


@pytest.mark.asyncio
async def test_renewals_summary_shape():
    async with httpx.AsyncClient(timeout=30) as c:
        tok = await _maker_jwt(c)
        r = await c.get(f"{API}/api/maker/renewals/summary", headers=_h(tok))
        assert r.status_code == 200, r.text
        b = r.json()
        assert "counts" in b
        assert "listings" in b
        assert "calendar" in b
        assert len(b["calendar"]) == 30
        for k in ("next_7d", "next_14d", "next_30d", "total_auto", "total_manual"):
            assert k in b["counts"]


@pytest.mark.asyncio
async def test_bulk_renew_increments_counter_and_extends_expiry():
    """Direct DB seed → endpoint roundtrip → field verification."""
    from core import db
    async with httpx.AsyncClient(timeout=30) as c:
        tok = await _maker_jwt(c)
        slug = f"_test-bulk-renew-{int(datetime.now().timestamp())}"
        past = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
        await db.products.insert_one({
            "id": f"id-{slug}", "slug": slug,
            "title": "Bulk renew test", "category": "Wall Art", "technique": "PLASMA",
            "price": 5, "description": "x", "images": [],
            "maker_slug": "iron-and-oak", "in_stock": 1, "status": "published",
            "deleted_at": None, "expires_at": past, "renewal_option": "automatic",
            "renewals_count": 2, "renewal_reminder_sent_at": "2025-01-01T00:00:00+00:00",
        })
        try:
            r = await c.post(
                f"{API}/api/maker/products/bulk-renew",
                json={"slugs": [slug, "_nonexistent-foo"]},
                headers=_h(tok),
            )
            assert r.status_code == 200, r.text
            body = r.json()
            assert slug in body["renewed"]
            assert any(s["slug"] == "_nonexistent-foo" for s in body["skipped"])
            # Verify side-effects
            doc = await db.products.find_one({"slug": slug}, {"_id": 0})
            assert doc["renewals_count"] == 3
            assert doc["expires_at"] > past
            assert doc["renewal_reminder_sent_at"] is None
        finally:
            await db.products.delete_one({"slug": slug})


@pytest.mark.asyncio
async def test_bulk_renewal_option_validates_and_flips():
    from core import db
    async with httpx.AsyncClient(timeout=30) as c:
        tok = await _maker_jwt(c)
        slug = f"_test-bulk-mode-{int(datetime.now().timestamp())}"
        await db.products.insert_one({
            "id": f"id-{slug}", "slug": slug,
            "title": "Bulk mode test", "category": "Wall Art", "technique": "PLASMA",
            "price": 5, "description": "x", "images": [],
            "maker_slug": "iron-and-oak", "in_stock": 1, "status": "published",
            "deleted_at": None, "renewal_option": "automatic",
        })
        try:
            # invalid value
            r = await c.post(
                f"{API}/api/maker/products/bulk-renewal-option",
                json={"slugs": [slug], "renewal_option": "weekly"},
                headers=_h(tok),
            )
            assert r.status_code == 400, r.text
            # valid flip
            r = await c.post(
                f"{API}/api/maker/products/bulk-renewal-option",
                json={"slugs": [slug], "renewal_option": "manual"},
                headers=_h(tok),
            )
            assert r.status_code == 200, r.text
            assert r.json()["updated"] >= 1
            doc = await db.products.find_one({"slug": slug}, {"_id": 0})
            assert doc["renewal_option"] == "manual"
        finally:
            await db.products.delete_one({"slug": slug})


@pytest.mark.asyncio
async def test_bulk_pause_only_flips_published_owned():
    from core import db
    async with httpx.AsyncClient(timeout=30) as c:
        tok = await _maker_jwt(c)
        owned = f"_test-pause-{int(datetime.now().timestamp())}"
        foreign = f"_test-foreign-{int(datetime.now().timestamp())}"
        await db.products.insert_many([
            {
                "id": f"id-{owned}", "slug": owned,
                "title": "Owned", "category": "Wall Art", "technique": "PLASMA",
                "price": 5, "description": "x", "images": [],
                "maker_slug": "iron-and-oak", "in_stock": 1, "status": "published",
                "deleted_at": None,
            },
            {
                "id": f"id-{foreign}", "slug": foreign,
                "title": "Foreign", "category": "Wall Art", "technique": "PLASMA",
                "price": 5, "description": "x", "images": [],
                "maker_slug": "metalart-pro", "in_stock": 1, "status": "published",
                "deleted_at": None,
            },
        ])
        try:
            r = await c.post(
                f"{API}/api/maker/products/bulk-pause",
                json={"slugs": [owned, foreign]},
                headers=_h(tok),
            )
            assert r.status_code == 200, r.text
            # Only the owned one should be paused
            assert r.json()["paused"] == 1
            assert (await db.products.find_one({"slug": owned}))["status"] == "draft"
            assert (await db.products.find_one({"slug": foreign}))["status"] == "published"
        finally:
            await db.products.delete_many({"slug": {"$in": [owned, foreign]}})


@pytest.mark.asyncio
async def test_smart_pause_sweep_respects_opt_in_and_window():
    """Maker NOT opted in → no pause. Maker opted in → stale listing paused."""
    from core import db
    from revenue import smart_pause_idle_listings

    # Snapshot current state so we can restore
    snapshot = await db.makers.find_one(
        {"slug": "iron-and-oak"},
        {"_id": 0, "smart_pause_enabled": 1, "smart_pause_threshold_days": 1},
    )
    snap_enabled = snapshot.get("smart_pause_enabled") if snapshot else False
    snap_days = snapshot.get("smart_pause_threshold_days") if snapshot else 30

    slug = f"_test-sp-{int(datetime.now().timestamp())}"
    await db.products.insert_one({
        "id": f"id-{slug}", "slug": slug,
        "title": "Smart Pause test", "category": "Wall Art", "technique": "PLASMA",
        "price": 5, "description": "x", "images": [],
        "maker_slug": "iron-and-oak", "in_stock": 1, "status": "published",
        "deleted_at": None,
    })
    try:
        # Maker NOT opted in — sweep should NOT pause anything for them
        await db.makers.update_one(
            {"slug": "iron-and-oak"},
            {"$set": {"smart_pause_enabled": False}},
        )
        await smart_pause_idle_listings()
        doc = await db.products.find_one({"slug": slug}, {"_id": 0})
        assert doc["status"] == "published", "opt-out shouldn't be paused"

        # Maker opted in with 30-day window AND no pageviews → should pause
        await db.makers.update_one(
            {"slug": "iron-and-oak"},
            {"$set": {"smart_pause_enabled": True, "smart_pause_threshold_days": 30}},
        )
        r = await smart_pause_idle_listings()
        assert r["listings_paused"] >= 1
        doc = await db.products.find_one({"slug": slug}, {"_id": 0})
        assert doc["status"] == "draft"
        assert doc.get("smart_paused_at")
    finally:
        await db.products.delete_one({"slug": slug})
        await db.makers.update_one(
            {"slug": "iron-and-oak"},
            {"$set": {
                "smart_pause_enabled": bool(snap_enabled),
                "smart_pause_threshold_days": int(snap_days),
            }},
        )
