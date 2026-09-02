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

_DB_AT_IMPORT = os.environ.get("DB_NAME")  # diagnostic: value at collection time
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
        # DIAGNOSTIC (2026-09-02). This fixture, and four sibling iter413 modules,
        # fail with an opaque 404 from POST /api/maker/auth/verify — "Maker no
        # longer exists." The token itself is fine: a bad signature answers 401,
        # so it decodes and the email lookup is what misses. What could not be
        # determined from outside is whether the insert above ever landed, and in
        # which database. Reading the row back through the SAME client answers
        # that, and makes the fixture fail with its own reason instead of handing
        # the failure to an endpoint that only knows the row is absent.
        back = await db.makers.find_one({"email": email}, {"_id": 0, "slug": 1})
        wrote = await db.makers.count_documents({"email": email})
        c.close()
        if not back:
            raise AssertionError(
                "seed insert did not land: db=%r mongo=%r email=%r matched=%d"
                % (os.environ.get("DB_NAME"), os.environ.get("MONGO_URL"), email, wrote))
    asyncio.run(_seed())

    tok = issue_magic_token(email)
    r = requests.post(f"{BASE_URL}/api/maker/auth/verify", json={"token": tok}, timeout=15)
    if r.status_code != 200:
        # The read-back above already proved the row IS present from this
        # process's view of the database. If the server then cannot find it,
        # the two processes are not looking at the same place — so report
        # which place THIS one used. The server's own DB_NAME comes from the
        # job environment and is not visible from here, which is exactly the
        # comparison this message is meant to enable.
        raise AssertionError(
            "verify %d after a CONFIRMED seed. DB_NAME at import=%r, at fixture=%r "
            "(job sets backend_ci_test). mongo=%r email=%r; server said: %s"
            % (r.status_code, _DB_AT_IMPORT, os.environ.get("DB_NAME"),
               os.environ.get("MONGO_URL"), email, r.text[:120]))
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
