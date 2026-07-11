"""Community live-chat router — WebSocket + REST history + presence + typing.

Extracted from `community.py` in iter43 to give the chat its own home — it's
the most independent and growing-fastest sub-domain of community. The
WebSocket handler also enforces:
  - global "Live Chat" admin switch (db.site_settings.live_chat_enabled)
  - per-user account-wide moderation_status (banned/frozen → 4403 close)
  - per-channel mutes (db.chat_mutes)
  - AI moderator (admin switch + EMERGENT_LLM_KEY) — fails-open on errors
"""
from __future__ import annotations

import asyncio
import time
import uuid

from fastapi import (
    APIRouter, HTTPException, Query, Request, WebSocket, WebSocketDisconnect,
)

from core import db, logger, now_iso
from maker_auth import decode_session_jwt

router = APIRouter()

CHANNELS = {
    "general", "machine-help", "finishing-tips",
    "beginners", "advanced-cnc", "off-topic",
    "makers-only",
    # iter442 — the floating LiveChatWidget's channels. `help` was never in
    # this set, so every /api/ws/chat/help handshake was rejected pre-accept
    # (browser saw a 403 upgrade failure and retried forever).
    "help", "showcase",
}

# ── iter442: short-lived single-use WebSocket tickets ────────────────────────
# The JWT must never ride in the WebSocket query string (it lands in proxy /
# access logs and the browser console). Clients POST here with their normal
# Authorization header, get an opaque 60-second single-use ticket, and connect
# with ?ticket=… instead.
WS_TICKET_TTL_SECONDS = 60


@router.post("/community/chat/ws-ticket")
async def chat_ws_ticket(request: Request):
    auth = request.headers.get("authorization") or ""
    token = auth[7:].strip() if auth.lower().startswith("bearer ") else ""
    if not token:
        raise HTTPException(401, "Sign in to join chat.")
    claims = decode_session_jwt(token)  # raises 401 on bad/expired token
    ticket = uuid.uuid4().hex + uuid.uuid4().hex
    await db.chat_ws_tickets.insert_one({
        "ticket": ticket,
        "claims": {"sub": claims.get("sub"), "email": claims.get("email"),
                   "role": claims.get("role")},
        "created_at": now_iso(),
        "expires_at_unix": time.time() + WS_TICKET_TTL_SECONDS,
        "used": False,
    })
    # Opportunistic cleanup — tickets are tiny, keep the collection lean.
    await db.chat_ws_tickets.delete_many({"expires_at_unix": {"$lt": time.time() - 3600}})
    return {"ticket": ticket, "expires_in": WS_TICKET_TTL_SECONDS}


async def _redeem_ws_ticket(ticket: str) -> dict | None:
    """Atomically consume a ticket — a replayed/expired ticket returns None."""
    doc = await db.chat_ws_tickets.find_one_and_update(
        {"ticket": ticket, "used": False, "expires_at_unix": {"$gt": time.time()}},
        {"$set": {"used": True, "used_at": now_iso()}},
    )
    return (doc or {}).get("claims")


class ChatRoom:
    """In-memory broadcast room per channel — tracks {ws -> user_dict} for presence."""

    def __init__(self, name: str):
        self.name = name
        self.members: dict[WebSocket, dict] = {}
        self.lock = asyncio.Lock()

    async def connect(self, ws: WebSocket, user: dict):
        async with self.lock:
            self.members[ws] = user

    async def disconnect(self, ws: WebSocket):
        async with self.lock:
            self.members.pop(ws, None)

    async def broadcast(self, payload: dict, exclude: WebSocket | None = None):
        async with self.lock:
            stale = []
            for ws in list(self.members.keys()):
                if ws is exclude:
                    continue
                try:
                    await ws.send_json(payload)
                except Exception:
                    stale.append(ws)
            for ws in stale:
                self.members.pop(ws, None)

    def buddy_list(self) -> list[dict]:
        """Stable, deduped by user_email."""
        out: dict[str, dict] = {}
        for u in self.members.values():
            out[u["user_email"]] = u
        return sorted(out.values(), key=lambda x: x["user_name"].lower())


_rooms: dict[str, ChatRoom] = {name: ChatRoom(name) for name in CHANNELS}


@router.get("/community/chat/{channel}/history")
async def chat_history(channel: str, limit: int = 50):
    if channel not in CHANNELS:
        raise HTTPException(404, "Unknown channel")
    msgs = await db.chat_messages.find(
        {"channel": channel}, {"_id": 0},
    ).sort("created_at", -1).to_list(limit)
    msgs.reverse()
    return msgs


@router.get("/community/chat/{channel}/buddies")
async def chat_buddies(channel: str):
    """Public: returns the live buddy list for a channel (online now)."""
    if channel not in CHANNELS:
        raise HTTPException(404, "Unknown channel")
    return {"channel": channel, "buddies": _rooms[channel].buddy_list()}


@router.websocket("/ws/chat/{channel}")
async def ws_chat(websocket: WebSocket, channel: str,
                  ticket: str = Query(""), token: str = Query("")):
    if channel not in CHANNELS:
        await websocket.close(code=4404)
        return
    # Honour the global "Live Chat" admin switch.
    from routers.settings import get_setting
    if not await get_setting("live_chat_enabled", True):
        await websocket.close(code=4503)  # service unavailable
        return
    # iter442 — preferred auth: short-lived single-use ticket (no JWT in the
    # URL). Legacy ?token= is still honoured for cached bundles mid-rollout.
    claims = None
    if ticket:
        claims = await _redeem_ws_ticket(ticket)
        if not claims:
            await websocket.close(code=4401)
            return
    elif token:
        try:
            claims = decode_session_jwt(token)
        except HTTPException:
            await websocket.close(code=4401)
            return
    if channel == "makers-only":
        if not claims or claims.get("role") != "maker":
            await websocket.close(code=4403)
            return
    if not claims:
        await websocket.close(code=4401)
        return

    role = claims.get("role")
    user_email = claims.get("email", "anon")
    display_name = user_email.split("@")[0]
    picture = ""
    if role == "buyer":
        u = await db.community_users.find_one({"user_id": claims["sub"]}, {"_id": 0})
        if u:
            # Banned/frozen users can't connect to chat at all.
            mod_status = u.get("moderation_status")
            if mod_status in ("banned", "frozen"):
                await websocket.close(code=4403)
                return
            display_name = u.get("name") or display_name
            picture = u.get("picture", "")
    elif role == "maker":
        m = await db.makers.find_one({"slug": claims["sub"]}, {"_id": 0})
        if m:
            display_name = m.get("name") or display_name
            picture = m.get("portrait", "")

    user = {
        "user_email": user_email,
        "user_name": display_name,
        "role": role,
        "picture": picture,
    }

    await websocket.accept()
    room = _rooms[channel]
    await room.connect(websocket, user)

    # Send the new connection a snapshot of who's already online
    try:
        await websocket.send_json({"kind": "presence", "buddies": room.buddy_list()})
    except Exception:
        pass

    # Tell everyone else this person joined
    await room.broadcast({
        "kind": "system",
        "text": f"{display_name} signed on",
        "buddies": room.buddy_list(),
        "created_at": now_iso(),
    }, exclude=websocket)

    try:
        while True:
            data = await websocket.receive_json()
            kind = data.get("kind", "message")
            if kind == "typing":
                # Lightweight, NOT persisted. Broadcasts to others only.
                await room.broadcast({
                    "kind": "typing",
                    "user_email": user_email,
                    "user_name": display_name,
                    "is_typing": bool(data.get("is_typing", True)),
                    "created_at": now_iso(),
                }, exclude=websocket)
                continue
            text = (data.get("text") or "").strip()
            if not text:
                continue
            text = text[:1000]
            # Per-channel mute gate — admins can mute a user from one
            # channel without touching their account-wide chat permissions.
            mute_doc = await db.chat_mutes.find_one(
                {"user_email": user_email, "channel": channel},
                {"_id": 0, "expires_at": 1, "reason": 1},
            )
            if mute_doc:
                exp = mute_doc.get("expires_at")
                if not exp:
                    muted = True
                else:
                    try:
                        from datetime import datetime as _dt
                        exp_dt = _dt.fromisoformat(exp.replace("Z", "+00:00"))
                        muted = exp_dt > _dt.now(exp_dt.tzinfo)
                    except Exception:
                        muted = False
                if muted:
                    await websocket.send_json({
                        "kind": "system",
                        "text": f"◆ You're muted in #{channel}{' — ' + mute_doc['reason'] if mute_doc.get('reason') else ''}.",
                        "private": True,
                        "created_at": now_iso(),
                    })
                    continue
            # AI moderation pre-broadcast — runs only when the admin switch is ON
            # and the LLM key is configured. Fails-open on any error.
            try:
                from ai_moderator import moderate_message
                action, reason = await moderate_message(
                    channel=f"chat:{channel}", user_email=user_email,
                    user_name=display_name, text=text,
                )
            except Exception as e:
                logger.exception("[ai_mod] moderator crashed, allowing: %s", e)
                action, reason = "allow", "exception_fail_open"
            if action == "block":
                # Private system notice to just the offender — drop the message
                # from the channel entirely. Block is rare so noise is acceptable.
                await websocket.send_json({
                    "kind": "system",
                    "text": f"◆ Your message was held by the auto-moderator: {reason}",
                    "private": True,
                    "created_at": now_iso(),
                })
                continue
            if action == "warn":
                await websocket.send_json({
                    "kind": "system",
                    "text": f"◆ Heads-up — that message was flagged: {reason}. Please keep it constructive.",
                    "private": True,
                    "created_at": now_iso(),
                })
                # Still deliver — warnings nudge, don't silence.
            msg = {
                "id": str(uuid.uuid4()),
                "channel": channel,
                "user_email": user_email,
                "user_name": display_name,
                "picture": picture,
                "role": role,
                "text": text,
                "kind": "message",
                "created_at": now_iso(),
            }
            await db.chat_messages.insert_one(msg.copy())
            await room.broadcast({k: v for k, v in msg.items() if k != "_id"})
    except WebSocketDisconnect:
        pass
    finally:
        await room.disconnect(websocket)
        await room.broadcast({
            "kind": "system",
            "text": f"{display_name} signed off",
            "buddies": room.buddy_list(),
            "created_at": now_iso(),
        })
