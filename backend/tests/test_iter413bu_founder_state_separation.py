"""iter413bu — Founding Access (temporary) vs Founding Seller (permanent)
UX separation: admin Applications API.

Verifies the `/admin/maker-applications` payload now carries the
permanent-Founder fields so the UI can render the correct card:
  • maker_tier
  • maker_founder_status
  • maker_founder_started_at
  • maker_is_founder_permanent   (derived bool — UI hides countdown if True)

Two seeded fixtures cover the two states:
  A. is_beta=True (temporary 90-day Founding Access) → is_founder_permanent=False
  B. tier=founder + founder_status=inaugural → is_founder_permanent=True
"""
from __future__ import annotations

import asyncio
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone
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
    super_email = (os.environ.get("ADMIN_EMAILS") or os.environ.get("OPS_EMAIL") or "team@craftersmarket.org").split(",")[0].strip()
    tok = issue_admin_magic_token(super_email)
    r = requests.post(f"{BASE_URL}/api/admin/auth/verify", json={"token": tok}, timeout=15)
    r.raise_for_status()
    return r.json()["token"]


@pytest.fixture
def H(admin_jwt):
    return {"Authorization": f"Bearer {admin_jwt}"}


def _seed_pair():
    """Seed one maker on temporary Founding Access + one on permanent
    Founder tier, each with a paired (approved) application doc."""
    from motor.motor_asyncio import AsyncIOMotorClient

    async def _go():
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]
        now = datetime.now(timezone.utc)
        suffix = uuid.uuid4().hex[:8]
        # A — Temporary Founding Access maker
        access_email = f"iter413bu-access-{suffix}@example.com"
        access_slug = f"iter413bu-access-{suffix}"
        await db.makers.insert_one({
            "id": str(uuid.uuid4()),
            "slug": access_slug,
            "name": "iter413bu Access",
            "email": access_email,
            "status": "approved",
            "tier": "free",
            "is_beta": True,
            "beta_approved_at": now.isoformat(),
            "beta_expires_at": (now + timedelta(days=90)).isoformat(),
            "created_at": now.isoformat(),
        })
        await db.maker_applications.insert_one({
            "id": str(uuid.uuid4()),
            "name": "iter413bu Access",
            "email": access_email,
            "studio_name": f"iter413bu access studio {suffix}",
            "location": "Reno, NV",
            "techniques": ["Laser"],
            "about": "iter413bu access fixture.",
            "is_beta": True,
            "status": "approved",
            "created_at": now.isoformat(),
        })

        # B — Permanent inaugural Founder maker
        founder_email = f"iter413bu-founder-{suffix}@example.com"
        founder_slug = f"iter413bu-founder-{suffix}"
        await db.makers.insert_one({
            "id": str(uuid.uuid4()),
            "slug": founder_slug,
            "name": "iter413bu Founder",
            "email": founder_email,
            "status": "approved",
            "tier": "founder",
            "founder_status": "inaugural",
            "founder_started_at": now.isoformat(),
            "created_at": now.isoformat(),
        })
        await db.maker_applications.insert_one({
            "id": str(uuid.uuid4()),
            "name": "iter413bu Founder",
            "email": founder_email,
            "studio_name": f"iter413bu founder studio {suffix}",
            "location": "Austin, TX",
            "techniques": ["Wood"],
            "about": "iter413bu founder fixture.",
            "is_beta": False,
            "status": "approved",
            "created_at": now.isoformat(),
        })
        client.close()
        return access_email, founder_email

    return asyncio.run(_go())


def _cleanup(emails):
    from motor.motor_asyncio import AsyncIOMotorClient

    async def _go():
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]
        await db.makers.delete_many({"email": {"$in": list(emails)}})
        await db.maker_applications.delete_many({"email": {"$in": list(emails)}})
        client.close()

    asyncio.run(_go())


def test_applications_payload_separates_temporary_and_permanent(H):
    access_email, founder_email = _seed_pair()
    try:
        r = requests.get(f"{BASE_URL}/api/admin/maker-applications", headers=H, timeout=30)
        assert r.status_code == 200, r.text
        apps = r.json()
        by_email = {a["email"]: a for a in apps}

        # ── A · Temporary Founding Access ────────────────────────
        a = by_email.get(access_email)
        assert a is not None, "expected the seeded Founding Access app in the response"
        assert a.get("maker_is_beta") is True
        assert a.get("maker_beta_expires_at"), "temporary access must carry an expiry"
        assert a.get("maker_is_founder_permanent") is False, (
            "Founding Access (90-day) maker must NOT be flagged permanent"
        )
        # Tier may still be 'free' on access-only makers, but the field MUST be hydrated.
        assert "maker_tier" in a

        # ── B · Permanent Founder ────────────────────────────────
        f = by_email.get(founder_email)
        assert f is not None, "expected the seeded Founder app in the response"
        assert f.get("maker_is_founder_permanent") is True
        assert f.get("maker_tier") == "founder"
        assert f.get("maker_founder_status") == "inaugural"
        assert f.get("maker_founder_started_at"), "permanent Founder must carry a start date"
    finally:
        _cleanup({access_email, founder_email})


def test_requires_admin_auth():
    r = requests.get(f"{BASE_URL}/api/admin/maker-applications", timeout=15)
    assert r.status_code in (401, 403)
