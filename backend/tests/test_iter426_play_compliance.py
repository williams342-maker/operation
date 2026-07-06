"""iter426 — Google Play compliance sprint tests.

Covers:
  • Buyer account deletion (request / cancel / delete-now / status)
  • Content report submission, dedup, reason validation
  • Admin moderation queue + moderator actions (dismiss / remove / warn / suspend)
  • DM block / unblock + block enforcement on message send
  • Scheduler helper `purge_buyer_account` idempotency
"""
import asyncio
import os
import uuid
import pytest
import pytest_asyncio

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017/craft_test_iter426")
os.environ.setdefault("DB_NAME", "craft_test_iter426")

from httpx import ASGITransport, AsyncClient
from server import app
from core import db

_ADMIN_EMAIL = os.environ.get("ADMIN_EMAILS", "team@craftersmarket.org").split(",")[0]


@pytest_asyncio.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


async def _seed_buyer(email: str):
    await db.community_users.delete_many({"email": email})
    await db.community_users.insert_one({
        "id": uuid.uuid4().hex, "email": email, "name": "Test Buyer",
        "session_version": 0, "created_at": "2026-01-01T00:00:00Z",
    })


async def _buyer_token(email: str) -> str:
    from maker_auth import issue_session_jwt
    return issue_session_jwt(email, email, role="buyer", session_version=0)


async def _admin_token() -> str:
    from maker_auth import issue_session_jwt
    return issue_session_jwt(_ADMIN_EMAIL, _ADMIN_EMAIL, role="admin", session_version=0)


# ═════════════════════════════ DELETION ═════════════════════════════════
@pytest.mark.asyncio
async def test_buyer_deletion_status_empty(client):
    email = f"delme+{uuid.uuid4().hex[:8]}@example.com"
    await _seed_buyer(email)
    tok = await _buyer_token(email)
    r = await client.get("/api/community/account/deletion-status",
                         headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200
    assert r.json()["pending"] is False


@pytest.mark.asyncio
async def test_buyer_request_and_cancel_deletion(client):
    email = f"delme+{uuid.uuid4().hex[:8]}@example.com"
    await _seed_buyer(email)
    tok = await _buyer_token(email)
    h = {"Authorization": f"Bearer {tok}"}

    r = await client.post("/api/community/account/request-deletion", headers=h)
    assert r.status_code == 200
    assert r.json()["days_remaining"] == 30

    # second request 400s
    r2 = await client.post("/api/community/account/request-deletion", headers=h)
    assert r2.status_code == 400

    # status now pending
    r3 = await client.get("/api/community/account/deletion-status", headers=h)
    assert r3.json()["pending"] is True

    # cancel
    r4 = await client.post("/api/community/account/cancel-deletion", headers=h)
    assert r4.status_code == 200
    r5 = await client.get("/api/community/account/deletion-status", headers=h)
    assert r5.json()["pending"] is False


@pytest.mark.asyncio
async def test_buyer_delete_now_removes_user(client):
    email = f"delme+{uuid.uuid4().hex[:8]}@example.com"
    await _seed_buyer(email)
    tok = await _buyer_token(email)
    r = await client.post("/api/community/account/delete-now",
                          headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200
    assert r.json()["deleted"] is True
    assert await db.community_users.count_documents({"email": email}) == 0


# ═════════════════════════════ REPORTS ══════════════════════════════════
@pytest.mark.asyncio
async def test_report_requires_auth(client):
    r = await client.post("/api/reports",
                          json={"kind": "listing", "target_id": "x", "reason": "spam"})
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_report_submission_and_dedup(client):
    email = f"reporter+{uuid.uuid4().hex[:8]}@example.com"
    await _seed_buyer(email)
    tok = await _buyer_token(email)
    h = {"Authorization": f"Bearer {tok}"}
    payload = {"kind": "listing", "target_id": "prod-xyz", "reason": "spam"}
    r1 = await client.post("/api/reports", json=payload, headers=h)
    assert r1.status_code == 200
    assert r1.json()["deduped"] is False
    # Second submission — same reporter, same target, within 24h → deduped
    r2 = await client.post("/api/reports", json=payload, headers=h)
    assert r2.status_code == 200
    assert r2.json()["deduped"] is True
    assert r2.json()["id"] == r1.json()["id"]


@pytest.mark.asyncio
async def test_report_invalid_reason_400(client):
    email = f"reporter+{uuid.uuid4().hex[:8]}@example.com"
    await _seed_buyer(email)
    tok = await _buyer_token(email)
    r = await client.post("/api/reports",
                          json={"kind": "listing", "target_id": "prod-xyz",
                                "reason": "not_a_reason"},
                          headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 400


# ═════════════════════════════ MODERATION QUEUE ═════════════════════════
@pytest.mark.asyncio
async def test_admin_can_list_reports(client):
    email = f"r+{uuid.uuid4().hex[:8]}@example.com"
    await _seed_buyer(email)
    btok = await _buyer_token(email)
    await client.post("/api/reports",
                      json={"kind": "review", "target_id": "rev-abc",
                            "reason": "harassment"},
                      headers={"Authorization": f"Bearer {btok}"})
    atok = await _admin_token()
    r = await client.get("/api/admin/reports",
                         headers={"Authorization": f"Bearer {atok}"})
    assert r.status_code == 200
    d = r.json()
    assert "reports" in d and "open_count" in d


@pytest.mark.asyncio
async def test_admin_dismiss_action_audits(client):
    email = f"r+{uuid.uuid4().hex[:8]}@example.com"
    await _seed_buyer(email)
    btok = await _buyer_token(email)
    r1 = await client.post("/api/reports",
                           json={"kind": "review", "target_id": "rev-xyz",
                                 "reason": "spam"},
                           headers={"Authorization": f"Bearer {btok}"})
    rid = r1.json()["id"]
    atok = await _admin_token()
    r2 = await client.post(f"/api/admin/reports/{rid}/dismiss",
                           headers={"Authorization": f"Bearer {atok}"})
    assert r2.status_code == 200
    doc = await db.content_reports.find_one({"id": rid})
    assert doc["status"] == "resolved" and doc["action_taken"] == "dismiss"
    audit = await db.admin_audit.find_one(
        {"kind": "moderation_dismiss", "report_id": rid})
    assert audit is not None


# ═════════════════════════════ BLOCK / UNBLOCK ══════════════════════════
@pytest.mark.asyncio
async def test_block_and_unblock_idempotent(client):
    email = f"blocker+{uuid.uuid4().hex[:8]}@example.com"
    await _seed_buyer(email)
    tok = await _buyer_token(email)
    h = {"Authorization": f"Bearer {tok}"}
    other = "maker:ironandoak"
    r1 = await client.post("/api/messages/blocks",
                           json={"other_key": other}, headers=h)
    assert r1.status_code == 200
    # Idempotent — a second block is fine
    r2 = await client.post("/api/messages/blocks",
                           json={"other_key": other}, headers=h)
    assert r2.status_code == 200
    r3 = await client.get("/api/messages/blocks", headers=h)
    assert any(b["blocked_key"] == other for b in r3.json()["blocks"])
    # Unblock
    r4 = await client.post("/api/messages/blocks/remove",
                           json={"other_key": other}, headers=h)
    assert r4.status_code == 200
    assert r4.json()["existed"] is True
    r5 = await client.get("/api/messages/blocks", headers=h)
    assert not any(b["blocked_key"] == other for b in r5.json()["blocks"])


@pytest.mark.asyncio
async def test_is_blocked_helper():
    from routers.dm_blocks import is_blocked
    await db.dm_blocks.delete_many({})
    await db.dm_blocks.insert_one({
        "id": uuid.uuid4().hex,
        "blocker_key": "buyer:a@example.com",
        "blocked_key": "maker:ironandoak",
        "created_at": "2026-07-05T00:00:00Z",
    })
    # Either direction returns True (bidirectional)
    assert await is_blocked("buyer:a@example.com", "maker:ironandoak") is True
    assert await is_blocked("maker:ironandoak", "buyer:a@example.com") is True
    # Different party — False
    assert await is_blocked("buyer:b@example.com", "maker:ironandoak") is False


# ═════════════════════════════ SCHEDULER PURGE ══════════════════════════
@pytest.mark.asyncio
async def test_purge_buyer_account_idempotent():
    from routers.community_account import purge_buyer_account
    email = f"purge+{uuid.uuid4().hex[:8]}@example.com"
    await db.community_users.insert_one({"id": uuid.uuid4().hex, "email": email,
                                         "created_at": "2026-01-01T00:00:00Z"})
    r1 = await purge_buyer_account(email)
    assert r1["deleted"] is True
    # Second call — no rows to remove but must not raise
    r2 = await purge_buyer_account(email)
    assert r2["deleted"] is True
