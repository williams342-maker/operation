"""iter113 — Maker-side opt-out for the weekly Restock digest.

Verifies:
- A maker with `restock_digest_opt_out=True` is filtered out of the
  per-maker summary (no email scheduled for them in the cron run).
- A maker without the field, or with it set to False, is included.
- The maker model accepts the new field via PATCH /api/maker/profile.
"""
import asyncio
from unittest.mock import AsyncMock

import pytest


@pytest.fixture(scope="module")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


async def _seed_two_makers_with_pending_waitlist():
    """Create two makers + one product each + one pending waitlist entry
    on each product. Returns (slug_optedin, slug_optedout)."""
    from core import db, now_iso
    slug_in = "iter113-maker-in"
    slug_out = "iter113-maker-out"
    # Wipe any prior fixtures.
    await db.makers.delete_many({"slug": {"$in": [slug_in, slug_out]}})
    await db.products.delete_many({"maker_slug": {"$in": [slug_in, slug_out]}})
    await db.products.insert_many([
        {"slug": "iter113-prod-in", "title": "Sign In", "maker_slug": slug_in,
         "deleted_at": None, "status": "active"},
        {"slug": "iter113-prod-out", "title": "Sign Out", "maker_slug": slug_out,
         "deleted_at": None, "status": "active"},
    ])
    await db.makers.insert_many([
        {"slug": slug_in, "name": "OptedIn Maker", "email": "iter113-in@example.com",
         "restock_digest_opt_out": False},
        {"slug": slug_out, "name": "OptedOut Maker", "email": "iter113-out@example.com",
         "restock_digest_opt_out": True},
    ])
    # Pending backorder waitlist entries (one per product) — collection
    # name is `restock_waitlist`, fields per the cron's aggregation pipeline.
    await db.restock_waitlist.delete_many({"product_slug": {"$in": ["iter113-prod-in", "iter113-prod-out"]}})
    await db.restock_waitlist.insert_many([
        {"maker_slug": slug_in, "product_id": "p-in", "product_slug": "iter113-prod-in",
         "product_title": "Sign In", "email": "buyer1@example.com",
         "created_at": now_iso(), "notified_at": None},
        {"maker_slug": slug_out, "product_id": "p-out", "product_slug": "iter113-prod-out",
         "product_title": "Sign Out", "email": "buyer2@example.com",
         "created_at": now_iso(), "notified_at": None},
    ])
    return slug_in, slug_out


async def _cleanup(slugs):
    from core import db
    await db.makers.delete_many({"slug": {"$in": slugs}})
    await db.products.delete_many({"maker_slug": {"$in": slugs}})
    await db.restock_waitlist.delete_many({"product_slug": {"$in": ["iter113-prod-in", "iter113-prod-out"]}})


# ============================================================
# Cron filtering
# ============================================================
@pytest.mark.asyncio(loop_scope="module")
async def test_cron_skips_opted_out_makers():
    from maker_restock_digest import _per_maker_summary
    slug_in, slug_out = await _seed_two_makers_with_pending_waitlist()
    summaries = await _per_maker_summary()
    slugs = {s["maker_slug"] for s in summaries}
    assert slug_in in slugs, "Opted-IN maker MUST be in the digest summary"
    assert slug_out not in slugs, "Opted-OUT maker MUST NOT be in the digest summary"
    await _cleanup([slug_in, slug_out])


@pytest.mark.asyncio(loop_scope="module")
async def test_cron_default_opted_in_when_field_absent():
    """A maker doc without `restock_digest_opt_out` at all should still
    receive the digest — default behavior is opted IN."""
    from core import db, now_iso
    from maker_restock_digest import _per_maker_summary
    slug = "iter113-legacy-maker"
    await db.makers.delete_many({"slug": slug})
    await db.products.delete_many({"maker_slug": slug})
    await db.restock_waitlist.delete_many({"product_slug": "iter113-legacy-prod"})
    await db.products.insert_one({
        "slug": "iter113-legacy-prod", "title": "Legacy", "maker_slug": slug,
        "deleted_at": None, "status": "active",
    })
    await db.makers.insert_one({
        "slug": slug, "name": "Legacy", "email": "iter113-legacy@example.com",
        # NO `restock_digest_opt_out` field at all.
    })
    await db.restock_waitlist.insert_one({
        "maker_slug": slug, "product_id": "p-legacy",
        "product_slug": "iter113-legacy-prod", "product_title": "Legacy",
        "email": "b@example.com", "created_at": now_iso(), "notified_at": None,
    })
    summaries = await _per_maker_summary()
    assert any(s["maker_slug"] == slug for s in summaries)
    await db.makers.delete_many({"slug": slug})
    await db.products.delete_many({"maker_slug": slug})
    await db.restock_waitlist.delete_many({"product_slug": "iter113-legacy-prod"})


# ============================================================
# Profile PATCH accepts the new field
# ============================================================
@pytest.mark.asyncio(loop_scope="module")
async def test_maker_profile_update_accepts_restock_digest_opt_out():
    from models import MakerProfileUpdate
    p = MakerProfileUpdate(restock_digest_opt_out=True)
    assert p.restock_digest_opt_out is True
    p2 = MakerProfileUpdate(restock_digest_opt_out=False)
    assert p2.restock_digest_opt_out is False
    p3 = MakerProfileUpdate()
    assert p3.restock_digest_opt_out is None  # unset → don't change
