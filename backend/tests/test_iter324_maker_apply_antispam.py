"""iter324 — Maker-application anti-spam hardening.

Covers POST /api/maker-applications:
  • IP rate-limit (5/min) → 429 on overflow.
  • Honeypot field `website` → silent 200 without persistence.
  • 24h soft dedupe by email → returns the existing row, no double insert.
  • Happy path still inserts cleanly + fires ops + applicant emails.
"""
from __future__ import annotations

import os
import uuid

import pytest
from httpx import AsyncClient, ASGITransport

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "test_database")

pytestmark = pytest.mark.asyncio


def _payload(email: str | None = None, website: str = "", studio: str = "Iron Oak Studio"):
    return {
        "name": "Test Maker",
        "email": email or f"iter324-{uuid.uuid4().hex[:8]}@example.com",
        "studio_name": studio,
        "location": "Austin, TX",
        "techniques": ["PLASMA", "LASER"],
        "portfolio_url": "https://example.com",
        "about": "Custom plasma art for ranches and farmhouses.",
        "website": website,
    }


async def _post(c, body, ip="1.2.3.4"):
    return await c.post(
        "/api/maker-applications",
        json=body,
        headers={"X-Forwarded-For": ip},
    )


async def test_happy_path_inserts_and_omits_honeypot():
    from server import app
    from core import db
    body = _payload()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        # Reset rate bucket for predictable counts.
        from routers.catalog import _MAKER_APP_RATE_BUCKET
        _MAKER_APP_RATE_BUCKET.clear()
        r = await _post(c, body, ip="9.9.9.1")
        assert r.status_code == 200, r.text
        out = r.json()
        # Honeypot field must NEVER survive into the response model.
        assert "website" not in out
        # Mongo row exists.
        row = await db.maker_applications.find_one({"email": body["email"]}, {"_id": 0})
        assert row is not None
        await db.maker_applications.delete_many({"email": body["email"]})


async def test_honeypot_silently_succeeds_without_persisting():
    from server import app
    from core import db
    body = _payload(website="https://evil.bot/x")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        from routers.catalog import _MAKER_APP_RATE_BUCKET
        _MAKER_APP_RATE_BUCKET.clear()
        r = await _post(c, body, ip="9.9.9.2")
        # Still a 200 — silent success so the bot doesn't probe further.
        assert r.status_code == 200, r.text
        # But NO row was persisted.
        row = await db.maker_applications.find_one({"email": body["email"]})
        assert row is None


async def test_rate_limit_triggers_on_6th_submission_per_ip():
    from server import app
    from core import db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        from routers.catalog import _MAKER_APP_RATE_BUCKET
        _MAKER_APP_RATE_BUCKET.clear()
        ip = "9.9.9.3"
        emails = []
        # Submit 5 different emails — all should succeed.
        for i in range(5):
            body = _payload(email=f"iter324-rl-{i}-{uuid.uuid4().hex[:6]}@example.com")
            r = await _post(c, body, ip=ip)
            assert r.status_code == 200, f"req #{i + 1}: {r.text}"
            emails.append(body["email"])
        # 6th from the same IP must be 429.
        body = _payload(email=f"iter324-rl-6-{uuid.uuid4().hex[:6]}@example.com")
        r = await _post(c, body, ip=ip)
        assert r.status_code == 429, r.text
        assert "too many" in r.text.lower()
        # Cleanup.
        if emails:
            await db.maker_applications.delete_many({"email": {"$in": emails}})


async def test_24h_dedupe_returns_existing_app_for_same_email():
    from server import app
    from core import db
    body = _payload()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        from routers.catalog import _MAKER_APP_RATE_BUCKET
        _MAKER_APP_RATE_BUCKET.clear()
        r1 = await _post(c, body, ip="9.9.9.4")
        assert r1.status_code == 200
        id1 = r1.json()["id"]

        # Second submission within 24h with the same email → dedupe hit.
        r2 = await _post(c, body, ip="9.9.9.5")
        assert r2.status_code == 200, r2.text
        id2 = r2.json()["id"]
        # Same id surfaced — no duplicate insert.
        assert id1 == id2

        # And Mongo has exactly ONE row for this email.
        count = await db.maker_applications.count_documents({"email": body["email"]})
        assert count == 1

        await db.maker_applications.delete_many({"email": body["email"]})
