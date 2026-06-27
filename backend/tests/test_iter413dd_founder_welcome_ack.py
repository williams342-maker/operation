"""iter413dd — Founder welcome modal ack endpoint contract.

Verifies:
  • /maker/me default — `founder_welcome_seen=False` for newly-promoted founders
  • /maker/founder-welcome/ack flips the flag to True
  • Idempotent — a second ack still 200, flag stays True
  • Auth required — 401/403 without a maker JWT
"""
from __future__ import annotations

import asyncio
import os
import sys
import uuid
from pathlib import Path

import pytest
import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dotenv import load_dotenv
load_dotenv("/app/frontend/.env")
load_dotenv("/app/backend/.env")

BASE_URL = (
    os.environ.get("REACT_APP_BACKEND_URL")
    or "https://active-project-4.preview.emergentagent.com"
).rstrip("/")


@pytest.fixture()
def founder():
    """Seed an Inaugural-Founder maker doc + mint a magic-link JWT.
    Tears down at the end of the test."""
    from motor.motor_asyncio import AsyncIOMotorClient
    from maker_auth import issue_magic_token

    slug = f"iter413dd-{uuid.uuid4().hex[:8]}"
    email = f"{slug}@test.com"

    async def _seed():
        c = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = c[os.environ["DB_NAME"]]
        await db.makers.insert_one({
            "id": str(uuid.uuid4()), "slug": slug, "email": email,
            "name": "iter413dd Founder", "shop_name": "Founder Test",
            "initials": "FT", "location": "Test", "bio": "test",
            "portrait": "", "cover": "",
            "status": "approved", "tier": "founder",
            "founder_status": "inaugural", "founder_number": 99,
            "subscription_status": "free", "session_version": 0,
        })
        c.close()
    asyncio.run(_seed())

    tok = issue_magic_token(email)
    r = requests.post(f"{BASE_URL}/api/maker/auth/verify", json={"token": tok}, timeout=15)
    r.raise_for_status()
    jwt = r.json()["token"]

    yield {"slug": slug, "email": email, "jwt": jwt}

    async def _wipe():
        c = AsyncIOMotorClient(os.environ["MONGO_URL"])
        await c[os.environ["DB_NAME"]].makers.delete_one({"slug": slug})
        c.close()
    asyncio.run(_wipe())


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


def test_default_flag_is_false(founder):
    r = requests.get(f"{BASE_URL}/api/maker/me", headers=_h(founder["jwt"]), timeout=15)
    assert r.status_code == 200
    me = r.json()
    assert me["tier"] == "founder"
    assert me["founder_number"] == 99
    assert me["founder_welcome_seen"] is False


def test_ack_flips_flag_idempotent(founder):
    # First ack flips
    r1 = requests.post(
        f"{BASE_URL}/api/maker/founder-welcome/ack",
        headers=_h(founder["jwt"]), timeout=15,
    )
    assert r1.status_code == 200
    assert r1.json() == {"ok": True}
    me = requests.get(
        f"{BASE_URL}/api/maker/me", headers=_h(founder["jwt"]), timeout=15,
    ).json()
    assert me["founder_welcome_seen"] is True
    # Second ack still 200, flag stays true (no toggle / no error).
    r2 = requests.post(
        f"{BASE_URL}/api/maker/founder-welcome/ack",
        headers=_h(founder["jwt"]), timeout=15,
    )
    assert r2.status_code == 200
    me2 = requests.get(
        f"{BASE_URL}/api/maker/me", headers=_h(founder["jwt"]), timeout=15,
    ).json()
    assert me2["founder_welcome_seen"] is True


def test_ack_requires_auth():
    r = requests.post(f"{BASE_URL}/api/maker/founder-welcome/ack", timeout=15)
    assert r.status_code in (401, 403)
