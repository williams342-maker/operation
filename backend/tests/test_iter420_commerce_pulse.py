"""iter420 — Commerce Pulse endpoint contract tests."""
from __future__ import annotations

import os
import sys
import pytest
from datetime import datetime, timezone, timedelta

BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from dotenv import load_dotenv
load_dotenv(os.path.join(BACKEND_DIR, ".env"))

from httpx import ASGITransport, AsyncClient  # noqa: E402
from server import app  # noqa: E402
from core import db  # noqa: E402
from maker_auth import issue_admin_magic_token  # noqa: E402


pytestmark = pytest.mark.asyncio


async def _jwt(client):
    magic = issue_admin_magic_token(os.environ.get("OPS_EMAIL"))
    r = await client.post("/api/admin/auth/verify", json={"token": magic})
    return r.json()["token"]


async def _c():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def test_live_revenue_shape():
    async with await _c() as c:
        jwt = await _jwt(c)
        r = await c.get("/api/admin/command/live-revenue",
                        headers={"Authorization": f"Bearer {jwt}"})
        assert r.status_code == 200, r.text
        j = r.json()
        for k in ("last_15m", "last_60m", "today", "live_conversion_rate", "hourly_sparkline"):
            assert k in j
        for b in (j["last_15m"], j["last_60m"], j["today"]):
            assert "revenue" in b and "orders" in b
        assert len(j["hourly_sparkline"]) == 24
        assert all(isinstance(x, (int, float)) for x in j["hourly_sparkline"])


async def test_cart_abandonment_shape_and_splits():
    async with await _c() as c:
        jwt = await _jwt(c)
        # Seed three carts across the three staleness buckets.
        now = datetime.now(timezone.utc)
        docs = [
            {"email": "z-active@x.com", "cart_total": 25.0, "updated_at": (now - timedelta(minutes=5)).isoformat().replace("+00:00","Z"), "cart_items": [{"product_slug": "iter420-p", "title": "P", "quantity": 1}]},
            {"email": "z-abanding@x.com", "cart_total": 40.0, "updated_at": (now - timedelta(minutes=30)).isoformat().replace("+00:00","Z"), "cart_items": [{"product_slug": "iter420-p", "title": "P", "quantity": 2}]},
            {"email": "z-abandoned@x.com", "cart_total": 60.0, "updated_at": (now - timedelta(hours=3)).isoformat().replace("+00:00","Z"), "cart_items": [{"product_slug": "iter420-p", "title": "P", "quantity": 1}]},
        ]
        await db.abandoned_carts.insert_many(docs)
        try:
            r = await c.get("/api/admin/command/cart-abandonment",
                            headers={"Authorization": f"Bearer {jwt}"})
            assert r.status_code == 200
            j = r.json()
            assert j["active"] >= 1
            assert j["abandoning"] >= 1
            assert j["abandoned"] >= 1
            assert j["dollars_at_risk"] >= 100.0  # 40 + 60 in the >15m buckets
            assert any(p["product_slug"] == "iter420-p" for p in j["top_abandoned_products"])
        finally:
            await db.abandoned_carts.delete_many({"email": {"$in": ["z-active@x.com", "z-abanding@x.com", "z-abandoned@x.com"]}})


async def test_trending_products_requires_min_volume():
    """A single view shouldn't produce a trending row — need >= 2."""
    async with await _c() as c:
        jwt = await _jwt(c)
        now = datetime.now(timezone.utc)
        # 5 views for iter420-hot in the last 30 min; 1 view for iter420-cold.
        events = [
            {"id": f"e{i}", "type": "product_view", "product_slug": "iter420-hot",
             "created_at": (now - timedelta(minutes=5 + i)).isoformat().replace("+00:00", "Z")}
            for i in range(5)
        ] + [
            {"id": "e-cold", "type": "product_view", "product_slug": "iter420-cold",
             "created_at": (now - timedelta(minutes=10)).isoformat().replace("+00:00", "Z")},
        ]
        await db.events.insert_many(events)
        try:
            r = await c.get("/api/admin/command/trending-products?limit=10",
                            headers={"Authorization": f"Bearer {jwt}"})
            assert r.status_code == 200
            slugs = [row["product_slug"] for row in r.json()["rows"]]
            assert "iter420-hot" in slugs
            assert "iter420-cold" not in slugs
        finally:
            await db.events.delete_many({"product_slug": {"$in": ["iter420-hot", "iter420-cold"]}})


async def test_top_searches_ranks_by_volume_and_flags_zero_result():
    async with await _c() as c:
        jwt = await _jwt(c)
        from routers.search_intent import log_search
        # Query with results
        for _ in range(3):
            await log_search("zzziter420withhits", 5, session_id="s1")
        # Query with no results
        for _ in range(4):
            await log_search("zzziter420dead", 0, session_id="s2")
        try:
            r = await c.get("/api/admin/command/top-searches?window_hours=1&limit=20",
                            headers={"Authorization": f"Bearer {jwt}"})
            assert r.status_code == 200
            rows = r.json()["rows"]
            hits = next((row for row in rows if row["normalized_query"] == "zzziter420withhits"), None)
            dead = next((row for row in rows if row["normalized_query"] == "zzziter420dead"), None)
            assert hits and hits["count"] >= 3
            assert hits["zero_result_share"] == 0.0
            assert dead and dead["count"] >= 4
            assert dead["zero_result_share"] == 1.0
        finally:
            await db.search_events.delete_many({"normalized_query": {"$in": ["zzziter420withhits", "zzziter420dead"]}})


async def test_all_commerce_endpoints_require_auth():
    async with await _c() as c:
        for path in (
            "/api/admin/command/live-revenue",
            "/api/admin/command/cart-abandonment",
            "/api/admin/command/trending-products",
            "/api/admin/command/top-searches",
        ):
            r = await c.get(path)
            assert r.status_code in (401, 403), f"{path} allowed anon"
