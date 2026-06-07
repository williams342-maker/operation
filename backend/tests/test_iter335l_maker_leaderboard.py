"""iter335.15 — Maker Leaderboard widget."""
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
from datetime import datetime, timedelta, timezone
from httpx import ASGITransport, AsyncClient

pytestmark = pytest.mark.asyncio

M1 = "leaderboard-test-a"
M2 = "leaderboard-test-b"
M3 = "leaderboard-test-c"


@pytest_asyncio.fixture(autouse=True)
async def _seed():
    from core import db
    # Wipe everything our tests touch.
    for col in ("orders", "reviews", "products", "makers", "site_settings"):
        await getattr(db, col).delete_many({"$or": [
            {"slug": {"$in": [M1, M2, M3]}},
            {"maker_slug": {"$in": [M1, M2, M3]}},
            {"session_id": {"$regex": "^lb-test-"}},
            {"_id": {"$in": ["global"]}},
        ]})
    # Re-seed default site_settings with leaderboard_enabled=True.
    from routers.settings import DEFAULT_SETTINGS
    await db.site_settings.insert_one({**DEFAULT_SETTINGS})
    # 3 published, approved makers.
    for slug, name in [(M1, "Maker A"), (M2, "Maker B"), (M3, "Maker C")]:
        await db.makers.insert_one({
            "slug": slug, "name": name, "status": "approved",
            "hero_image_url": f"https://example.com/{slug}.jpg",
            "veteran_owned": (slug == M2),
            "created_at": "2026-01-01T00:00:00+00:00",
        })
    yield


# ── Endpoint shape ────────────────────────────────────────────────────
async def test_leaderboard_empty_when_no_activity():
    from server import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/leaderboard/makers")
    assert r.status_code == 200
    data = r.json()
    # Our 3 seed makers have no activity → none should appear.
    seed_slugs = {M1, M2, M3}
    our_makers = [m for m in data["makers"] if m["slug"] in seed_slugs]
    assert our_makers == []
    assert data["window_days"] == 30


async def test_leaderboard_returns_503_when_disabled():
    from core import db
    await db.site_settings.update_one(
        {"_id": "global"}, {"$set": {"leaderboard_enabled": False}},
    )
    from server import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/leaderboard/makers")
    assert r.status_code == 503


async def test_leaderboard_ranks_by_composite_score():
    """Maker A: 10 orders + $5k revenue → dominant Top Seller.
    Maker B: 0 orders + 8 reviews + 3 new listings → Reviewer Favorite.
    Maker C: 0 orders + 5 new listings → Rising."""
    from core import db
    now = datetime.now(timezone.utc)
    recent = (now - timedelta(days=5)).isoformat()
    # Maker A — 10 paid orders, $50 each → $500 revenue
    for i in range(10):
        await db.orders.insert_one({
            "session_id": f"lb-test-a-{i}", "status": "paid",
            "paid_at": recent,
            "items": [{"snapshot": {"maker_slug": M1, "price_cents": 5000},
                       "price_cents": 5000, "quantity": 1}],
        })
    # Maker B — 8 reviews, 3 new listings
    for i in range(8):
        await db.reviews.insert_one({
            "_id": f"lb-test-r-b-{i}", "maker_slug": M2,
            "created_at": recent, "rating": 5,
        })
    for i in range(3):
        await db.products.insert_one({
            "slug": f"lb-test-b-prod-{i}", "maker_slug": M2,
            "status": "published", "deleted_at": None,
            "created_at": recent, "title": f"B{i}",
            "metrics": {"views": 100}})
    # Maker C — 5 new listings, no orders/reviews
    for i in range(5):
        await db.products.insert_one({
            "slug": f"lb-test-c-prod-{i}", "maker_slug": M3,
            "status": "published", "deleted_at": None,
            "created_at": recent, "title": f"C{i}",
            "metrics": {"views": 20}})

    from server import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/leaderboard/makers", params={"limit": 50})
    assert r.status_code == 200
    seed = {M1, M2, M3}
    makers = [m for m in r.json()["makers"] if m["slug"] in seed]
    assert len(makers) == 3
    # Re-rank within our seed set (other makers may sit between them in
    # the global response — we only validate relative ordering).
    seed_ranked = sorted(makers, key=lambda m: m["score"], reverse=True)
    assert seed_ranked[0]["slug"] == M1
    assert seed_ranked[0]["orders"] == 10
    assert seed_ranked[0]["revenue_cents"] == 50000
    assert seed_ranked[0]["badge"] == "Top Seller"
    by_slug = {m["slug"]: m for m in makers}
    assert by_slug[M2]["score"] > by_slug[M3]["score"]
    assert by_slug[M2]["badge"] == "Reviewer Favorite"
    assert by_slug[M3]["badge"] == "Rising"


async def test_leaderboard_excludes_rejected_makers():
    """A rejected maker with great stats should not appear."""
    from core import db
    await db.makers.update_one({"slug": M1}, {"$set": {"status": "rejected"}})
    recent = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
    await db.orders.insert_one({
        "session_id": "lb-test-rej-1", "status": "paid", "paid_at": recent,
        "items": [{"snapshot": {"maker_slug": M1, "price_cents": 5000},
                   "price_cents": 5000, "quantity": 1}],
    })
    from server import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/leaderboard/makers")
    assert r.status_code == 200
    slugs = [m["slug"] for m in r.json()["makers"]]
    assert M1 not in slugs


async def test_leaderboard_respects_window_param():
    """An order older than the window should not count."""
    from core import db
    old_iso = (datetime.now(timezone.utc) - timedelta(days=100)).isoformat()
    await db.orders.insert_one({
        "session_id": "lb-test-old-1", "status": "paid", "paid_at": old_iso,
        "items": [{"snapshot": {"maker_slug": M1, "price_cents": 100000},
                   "price_cents": 100000, "quantity": 1}],
    })
    from server import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r1 = await ac.get("/api/leaderboard/makers", params={"limit": 50})
        r2 = await ac.get("/api/leaderboard/makers",
                          params={"window_days": 365, "limit": 50})
    assert r1.status_code == 200 and r2.status_code == 200
    seed = {M1, M2, M3}
    in_30d = {m["slug"] for m in r1.json()["makers"] if m["slug"] in seed}
    in_365d = {m["slug"] for m in r2.json()["makers"] if m["slug"] in seed}
    assert M1 not in in_30d
    assert M1 in in_365d


async def test_leaderboard_carries_veteran_flag_and_image():
    from core import db
    recent = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
    await db.orders.insert_one({
        "session_id": "lb-test-vet-1", "status": "paid", "paid_at": recent,
        "items": [{"snapshot": {"maker_slug": M2, "price_cents": 10000},
                   "price_cents": 10000, "quantity": 1}],
    })
    from server import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/leaderboard/makers")
    makers = r.json()["makers"]
    me = next(m for m in makers if m["slug"] == M2)
    assert me["veteran_owned"] is True
    assert me["hero_image_url"] == f"https://example.com/{M2}.jpg"
    assert me["name"] == "Maker B"


# ── Public settings + admin toggle ────────────────────────────────────
async def test_public_settings_exposes_leaderboard_enabled():
    from server import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/settings")
    assert r.status_code == 200
    assert "leaderboard_enabled" in r.json()
    assert r.json()["leaderboard_enabled"] is True


async def test_admin_can_toggle_leaderboard():
    from maker_auth import issue_session_jwt
    h = {"Authorization": f"Bearer {issue_session_jwt('team@craftersmarket.org', 'team@craftersmarket.org', role='admin', session_version=0)}"}
    from core import db
    await db.admin_users.update_one(
        {"email": "team@craftersmarket.org"},
        {"$setOnInsert": {"email": "team@craftersmarket.org",
                          "created_at": "2026-01-01T00:00:00+00:00"}},
        upsert=True,
    )
    from server import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.patch("/api/admin/settings",
                           headers=h, json={"leaderboard_enabled": False})
    assert r.status_code == 200, r.text
    assert r.json()["leaderboard_enabled"] is False
    # Verify the public endpoint now 503s
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r2 = await ac.get("/api/leaderboard/makers")
    assert r2.status_code == 503
