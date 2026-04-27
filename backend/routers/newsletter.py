"""Newsletter (Kit.com) routes — public subscribe + admin list."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field
from typing import Optional

from kit_service import _enabled, list_subscribers, subscribe
from maker_auth import current_admin

router = APIRouter()


class SubscribeIn(BaseModel):
    email: EmailStr
    first_name: Optional[str] = Field(default=None, max_length=80)
    source: str = Field(default="homepage", max_length=80)


@router.post("/newsletter/subscribe")
async def newsletter_subscribe(payload: SubscribeIn):
    if not _enabled():
        # Don't fail the user-facing request if Kit isn't configured —
        # silently swallow so the homepage widget shows a friendly success.
        return {"subscribed": True, "email": payload.email, "synced": False}
    try:
        return await subscribe(
            payload.email, first_name=payload.first_name, source=payload.source,
        )
    except Exception as e:
        # Friendly user-facing error; full detail is in db.newsletter_subscribers
        raise HTTPException(502, f"Newsletter signup failed: {str(e)[:200]}")


@router.get("/admin/newsletter/subscribers")
async def admin_newsletter_list(limit: int = 200, _: dict = Depends(current_admin)):
    return {"items": await list_subscribers(limit), "limit": limit}


# ============================================================
#  Save-drop — public endpoint (buyer hits ♡ on a product page)
# ============================================================
class SaveDropIn(BaseModel):
    email: EmailStr
    maker_slug: str = Field(min_length=1, max_length=80)
    product_slug: Optional[str] = Field(default=None, max_length=120)
    first_name: Optional[str] = Field(default=None, max_length=80)


@router.post("/save-drop")
async def save_drop_route(payload: SaveDropIn):
    from kit_service import save_drop
    try:
        return await save_drop(
            email=payload.email,
            maker_slug=payload.maker_slug,
            product_slug=payload.product_slug,
            first_name=payload.first_name,
        )
    except Exception as e:
        raise HTTPException(502, f"Save failed: {str(e)[:200]}")


@router.get("/admin/drop-saves")
async def admin_drop_saves(maker_slug: Optional[str] = None, limit: int = 200,
                           _: dict = Depends(current_admin)):
    from kit_service import list_drop_saves
    return {"items": await list_drop_saves(maker_slug, limit)}
