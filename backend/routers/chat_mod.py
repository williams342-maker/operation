"""Admin per-channel chat moderation.

Sister to the existing `community.py` chat WebSocket — these endpoints let
the admin spot-fix a chatty user or a single message without disturbing
the rest of the room (or kicking them off all channels at once).

Endpoints:
  - GET    /admin/chat/messages?channel=X  → recent messages in a channel
  - DELETE /admin/chat/messages/{id}        → soft-delete a single message
  - GET    /admin/chat/mutes                → list active per-channel mutes
  - POST   /admin/chat/mute                 → mute user-in-channel (optional expiry)
  - DELETE /admin/chat/mute/{user_email}/{channel} → lift the mute
"""
from datetime import datetime, timedelta, timezone
from typing import Optional
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field

from core import db, logger, now_iso
from maker_auth import current_admin

router = APIRouter()


# ---------------- Messages ----------------
@router.get("/admin/chat/messages")
async def admin_chat_messages(
    channel: str, limit: int = 100, _: dict = Depends(current_admin),
):
    """Most recent N messages in a channel, newest first."""
    msgs = await db.chat_messages.find(
        {"channel": channel}, {"_id": 0},
    ).sort("created_at", -1).to_list(min(limit, 500))
    return {"channel": channel, "items": msgs}


@router.delete("/admin/chat/messages/{message_id}")
async def admin_chat_delete_message(
    message_id: str, claims: dict = Depends(current_admin),
):
    """Hard-delete a single message. The on-screen copy in active sessions
    won't disappear in real-time (that would require a WebSocket
    broadcast); next history fetch will reflect it."""
    doc = await db.chat_messages.find_one({"id": message_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Message not found.")
    await db.chat_messages.delete_one({"id": message_id})
    logger.info(
        "[chat-mod] %s deleted message id=%s in #%s by %s",
        claims["email"], message_id, doc.get("channel"), doc.get("user_email"),
    )
    return {"deleted": True, "channel": doc.get("channel")}


# ---------------- Per-channel mutes ----------------
class MuteIn(BaseModel):
    user_email: EmailStr
    channel: str = Field(min_length=1, max_length=40)
    minutes: Optional[int] = Field(default=None, ge=1, le=60 * 24 * 30)
    reason: Optional[str] = Field(default=None, max_length=240)


@router.get("/admin/chat/mutes")
async def admin_chat_list_mutes(_: dict = Depends(current_admin)):
    return {"items": await db.chat_mutes.find({}, {"_id": 0}).to_list(500)}


@router.post("/admin/chat/mute")
async def admin_chat_mute(payload: MuteIn, claims: dict = Depends(current_admin)):
    expires_at = None
    if payload.minutes:
        expires_at = (
            datetime.now(timezone.utc) + timedelta(minutes=payload.minutes)
        ).isoformat()
    row = {
        "id": str(uuid.uuid4()),
        "user_email": payload.user_email.lower(),
        "channel": payload.channel,
        "reason": payload.reason or "",
        "expires_at": expires_at,
        "created_at": now_iso(),
        "created_by": claims["email"],
    }
    await db.chat_mutes.update_one(
        {"user_email": row["user_email"], "channel": row["channel"]},
        {"$set": row},
        upsert=True,
    )
    logger.warning(
        "[chat-mod] %s muted %s in #%s%s",
        claims["email"], row["user_email"], row["channel"],
        f" until {expires_at}" if expires_at else " (indefinite)",
    )
    return row


@router.delete("/admin/chat/mute/{user_email}/{channel}")
async def admin_chat_unmute(
    user_email: str, channel: str, claims: dict = Depends(current_admin),
):
    r = await db.chat_mutes.delete_one({"user_email": user_email.lower(), "channel": channel})
    if not r.deleted_count:
        raise HTTPException(404, "Mute not found.")
    logger.info("[chat-mod] %s unmuted %s in #%s", claims["email"], user_email, channel)
    return {"unmuted": True}
