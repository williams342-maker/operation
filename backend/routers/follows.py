"""Follow / unfollow makers.

Public-facing endpoints scoped to community-auth'd buyers. The follow
relationship lives in `db.follows` (compound unique on user_id+maker_slug).
"""
from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core import db, logger, now_iso
from maker_auth import current_buyer, optional_buyer

router = APIRouter()


class FollowStatus(BaseModel):
    is_following: bool
    follower_count: int


async def _get_user(claims: dict) -> dict:
    user = await db.community_users.find_one({"user_id": claims["sub"]}, {"_id": 0})
    if not user:
        raise HTTPException(404, "User not found.")
    if (user.get("moderation_status") or "active") != "active":
        raise HTTPException(403, "Your account is not currently active.")
    return user


@router.get("/makers/{maker_slug}/follow-status", response_model=FollowStatus)
async def follow_status(
    maker_slug: str, claims: Optional[dict] = Depends(optional_buyer),
):
    follower_count = await db.follows.count_documents({"maker_slug": maker_slug})
    is_following = False
    if claims:
        is_following = bool(
            await db.follows.find_one({
                "maker_slug": maker_slug, "user_id": claims["sub"],
            })
        )
    return FollowStatus(is_following=is_following, follower_count=follower_count)


@router.post("/makers/{maker_slug}/follow", response_model=FollowStatus)
async def follow_maker(
    maker_slug: str, claims: dict = Depends(current_buyer),
):
    maker = await db.makers.find_one({"slug": maker_slug}, {"_id": 0})
    if not maker:
        raise HTTPException(404, "Maker not found.")
    user = await _get_user(claims)
    # Idempotent — upsert the follow doc.
    await db.follows.update_one(
        {"user_id": claims["sub"], "maker_slug": maker_slug},
        {"$setOnInsert": {
            "id": str(uuid.uuid4()),
            "user_id": claims["sub"],
            "maker_slug": maker_slug,
            "follower_email": user.get("email"),
            "follower_name": user.get("name") or (user.get("email") or "").split("@")[0],
            "created_at": now_iso(),
        }},
        upsert=True,
    )
    follower_count = await db.follows.count_documents({"maker_slug": maker_slug})
    logger.info("[follow] %s → %s (total=%d)", user.get("email"), maker_slug, follower_count)
    return FollowStatus(is_following=True, follower_count=follower_count)


@router.delete("/makers/{maker_slug}/follow", response_model=FollowStatus)
async def unfollow_maker(
    maker_slug: str, claims: dict = Depends(current_buyer),
):
    await db.follows.delete_one({
        "user_id": claims["sub"], "maker_slug": maker_slug,
    })
    follower_count = await db.follows.count_documents({"maker_slug": maker_slug})
    return FollowStatus(is_following=False, follower_count=follower_count)
