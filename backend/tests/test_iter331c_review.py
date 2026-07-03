"""iter331c · Additional review-level HTTP coverage.

Focus on the extra assertions the reviewer requested:
  - ledger endpoint honours ?limit=N
  - determinism between two consecutive locked GETs
"""
from __future__ import annotations

import os
from datetime import datetime, timezone

import httpx
import pytest
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

with open("/app/frontend/.env") as f:
    API = next(
        (ln.split("=", 1)[1].strip() for ln in f if ln.startswith("REACT_APP_BACKEND_URL=")),
        "http://localhost:8001",
    )

PUB = f"{API}/api/community/homepage-makers"
LEDGER = f"{API}/api/admin/homepage-rotation/ledger"


async def _admin_jwt() -> str:
    from maker_auth import issue_admin_magic_token
    tok = issue_admin_magic_token(os.environ["OPS_EMAIL"])
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(f"{API}/api/admin/auth/verify", json={"token": tok})
    r.raise_for_status()
    return r.json()["token"]


async def _reset_state(db):
    await db.system_state.delete_one({"key": "homepage_rotation_state"})
    await db.system_state.delete_one({"key": "homepage_rotation_config"})
    await db.homepage_rotation_ledger.delete_many({})
    await db.makers.update_many(
        {},
        {"$unset": {"homepage_impression_count": "", "last_homepage_featured_at": ""}},
    )


@pytest.mark.asyncio
async def test_ledger_limit_query_param():
    """Inject ≥5 ledger rows across distinct period keys and verify
    GET /admin/homepage-rotation/ledger?limit=3 returns exactly 3."""
    from motor.motor_asyncio import AsyncIOMotorClient
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    jwt = await _admin_jwt()
    h = {"Authorization": f"Bearer {jwt}"}
    try:
        await _reset_state(db)
        # Inject 6 ledger rows with distinct period keys.
        now = datetime.now(timezone.utc)
        rows = [
            {
                "period_key": f"TEST-{i}",
                "period_start": now.isoformat(),
                "featured_slugs": [f"maker-{i}"],
                "eligible_count": 10,
                "reason": "auto-selected (test)",
                "config_snapshot": {"window": 4, "cadence": "weekly"},
                "created_at": now,
            }
            for i in range(6)
        ]
        await db.homepage_rotation_ledger.insert_many(rows)

        async with httpx.AsyncClient(timeout=30) as c:
            r = await c.get(f"{LEDGER}?limit=3", headers=h)
            assert r.status_code == 200, r.text
            body = r.json()
            assert "items" in body and "count" in body
            assert len(body["items"]) == 3, f"expected 3 rows, got {len(body['items'])}"

            # Without limit — default should return more (at least 6).
            r2 = await c.get(LEDGER, headers=h)
            assert r2.status_code == 200
            assert len(r2.json()["items"]) >= 6
    finally:
        await db.homepage_rotation_ledger.delete_many({"period_key": {"$regex": "^TEST-"}})
        await _reset_state(db)


@pytest.mark.asyncio
async def test_locked_period_is_byte_deterministic():
    """Two back-to-back GETs on a locked period must return the same
    ordered slugs and same period_start ISO string."""
    from motor.motor_asyncio import AsyncIOMotorClient
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    try:
        await _reset_state(db)
        async with httpx.AsyncClient(timeout=30) as c:
            r1 = await c.get(PUB); r1.raise_for_status()
            r2 = await c.get(PUB); r2.raise_for_status()
            b1, b2 = r1.json(), r2.json()
            slugs_1 = [m["slug"] for m in b1["items"]]
            slugs_2 = [m["slug"] for m in b2["items"]]
            assert slugs_1 == slugs_2, f"non-deterministic slugs: {slugs_1} vs {slugs_2}"
            assert b1["rotation"]["period_start"] == b2["rotation"]["period_start"]
            # Second call MUST advertise locked=true.
            assert b2["rotation"].get("locked") is True
    finally:
        await _reset_state(db)


@pytest.mark.asyncio
async def test_ledger_endpoint_requires_admin_jwt():
    """No-header and bad-header calls must be rejected 401/403."""
    async with httpx.AsyncClient(timeout=30) as c:
        r1 = await c.get(LEDGER)
        assert r1.status_code in (401, 403), r1.text
        r2 = await c.get(LEDGER, headers={"Authorization": "Bearer garbage"})
        assert r2.status_code in (401, 403), r2.text
