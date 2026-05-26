"""Public traction stats — live numbers for the /grow page counters.

iter232 — Powers the "Momentum" section on the Grow With Us page. Returns
real marketplace counts so the animated counters never lie (no inflated
fake stats). Cached for 60 seconds in-memory to keep the page snappy
when shared on social.

Public endpoint (no auth) — these are the same numbers visitors would
count themselves by scrolling the public catalog.
"""
from __future__ import annotations

import time

from fastapi import APIRouter

from core import db

router = APIRouter()

# Simple in-process cache. Refreshes every 60s. Good enough at the
# current traffic shape — a global cache lookup beats 5 Mongo counts
# per pageview by orders of magnitude.
_cache: dict[str, object] = {"at": 0.0, "data": None}
_TTL_SECONDS = 60


@router.get("/grow/traction")
async def grow_traction():
    now = time.time()
    if _cache["data"] and now - float(_cache["at"]) < _TTL_SECONDS:
        return _cache["data"]
    # All counts in parallel-ish (Motor's async makes this cheap)
    makers = await db.makers.count_documents({})
    founding = await db.makers.count_documents({"tier": "founder"})
    products = await db.products.count_documents({"status": "published", "deleted_at": None})
    community = await db.community_users.count_documents({})
    threads = await db.forum_threads.count_documents({})
    clips = await db.clips.count_documents({"quarantined_at": None})
    showcase = await db.showcase_posts.count_documents({"mod_status": {"$ne": "quarantined"}})
    # Roadmap progress — hardcoded for now. iter232 phase 1 ✓ + phase 2 ~half done.
    # Update as phases ship; surfacing this through a separate /admin endpoint
    # is a P2 improvement.
    roadmap_pct = 45
    data = {
        "makers_total": makers,
        "founding_makers": founding,
        "products_listed": products,
        "community_members": community,
        "forum_threads": threads,
        "clips_published": clips,
        "showcase_posts": showcase,
        "roadmap_pct": roadmap_pct,
    }
    _cache["data"] = data
    _cache["at"] = now
    return data
