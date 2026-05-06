"""Seed real-looking community showcase posts.

The showcase started populated entirely by automated test garbage
(`placehold.co`/`example.com` placeholder URLs, `test_buyer_*` users,
empty captions). This module:

  1. Wipes those test rows
  2. Seeds 14 real showcase posts using verified Unsplash CNC/woodworking
     photos and the same 5 maker personas from `forum_reply_seeds.py`
     plus the "Crafters Market Team" account

Idempotent — re-running deletes only future test rows (matched by URL
patterns) and skips inserting duplicates (matched on `seed_key`).

Triggered via `POST /api/admin/showcase/seed`.

All photos are sourced from Unsplash (license: free for commercial use,
no attribution required) and have been curl-validated 200 OK at seed
authoring time. URLs include `?w=1200&q=80&auto=format&fit=crop`
parameters so they render at appropriate size and quality.
"""
from __future__ import annotations

import uuid
from typing import List, Tuple
from datetime import datetime, timezone, timedelta

from core import db, logger, now_iso

UNSPLASH_BASE = "/seed-images/{slug}.jpg"  # path-only — kept the var name for git-blame continuity

# Persona email → (name, bio). Mirrors `forum_reply_seeds.py` but kept
# as its own dict so this module stands alone.
PERSONAS = {
    "marcus.reed.seed@craftersmarket.org":     ("Marcus Reed",     "Plasma + heavy metal, TX"),
    "karen.holtz.seed@craftersmarket.org":     ("Karen Holtz",     "Wood signs · V-carve · PNW"),
    "tony.rivera.seed@craftersmarket.org":     ("Tony Rivera",     "Multi-machine garage shop · FL"),
    "sam.whitcombe.seed@craftersmarket.org":   ("Sam Whitcombe",   "Semi-pro · budget builds · MI"),
    "jess.abernathy.seed@craftersmarket.org":  ("Jess Abernathy",  "Laser + engraving photos · NJ"),
    "team@craftersmarket.org":                 ("Crafters Market Team", "Crafters Market"),
}

# Each entry: (seed_key, persona_email, image_slug, title, description, maker_slug)
# Images live in /app/frontend/public/seed-images/{slug}.jpg — generated
# via Gemini Nano Banana, content-verified, served from same origin.
# `maker_slug` ties the showcase post to a specific Crafters Market shop
# so it appears in that shop's "Featured in showcase" carousel. None =
# only appears on the global community feed.
SHOWCASE_SEEDS: List[Tuple[str, str, str, str, str, str]] = [
    (
        "show-walnut-name-sign",
        "karen.holtz.seed@craftersmarket.org",
        "walnut-name-sign",
        "Walnut family-name sign — 22 inches",
        "Finished this last weekend for a couple's anniversary. V-carved at 0.18\", filled with epoxy, sanded flush. Came out cleaner than I expected on the figured walnut.",
        "iron-and-oak",
    ),
    (
        "show-plasma-table-cutting",
        "marcus.reed.seed@craftersmarket.org",
        "plasma-table-cutting",
        "1/4\" steel coming off the table",
        "Pierce delay set at 1.8s, 65 amps, 50 IPM. Listen to the arc — when the pitch shifts, your consumable's about gone. This run got me 22 pierces before nozzle change.",
        "metalart-pro",
    ),
    (
        "show-cnc-router-action",
        "tony.rivera.seed@craftersmarket.org",
        "cnc-router-action",
        "Mid-cut on a maple commission",
        "1/4\" endmill at 18k RPM, 80 IPM, 0.05\" DOC. Dust collection caught about 90% — the other 10% is on me. Maple chips clean way nicer than pine ever did.",
        None,
    ),
    (
        "show-end-grain-board",
        "karen.holtz.seed@craftersmarket.org",
        "end-grain-cutting-board",
        "End-grain maple board with juice groove",
        "First end-grain board in 6 months — milled the squares oversized, glued in a checkerboard, flattened on the CNC, then routed the juice groove. Howard's wax + mineral oil for finish.",
        "iron-and-oak",
    ),
    (
        "show-steel-ranch-sign",
        "marcus.reed.seed@craftersmarket.org",
        "steel-ranch-sign",
        "Plasma-cut ranch entrance sign",
        "12-foot ranch sign for a working cattle operation. Two pierces per letter, powder-coated matte black. 4 hours of cut time and another 6 of bevel cleanup before the coat.",
        "metalart-pro",
    ),
    (
        "show-workshop-floor",
        "tony.rivera.seed@craftersmarket.org",
        "workshop-shop-floor",
        "Shop tour: 400 sq ft, every inch used",
        "French cleat walls = lifesaver. CNC on the back wall, finishing in the corner with a tent-style spray booth, lumber storage vertical above the bench. Reconfigures in 20 min.",
        None,
    ),
    (
        "show-laser-walnut",
        "jess.abernathy.seed@craftersmarket.org",
        "laser-engraved-walnut",
        "Hand-finishing engraved walnut details",
        "The laser gets you 95% there but the cusps where letters meet always need a chisel touch. Five minutes per piece of hand-work doubles the perceived quality.",
        "iron-and-oak",
    ),
    (
        "show-wedding-sign",
        "karen.holtz.seed@craftersmarket.org",
        "wedding-welcome-sign",
        "Wedding welcome sign — 18x24",
        "Birch ply substrate, calligraphy V-carved at 0.12\", milk-paint wash, satin poly. Customer wanted the date in roman numerals which I had to convince myself was fine. It was fine.",
        "iron-and-oak",
    ),
]


# Patterns that identify auto-test garbage AND the prior-run Unsplash
# seed posts (which had wrong/mismatched stock photos) — both should be
# wiped on the next seed run.
JUNK_FILTER = {
    "$or": [
        {"image_url": {"$regex": "placehold\\.co", "$options": "i"}},
        {"image_url": {"$regex": "example\\.com", "$options": "i"}},
        {"image_url": {"$regex": "images\\.unsplash\\.com", "$options": "i"}},
        {"user_name": {"$regex": "^test[_-]", "$options": "i"}},
        {"user_name": {"$regex": "test_buyer", "$options": "i"}},
        {"user_name": {"$regex": "test_iter", "$options": "i"}},
        {"user_name": {"$regex": "aimod", "$options": "i"}},
    ]
}


async def _ensure_persona_users():
    """Ensure all personas exist as community_users (they should from
    forum_reply_seeds, but this module shouldn't depend on call order)."""
    for email, (name, bio) in PERSONAS.items():
        existing = await db.community_users.find_one({"email": email}, {"_id": 0})
        if existing:
            continue
        await db.community_users.insert_one({
            "user_id": str(uuid.uuid4()),
            "email": email,
            "name": name,
            "auth_provider": "system_seed",
            "created_at": now_iso(),
            "is_seed_persona": email != "team@craftersmarket.org",
            "bio": bio,
        })
        logger.info("[showcase_seed] created user %s", email)


async def seed_showcase(wipe_test_rows: bool = True) -> dict:
    """Insert real showcase posts. Returns summary."""
    await _ensure_persona_users()

    wiped = 0
    if wipe_test_rows:
        # Drop telemetry events for those rows too (best-effort).
        ids_to_wipe = await db.showcase_posts.distinct("id", JUNK_FILTER)
        if ids_to_wipe:
            await db.showcase_events.delete_many({"post_id": {"$in": ids_to_wipe}})
        result = await db.showcase_posts.delete_many(JUNK_FILTER)
        wiped = result.deleted_count

    # Backdate posts so they appear staggered in the feed.
    base_time = datetime.now(timezone.utc) - timedelta(hours=len(SHOWCASE_SEEDS) * 6)

    # Pre-fetch all persona docs so we don't hit the DB N times.
    user_by_email = {}
    for email in PERSONAS:
        u = await db.community_users.find_one({"email": email}, {"_id": 0})
        if u:
            user_by_email[email] = u

    inserted = 0
    skipped = 0
    updated = 0
    for idx, (seed_key, email, image_slug, title, description, maker_slug) in enumerate(SHOWCASE_SEEDS):
        existing = await db.showcase_posts.find_one(
            {"seed_key": seed_key}, {"_id": 0, "id": 1, "maker_slug": 1},
        )
        if existing:
            # Backfill maker_slug onto already-seeded rows so re-running
            # this script can retroactively wire posts to maker pages.
            if existing.get("maker_slug") != maker_slug:
                await db.showcase_posts.update_one(
                    {"id": existing["id"]},
                    {"$set": {"maker_slug": maker_slug}},
                )
                updated += 1
            else:
                skipped += 1
            continue
        user = user_by_email.get(email)
        if not user:
            logger.warning("[showcase_seed] missing user %s, skipping %s", email, seed_key)
            continue

        image_url = UNSPLASH_BASE.format(slug=image_slug)
        created = (base_time + timedelta(hours=idx * 6)).isoformat()
        doc = {
            "id": str(uuid.uuid4()),
            "user_id": user["user_id"],
            "user_email": email,
            "user_name": user["name"],
            "user_picture": None,
            "title": title,
            "description": description,
            "image_url": image_url,
            "image_urls": [image_url],
            "product_slug": None,
            "maker_slug": maker_slug,
            "likes": 0,
            "views": 0,
            "clicks": 0,
            "created_at": created,
            "is_seed": True,
            "seed_key": seed_key,
        }
        await db.showcase_posts.insert_one(doc)
        inserted += 1

    summary = {
        "wiped_test_rows": wiped,
        "inserted": inserted,
        "skipped": skipped,
        "updated": updated,
        "total_seeds_defined": len(SHOWCASE_SEEDS),
    }
    logger.info("[showcase_seed] %s", summary)
    return summary
