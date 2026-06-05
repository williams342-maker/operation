"""iter334l — Admin Microsoft Ads ROAS tile + Auto SEO Title Rewrite.

Covers:
  1. GET /api/admin/ads/msft-roas requires admin JWT (401 without).
  2. ROAS aggregates only `msclkid`-tagged paid txns in the window.
  3. POST /api/admin/ads/msft-spend persists the spend, GET returns it
     and computes roas = revenue/spend.
  4. POST /api/maker/ai/title-refresh requires maker JWT (401 without).
  5. Title-refresh 404s if listing not owned by the caller.
  6. Title-refresh returns the suggested title from the LLM (LLM is
     monkey-patched so the test is hermetic — we don't depend on the
     Emergent key being healthy).
"""
from __future__ import annotations
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from dotenv import load_dotenv
from httpx import ASGITransport, AsyncClient

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "test_database")
sys.path.insert(0, "/app/backend")

pytestmark = pytest.mark.asyncio


def _admin_jwt() -> str:
    """Mint a super-admin JWT directly — bypasses magic-link verify so
    the test doesn't depend on the SMTP path."""
    from core import ADMIN_EMAILS
    from maker_auth import issue_session_jwt
    email = next(iter(ADMIN_EMAILS)) if ADMIN_EMAILS else "admin@test.com"
    return issue_session_jwt("admin", email, role="admin")


def _maker_jwt(slug: str, email: str) -> str:
    from maker_auth import issue_session_jwt
    return issue_session_jwt(slug, email)


# ── ROAS endpoint ─────────────────────────────────────────────────────
async def test_msft_roas_requires_admin_jwt():
    from server import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/admin/ads/msft-roas")
        assert r.status_code in (401, 403)


async def test_msft_roas_aggregates_msclkid_window_only():
    """Seed 3 paid txns: 2 with msclkid in-window, 1 in-window without
    msclkid, 1 with msclkid but older than the window. Only the two
    in-window+msclkid ones should be summed."""
    from core import db
    from server import app

    now = datetime.now(timezone.utc)
    in_window = now.isoformat()
    out_window = (now - timedelta(days=15)).isoformat()
    sid_prefix = f"cs_test_iter334l_{uuid.uuid4().hex[:8]}"

    docs = [
        # In window WITH msclkid — counts.
        {"session_id": f"{sid_prefix}_a", "msclkid": "abc123def456",
         "payment_status": "paid", "amount": 80.0, "currency": "usd",
         "created_at": in_window, "items": [{"name": "x"}]},
        {"session_id": f"{sid_prefix}_b", "msclkid": "zzz999",
         "payment_status": "paid", "amount": 45.5, "currency": "usd",
         "created_at": in_window, "items": []},
        # In window WITHOUT msclkid — skipped.
        {"session_id": f"{sid_prefix}_c",
         "payment_status": "paid", "amount": 99.0, "currency": "usd",
         "created_at": in_window, "items": []},
        # Out of window — skipped (only 7d default).
        {"session_id": f"{sid_prefix}_d", "msclkid": "old",
         "payment_status": "paid", "amount": 500.0, "currency": "usd",
         "created_at": out_window, "items": []},
    ]
    await db.payment_transactions.insert_many(docs)
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            r = await ac.get(
                "/api/admin/ads/msft-roas?days=7",
                headers={"Authorization": f"Bearer {_admin_jwt()}"},
            )
        assert r.status_code == 200, r.text
        body = r.json()
        # Only the 2 in-window msclkid rows we seeded should be counted.
        # (NB: other paid txns from previous test runs may also match — we
        # assert ≥2, not ==2, to remain robust against shared DB state.)
        assert body["attributed_orders"] >= 2
        assert body["attributed_revenue"] >= 80.0 + 45.5 - 0.01
        # Our two seeded rows are in the sample (or among the recent 10).
        sids = {s["session_id"] for s in body["sample"]}
        assert f"{sid_prefix}_a" in sids
        assert f"{sid_prefix}_b" in sids
        # Out-of-window must NOT appear.
        assert f"{sid_prefix}_d" not in sids
    finally:
        await db.payment_transactions.delete_many(
            {"session_id": {"$regex": f"^{sid_prefix}"}}
        )


async def test_msft_spend_record_and_roas_math():
    """Posting ad spend persists it, and the next ROAS call returns
    roas = round(revenue/spend, 2)."""
    from core import db
    from server import app

    now = datetime.now(timezone.utc).isoformat()
    sid = f"cs_test_iter334l_{uuid.uuid4().hex[:10]}"
    await db.payment_transactions.insert_one({
        "session_id": sid, "msclkid": "roastest123",
        "payment_status": "paid", "amount": 200.0, "currency": "usd",
        "created_at": now, "items": [],
    })
    # Snapshot existing spend so we restore it after.
    prior_spend = await db.ops_settings.find_one({"_id": "bing_ad_spend"})
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            # Record spend.
            r = await ac.post(
                "/api/admin/ads/msft-spend",
                json={"amount_usd": 50.0, "period_days": 7, "note": "test"},
                headers={"Authorization": f"Bearer {_admin_jwt()}"},
            )
            assert r.status_code == 200, r.text
            assert r.json()["amount_usd"] == 50.0

            # Get ROAS — should be revenue/50.
            r2 = await ac.get(
                "/api/admin/ads/msft-roas?days=7",
                headers={"Authorization": f"Bearer {_admin_jwt()}"},
            )
            assert r2.status_code == 200
            body = r2.json()
            assert body["ad_spend_usd"] == 50.0
            assert body["ad_spend_recorded_at"] is not None
            assert body["roas"] is not None
            # roas should be revenue / 50, rounded to 2 dp.
            assert body["roas"] == round(body["attributed_revenue"] / 50.0, 2)
    finally:
        await db.payment_transactions.delete_one({"session_id": sid})
        if prior_spend:
            await db.ops_settings.replace_one(
                {"_id": "bing_ad_spend"}, prior_spend, upsert=True,
            )
        else:
            await db.ops_settings.delete_one({"_id": "bing_ad_spend"})


async def test_msft_roas_no_spend_returns_null():
    """When no spend is recorded yet, roas should be null (not 0/divide-
    by-zero)."""
    from core import db
    from server import app

    prior_spend = await db.ops_settings.find_one({"_id": "bing_ad_spend"})
    await db.ops_settings.delete_one({"_id": "bing_ad_spend"})
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            r = await ac.get(
                "/api/admin/ads/msft-roas?days=7",
                headers={"Authorization": f"Bearer {_admin_jwt()}"},
            )
        assert r.status_code == 200
        body = r.json()
        assert body["ad_spend_usd"] == 0
        assert body["roas"] is None
    finally:
        if prior_spend:
            await db.ops_settings.replace_one(
                {"_id": "bing_ad_spend"}, prior_spend, upsert=True,
            )


# ── Title refresh endpoint ────────────────────────────────────────────
async def test_title_refresh_requires_maker_jwt():
    from server import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post("/api/maker/ai/title-refresh", json={
            "slug": "anything", "old_price": 100, "new_price": 80,
        })
        assert r.status_code in (401, 403)


async def test_title_refresh_404_when_listing_not_owned():
    from core import db
    from server import app

    slug_a = f"a-maker-{uuid.uuid4().hex[:8]}"
    slug_b = f"b-maker-{uuid.uuid4().hex[:8]}"
    listing_slug = f"prod-{uuid.uuid4().hex[:8]}"

    await db.makers.insert_one({
        "slug": slug_a, "name": "A", "email": f"{slug_a}@t.com",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    await db.makers.insert_one({
        "slug": slug_b, "name": "B", "email": f"{slug_b}@t.com",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    await db.products.insert_one({
        "id": str(uuid.uuid4()), "slug": listing_slug, "maker_slug": slug_a,
        "title": "Walnut board", "category": "Kitchen",
        "description": "A nice board.", "price": 100.0,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            # B tries to title-refresh A's listing → 404.
            r = await ac.post(
                "/api/maker/ai/title-refresh",
                json={"slug": listing_slug, "old_price": 100, "new_price": 80},
                headers={"Authorization": f"Bearer {_maker_jwt(slug_b, f'{slug_b}@t.com')}"},
            )
            assert r.status_code == 404
    finally:
        await db.makers.delete_many({"slug": {"$in": [slug_a, slug_b]}})
        await db.products.delete_one({"slug": listing_slug})


async def test_title_refresh_returns_suggested_title(monkeypatch):
    """LLM is monkey-patched to return a deterministic JSON; assert
    sanitisation + log row + response shape."""
    from core import db
    from server import app
    import routers.ai_marketing as ai_mod

    slug = f"maker-{uuid.uuid4().hex[:8]}"
    listing_slug = f"listing-{uuid.uuid4().hex[:8]}"
    await db.makers.insert_one({
        "slug": slug, "name": "Maker", "email": f"{slug}@t.com",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    await db.products.insert_one({
        "id": str(uuid.uuid4()), "slug": listing_slug, "maker_slug": slug,
        "title": "Heirloom Walnut Cutting Board — Limited Edition",
        "category": "Kitchen",
        "description": "Hand-finished walnut.", "price": 180.0,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })

    async def _fake_claude(system, user, max_chars=4000):
        return {
            "suggested_title": "Everyday Walnut Cutting Board for Small Kitchens",
            "rationale": "Reframes for a gift-friendly, accessible price tier.",
        }
    monkeypatch.setattr(ai_mod, "_claude_async", _fake_claude)

    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            r = await ac.post(
                "/api/maker/ai/title-refresh",
                json={"slug": listing_slug, "old_price": 180, "new_price": 80},
                headers={"Authorization": f"Bearer {_maker_jwt(slug, f'{slug}@t.com')}"},
            )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["current_title"].startswith("Heirloom Walnut")
        assert body["suggested_title"] == "Everyday Walnut Cutting Board for Small Kitchens"
        assert "gift-friendly" in body["rationale"]
        # Log row written.
        log = await db.ai_marketing_log.find_one(
            {"kind": "title_refresh", "listing_slug": listing_slug},
            {"_id": 0},
        )
        assert log is not None
        assert log["maker_slug"] == slug
        assert log["new_price"] == 80
    finally:
        await db.makers.delete_one({"slug": slug})
        await db.products.delete_one({"slug": listing_slug})
        await db.ai_marketing_log.delete_many({"listing_slug": listing_slug})


async def test_title_refresh_503_when_llm_returns_none(monkeypatch):
    """If the LLM fails or returns garbage (None), the endpoint should
    503 — surfaces "AI is busy" in the UI rather than hiding the error."""
    from core import db
    from server import app
    import routers.ai_marketing as ai_mod

    slug = f"maker-{uuid.uuid4().hex[:8]}"
    listing_slug = f"listing-{uuid.uuid4().hex[:8]}"
    await db.makers.insert_one({
        "slug": slug, "name": "Maker", "email": f"{slug}@t.com",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    await db.products.insert_one({
        "id": str(uuid.uuid4()), "slug": listing_slug, "maker_slug": slug,
        "title": "Some title", "category": "Misc",
        "description": "X.", "price": 50.0,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })

    async def _fail(*_a, **_k):
        return None
    monkeypatch.setattr(ai_mod, "_claude_async", _fail)

    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            r = await ac.post(
                "/api/maker/ai/title-refresh",
                json={"slug": listing_slug, "old_price": 50, "new_price": 45},
                headers={"Authorization": f"Bearer {_maker_jwt(slug, f'{slug}@t.com')}"},
            )
        assert r.status_code == 503
    finally:
        await db.makers.delete_one({"slug": slug})
        await db.products.delete_one({"slug": listing_slug})
