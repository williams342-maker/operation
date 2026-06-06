"""iter335.10 — Ad attribution health endpoint tests."""
from __future__ import annotations
import os
import sys
from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
os.environ["DB_NAME"] = "test_database"
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
sys.path.insert(0, "/app/backend")

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

pytestmark = pytest.mark.asyncio


def _admin_jwt() -> str:
    from maker_auth import issue_session_jwt
    return issue_session_jwt("team", "team@craftersmarket.org",
                             role="admin", session_version=0)


@pytest_asyncio.fixture(autouse=True)
async def _isolate_db():
    from core import db
    await db.payment_transactions.delete_many({})
    await db.conversion_upload_log.delete_many({})
    yield


async def test_attribution_health_empty_window():
    """With zero paid sessions, the endpoint returns nulls/zeros (not
    division-by-zero crashes)."""
    from server import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/admin/ads/attribution-health",
                         headers={"Authorization": f"Bearer {_admin_jwt()}"})
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["window_days"] == 7
    assert b["paid_sessions"] == 0
    assert b["sessions_with_click_id"] == 0
    assert b["click_id_coverage_pct"] is None
    assert b["replay_backlog"] == 0
    assert len(b["by_channel"]) == 3
    for row in b["by_channel"]:
        assert row["paid_with_click_id"] == 0
        assert row["upload_rate_pct"] is None


async def test_attribution_health_computes_coverage_and_per_channel():
    """3 paid sessions: 2 w/ gclid (1 uploaded ok, 1 err), 1 w/ fbclid
    (uploaded ok). One session has no click ID at all."""
    from core import db
    from server import app
    now = datetime.now(timezone.utc)
    paid_iso = now.isoformat()

    await db.payment_transactions.insert_many([
        {"session_id": "s1", "payment_status": "paid", "updated_at": paid_iso,
         "created_at": paid_iso, "gclid": "G1"},
        {"session_id": "s2", "payment_status": "paid", "updated_at": paid_iso,
         "created_at": paid_iso, "gclid": "G2"},
        {"session_id": "s3", "payment_status": "paid", "updated_at": paid_iso,
         "created_at": paid_iso, "fbclid": "F1"},
        {"session_id": "s4", "payment_status": "paid", "updated_at": paid_iso,
         "created_at": paid_iso},  # no click ID
    ])
    await db.conversion_upload_log.insert_many([
        {"session_id": "s1", "channel": "google", "status": "ok",
         "uploaded_at": paid_iso},
        {"session_id": "s2", "channel": "google", "status": "err:timeout",
         "uploaded_at": paid_iso},
        {"session_id": "s3", "channel": "meta", "status": "ok",
         "uploaded_at": paid_iso},
    ])

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/admin/ads/attribution-health",
                         headers={"Authorization": f"Bearer {_admin_jwt()}"})
    b = r.json()
    assert b["paid_sessions"] == 4
    assert b["sessions_with_click_id"] == 3
    assert b["click_id_coverage_pct"] == 75.0  # 3/4
    g = next(x for x in b["by_channel"] if x["channel"] == "google")
    assert g["paid_with_click_id"] == 2
    assert g["uploaded_ok"] == 1
    assert g["uploaded_err"] == 1
    assert g["upload_rate_pct"] == 50.0
    m = next(x for x in b["by_channel"] if x["channel"] == "meta")
    assert m["paid_with_click_id"] == 1
    assert m["uploaded_ok"] == 1
    assert m["upload_rate_pct"] == 100.0
    assert b["replay_backlog"] == 1  # s2 errored


async def test_attribution_health_ignores_rows_outside_window():
    """Rows older than 7 days don't count in the totals."""
    from core import db
    from server import app
    old_iso = (datetime.now(timezone.utc) - timedelta(days=10)).isoformat()
    await db.payment_transactions.insert_many([
        {"session_id": "old", "payment_status": "paid", "updated_at": old_iso,
         "created_at": old_iso, "gclid": "OLD"},
    ])
    await db.conversion_upload_log.insert_many([
        {"session_id": "old", "channel": "google", "status": "err:x",
         "uploaded_at": old_iso},
    ])

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/admin/ads/attribution-health",
                         headers={"Authorization": f"Bearer {_admin_jwt()}"})
    b = r.json()
    assert b["paid_sessions"] == 0
    assert b["replay_backlog"] == 0


async def test_attribution_health_requires_admin():
    """No bearer → 401/403."""
    from server import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/admin/ads/attribution-health")
    assert r.status_code in (401, 403)
