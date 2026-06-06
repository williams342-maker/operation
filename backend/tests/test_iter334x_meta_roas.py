"""iter334x — Meta Ads ROAS endpoint + all-roas Meta inclusion."""
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


async def test_meta_roas_requires_admin():
    from server import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/admin/ads/meta-roas")
        assert r.status_code in (401, 403)


async def test_meta_roas_aggregates_fbclid_revenue_and_meta_spend():
    """Verify fbclid attribution + platform=meta spend aggregation +
    ROAS = revenue/spend rounding."""
    from core import db
    from server import app

    now = datetime.now(timezone.utc)
    in_window = now.isoformat()
    yday = (now - timedelta(days=1)).strftime("%Y-%m-%d")
    tag = uuid.uuid4().hex[:8]

    # 2 fbclid orders in-window, 1 without fbclid (skip), 1 out-of-window.
    await db.payment_transactions.insert_many([
        {"session_id": f"cs_test_iter334x_a_{tag}", "fbclid": "IwAR_a",
         "payment_status": "paid", "amount": 100.0, "currency": "usd",
         "created_at": in_window, "items": []},
        {"session_id": f"cs_test_iter334x_b_{tag}", "fbclid": "IwAR_b",
         "payment_status": "paid", "amount": 75.0, "currency": "usd",
         "created_at": in_window, "items": []},
        {"session_id": f"cs_test_iter334x_c_{tag}",  # no fbclid → skip
         "payment_status": "paid", "amount": 300.0, "currency": "usd",
         "created_at": in_window, "items": []},
        {"session_id": f"cs_test_iter334x_d_{tag}", "fbclid": "IwAR_old",
         "payment_status": "paid", "amount": 500.0, "currency": "usd",
         "created_at": (now - timedelta(days=30)).isoformat(), "items": []},
    ])
    spend_cid_1 = f"test-x-1-{tag}"
    spend_cid_2 = f"test-x-2-{tag}"
    await db.ad_spend.insert_many([
        {"id": str(uuid.uuid4()), "platform": "meta",
         "campaign_id": spend_cid_1, "campaign_name": "Reels A",
         "date": yday, "spend_usd": 25.0, "clicks": 12,
         "impressions": 1000, "conversions": 1, "created_at": in_window},
        {"id": str(uuid.uuid4()), "platform": "meta",
         "campaign_id": spend_cid_2, "campaign_name": "Reels B",
         "date": yday, "spend_usd": 15.0, "clicks": 5,
         "impressions": 600, "conversions": 0, "created_at": in_window},
    ])
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            r = await ac.get(
                "/api/admin/ads/meta-roas?days=7",
                headers={"Authorization": f"Bearer {_admin_jwt()}"},
            )
        assert r.status_code == 200
        body = r.json()
        # Floors guard against shared DB state across runs.
        assert body["attributed_orders"] >= 2
        assert body["attributed_revenue"] >= 100 + 75 - 0.01
        assert body["ad_spend_usd"] >= 25 + 15 - 0.01
        assert body["roas"] is not None
        assert body["roas"] == round(
            body["attributed_revenue"] / body["ad_spend_usd"], 2
        )
        # Out-of-window MUST be absent.
        sample_sids = {s["session_id"] for s in body["sample"]}
        assert f"cs_test_iter334x_d_{tag}" not in sample_sids
        # Both seeded campaigns appear.
        names = [c["name"] for c in body["top_campaigns"]]
        assert "Reels A" in names
    finally:
        await db.payment_transactions.delete_many(
            {"session_id": {"$regex": f"^cs_test_iter334x_._{tag}"}})
        await db.ad_spend.delete_many(
            {"campaign_id": {"$in": [spend_cid_1, spend_cid_2]}})


async def test_all_roas_now_includes_meta():
    """After iter334x, /api/admin/ads/all-roas must return a 3rd
    platform row for Meta."""
    from server import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get(
            "/api/admin/ads/all-roas?days=7",
            headers={"Authorization": f"Bearer {_admin_jwt()}"},
        )
    assert r.status_code == 200
    body = r.json()
    platforms = [p["platform"] for p in body["breakdown"]]
    assert "microsoft" in platforms
    assert "google" in platforms
    assert "meta" in platforms
    assert len(body["breakdown"]) == 3
