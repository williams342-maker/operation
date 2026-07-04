"""iter419 — Marketplace Command Center + Search Intent contract tests."""
from __future__ import annotations

import os, sys
import pytest

BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from dotenv import load_dotenv
load_dotenv(os.path.join(BACKEND_DIR, ".env"))

from httpx import ASGITransport, AsyncClient  # noqa: E402
from server import app  # noqa: E402
from core import db  # noqa: E402
from maker_auth import issue_admin_magic_token  # noqa: E402
from routers.search_intent import normalize_query, log_search  # noqa: E402


pytestmark = pytest.mark.asyncio


async def _admin_jwt(client):
    magic = issue_admin_magic_token(os.environ.get("OPS_EMAIL"))
    r = await client.post("/api/admin/auth/verify", json={"token": magic})
    return r.json()["token"]


async def _c():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def test_normalize_query_basic():
    assert normalize_query("Horseshoe Art!") == "horseshoe art"
    assert normalize_query("  Horseshoe   Art ") == "horseshoe art"
    assert normalize_query("HORSESHOE ART") == "horseshoe art"


async def test_search_logging_from_products_endpoint():
    """Hitting /api/products?q=... should append a search_event."""
    async with await _c() as c:
        # Baseline count
        before = await db.search_events.count_documents({
            "normalized_query": "zzziter419testnoresultquery",
        })
        r = await c.get(
            "/api/products",
            params={"q": "zzziter419testnoresultquery"},
            headers={"x-cm-session": "test-sess-iter419"},
        )
        assert r.status_code == 200
        # Should have logged at least one event
        after = await db.search_events.count_documents({
            "normalized_query": "zzziter419testnoresultquery",
        })
        assert after > before, "search_intent.log_search did not persist"
        # Verify the event has the ground-truth zero_result flag
        ev = await db.search_events.find_one({
            "normalized_query": "zzziter419testnoresultquery",
        })
        assert ev["zero_result"] is True
        assert ev["result_count"] == 0
        assert ev["session_id"] == "test-sess-iter419"

        # Cleanup
        await db.search_events.delete_many({
            "normalized_query": "zzziter419testnoresultquery",
        })


async def test_zero_result_endpoint_groups_by_normalized_query():
    """Casing/punctuation variants must collapse into the same bucket."""
    async with await _c() as c:
        jwt = await _admin_jwt(c)
        # Seed 3 variants
        await log_search("HorseSHOE  Art!", 0, session_id="s1")
        await log_search("horseshoe art", 0, session_id="s2")
        await log_search("Horseshoe Art", 0, session_id="s3")

        r = await c.get(
            "/api/admin/search/zero-result?window_days=1",
            headers={"Authorization": f"Bearer {jwt}"},
        )
        assert r.status_code == 200
        rows = r.json()["rows"]
        target = next((row for row in rows if row["normalized_query"] == "horseshoe art"), None)
        assert target is not None, "grouped row missing"
        assert target["count"] >= 3

        # Cleanup
        await db.search_events.delete_many({"normalized_query": "horseshoe art"})


async def test_annotate_hides_query():
    async with await _c() as c:
        jwt = await _admin_jwt(c)
        # Create a zero-result event.
        await log_search("zzziter419hideme", 0, session_id="s1")

        # Confirm it shows up.
        rows = (await c.get(
            "/api/admin/search/zero-result?window_days=1",
            headers={"Authorization": f"Bearer {jwt}"},
        )).json()["rows"]
        assert any(r["normalized_query"] == "zzziter419hideme" for r in rows)

        # Hide it.
        r = await c.post(
            "/api/admin/search/annotate",
            headers={"Authorization": f"Bearer {jwt}"},
            json={"normalized_query": "zzziter419hideme", "action": "hide"},
        )
        assert r.status_code == 200

        rows = (await c.get(
            "/api/admin/search/zero-result?window_days=1",
            headers={"Authorization": f"Bearer {jwt}"},
        )).json()["rows"]
        assert not any(r["normalized_query"] == "zzziter419hideme" for r in rows)

        # Cleanup
        await db.search_events.delete_many({"normalized_query": "zzziter419hideme"})
        await db.search_intent_annotations.delete_many({"normalized_query": "zzziter419hideme"})


async def test_growth_endpoint_shape():
    async with await _c() as c:
        jwt = await _admin_jwt(c)
        r = await c.get(
            "/api/admin/command/growth",
            headers={"Authorization": f"Bearer {jwt}"},
        )
        assert r.status_code == 200
        j = r.json()
        assert "metrics" in j
        keys = {m["key"] for m in j["metrics"]}
        # All eight required daily metrics must be present.
        expected = {
            "visitors_today", "buyers_registered", "applications",
            "new_makers", "products_added", "orders", "revenue", "conversion_rate",
        }
        assert expected.issubset(keys), f"missing metrics: {expected - keys}"
        assert "categories" in j


async def test_activity_endpoint_only_returns_momentum_kinds():
    async with await _c() as c:
        jwt = await _admin_jwt(c)
        r = await c.get(
            "/api/admin/command/activity?limit=15",
            headers={"Authorization": f"Bearer {jwt}"},
        )
        assert r.status_code == 200
        allowed = {
            "founder_application", "email_verified", "maker_approved",
            "shop_published", "product_listed", "first_product_listed",
            "first_sale", "custom_order_brief",
        }
        for item in r.json()["items"]:
            assert item["kind"] in allowed, f"unexpected kind: {item['kind']}"


async def test_recruitment_endpoint_returns_zero_result_queries():
    async with await _c() as c:
        jwt = await _admin_jwt(c)
        await log_search("zzziter419recruitme", 0, session_id="s1")
        r = await c.get(
            "/api/admin/command/recruitment?window_days=1&limit=20",
            headers={"Authorization": f"Bearer {jwt}"},
        )
        assert r.status_code == 200
        assert any(
            row["normalized_query"] == "zzziter419recruitme"
            for row in r.json()["rows"]
        )
        await db.search_events.delete_many({"normalized_query": "zzziter419recruitme"})


async def test_admin_endpoints_require_auth():
    async with await _c() as c:
        for path in (
            "/api/admin/search/zero-result",
            "/api/admin/command/growth",
            "/api/admin/command/activity",
            "/api/admin/command/recruitment",
        ):
            r = await c.get(path)
            assert r.status_code in (401, 403), f"{path} allowed anon access"
