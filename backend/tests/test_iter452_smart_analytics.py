"""iter452 — Smart Sections + Store Analytics (Phase 3) tests."""
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio

from httpx import ASGITransport, AsyncClient
from server import app
from core import db, now_iso
from maker_auth import issue_session_jwt

PFX = "smarttest"
pytestmark = pytest.mark.asyncio
M1 = f"{PFX}-grove"
M2 = f"{PFX}-other"
AUTH = {"Authorization": f"Bearer {issue_session_jwt(M1, f'{M1}@t.co', role='maker')}"}
NOW = datetime.now(timezone.utc)


def _at(days_ago, h=12):
    return (NOW - timedelta(days=days_ago)).replace(hour=h, minute=0).isoformat()


@pytest_asyncio.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest_asyncio.fixture(autouse=True)
async def _clean():
    async def wipe():
        rx = {"$regex": f"^{PFX}-"}
        await db.products.delete_many({"maker_slug": rx})
        await db.makers.delete_many({"slug": rx})
        await db.store_sections.delete_many({"maker_slug": rx})
        await db.smart_section_settings.delete_many({"maker_slug": rx})
        await db.store_events.delete_many({"maker_slug": rx})
        await db.store_search_logs.delete_many({"maker_slug": rx})
        await db.transactions.delete_many({"session_id": rx})
        await db.maker_reco_ai_cache.delete_many({"maker_slug": rx})
    await wipe()
    for m in (M1, M2):
        await db.makers.insert_one({"slug": m, "name": m, "created_at": now_iso()})
    yield
    await wipe()


async def _prod(maker, title, price=20.0, in_stock=10, published_days_ago=60,
                sections=None, status="published", **extra):
    slug = f"{PFX}-{uuid.uuid4().hex[:8]}"
    await db.products.insert_one({
        "id": uuid.uuid4().hex, "slug": slug, "title": title, "price": price,
        "maker_slug": maker, "status": status, "in_stock": in_stock,
        "published_at": _at(published_days_ago), "created_at": _at(published_days_ago),
        "section_slugs": sections or [], **extra})
    return slug


async def _tx(maker, slug, price, qty=1, days_ago=5):
    await db.transactions.insert_one({
        "session_id": f"{PFX}-tx-{uuid.uuid4().hex[:8]}", "payment_status": "paid",
        "created_at": _at(days_ago),
        "items": [{"slug": slug, "maker_slug": maker, "price": price, "quantity": qty}]})


async def _ev(t, days_ago, sess, maker=M1, **kw):
    await db.store_events.insert_one({
        "id": uuid.uuid4().hex, "type": t, "maker_slug": maker,
        "session_id": sess, "category": "analytics", "at": _at(days_ago), **kw})


# ── Smart Sections ────────────────────────────────────────────────────────────

async def test_smart_sections_default_disabled_and_computed_counts(client):
    await _prod(M1, "Fresh Item", published_days_ago=2)
    await _prod(M1, "Old Item", published_days_ago=90)
    await _prod(M1, "Low Stock", in_stock=3, published_days_ago=90)
    await _prod(M1, "Nearly Gone", in_stock=1, published_days_ago=90)
    r = await client.get("/api/maker/smart-sections", headers=AUTH)
    assert r.status_code == 200
    by_key = {s["key"]: s for s in r.json()["sections"]}
    assert len(by_key) == 10  # iter454 adds digital-downloads
    assert all(not s["enabled"] for s in by_key.values())
    assert by_key["new-arrivals"]["count"] == 1
    assert by_key["low-inventory"]["count"] == 2   # 3 + 1 stock
    assert by_key["nearly-sold-out"]["count"] == 1


async def test_smart_section_toggle_and_public_visibility(client):
    await _prod(M1, "Fresh Item", published_days_ago=2)
    # Public endpoint empty until enabled
    r = await client.get(f"/api/makers/{M1}/smart-sections")
    assert r.json()["sections"] == []
    r = await client.patch("/api/maker/smart-sections/new-arrivals",
                           json={"enabled": True}, headers=AUTH)
    assert r.status_code == 200
    r = await client.get(f"/api/makers/{M1}/smart-sections")
    secs = r.json()["sections"]
    assert len(secs) == 1 and secs[0]["slug"] == "new-arrivals"
    assert secs[0]["count"] == 1 and len(secs[0]["product_slugs"]) == 1


async def test_manual_smart_section_pick_list_validates_ownership(client):
    mine = await _prod(M1, "Mine")
    other = await _prod(M2, "Not Mine")
    r = await client.patch("/api/maker/smart-sections/staff-picks",
                           json={"enabled": True, "product_slugs": [mine, other, mine]},
                           headers=AUTH)
    assert r.status_code == 200
    assert r.json()["setting"]["product_slugs"] == [mine]  # dedup + ownership
    # auto sections reject pick lists
    r = await client.patch("/api/maker/smart-sections/new-arrivals",
                           json={"product_slugs": [mine]}, headers=AUTH)
    assert r.status_code == 400


async def test_best_sellers_ranked_by_units_sold(client):
    a = await _prod(M1, "Slow", price=10)
    b = await _prod(M1, "Hot", price=10)
    await _tx(M1, a, 10, qty=1)
    await _tx(M1, b, 10, qty=3)
    await _tx(M1, b, 10, qty=2)
    r = await client.get("/api/maker/smart-sections", headers=AUTH)
    bs = next(s for s in r.json()["sections"] if s["key"] == "best-sellers")
    assert bs["count"] == 2 and bs["preview"][0] == b


async def test_unknown_smart_key_404(client):
    r = await client.patch("/api/maker/smart-sections/nope",
                           json={"enabled": True}, headers=AUTH)
    assert r.status_code == 404


# ── Store events ingestion ────────────────────────────────────────────────────

async def test_store_events_whitelist_and_batch(client):
    r = await client.post("/api/store-events", json={"events": [
        {"type": "store_view", "maker_slug": M1, "session_id": "s1"},
        {"type": "hack_type", "maker_slug": M1, "session_id": "s1"},
        {"type": "section_dwell", "maker_slug": M1, "section_slug": "x",
         "dwell_ms": 1200, "session_id": "s1"},
    ]})
    assert r.status_code == 200 and r.json()["stored"] == 2
    rows = await db.store_events.find({"maker_slug": M1}).to_list(10)
    assert {x["type"] for x in rows} == {"store_view", "section_dwell"}
    assert all(x["category"] == "analytics" for x in rows)


async def test_store_events_bot_filtered(client):
    r = await client.post("/api/store-events",
                          json={"events": [{"type": "store_view", "maker_slug": M1}]},
                          headers={"User-Agent": "Googlebot/2.1"})
    assert r.json()["stored"] == 0


# ── Analytics ─────────────────────────────────────────────────────────────────

async def test_overview_metrics_and_partial_day_exclusion(client):
    for i, d in enumerate([1, 1, 3]):
        await _ev("store_view", d, f"s{i}")
    await _ev("product_click", 1, "s0", product_slug="x")
    await _ev("add_to_cart", 1, "s0", product_slug="x")
    await _ev("store_view", 0, "today-sess")  # TODAY — must be excluded
    p = await _prod(M1, "Sold Thing", price=25)
    await _tx(M1, p, 25.0, qty=2, days_ago=1)
    r = await client.get("/api/maker/analytics/overview?days=30&tz=UTC", headers=AUTH)
    cur = r.json()["current"]
    assert cur["store_views"] == 3          # today's view excluded
    assert cur["unique_visitors"] == 3
    assert cur["product_views"] == 1
    assert cur["add_to_cart"] == 1
    assert cur["orders"] == 1 and cur["revenue"] == 50.0
    assert cur["avg_order_value"] == 50.0
    assert len(r.json()["daily"]) == 30
    assert r.json()["range"]["days"] == 30


async def test_overview_previous_period_deltas(client):
    await _ev("store_view", 2, "cur1")
    await _ev("store_view", 3, "cur2")
    await _ev("store_view", 10, "prev1")  # in previous 7d window
    r = await client.get("/api/maker/analytics/overview?days=7&tz=UTC", headers=AUTH)
    d = r.json()
    assert d["current"]["store_views"] == 2
    assert d["previous"]["store_views"] == 1
    assert d["deltas"]["store_views"] == 100.0


async def test_sections_analytics_with_dwell_and_order_attribution(client):
    p = await _prod(M1, "Wall Thing", price=30, sections=["wall-art"])
    await db.store_sections.insert_one({
        "id": uuid.uuid4().hex, "maker_slug": M1, "name": "Wall Art",
        "slug": "wall-art", "position": 0, "visible": True, "created_at": now_iso()})
    await _ev("section_view", 1, "s1", section_slug="wall-art")
    await _ev("section_view", 2, "s2", section_slug="wall-art")
    await _ev("section_dwell", 1, "s1", section_slug="wall-art", dwell_ms=10000)
    await _ev("section_dwell", 2, "s2", section_slug="wall-art", dwell_ms=20000)
    await _ev("product_click", 1, "s1", section_slug="wall-art", product_slug=p)
    await _tx(M1, p, 30.0, days_ago=1)
    r = await client.get("/api/maker/analytics/sections?days=30&tz=UTC", headers=AUTH)
    row = next(s for s in r.json()["sections"] if s["slug"] == "wall-art")
    assert row["views"] == 2 and row["product_clicks"] == 1
    assert row["orders"] == 1 and row["revenue"] == 30.0
    assert row["avg_dwell_seconds"] == 15.0
    assert row["conversion_rate"] == 50.0
    assert row["top_products"][0]["slug"] == p


async def test_products_analytics_lists(client):
    a = await _prod(M1, "Viewed A", price=10)
    b = await _prod(M1, "Sold B", price=40)
    for i in range(4):
        await _ev("product_click", 1, f"s{i}", product_slug=a)
    await _tx(M1, b, 40.0, qty=2, days_ago=2)
    r = await client.get("/api/maker/analytics/products?days=30&tz=UTC", headers=AUTH)
    d = r.json()
    assert d["most_viewed"][0]["slug"] == a and d["most_viewed"][0]["views"] == 4
    assert d["most_purchased"][0]["slug"] == b
    assert d["highest_revenue"][0]["revenue"] == 80.0
    assert any(x["slug"] == b for x in d["no_views_30d"])
    assert any(x["slug"] == a for x in d["no_sales_60d"])


async def test_search_insights_zero_results_and_conversion_linkage(client):
    for d in (1, 2, 3):
        await db.store_search_logs.insert_one(
            {"maker_slug": M1, "q": "dragonfly", "results": 0, "section_hits": 0, "at": _at(d)})
    await db.store_search_logs.insert_one(
        {"maker_slug": M1, "q": "sign", "results": 2, "section_hits": 0, "at": _at(1)})
    await _ev("search_click", 1, "conv-s", query="sign", product_slug="x")
    await _ev("add_to_cart", 1, "conv-s", product_slug="x")
    r = await client.get("/api/maker/analytics/search-insights?days=30&tz=UTC", headers=AUTH)
    d = r.json()
    assert d["top_terms"][0]["q"] == "dragonfly"
    assert d["zero_result_terms"][0]["q"] == "dragonfly"
    assert "sign" in d["converted_terms"]
    assert "dragonfly" in d["not_converted_terms"]
    assert any("dragonfly" in m and "zero results" in m for m in d["recommendations"])


async def test_recommendations_rules_no_ai(client):
    p = await _prod(M1, "Hot Low Stock", price=15, in_stock=2)
    await _tx(M1, p, 15.0, qty=3, days_ago=1)
    for d in (1, 2, 3):
        await db.store_search_logs.insert_one(
            {"maker_slug": M1, "q": "apple trees", "results": 0, "section_hits": 0, "at": _at(d)})
    r = await client.get("/api/maker/analytics/recommendations?days=30&tz=UTC&ai=0",
                         headers=AUTH)
    recs = r.json()["recommendations"]
    types = {x["type"] for x in recs}
    assert "low_inventory" in types and "zero_result_search" in types
    li = next(x for x in recs if x["type"] == "low_inventory")
    assert li["priority"] == "high" and li["confidence"] >= 90
    assert r.json()["ai_summary"] is None


async def test_analytics_requires_maker_auth(client):
    for ep in ("overview", "sections", "products", "search-insights", "recommendations"):
        r = await client.get(f"/api/maker/analytics/{ep}")
        assert r.status_code in (401, 403)


async def test_admin_trends_requires_admin_and_aggregates(client):
    r = await client.get("/api/admin/marketplace-trends")
    assert r.status_code in (401, 403)
    await db.store_search_logs.insert_one(
        {"maker_slug": M1, "q": "walnut", "results": 0, "section_hits": 0, "at": _at(1)})
    admin = {"Authorization": f"Bearer {issue_session_jwt('admin', 'team@craftersmarket.org', role='admin')}"}
    r = await client.get("/api/admin/marketplace-trends?days=30&tz=UTC", headers=admin)
    assert r.status_code == 200
    d = r.json()
    assert any(t["q"] == "walnut" for t in d["top_search_terms"])
    assert any(t["q"] == "walnut" for t in d["empty_searches"])
    assert {"fastest_growing_sections", "highest_converting_sections",
            "trending_categories"} <= set(d)
