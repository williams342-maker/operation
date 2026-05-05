"""Buffer (social media) HTTP routes — admin + maker."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from core import db, logger
from buffer_service import (
    BUFFER_AUTO_PUBLISH, _enabled, create_post, list_channels, list_recent_posts,
)
from maker_auth import current_admin, current_maker_slug

router = APIRouter()


class BufferPostIn(BaseModel):
    text: str = Field(..., min_length=1, max_length=2000)
    channel_ids: list[str] = Field(..., min_length=1)
    image_url: Optional[str] = None
    mode: str = "addToQueue"  # addToQueue | shareNow | shareNext


# ============================================================
#  Admin
# ============================================================
@router.get("/admin/buffer/status")
async def admin_buffer_status(_: dict = Depends(current_admin)):
    """Quick health-check + connected channels for the admin Social tab."""
    if not _enabled():
        return {"enabled": False, "auto_publish": BUFFER_AUTO_PUBLISH,
                "channels": [], "reason": "BUFFER_API_KEY / BUFFER_ORG_ID missing"}
    try:
        channels = await list_channels()
        return {"enabled": True, "auto_publish": BUFFER_AUTO_PUBLISH,
                "channels": channels}
    except Exception as e:
        logger.warning("[buffer] status: %s", e)
        return {"enabled": False, "auto_publish": BUFFER_AUTO_PUBLISH,
                "channels": [], "reason": str(e)[:300]}


@router.get("/admin/buffer/posts")
async def admin_buffer_posts(limit: int = 50, _: dict = Depends(current_admin)):
    return {"items": await list_recent_posts(limit), "limit": limit}


@router.post("/admin/buffer/post")
async def admin_buffer_post(payload: BufferPostIn, claims: dict = Depends(current_admin)):
    if not _enabled():
        raise HTTPException(503, "Buffer is not configured.")
    try:
        row = await create_post(
            text=payload.text, channel_ids=payload.channel_ids,
            image_url=payload.image_url, mode=payload.mode,
            source="admin", posted_by=claims["email"],
        )
        return row
    except ValueError as e:
        raise HTTPException(400, str(e))


class BackfillIn(BaseModel):
    days: int = Field(default=7, ge=1, le=90)
    max_to_post: int = Field(default=20, ge=1, le=100)
    force: bool = False  # if True, ignore the site_settings gate


@router.post("/admin/buffer/backfill-5star-reviews")
async def admin_backfill_5star_reviews(
    payload: BackfillIn = BackfillIn(),
    claims: dict = Depends(current_admin),
):
    """Re-run the 5-star auto-publish flow against historical reviews.

    Useful right after enabling the `auto_publish_5star_reviews_enabled`
    toggle so makers' recent un-posted 5★s aren't stuck unposted. Scans
    `reviews` for rows with rating=5 created in the last `days` days that
    have no `posted_to_buffer_at` stamp yet, then funnels each through
    `auto_post_5star_review` (which itself enforces the settings gate,
    min-length, idempotency stamp, and channel checks).

    Returns per-review outcomes so the admin can see exactly which posts
    succeeded, were skipped, or hit a Buffer error. Idempotent — calling
    twice does NOT double-post: each successful post stamps
    `posted_to_buffer_at` so the second run skips it.
    """
    if not _enabled():
        raise HTTPException(503, "Buffer is not configured.")

    from datetime import datetime, timedelta, timezone
    from buffer_service import auto_post_5star_review
    from routers.settings import get_setting, _get_or_create_settings

    # Optional bypass of the master toggle for one-off backfill runs even
    # when the operator wants the daily auto-flow OFF.
    enabled = await get_setting("auto_publish_5star_reviews_enabled", False)
    if not enabled and not payload.force:
        raise HTTPException(
            409,
            "auto_publish_5star_reviews_enabled is OFF — flip it on first, "
            "or pass force=true to bypass for this single backfill run.",
        )
    if payload.force and not enabled:
        # Temporarily flip ON for the duration of this call so the gate
        # inside auto_post_5star_review doesn't bail. Restore at the end.
        await _get_or_create_settings()
        await db.site_settings.update_one(
            {"_id": "global"},
            {"$set": {"auto_publish_5star_reviews_enabled": True}},
        )

    cutoff_iso = (datetime.now(timezone.utc) - timedelta(days=payload.days)).isoformat()
    query = {
        "rating": 5,
        "created_at": {"$gte": cutoff_iso},
        "$or": [
            {"posted_to_buffer_at": {"$exists": False}},
            {"posted_to_buffer_at": None},
        ],
    }
    candidates = await db.reviews.find(
        query, {"_id": 0},
    ).sort("created_at", -1).to_list(payload.max_to_post * 4)

    results = []
    posted = skipped = failed = 0
    try:
        for r in candidates:
            if posted >= payload.max_to_post:
                break
            try:
                row = await auto_post_5star_review(r)
                if row is None:
                    skipped += 1
                    results.append({
                        "review_id": r.get("id"),
                        "maker_slug": r.get("maker_slug"),
                        "outcome": "skipped",
                        "reason": "gate (too short, no maker, no channels, or settings disabled)",
                    })
                else:
                    posted += 1
                    results.append({
                        "review_id": r.get("id"),
                        "maker_slug": r.get("maker_slug"),
                        "outcome": "posted",
                        "buffer_post_id": row.get("id"),
                        "channels_ok": int(row.get("success_count", 0)),
                        "channels_failed": int(row.get("failed_count", 0)),
                    })
            except Exception as e:
                failed += 1
                results.append({
                    "review_id": r.get("id"),
                    "maker_slug": r.get("maker_slug"),
                    "outcome": "error",
                    "error": str(e)[:200],
                })
    finally:
        # Restore the toggle if we flipped it temporarily.
        if payload.force and not enabled:
            await db.site_settings.update_one(
                {"_id": "global"},
                {"$set": {"auto_publish_5star_reviews_enabled": False}},
            )

    await db.audit_log.insert_one({
        "kind": "buffer_backfill_5star",
        "actor": claims.get("email"),
        "days": payload.days,
        "scanned": len(candidates),
        "posted": posted, "skipped": skipped, "failed": failed,
        "force": payload.force,
        "created_at": __import__("core").now_iso(),
    })
    logger.info(
        "[buffer] 5-star backfill — scanned=%d posted=%d skipped=%d failed=%d (days=%d)",
        len(candidates), posted, skipped, failed, payload.days,
    )
    return {
        "scanned": len(candidates),
        "posted": posted, "skipped": skipped, "failed": failed,
        "days": payload.days,
        "results": results,
    }



# ============================================================
#  Maker — share one of my listings
# ============================================================
@router.post("/maker/buffer/share-listing/{slug}")
async def maker_share_listing(slug: str, maker_slug: str = Depends(current_maker_slug)):
    """Fan-out a listing the calling maker owns to every connected Buffer
    channel. Uses the same default template as the auto-publish hook."""
    if not _enabled():
        raise HTTPException(503, "Buffer is not configured.")
    product = await db.products.find_one({"slug": slug, "maker_slug": maker_slug},
                                         {"_id": 0})
    if not product:
        raise HTTPException(404, "Listing not found.")
    if product.get("status") != "published":
        raise HTTPException(400, "Listing must be published before sharing.")
    maker = await db.makers.find_one({"slug": maker_slug}, {"_id": 0})
    if not maker:
        raise HTTPException(404, "Maker not found.")

    try:
        channels = await list_channels()
    except Exception as e:
        raise HTTPException(502, f"Buffer unreachable: {str(e)[:200]}")
    if not channels:
        raise HTTPException(409, "No social channels connected to Buffer.")

    from buffer_service import SITE_URL
    title = product.get("title") or "New piece"
    price = float(product.get("price") or 0)
    url = f"{SITE_URL}/shop/{slug}"
    maker_name = maker.get("name") or maker_slug
    image = (product.get("images") or [None])[0]
    text = f"New from {maker_name}: {title} — ${price:.0f} → {url}"

    row = await create_post(
        text=text, channel_ids=[c["id"] for c in channels],
        image_url=image, mode="addToQueue",
        source="maker", posted_by=maker_slug, product_slug=slug,
    )
    return row
