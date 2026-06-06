"""iter334w — Microsoft Ads OAuth integration endpoints.

Covers status (admin gate, env config detection), OAuth start (URL
shape + state persistence), and disconnect. The OAuth callback +
report download paths are not unit-tested here — they require live
Microsoft endpoints; integration testing happens via the manual
"Sync yesterday now" admin button.
"""
from __future__ import annotations
import os
import sys

import pytest
from dotenv import load_dotenv
from httpx import ASGITransport, AsyncClient

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
# Force test DB — `setdefault` won't override the value `.env` just set,
# so tests would wipe production credentials. Explicit override is safe
# because `core` reads DB_NAME at first import.
os.environ["DB_NAME"] = "test_database"
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
sys.path.insert(0, "/app/backend")

pytestmark = pytest.mark.asyncio


def _admin_jwt() -> str:
    from core import ADMIN_EMAILS
    from maker_auth import issue_session_jwt
    email = next(iter(ADMIN_EMAILS)) if ADMIN_EMAILS else "a@t.com"
    return issue_session_jwt("admin", email, role="admin")


async def test_status_requires_admin():
    from server import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/admin/integrations/microsoft-ads/status")
        assert r.status_code in (401, 403)


async def test_status_returns_config_ready_when_env_set():
    from server import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get(
            "/api/admin/integrations/microsoft-ads/status",
            headers={"Authorization": f"Bearer {_admin_jwt()}"},
        )
    assert r.status_code == 200, r.text
    body = r.json()
    # With BING_* env vars present in .env, this should be config-ready.
    assert "connected" in body
    assert "config_ready" in body
    assert "redirect_uri" in body
    assert body["redirect_uri"].endswith(
        "/api/admin/integrations/microsoft-ads/oauth/callback"
    )


async def test_oauth_start_returns_microsoft_auth_url():
    from server import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get(
            "/api/admin/integrations/microsoft-ads/oauth/start",
            headers={"Authorization": f"Bearer {_admin_jwt()}"},
        )
    assert r.status_code == 200, r.text
    body = r.json()
    # URL must point at Microsoft's v2.0 endpoint with our client_id
    # encoded — anything else means we're handing off the user to the
    # wrong identity provider.
    assert body["authorization_url"].startswith(
        "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?"
    )
    assert "client_id=" in body["authorization_url"]
    assert "msads.manage" in body["authorization_url"]
    assert "offline_access" in body["authorization_url"]
    # State is persisted in Mongo for callback validation.
    from core import db
    state_doc = await db.integration_oauth_states.find_one({"_id": body["state"]})
    assert state_doc is not None
    assert state_doc["provider"] == "microsoft_ads"


async def test_disconnect_removes_persisted_cred():
    from core import db
    from server import app

    # Seed a fake stored creds row.
    await db.integration_credentials.update_one(
        {"_id": "microsoft_ads"},
        {"$set": {"refresh_token": "fake_token", "connected_at": "2026-06-06T00:00:00Z"}},
        upsert=True,
    )
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            "/api/admin/integrations/microsoft-ads/disconnect",
            headers={"Authorization": f"Bearer {_admin_jwt()}"},
        )
    assert r.status_code == 200
    assert r.json()["deleted"] == 1
    gone = await db.integration_credentials.find_one({"_id": "microsoft_ads"})
    assert gone is None


async def test_manual_sync_skips_when_not_connected():
    """When no cred row exists, sync must return a clear `skipped`
    status — not crash — so the admin sees a sensible message in the UI."""
    from core import db
    from server import app

    await db.integration_credentials.delete_one({"_id": "microsoft_ads"})
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            "/api/admin/integrations/microsoft-ads/sync",
            headers={"Authorization": f"Bearer {_admin_jwt()}"},
        )
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "skipped"
    assert body["reason"] == "not_connected"


async def test_manual_sync_skips_when_account_ids_missing():
    """Connected but no customer_id/account_id (e.g. discovery failed)
    must surface a `missing_account_ids` skip with a hint."""
    import os as _os
    from core import db
    from server import app

    # Save & clear the env vars so discovery fallback path is the one
    # tested. We restore them at the end.
    saved_cid = _os.environ.pop("BING_CUSTOMER_ID", None)
    saved_aid = _os.environ.pop("BING_ACCOUNT_ID", None)
    await db.integration_credentials.update_one(
        {"_id": "microsoft_ads"},
        {"$set": {"refresh_token": "tok_only", "customer_id": None, "account_id": None}},
        upsert=True,
    )
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            r = await ac.post(
                "/api/admin/integrations/microsoft-ads/sync",
                headers={"Authorization": f"Bearer {_admin_jwt()}"},
            )
        body = r.json()
        assert body["status"] == "skipped"
        assert body["reason"] == "missing_account_ids"
        assert "hint" in body
    finally:
        await db.integration_credentials.delete_one({"_id": "microsoft_ads"})
        if saved_cid is not None:
            _os.environ["BING_CUSTOMER_ID"] = saved_cid
        if saved_aid is not None:
            _os.environ["BING_ACCOUNT_ID"] = saved_aid



async def test_backfill_rejects_out_of_range_days():
    """Days must be 1-90 to keep request budget bounded and avoid
    hammering the MS Reporting API's historical throttle."""
    from server import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        # 0 days → 422 (Query ge=1)
        r0 = await ac.post(
            "/api/admin/integrations/microsoft-ads/backfill?days=0",
            headers={"Authorization": f"Bearer {_admin_jwt()}"},
        )
        # 100 days → 422 (Query le=90)
        r2 = await ac.post(
            "/api/admin/integrations/microsoft-ads/backfill?days=100",
            headers={"Authorization": f"Bearer {_admin_jwt()}"},
        )
    assert r0.status_code == 422
    assert r2.status_code == 422


async def test_backfill_walks_days_and_aggregates(monkeypatch):
    """Backfill loops over N days, calls sync_metrics per day, and
    aggregates per-day results into a summary block. We monkey-patch
    `sync_metrics` so the test never touches the live MS endpoint."""
    from server import app
    from routers import microsoft_ads_sdk

    calls: list[str] = []

    async def fake_sync(date_str=None):
        calls.append(date_str)
        # Return alternating ok/skipped to exercise the summary math.
        if len(calls) % 2 == 1:
            return {"status": "ok", "date": date_str, "rows": 3}
        return {"status": "skipped", "date": date_str, "reason": "not_connected"}

    monkeypatch.setattr(microsoft_ads_sdk, "sync_metrics", fake_sync)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            "/api/admin/integrations/microsoft-ads/backfill?days=4",
            headers={"Authorization": f"Bearer {_admin_jwt()}"},
        )
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(calls) == 4
    # Yesterday → 4 days back, descending — verify the date format.
    for d in calls:
        assert len(d) == 10 and d.count("-") == 2
    assert body["days_requested"] == 4
    assert body["days_ok"] == 2
    assert body["days_skipped"] == 2
    assert body["days_error"] == 0
    assert body["total_rows"] == 6  # 2 ok days × 3 rows
    assert body["status"] == "ok"
    assert len(body["results"]) == 4
