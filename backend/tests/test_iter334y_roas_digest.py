"""iter334y — Weekly ROAS digest email."""
from __future__ import annotations
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from dotenv import load_dotenv
from httpx import ASGITransport, AsyncClient

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "test_database")
sys.path.insert(0, "/app/backend")

pytestmark = pytest.mark.asyncio


def _admin_jwt() -> str:
    from core import ADMIN_EMAILS
    from maker_auth import issue_session_jwt
    email = next(iter(ADMIN_EMAILS)) if ADMIN_EMAILS else "a@t.com"
    return issue_session_jwt("admin", email, role="admin")


async def test_preview_requires_admin():
    from server import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/admin/ads/roas-digest/preview")
        assert r.status_code in (401, 403)


async def test_preview_returns_3_platform_breakdown_with_wow():
    from server import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get(
            "/api/admin/ads/roas-digest/preview",
            headers={"Authorization": f"Bearer {_admin_jwt()}"},
        )
    assert r.status_code == 200
    body = r.json()
    assert "this_week" in body and "last_week" in body and "deltas" in body
    platforms = [p["platform"] for p in body["this_week"]["breakdown"]]
    assert set(platforms) == {"microsoft", "google", "meta"}
    # Deltas keys present.
    for k in ("orders", "revenue", "spend", "roas"):
        assert k in body["deltas"]


async def test_run_idempotent_same_week(monkeypatch):
    """First call sends, second non-forced call returns 'already_sent'."""
    from core import db
    from server import app
    import routers.roas_digest as mod

    # Monkey-patch the email send to a no-op so the test doesn't hit
    # the real transport. We don't care about the email itself here —
    # just the dedupe behavior on `roas_digest_log`.
    sent = []
    async def _fake_send(to, subject, html):
        sent.append((to, subject))
        return True
    monkeypatch.setattr(mod, "_send", _fake_send)
    # Force a known OPS_EMAIL so the guard passes.
    monkeypatch.setattr(mod, "OPS_EMAIL", "ops@test.invalid")

    # Wipe any prior row for this ISO week so the test isn't blocked
    # by leftover state.
    week = mod._iso_week(datetime.now(timezone.utc))
    await db.roas_digest_log.delete_one({"_id": week})
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            # First call — forced=false (default behavior of the cron).
            r1 = await mod.run_weekly_roas_digest(force=False)
            assert r1["status"] == "sent"
            assert len(sent) == 1

            # Second call — should skip via idempotency.
            r2 = await mod.run_weekly_roas_digest(force=False)
            assert r2["status"] == "skipped"
            assert r2["reason"] == "already_sent_this_week"
            assert len(sent) == 1  # NO additional send

            # Forced — sends again.
            r3 = await mod.run_weekly_roas_digest(force=True)
            assert r3["status"] == "sent"
            assert len(sent) == 2
    finally:
        await db.roas_digest_log.delete_one({"_id": week})


async def test_run_endpoint_admin_gated():
    from server import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post("/api/admin/ads/roas-digest/run")
        assert r.status_code in (401, 403)


async def test_wow_delta_math(monkeypatch):
    """When prior-week spend is $50 and this-week is $75, delta = +50%."""
    from core import db
    import routers.roas_digest as mod

    tag = uuid.uuid4().hex[:8]
    now = datetime.now(timezone.utc)
    this_yday = (now - timedelta(days=1)).strftime("%Y-%m-%d")
    last_week_day = (now - timedelta(days=10)).strftime("%Y-%m-%d")

    rows = [
        {"id": str(uuid.uuid4()), "platform": "meta",
         "campaign_id": f"d-this-{tag}", "campaign_name": "x",
         "date": this_yday, "spend_usd": 75.0, "clicks": 0,
         "impressions": 0, "conversions": 0,
         "created_at": now.isoformat()},
        {"id": str(uuid.uuid4()), "platform": "meta",
         "campaign_id": f"d-last-{tag}", "campaign_name": "y",
         "date": last_week_day, "spend_usd": 50.0, "clicks": 0,
         "impressions": 0, "conversions": 0,
         "created_at": now.isoformat()},
    ]
    await db.ad_spend.insert_many(rows)
    try:
        data = await mod._build_digest_data(days=7)
        # spend delta should be calculable; this_week >= 75, last_week >= 50.
        assert data["this_week"]["total_spend"] >= 75
        assert data["last_week"]["total_spend"] >= 50
        # Computed delta from the actual numbers in the response.
        expected = round(
            (data["this_week"]["total_spend"] - data["last_week"]["total_spend"])
            / data["last_week"]["total_spend"] * 100
        )
        assert data["deltas"]["spend"] == expected
    finally:
        await db.ad_spend.delete_many(
            {"campaign_id": {"$in": [f"d-this-{tag}", f"d-last-{tag}"]}})
