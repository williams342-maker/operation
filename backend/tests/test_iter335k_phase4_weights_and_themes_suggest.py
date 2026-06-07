"""iter335.14 — Phase 4: channel attribution weights + theme suggestions."""
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

ADMIN_EMAIL = "team@craftersmarket.org"
MAKER1_SLUG = "phase4-maker-a"
MAKER2_SLUG = "phase4-maker-b"


def _admin_jwt() -> str:
    from maker_auth import issue_session_jwt
    return issue_session_jwt(ADMIN_EMAIL, ADMIN_EMAIL, role="admin", session_version=0)


@pytest_asyncio.fixture(autouse=True)
async def _seed():
    from core import db
    # Wipe everything our tests touch.
    for col in ("payment_transactions", "ad_spend", "channel_weights",
                "orders", "theme_campaigns", "theme_contributions",
                "products"):
        await getattr(db, col).delete_many({"$or": [
            {"_id": {"$regex": "^phase4-"}},
            {"slug": {"$regex": "^phase4-"}},
            {"maker_slug": {"$in": [MAKER1_SLUG, MAKER2_SLUG]}},
            {"session_id": {"$regex": "^phase4-"}},
            {"_id": {"$in": ["google", "meta", "microsoft"]}},
        ]})
    # admin_users must exist for current_admin to validate the JWT.
    await db.admin_users.update_one(
        {"email": ADMIN_EMAIL},
        {"$setOnInsert": {"email": ADMIN_EMAIL,
                          "created_at": "2026-01-01T00:00:00+00:00"}},
        upsert=True,
    )
    yield


# ── Channel attribution weights ───────────────────────────────────────
async def test_channel_weights_cold_start_returns_equal_weights():
    """No orders + no spend in window → 1/3 weight per channel."""
    from services.channel_attribution import compute_weights
    r = await compute_weights(window_days=30)
    assert r["cold_start"] is True
    assert len(r["channels"]) == 3
    weights = [c["weight"] for c in r["channels"]]
    assert all(abs(w - (1 / 3)) < 0.01 for w in weights)
    assert all(c["orders_30d"] == 0 for c in r["channels"])


async def test_channel_weights_compute_real_roas():
    """Google has the best ROAS → should get the highest weight."""
    from core import db
    now_iso = datetime.now(timezone.utc).isoformat()
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    # Google: 5 orders × $100 = $500 revenue on $100 spend → 5x ROAS
    for i in range(5):
        await db.payment_transactions.insert_one({
            "session_id": f"phase4-g-{i}", "gclid": f"gclid{i}",
            "status": "paid", "paid_at": now_iso, "amount_cents": 10000,
        })
    await db.ad_spend.insert_one({
        "_id": "phase4-ad-g", "platform": "google",
        "date": today, "spend": 100.0,  # dollars
    })
    # Meta: 2 orders × $100 = $200 revenue on $200 spend → 1x ROAS
    for i in range(2):
        await db.payment_transactions.insert_one({
            "session_id": f"phase4-m-{i}", "fbclid": f"fbclid{i}",
            "status": "paid", "paid_at": now_iso, "amount_cents": 10000,
        })
    await db.ad_spend.insert_one({
        "_id": "phase4-ad-m", "platform": "meta",
        "date": today, "spend": 200.0,
    })
    # Microsoft: 0 orders / 0 spend → floor lift = 0.5
    from services.channel_attribution import compute_weights
    r = await compute_weights(window_days=30)
    assert r["cold_start"] is False
    by_ch = {c["channel"]: c for c in r["channels"]}
    assert by_ch["google"]["orders_30d"] == 5
    assert by_ch["google"]["revenue_cents_30d"] == 50000
    assert by_ch["google"]["spend_cents_30d"] == 10000
    assert by_ch["google"]["roas"] == 5.0
    assert by_ch["meta"]["roas"] == 1.0
    assert by_ch["microsoft"]["orders_30d"] == 0
    # Google (lift=5) > Meta (lift=1) > Microsoft (lift=0.5 floor)
    assert by_ch["google"]["weight"] > by_ch["meta"]["weight"] > by_ch["microsoft"]["weight"]
    # Weights should sum to ~1.0
    total_w = sum(c["weight"] for c in r["channels"])
    assert abs(total_w - 1.0) < 0.01


async def test_channel_weights_persist_and_read():
    """recompute_and_persist writes to channel_weights; get_persisted reads back."""
    from core import db
    from services import channel_attribution
    await db.payment_transactions.insert_one({
        "session_id": "phase4-persist-1", "gclid": "g-persist",
        "status": "paid", "paid_at": datetime.now(timezone.utc).isoformat(),
        "amount_cents": 5000,
    })
    r = await channel_attribution.recompute_and_persist(window_days=30)
    assert len(r["channels"]) == 3
    # Read back
    persisted = await channel_attribution.get_persisted()
    assert persisted["cold_start"] is False
    assert len(persisted["channels"]) == 3
    assert {c["channel"] for c in persisted["channels"]} == {"google", "meta", "microsoft"}


async def test_channel_weights_endpoint_requires_admin():
    from server import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/admin/ads/channel-weights")
    assert r.status_code in (401, 403)


async def test_channel_weights_endpoint_returns_data():
    from server import app
    h = {"Authorization": f"Bearer {_admin_jwt()}"}
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/admin/ads/channel-weights", headers=h)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "channels" in data
    assert "window_days" in data
    assert "cold_start" in data


async def test_channel_weights_recompute_endpoint():
    """Manual recompute returns the same shape as the read endpoint."""
    from server import app
    h = {"Authorization": f"Bearer {_admin_jwt()}"}
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post("/api/admin/ads/channel-weights/recompute", headers=h)
    assert r.status_code == 200, r.text
    data = r.json()
    assert len(data["channels"]) == 3
    assert all("weight" in c for c in data["channels"])


# ── Theme suggestions ─────────────────────────────────────────────────
async def test_theme_suggest_empty_when_no_orders():
    from services.theme_suggestions import suggest
    r = await suggest()
    assert r["suggestions"] == []
    assert r["recent_window_days"] == 7
    assert r["baseline_window_days"] == 7


async def test_theme_suggest_finds_growing_tag():
    """Tag with growing order volume + ≥2 makers should surface."""
    from core import db
    now = datetime.now(timezone.utc)
    recent_iso = (now - timedelta(days=2)).isoformat()
    baseline_iso = (now - timedelta(days=10)).isoformat()

    # 2 makers each have a listing tagged 'patio-furniture'
    await db.products.insert_many([
        {"slug": "phase4-prod-a", "maker_slug": MAKER1_SLUG,
         "title": "A", "status": "published", "deleted_at": None,
         "tags": ["patio-furniture"], "categories": []},
        {"slug": "phase4-prod-b", "maker_slug": MAKER2_SLUG,
         "title": "B", "status": "published", "deleted_at": None,
         "tags": ["patio-furniture"], "categories": []},
    ])
    # 5 recent orders carrying that tag, 1 baseline → +400% growth
    for i in range(5):
        await db.orders.insert_one({
            "session_id": f"phase4-recent-{i}", "status": "paid",
            "paid_at": recent_iso,
            "items": [{"snapshot": {"tags": ["patio-furniture"]}}],
        })
    await db.orders.insert_one({
        "session_id": "phase4-baseline-1", "status": "paid",
        "paid_at": baseline_iso,
        "items": [{"snapshot": {"tags": ["patio-furniture"]}}],
    })

    from services.theme_suggestions import suggest
    r = await suggest()
    tags = [s["tag"] for s in r["suggestions"]]
    assert "patio-furniture" in tags
    s = next(s for s in r["suggestions"] if s["tag"] == "patio-furniture")
    assert s["recent_orders"] == 5
    assert s["baseline_orders"] == 1
    assert s["growth_pct"] == 400.0
    assert s["distinct_makers"] == 2
    # Pre-filled draft is ready to submit
    assert s["draft"]["category_filter"] == ["patio-furniture"]
    assert s["draft"]["name"] == "Patio Furniture Week"
    assert s["draft"]["slug"] == "patio-furniture-week"
    assert s["draft"]["pool_total_cents"] == 50000


async def test_theme_suggest_skips_blacklisted_and_single_maker():
    """Generic terms (e.g. 'handmade') and tags with only 1 maker are filtered."""
    from core import db
    now = datetime.now(timezone.utc)
    recent_iso = (now - timedelta(days=2)).isoformat()
    # Only 1 maker has a product with 'single-maker-tag'
    await db.products.insert_one({
        "slug": "phase4-solo", "maker_slug": MAKER1_SLUG,
        "title": "Solo", "status": "published", "deleted_at": None,
        "tags": ["single-maker-tag", "handmade"], "categories": []})
    # 5 recent orders carry both tags
    for i in range(5):
        await db.orders.insert_one({
            "session_id": f"phase4-solo-{i}", "status": "paid",
            "paid_at": recent_iso,
            "items": [{"snapshot": {"tags": ["single-maker-tag", "handmade"]}}],
        })
    from services.theme_suggestions import suggest
    r = await suggest()
    tags = [s["tag"] for s in r["suggestions"]]
    assert "handmade" not in tags          # blacklisted
    assert "single-maker-tag" not in tags  # only 1 maker


async def test_theme_suggest_skips_already_covered():
    """If an active theme already covers a tag, suggest skips it."""
    from core import db
    now = datetime.now(timezone.utc)
    recent_iso = (now - timedelta(days=2)).isoformat()
    today = now.strftime("%Y-%m-%d")
    await db.products.insert_many([
        {"slug": "phase4-cov-a", "maker_slug": MAKER1_SLUG,
         "title": "A", "status": "published", "deleted_at": None,
         "tags": ["covered-already"], "categories": []},
        {"slug": "phase4-cov-b", "maker_slug": MAKER2_SLUG,
         "title": "B", "status": "published", "deleted_at": None,
         "tags": ["covered-already"], "categories": []},
    ])
    for i in range(4):
        await db.orders.insert_one({
            "session_id": f"phase4-cov-{i}", "status": "paid",
            "paid_at": recent_iso,
            "items": [{"snapshot": {"tags": ["covered-already"]}}],
        })
    await db.theme_campaigns.insert_one({
        "_id": "phase4-existing", "theme_id": "phase4-existing",
        "name": "Already Covered", "slug": "phase4-existing",
        "status": "active",
        "start_date": today, "end_date": today,
        "pool_total_cents": 100000, "pool_remaining_cents": 100000,
        "category_filter": ["covered-already"],
        "per_maker_cap_cents": 5000, "per_listing_cap_cents": 2000,
    })
    from services.theme_suggestions import suggest
    r = await suggest()
    tags = [s["tag"] for s in r["suggestions"]]
    assert "covered-already" not in tags


async def test_theme_suggest_endpoint_requires_admin():
    from server import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/admin/promote/themes/suggest")
    assert r.status_code in (401, 403)


async def test_theme_suggest_endpoint_happy_path():
    from server import app
    h = {"Authorization": f"Bearer {_admin_jwt()}"}
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/admin/promote/themes/suggest", headers=h)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "suggestions" in data
    assert isinstance(data["suggestions"], list)
