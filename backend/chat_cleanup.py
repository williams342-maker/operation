"""Idle-chat-room sweeper.

Deletes chat messages older than `idle_minutes` from rooms that have had
NO activity in the same window. Configurable per-toggle in site_settings.
Safe to run repeatedly; idempotent.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from core import db, logger


async def clear_idle_rooms(idle_minutes: Optional[int] = None) -> dict:
    from routers.settings import _get_or_create_settings
    s = await _get_or_create_settings()
    minutes = idle_minutes if idle_minutes is not None else int(s.get("idle_clear_minutes") or 60)
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=minutes)).isoformat()

    # Group by channel, find latest activity per room.
    pipeline = [{"$group": {"_id": "$channel", "last_at": {"$max": "$created_at"}}}]
    rooms = await db.chat_messages.aggregate(pipeline).to_list(100)

    cleared: list[dict] = []
    total_deleted = 0
    for room in rooms:
        ch = room["_id"]
        last = room.get("last_at") or ""
        if last and last > cutoff:
            continue  # still active
        r = await db.chat_messages.delete_many({"channel": ch})
        cleared.append({"channel": ch, "deleted": r.deleted_count, "last_active": last})
        total_deleted += r.deleted_count

    logger.info("[chat_cleanup] idle=%dm cleared=%d rooms total_msgs=%d",
                minutes, len(cleared), total_deleted)
    return {
        "idle_minutes": minutes,
        "cleared": cleared,
        "total_deleted": total_deleted,
    }
