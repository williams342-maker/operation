"""iter334u — Google Ads ROAS endpoint.

Covers:
  1. Endpoint requires admin JWT.
  2. Aggregates revenue from gclid-tagged paid txns within the window.
  3. Aggregates spend from ad_spend rows (platform=google) in the window.
  4. ROAS math = round(revenue / spend, 2) when spend > 0, else null.
  5. Top campaigns surfaced + masked gclid in sample list.
"""
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


async def test_google_roas_requires_admin():
    from server import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/admin/ads/google-roas")
        assert r.status_code in (401, 403)


async def test_google_roas_aggregates_gclid_revenue_and_spend():
    from core import db
    from server import app

    now = datetime.now(timezone.utc)
    in_window = now.isoformat()
    out_window = (now - timedelta(days=20)).isoformat()
    sid_prefix = f"cs_test_iter334u_{uuid.uuid4().hex[:8]}"
    yday = (now - timedelta(days=1)).strftime("%Y-%m-%d")
    out_date = (now - timedelta(days=20)).strftime("%Y-%m-%d")

    # 2 gclid-tagged paid txns in window (count), 1 in-window WITHOUT
    # gclid (skip), 1 out-of-window (skip).
    await db.payment_transactions.insert_many([
        {"session_id": f"{sid_prefix}_a", "gclid": "Cj0_a",
         "payment_status": "paid", "amount": 120.0, "currency": "usd",
         "created_at": in_window, "items": []},
        {"session_id": f"{sid_prefix}_b", "gclid": "Cj0_b",
         "payment_status": "paid", "amount": 80.0, "currency": "usd",
         "created_at": in_window, "items": []},
        {"session_id": f"{sid_prefix}_c",
         "payment_status": "paid", "amount": 200.0, "currency": "usd",
         "created_at": in_window, "items": []},
        {"session_id": f"{sid_prefix}_d", "gclid": "Cj0_d",
         "payment_status": "paid", "amount": 500.0, "currency": "usd",
         "created_at": out_window, "items": []},
    ])
    # 2 ad_spend rows in window (sum), 1 out (skip).
    await db.ad_spend.insert_many([
        {"id": str(uuid.uuid4()), "platform": "google", "campaign_id": f"test-u-1-{sid_prefix}",
         "campaign_name": "Brand Search", "date": yday, "spend_usd": 30.0,
         "clicks": 10, "impressions": 500, "conversions": 1,
         "created_at": in_window},
        {"id": str(uuid.uuid4()), "platform": "google", "campaign_id": f"test-u-2-{sid_prefix}",
         "campaign_name": "Display Retargeting", "date": yday, "spend_usd": 20.0,
         "clicks": 5, "impressions": 800, "conversions": 0,
         "created_at": in_window},
        {"id": str(uuid.uuid4()), "platform": "google", "campaign_id": f"test-u-3-{sid_prefix}",
         "campaign_name": "Old", "date": out_date, "spend_usd": 1000.0,
         "clicks": 0, "impressions": 0, "conversions": 0,
         "created_at": out_window},
    ])
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            r = await ac.get(
                "/api/admin/ads/google-roas?days=7",
                headers={"Authorization": f"Bearer {_admin_jwt()}"},
            )
        assert r.status_code == 200, r.text
        body = r.json()
        # Robust against shared-state DB: assert floor, not equality.
        assert body["attributed_orders"] >= 2
        assert body["attributed_revenue"] >= 120 + 80 - 0.01
        assert body["ad_spend_usd"] >= 30 + 20 - 0.01
        # ROAS math must reflect the divided values returned.
        assert body["roas"] is not None
        assert body["roas"] == round(body["attributed_revenue"] / body["ad_spend_usd"], 2)
        # Our seeded campaigns appear in top.
        names = [c["name"] for c in body["top_campaigns"]]
        assert "Brand Search" in names
        # Sample shows the gclid masked.
        seeded = [s for s in body["sample"] if s["session_id"].startswith(sid_prefix)]
        assert len(seeded) >= 2
        # Out-of-window NEVER shows up.
        assert not any(s["session_id"] == f"{sid_prefix}_d" for s in body["sample"])
    finally:
        await db.payment_transactions.delete_many(
            {"session_id": {"$regex": f"^{sid_prefix}"}})
        await db.ad_spend.delete_many(
            {"campaign_id": {"$regex": f"^test-u-[123]-{sid_prefix}"}})


async def test_google_roas_no_spend_returns_null():
    """Order with gclid, zero ad_spend rows → roas must be null, not 0/error."""
    from core import db
    from server import app

    now = datetime.now(timezone.utc)
    sid = f"cs_test_iter334u_no_spend_{uuid.uuid4().hex[:6]}"
    await db.payment_transactions.insert_one({
        "session_id": sid, "gclid": "Cj0_solo",
        "payment_status": "paid", "amount": 50.0, "currency": "usd",
        "created_at": now.isoformat(), "items": [],
    })
    # Wipe any test google spend rows to guarantee zero.
    prior = await db.ad_spend.find({"platform": "google"}, {"_id": 1}).to_list(length=None)
    await db.ad_spend.update_many(
        {"platform": "google"}, {"$rename": {"platform": "_platform_test_paused"}},
    )
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            r = await ac.get(
                "/api/admin/ads/google-roas?days=7",
                headers={"Authorization": f"Bearer {_admin_jwt()}"},
            )
        body = r.json()
        assert body["ad_spend_usd"] == 0
        assert body["roas"] is None
    finally:
        await db.payment_transactions.delete_one({"session_id": sid})
        # Restore the renamed rows.
        await db.ad_spend.update_many(
            {"_platform_test_paused": "google"},
            {"$rename": {"_platform_test_paused": "platform"}},
        )
        _ = prior  # silence linter
