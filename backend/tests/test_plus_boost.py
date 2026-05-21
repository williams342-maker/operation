"""Regression: Crafters Plus catalog priority boost (iter170 / Phase 4 #3).

`/api/products` returns listings in a 3-tier stable order:
   1. Paid promotions (`promoted_until` > now)
   2. Plus-maker listings (`maker.subscription_status == "active"`)
   3. Everyone else

Each tier is internally sorted by `created_at` desc.

This test exercises the ordering by flipping the test maker to/from Plus
and verifying the result list's ordering invariant — without polluting
the catalog with throwaway products.
"""
import os
import pytest
import httpx
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

with open("/app/frontend/.env") as f:
    API = next(
        (ln.split("=", 1)[1].strip() for ln in f if ln.startswith("REACT_APP_BACKEND_URL=")),
        "http://localhost:8001",
    )

TEST_MAKER_SLUG = "metalart-pro"


async def _reset_plus():
    from core import db
    await db.makers.update_one(
        {"slug": TEST_MAKER_SLUG},
        {"$set": {"subscription_status": "free"}},
    )


async def _set_plus():
    from core import db
    await db.makers.update_one(
        {"slug": TEST_MAKER_SLUG},
        {"$set": {"subscription_status": "active"}},
    )


@pytest.mark.asyncio
async def test_products_annotate_maker_is_plus_flag():
    await _set_plus()
    try:
        async with httpx.AsyncClient(timeout=30) as c:
            r = await c.get(f"{API}/api/products")
            assert r.status_code == 200, r.text
            products = r.json()
            mine = [p for p in products if p.get("maker_slug") == TEST_MAKER_SLUG]
            assert mine, "test maker has no listings — seed data missing?"
            for p in mine:
                assert p.get("maker_is_plus") is True, f"{p['slug']} should be flagged plus"
    finally:
        await _reset_plus()


@pytest.mark.asyncio
async def test_plus_listings_ranked_above_non_plus():
    """Make our test maker Plus and confirm at least one of their
    listings ranks above any non-Plus, non-promoted listing in the feed."""
    await _set_plus()
    try:
        async with httpx.AsyncClient(timeout=30) as c:
            r = await c.get(f"{API}/api/products")
            products = r.json()
    finally:
        await _reset_plus()

    # Slice off paid promotions (tier 1) — Plus boost only ranks the
    # non-promoted listings.
    from datetime import datetime, timezone
    now_iso = datetime.now(timezone.utc).isoformat()
    non_promoted = [
        p for p in products
        if not (p.get("promoted_until") and p["promoted_until"] > now_iso)
    ]
    if len(non_promoted) < 2:
        pytest.skip("Not enough non-promoted listings to verify ordering.")
    plus_idxs = [
        i for i, p in enumerate(non_promoted) if p.get("maker_is_plus")
    ]
    non_plus_idxs = [
        i for i, p in enumerate(non_promoted) if not p.get("maker_is_plus")
    ]
    if not plus_idxs or not non_plus_idxs:
        pytest.skip("Need both plus and non-plus listings in the feed.")
    # Every Plus index must be lower (= earlier) than every non-Plus index.
    assert max(plus_idxs) < min(non_plus_idxs), (
        f"plus indexes {plus_idxs} must come before non-plus {non_plus_idxs}"
    )


@pytest.mark.asyncio
async def test_no_boost_when_free_tier():
    """Sanity check: with the test maker on the free tier, their
    listings should not be flagged plus."""
    await _reset_plus()
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(f"{API}/api/products")
        products = r.json()
    mine = [p for p in products if p.get("maker_slug") == TEST_MAKER_SLUG]
    assert mine
    for p in mine:
        assert p.get("maker_is_plus") is False
