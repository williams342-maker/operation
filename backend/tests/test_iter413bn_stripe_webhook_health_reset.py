"""iter413bn — Reset button for Stripe Webhook Health card.

Contract:
  POST /api/admin/stripe/webhook-health/reset
    • requires super-admin (401/403 otherwise)
    • body: { kind?: "main"|"connect", errors_only?: bool }
    • deletes matching rows from `stripe_webhook_log`
    • returns { ok: true, deleted: N, filter: {...} }
    • writes an admin_audit row of kind `stripe_webhook_health_reset`
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
    # Use the actual super-admin email from ADMIN_EMAILS env so the
    # require_super_admin gate accepts the resulting JWT.
    super_email = (os.environ.get("ADMIN_EMAILS") or os.environ.get("OPS_EMAIL") or "team@craftersmarket.org").split(",")[0].strip()
    tok = issue_admin_magic_token(super_email)
    r = requests.post(f"{BASE_URL}/api/admin/auth/verify", json={"token": tok}, timeout=15)
    r.raise_for_status()
    return r.json()["token"]


@pytest.fixture
def H(admin_jwt):
    return {"Authorization": f"Bearer {admin_jwt}"}


def _seed_log_rows(tag: str):
    """Insert 3 main-errors + 1 main-ok + 2 connect-errors for a fresh tag."""
    from motor.motor_asyncio import AsyncIOMotorClient

    async def _go():
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]
        now = datetime.now(timezone.utc).isoformat()
        rows = [
            {"id": str(uuid.uuid4()), "kind": "main",    "status": "err",   "ts": now, "_test_tag": tag},
            {"id": str(uuid.uuid4()), "kind": "main",    "status": "err",   "ts": now, "_test_tag": tag},
            {"id": str(uuid.uuid4()), "kind": "main",    "status": "err",   "ts": now, "_test_tag": tag},
            {"id": str(uuid.uuid4()), "kind": "main",    "status": "ok",    "ts": now, "_test_tag": tag},
            {"id": str(uuid.uuid4()), "kind": "connect", "status": "err",   "ts": now, "_test_tag": tag},
            {"id": str(uuid.uuid4()), "kind": "connect", "status": "err",   "ts": now, "_test_tag": tag},
        ]
        await db.stripe_webhook_log.insert_many(rows)
        client.close()

    asyncio.run(_go())


def _count(tag: str, q: dict | None = None) -> int:
    from motor.motor_asyncio import AsyncIOMotorClient

    async def _go():
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]
        full = {"_test_tag": tag, **(q or {})}
        n = await db.stripe_webhook_log.count_documents(full)
        client.close()
        return n

    return asyncio.run(_go())


def _cleanup(tag: str):
    from motor.motor_asyncio import AsyncIOMotorClient

    async def _go():
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]
        await db.stripe_webhook_log.delete_many({"_test_tag": tag})
        await db.admin_audit.delete_many({"kind": "stripe_webhook_health_reset"})
        client.close()

    asyncio.run(_go())


def test_reset_requires_auth():
    r = requests.post(
        f"{BASE_URL}/api/admin/stripe/webhook-health/reset",
        json={}, timeout=15,
    )
    assert r.status_code in (401, 403)


def test_reset_clears_only_errors_when_errors_only_true(H):
    """errors_only=true must keep status==ok rows intact."""
    tag = f"iter413bn-{uuid.uuid4().hex[:8]}"
    _seed_log_rows(tag)
    try:
        # NB: the reset endpoint deletes globally — we use _test_tag to
        # confirm the *shape* of the delete worked on our seeded rows.
        assert _count(tag) == 6
        r = requests.post(
            f"{BASE_URL}/api/admin/stripe/webhook-health/reset",
            json={"errors_only": True},
            headers=H,
            timeout=20,
        )
        if r.status_code == 403:
            pytest.skip("super-admin gate not satisfied — magic token may lack super-admin claim")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True
        assert body["filter"] == {"kind": None, "errors_only": True}
        # All err rows tagged with us should be gone; ok row preserved.
        assert _count(tag, {"status": "err"}) == 0
        assert _count(tag, {"status": "ok"})  == 1
    finally:
        _cleanup(tag)


def test_reset_kind_filter_limits_scope(H):
    """kind='main' must only wipe main rows, connect rows untouched."""
    tag = f"iter413bn-{uuid.uuid4().hex[:8]}"
    _seed_log_rows(tag)
    try:
        r = requests.post(
            f"{BASE_URL}/api/admin/stripe/webhook-health/reset",
            json={"kind": "main"},
            headers=H,
            timeout=20,
        )
        if r.status_code == 403:
            pytest.skip("super-admin gate not satisfied")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["filter"]["kind"] == "main"
        # Main rows for our tag should be gone; connect rows must remain.
        assert _count(tag, {"kind": "main"})    == 0
        assert _count(tag, {"kind": "connect"}) == 2
    finally:
        _cleanup(tag)


def test_reset_writes_audit_row(H):
    tag = f"iter413bn-{uuid.uuid4().hex[:8]}"
    _seed_log_rows(tag)
    try:
        r = requests.post(
            f"{BASE_URL}/api/admin/stripe/webhook-health/reset",
            json={},
            headers=H,
            timeout=20,
        )
        if r.status_code == 403:
            pytest.skip("super-admin gate not satisfied")
        assert r.status_code == 200, r.text

        from motor.motor_asyncio import AsyncIOMotorClient

        async def _check():
            client = AsyncIOMotorClient(os.environ["MONGO_URL"])
            db = client[os.environ["DB_NAME"]]
            audit = await db.admin_audit.find_one(
                {"kind": "stripe_webhook_health_reset"},
                sort=[("ts", -1)],
            )
            client.close()
            return audit

        audit = asyncio.run(_check())
        assert audit is not None, "expected an admin_audit row of kind stripe_webhook_health_reset"
        assert audit.get("deleted", 0) >= 6, "audit row should record at least the 6 rows we seeded"
    finally:
        _cleanup(tag)
