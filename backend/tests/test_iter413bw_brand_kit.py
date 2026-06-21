"""iter413bw — Maker Brand Kit endpoint contracts.

Verifies:
  • POST /maker/brand-kit/apply     sets brand_kit_applied=True (idempotent)
  • POST /maker/brand-kit/dismiss   sets brand_kit_dismissed=True
  • GET  /admin/brand-kit/adoption  returns the expected funnel
  • non-approved makers are blocked from /apply (403)
  • all endpoints require auth
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


@pytest.fixture
def fresh_maker():
    """Seed a fresh approved maker, mint a maker JWT, yield (slug, jwt).
    Auto-cleanup on teardown."""
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    from maker_auth import issue_magic_token as issue_maker_magic_token
    from motor.motor_asyncio import AsyncIOMotorClient

    suffix = uuid.uuid4().hex[:8]
    slug = f"iter413bw-{suffix}"
    email = f"{slug}@example.com"

    async def _seed():
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]
        await db.makers.insert_one({
            "id": str(uuid.uuid4()),
            "slug": slug,
            "name": "iter413bw Maker",
            "initials": "BW",
            "location": "Portland, OR",
            "bio": "iter413bw brand kit test fixture maker bio.",
            "portrait": "", "cover": "",
            "email": email,
            "status": "approved",
            "approved_at": datetime.now(timezone.utc).isoformat(),
            "tier": "free",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        client.close()
    asyncio.run(_seed())

    raw = issue_maker_magic_token(email)
    r = requests.post(f"{BASE_URL}/api/maker/auth/verify", json={"token": raw}, timeout=15)
    r.raise_for_status()
    jwt = r.json()["token"]

    yield slug, jwt

    async def _cleanup():
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]
        await db.makers.delete_many({"slug": slug})
        client.close()
    asyncio.run(_cleanup())


@pytest.fixture(scope="module")
def admin_jwt():
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    from maker_auth import issue_admin_magic_token
    super_email = (os.environ.get("ADMIN_EMAILS") or os.environ.get("OPS_EMAIL") or "team@craftersmarket.org").split(",")[0].strip()
    tok = issue_admin_magic_token(super_email)
    r = requests.post(f"{BASE_URL}/api/admin/auth/verify", json={"token": tok}, timeout=15)
    r.raise_for_status()
    return r.json()["token"]


def test_apply_requires_auth():
    r = requests.post(f"{BASE_URL}/api/maker/brand-kit/apply", timeout=15)
    assert r.status_code in (401, 403)


def test_dismiss_requires_auth():
    r = requests.post(f"{BASE_URL}/api/maker/brand-kit/dismiss", timeout=15)
    assert r.status_code in (401, 403)


def test_adoption_requires_admin():
    r = requests.get(f"{BASE_URL}/api/admin/brand-kit/adoption", timeout=15)
    assert r.status_code in (401, 403)


def test_apply_is_idempotent_and_persists(fresh_maker):
    slug, jwt = fresh_maker
    H = {"Authorization": f"Bearer {jwt}"}

    # First apply → newly_applied=True.
    r1 = requests.post(f"{BASE_URL}/api/maker/brand-kit/apply", headers=H, timeout=15)
    assert r1.status_code == 200, r1.text
    b1 = r1.json()
    assert b1["applied"] is True
    assert b1["newly_applied"] is True
    first_ts = b1["applied_at"]

    # Second apply → newly_applied=False, same timestamp.
    r2 = requests.post(f"{BASE_URL}/api/maker/brand-kit/apply", headers=H, timeout=15)
    assert r2.status_code == 200, r2.text
    b2 = r2.json()
    assert b2["applied"] is True
    assert b2["newly_applied"] is False
    assert b2["applied_at"] == first_ts, "idempotent apply must preserve original timestamp"

    # Confirm persistence via /maker/me.
    me = requests.get(f"{BASE_URL}/api/maker/me", headers=H, timeout=15).json()
    assert me.get("brand_kit_applied") is True
    assert me.get("brand_kit_applied_at") == first_ts


def test_dismiss_persists_without_undoing_apply(fresh_maker):
    slug, jwt = fresh_maker
    H = {"Authorization": f"Bearer {jwt}"}
    # Apply first, then dismiss — applied state must survive.
    requests.post(f"{BASE_URL}/api/maker/brand-kit/apply", headers=H, timeout=15)
    r = requests.post(f"{BASE_URL}/api/maker/brand-kit/dismiss", headers=H, timeout=15)
    assert r.status_code == 200
    assert r.json()["dismissed"] is True
    me = requests.get(f"{BASE_URL}/api/maker/me", headers=H, timeout=15).json()
    assert me.get("brand_kit_dismissed") is True
    assert me.get("brand_kit_applied") is True, (
        "dismissing the card must NOT undo a prior apply"
    )


def test_apply_blocks_non_approved_makers():
    """A pending maker (no `approved_at`, status != approved) must get 403."""
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    from maker_auth import issue_magic_token as issue_maker_magic_token
    from motor.motor_asyncio import AsyncIOMotorClient

    suffix = uuid.uuid4().hex[:8]
    slug = f"iter413bw-pending-{suffix}"
    email = f"{slug}@example.com"

    async def _seed():
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]
        await db.makers.insert_one({
            "id": str(uuid.uuid4()), "slug": slug, "name": "pending",
            "initials": "PD", "location": "", "bio": "",
            "portrait": "", "cover": "", "email": email,
            # NB: no status, no approved_at
            "tier": "free", "created_at": datetime.now(timezone.utc).isoformat(),
        })
        client.close()
    asyncio.run(_seed())

    try:
        raw = issue_maker_magic_token(email)
        r = requests.post(f"{BASE_URL}/api/maker/auth/verify", json={"token": raw}, timeout=15)
        r.raise_for_status()
        jwt = r.json()["token"]
        H = {"Authorization": f"Bearer {jwt}"}
        r = requests.post(f"{BASE_URL}/api/maker/brand-kit/apply", headers=H, timeout=15)
        assert r.status_code == 403
    finally:
        async def _cleanup():
            client = AsyncIOMotorClient(os.environ["MONGO_URL"])
            db = client[os.environ["DB_NAME"]]
            await db.makers.delete_many({"slug": slug})
            client.close()
        asyncio.run(_cleanup())


def test_adoption_shape(admin_jwt):
    H = {"Authorization": f"Bearer {admin_jwt}"}
    r = requests.get(f"{BASE_URL}/api/admin/brand-kit/adoption", headers=H, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    for k in ("approved", "applied", "dismissed", "pending", "applied_pct"):
        assert k in body, f"adoption payload missing {k!r}"
    # Sanity: applied + dismissed + pending == approved (within rounding).
    assert body["applied"] + body["dismissed"] + body["pending"] == body["approved"]
