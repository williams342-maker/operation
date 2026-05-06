"""Tests for the auto-renew promotion feature (P0 follow-up to live
countdown work). Exercises:
  - `auto_renew_due_promotions()` correctly extends a promotion in window
    and skips one outside the window.
  - Plus subscribers are not charged on auto-renewal.
  - Free-tier makers accrue $5 on auto-renewal.
"""
import os
import sys
import asyncio
from datetime import datetime, timedelta, timezone

# Make the app importable from a pytest run rooted in /app/backend
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from core import db  # noqa: E402
from revenue import auto_renew_due_promotions  # noqa: E402


async def _fresh_maker(slug: str, plus: bool):
    await db.makers.delete_one({"slug": slug})
    await db.makers.insert_one({
        "id": f"test-{slug}",
        "slug": slug,
        "name": f"Test {slug}",
        "initials": "TS",
        "subscription_status": "active" if plus else "free",
        "pending_charges_cents": 0,
        "charge_history": [],
        "listings_used_lifetime": 0,
        "listings_by_month": {},
    })


async def _fresh_product(slug: str, maker: str, ends_in_hours: float, auto_renew: bool):
    end = (datetime.now(timezone.utc) + timedelta(hours=ends_in_hours)).isoformat()
    await db.products.delete_one({"slug": slug})
    await db.products.insert_one({
        "id": f"test-{slug}",
        "slug": slug,
        "title": f"Test {slug}",
        "maker_slug": maker,
        "category": "wall-art",
        "technique": "PLASMA",
        "price": 99,
        "status": "published",
        "deleted_at": None,
        "promoted_until": end,
        "auto_renew_promotion": auto_renew,
    })


async def _cleanup(maker_slugs, product_slugs):
    for s in maker_slugs:
        await db.makers.delete_one({"slug": s})
    for s in product_slugs:
        await db.products.delete_one({"slug": s})


def test_auto_renew_extends_in_window_and_charges_free_tier():
    async def go():
        await _fresh_maker("test-renew-free", plus=False)
        # Promotion ends in 4 hours → inside default 6h window
        await _fresh_product("test-prod-renew-1", "test-renew-free", 4, True)
        before_end = (await db.products.find_one({"slug": "test-prod-renew-1"}, {"_id": 0}))["promoted_until"]

        result = await auto_renew_due_promotions(window_hours=6)
        assert result["renewed"] >= 1, f"expected >=1 renew, got {result}"
        assert result["charged_makers"] >= 1
        assert result["errors"] == 0

        m = await db.makers.find_one({"slug": "test-renew-free"}, {"_id": 0})
        # $5 accrued
        assert m["pending_charges_cents"] >= 500, f"expected >=500c, got {m['pending_charges_cents']}"
        kinds = [h["kind"] for h in m.get("charge_history", [])]
        assert "promotion" in kinds

        # Extended by 7 days
        p = await db.products.find_one({"slug": "test-prod-renew-1"}, {"_id": 0})
        before = datetime.fromisoformat(before_end.replace("Z", "+00:00"))
        after = datetime.fromisoformat(p["promoted_until"].replace("Z", "+00:00"))
        assert (after - before).days >= 6, f"extension too short: {after - before}"

        await _cleanup(["test-renew-free"], ["test-prod-renew-1"])

    asyncio.run(go())


def test_auto_renew_plus_member_rides_free():
    async def go():
        await _fresh_maker("test-renew-plus", plus=True)
        await _fresh_product("test-prod-renew-2", "test-renew-plus", 3, True)

        result = await auto_renew_due_promotions(window_hours=6)
        assert result["free_renewals"] >= 1, f"expected free renewal, got {result}"

        m = await db.makers.find_one({"slug": "test-renew-plus"}, {"_id": 0})
        # No real charge
        assert m["pending_charges_cents"] == 0
        # But charge_history has a complimentary entry tagged amount_cents=0
        comp = [h for h in m.get("charge_history", []) if h.get("amount_cents") == 0 and h.get("kind") == "promotion"]
        assert comp, "expected a $0 complimentary entry in charge_history"
        assert "Plus complimentary" in (comp[0].get("note") or "")

        await _cleanup(["test-renew-plus"], ["test-prod-renew-2"])

    asyncio.run(go())


def test_auto_renew_skips_promotions_outside_window():
    async def go():
        await _fresh_maker("test-renew-skip", plus=False)
        # Ends in 24h → well outside the default 6h window
        await _fresh_product("test-prod-renew-3", "test-renew-skip", 24, True)

        result = await auto_renew_due_promotions(window_hours=6)
        # If anything got renewed, it shouldn't have been ours — verify
        # by checking the maker pending balance
        m = await db.makers.find_one({"slug": "test-renew-skip"}, {"_id": 0})
        assert m["pending_charges_cents"] == 0, "must NOT charge a promo outside the window"
        # And the product end time is unchanged
        p = await db.products.find_one({"slug": "test-prod-renew-3"}, {"_id": 0})
        assert datetime.fromisoformat(p["promoted_until"].replace("Z", "+00:00")) > datetime.now(timezone.utc) + timedelta(hours=23)

        await _cleanup(["test-renew-skip"], ["test-prod-renew-3"])
        # Result variable used for sanity check — run shouldn't error out
        assert result["errors"] == 0

    asyncio.run(go())


def test_auto_renew_skips_when_flag_off():
    async def go():
        await _fresh_maker("test-renew-off", plus=False)
        # Ends in 2h, but auto_renew=False
        await _fresh_product("test-prod-renew-4", "test-renew-off", 2, False)

        await auto_renew_due_promotions(window_hours=6)
        m = await db.makers.find_one({"slug": "test-renew-off"}, {"_id": 0})
        assert m["pending_charges_cents"] == 0, "auto_renew=False must not be touched"

        await _cleanup(["test-renew-off"], ["test-prod-renew-4"])

    asyncio.run(go())
