"""Listing-publish notification fan-out.

Idempotent: stamps `published_at` on the product the first time it goes live;
subsequent re-publishes don't re-broadcast. Fires three emails:
  1. Maker confirmation ("You're live")
  2. Ops awareness ("New listing")
  3. Followers broadcast (one email per follower of this maker)
"""
from __future__ import annotations

from typing import Optional

from core import db, logger, now_iso
from email_service import (
    send_maker_listing_published,
    send_ops_new_listing,
    send_follower_new_listing,
)


async def notify_listing_published(
    product_slug: str, *, force: bool = False,
) -> dict:
    """Look up the product + its maker and fan out emails.
    Returns a structured dict for tests/admin reuse."""
    product = await db.products.find_one({"slug": product_slug}, {"_id": 0})
    if not product:
        return {"sent": False, "reason": "product_not_found"}
    if product.get("status") != "published":
        return {"sent": False, "reason": "not_published"}
    if product.get("published_at") and not force:
        return {"sent": False, "reason": "already_announced"}

    maker = await db.makers.find_one(
        {"slug": product.get("maker_slug")}, {"_id": 0},
    )
    if not maker:
        return {"sent": False, "reason": "maker_not_found"}

    image: Optional[str] = (product.get("images") or [None])[0]
    title = product.get("title") or "New piece"
    listing_slug = product["slug"]
    price = float(product.get("price") or 0)

    # 1. Maker confirmation
    try:
        await send_maker_listing_published(
            maker_email=maker.get("email") or "",
            maker_name=maker.get("name") or maker.get("slug") or "Maker",
            listing_title=title,
            listing_slug=listing_slug,
            listing_image=image,
            listing_price=price,
        )
    except Exception as e:
        logger.exception("[listing_publish] maker confirm failed: %s", e)

    # 2. Ops awareness
    try:
        await send_ops_new_listing(
            maker_name=maker.get("name") or maker.get("slug"),
            maker_slug=maker["slug"],
            listing_title=title,
            listing_slug=listing_slug,
            listing_image=image,
            listing_price=price,
            category=product.get("category"),
            technique=product.get("technique"),
        )
    except Exception as e:
        logger.exception("[listing_publish] ops notify failed: %s", e)

    # 3. Followers broadcast
    follower_count = 0
    follower_sent = 0
    cursor = db.follows.find(
        {"maker_slug": maker["slug"]},
        {"_id": 0, "follower_email": 1, "follower_name": 1},
    )
    async for f in cursor:
        follower_count += 1
        if not f.get("follower_email"):
            continue
        try:
            await send_follower_new_listing(
                follower_email=f["follower_email"],
                follower_name=f.get("follower_name") or "there",
                maker_name=maker.get("name") or maker["slug"],
                maker_slug=maker["slug"],
                listing_title=title,
                listing_slug=listing_slug,
                listing_image=image,
                listing_price=price,
            )
            follower_sent += 1
        except Exception as e:
            logger.exception(
                "[listing_publish] follower notify failed for %s: %s",
                f.get("follower_email"), e,
            )

    # Stamp idempotency marker so renew/re-publish doesn't spam.
    await db.products.update_one(
        {"slug": listing_slug},
        {"$set": {"published_at": now_iso()}},
    )

    logger.info(
        "[listing_publish] %s · maker=%s followers=%d sent=%d",
        listing_slug, maker.get("slug"), follower_count, follower_sent,
    )
    return {
        "sent": True,
        "maker": maker.get("slug"),
        "follower_count": follower_count,
        "follower_sent": follower_sent,
    }
