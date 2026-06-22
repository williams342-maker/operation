"""iter413cb — Impersonation bug-report endpoint contract.

Verifies:
  • POST /api/admin/impersonation-bug-report requires admin auth
  • Filing inserts into contact_messages with topic='bug', kind='impersonation_bug'
  • Body bundles URL + admin note + recent console errors
  • Admin audit row written
  • 400 when note < 4 chars
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


def test_requires_admin_auth():
    r = requests.post(
        f"{BASE_URL}/api/admin/impersonation-bug-report",
        json={"target_type": "maker", "target_sub": "x", "admin_note": "hello"},
        timeout=15,
    )
    assert r.status_code in (401, 403)


def test_rejects_short_note(admin_jwt):
    tok, _ = admin_jwt
    r = requests.post(
        f"{BASE_URL}/api/admin/impersonation-bug-report",
        headers={"Authorization": f"Bearer {tok}"},
        json={
            "target_type": "maker", "target_sub": "iron-and-oak",
            "admin_note": "x",
        },
        timeout=15,
    )
    assert r.status_code == 400


def test_files_bug_to_contact_inbox(admin_jwt):
    tok, admin_email = admin_jwt
    suffix = uuid.uuid4().hex[:8]
    note = f"iter413cb test — checkout broken {suffix}"
    r = requests.post(
        f"{BASE_URL}/api/admin/impersonation-bug-report",
        headers={"Authorization": f"Bearer {tok}"},
        json={
            "target_type": "maker",
            "target_sub": "iron-and-oak",
            "target_email": "iron-and-oak@craftersmarket.org",
            "target_name": "Iron & Oak",
            "current_url": "https://example.com/checkout?cart=abc",
            "admin_note": note,
            "console_errors": [
                {"kind": "console.error", "msg": "TypeError: x is not a function", "at": "2026-02-23T00:00:00Z"},
                {"kind": "window.error", "msg": "Script error.", "at": "2026-02-23T00:00:01Z"},
            ],
        },
        timeout=15,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["received"] is True
    msg_id = body["id"]

    # Verify via admin contact inbox.
    listing = requests.get(
        f"{BASE_URL}/api/admin/contact-messages?topic=bug&limit=50",
        headers={"Authorization": f"Bearer {tok}"},
        timeout=15,
    )
    assert listing.status_code == 200, listing.text
    rows = listing.json().get("rows") or listing.json().get("items") or []
    match = next((r for r in rows if r.get("id") == msg_id), None)
    assert match is not None, f"bug report not surfaced in contact inbox; got {len(rows)} rows"
    assert match["topic"] == "bug"
    assert match.get("kind") == "impersonation_bug"
    assert note in match["message"]
    assert "iron-and-oak" in match["message"]
    assert "https://example.com/checkout?cart=abc" in match["message"]
    assert "TypeError" in match["message"]
    assert match.get("impersonation_meta", {}).get("target_sub") == "iron-and-oak"

    # And audit row.
    from motor.motor_asyncio import AsyncIOMotorClient

    async def _audit():
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]
        row = await db.admin_audit.find_one(
            {"kind": "impersonation_bug_filed", "contact_message_id": msg_id},
            {"_id": 0},
        )
        client.close()
        return row
    audit = asyncio.run(_audit())
    assert audit is not None
    assert audit["by"] == admin_email.lower()

    # Cleanup.
    async def _cleanup():
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]
        await db.contact_messages.delete_many({"id": msg_id})
        await db.admin_audit.delete_many({"contact_message_id": msg_id})
        client.close()
    asyncio.run(_cleanup())
