"""Direct-message block / unblock.

Google Play UGC policy requires the ability to block another user in any
user-to-user messaging surface. Blocks are stored in `db.dm_blocks` with
a compound (blocker_key, blocked_key) key, applied bidirectionally.

Keys use the same scheme as the DM router: `maker:<slug>` or `buyer:<email>`.

Enforcement is layered in `routers/messages.py` — see `_ensure_not_blocked`.
"""
from __future__ import annotations
import uuid
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel

from core import db, now_iso
from maker_auth import decode_session_jwt, _check_session_version

router = APIRouter(prefix="", tags=["dm-blocks"])


async def _actor(authorization: str | None = Header(default=None)) -> dict:
    """Same shape as `messages._dm_sender` — maker or buyer bearer accepted."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Missing bearer token.")
    token = authorization.split(" ", 1)[1].strip()
    claims = decode_session_jwt(token)
    role = claims.get("role", "")
    if role not in ("maker", "buyer"):
        raise HTTPException(403, "Maker or buyer access required.")
    await _check_session_version(role, claims)
    key = (
        f"maker:{claims['sub']}" if role == "maker"
        else f"buyer:{(claims.get('email') or '').lower()}"
    )
    return {"role": role, "key": key}


class BlockIn(BaseModel):
    """Payload for both /block and /unblock: identifies the other party.
    Either `other_key` (already-formatted `maker:<slug>` / `buyer:<email>`)
    or a `thread_id` (we resolve the other party from the thread row)."""
    other_key: Optional[str] = None
    thread_id: Optional[str] = None


async def _resolve_other_key(actor: dict, payload: BlockIn) -> str:
    if payload.other_key:
        ok = payload.other_key.strip().lower()
        if not (ok.startswith("maker:") or ok.startswith("buyer:")):
            raise HTTPException(400, "other_key must be prefixed with 'maker:' or 'buyer:'.")
        return ok
    if payload.thread_id:
        t = await db.dm_threads.find_one({"id": payload.thread_id},
                                         {"_id": 0, "maker_slug": 1, "buyer_email": 1})
        if not t:
            raise HTTPException(404, "Thread not found.")
        maker_key = f"maker:{t['maker_slug']}"
        buyer_key = f"buyer:{(t.get('buyer_email') or '').lower()}"
        # The "other" side of the actor
        if actor["key"] == maker_key: return buyer_key
        if actor["key"] == buyer_key: return maker_key
        raise HTTPException(403, "You are not a participant of this thread.")
    raise HTTPException(400, "Provide either other_key or thread_id.")


@router.post("/messages/blocks")
async def block(payload: BlockIn, actor: dict = Depends(_actor)):
    other = await _resolve_other_key(actor, payload)
    if other == actor["key"]:
        raise HTTPException(400, "You cannot block yourself.")
    # Upsert (idempotent)
    await db.dm_blocks.update_one(
        {"blocker_key": actor["key"], "blocked_key": other},
        {"$setOnInsert": {
            "id": uuid.uuid4().hex,
            "blocker_key": actor["key"],
            "blocked_key": other,
            "created_at": now_iso(),
        }},
        upsert=True,
    )
    # Hide any existing threads with the blocked party from the blocker's inbox
    if payload.thread_id:
        await db.dm_threads.update_one(
            {"id": payload.thread_id},
            {"$set": {
                f"{'maker' if actor['role'] == 'maker' else 'buyer'}_hidden": True,
                "blocked_at": now_iso(),
            }},
        )
    return {"ok": True, "blocked": other}


@router.post("/messages/blocks/remove")
async def unblock(payload: BlockIn, actor: dict = Depends(_actor)):
    other = await _resolve_other_key(actor, payload)
    r = await db.dm_blocks.delete_one({"blocker_key": actor["key"], "blocked_key": other})
    if payload.thread_id:
        await db.dm_threads.update_one(
            {"id": payload.thread_id},
            {"$unset": {
                f"{'maker' if actor['role'] == 'maker' else 'buyer'}_hidden": "",
                "blocked_at": "",
            }},
        )
    return {"ok": True, "unblocked": other, "existed": bool(r.deleted_count)}


@router.get("/messages/blocks")
async def list_blocks(actor: dict = Depends(_actor)):
    rows = await db.dm_blocks.find(
        {"blocker_key": actor["key"]}, {"_id": 0},
    ).sort("created_at", -1).limit(500).to_list(500)
    return {"blocks": rows, "count": len(rows)}


# Helper used by routers/messages.py — importable without a circular ref
# because this router has no top-level imports back into messages.
async def is_blocked(sender_key: str, recipient_key: str) -> bool:
    """Return True if EITHER party has blocked the other. Called on every
    DM send + list op to enforce the block bidirectionally."""
    if not sender_key or not recipient_key:
        return False
    doc = await db.dm_blocks.find_one({
        "$or": [
            {"blocker_key": sender_key, "blocked_key": recipient_key},
            {"blocker_key": recipient_key, "blocked_key": sender_key},
        ]
    }, {"_id": 0, "id": 1})
    return bool(doc)
