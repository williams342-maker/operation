"""Listing-publish notification fan-out.

Idempotent: stamps `published_at` on the product the first time it goes live;
subsequent re-publishes don't re-broadcast. Fires three emails:
  1. Maker confirmation ("You're live")
  2. Ops awareness ("New listing")
  3. Followers broadcast (one email per follower of this maker)

Triple-fanout: when a listing is "high-value" (price >= HIGH_VALUE_PRICE,
featured, or maker-flagged), also fire:
  4. Buffer auto-post with a "NEW DROP" template
  5. Kit broadcast to the entire newsletter list
  6. A `kind="drop"` activity event (bigger ticker entry)
"""
from __future__ import annotations

import os
import uuid as _uuid
from typing import Optional

from core import db, logger, now_iso
from email_service import (
    send_maker_listing_published,
    send_ops_new_listing,
    send_follower_new_listing,
)


HIGH_VALUE_PRICE = float(os.environ.get("HIGH_VALUE_PRICE", "250"))
SITE_URL = os.environ.get("SITE_URL", "https://craftersmarket.org").rstrip("/")


def _activity_id() -> str:
    return str(_uuid.uuid4())


def _is_high_value(product: dict) -> bool:
    """Triple-fanout trigger. Any one of these qualifies:
      - price ≥ HIGH_VALUE_PRICE (default $250)
      - product.featured = True (admin-promoted Editor's Pick)
      - product.shop_of_the_week = True (curated drop)
      - product.is_drop = True (maker-flagged release)
    Tuneable per env without redeploying."""
    if (product.get("price") or 0) >= HIGH_VALUE_PRICE:
        return True
    return any(bool(product.get(k)) for k in ("featured", "shop_of_the_week", "is_drop"))


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

    # ============================================================
    #  Triple-fanout: high-value listings reach 3 channels at once.
    #  Each channel is best-effort — a failure in one MUST NOT
    #  break the publish flow or the others.
    # ============================================================
    high_value = _is_high_value(product)
    listing_url = f"{SITE_URL}/shop/{listing_slug}"

    # 4. Buffer (social fan-out)
    try:
        from buffer_service import auto_post_listing
        await auto_post_listing(product, maker)
    except Exception as e:
        logger.exception("[listing_publish] buffer auto-post failed: %s", e)

    if high_value:
        # 5. Kit drop broadcast — only for the loud ones, targeted to the
        # maker's "interested-in-{slug}" tag (saved-drop audience). When
        # nobody's saved any of this maker's drops yet, Kit silently
        # no-ops the send.
        try:
            from kit_service import create_drop_broadcast_targeted
            broadcast_id = await create_drop_broadcast_targeted(
                listing_title=title,
                listing_slug=listing_slug,
                listing_url=listing_url,
                maker_name=maker.get("name") or maker.get("slug") or "a maker",
                maker_slug=maker.get("slug") or "",
                listing_price=price,
                listing_image=image,
            )
            if broadcast_id:
                logger.info(
                    "[listing_publish] %s → kit broadcast id=%s",
                    listing_slug, broadcast_id,
                )
        except Exception as e:
            logger.exception("[listing_publish] kit broadcast failed: %s", e)

        # 6. Bigger activity-ticker entry (kind="drop")
        try:
            await db.activity_events.insert_one({
                "id": _activity_id(),
                "kind": "drop",
                "text": f"NEW DROP — {maker.get('name') or maker.get('slug')}: {title}",
                "location": maker.get("location") or "Workshop",
                "product_slug": listing_slug,
                "maker_slug": maker.get("slug"),
                "price": price,
                "image": image,
                "created_at": now_iso(),
            })
        except Exception as e:
            logger.exception("[listing_publish] activity drop entry failed: %s", e)

    logger.info(
        "[listing_publish] %s · maker=%s followers=%d sent=%d",
        listing_slug, maker.get("slug"), follower_count, follower_sent,
    )
    return {
        "sent": True,
        "maker": maker.get("slug"),
        "follower_count": follower_count,
        "follower_sent": follower_sent,
        "high_value": high_value,
        "fanout": {
            "buffer": True,
            "kit_broadcast": high_value,
            "activity_drop": high_value,
        },
    }
