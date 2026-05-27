"""Social auto-post service (iter271).

When a maker publishes a new listing on Crafters Market, eligible makers
get the listing automatically queued for posting to Crafters Market's
own branded social channels (Instagram, Pinterest, Facebook). The actual
publish to those channels is handled by ops manually today; a future
integration can pop items off the queue and post via Buffer/Meta API.

Pricing gates (iter271):
  • `inaugural` Founders     → eligible forever (perk of the Founder pack)
  • `regular`  Founders      → eligible while their founder period is active
  • Plus subscribers ($12/mo) → eligible while subscription_status == 'active'
  • Everyone else            → NOT eligible (sees "Upgrade to Plus" CTA)

This file owns:
  • `eligibility_for(maker)` — pure helper returning {eligible, tier, reason}
  • `enqueue_listing(product_slug)` — best-effort queue insert with dedup
  • The `social_auto_post_queue` Mongo collection schema (created lazily)
"""
from __future__ import annotations
import os
import uuid
from datetime import datetime, timezone
from typing import Optional, TypedDict

from core import db, logger, now_iso
from revenue import is_founder, is_inaugural_founder, is_plus


SITE_URL = (
    os.environ.get("PUBLIC_SITE_URL") or "https://craftersmarket.org"
).rstrip("/")


class Eligibility(TypedDict):
    eligible: bool
    tier: str  # "inaugural_founder" | "founder" | "plus" | "none"
    reason: str
    upsell: Optional[str]


def eligibility_for(maker: Optional[dict]) -> Eligibility:
    """Decide if this maker's new listings are auto-queued.

    Pure function — no DB writes. Reusable from listing_notify, the
    maker-dashboard status endpoint, and the admin queue UI."""
    m = maker or {}
    if is_inaugural_founder(m):
        return {
            "eligible": True, "tier": "inaugural_founder",
            "reason": "Inaugural Founder — included for life.",
            "upsell": None,
        }
    if is_founder(m):
        return {
            "eligible": True, "tier": "founder",
            "reason": "Founder member — included with your tier.",
            "upsell": None,
        }
    if is_plus(m):
        return {
            "eligible": True, "tier": "plus",
            "reason": "Plus subscriber — included with your $12/mo plan.",
            "upsell": None,
        }
    return {
        "eligible": False, "tier": "none",
        "reason": "Social auto-post is a Founder / Plus perk.",
        "upsell": (
            "Founder slots are limited — first 100 makers get it for life. "
            "After that, upgrade to Plus ($12/mo) to keep auto-posting."
        ),
    }


async def enqueue_listing(product_slug: str) -> dict:
    """Insert a queue row for ops/automation to publish to social.

    Idempotent — if a queued row for this slug already exists in
    `pending` state we don't insert another. Returns a structured dict
    suitable for tests + admin reuse."""
    product = await db.products.find_one(
        {"slug": product_slug, "deleted_at": {"$in": [None, ""]}},
        {"_id": 0},
    )
    if not product:
        return {"queued": False, "reason": "product_not_found"}
    if product.get("status") != "published":
        return {"queued": False, "reason": "not_published"}

    maker_slug = product.get("maker_slug") or ""
    maker = await db.makers.find_one({"slug": maker_slug}, {"_id": 0}) or {}
    elig = eligibility_for(maker)
    if not elig["eligible"]:
        return {
            "queued": False, "reason": "not_eligible",
            "tier": elig["tier"],
        }

    # Dedup: one pending row per slug
    existing = await db.social_auto_post_queue.find_one(
        {"product_slug": product_slug, "status": "pending"},
        {"_id": 0, "id": 1},
    )
    if existing:
        return {"queued": False, "reason": "already_queued",
                "id": existing["id"]}

    images = [u for u in (product.get("images") or []) if u]
    image_url = (images[0] if images
                 else product.get("image_url")
                 or f"{SITE_URL}/icons/icon-512.png")
    if image_url.startswith("/"):
        image_url = f"{SITE_URL}{image_url}"

    row = {
        "id": str(uuid.uuid4()),
        "status": "pending",  # pending | published | skipped
        "product_id": product.get("id"),
        "product_slug": product_slug,
        "product_title": product.get("title") or "",
        "product_url": f"{SITE_URL}/shop/{product_slug}",
        "image_url": image_url,
        "price": float(product.get("price") or 0),
        "maker_slug": maker_slug,
        "maker_name": maker.get("name") or maker_slug,
        "eligibility_tier": elig["tier"],
        "channels": ["instagram", "pinterest", "facebook"],
        "queued_at": now_iso(),
        "published_at": None,
        "published_by": None,
        "skipped_reason": None,
    }
    await db.social_auto_post_queue.insert_one(row)
    logger.info(
        "[social_auto_post] queued slug=%s maker=%s tier=%s",
        product_slug, maker_slug, elig["tier"],
    )
    # Return the row WITHOUT mongo's _id (we already excluded it from
    # the dict above, but defensive copy just in case the caller spreads it).
    return {"queued": True, "id": row["id"], "tier": elig["tier"]}


async def queue_summary(maker_slug: Optional[str] = None) -> dict:
    """Roll up counts by status (+ filtered by maker if provided).

    Used by both the maker dashboard ("you have N pending posts") and
    the admin queue page ("here's the global queue")."""
    match: dict = {}
    if maker_slug:
        match["maker_slug"] = maker_slug
    pipeline = [
        {"$match": match} if match else {"$match": {}},
        {"$group": {"_id": "$status", "count": {"$sum": 1}}},
    ]
    rows = await db.social_auto_post_queue.aggregate(pipeline).to_list(20)
    counts = {r["_id"]: int(r["count"]) for r in rows}
    return {
        "pending":   counts.get("pending", 0),
        "published": counts.get("published", 0),
        "skipped":   counts.get("skipped", 0),
        "total":     sum(counts.values()),
    }
