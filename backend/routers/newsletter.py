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
