"""iter413cl — Custom shop URL gate extended to Founders.

Previously only Plus (subscription_status=active) makers could claim a
vanity URL. Founders already get a lower commission + larger free quota
than Plus, so locking this minor vanity feature behind Plus contradicted
the tier philosophy. Now BOTH active Plus subscribers AND any Founder
(inaugural or regular) qualify.

Verifies:
  • Founder (no Plus) can read /maker/custom-url (no 403)
  • Founder can claim a vanity URL via POST
  • Public resolve endpoint resolves a founder's vanity URL
  • Free/Standard maker still gets 403 (regression guard)
"""
from __future__ import annotations

import asyncio
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://active-project-4.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE_URL}/api"


def _mint_maker_jwt(slug: str, email: str) -> str:
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    from maker_auth import issue_session_jwt
    return issue_session_jwt(slug, email, role="maker")


@pytest.fixture
def fresh_founder():
    """Inserts an approved Founder-tier maker (no Plus). Cleans up
    afterward including any vanity URLs they claimed."""
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    from motor.motor_asyncio import AsyncIOMotorClient

    suffix = uuid.uuid4().hex[:8]
    slug = f"iter413cl-founder-{suffix}"
    email = f"{slug}@example.com"

    async def _seed():
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]
        await db.makers.insert_one({
            "id": str(uuid.uuid4()),
            "slug": slug, "name": "Iter413cl Founder",
            "initials": "CL", "location": "Boise, ID", "bio": "fx",
            "portrait": "", "cover": "", "email": email,
            "status": "approved", "tier": "founder",
            "founder_status": "inaugural",
            "subscription_status": "free",
            "approved_at": datetime.now(timezone.utc).isoformat(),
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        client.close()
    asyncio.run(_seed())

    yield slug, email

    async def _cleanup():
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]
        await db.makers.delete_many({"slug": slug})
        client.close()
    asyncio.run(_cleanup())


@pytest.fixture
def fresh_standard():
    """Inserts an approved Standard-tier maker (no founder, no Plus).
    Used to ensure the gate still rejects them."""
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    from motor.motor_asyncio import AsyncIOMotorClient

    suffix = uuid.uuid4().hex[:8]
    slug = f"iter413cl-standard-{suffix}"
    email = f"{slug}@example.com"

    async def _seed():
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]
        await db.makers.insert_one({
            "id": str(uuid.uuid4()),
            "slug": slug, "name": "Iter413cl Standard",
            "initials": "CS", "location": "Boise, ID", "bio": "fx",
            "portrait": "", "cover": "", "email": email,
            "status": "approved",
            "tier": "standard",
            "subscription_status": "free",
            "approved_at": datetime.now(timezone.utc).isoformat(),
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        client.close()
    asyncio.run(_seed())

    yield slug, email

    async def _cleanup():
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]
        await db.makers.delete_many({"slug": slug})
        client.close()
    asyncio.run(_cleanup())


@pytest.mark.asyncio
async def test_founder_can_read_custom_url_endpoint(fresh_founder):
    slug, email = fresh_founder
    tok = _mint_maker_jwt(slug, email)
    async with httpx.AsyncClient(timeout=15.0) as c:
        r = await c.get(f"{API}/maker/custom-url", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert "custom_url" in body
    assert body["custom_url"] is None  # not yet claimed


@pytest.mark.asyncio
async def test_founder_can_claim_vanity_url_and_resolve(fresh_founder):
    slug, email = fresh_founder
    tok = _mint_maker_jwt(slug, email)
    vanity = f"i413cl-{uuid.uuid4().hex[:8]}"
    async with httpx.AsyncClient(timeout=15.0) as c:
        r = await c.post(
            f"{API}/maker/custom-url",
            headers={"Authorization": f"Bearer {tok}"},
            json={"custom_url": vanity},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["custom_url"] == vanity
        assert body["custom_url_changed_at"]

        # Public resolver picks it up.
        r2 = await c.get(f"{API}/makers/resolve/{vanity}")
        assert r2.status_code == 200, r2.text
        assert r2.json()["matched_via"] == "custom_url"
        assert r2.json()["slug"] == slug


@pytest.mark.asyncio
async def test_standard_maker_still_blocked(fresh_standard):
    slug, email = fresh_standard
    tok = _mint_maker_jwt(slug, email)
    async with httpx.AsyncClient(timeout=15.0) as c:
        r = await c.get(f"{API}/maker/custom-url", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 403, r.text
    body = r.json()
    detail = body.get("detail")
    if isinstance(detail, dict):
        assert detail.get("code") == "plus_required"
