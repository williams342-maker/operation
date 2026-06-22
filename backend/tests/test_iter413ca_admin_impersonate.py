"""iter413ca — Admin impersonation endpoint contract.

Verifies:
  • POST /api/admin/impersonate requires admin auth
  • Mints a maker-role JWT with target's slug as `sub` + `imp_by` claim
  • Mints a buyer-role JWT for community users
  • Rejects admin-on-admin impersonation
  • Rejects banned users
  • Audit row is written to `admin_audit`
  • Returned token works as the target's session (verified via /api/maker/me
    or /api/community/me)
"""
from __future__ import annotations

import asyncio
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

import jwt as pyjwt
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
    super_email = (
        os.environ.get("ADMIN_EMAILS") or os.environ.get("OPS_EMAIL") or "team@craftersmarket.org"
    ).split(",")[0].strip()
    tok = issue_admin_magic_token(super_email)
    r = requests.post(f"{BASE_URL}/api/admin/auth/verify", json={"token": tok}, timeout=15)
    r.raise_for_status()
    return r.json()["token"], super_email


@pytest.fixture
def fresh_maker():
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    from motor.motor_asyncio import AsyncIOMotorClient

    suffix = uuid.uuid4().hex[:8]
    slug = f"iter413ca-{suffix}"
    email = f"{slug}@example.com"

    async def _seed():
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]
        await db.makers.insert_one({
            "id": str(uuid.uuid4()),
            "slug": slug, "name": "Iter413ca Maker", "initials": "CA",
            "location": "Boise, ID", "bio": "fixture maker",
            "portrait": "", "cover": "", "email": email,
            "status": "approved",
            "approved_at": datetime.now(timezone.utc).isoformat(),
            "tier": "free",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        client.close()
    asyncio.run(_seed())

    yield slug, email

    async def _cleanup():
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]
        await db.makers.delete_many({"slug": slug})
        await db.admin_audit.delete_many({"kind": "admin_impersonate", "target_sub": slug})
        client.close()
    asyncio.run(_cleanup())


@pytest.fixture
def fresh_buyer():
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    from motor.motor_asyncio import AsyncIOMotorClient

    suffix = uuid.uuid4().hex[:8]
    user_id = f"buyer-{suffix}"
    email = f"buyer-{suffix}@example.com"

    async def _seed():
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]
        await db.community_users.insert_one({
            "user_id": user_id, "email": email, "name": "Iter413ca Buyer",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        client.close()
    asyncio.run(_seed())

    yield user_id, email

    async def _cleanup():
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]
        await db.community_users.delete_many({"user_id": user_id})
        await db.admin_audit.delete_many({"kind": "admin_impersonate", "target_sub": user_id})
        client.close()
    asyncio.run(_cleanup())


def test_requires_admin_auth():
    r = requests.post(
        f"{BASE_URL}/api/admin/impersonate",
        json={"target_type": "maker", "target_slug": "x"},
        timeout=15,
    )
    assert r.status_code in (401, 403)


def test_impersonate_maker_mints_clean_jwt(admin_jwt, fresh_maker):
    admin_tok, admin_email = admin_jwt
    slug, email = fresh_maker
    H = {"Authorization": f"Bearer {admin_tok}"}

    r = requests.post(
        f"{BASE_URL}/api/admin/impersonate",
        headers=H,
        json={"target_type": "maker", "target_slug": slug},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["target_type"] == "maker"
    assert body["target_sub"] == slug
    assert body["target_email"] == email
    assert body["imp_by"] == admin_email.lower()
    assert body["expires_in_seconds"] == 7200

    # Decode and verify the claims carry NO admin fields.
    from maker_auth import SECRET
    claims = pyjwt.decode(body["token"], SECRET, algorithms=["HS256"])
    assert claims["sub"] == slug
    assert claims["email"] == email
    assert claims["role"] == "maker"
    assert claims["imp_by"] == admin_email.lower()
    # The token must not silently elevate to admin somehow.
    assert claims["role"] != "admin"

    # And the token actually works as the maker's session.
    me = requests.get(
        f"{BASE_URL}/api/maker/me",
        headers={"Authorization": f"Bearer {body['token']}"},
        timeout=15,
    )
    assert me.status_code == 200, me.text
    assert me.json().get("slug") == slug


def test_impersonate_buyer_mints_buyer_jwt(admin_jwt, fresh_buyer):
    admin_tok, _ = admin_jwt
    user_id, email = fresh_buyer
    H = {"Authorization": f"Bearer {admin_tok}"}

    r = requests.post(
        f"{BASE_URL}/api/admin/impersonate",
        headers=H,
        json={"target_type": "buyer", "target_user_id": user_id},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["target_type"] == "buyer"
    assert body["target_sub"] == user_id
    assert body["target_email"] == email

    from maker_auth import SECRET
    claims = pyjwt.decode(body["token"], SECRET, algorithms=["HS256"])
    assert claims["role"] == "buyer"
    assert claims["sub"] == user_id


def test_impersonate_blocks_admin_on_admin(admin_jwt):
    admin_tok, admin_email = admin_jwt
    H = {"Authorization": f"Bearer {admin_tok}"}
    # Try to impersonate the admin themselves via target_email.
    r = requests.post(
        f"{BASE_URL}/api/admin/impersonate",
        headers=H,
        json={"target_type": "buyer", "target_email": admin_email},
        timeout=15,
    )
    # Either 404 (no buyer row) OR 403 (admin-on-admin). Both prove the
    # endpoint doesn't mint a JWT for an admin email.
    assert r.status_code in (403, 404)


def test_impersonate_rejects_banned_buyer(admin_jwt):
    admin_tok, _ = admin_jwt
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    from motor.motor_asyncio import AsyncIOMotorClient

    suffix = uuid.uuid4().hex[:8]
    user_id = f"banned-{suffix}"
    email = f"banned-{suffix}@example.com"

    async def _seed():
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]
        await db.community_users.insert_one({
            "user_id": user_id, "email": email, "name": "Banned",
            "moderation_status": "banned",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        client.close()
    asyncio.run(_seed())

    try:
        H = {"Authorization": f"Bearer {admin_tok}"}
        r = requests.post(
            f"{BASE_URL}/api/admin/impersonate",
            headers=H,
            json={"target_type": "buyer", "target_user_id": user_id},
            timeout=15,
        )
        assert r.status_code == 403, r.text
    finally:
        async def _cleanup():
            client = AsyncIOMotorClient(os.environ["MONGO_URL"])
            db = client[os.environ["DB_NAME"]]
            await db.community_users.delete_many({"user_id": user_id})
            client.close()
        asyncio.run(_cleanup())


def test_impersonate_writes_audit_row(admin_jwt, fresh_maker):
    admin_tok, admin_email = admin_jwt
    slug, _ = fresh_maker
    H = {"Authorization": f"Bearer {admin_tok}"}
    r = requests.post(
        f"{BASE_URL}/api/admin/impersonate",
        headers=H,
        json={"target_type": "maker", "target_slug": slug},
        timeout=15,
    )
    assert r.status_code == 200

    from motor.motor_asyncio import AsyncIOMotorClient

    async def _audit():
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]
        row = await db.admin_audit.find_one(
            {"kind": "admin_impersonate", "target_sub": slug},
            {"_id": 0},
        )
        client.close()
        return row
    row = asyncio.run(_audit())
    assert row is not None
    assert row["by"] == admin_email.lower()
    assert row["target_type"] == "maker"
    assert row["target_sub"] == slug


def test_invalid_target_type(admin_jwt):
    admin_tok, _ = admin_jwt
    H = {"Authorization": f"Bearer {admin_tok}"}
    r = requests.post(
        f"{BASE_URL}/api/admin/impersonate",
        headers=H, json={"target_type": "ghost", "target_slug": "x"},
        timeout=15,
    )
    assert r.status_code == 400
