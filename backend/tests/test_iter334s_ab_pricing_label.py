"""iter334s — A/B pricing-label experiment endpoints.

Covers:
  1. POST /api/experiments/pricing-label/event records click rows.
  2. Dedup window — same IP+slug+variant within 2s returns deduped=true.
  3. GET  /api/admin/experiments/pricing-label/stats requires admin JWT.
  4. Stats aggregate per variant; both variants returned even if zero.
"""
from __future__ import annotations
import os
import sys
import uuid

import pytest
from dotenv import load_dotenv
from httpx import ASGITransport, AsyncClient

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "test_database")
sys.path.insert(0, "/app/backend")

pytestmark = pytest.mark.asyncio


def _admin_jwt() -> str:
    from core import ADMIN_EMAILS
    from maker_auth import issue_session_jwt
    email = next(iter(ADMIN_EMAILS)) if ADMIN_EMAILS else "a@t.com"
    return issue_session_jwt("admin", email, role="admin")


async def test_record_click_event_writes_row():
    from core import db
    from server import app

    slug = f"test-listing-{uuid.uuid4().hex[:8]}"
    transport = ASGITransport(app=app)
    try:
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            r = await ac.post("/api/experiments/pricing-label/event", json={
                "event": "click", "variant": "from", "slug": slug,
            })
        assert r.status_code == 200
        assert r.json()["ok"] is True
        row = await db.ab_pricing_label_events.find_one({"slug": slug}, {"_id": 0})
        assert row is not None
        assert row["variant"] == "from"
        assert row["event"] == "click"
    finally:
        await db.ab_pricing_label_events.delete_many({"slug": slug})


async def test_dedup_within_2s():
    from core import db
    from server import app

    slug = f"dedup-{uuid.uuid4().hex[:8]}"
    transport = ASGITransport(app=app)
    try:
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            r1 = await ac.post("/api/experiments/pricing-label/event", json={
                "event": "click", "variant": "range", "slug": slug,
            })
            r2 = await ac.post("/api/experiments/pricing-label/event", json={
                "event": "click", "variant": "range", "slug": slug,
            })
        assert r1.status_code == 200
        assert r2.status_code == 200
        assert r2.json().get("deduped") is True
        count = await db.ab_pricing_label_events.count_documents({"slug": slug})
        assert count == 1
    finally:
        await db.ab_pricing_label_events.delete_many({"slug": slug})


async def test_stats_requires_admin():
    from server import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/admin/experiments/pricing-label/stats")
        assert r.status_code in (401, 403)


async def test_stats_aggregates_per_variant():
    from core import db
    from server import app

    slug_a = f"agg-a-{uuid.uuid4().hex[:8]}"
    slug_b = f"agg-b-{uuid.uuid4().hex[:8]}"
    # Pre-seed via the public endpoint so the dedup-by-IP path doesn't kick in.
    transport = ASGITransport(app=app)
    try:
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            # 2 clicks on `from` (different slugs to bypass IP+slug dedup).
            await ac.post("/api/experiments/pricing-label/event", json={
                "event": "click", "variant": "from", "slug": slug_a,
            })
            await ac.post("/api/experiments/pricing-label/event", json={
                "event": "click", "variant": "from", "slug": slug_b,
            })
            # 1 click on `range`.
            await ac.post("/api/experiments/pricing-label/event", json={
                "event": "click", "variant": "range", "slug": slug_a,
            })

            r = await ac.get(
                "/api/admin/experiments/pricing-label/stats?days=1",
                headers={"Authorization": f"Bearer {_admin_jwt()}"},
            )
        assert r.status_code == 200
        body = r.json()
        # Both variants surface, even if zero.
        names = [v["variant"] for v in body["variants"]]
        assert "from" in names and "range" in names
        from_row = next(v for v in body["variants"] if v["variant"] == "from")
        # ≥2 because shared DB; we seeded 2 so floor is 2.
        assert from_row["clicks"] >= 2
        assert from_row["unique_listings"] >= 2
    finally:
        await db.ab_pricing_label_events.delete_many(
            {"slug": {"$in": [slug_a, slug_b]}}
        )
