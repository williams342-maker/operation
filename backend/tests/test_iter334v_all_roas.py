"""iter334v — Combined "All Ads ROAS" endpoint.

Covers:
  1. Endpoint requires admin JWT.
  2. Sums Microsoft + Google revenue and spend, returns combined ROAS.
  3. Breakdown rows mirror the per-platform endpoints.
  4. Zero-spend windows return roas=null (no /0 errors).
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


async def test_all_roas_requires_admin():
    from server import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/admin/ads/all-roas")
        assert r.status_code in (401, 403)


async def test_all_roas_sums_microsoft_and_google():
    from core import db
    from server import app

    now = datetime.now(timezone.utc)
    in_window = now.isoformat()
    yday = (now - timedelta(days=1)).strftime("%Y-%m-%d")
    tag = uuid.uuid4().hex[:8]

    # MS revenue + ops spend.
    sid_ms = f"cs_test_iter334v_ms_{tag}"
    await db.payment_transactions.insert_one({
        "session_id": sid_ms, "msclkid": "msdemo",
        "payment_status": "paid", "amount": 100.0, "currency": "usd",
        "created_at": in_window, "items": [],
    })
    prior_ops = await db.ops_settings.find_one({"_id": "bing_ad_spend"})
    await db.ops_settings.replace_one(
        {"_id": "bing_ad_spend"},
        {"_id": "bing_ad_spend", "amount_usd": 20.0, "period_days": 7,
         "recorded_at": in_window},
        upsert=True,
    )
    # Google revenue + synced spend.
    sid_gg = f"cs_test_iter334v_gg_{tag}"
    await db.payment_transactions.insert_one({
        "session_id": sid_gg, "gclid": "ggdemo",
        "payment_status": "paid", "amount": 200.0, "currency": "usd",
        "created_at": in_window, "items": [],
    })
    spend_cid = f"test-v-gg-{tag}"
    await db.ad_spend.insert_one({
        "id": str(uuid.uuid4()), "platform": "google",
        "campaign_id": spend_cid, "campaign_name": "Brand", "date": yday,
        "spend_usd": 50.0, "clicks": 10, "impressions": 500, "conversions": 1,
        "created_at": in_window,
    })

    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            r = await ac.get(
                "/api/admin/ads/all-roas?days=7",
                headers={"Authorization": f"Bearer {_admin_jwt()}"},
            )
        assert r.status_code == 200
        body = r.json()
        # Robust against shared-state DB — use floors not equality.
        assert body["total_attributed_orders"] >= 2
        assert body["total_attributed_revenue"] >= 100 + 200 - 0.01
        # MS spend is whatever's in ops_settings (we set 20), Google ≥50.
        assert body["total_ad_spend_usd"] >= 70 - 0.01
        # Combined ROAS = total_rev / total_spend
        assert body["roas"] == round(
            body["total_attributed_revenue"] / body["total_ad_spend_usd"], 2
        )
        # Breakdown has both platforms in order.
        platforms = [p["platform"] for p in body["breakdown"]]
        assert "microsoft" in platforms and "google" in platforms
        ms_row = next(p for p in body["breakdown"] if p["platform"] == "microsoft")
        gg_row = next(p for p in body["breakdown"] if p["platform"] == "google")
        assert ms_row["spend"] == 20.0
        # Each platform's roas is independent.
        assert ms_row["roas"] == round(ms_row["revenue"] / ms_row["spend"], 2)
        assert gg_row["roas"] == round(gg_row["revenue"] / gg_row["spend"], 2)
    finally:
        await db.payment_transactions.delete_many(
            {"session_id": {"$in": [sid_ms, sid_gg]}})
        await db.ad_spend.delete_many({"campaign_id": spend_cid})
        if prior_ops:
            await db.ops_settings.replace_one(
                {"_id": "bing_ad_spend"}, prior_ops, upsert=True,
            )
        else:
            await db.ops_settings.delete_one({"_id": "bing_ad_spend"})


async def test_all_roas_zero_spend_returns_null():
    from core import db
    from server import app

    prior_ops = await db.ops_settings.find_one({"_id": "bing_ad_spend"})
    await db.ops_settings.delete_one({"_id": "bing_ad_spend"})
    # Pause any google ad_spend.
    await db.ad_spend.update_many(
        {"platform": "google"}, {"$rename": {"platform": "_paused_v"}},
    )
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            r = await ac.get(
                "/api/admin/ads/all-roas?days=7",
                headers={"Authorization": f"Bearer {_admin_jwt()}"},
            )
        body = r.json()
        assert body["total_ad_spend_usd"] == 0
        assert body["roas"] is None
    finally:
        await db.ad_spend.update_many(
            {"_paused_v": "google"}, {"$rename": {"_paused_v": "platform"}},
        )
        if prior_ops:
            await db.ops_settings.replace_one(
                {"_id": "bing_ad_spend"}, prior_ops, upsert=True,
            )
