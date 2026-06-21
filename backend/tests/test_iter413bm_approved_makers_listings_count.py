"""iter413bm — Approved-Makers `listings_count` field regression.

Bug: The admin endpoint `/admin/makers/approved` aggregated on a `maker`
field that doesn't exist on `db.products` (the Product model uses
`maker_slug`). Every row in the Admin → Approved Makers table therefore
showed `0` regardless of how many listings the maker actually had.

This test seeds 3 live listings + 1 soft-deleted listing for a fresh
maker slug and asserts the API reports `listings_count == 3`.
"""
from __future__ import annotations

import asyncio
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest
import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://active-project-4.preview.emergentagent.com",
).rstrip("/")


@pytest.fixture(scope="module")
def admin_jwt():
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    from maker_auth import issue_admin_magic_token
    tok = issue_admin_magic_token("team@craftersmarket.org")
    r = requests.post(f"{BASE_URL}/api/admin/auth/verify", json={"token": tok}, timeout=15)
    r.raise_for_status()
    return r.json()["token"]


@pytest.fixture
def H(admin_jwt):
    return {"Authorization": f"Bearer {admin_jwt}"}


def _seed():
    """Insert 1 maker + 3 live products + 1 soft-deleted product."""
    from motor.motor_asyncio import AsyncIOMotorClient

    async def _go():
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]
        slug = f"iter413bm-{uuid.uuid4().hex[:8]}"
        email = f"{slug}@example.com"
        now = datetime.now(timezone.utc).isoformat()
        await db.makers.insert_one({
            "id": str(uuid.uuid4()),
            "slug": slug,
            "name": "iter413bm listings count target",
            "email": email,
            "created_at": now,
            "is_veteran_owned": False,
            "tier": "free",
        })
        for i in range(3):
            await db.products.insert_one({
                "id": str(uuid.uuid4()),
                "maker_slug": slug,
                "slug": f"{slug}-prod-{i}",
                "title": f"iter413bm product {i}",
                "price": 25.0,
                "status": "published",
                "deleted_at": None,
                "created_at": now,
            })
        # One soft-deleted listing — must NOT be counted.
        await db.products.insert_one({
            "id": str(uuid.uuid4()),
            "maker_slug": slug,
            "slug": f"{slug}-prod-deleted",
            "title": "iter413bm soft-deleted",
            "price": 25.0,
            "status": "published",
            "deleted_at": now,
            "created_at": now,
        })
        client.close()
        return slug

    return asyncio.run(_go())


def _cleanup(slug):
    from motor.motor_asyncio import AsyncIOMotorClient

    async def _go():
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]
        await db.makers.delete_many({"slug": slug})
        await db.products.delete_many({"maker_slug": slug})
        client.close()

    asyncio.run(_go())


def test_listings_count_uses_maker_slug_field(H):
    """The endpoint must report 3 (live only) — soft-deleted is excluded."""
    slug = _seed()
    try:
        r = requests.get(f"{BASE_URL}/api/admin/makers/approved", headers=H, timeout=30)
        r.raise_for_status()
        rows = r.json()
        row = next((m for m in rows if m["slug"] == slug), None)
        assert row is not None, f"seeded maker {slug} missing from /admin/makers/approved response"
        assert row["listings_count"] == 3, (
            f"expected listings_count=3 (3 live, 1 soft-deleted), got "
            f"{row['listings_count']} — likely a `maker` vs `maker_slug` field regression"
        )
    finally:
        _cleanup(slug)
