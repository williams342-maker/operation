"""Community: buyer auth (Google + magic link), showcase, design files, forum, live chat."""
import asyncio
import base64
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
from fastapi import (
    APIRouter, BackgroundTasks, Depends, HTTPException, Query,
    UploadFile, File, Form, WebSocket, WebSocketDisconnect,
)
from fastapi.responses import Response
from pydantic import BaseModel, EmailStr

from core import db, logger, now_iso
from email_service import _send, _shell  # reuse Resend helper directly for buyer link
from maker_auth import (
    current_buyer, current_maker_slug, decode_session_jwt,
    issue_buyer_magic_token, issue_session_jwt, verify_buyer_magic_token,
)

router = APIRouter()

EMERGENT_AUTH_URL = os.environ.get(
    "EMERGENT_AUTH_URL",
    "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
)

DOWNLOAD_FREE_LIMIT = 5
DOWNLOAD_WINDOW_DAYS = 180  # 6 months
PAID_UNLOCK_AMOUNT = 5.00


# ===================== AUTH =====================
class GoogleSessionRequest(BaseModel):
    session_id: str


class MagicRequest(BaseModel):
    email: EmailStr
    origin_url: str


class MagicVerifyRequest(BaseModel):
    token: str


async def _upsert_buyer(email: str, name: str = "", picture: str = "") -> dict:
    """Idempotent buyer upsert by email."""
    email = email.lower().strip()
    existing = await db.community_users.find_one({"email": email}, {"_id": 0})
    if existing:
        updates = {"last_seen": now_iso()}
        if name and not existing.get("name"):
            updates["name"] = name
        if picture and not existing.get("picture"):
            updates["picture"] = picture
        await db.community_users.update_one({"email": email}, {"$set": updates})
        return {**existing, **updates}
    user = {
        "user_id": f"user_{uuid.uuid4().hex[:12]}",
        "email": email,
        "name": name or email.split("@")[0],
        "picture": picture or "",
        "created_at": now_iso(),
        "last_seen": now_iso(),
    }
    await db.community_users.insert_one(user)
    user.pop("_id", None)
    return user


@router.post("/community/auth/google")
async def community_auth_google(payload: GoogleSessionRequest):
    """Exchange an Emergent Google session_id for a buyer JWT."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(
                EMERGENT_AUTH_URL,
                headers={"X-Session-ID": payload.session_id},
            )
        if r.status_code != 200:
            logger.warning("emergent auth failed: %s %s", r.status_code, r.text[:200])
            raise HTTPException(401, "Google sign-in failed.")
        data = r.json()
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("emergent auth error: %s", e)
        raise HTTPException(502, "Google sign-in is temporarily unavailable.")

    user = await _upsert_buyer(
        email=data.get("email", ""),
        name=data.get("name", ""),
        picture=data.get("picture", ""),
    )
    jwt_token = issue_session_jwt(user["user_id"], user["email"], role="buyer")
    return {"token": jwt_token, "user": user}


@router.post("/community/auth/magic/request")
async def community_auth_magic_request(payload: MagicRequest, bg: BackgroundTasks):
    email = payload.email.lower().strip()
    # Frictionless signup: any email gets a link (community is open).
    token = issue_buyer_magic_token(email)
    link = f"{payload.origin_url.rstrip('/')}/community/verify?token={token}"
    body = (
        "<p style='font-size:14px;color:#e5e5e5;line-height:1.6;margin:0 0 24px'>"
        "Click below to sign in to the Crafters Market community. Good for 15 minutes.</p>"
        f"<a href='{link}' style='display:inline-block;background:#ff4500;color:#0a0a0a;"
        "padding:16px 28px;font-family:Impact,Arial Black,sans-serif;font-size:14px;"
        f"letter-spacing:0.18em;text-transform:uppercase;text-decoration:none'>Open Community →</a>"
        f"<p style='font-size:12px;color:#a3a3a3;word-break:break-all;margin-top:24px'>"
        f"<a href='{link}' style='color:#ff4500'>{link}</a></p>"
    )
    html = _shell("Sign In Link.", "Your community access is one click away.", body, "Community sign-in")
    bg.add_task(_send, email, "Your Crafters Market community sign-in link", html)
    return {"sent": True, "message": "Check your inbox for the sign-in link."}


@router.post("/community/auth/magic/verify")
async def community_auth_magic_verify(payload: MagicVerifyRequest):
    email = verify_buyer_magic_token(payload.token)
    user = await _upsert_buyer(email=email)
    jwt_token = issue_session_jwt(user["user_id"], user["email"], role="buyer")
    return {"token": jwt_token, "user": user}


@router.get("/community/me")
async def community_me(claims: dict = Depends(current_buyer)):
    user = await db.community_users.find_one({"user_id": claims["sub"]}, {"_id": 0})
    if not user:
        raise HTTPException(404, "User not found")
    return user


# ===================== SHOWCASE =====================
class ShowcasePost(BaseModel):
    title: str
    description: str
    image_url: str               # buyer pastes a URL or uses uploaded asset
    product_slug: Optional[str] = None
    maker_slug: Optional[str] = None


@router.get("/community/showcase")
async def list_showcase(limit: int = 50):
    return await db.showcase_posts.find({}, {"_id": 0}).sort("created_at", -1).to_list(limit)


@router.post("/community/showcase")
async def create_showcase(post: ShowcasePost, claims: dict = Depends(current_buyer)):
    user = await db.community_users.find_one({"user_id": claims["sub"]}, {"_id": 0})
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": claims["sub"],
        "user_email": user["email"],
        "user_name": user.get("name", ""),
        "user_picture": user.get("picture", ""),
        **post.model_dump(),
        "likes": 0,
        "created_at": now_iso(),
    }
    await db.showcase_posts.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.post("/community/showcase/{post_id}/like")
async def like_showcase(post_id: str, claims: dict = Depends(current_buyer)):
    r = await db.showcase_posts.update_one({"id": post_id}, {"$inc": {"likes": 1}})
    if r.matched_count == 0:
        raise HTTPException(404, "Post not found")
    return {"ok": True}


# ===================== DESIGN FILES (with paywall) =====================
class DesignFileMeta(BaseModel):
    title: str
    description: str
    file_type: str               # DXF | SVG | STL | GLB | OTHER
    download_url: str            # external URL or stored URL
    thumbnail_url: Optional[str] = None


@router.get("/community/files")
async def list_design_files(limit: int = 50):
    return await db.design_files.find({}, {"_id": 0}).sort("created_at", -1).to_list(limit)


@router.post("/community/files")
async def upload_design_file(payload: DesignFileMeta, slug: str = Depends(current_maker_slug)):
    """Maker-only: post a downloadable design file."""
    maker = await db.makers.find_one({"slug": slug}, {"_id": 0})
    doc = {
        "id": str(uuid.uuid4()),
        "maker_slug": slug,
        "maker_name": maker["name"] if maker else slug,
        **payload.model_dump(),
        "downloads": 0,
        "created_at": now_iso(),
    }
    await db.design_files.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.get("/community/files/{file_id}/download")
async def download_design_file(file_id: str, claims: dict = Depends(current_buyer)):
    """Tracks downloads. Returns the file URL if user has free downloads left or has paid."""
    doc = await db.design_files.find_one({"id": file_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "File not found")

    user_id = claims["sub"]
    cutoff = (datetime.now(timezone.utc) - timedelta(days=DOWNLOAD_WINDOW_DAYS)).isoformat()
    recent_count = await db.download_logs.count_documents({
        "user_id": user_id,
        "created_at": {"$gte": cutoff},
    })
    paid = await db.download_unlocks.find_one({
        "user_id": user_id,
        "expires_at": {"$gte": now_iso()},
    }, {"_id": 0})

    if recent_count >= DOWNLOAD_FREE_LIMIT and not paid:
        return {
            "locked": True,
            "downloads_used": recent_count,
            "free_limit": DOWNLOAD_FREE_LIMIT,
            "unlock_amount": PAID_UNLOCK_AMOUNT,
            "message": "Free download limit reached for this 6-month window. Unlock unlimited downloads for $5.",
        }

    await db.download_logs.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "file_id": file_id,
        "created_at": now_iso(),
    })
    await db.design_files.update_one({"id": file_id}, {"$inc": {"downloads": 1}})
    return {
        "locked": False,
        "url": doc["download_url"],
        "downloads_used": recent_count + 1,
        "free_limit": DOWNLOAD_FREE_LIMIT,
        "paid_unlock_active": bool(paid),
    }


@router.post("/community/files/unlock-checkout")
async def unlock_checkout(claims: dict = Depends(current_buyer)):
    """Mint a Stripe Checkout session for the $5 unlimited-downloads unlock (6 months)."""
    import stripe as stripe_sdk
    from core import STRIPE_API_KEY
    stripe_sdk.api_key = STRIPE_API_KEY
    user_id = claims["sub"]
    user = await db.community_users.find_one({"user_id": user_id}, {"_id": 0})
    session = stripe_sdk.checkout.Session.create(
        mode="payment",
        payment_method_types=["card"],
        line_items=[{
            "price_data": {
                "currency": "usd",
                "product_data": {
                    "name": "Crafters Market — 6 months unlimited design downloads",
                    "description": "Unlock unlimited design-file downloads for 180 days.",
                },
                "unit_amount": int(round(PAID_UNLOCK_AMOUNT * 100)),
            },
            "quantity": 1,
        }],
        success_url=f"{os.environ.get('PUBLIC_SITE_URL', '').rstrip('/')}/community?unlocked=1",
        cancel_url=f"{os.environ.get('PUBLIC_SITE_URL', '').rstrip('/')}/community",
        metadata={"kind": "downloads_unlock", "user_id": user_id, "user_email": user["email"]},
    )
    # Pre-record an unlock that activates on webhook completion (or trust success_url for now)
    expires_at = (datetime.now(timezone.utc) + timedelta(days=DOWNLOAD_WINDOW_DAYS)).isoformat()
    await db.download_unlocks.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "session_id": session.id,
        "expires_at": expires_at,
        "status": "pending",
        "created_at": now_iso(),
    })
    return {"url": session.url, "session_id": session.id}


# ===================== FORUM =====================
class ForumThreadCreate(BaseModel):
    title: str
    body: str
    tag: Optional[str] = None    # general / makers / help / showcase


class ForumReplyCreate(BaseModel):
    body: str


@router.get("/community/forum")
async def list_threads(tag: Optional[str] = None, limit: int = 50):
    q = {"tag": tag} if tag else {}
    return await db.forum_threads.find(q, {"_id": 0}).sort("created_at", -1).to_list(limit)


@router.get("/community/forum/{thread_id}")
async def get_thread(thread_id: str):
    thread = await db.forum_threads.find_one({"id": thread_id}, {"_id": 0})
    if not thread:
        raise HTTPException(404, "Thread not found")
    replies = await db.forum_replies.find(
        {"thread_id": thread_id}, {"_id": 0}
    ).sort("created_at", 1).to_list(500)
    return {"thread": thread, "replies": replies}


@router.post("/community/forum")
async def create_thread(payload: ForumThreadCreate, claims: dict = Depends(current_buyer)):
    user = await db.community_users.find_one({"user_id": claims["sub"]}, {"_id": 0})
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": claims["sub"],
        "user_email": user["email"],
        "user_name": user.get("name", ""),
        **payload.model_dump(),
        "reply_count": 0,
        "created_at": now_iso(),
    }
    await db.forum_threads.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.post("/community/forum/{thread_id}/reply")
async def reply_thread(thread_id: str, payload: ForumReplyCreate, claims: dict = Depends(current_buyer)):
    thread = await db.forum_threads.find_one({"id": thread_id}, {"_id": 0})
    if not thread:
        raise HTTPException(404, "Thread not found")
    user = await db.community_users.find_one({"user_id": claims["sub"]}, {"_id": 0})
    doc = {
        "id": str(uuid.uuid4()),
        "thread_id": thread_id,
        "user_id": claims["sub"],
        "user_email": user["email"],
        "user_name": user.get("name", ""),
        "body": payload.body,
        "created_at": now_iso(),
    }
    await db.forum_replies.insert_one(doc)
    await db.forum_threads.update_one({"id": thread_id}, {"$inc": {"reply_count": 1}})
    doc.pop("_id", None)
    return doc


# ===================== LIVE CHAT (WebSocket + REST history) =====================
CHANNELS = {"general", "help", "showcase", "makers-only"}


class ChatRoom:
    """In-memory broadcast room per channel."""
    def __init__(self, name: str):
        self.name = name
        self.connections: set[WebSocket] = set()
        self.lock = asyncio.Lock()

    async def connect(self, ws: WebSocket):
        async with self.lock:
            self.connections.add(ws)

    async def disconnect(self, ws: WebSocket):
        async with self.lock:
            self.connections.discard(ws)

    async def broadcast(self, payload: dict):
        async with self.lock:
            stale = []
            for ws in list(self.connections):
                try:
                    await ws.send_json(payload)
                except Exception:
                    stale.append(ws)
            for ws in stale:
                self.connections.discard(ws)


_rooms: dict[str, ChatRoom] = {name: ChatRoom(name) for name in CHANNELS}


@router.get("/community/chat/{channel}/history")
async def chat_history(channel: str, limit: int = 50):
    if channel not in CHANNELS:
        raise HTTPException(404, "Unknown channel")
    msgs = await db.chat_messages.find(
        {"channel": channel}, {"_id": 0}
    ).sort("created_at", -1).to_list(limit)
    msgs.reverse()  # chronological
    return msgs


@router.websocket("/ws/chat/{channel}")
async def ws_chat(websocket: WebSocket, channel: str, token: str = Query("")):
    if channel not in CHANNELS:
        await websocket.close(code=4404)
        return
    # Auth: any role for general/help/showcase. makers-only requires role==maker.
    try:
        claims = decode_session_jwt(token) if token else None
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
    display_name = claims.get("email", "anon").split("@")[0]
    if role == "buyer":
        u = await db.community_users.find_one({"user_id": claims["sub"]}, {"_id": 0})
        if u:
            display_name = u.get("name") or display_name

    await websocket.accept()
    room = _rooms[channel]
    await room.connect(websocket)
    await room.broadcast({
        "kind": "system",
        "text": f"{display_name} joined #{channel}",
        "created_at": now_iso(),
    })
    try:
        while True:
            data = await websocket.receive_json()
            text = (data.get("text") or "").strip()
            if not text:
                continue
            msg = {
                "id": str(uuid.uuid4()),
                "channel": channel,
                "user_email": claims.get("email", ""),
                "user_name": display_name,
                "role": role,
                "text": text[:1000],
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
            "text": f"{display_name} left #{channel}",
            "created_at": now_iso(),
        })


# ===================== AVATAR UPLOAD (small images, base64-stored) =====================
@router.post("/community/me/avatar")
async def upload_avatar(file: UploadFile = File(...), claims: dict = Depends(current_buyer)):
    if file.content_type not in ("image/jpeg", "image/png", "image/webp"):
        raise HTTPException(400, "JPG, PNG, or WebP only")
    raw = await file.read()
    if len(raw) > 1_500_000:
        raise HTTPException(400, "Max 1.5MB")
    data_url = f"data:{file.content_type};base64,{base64.b64encode(raw).decode()}"
    await db.community_users.update_one({"user_id": claims["sub"]}, {"$set": {"picture": data_url}})
    return {"picture": data_url}
