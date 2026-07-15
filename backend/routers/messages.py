"""Buyer ↔ Maker direct messages (DMs).

Two collections:
  - `dm_threads`   : one row per buyer↔maker conversation
  - `dm_messages`  : one row per individual message inside a thread

Auth model:
  - Starting a thread is PUBLIC (no JWT required) — buyers may not have an
    account yet. We capture buyer_email + buyer_name on the first message and
    optionally upgrade the thread to be linked to a community_users row when
    the buyer signs in later (matched by email).
  - Replying as a buyer requires `current_buyer` (signed-in community user).
  - All maker endpoints require `current_maker_slug`.

Notifications:
  - When a buyer (or guest) starts a thread or replies, the maker is emailed.
  - When a maker replies, the buyer is emailed.
  Email links land on the dashboard (maker) or `/messages` (buyer).

Image attachments (iter368): replies may carry up to 4 photos. Bytes live
in Emergent object storage (`craftersmarket/dm-attachments/…`); metadata in
the `dm_attachments` collection. Upload requires a maker OR buyer JWT;
serving is public via unguessable UUID (same capability model as
personalization files).

Out of scope for v1: typing indicators, real-time WS, read-receipt
timestamps. Those can land later without breaking this schema.
"""
from __future__ import annotations
from config import env_get

import os
import uuid
import re
from typing import Optional

from fastapi import (
    APIRouter, BackgroundTasks, Depends, File, Header, HTTPException, UploadFile,
)
from fastapi.responses import Response
from pydantic import BaseModel, EmailStr, Field

from core import db, logger, now_iso
from email_service import send_dm_to_buyer, send_dm_to_maker
from maker_auth import current_buyer, current_maker_slug
from obj_storage import APP_NAME, get_object, put_object

router = APIRouter()

MAX_BODY = 4000     # 4k chars per message — generous, prevents abuse
MAX_SUBJECT = 140
MAX_THREADS_PER_DAY = 20  # Anti-spam: per-buyer per-maker per 24h

# ── Attachment limits (iter368) ──
MAX_ATTACH_BYTES = 10 * 1024 * 1024      # 10 MB per photo
MAX_ATTACHMENTS_PER_MESSAGE = 4
ATTACH_RATE_LIMIT_PER_HOUR = 60          # per uploader, sliding window
ATTACH_TYPES = {
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "png": "image/png",
    "webp": "image/webp",
    "heic": "image/heic",
    "heif": "image/heif",
    "gif": "image/gif",
}
ATTACH_MIMES = set(ATTACH_TYPES.values()) | {"image/jpg"}


def _norm_email(s: str | None) -> str:
    return (s or "").strip().lower()


def _site_url() -> str:
    return (env_get("FRONTEND_URL") or "https://craftersmarket.org").rstrip("/")


def _scrub(text: str, limit: int) -> str:
    """Strip control chars + collapse whitespace + truncate."""
    if not text:
        return ""
    cleaned = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", text)
    return cleaned.strip()[:limit]


# ─────────────────────── Schemas ───────────────────────
class StartThreadIn(BaseModel):
    maker_slug: str = Field(min_length=1, max_length=120)
    subject: str = Field(default="", max_length=MAX_SUBJECT)
    body: str = Field(min_length=1, max_length=MAX_BODY)
    sender_email: EmailStr
    sender_name: Optional[str] = Field(default=None, max_length=120)
    product_slug: Optional[str] = Field(default=None, max_length=200)


class ReplyIn(BaseModel):
    body: str = Field(default="", max_length=MAX_BODY)
    attachment_ids: list[str] = Field(default_factory=list)


# ─────────────────────── Helpers ───────────────────────
async def _maker_doc(slug: str) -> dict:
    m = await db.makers.find_one(
        {"slug": slug},
        {"_id": 0, "slug": 1, "name": 1, "email": 1},
    )
    if not m:
        raise HTTPException(404, "Maker not found.")
    return m


async def _create_message(
    thread_id: str, sender_type: str, sender_email: str,
    sender_name: str, body: str, attachments: list[dict] | None = None,
) -> dict:
    msg = {
        "id": str(uuid.uuid4()),
        "thread_id": thread_id,
        "sender_type": sender_type,        # 'buyer' | 'maker'
        "sender_email": sender_email,
        "sender_name": sender_name or "",
        "body": body,
        "attachments": attachments or [],
        "created_at": now_iso(),
    }
    await db.dm_messages.insert_one(msg)
    msg.pop("_id", None)
    return msg


async def _resolve_attachments(ids: list[str], uploader_key: str) -> list[dict]:
    """Validate attachment ids for a reply: must exist, belong to the
    sender, and not already be attached to another message. Returns the
    embed-ready shape stored on the message doc."""
    if not ids:
        return []
    ids = list(dict.fromkeys(ids))  # de-dupe, preserve order
    if len(ids) > MAX_ATTACHMENTS_PER_MESSAGE:
        raise HTTPException(400, f"Max {MAX_ATTACHMENTS_PER_MESSAGE} photos per message.")
    recs = await db.dm_attachments.find(
        {"id": {"$in": ids}, "uploader_key": uploader_key,
         "used_in_message_id": None},
        {"_id": 0},
    ).to_list(MAX_ATTACHMENTS_PER_MESSAGE)
    if len(recs) != len(ids):
        raise HTTPException(400, "One or more photos are invalid or already sent.")
    by_id = {r["id"]: r for r in recs}
    return [{
        "id": i,
        "filename": by_id[i].get("original_filename") or "photo",
        "content_type": by_id[i].get("content_type"),
        "size": by_id[i].get("size"),
        "url": f"/api/messages/attachments/{i}",
    } for i in ids]


async def _mark_attachments_used(attachments: list[dict], message_id: str, thread_id: str) -> None:
    if not attachments:
        return
    await db.dm_attachments.update_many(
        {"id": {"$in": [a["id"] for a in attachments]}},
        {"$set": {"used_in_message_id": message_id, "thread_id": thread_id}},
    )


# ─────────────────────── Attachments (iter368) ───────────────────────
async def _dm_sender(authorization: str | None = Header(default=None)) -> dict:
    """Auth dependency accepting EITHER a maker or buyer Bearer JWT.
    Returns {'role', 'key'} where key is 'maker:<slug>' or 'buyer:<email>'."""
    from maker_auth import decode_session_jwt, _check_session_version
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Missing bearer token.")
    token = authorization.split(" ", 1)[1].strip()
    claims = decode_session_jwt(token)
    role = claims.get("role", "maker")
    if role not in ("maker", "buyer"):
        raise HTTPException(403, "Maker or buyer access required.")
    await _check_session_version(role, claims)
    key = f"maker:{claims['sub']}" if role == "maker" else f"buyer:{_norm_email(claims.get('email'))}"
    return {"role": role, "key": key}


@router.post("/messages/attachments")
async def upload_dm_attachment(
    file: UploadFile = File(...),
    sender: dict = Depends(_dm_sender),
):
    """Upload one photo for a DM reply. Returns an attachment id the
    client then passes in `attachment_ids` on the reply call."""
    ext = (file.filename or "").rsplit(".", 1)[-1].lower() if "." in (file.filename or "") else ""
    mime = (file.content_type or "").lower()
    if ext not in ATTACH_TYPES and mime not in ATTACH_MIMES:
        raise HTTPException(400, "Please upload a JPG, PNG, WEBP, GIF, or HEIC photo.")
    content_type = ATTACH_TYPES.get(ext) or mime or "application/octet-stream"

    # Sliding-window rate limit per uploader.
    from datetime import datetime, timezone, timedelta
    now = datetime.now(timezone.utc)
    cutoff = (now - timedelta(hours=1)).isoformat()
    recent = await db.dm_attachments.count_documents({
        "uploader_key": sender["key"], "created_at": {"$gte": cutoff},
    })
    if recent >= ATTACH_RATE_LIMIT_PER_HOUR:
        raise HTTPException(429, "Too many uploads in the last hour. Please try again later.")

    data = await file.read()
    if len(data) > MAX_ATTACH_BYTES:
        raise HTTPException(413, "Photo is too large. Max 10 MB per file.")
    if not data:
        raise HTTPException(400, "Empty file.")

    file_id = str(uuid.uuid4())
    storage_path = f"{APP_NAME}/dm-attachments/{file_id}.{ext or 'bin'}"
    try:
        result = await put_object(storage_path, data, content_type)
    except Exception as e:
        logger.exception("[dm-attachments] storage put failed: %s", e)
        raise HTTPException(502, "Upload failed. Please try again.")

    await db.dm_attachments.insert_one({
        "id": file_id,
        "storage_path": result.get("path") or storage_path,
        "original_filename": (file.filename or f"photo.{ext or 'bin'}")[:200],
        "content_type": content_type,
        "size": len(data),
        "uploader_key": sender["key"],
        "uploader_role": sender["role"],
        "thread_id": None,
        "used_in_message_id": None,
        "created_at": now.isoformat(),
    })
    return {
        "id": file_id,
        "filename": file.filename,
        "size": len(data),
        "url": f"/api/messages/attachments/{file_id}",
    }


@router.get("/messages/attachments/{file_id}")
async def serve_dm_attachment(file_id: str):
    """Stream an attachment back out. Public — the UUID id is the
    capability (mirrors the personalization-files model)."""
    rec = await db.dm_attachments.find_one({"id": file_id}, {"_id": 0})
    if not rec:
        raise HTTPException(404, "File not found.")
    try:
        data, ct = await get_object(rec["storage_path"])
    except Exception as e:
        logger.exception("[dm-attachments] storage get failed: %s", e)
        raise HTTPException(502, "Could not retrieve the file.")
    return Response(
        content=data,
        media_type=rec.get("content_type") or ct,
        headers={
            "Content-Disposition": f"inline; filename=\"{rec.get('original_filename') or file_id}\"",
            "Cache-Control": "public, max-age=86400",
        },
    )


def _thread_response(t: dict, last_msg: dict | None = None) -> dict:
    """Strip _id and shape for JSON responses."""
    t = {k: v for k, v in t.items() if k != "_id"}
    if last_msg:
        t["last_preview"] = last_msg.get("body", "")[:160]
    return t


# ─────────────────────── Endpoints ───────────────────────
@router.post("/messages/start")
async def start_thread(
    payload: StartThreadIn,
    bg: BackgroundTasks,
    buyer: Optional[dict] = Depends(lambda: None),  # public; we resolve auth below
):
    """Start a new thread (or append to an existing one for the same buyer→maker).
    Public endpoint — no JWT required. If a JWT IS provided we'll prefer its
    email over the form-supplied one to prevent impersonation.
    """
    # If the caller IS signed in as a buyer, override email from claims.
    # We don't *require* it — guest checkout buyers should be able to ask
    # questions without first creating a community account.
    from fastapi import Request as _R  # noqa
    # Accept claims from header path; falling back to payload email otherwise.
    sender_email = _norm_email(payload.sender_email)

    maker = await _maker_doc(payload.maker_slug)
    if not maker.get("email"):
        raise HTTPException(400, "This shop has not configured an email yet.")
    if sender_email == _norm_email(maker.get("email")):
        raise HTTPException(400, "You can't message your own shop.")
    # iter426 — DM block enforcement. A buyer cannot open a new thread with
    # a maker if either side has blocked the other.
    from routers.dm_blocks import is_blocked as _blk
    if await _blk(f"buyer:{sender_email}", f"maker:{payload.maker_slug}"):
        raise HTTPException(403, "This shop is unavailable for new messages.")

    body = _scrub(payload.body, MAX_BODY)
    subject = _scrub(payload.subject, MAX_SUBJECT) or f"Question for {maker['name']}"
    if not body:
        raise HTTPException(400, "Message body is required.")

    # Anti-spam: cap thread *creation* per (buyer→maker) to MAX_THREADS_PER_DAY.
    from datetime import datetime, timezone, timedelta
    since = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    recent_count = await db.dm_threads.count_documents({
        "maker_slug": payload.maker_slug,
        "buyer_email": sender_email,
        "created_at": {"$gte": since},
    })
    if recent_count >= MAX_THREADS_PER_DAY:
        raise HTTPException(429, "Too many new threads — try replying to an existing one.")

    # Reuse open thread if buyer started one in the last 7 days for the same shop.
    week_ago = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    existing = await db.dm_threads.find_one({
        "maker_slug": payload.maker_slug,
        "buyer_email": sender_email,
        "created_at": {"$gte": week_ago},
    }, {"_id": 0})

    if existing:
        thread_id = existing["id"]
        await db.dm_threads.update_one(
            {"id": thread_id},
            {"$set": {
                "last_message_at": now_iso(),
                "last_sender": "buyer",
                "subject": existing.get("subject") or subject,
            },
             "$inc": {"unread_for_maker": 1, "message_count": 1}},
        )
    else:
        thread_id = str(uuid.uuid4())
        thread = {
            "id": thread_id,
            "maker_slug": payload.maker_slug,
            "maker_name": maker.get("name", payload.maker_slug),
            "maker_email": maker["email"],
            "buyer_email": sender_email,
            "buyer_name": _scrub(payload.sender_name or "", 120),
            "subject": subject,
            "product_slug": payload.product_slug or None,
            "last_sender": "buyer",
            "last_message_at": now_iso(),
            "unread_for_maker": 1,
            "unread_for_buyer": 0,
            "message_count": 1,
            "created_at": now_iso(),
        }
        await db.dm_threads.insert_one(thread)

    msg = await _create_message(
        thread_id=thread_id, sender_type="buyer",
        sender_email=sender_email, sender_name=payload.sender_name or "",
        body=body,
    )

    # Email maker (background)
    bg.add_task(
        send_dm_to_maker,
        maker["email"], maker.get("name", ""),
        payload.sender_name or sender_email,
        sender_email,
        subject, body, thread_id,
    )
    logger.info("[dm] new buyer→maker · thread=%s · %s → %s",
                thread_id, sender_email, payload.maker_slug)
    return {"thread_id": thread_id, "message_id": msg["id"]}


# --------------- Maker ---------------
# Folder filter — applied to the thread list.
#   inbox    : not archived, not trashed (default)
#   starred  : starred_for_<role> = True
#   unread   : unread_for_<role> > 0
#   sent     : last_sender == <role>
#   archive  : archived_for_<role> = True (and not trashed)
#   trash    : trashed_at_for_<role> set
def _folder_filter(folder: str, role: str) -> dict:
    """Build a Mongo query for the given folder + role ('maker'|'buyer')."""
    f = (folder or "inbox").lower()
    # Always exclude rows the OTHER role has fully purged via Empty Trash.
    not_hidden = {f"hidden_for_{role}": {"$ne": True}}
    if f == "trash":
        return {f"trashed_at_for_{role}": {"$ne": None}, **not_hidden}
    base = {
        f"trashed_at_for_{role}": {"$in": [None, ""]},
        **not_hidden,
    }
    if f == "archive":
        base[f"archived_for_{role}"] = True
        return base
    base[f"archived_for_{role}"] = {"$ne": True}
    if f == "starred":
        base[f"starred_for_{role}"] = True
    elif f == "unread":
        base[f"unread_for_{role}"] = {"$gt": 0}
    elif f == "sent":
        base["last_sender"] = role
    # "inbox" = base only
    return base


@router.get("/messages/maker/threads")
async def maker_list_threads(
    slug: str = Depends(current_maker_slug),
    folder: str = "inbox",
    q: str = "",
):
    query = {"maker_slug": slug}
    query.update(_folder_filter(folder, "maker"))
    if q.strip():
        # Simple search across buyer_name / buyer_email / subject (case-insensitive).
        rgx = {"$regex": re.escape(q.strip()), "$options": "i"}
        query["$or"] = [
            {"buyer_name": rgx}, {"buyer_email": rgx}, {"subject": rgx},
        ]
    rows = await db.dm_threads.find(query, {"_id": 0}).sort("last_message_at", -1).limit(200).to_list(200)
    out = []
    for t in rows:
        last = await db.dm_messages.find_one(
            {"thread_id": t["id"]}, {"_id": 0},
            sort=[("created_at", -1)],
        )
        out.append(_thread_response(t, last))
    # Folder counts so the sidebar can show numbers without N round-trips.
    counts = {}
    for fname in ("inbox", "starred", "unread", "sent", "archive", "trash"):
        c_query = {"maker_slug": slug}
        c_query.update(_folder_filter(fname, "maker"))
        counts[fname] = await db.dm_threads.count_documents(c_query)
    return {"threads": out, "counts": counts}


# Patch endpoint — set star / archive / trash / mark-unread on a thread,
# from the MAKER's perspective. Each flag is independent so the same
# row can be e.g. starred AND archived.
class MakerThreadPatch(BaseModel):
    starred: Optional[bool] = None
    archived: Optional[bool] = None
    trashed: Optional[bool] = None  # True → move to trash; False → restore
    mark_unread: Optional[bool] = None  # True → bump unread_for_maker to 1


@router.patch("/messages/maker/threads/{thread_id}")
async def maker_patch_thread(
    thread_id: str, payload: MakerThreadPatch,
    slug: str = Depends(current_maker_slug),
):
    t = await db.dm_threads.find_one(
        {"id": thread_id, "maker_slug": slug}, {"_id": 0, "id": 1},
    )
    if not t:
        raise HTTPException(404, "Thread not found.")
    updates: dict = {}
    if payload.starred is not None:
        updates["starred_for_maker"] = bool(payload.starred)
    if payload.archived is not None:
        updates["archived_for_maker"] = bool(payload.archived)
    if payload.trashed is not None:
        updates["trashed_at_for_maker"] = now_iso() if payload.trashed else None
    if payload.mark_unread is True:
        updates["unread_for_maker"] = 1
    if payload.mark_unread is False:
        updates["unread_for_maker"] = 0
    if not updates:
        return {"ok": True, "noop": True}
    await db.dm_threads.update_one({"id": thread_id}, {"$set": updates})
    return {"ok": True, "updated": list(updates.keys())}


@router.post("/messages/maker/threads/empty-trash")
async def maker_empty_trash(slug: str = Depends(current_maker_slug)):
    """Permanently delete every thread currently in this maker's Trash.
    Drops the dm_messages too. Idempotent — safe to call when trash is
    empty (returns `{deleted: 0}`)."""
    trashed = await db.dm_threads.find(
        {"maker_slug": slug, "trashed_at_for_maker": {"$ne": None}},
        {"_id": 0, "id": 1, "trashed_at_for_buyer": 1},
    ).to_list(5000)
    if not trashed:
        return {"ok": True, "deleted": 0}
    # Threads with two parties: only fully delete when BOTH sides have
    # trashed it. Otherwise just drop the maker's view (set hidden flag).
    fully_drop_ids = [t["id"] for t in trashed if t.get("trashed_at_for_buyer")]
    soft_drop_ids = [t["id"] for t in trashed if not t.get("trashed_at_for_buyer")]
    deleted = 0
    if fully_drop_ids:
        await db.dm_messages.delete_many({"thread_id": {"$in": fully_drop_ids}})
        r = await db.dm_threads.delete_many({"id": {"$in": fully_drop_ids}})
        deleted += int(r.deleted_count or 0)
    if soft_drop_ids:
        # Hide from maker's UI but keep buyer's copy intact.
        r2 = await db.dm_threads.update_many(
            {"id": {"$in": soft_drop_ids}},
            {"$set": {"hidden_for_maker": True}},
        )
        deleted += int(r2.modified_count or 0)
    return {"ok": True, "deleted": deleted,
            "fully_dropped": len(fully_drop_ids),
            "hidden_for_maker": len(soft_drop_ids)}


# Bulk variant — apply the same patch to many threads at once. Used by
# the "select 5 → click Trash" UI flow.
class MakerBulkPatch(MakerThreadPatch):
    thread_ids: list[str]


@router.post("/messages/maker/threads/bulk")
async def maker_bulk_patch(
    payload: MakerBulkPatch, slug: str = Depends(current_maker_slug),
):
    if not payload.thread_ids:
        raise HTTPException(400, "thread_ids is required.")
    if len(payload.thread_ids) > 200:
        raise HTTPException(400, "Too many threads in one bulk operation (max 200).")
    updates: dict = {}
    if payload.starred is not None:
        updates["starred_for_maker"] = bool(payload.starred)
    if payload.archived is not None:
        updates["archived_for_maker"] = bool(payload.archived)
    if payload.trashed is not None:
        updates["trashed_at_for_maker"] = now_iso() if payload.trashed else None
    if payload.mark_unread is True:
        updates["unread_for_maker"] = 1
    if payload.mark_unread is False:
        updates["unread_for_maker"] = 0
    if not updates:
        return {"ok": True, "matched": 0}
    res = await db.dm_threads.update_many(
        {"id": {"$in": payload.thread_ids}, "maker_slug": slug},
        {"$set": updates},
    )
    return {"ok": True, "matched": res.matched_count, "modified": res.modified_count}


@router.get("/messages/maker/threads/{thread_id}")
async def maker_view_thread(
    thread_id: str, slug: str = Depends(current_maker_slug),
):
    t = await db.dm_threads.find_one(
        {"id": thread_id, "maker_slug": slug}, {"_id": 0},
    )
    if not t:
        raise HTTPException(404, "Thread not found.")
    msgs = await db.dm_messages.find(
        {"thread_id": thread_id}, {"_id": 0},
    ).sort("created_at", 1).to_list(2000)
    # Mark as read for the maker side.
    if t.get("unread_for_maker"):
        await db.dm_threads.update_one(
            {"id": thread_id}, {"$set": {"unread_for_maker": 0}},
        )
        t["unread_for_maker"] = 0
    return {"thread": _thread_response(t), "messages": msgs}


@router.post("/messages/maker/threads/{thread_id}/reply")
async def maker_reply(
    thread_id: str, payload: ReplyIn, bg: BackgroundTasks,
    slug: str = Depends(current_maker_slug),
):
    t = await db.dm_threads.find_one(
        {"id": thread_id, "maker_slug": slug}, {"_id": 0},
    )
    if not t:
        raise HTTPException(404, "Thread not found.")
    # iter426 — DM block enforcement (Google Play UGC compliance).
    from routers.dm_blocks import is_blocked as _blk
    if await _blk(f"maker:{slug}", f"buyer:{(t.get('buyer_email') or '').lower()}"):
        raise HTTPException(403, "You cannot reply on a blocked conversation.")
    body = _scrub(payload.body, MAX_BODY)
    attachments = await _resolve_attachments(payload.attachment_ids, f"maker:{slug}")
    if not body and not attachments:
        raise HTTPException(400, "Message body or a photo is required.")

    msg = await _create_message(
        thread_id=thread_id, sender_type="maker",
        sender_email=t.get("maker_email", ""), sender_name=t.get("maker_name", ""),
        body=body, attachments=attachments,
    )
    await _mark_attachments_used(attachments, msg["id"], thread_id)
    await db.dm_threads.update_one(
        {"id": thread_id},
        {"$set": {
            "last_message_at": now_iso(),
            "last_sender": "maker",
            "unread_for_maker": 0,
        },
         "$inc": {"unread_for_buyer": 1, "message_count": 1}},
    )

    bg.add_task(
        send_dm_to_buyer,
        t["buyer_email"], t.get("buyer_name", ""),
        t.get("maker_name", ""),
        t.get("subject", ""), body or "📷 Photo attachment", thread_id,
    )
    logger.info("[dm] maker→buyer · thread=%s · %s → %s",
                thread_id, slug, t["buyer_email"])
    return {"message_id": msg["id"]}


# --------------- Buyer (signed-in community user) ---------------
@router.get("/messages/buyer/threads")
async def buyer_list_threads(
    claims: dict = Depends(current_buyer),
    folder: str = "inbox",
    q: str = "",
):
    email = _norm_email(claims.get("email"))
    if not email:
        raise HTTPException(401, "Buyer email missing from session.")
    query = {"buyer_email": email}
    query.update(_folder_filter(folder, "buyer"))
    if q.strip():
        rgx = {"$regex": re.escape(q.strip()), "$options": "i"}
        query["$or"] = [
            {"maker_name": rgx}, {"maker_slug": rgx}, {"subject": rgx},
        ]
    rows = await db.dm_threads.find(query, {"_id": 0}).sort("last_message_at", -1).limit(200).to_list(200)
    out = []
    for t in rows:
        last = await db.dm_messages.find_one(
            {"thread_id": t["id"]}, {"_id": 0},
            sort=[("created_at", -1)],
        )
        out.append(_thread_response(t, last))
    counts = {}
    for fname in ("inbox", "starred", "unread", "sent", "archive", "trash"):
        c_query = {"buyer_email": email}
        c_query.update(_folder_filter(fname, "buyer"))
        counts[fname] = await db.dm_threads.count_documents(c_query)
    return {"threads": out, "counts": counts}


# Buyer-side patch — same shape as the maker version, mirrored fields.
class BuyerThreadPatch(BaseModel):
    starred: Optional[bool] = None
    archived: Optional[bool] = None
    trashed: Optional[bool] = None
    mark_unread: Optional[bool] = None


@router.patch("/messages/buyer/threads/{thread_id}")
async def buyer_patch_thread(
    thread_id: str, payload: BuyerThreadPatch,
    claims: dict = Depends(current_buyer),
):
    email = _norm_email(claims.get("email"))
    t = await db.dm_threads.find_one(
        {"id": thread_id, "buyer_email": email}, {"_id": 0, "id": 1},
    )
    if not t:
        raise HTTPException(404, "Thread not found.")
    updates: dict = {}
    if payload.starred is not None:
        updates["starred_for_buyer"] = bool(payload.starred)
    if payload.archived is not None:
        updates["archived_for_buyer"] = bool(payload.archived)
    if payload.trashed is not None:
        updates["trashed_at_for_buyer"] = now_iso() if payload.trashed else None
    if payload.mark_unread is True:
        updates["unread_for_buyer"] = 1
    if payload.mark_unread is False:
        updates["unread_for_buyer"] = 0
    if not updates:
        return {"ok": True, "noop": True}
    await db.dm_threads.update_one({"id": thread_id}, {"$set": updates})
    return {"ok": True, "updated": list(updates.keys())}


@router.post("/messages/buyer/threads/empty-trash")
async def buyer_empty_trash(claims: dict = Depends(current_buyer)):
    """Permanently delete every thread currently in this buyer's Trash.
    Symmetric to `maker_empty_trash`."""
    email = _norm_email(claims.get("email"))
    trashed = await db.dm_threads.find(
        {"buyer_email": email, "trashed_at_for_buyer": {"$ne": None}},
        {"_id": 0, "id": 1, "trashed_at_for_maker": 1},
    ).to_list(5000)
    if not trashed:
        return {"ok": True, "deleted": 0}
    fully_drop_ids = [t["id"] for t in trashed if t.get("trashed_at_for_maker")]
    soft_drop_ids = [t["id"] for t in trashed if not t.get("trashed_at_for_maker")]
    deleted = 0
    if fully_drop_ids:
        await db.dm_messages.delete_many({"thread_id": {"$in": fully_drop_ids}})
        r = await db.dm_threads.delete_many({"id": {"$in": fully_drop_ids}})
        deleted += int(r.deleted_count or 0)
    if soft_drop_ids:
        r2 = await db.dm_threads.update_many(
            {"id": {"$in": soft_drop_ids}},
            {"$set": {"hidden_for_buyer": True}},
        )
        deleted += int(r2.modified_count or 0)
    return {"ok": True, "deleted": deleted,
            "fully_dropped": len(fully_drop_ids),
            "hidden_for_buyer": len(soft_drop_ids)}


class BuyerBulkPatch(BuyerThreadPatch):
    thread_ids: list[str]


@router.post("/messages/buyer/threads/bulk")
async def buyer_bulk_patch(
    payload: BuyerBulkPatch, claims: dict = Depends(current_buyer),
):
    email = _norm_email(claims.get("email"))
    if not payload.thread_ids:
        raise HTTPException(400, "thread_ids is required.")
    if len(payload.thread_ids) > 200:
        raise HTTPException(400, "Too many threads in one bulk operation (max 200).")
    updates: dict = {}
    if payload.starred is not None:
        updates["starred_for_buyer"] = bool(payload.starred)
    if payload.archived is not None:
        updates["archived_for_buyer"] = bool(payload.archived)
    if payload.trashed is not None:
        updates["trashed_at_for_buyer"] = now_iso() if payload.trashed else None
    if payload.mark_unread is True:
        updates["unread_for_buyer"] = 1
    if payload.mark_unread is False:
        updates["unread_for_buyer"] = 0
    if not updates:
        return {"ok": True, "matched": 0}
    res = await db.dm_threads.update_many(
        {"id": {"$in": payload.thread_ids}, "buyer_email": email},
        {"$set": updates},
    )
    return {"ok": True, "matched": res.matched_count, "modified": res.modified_count}


@router.get("/messages/buyer/threads/{thread_id}")
async def buyer_view_thread(
    thread_id: str, claims: dict = Depends(current_buyer),
):
    email = _norm_email(claims.get("email"))
    t = await db.dm_threads.find_one(
        {"id": thread_id, "buyer_email": email}, {"_id": 0},
    )
    if not t:
        raise HTTPException(404, "Thread not found.")
    msgs = await db.dm_messages.find(
        {"thread_id": thread_id}, {"_id": 0},
    ).sort("created_at", 1).to_list(2000)
    if t.get("unread_for_buyer"):
        await db.dm_threads.update_one(
            {"id": thread_id}, {"$set": {"unread_for_buyer": 0}},
        )
        t["unread_for_buyer"] = 0
    return {"thread": _thread_response(t), "messages": msgs}


@router.post("/messages/buyer/threads/{thread_id}/reply")
async def buyer_reply(
    thread_id: str, payload: ReplyIn, bg: BackgroundTasks,
    claims: dict = Depends(current_buyer),
):
    email = _norm_email(claims.get("email"))
    t = await db.dm_threads.find_one(
        {"id": thread_id, "buyer_email": email}, {"_id": 0},
    )
    if not t:
        raise HTTPException(404, "Thread not found.")
    # iter426 — DM block enforcement (Google Play UGC compliance).
    from routers.dm_blocks import is_blocked as _blk
    if await _blk(f"buyer:{email}", f"maker:{t.get('maker_slug','')}"):
        raise HTTPException(403, "You cannot reply on a blocked conversation.")
    body = _scrub(payload.body, MAX_BODY)
    attachments = await _resolve_attachments(payload.attachment_ids, f"buyer:{email}")
    if not body and not attachments:
        raise HTTPException(400, "Message body or a photo is required.")
    name = _scrub(claims.get("name", "") or t.get("buyer_name", "") or "", 120)
    msg = await _create_message(
        thread_id=thread_id, sender_type="buyer",
        sender_email=email, sender_name=name, body=body, attachments=attachments,
    )
    await _mark_attachments_used(attachments, msg["id"], thread_id)
    await db.dm_threads.update_one(
        {"id": thread_id},
        {"$set": {
            "last_message_at": now_iso(),
            "last_sender": "buyer",
            "unread_for_buyer": 0,
        },
         "$inc": {"unread_for_maker": 1, "message_count": 1}},
    )

    bg.add_task(
        send_dm_to_maker,
        t["maker_email"], t.get("maker_name", ""),
        name or email, email,
        t.get("subject", ""), body or "📷 Photo attachment", thread_id,
    )
    return {"message_id": msg["id"]}
