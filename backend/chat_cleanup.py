"""Idle-chat-room sweeper.

Deletes messages from rooms that have had NO activity within the configured
window. Robust to mixed ISO format (with or without timezone) — we always
parse to a tz-aware UTC datetime before comparing.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from core import db, logger


def _parse_iso(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        # Python's fromisoformat handles 'Z' (3.11+) and tz-offsets natively.
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


async def clear_idle_rooms(idle_minutes: Optional[int] = None) -> dict:
    from routers.settings import _get_or_create_settings
    s = await _get_or_create_settings()
    minutes = idle_minutes if idle_minutes is not None else int(s.get("idle_clear_minutes") or 60)
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=minutes)

    # Group by channel, find latest activity per room.
    pipeline = [{"$group": {"_id": "$channel", "last_at": {"$max": "$created_at"}}}]
    rooms = await db.chat_messages.aggregate(pipeline).to_list(100)

    cleared: list[dict] = []
    total_deleted = 0
    for room in rooms:
        ch = room["_id"]
        last_dt = _parse_iso(room.get("last_at"))
        # If we couldn't parse (corrupt row) treat the room as idle so it
        # gets cleared rather than lingering forever.
        if last_dt and last_dt > cutoff:
            continue
        r = await db.chat_messages.delete_many({"channel": ch})
        cleared.append({
            "channel": ch,
            "deleted": r.deleted_count,
            "last_active": room.get("last_at"),
        })
        total_deleted += r.deleted_count

    logger.info("[chat_cleanup] idle=%dm cleared=%d rooms total_msgs=%d",
                minutes, len(cleared), total_deleted)
    return {
        "idle_minutes": minutes,
        "cleared": cleared,
        "total_deleted": total_deleted,
    }
