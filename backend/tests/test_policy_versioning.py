import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "craftersmarket_test_policy_versions")
os.environ.setdefault("MAKER_AUTH_SECRET", "test-maker-secret")
os.environ.setdefault("ADMIN_EMAILS", "admin@craftersmarket.local")
os.environ.setdefault("SCHEDULER_ENABLED", "false")

from core import db
from maker_auth import issue_session_jwt
from server import app
from routers.policy_versions import ensure_policy_indexes, publish_due_versions

ADMIN = {"Authorization": f"Bearer {issue_session_jwt('admin', 'admin@craftersmarket.local', role='admin')}"}
MAKER = {"Authorization": f"Bearer {issue_session_jwt('policy-maker', 'maker@example.test', role='maker')}"}
BUYER = {"Authorization": f"Bearer {issue_session_jwt('buyer', 'buyer@example.test', role='buyer')}"}


def iso(dt):
    return dt.astimezone(timezone.utc).isoformat()


@pytest_asyncio.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest_asyncio.fixture(autouse=True)
async def clean_policy_state(monkeypatch):
    for coll in [
        db.policies, db.policy_versions, db.policy_notifications,
        db.policy_acknowledgements, db.policy_ai_log, db.admin_audit,
        db.maker_agreement_acceptances, db.makers,
    ]:
        await coll.delete_many({})
    await db.makers.insert_many([
        {"slug": "policy-maker", "email": "maker@example.test", "name": "Policy Maker"},
        {"slug": "other-maker", "email": "other@example.test", "name": "Other Maker"},
    ])
    monkeypatch.setattr("email_service.send_policy_update_notice", lambda **kw: True, raising=False)
    await ensure_policy_indexes()
    yield


@pytest.mark.asyncio
async def test_existing_policy_content_seeds_initial_published_versions(client):
    r = await client.get("/api/admin/policies", headers=ADMIN)
    assert r.status_code == 200
    rows = r.json()["policies"]
    assert any(p["slug"] == "maker-agreement" and p["current_version"]["status"] == "published" for p in rows)
    assert await db.policy_versions.count_documents({"status": "published"}) >= 8


@pytest.mark.asyncio
async def test_admin_can_create_draft_and_non_admin_cannot(client):
    denied = await client.post("/api/admin/policies/terms/draft", headers=BUYER, json={})
    assert denied.status_code in (401, 403)
    r = await client.post("/api/admin/policies/terms/draft", headers=ADMIN, json={"change_reason": "clarify"})
    assert r.status_code == 201
    assert r.json()["version"]["status"] == "draft"
    dup = await client.post("/api/admin/policies/terms/draft", headers=ADMIN, json={})
    assert dup.status_code == 409


@pytest.mark.asyncio
async def test_draft_is_not_public_and_diff_is_available(client):
    draft = (await client.post("/api/admin/policies/privacy/draft", headers=ADMIN, json={})).json()["version"]
    await client.patch(f"/api/admin/policies/versions/{draft['id']}", headers=ADMIN, json={"content": "<h2>Privacy</h2>\n<p>New data use wording.</p>"})
    public = await client.get(f"/api/policies/privacy/versions/{draft['version_number']}")
    assert public.status_code == 404
    diff = await client.get(f"/api/admin/policies/versions/{draft['id']}/diff", headers=ADMIN)
    assert diff.status_code == 200
    assert diff.json()["diff"]["summary"]["changed"] >= 1


@pytest.mark.asyncio
async def test_ai_failure_leaves_manual_summary_publishable(client, monkeypatch):
    draft = (await client.post("/api/admin/policies/community-guidelines/draft", headers=ADMIN, json={})).json()["version"]
    r = await client.post(f"/api/admin/policies/versions/{draft['id']}/ai-summary", headers=ADMIN)
    assert r.status_code == 200
    assert "ai_summary" in r.json()
    await client.patch(f"/api/admin/policies/versions/{draft['id']}", headers=ADMIN, json={"approved_summary": "Manual summary."})
    pub = await client.post(f"/api/admin/policies/versions/{draft['id']}/publish", headers=ADMIN, json={"email_enabled": False})
    assert pub.status_code == 200
    assert pub.json()["version"]["approved_summary"] == "Manual summary."


@pytest.mark.asyncio
async def test_fee_notice_block_and_override_reason(client):
    draft = (await client.post("/api/admin/policies/fee-pricing/draft", headers=ADMIN, json={})).json()["version"]
    now = datetime.now(timezone.utc)
    body = {"publication_at": iso(now), "effective_at": iso(now + timedelta(days=5)), "email_enabled": False}
    blocked = await client.post(f"/api/admin/policies/versions/{draft['id']}/schedule", headers=ADMIN, json=body)
    assert blocked.status_code == 400
    missing_reason = await client.post(f"/api/admin/policies/versions/{draft['id']}/schedule", headers=ADMIN, json={**body, "override_insufficient_notice": True})
    assert missing_reason.status_code == 400
    ok = await client.post(f"/api/admin/policies/versions/{draft['id']}/schedule", headers=ADMIN, json={**body, "override_insufficient_notice": True, "override_reason": "Emergency legal update"})
    assert ok.status_code == 200
    audit = await db.admin_audit.find_one({"kind": "policy_insufficient_notice_override"})
    assert audit and audit["detail"]["reason"] == "Emergency legal update"


@pytest.mark.asyncio
async def test_scheduler_publishes_due_version_idempotently(client):
    draft = (await client.post("/api/admin/policies/returns/draft", headers=ADMIN, json={})).json()["version"]
    due = datetime.now(timezone.utc) - timedelta(minutes=1)
    await client.post(f"/api/admin/policies/versions/{draft['id']}/schedule", headers=ADMIN, json={"publication_at": iso(due - timedelta(days=1)), "effective_at": iso(due), "email_enabled": False})
    first = await publish_due_versions()
    second = await publish_due_versions()
    assert first["published"] == 1
    assert second["published"] == 0
    v = await db.policy_versions.find_one({"id": draft["id"]})
    assert v["status"] == "published"


@pytest.mark.asyncio
async def test_notifications_not_duplicated_and_maker_review_ack(client):
    draft = (await client.post("/api/admin/policies/prohibited-items/draft", headers=ADMIN, json={})).json()["version"]
    now = datetime.now(timezone.utc)
    sched = await client.post(f"/api/admin/policies/versions/{draft['id']}/schedule", headers=ADMIN, json={"publication_at": iso(now), "effective_at": iso(now + timedelta(days=31)), "acknowledgement_required": True, "email_enabled": False})
    assert sched.status_code == 200
    assert await db.policy_notifications.count_documents({"version_id": draft["id"]}) == 2
    # Duplicate notification pass should not add rows because of unique maker/version index.
    from routers.policy_versions import notify_makers_for_version
    policy = await db.policies.find_one({"slug": "prohibited-items"}, {"_id": 0})
    version = await db.policy_versions.find_one({"id": draft["id"]}, {"_id": 0})
    await notify_makers_for_version(policy, version, email_enabled=False, admin={"email": "admin@craftersmarket.local"})
    assert await db.policy_notifications.count_documents({"version_id": draft["id"]}) == 2
    notices = (await client.get("/api/maker/policy-notices", headers=MAKER)).json()["notices"]
    n = notices[0]
    ack = await client.post("/api/maker/policy-notices/acknowledge", headers=MAKER, json={"notification_id": n["id"], "version_id": n["version_id"], "accepted": True})
    assert ack.status_code == 201
    assert await db.policy_acknowledgements.count_documents({"maker_slug": "policy-maker", "version_id": draft["id"]}) == 1


@pytest.mark.asyncio
async def test_public_history_and_sanitization(client):
    draft = (await client.post("/api/admin/policies/accessibility/draft", headers=ADMIN, json={})).json()["version"]
    await client.patch(f"/api/admin/policies/versions/{draft['id']}", headers=ADMIN, json={"content": "<h2>Safe</h2><script>alert(1)</script><p onclick='x()'>Ok</p>", "approved_summary": "Safe update"})
    pub = await client.post(f"/api/admin/policies/versions/{draft['id']}/publish", headers=ADMIN, json={"email_enabled": False})
    assert pub.status_code == 200
    r = await client.get("/api/policies/accessibility")
    assert r.status_code == 200
    assert r.json()["current"]["version_number"] == draft["version_number"]
    hist = await client.get(f"/api/policies/accessibility/versions/{draft['version_number']}")
    assert hist.status_code == 200
    assert "script" not in hist.json()["version"]["content"].lower()


@pytest.mark.asyncio
async def test_buyers_do_not_receive_maker_policy_notices(client):
    r = await client.get("/api/maker/policy-notices", headers=BUYER)
    assert r.status_code in (401, 403)
