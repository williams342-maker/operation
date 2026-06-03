"""iter325 — Founders application hardening.

Validates:
  1. Activity-event insert is idempotent — calling /api/admin/founders/promote
     twice on the same maker doesn't double-insert the `founder_joined` event.
  2. founder_number is REUSED on re-promotion (not re-incremented), so the
     monotonic counter doesn't drift when admins toggle.
  3. The /beta page submission still works through the same anti-spam
     guards from iter324 (rate-limit + honeypot + dedupe).
"""
from __future__ import annotations

import os
import uuid

import pytest
from httpx import AsyncClient, ASGITransport

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "test_database")

pytestmark = pytest.mark.asyncio


async def _admin_jwt(c):
    from maker_auth import issue_admin_magic_token
    from core import ADMIN_EMAILS
    emails = list(ADMIN_EMAILS) if ADMIN_EMAILS else []
    email = emails[0] if emails else "team@craftersmarket.org"
    tok = issue_admin_magic_token(email)
    v = await c.post("/api/admin/auth/verify", json={"token": tok})
    assert v.status_code == 200, v.text
    return v.json()["token"]


async def test_promote_twice_does_not_duplicate_activity_event():
    """Bug 1 fix — admin clicking Promote on an already-promoted maker
    should NOT double-insert the `founder_joined` activity event."""
    from server import app
    from core import db
    transport = ASGITransport(app=app)

    slug = f"iter325-{uuid.uuid4().hex[:8]}"
    email = f"{slug}@example.com"
    await db.makers.insert_one({
        "id": str(uuid.uuid4()),
        "slug": slug,
        "name": "Iter325 Maker",
        "shop_name": "Iter325 Studio",
        "initials": "IM",
        "location": "Boise, ID",
        "bio": "x",
        "techniques": [],
        "portrait": "",
        "cover": "",
        "email": email,
        "status": "active",
        "tier": "standard",
    })

    try:
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            jwt = await _admin_jwt(c)
            headers = {"Authorization": f"Bearer {jwt}"}

            r1 = await c.post("/api/admin/founders/promote",
                              json={"slug": slug}, headers=headers)
            assert r1.status_code == 200, r1.text
            num1 = r1.json().get("founder_number")
            assert num1 is not None and num1 > 0

            # Second promote on the SAME maker.
            r2 = await c.post("/api/admin/founders/promote",
                              json={"slug": slug}, headers=headers)
            assert r2.status_code == 200, r2.text
            num2 = r2.json().get("founder_number")

            # Bug 4 — number reused, no counter drift.
            assert num1 == num2, f"founder_number must be reused on re-promote: {num1} → {num2}"

            # Bug 1 — exactly ONE activity event with this id, not two.
            count = await db.activity_events.count_documents(
                {"id": f"founder-{slug}-{num1}"}
            )
            assert count == 1, f"expected exactly 1 activity event, got {count}"
    finally:
        await db.makers.delete_one({"slug": slug})
        await db.activity_events.delete_many({"id": {"$regex": f"^founder-{slug}-"}})


async def test_beta_signup_still_works_through_apply_endpoint():
    """Verify the beta marker continues to set is_beta=True on the app
    doc and isn't broken by the iter324 honeypot/dedupe layer."""
    from server import app
    from core import db
    transport = ASGITransport(app=app)

    body = {
        "name": "Beta Tester",
        "email": f"beta-{uuid.uuid4().hex[:8]}@example.com",
        "studio_name": "Beta Studio",
        "location": "Austin, TX",
        "techniques": ["PLASMA"],
        "portfolio_url": "https://example.com",
        "about": "[FOUNDING SELLER BETA] I cut steel.",
    }

    try:
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            from routers.catalog import _MAKER_APP_RATE_BUCKET
            _MAKER_APP_RATE_BUCKET.clear()
            r = await c.post(
                "/api/maker-applications",
                json=body,
                headers={"X-Forwarded-For": "9.9.9.10"},
            )
            assert r.status_code == 200, r.text
            row = await db.maker_applications.find_one({"email": body["email"]}, {"_id": 0})
            assert row is not None
            assert row.get("is_beta") is True, "[FOUNDING SELLER BETA] marker must set is_beta=True"
    finally:
        await db.maker_applications.delete_many({"email": body["email"]})


async def test_beta_signup_honeypot_silently_succeeds_without_persisting():
    """Beta form with the honeypot filled should be silently dropped
    just like /apply — bots can't tell the difference between the two
    public endpoints because they share the same backend handler."""
    from server import app
    from core import db
    transport = ASGITransport(app=app)

    body = {
        "name": "Beta Bot",
        "email": f"beta-bot-{uuid.uuid4().hex[:8]}@example.com",
        "studio_name": "Bot Studio",
        "location": "Nowhere, ZZ",
        "techniques": [],
        "portfolio_url": "",
        "about": "[FOUNDING SELLER BETA] spam",
        "website": "https://evil.bot/x",
    }

    try:
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            from routers.catalog import _MAKER_APP_RATE_BUCKET
            _MAKER_APP_RATE_BUCKET.clear()
            r = await c.post(
                "/api/maker-applications",
                json=body,
                headers={"X-Forwarded-For": "9.9.9.11"},
            )
            assert r.status_code == 200, r.text
            row = await db.maker_applications.find_one({"email": body["email"]})
            assert row is None, "honeypot trip must not persist a row"
    finally:
        await db.maker_applications.delete_many({"email": body["email"]})
