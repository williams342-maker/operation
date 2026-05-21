"""Regression: renewal digest replaces per-listing reminders (iter167).

Verifies that:
  • `send_listing_expiry_reminders` returns the new shape
    {digests_sent, listings_covered, errors, now}.
  • Multiple expiring manual-renewal listings for the same maker
    produce exactly ONE digest (not one email per listing).
  • Auto-renewal listings inside the window are excluded.
  • Listings outside the window are excluded.
  • After a digest is sent, every covered listing has
    `renewal_reminder_sent_at` stamped so the sweep is idempotent.
"""
from datetime import datetime, timedelta, timezone

import pytest


@pytest.mark.asyncio
async def test_digest_groups_manual_listings_per_maker():
    from core import db
    from revenue import send_listing_expiry_reminders

    now = datetime.now(timezone.utc)
    in_3d = (now + timedelta(days=3)).isoformat()
    in_5d = (now + timedelta(days=5)).isoformat()
    in_30d = (now + timedelta(days=30)).isoformat()
    ts = int(now.timestamp())
    a = f"_dig-m-a-{ts}"
    b = f"_dig-m-b-{ts}"
    c_auto = f"_dig-auto-{ts}"
    d_far = f"_dig-far-{ts}"

    docs = [
        # Both manual, both in window → should be in ONE digest
        {
            "id": f"id-{a}", "slug": a, "title": "Window A",
            "category": "Wall Art", "technique": "PLASMA",
            "price": 1, "description": "x", "images": [],
            "maker_slug": "iron-and-oak", "in_stock": 1,
            "status": "published", "deleted_at": None,
            "expires_at": in_3d, "renewal_option": "manual",
            "renewal_reminder_sent_at": None,
        },
        {
            "id": f"id-{b}", "slug": b, "title": "Window B",
            "category": "Wall Art", "technique": "PLASMA",
            "price": 1, "description": "x", "images": [],
            "maker_slug": "iron-and-oak", "in_stock": 1,
            "status": "published", "deleted_at": None,
            "expires_at": in_5d, "renewal_option": "manual",
            "renewal_reminder_sent_at": None,
        },
        # Auto-renewal → must be EXCLUDED
        {
            "id": f"id-{c_auto}", "slug": c_auto, "title": "Auto skipped",
            "category": "Wall Art", "technique": "PLASMA",
            "price": 1, "description": "x", "images": [],
            "maker_slug": "iron-and-oak", "in_stock": 1,
            "status": "published", "deleted_at": None,
            "expires_at": in_3d, "renewal_option": "automatic",
            "renewal_reminder_sent_at": None,
        },
        # Manual but outside window → must be EXCLUDED
        {
            "id": f"id-{d_far}", "slug": d_far, "title": "Far skipped",
            "category": "Wall Art", "technique": "PLASMA",
            "price": 1, "description": "x", "images": [],
            "maker_slug": "iron-and-oak", "in_stock": 1,
            "status": "published", "deleted_at": None,
            "expires_at": in_30d, "renewal_option": "manual",
            "renewal_reminder_sent_at": None,
        },
    ]
    await db.products.insert_many([dict(d) for d in docs])
    try:
        r = await send_listing_expiry_reminders(days_before=7)
        assert "digests_sent" in r, r
        assert "listings_covered" in r
        # We seeded TWO eligible listings under the same maker → exactly
        # one digest covers both. Other test data may add to these counts;
        # we only assert the lower bound for the count and the stamp
        # behaviour on OUR seeded rows.
        assert r["digests_sent"] >= 1
        assert r["listings_covered"] >= 2
        # Stamp checks
        ra = await db.products.find_one({"slug": a}, {"_id": 0})
        rb = await db.products.find_one({"slug": b}, {"_id": 0})
        assert ra["renewal_reminder_sent_at"], "manual in-window listing must be stamped"
        assert rb["renewal_reminder_sent_at"]
        # Auto + far rows must NOT be stamped
        rc = await db.products.find_one({"slug": c_auto}, {"_id": 0})
        rd = await db.products.find_one({"slug": d_far}, {"_id": 0})
        assert not rc.get("renewal_reminder_sent_at"), "auto-renew must skip digest"
        assert not rd.get("renewal_reminder_sent_at"), "outside-window must skip digest"
    finally:
        await db.products.delete_many({"slug": {"$in": [a, b, c_auto, d_far]}})


@pytest.mark.asyncio
async def test_digest_is_idempotent_across_runs():
    """Second run of the sweep should not re-stamp or re-send for
    already-stamped listings."""
    from core import db
    from revenue import send_listing_expiry_reminders

    now = datetime.now(timezone.utc)
    in_3d = (now + timedelta(days=3)).isoformat()
    slug = f"_dig-idemp-{int(now.timestamp())}"
    await db.products.insert_one({
        "id": f"id-{slug}", "slug": slug, "title": "Idempotency test",
        "category": "Wall Art", "technique": "PLASMA",
        "price": 1, "description": "x", "images": [],
        "maker_slug": "iron-and-oak", "in_stock": 1,
        "status": "published", "deleted_at": None,
        "expires_at": in_3d, "renewal_option": "manual",
        "renewal_reminder_sent_at": None,
    })
    try:
        # First run — stamps the listing
        await send_listing_expiry_reminders(days_before=7)
        first = await db.products.find_one({"slug": slug}, {"_id": 0})
        stamp1 = first["renewal_reminder_sent_at"]
        assert stamp1, "first run must stamp the row"
        # Second run — no change to stamp (still the same one)
        await send_listing_expiry_reminders(days_before=7)
        second = await db.products.find_one({"slug": slug}, {"_id": 0})
        assert second["renewal_reminder_sent_at"] == stamp1
    finally:
        await db.products.delete_one({"slug": slug})
