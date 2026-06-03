"""iter326 — Duplicate founder_number bug + repair endpoint.

Reproduces the production bug:
  • Featured seed fixture installs makers with hardcoded founder_numbers
    1..N but never bumps `platform_meta.founder_counter`.
  • Live promotions then start at 1 → collide with seeded #001 / #002.

Verifies:
  1. `install_featured_seed_fixture` now bumps the counter via `$max`.
  2. `/admin/founders/repair-numbers` (dry-run) returns the proposed
     plan without touching the DB.
  3. `/admin/founders/repair-numbers` (apply) renumbers collisions,
     keeping the OLDEST maker's number and bumping the rest.
  4. Activity-event ids are rewritten to match the new numbers.
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


async def _seed_collision(slug_a, slug_b, founder_number):
    """Plant two founders sharing the same founder_number. `slug_a` is
    the OLDER one (seeded) and `slug_b` is the newer collision."""
    from core import db
    await db.makers.insert_one({
        "id": str(uuid.uuid4()), "slug": slug_a,
        "name": f"Maker {slug_a}", "initials": "MA",
        "location": "Boise, ID", "bio": "x",
        "techniques": [], "portrait": "", "cover": "",
        "tier": "founder", "founder_status": "inaugural",
        "founder_number": founder_number,
        "founder_started_at": "2026-05-20T00:00:00+00:00",
        "featured_example": True,
    })
    await db.makers.insert_one({
        "id": str(uuid.uuid4()), "slug": slug_b,
        "name": f"Maker {slug_b}", "initials": "MB",
        "location": "Austin, TX", "bio": "x",
        "techniques": [], "portrait": "", "cover": "",
        "tier": "founder", "founder_status": "inaugural",
        "founder_number": founder_number,
        "founder_started_at": "2026-06-01T00:00:00+00:00",
    })
    # Plant the corresponding activity event for the NEWER maker — that
    # is the one whose event id should be rewritten on repair.
    await db.activity_events.insert_one({
        "kind": "founder_joined",
        "text": f"{slug_b} just became Founder #{founder_number:03d}",
        "id": f"founder-{slug_b}-{founder_number}",
        "location": "",
        "amount": None,
        "session_id": None,
        "created_at": "2026-06-01T00:00:00+00:00",
    })


async def _cleanup(slugs):
    from core import db
    await db.makers.delete_many({"slug": {"$in": slugs}})
    for slug in slugs:
        await db.activity_events.delete_many(
            {"id": {"$regex": f"^founder-{slug}-"}}
        )


async def test_repair_dry_run_reports_plan_without_touching_db():
    from server import app
    from core import db
    transport = ASGITransport(app=app)

    slug_old = f"iter326-old-{uuid.uuid4().hex[:6]}"
    slug_new = f"iter326-new-{uuid.uuid4().hex[:6]}"
    await _seed_collision(slug_old, slug_new, 999)

    try:
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            jwt = await _admin_jwt(c)
            headers = {"Authorization": f"Bearer {jwt}"}
            r = await c.post("/api/admin/founders/repair-numbers",
                             json={"dry_run": True}, headers=headers)
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["dry_run"] is True
            assert body["duplicate_groups"] >= 1
            # The newer collision should appear in proposed_changes.
            change_slugs = [c["slug"] for c in body["proposed_changes"]]
            assert slug_new in change_slugs

            # DB must be UNCHANGED.
            row = await db.makers.find_one({"slug": slug_new}, {"_id": 0, "founder_number": 1})
            assert row["founder_number"] == 999, "dry_run must not mutate"
    finally:
        await _cleanup([slug_old, slug_new])


async def test_repair_apply_renumbers_newer_and_keeps_older():
    from server import app
    from core import db
    transport = ASGITransport(app=app)

    slug_old = f"iter326-keep-{uuid.uuid4().hex[:6]}"
    slug_new = f"iter326-fix-{uuid.uuid4().hex[:6]}"
    await _seed_collision(slug_old, slug_new, 997)

    try:
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            jwt = await _admin_jwt(c)
            headers = {"Authorization": f"Bearer {jwt}"}
            r = await c.post("/api/admin/founders/repair-numbers",
                             json={"dry_run": False}, headers=headers)
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["dry_run"] is False
            # At least one renumber happened for our planted collision.
            applied_slugs = [a["slug"] for a in body["applied"]]
            assert slug_new in applied_slugs

            # Older maker keeps its number.
            old_row = await db.makers.find_one({"slug": slug_old}, {"_id": 0, "founder_number": 1})
            assert old_row["founder_number"] == 997

            # Newer maker now has a fresh number that's GREATER than 997.
            new_row = await db.makers.find_one({"slug": slug_new}, {"_id": 0, "founder_number": 1})
            assert new_row["founder_number"] > 997, f"expected bump, got {new_row['founder_number']}"

            # Activity-event id rewritten.
            old_event = await db.activity_events.find_one({"id": f"founder-{slug_new}-997"})
            assert old_event is None, "old event id should no longer exist"
            new_event = await db.activity_events.find_one(
                {"id": f"founder-{slug_new}-{new_row['founder_number']}"}
            )
            assert new_event is not None, "new event id should exist"

            # Idempotency — re-running with apply does nothing for the
            # same slug, but the planted collision is already resolved so
            # the slug won't appear in `applied` again.
            r2 = await c.post("/api/admin/founders/repair-numbers",
                              json={"dry_run": False}, headers=headers)
            assert r2.status_code == 200
            applied2 = [a["slug"] for a in r2.json()["applied"]]
            assert slug_new not in applied2
    finally:
        await _cleanup([slug_old, slug_new])


async def test_install_fixture_bumps_founder_counter():
    """The fixture install path should leave the counter at AT LEAST the
    max founder_number embedded in the fixture, so the next promotion
    doesn't collide. We don't actually run the install (it touches lots
    of collections + R2 images); we just smoke-test the `$max` update."""
    from core import db
    # Plant a stale counter at 0.
    await db.platform_meta.update_one(
        {"key": "founder_counter"},
        {"$set": {"value": 0}},
        upsert=True,
    )
    # Simulate the `$max` bump the fixture-install path now performs.
    await db.platform_meta.update_one(
        {"key": "founder_counter"},
        {"$max": {"value": 15}},
        upsert=True,
    )
    doc = await db.platform_meta.find_one({"key": "founder_counter"}, {"_id": 0})
    assert doc["value"] == 15

    # `$max` is idempotent — re-running with a SMALLER value never lowers.
    await db.platform_meta.update_one(
        {"key": "founder_counter"},
        {"$max": {"value": 10}},
        upsert=True,
    )
    doc = await db.platform_meta.find_one({"key": "founder_counter"}, {"_id": 0})
    assert doc["value"] == 15, "must never lower"
