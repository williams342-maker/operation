"""iter335 — Promote Engine: end-to-end (wallet + campaign + allocator + analytics).

Covers the happy paths the maker dashboard depends on. Each test is
self-contained: it seeds its own maker + listings into the test DB and
asserts the API contract.
"""
from __future__ import annotations

import os
import sys
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
# Force test DB — see test_iter334w for the rationale on explicit
# assignment (setdefault is a no-op when .env already set DB_NAME).
os.environ["DB_NAME"] = "test_database"
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
sys.path.insert(0, "/app/backend")

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

pytestmark = pytest.mark.asyncio


MAKER_EMAIL = "promote-test-maker@craftersmarket.org"
MAKER_SLUG = "promote-test-maker"


def _maker_jwt() -> str:
    """Mint a real maker session JWT via the official issuer so the
    `current_maker_slug` dep + session-version check both pass."""
    from maker_auth import issue_session_jwt
    return issue_session_jwt(MAKER_SLUG, MAKER_EMAIL, role="maker", session_version=0)


@pytest_asyncio.fixture(autouse=True)
async def _isolate_db():
    """Reset the promote collections + seed a maker with 3 listings."""
    from core import db
    for col in ("promotion_wallets", "wallet_transactions",
                "campaign_groups", "listing_allocations",
                "promote_pending_topups"):
        await getattr(db, col).delete_many({})
    await db.makers.delete_one({"slug": MAKER_SLUG})
    await db.makers.insert_one({
        "slug": MAKER_SLUG, "email": MAKER_EMAIL,
        "name": "Promote Test", "created_at": "2026-01-01T00:00:00+00:00",
    })
    await db.products.delete_many({"maker_slug": MAKER_SLUG})
    await db.products.insert_many([
        {
            "slug": f"{MAKER_SLUG}-listing-a",
            "maker_slug": MAKER_SLUG,
            "title": "Listing A", "price": 50, "in_stock": 10,
            "status": "published", "deleted_at": None,
            "created_at": "2026-05-01T00:00:00+00:00",
            "metrics": {"views": 100, "clicks": 10, "sold": 2},
        },
        {
            "slug": f"{MAKER_SLUG}-listing-b",
            "maker_slug": MAKER_SLUG,
            "title": "Listing B", "price": 30, "in_stock": 5,
            "status": "published", "deleted_at": None,
            "created_at": "2026-06-01T00:00:00+00:00",
            "metrics": {"views": 50, "clicks": 3, "sold": 0},
        },
        {
            "slug": f"{MAKER_SLUG}-listing-c",
            "maker_slug": MAKER_SLUG,
            "title": "Listing C (out of stock)", "price": 20, "in_stock": 0,
            "status": "published", "deleted_at": None,
            "created_at": "2026-04-01T00:00:00+00:00",
            "metrics": {},
        },
    ])
    yield


async def test_wallet_starts_empty_and_idempotent():
    from server import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.get("/api/promote/wallet",
                         headers={"Authorization": f"Bearer {_maker_jwt()}"})
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["balance_cents"] == 0
    assert b["lifetime_funded_cents"] == 0
    assert b["lifetime_spent_cents"] == 0
    assert b["transactions"] == []
    assert b["maker_slug"] == MAKER_SLUG


async def test_wallet_credit_and_debit_atomic():
    """Direct service-layer test — proves the conditional debit
    semantics (no overspend) without going through Stripe."""
    from services import promote_wallet as w
    await w.credit(MAKER_SLUG, 5000, kind="credit", ref="seed")
    assert await w.get_balance_cents(MAKER_SLUG) == 5000

    # Idempotency: same key only credits once.
    await w.credit(MAKER_SLUG, 1000, kind="topup", ref="x", idempotency_key="K1")
    await w.credit(MAKER_SLUG, 1000, kind="topup", ref="x", idempotency_key="K1")
    assert await w.get_balance_cents(MAKER_SLUG) == 6000  # only +1000, not +2000

    # Conditional debit succeeds.
    txn = await w.debit(MAKER_SLUG, 4000, kind="spend", ref="test")
    assert txn is not None
    assert txn["balance_after_cents"] == 2000

    # Conditional debit declined when balance insufficient.
    declined = await w.debit(MAKER_SLUG, 9999, kind="spend", ref="test2")
    assert declined is None
    assert await w.get_balance_cents(MAKER_SLUG) == 2000


async def test_allocator_preview_weights_sum_to_budget():
    from server import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post(
            "/api/promote/campaign/preview",
            json={"budget_cents": 5000, "goal": "sales", "channels": ["internal"],
                  "auto_allocate": True},
            headers={"Authorization": f"Bearer {_maker_jwt()}"},
        )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["budget_cents"] == 5000
    allocs = body["allocations"]
    assert len(allocs) == 3
    # Rounding can shave a few cents — allow ±0.5%.
    total = sum(int(a["allocated_cents"]) for a in allocs)
    assert abs(total - 5000) <= 5
    # Out-of-stock listing should score lowest (W_INVENTORY = 20%).
    out_of_stock = next(a for a in allocs if a["slug"].endswith("listing-c"))
    in_stock = [a for a in allocs if not a["slug"].endswith("listing-c")]
    assert out_of_stock["score"] < min(a["score"] for a in in_stock)


async def test_campaign_crud_and_pause_resume():
    from server import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        h = {"Authorization": f"Bearer {_maker_jwt()}"}
        # No campaign initially.
        r = await ac.get("/api/promote/campaign", headers=h)
        assert r.json()["campaign"] is None
        # Create.
        r = await ac.post("/api/promote/campaign", headers=h,
                          json={"budget_cents": 5000, "goal": "sales",
                                "channels": ["internal"], "auto_allocate": True})
        assert r.status_code == 200
        c = r.json()["campaign"]
        assert c["status"] == "active"
        assert c["goal"] == "sales"
        # Update (same maker → upsert path).
        r = await ac.post("/api/promote/campaign", headers=h,
                          json={"budget_cents": 7500, "goal": "traffic",
                                "channels": ["internal"], "auto_allocate": False})
        assert r.json()["campaign"]["budget_cents"] == 7500
        assert r.json()["campaign"]["goal"] == "traffic"
        # Bad goal rejected.
        r = await ac.post("/api/promote/campaign", headers=h,
                          json={"budget_cents": 1000, "goal": "bogus",
                                "channels": ["internal"]})
        assert r.status_code == 400
        # Pause / Resume.
        assert (await ac.post("/api/promote/campaign/pause", headers=h)).json()["status"] == "paused"
        assert (await ac.post("/api/promote/campaign/resume", headers=h)).json()["status"] == "active"


async def test_apply_debits_wallet_and_extends_promoted_until():
    """Full happy-path: credit wallet, create campaign, apply, assert
    promoted_until extended + wallet debited."""
    from server import app
    from services import promote_wallet as w
    from core import db
    await w.credit(MAKER_SLUG, 5000, kind="credit", ref="seed")

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        h = {"Authorization": f"Bearer {_maker_jwt()}"}
        await ac.post("/api/promote/campaign", headers=h,
                      json={"budget_cents": 5000, "goal": "sales",
                            "channels": ["internal"], "auto_allocate": True})
        r = await ac.post("/api/promote/campaign/apply", headers=h)

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "ok"
    assert body["boosts_applied"] > 0
    assert body["cents_spent"] > 0
    # Each boost is $5 → cents_spent must be a multiple of 500.
    assert body["cents_spent"] % 500 == 0

    # promoted_until extended on at least one listing.
    promoted_count = await db.products.count_documents({
        "maker_slug": MAKER_SLUG, "promoted_until": {"$ne": None},
    })
    assert promoted_count >= 1

    # Wallet debited by exactly cents_spent.
    bal = await w.get_balance_cents(MAKER_SLUG)
    assert bal == 5000 - body["cents_spent"]


async def test_apply_no_active_campaign_returns_404():
    from server import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        r = await ac.post("/api/promote/campaign/apply",
                          headers={"Authorization": f"Bearer {_maker_jwt()}"})
    assert r.status_code == 404


async def test_analytics_returns_zero_until_apply_then_reports_spend():
    from server import app
    from services import promote_wallet as w
    await w.credit(MAKER_SLUG, 5000, kind="credit", ref="seed")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        h = {"Authorization": f"Bearer {_maker_jwt()}"}
        # Before any campaign → 0 spend, empty per-listing array.
        r0 = await ac.get("/api/promote/analytics", headers=h)
        assert r0.status_code == 200
        assert r0.json()["spend_cents"] == 0
        assert r0.json()["per_listing"] == []

        await ac.post("/api/promote/campaign", headers=h,
                      json={"budget_cents": 5000, "goal": "sales",
                            "channels": ["internal"], "auto_allocate": True})
        await ac.post("/api/promote/campaign/apply", headers=h)

        r1 = await ac.get("/api/promote/analytics", headers=h)
        body = r1.json()
        assert body["spend_cents"] > 0
        assert body["boosted_listing_count"] >= 1
        assert len(body["per_listing"]) == 3  # one row per listing (some 0-boost)


async def test_topup_below_floor_rejected():
    """Topup must respect the $10 min / $1000 max guardrails."""
    from server import app
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        h = {"Authorization": f"Bearer {_maker_jwt()}"}
        r_low = await ac.post("/api/promote/wallet/topup", headers=h,
                              json={"amount_cents": 100})  # $1 → too low
        r_high = await ac.post("/api/promote/wallet/topup", headers=h,
                               json={"amount_cents": 200000})  # $2000 → too high
    assert r_low.status_code == 422
    assert r_high.status_code == 422
