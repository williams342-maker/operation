"""iter433 — Beta App Testing collection endpoints (apply, admin status)."""
import os
import pytest
import pytest_asyncio

# Reuse existing test DB.
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017/craft_test_iter433")
os.environ.setdefault("DB_NAME", "craft_test_iter433")

from httpx import ASGITransport, AsyncClient  # noqa: E402
from server import app  # noqa: E402
from core import db  # noqa: E402
from maker_auth import issue_session_jwt  # noqa: E402

_ADMIN = os.environ.get("ADMIN_EMAILS", "team@craftersmarket.org").split(",")[0]

TEST_EMAIL_PREFIX = "beta-e2e-"


def _admin_hdr():
    return {"Authorization": f"Bearer {issue_session_jwt(_ADMIN, _ADMIN, role='admin', session_version=0)}"}


@pytest_asyncio.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest_asyncio.fixture(autouse=True)
async def _cleanup_test_rows():
    # Remove any pre-existing test rows to keep dedup deterministic.
    await db.beta_signups.delete_many({"email": {"$regex": f"^{TEST_EMAIL_PREFIX}"}})
    yield
    await db.beta_signups.delete_many({"email": {"$regex": f"^{TEST_EMAIL_PREFIX}"}})


# ─── /api/beta-program/apply ─────────────────────────────────────────
@pytest.mark.asyncio
async def test_apply_full_payload_stores_row(client):
    email = f"{TEST_EMAIL_PREFIX}apply-ok@example.com"
    payload = {
        "name": "Alice Beta", "email": email, "platform": "android",
        "phone_model": "Pixel 8", "role": "both",
        "notes": "Excited to help", "ack": True,
    }
    r = await client.post("/api/beta-program/apply", json=payload)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["ok"] is True
    assert d["duplicate"] is False
    assert isinstance(d.get("id"), str)

    row = await db.beta_signups.find_one({"id": d["id"]}, {"_id": 0})
    assert row is not None
    assert row["email"] == email
    assert row["platform"] == "android"
    assert row["device"] == "android"  # mirrors platform
    assert row["role"] == "both"
    assert row["phone_model"] == "Pixel 8"
    assert row["notes"] == "Excited to help"
    assert row["status"] == "pending"
    assert row["ack"] is True


@pytest.mark.asyncio
async def test_apply_dedup_same_email_platform(client):
    email = f"{TEST_EMAIL_PREFIX}dedup@example.com"
    payload = {"name": "Dup", "email": email, "platform": "ios",
               "role": "shopper", "ack": True}
    r1 = await client.post("/api/beta-program/apply", json=payload)
    assert r1.status_code == 200 and r1.json()["duplicate"] is False
    r2 = await client.post("/api/beta-program/apply", json=payload)
    assert r2.status_code == 200
    assert r2.json()["duplicate"] is True
    assert r2.json()["id"] == r1.json()["id"]
    # Only one row should exist.
    cnt = await db.beta_signups.count_documents({"email": email})
    assert cnt == 1


@pytest.mark.asyncio
async def test_apply_same_email_different_platform_creates_new_row(client):
    email = f"{TEST_EMAIL_PREFIX}cross-platform@example.com"
    r1 = await client.post("/api/beta-program/apply", json={
        "name": "Cross", "email": email, "platform": "android",
        "role": "maker", "ack": True,
    })
    assert r1.json()["duplicate"] is False
    r2 = await client.post("/api/beta-program/apply", json={
        "name": "Cross", "email": email, "platform": "ios",
        "role": "maker", "ack": True,
    })
    assert r2.status_code == 200
    assert r2.json()["duplicate"] is False
    assert r2.json()["id"] != r1.json()["id"]
    cnt = await db.beta_signups.count_documents({"email": email})
    assert cnt == 2


@pytest.mark.asyncio
async def test_apply_ack_false_rejected(client):
    r = await client.post("/api/beta-program/apply", json={
        "name": "No Ack", "email": f"{TEST_EMAIL_PREFIX}noack@example.com",
        "platform": "android", "role": "shopper", "ack": False,
    })
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_apply_missing_name_rejected(client):
    r = await client.post("/api/beta-program/apply", json={
        "email": f"{TEST_EMAIL_PREFIX}missname@example.com",
        "platform": "android", "role": "shopper", "ack": True,
    })
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_apply_invalid_role_rejected(client):
    r = await client.post("/api/beta-program/apply", json={
        "name": "X", "email": f"{TEST_EMAIL_PREFIX}badrole@example.com",
        "platform": "android", "role": "hacker", "ack": True,
    })
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_apply_invalid_platform_rejected(client):
    r = await client.post("/api/beta-program/apply", json={
        "name": "X", "email": f"{TEST_EMAIL_PREFIX}badplat@example.com",
        "platform": "windows", "role": "shopper", "ack": True,
    })
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_apply_bad_email_rejected(client):
    r = await client.post("/api/beta-program/apply", json={
        "name": "X", "email": "not-an-email",
        "platform": "android", "role": "shopper", "ack": True,
    })
    assert r.status_code == 422


# ─── Email notification path (email_events row proof) ─────────────────
@pytest.mark.asyncio
async def test_apply_triggers_email_event(client):
    import asyncio
    email = f"{TEST_EMAIL_PREFIX}emailpath@example.com"
    r = await client.post("/api/beta-program/apply", json={
        "name": "Email Test", "email": email, "platform": "ios",
        "phone_model": "iPhone 15", "role": "shopper", "ack": True,
    })
    assert r.status_code == 200
    # BackgroundTask fires after response; give it a moment.
    await asyncio.sleep(1.2)
    # Look for the email event with the expected subject.
    ev = await db.email_events.find_one(
        {"subject": "New Crafters Market beta tester signup — iOS"},
        {"_id": 0}, sort=[("created_at", -1)],
    )
    # Provider may be unavailable in preview — status may be 'failed', 'sent', or 'skipped'.
    # Presence of the event row is sufficient proof the send path was invoked.
    assert ev is not None, "expected email_events row for iOS beta signup"


# ─── Admin: GET /api/admin/beta-program/signups ──────────────────────
@pytest.mark.asyncio
async def test_admin_signups_returns_statuses_and_new_fields(client):
    # Seed a row via apply.
    email = f"{TEST_EMAIL_PREFIX}adminlist@example.com"
    await client.post("/api/beta-program/apply", json={
        "name": "Admin Row", "email": email, "platform": "android",
        "phone_model": "Pixel 8 Pro", "role": "maker",
        "notes": "please add me", "ack": True,
    })
    r = await client.get("/api/admin/beta-program/signups", headers=_admin_hdr())
    assert r.status_code == 200
    d = r.json()
    assert "statuses" in d and isinstance(d["statuses"], list)
    assert set(d["statuses"]) == {"pending", "approved", "invitation_sent",
                                   "installed", "active_tester", "removed"}
    row = next((s for s in d["signups"] if s.get("email") == email), None)
    assert row is not None
    assert row["platform"] == "android"
    assert row["phone_model"] == "Pixel 8 Pro"
    assert row["role"] == "maker"
    assert row["notes"] == "please add me"
    assert row["status"] == "pending"


@pytest.mark.asyncio
async def test_admin_signups_legacy_row_defaults_pending(client):
    # Insert a "legacy" row shaped like the iter428 signup path.
    import uuid
    from core import now_iso
    email = f"{TEST_EMAIL_PREFIX}legacy@example.com"
    await db.beta_signups.insert_one({
        "id": uuid.uuid4().hex, "name": "Legacy", "email": email,
        "device": "android", "state": "WA", "created_at": now_iso(),
    })
    r = await client.get("/api/admin/beta-program/signups", headers=_admin_hdr())
    assert r.status_code == 200
    row = next((s for s in r.json()["signups"] if s.get("email") == email), None)
    assert row is not None
    assert row.get("status") == "pending"
    assert row.get("platform") == "android"  # mirrors device


# ─── Admin: PATCH status ──────────────────────────────────────────────
@pytest.mark.asyncio
async def test_admin_status_update_persists(client):
    email = f"{TEST_EMAIL_PREFIX}status@example.com"
    r = await client.post("/api/beta-program/apply", json={
        "name": "Status", "email": email, "platform": "android",
        "role": "shopper", "ack": True,
    })
    sid = r.json()["id"]
    r2 = await client.patch(
        f"/api/admin/beta-program/signups/{sid}",
        json={"status": "approved"}, headers=_admin_hdr(),
    )
    assert r2.status_code == 200
    assert r2.json()["status"] == "approved"
    # Verify persisted in db.
    row = await db.beta_signups.find_one({"id": sid}, {"_id": 0})
    assert row["status"] == "approved"


@pytest.mark.asyncio
async def test_admin_status_invalid_value(client):
    email = f"{TEST_EMAIL_PREFIX}badstatus@example.com"
    r = await client.post("/api/beta-program/apply", json={
        "name": "BadStat", "email": email, "platform": "ios",
        "role": "both", "ack": True,
    })
    sid = r.json()["id"]
    r2 = await client.patch(
        f"/api/admin/beta-program/signups/{sid}",
        json={"status": "vip"}, headers=_admin_hdr(),
    )
    assert r2.status_code == 422


@pytest.mark.asyncio
async def test_admin_status_unknown_id(client):
    r = await client.patch(
        "/api/admin/beta-program/signups/does-not-exist",
        json={"status": "approved"}, headers=_admin_hdr(),
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_admin_status_requires_auth(client):
    r = await client.patch(
        "/api/admin/beta-program/signups/anything",
        json={"status": "approved"},
    )
    assert r.status_code in (401, 403)


# ─── Regression: legacy signup + stats + config still work ────────────
@pytest.mark.asyncio
async def test_legacy_signup_still_works(client):
    email = f"{TEST_EMAIL_PREFIX}legacy-signup@example.com"
    r = await client.post("/api/beta-program/signup", json={
        "name": "Legacy Path", "email": email,
        "device": "android", "state": "Ohio",
    })
    assert r.status_code == 200
    assert r.json()["duplicate"] is False


@pytest.mark.asyncio
async def test_stats_counts_include_apply_rows(client):
    r_before = await client.get("/api/beta-program/stats")
    before = r_before.json()
    email = f"{TEST_EMAIL_PREFIX}stats@example.com"
    await client.post("/api/beta-program/apply", json={
        "name": "Stats", "email": email, "platform": "android",
        "role": "shopper", "ack": True,
    })
    r_after = await client.get("/api/beta-program/stats")
    after = r_after.json()
    assert after["android_count"] >= before["android_count"] + 1


@pytest.mark.asyncio
async def test_config_unchanged(client):
    r = await client.get("/api/beta-program/config")
    assert r.status_code == 200
    d = r.json()
    for k in ("enabled", "android_url", "ios_url", "headline"):
        assert k in d
