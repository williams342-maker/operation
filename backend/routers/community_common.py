"""Shared utilities for the community routers.

Split out so the four domain modules (auth, showcase, files, forum) can
all depend on these helpers without circular imports.

If you need to add a new helper used by more than one community module:
put it here, then import it where needed. If only one module uses it,
keep it module-local.
"""
from fastapi import HTTPException

from core import db


# Bump this when Terms / Code-of-Conduct text changes substantively. Any
# user whose stored eua_version doesn't match this is gated until they
# re-accept. Used by community_auth.py + read by the public /eua endpoint.
CURRENT_EUA_VERSION = "2026-04"


async def _ensure_user_can_post(user_id: str) -> dict:
    """Block banned/frozen community users from posting anywhere.

    Used by showcase uploads, forum threads/replies, and forum-attachment
    uploads — every write surface that could otherwise be abused after a
    moderator action. Returns the user doc on pass so callers can reuse
    fields without a second lookup.
    """
    user = await db.community_users.find_one({"user_id": user_id}, {"_id": 0})
    if not user:
        raise HTTPException(404, "User not found")
    status = user.get("moderation_status")
    if status == "banned":
        raise HTTPException(
            403,
            "Your account has been permanently suspended for policy violations.",
        )
    if status == "frozen":
        raise HTTPException(
            403,
            "Your account is temporarily frozen — contact support to restore access.",
        )
    return user
