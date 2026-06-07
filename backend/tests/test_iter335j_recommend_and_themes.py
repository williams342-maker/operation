"""iter335.13 — AI Recommend Budget + Active themes for maker."""
from __future__ import annotations
import os
import sys
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
os.environ["DB_NAME"] = "test_database"
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
sys.path.insert(0, "/app/backend")

import pytest
import pytest_asyncio
from datetime import datetime, timezone
from httpx import ASGITransport, AsyncClient

pytestmark = pytest.mark.asyncio

MAKER_SLUG = "rec-test-maker"
MAKER_EMAIL = "rec-test@craftersmarket.org"


def _maker_jwt() -> str:
    from maker_auth import issue_session_jwt
    return issue_session_jwt(MAKER_SLUG, MAKER_EMAIL, role="maker", session_version=0)


@pytest_asyncio.fixture(autouse=True)
async def _seed():
    from core import db
    for col in ("promotion_wallets", "wallet_transactions",
                "campaign_groups", "listing_allocations",
                "theme_campaigns", "theme_contributions"):
        await getattr(db, col).delete_many({})
    await db.makers.delete_one({"slug": MAKER_SLUG})
    await db.makers.insert_one({"slug": MAKER_SLUG, "email": MAKER_EMAIL,
                                "name": "Rec Test",
                                "created_at": "2026-01-01T00:00:00+00:00"})
    await db.products.delete_many({"maker_slug": MAKER_SLUG})
    yield


# ── Recommender unit tests ────────────────────────────────────────────
async def test_recommend_empty_catalog_returns_floor():
    """Brand-new maker (no listings) → returns the $25 floor + marketplace defaults."""
    from services.promote_recommend import recommend
    r = await recommend(MAKER_SLUG, "sales")
    assert r["recommended_cents"] == 2500  # REC_FLOOR_CENTS
    assert r["listing_count"] == 0
    assert r["basis"] == "marketplace-default"
    assert r["expected_reach"] > 0  # math still produces a non-zero estimate
    assert r["rationale"]  # always non-empty


async def test_recommend_uses_maker_history_when_present(monkeypatch):
    """Maker with real CTR/CVR history → basis flips to your-data."""
    from core import db
    await db.products.insert_many([
        {"slug": f"{MAKER_SLUG}-a", "maker_slug": MAKER_SLUG,
         "title": "A", "price": 50, "in_stock": 5,
         "status": "published", "deleted_at": None,
         "tags": ["outdoor"],
         "created_at": "2026-05-01T00:00:00+00:00",
         "metrics": {"views": 200, "clicks": 30, "sold": 5}},
        {"slug": f"{MAKER_SLUG}-b", "maker_slug": MAKER_SLUG,
         "title": "B", "price": 80, "in_stock": 5,
         "status": "published", "deleted_at": None,
         "tags": ["outdoor"],
         "created_at": "2026-05-01T00:00:00+00:00",
         "metrics": {"views": 300, "clicks": 50, "sold": 10}},
    ])
    # Force no LLM call so rationale comes from fallback (deterministic).
    monkeypatch.setenv("EMERGENT_LLM_KEY", "")

    from services.promote_recommend import recommend
    r = await recommend(MAKER_SLUG, "sales")
    assert r["basis"] == "your-data"
    assert r["listing_count"] == 2
    # CTR = (30+50)/(200+300) = 0.16; rec budget should saturate at 2 listings × 4 weeks × $5 = $40 → $4000c
    assert r["recommended_cents"] == 4000
    # CTR×rec budget should produce non-trivial click forecast.
    assert r["expected_clicks"] > r["expected_orders"] > 0


async def test_recommend_goal_changes_saturation_ceiling(monkeypatch):
    """traffic goal has higher ceiling → bigger budget for the same catalog."""
    from core import db
    monkeypatch.setenv("EMERGENT_LLM_KEY", "")
    docs = [
        {"slug": f"{MAKER_SLUG}-{i}", "maker_slug": MAKER_SLUG,
         "title": f"L{i}", "price": 50, "in_stock": 5,
         "status": "published", "deleted_at": None,
         "created_at": "2026-05-01T00:00:00+00:00",
         "metrics": {"views": 100, "clicks": 10, "sold": 1}}
        for i in range(10)
    ]
    await db.products.insert_many(docs)
    from services.promote_recommend import recommend
    sales = await recommend(MAKER_SLUG, "sales")
    traffic = await recommend(MAKER_SLUG, "traffic")
    reach = await recommend(MAKER_SLUG, "reach")
    # Sales ceiling=6, traffic=10, reach=4 → traffic > sales > reach
    assert traffic["recommended_cents"] > sales["recommended_cents"] > reach["recommended_cents"]


async def test_recommend_clamps_to_floor_and_ceiling():
    """Mathematical clamps are enforced regardless of listing count."""
    from services.promote_recommend import _recommended_budget_cents, REC_FLOOR_CENTS
    # 0 listings → floor
    assert _recommended_budget_cents(0, "sales") == REC_FLOOR_CENTS
    # Saturation caps based on goal ceiling. traffic=10 listings × 4 weeks × $5 = $200.
    # Even with 1000 listings, recommendation can't exceed the goal saturation point.
    assert _recommended_budget_cents(1000, "traffic") == 20000
    assert _recommended_budget_cents(1000, "sales") == 12000   # 6×4×500
    assert _recommended_budget_cents(1000, "reach") == 8000    # 4×4×500


async def test_recommend_endpoint_requires_auth():
    from server import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post("/api/promote/budget/recommend", json={"goal": "sales"})
    assert r.status_code in (401, 403)


async def test_recommend_endpoint_rejects_bad_goal():
    from server import app
    h = {"Authorization": f"Bearer {_maker_jwt()}"}
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post("/api/promote/budget/recommend",
                          headers=h, json={"goal": "bogus"})
    assert r.status_code == 400


async def test_recommend_endpoint_happy_path():
    from server import app
    h = {"Authorization": f"Bearer {_maker_jwt()}"}
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post("/api/promote/budget/recommend",
                          headers=h, json={"goal": "sales"})
    assert r.status_code == 200, r.text
    data = r.json()
    assert "recommended_cents" in data
    assert "expected_orders" in data
    assert "rationale" in data
    assert data["basis"] in ("your-data", "marketplace-default")


# ── Active themes for maker ───────────────────────────────────────────
async def test_active_themes_endpoint_returns_matching_themes_only():
    """Theme with outdoor filter matches outdoor listing; theme with
    indoor filter does NOT match an outdoor-only catalog."""
    from core import db
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    await db.products.insert_one({
        "slug": f"{MAKER_SLUG}-outdoor", "maker_slug": MAKER_SLUG,
        "title": "Outdoor Sign", "price": 60, "in_stock": 5,
        "status": "published", "deleted_at": None,
        "tags": ["outdoor", "patio"],
        "created_at": "2026-05-01T00:00:00+00:00",
        "metrics": {"views": 100, "clicks": 10, "sold": 2}})
    await db.theme_campaigns.insert_many([
        {"_id": "tA", "theme_id": "tA", "name": "Outdoor",
         "slug": "outdoor", "status": "active",
         "start_date": today, "end_date": today,
         "pool_total_cents": 100000, "pool_remaining_cents": 100000,
         "category_filter": ["outdoor"],
         "per_maker_cap_cents": 5000, "per_listing_cap_cents": 2000},
        {"_id": "tB", "theme_id": "tB", "name": "Indoor",
         "slug": "indoor", "status": "active",
         "start_date": today, "end_date": today,
         "pool_total_cents": 100000, "pool_remaining_cents": 100000,
         "category_filter": ["indoor"],
         "per_maker_cap_cents": 5000, "per_listing_cap_cents": 2000},
        # Empty filter → matches all
        {"_id": "tC", "theme_id": "tC", "name": "Universal",
         "slug": "universal", "status": "active",
         "start_date": today, "end_date": today,
         "pool_total_cents": 100000, "pool_remaining_cents": 100000,
         "category_filter": [],
         "per_maker_cap_cents": 5000, "per_listing_cap_cents": 2000},
    ])
    from server import app
    h = {"Authorization": f"Bearer {_maker_jwt()}"}
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/promote/themes/active", headers=h)
    assert r.status_code == 200, r.text
    slugs = {t["slug"] for t in r.json()["themes"]}
    assert slugs == {"outdoor", "universal"}, slugs
    assert "indoor" not in slugs


async def test_active_themes_endpoint_excludes_drained_or_inactive():
    from core import db
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    await db.products.insert_one({
        "slug": f"{MAKER_SLUG}-any", "maker_slug": MAKER_SLUG,
        "title": "Anything", "price": 30, "in_stock": 5,
        "status": "published", "deleted_at": None,
        "tags": [],
        "created_at": "2026-05-01T00:00:00+00:00",
        "metrics": {}})
    await db.theme_campaigns.insert_many([
        {"_id": "td1", "theme_id": "td1", "name": "Drained",
         "slug": "drained", "status": "active",
         "start_date": today, "end_date": today,
         "pool_total_cents": 100000, "pool_remaining_cents": 0,
         "category_filter": [], "per_maker_cap_cents": 5000,
         "per_listing_cap_cents": 2000},
        {"_id": "td2", "theme_id": "td2", "name": "Paused",
         "slug": "paused", "status": "paused",
         "start_date": today, "end_date": today,
         "pool_total_cents": 100000, "pool_remaining_cents": 50000,
         "category_filter": [], "per_maker_cap_cents": 5000,
         "per_listing_cap_cents": 2000},
    ])
    from server import app
    h = {"Authorization": f"Bearer {_maker_jwt()}"}
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/promote/themes/active", headers=h)
    assert r.status_code == 200
    assert r.json()["themes"] == []


async def test_active_themes_reports_per_maker_remaining():
    """Theme with prior contributions reports correct remaining cap."""
    from core import db
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    await db.products.insert_one({
        "slug": f"{MAKER_SLUG}-x", "maker_slug": MAKER_SLUG,
        "title": "X", "price": 30, "in_stock": 5,
        "status": "published", "deleted_at": None,
        "tags": ["outdoor"],
        "created_at": "2026-05-01T00:00:00+00:00", "metrics": {}})
    await db.theme_campaigns.insert_one({
        "_id": "tcap", "theme_id": "tcap", "name": "Capped",
        "slug": "capped", "status": "active",
        "start_date": today, "end_date": today,
        "pool_total_cents": 100000, "pool_remaining_cents": 100000,
        "category_filter": ["outdoor"],
        "per_maker_cap_cents": 5000, "per_listing_cap_cents": 2000,
    })
    await db.theme_contributions.insert_one({
        "theme_id": "tcap", "maker_slug": MAKER_SLUG,
        "listing_slug": f"{MAKER_SLUG}-x",
        "amount_cents": 1500, "applied_at": "2026-06-01T00:00:00+00:00",
    })
    from server import app
    h = {"Authorization": f"Bearer {_maker_jwt()}"}
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/promote/themes/active", headers=h)
    assert r.status_code == 200
    themes = r.json()["themes"]
    assert len(themes) == 1
    t = themes[0]
    assert t["claimed_by_maker_cents"] == 1500
    assert t["remaining_for_maker_cents"] == 3500  # 5000 - 1500
