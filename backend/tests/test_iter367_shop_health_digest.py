"""iter367 — Weekly Shop Health digest (bundles pending orders +
restock demand + Google feed quality into one maker email).

Covers (dry-run only — no real emails):
  • a maker with a paid unshipped order + flagged feed listing appears
    in summaries with correct section counts
  • a digital-only unshipped order does NOT count as pending
  • opted-out makers (restock_digest_opt_out=True) are skipped
  • all-quiet makers get no summary
"""
import os
import sys
import uuid

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))
os.environ["DB_NAME"] = "test_database"
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
sys.path.insert(0, "/app/backend")

import pytest

pytestmark = pytest.mark.asyncio


async def test_shop_health_summaries():
    from core import db
    from shop_health_digest import build_summaries

    tag = uuid.uuid4().hex[:6]
    m_active = f"sh-active-{tag}"
    m_opted = f"sh-opted-{tag}"
    m_quiet = f"sh-quiet-{tag}"
    now = "2026-06-11T00:00:00+00:00"

    makers = [
        {"slug": m_active, "name": "Active", "email": f"{m_active}@t.co", "deleted_at": None},
        {"slug": m_opted, "name": "Opted", "email": f"{m_opted}@t.co",
         "restock_digest_opt_out": True, "deleted_at": None},
        {"slug": m_quiet, "name": "Quiet", "email": f"{m_quiet}@t.co", "deleted_at": None},
    ]
    pid_phys = str(uuid.uuid4())
    pid_digi = str(uuid.uuid4())
    pid_opted = str(uuid.uuid4())
    products = [
        # Active maker: physical product with NO derivable material → feed flagged
        {"id": pid_phys, "slug": f"sh-prod-{tag}", "title": "Topographic Wall Piece",
         "category": "Wall Art", "maker_slug": m_active, "status": "published",
         "deleted_at": None, "price": 50.0, "created_at": now},
        # Digital product (never shippable)
        {"id": pid_digi, "slug": f"sh-digi-{tag}", "title": "Walnut SVG Bundle",
         "category": "Wall Art", "maker_slug": m_quiet, "listing_type": "digital",
         "status": "published", "deleted_at": None, "price": 9.0, "created_at": now},
        # Opted-out maker product, feed-flagged too
        {"id": pid_opted, "slug": f"sh-opted-prod-{tag}", "title": "Mystery Item",
         "category": "Wall Art", "maker_slug": m_opted, "status": "published",
         "deleted_at": None, "price": 20.0, "created_at": now},
    ]
    txs = [
        # paid + unshipped + physical → pending for m_active
        {"session_id": f"cs_sh_{tag}_1", "payment_status": "paid",
         "items": [{"product_id": pid_phys, "quantity": 1}], "created_at": now},
        # paid + unshipped but DIGITAL only → not pending for m_quiet
        {"session_id": f"cs_sh_{tag}_2", "payment_status": "paid",
         "items": [{"product_id": pid_digi, "quantity": 1}], "created_at": now},
        # shipped already → not pending
        {"session_id": f"cs_sh_{tag}_3", "payment_status": "paid", "shipped_at": now,
         "items": [{"product_id": pid_phys, "quantity": 1}], "created_at": now},
    ]
    waitlist = [
        {"id": str(uuid.uuid4()), "maker_slug": m_active, "product_id": pid_phys,
         "product_slug": f"sh-prod-{tag}", "product_title": "Topographic Wall Piece",
         "notified_at": None, "created_at": now},
        {"id": str(uuid.uuid4()), "maker_slug": m_active, "product_id": pid_phys,
         "product_slug": f"sh-prod-{tag}", "product_title": "Topographic Wall Piece",
         "notified_at": None, "created_at": now},
    ]
    await db.makers.insert_many(makers)
    await db.products.insert_many(products)
    await db.payment_transactions.insert_many(txs)
    await db.restock_waitlist.insert_many(waitlist)
    try:
        summaries = await build_summaries()
        by_slug = {s["maker_slug"]: s for s in summaries}

        assert m_active in by_slug
        active = by_slug[m_active]
        assert len(active["pending_orders"]) == 1            # only the unshipped physical tx
        assert active["restock_total"] == 2                  # two waitlist signups
        assert any(f["slug"] == f"sh-prod-{tag}" for f in active["feed_quality"])

        assert m_opted not in by_slug                        # opt-out honored
        assert m_quiet not in by_slug                        # digital-only ≠ pending; nothing actionable
    finally:
        await db.makers.delete_many({"slug": {"$in": [m_active, m_opted, m_quiet]}})
        await db.products.delete_many({"maker_slug": {"$in": [m_active, m_opted, m_quiet]}})
        await db.payment_transactions.delete_many({"session_id": {"$regex": f"^cs_sh_{tag}_"}})
        await db.restock_waitlist.delete_many({"maker_slug": m_active})


async def test_dry_run_does_not_stamp_state():
    from core import db
    from shop_health_digest import STATE_KEY, run_weekly_shop_health_digest

    await db.system_state.delete_one({"key": STATE_KEY})
    r = await run_weekly_shop_health_digest(force=True, dry_run=True, trigger="test")
    assert r["ran"] is True and r["dry_run"] is True
    assert await db.system_state.find_one({"key": STATE_KEY}) is None
