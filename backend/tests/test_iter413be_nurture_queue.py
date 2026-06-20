"""iter413be — Nurture Queue (drafts only) contract.

CRITICAL INVARIANTS (per ops doc, strict):
  • No auto-send. No sequences. No email automation.
  • Cap MAX 2 drafts per lead, lifetime.
  • Stop immediately if lead's email appears in maker_applications.
  • Decisions are 'approve' OR 'dismiss' — NEVER 'send'.

Verifies:
  • POST /admin/nurture-queue/generate is idempotent (no dupes per type)
  • Cap enforcement: lead with 2 drafts can't receive a third
  • Stop-on-apply: pending drafts auto-stop when an application exists
  • POST /admin/nurture-queue/{id}/decision approves + dismisses
"""
from __future__ import annotations

import os
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
import pytest

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


def _seed_aged_lead() -> str:
    """Insert a synthetic lead-magnet subscriber 8 days old (past the
    7-day threshold). Returns the email so the caller can clean it up.
    Uses an email that is guaranteed NOT to match any existing maker
    application (random uuid prefix)."""
    import asyncio
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    from motor.motor_asyncio import AsyncIOMotorClient

    email = f"nurture-test-{uuid.uuid4().hex[:8]}@example.com"
    eight_days_ago = (datetime.now(timezone.utc) - timedelta(days=8)).isoformat()

    async def _go():
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]
        await db.lead_magnet_subscribers.insert_one({
            "id": str(uuid.uuid4()),
            "email": email,
            "first_seen_at": eight_days_ago,
            "created_at": eight_days_ago,
            "consent_marketing": False,
            "source": "test",
            "campaign": "iter413be",
        })
        client.close()

    asyncio.run(_go())
    return email


def _wipe_lead(email: str):
    import asyncio
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    from motor.motor_asyncio import AsyncIOMotorClient

    async def _go():
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]
        await db.lead_magnet_subscribers.delete_many({"email": email})
        await db.nurture_drafts.delete_many({"lead_email": email})
        await db.maker_applications.delete_many({"email": email})
        client.close()

    asyncio.run(_go())


def test_list_requires_admin():
    r = requests.get(f"{BASE_URL}/api/admin/nurture-queue", timeout=15)
    assert r.status_code in (401, 403)


def test_list_shape(H):
    r = requests.get(f"{BASE_URL}/api/admin/nurture-queue", headers=H, timeout=20)
    assert r.status_code == 200, r.text
    body = r.json()
    for k in ("scanned_at", "thresholds", "counts", "pending", "recent", "uncovered_leads"):
        assert k in body
    assert body["thresholds"]["stale_lead_days"] == 7
    assert body["thresholds"]["max_drafts_per_lead"] == 2


def test_generate_is_idempotent_and_respects_cap(H):
    """Two consecutive Generate calls for the same aged lead should
    produce exactly 2 drafts (the cap) — never 4."""
    email = _seed_aged_lead()
    try:
        # First generate
        r1 = requests.post(f"{BASE_URL}/api/admin/nurture-queue/generate", headers=H, timeout=20)
        assert r1.status_code == 200, r1.text

        # Second generate — should NOT create more.
        r2 = requests.post(f"{BASE_URL}/api/admin/nurture-queue/generate", headers=H, timeout=20)
        assert r2.status_code == 200, r2.text

        # Verify the seeded lead has exactly 2 drafts in DB.
        import asyncio
        from motor.motor_asyncio import AsyncIOMotorClient

        async def _count():
            client = AsyncIOMotorClient(os.environ["MONGO_URL"])
            db = client[os.environ["DB_NAME"]]
            n = await db.nurture_drafts.count_documents({"lead_email": email})
            client.close()
            return n

        count = asyncio.run(_count())
        assert count == 2, f"expected 2 drafts (cap), got {count}"

        # Both drafts have distinct types.
        async def _types():
            client = AsyncIOMotorClient(os.environ["MONGO_URL"])
            db = client[os.environ["DB_NAME"]]
            types = await db.nurture_drafts.distinct("draft_type", {"lead_email": email})
            client.close()
            return sorted(types)

        types = asyncio.run(_types())
        assert len(types) == 2
        assert all(t in ("nudge", "spotlight", "invitation") for t in types)
    finally:
        _wipe_lead(email)


def test_decision_approves_and_dismisses(H):
    """Approve one draft, dismiss the other. Re-list and verify counts."""
    email = _seed_aged_lead()
    try:
        requests.post(f"{BASE_URL}/api/admin/nurture-queue/generate", headers=H, timeout=20).raise_for_status()
        listing = requests.get(f"{BASE_URL}/api/admin/nurture-queue", headers=H, timeout=20).json()
        mine = [d for d in listing["pending"] if d["lead_email"] == email]
        assert len(mine) == 2

        approve_r = requests.post(
            f"{BASE_URL}/api/admin/nurture-queue/{mine[0]['id']}/decision",
            json={"decision": "approve"}, headers=H, timeout=15,
        )
        assert approve_r.status_code == 200
        assert approve_r.json()["status"] == "approved"

        dismiss_r = requests.post(
            f"{BASE_URL}/api/admin/nurture-queue/{mine[1]['id']}/decision",
            json={"decision": "dismiss"}, headers=H, timeout=15,
        )
        assert dismiss_r.status_code == 200
        assert dismiss_r.json()["status"] == "dismissed"

        # Double-decision must fail.
        double = requests.post(
            f"{BASE_URL}/api/admin/nurture-queue/{mine[0]['id']}/decision",
            json={"decision": "dismiss"}, headers=H, timeout=15,
        )
        assert double.status_code == 400
    finally:
        _wipe_lead(email)


def test_application_submitted_auto_stops_pending_drafts(H):
    """If the lead submits an application AFTER drafts are generated,
    the next /admin/nurture-queue GET must auto-flip pending → stopped."""
    email = _seed_aged_lead()
    try:
        requests.post(f"{BASE_URL}/api/admin/nurture-queue/generate", headers=H, timeout=20).raise_for_status()

        # Synthesize an application for that lead.
        import asyncio
        from motor.motor_asyncio import AsyncIOMotorClient

        async def _apply():
            client = AsyncIOMotorClient(os.environ["MONGO_URL"])
            db = client[os.environ["DB_NAME"]]
            await db.maker_applications.insert_one({
                "id": str(uuid.uuid4()),
                "email": email,
                "name": "iter413be test",
                "status": "pending",
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
            client.close()

        asyncio.run(_apply())

        # Trigger the listing — handler should auto-stop pending drafts.
        listing = requests.get(f"{BASE_URL}/api/admin/nurture-queue", headers=H, timeout=20).json()
        mine_pending = [d for d in listing["pending"] if d["lead_email"] == email]
        assert mine_pending == []

        async def _check_stopped():
            client = AsyncIOMotorClient(os.environ["MONGO_URL"])
            db = client[os.environ["DB_NAME"]]
            n_stopped = await db.nurture_drafts.count_documents(
                {"lead_email": email, "status": "stopped"})
            client.close()
            return n_stopped

        assert asyncio.run(_check_stopped()) == 2
    finally:
        _wipe_lead(email)


def test_no_send_endpoint_exists():
    """Defensive: per spec the queue has NO /send route. Verify the
    URL surface only includes the documented ones."""
    # Spot-check a "send" verb — should NOT exist.
    r = requests.post(f"{BASE_URL}/api/admin/nurture-queue/anything/send", timeout=10)
    assert r.status_code in (404, 405)
