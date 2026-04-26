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
