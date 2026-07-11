"""Community forum: categories, threads, replies, attachments.

Carved out of `routers/community.py` (Feb 2026 refactor).

Surfaces:
  • Public category list + trending threads
  • Public thread listing + thread+replies fetch
  • Authenticated thread/reply creation with AI auto-moderation
  • R2-backed forum attachment upload (images + design preview files)
"""
import uuid
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel

from core import db, logger, now_iso
from maker_auth import current_buyer, current_admin

from .community_common import _ensure_user_can_post
from .workshop_floor import (
    WORKSHOP_CATEGORIES, WORKSHOP_CATEGORY_IDS, CATEGORY_TAGS,
    LEGACY_CATEGORY_MAP, FALLBACK_CATEGORY,
)

router = APIRouter()


# iter457 — The Workshop Floor taxonomy (10 categories + followable tags).
# Single source of truth lives in routers/workshop_floor.py.
FORUM_CATEGORIES = WORKSHOP_CATEGORIES
FORUM_CATEGORY_IDS = WORKSHOP_CATEGORY_IDS


# ===================== MODELS =====================
class ForumAttachment(BaseModel):
    """File attached to a forum thread or reply (lives in R2)."""
    url: str
    filename: str
    mime: str
    size: int


class ForumThreadCreate(BaseModel):
    title: str
    body: str
    category: str = FALLBACK_CATEGORY
    tags: List[str] = []
    attachments: List[ForumAttachment] = []
    # Legacy alias kept for backward compat with old clients.
    tag: Optional[str] = None


class ForumReplyCreate(BaseModel):
    body: str
    attachments: List[ForumAttachment] = []


# ===================== HELPERS =====================
def _veil_if_removed(doc: dict) -> dict:
    """If a moderator removed this thread/reply, replace user-facing content
    with a clear stub. Preserves the timestamp + UUID for audit."""
    if doc.get("removed_by_mod"):
        doc["body"] = "[removed by moderators]"
        doc["title"] = doc.get("title") or "[removed]"
        doc["attachments"] = []
        doc["user_name"] = "[removed]"
    return doc


# ===================== READ =====================
@router.get("/community/forum/categories")
async def list_forum_categories():
    """Public category list (+ live thread counts) — frontend renders these
    as the Discussions category strip."""
    counts = {}
    async for g in db.forum_threads.aggregate([
            {"$match": {"removed_by_mod": {"$ne": True}}},
            {"$group": {"_id": "$category", "n": {"$sum": 1}}}]):
        counts[g["_id"]] = g["n"]
    cats = [{**c, "thread_count": counts.get(c["id"], 0)} for c in FORUM_CATEGORIES]
    return {"categories": cats}


@router.get("/community/forum/trending")
async def trending_threads(days: int = 30, limit: int = 3):
    """Top threads by recent activity (created_at within `days` window)."""
    days = max(1, min(int(days), 365))
    limit = max(1, min(int(limit), 12))
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    cursor = db.forum_threads.find(
        {"created_at": {"$gte": cutoff}, "removed_by_mod": {"$ne": True}},
        {"_id": 0, "id": 1, "title": 1, "category": 1, "reply_count": 1,
         "user_name": 1, "created_at": 1},
    ).sort([("reply_count", -1), ("created_at", -1)])
    rows = await cursor.to_list(limit)
    return {"threads": rows, "days": days}


@router.get("/community/forum")
async def list_threads(
    category: Optional[str] = None, tag: Optional[str] = None, limit: int = 50,
):
    q: Dict = {}
    if category:
        q["category"] = LEGACY_CATEGORY_MAP.get(category, category)
    if tag:
        # Legacy clients passed `tag` as a category alias — honor that when
        # the value is a known (old or new) category id; otherwise filter
        # by the thread's tags array.
        if tag in FORUM_CATEGORY_IDS or tag in LEGACY_CATEGORY_MAP:
            q["category"] = LEGACY_CATEGORY_MAP.get(tag, tag)
        else:
            q["tags"] = tag
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


# ===================== WRITE =====================
@router.post("/community/forum")
async def create_thread(payload: ForumThreadCreate, claims: dict = Depends(current_buyer)):
    user = await _ensure_user_can_post(claims["sub"])
    cat = (payload.category or payload.tag or FALLBACK_CATEGORY).lower()
    cat = LEGACY_CATEGORY_MAP.get(cat, cat)
    if cat not in FORUM_CATEGORY_IDS:
        raise HTTPException(400, f"Unknown category '{cat}'.")
    tags = [t.lower().strip() for t in (payload.tags or [])]
    tags = [t for t in dict.fromkeys(tags) if t in CATEGORY_TAGS[cat]][:5]
    title = payload.title.strip()[:200]
    body = payload.body.strip()[:8000]
    try:
        from ai_moderator import moderate_message
        action, reason = await moderate_message(
            channel=f"forum:{cat}",
            user_email=user["email"],
            user_name=user.get("name", "") or user["email"].split("@")[0],
            text=f"{title}\n\n{body}",
        )
    except Exception as e:
        logger.exception("[ai_mod] forum thread moderator crashed, allowing: %s", e)
        action, reason = "allow", "exception_fail_open"
    if action == "block":
        raise HTTPException(403, f"Your post was held by the auto-moderator: {reason}")
    doc = {
        "id": str(uuid.uuid4()),
        "user_id": claims["sub"],
        "user_email": user["email"],
        "user_name": user.get("name", ""),
        "title": title,
        "body": body,
        "category": cat,
        "tags": tags,
        "attachments": [a.model_dump() for a in (payload.attachments or [])][:6],
        "tag": cat,
        "reply_count": 0,
        "created_at": now_iso(),
        "ai_mod_action": action,
        "ai_mod_reason": reason or None,
    }
    await db.forum_threads.insert_one(doc)
    doc.pop("_id", None)
    return doc


@router.post("/community/forum/{thread_id}/reply")
async def reply_thread(thread_id: str, payload: ForumReplyCreate, claims: dict = Depends(current_buyer)):
    thread = await db.forum_threads.find_one({"id": thread_id}, {"_id": 0})
    if not thread:
        raise HTTPException(404, "Thread not found")
    user = await _ensure_user_can_post(claims["sub"])
    body = payload.body.strip()[:8000]
    try:
        from ai_moderator import moderate_message
        action, reason = await moderate_message(
            channel=f"forum:{thread.get('category', 'general')}",
            user_email=user["email"],
            user_name=user.get("name", "") or user["email"].split("@")[0],
            text=body,
        )
    except Exception as e:
        logger.exception("[ai_mod] forum reply moderator crashed, allowing: %s", e)
        action, reason = "allow", "exception_fail_open"
    if action == "block":
        raise HTTPException(403, f"Your reply was held by the auto-moderator: {reason}")
    doc = {
        "id": str(uuid.uuid4()),
        "thread_id": thread_id,
        "user_id": claims["sub"],
        "user_email": user["email"],
        "user_name": user.get("name", ""),
        "body": body,
        "attachments": [a.model_dump() for a in (payload.attachments or [])][:6],
        "created_at": now_iso(),
        "ai_mod_action": action,
        "ai_mod_reason": reason or None,
    }
    await db.forum_replies.insert_one(doc)
    await db.forum_threads.update_one({"id": thread_id}, {"$inc": {"reply_count": 1}})
    doc.pop("_id", None)
    return doc


@router.post("/admin/forum/threads/{thread_id}/team-reply")
async def admin_team_reply(
    thread_id: str,
    payload: ForumReplyCreate,
    claims: dict = Depends(current_admin),
):
    """Admin-only — post a reply on a forum thread under the
    'Crafters Market Workshop Team' persona. Used by ops to keep new
    threads from sitting at zero replies. Skips the AI moderator (admin
    trust) and tags the doc `is_team_reply: true` so it can be filtered
    out of analytics if needed.
    """
    thread = await db.forum_threads.find_one({"id": thread_id}, {"_id": 0})
    if not thread:
        raise HTTPException(404, "Thread not found")
    body = (payload.body or "").strip()[:8000]
    if not body:
        raise HTTPException(400, "Reply body required")
    doc = {
        "id": str(uuid.uuid4()),
        "thread_id": thread_id,
        "user_id": "system-workshop-team",
        "user_email": "workshop@craftersmarket.org",
        "user_name": "Crafters Market Workshop Team",
        "body": body,
        "attachments": [a.model_dump() for a in (payload.attachments or [])][:6],
        "created_at": now_iso(),
        "is_team_reply": True,
        "posted_by_admin": claims.get("sub"),
        "ai_mod_action": "allow",
        "ai_mod_reason": "team_reply_admin",
    }
    await db.forum_replies.insert_one(doc)
    await db.forum_threads.update_one(
        {"id": thread_id},
        {"$set": {"last_activity_at": doc["created_at"]}, "$inc": {"reply_count": 1}},
    )
    doc.pop("_id", None)
    return doc


# ===================== FORUM ATTACHMENTS =====================
FORUM_ALLOWED_IMAGE = {"image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"}
FORUM_ALLOWED_DOC = {
    "application/pdf",
    "application/octet-stream",
    "image/svg+xml",
    "model/gltf-binary",
    "model/gltf+json",
    "application/dxf", "application/x-dxf", "image/vnd.dxf",
}
FORUM_MAX_IMAGE_BYTES = 5 * 1024 * 1024
FORUM_MAX_DOC_BYTES = 15 * 1024 * 1024
FORUM_ALLOWED_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif",
                     ".pdf", ".svg", ".glb", ".gltf", ".dxf"}


@router.post("/community/forum/upload")
async def upload_forum_attachment(
    file: UploadFile = File(...), claims: dict = Depends(current_buyer),
):
    """Single-file uploader for thread/reply attachments. Stores in R2 under
    `forum/<user_id>/<uuid>.<ext>`."""
    await _ensure_user_can_post(claims["sub"])
    from r2_storage import is_configured as r2_ok, upload_bytes
    if not r2_ok():
        raise HTTPException(503, "File uploads are not configured.")
    raw = await file.read()
    size = len(raw)
    mime = (file.content_type or "").lower()
    name = file.filename or "upload"
    ext = ("." + name.rsplit(".", 1)[-1].lower()) if "." in name else ""

    if ext not in FORUM_ALLOWED_EXT:
        raise HTTPException(400, f"Unsupported file type: {ext or mime}")
    is_image = mime.startswith("image/") and ext in {".png", ".jpg", ".jpeg", ".webp", ".gif"}
    is_doc = ext in {".pdf", ".svg", ".glb", ".gltf", ".dxf"}
    if not (is_image or is_doc):
        raise HTTPException(400, f"Unsupported file: {name}")
    if is_image and size > FORUM_MAX_IMAGE_BYTES:
        raise HTTPException(400, f"Image must be ≤ {FORUM_MAX_IMAGE_BYTES // (1024 * 1024)}MB.")
    if is_doc and size > FORUM_MAX_DOC_BYTES:
        raise HTTPException(400, f"File must be ≤ {FORUM_MAX_DOC_BYTES // (1024 * 1024)}MB.")

    key = f"forum/{claims['sub']}/{uuid.uuid4().hex}{ext}"
    fallback_mime = "application/pdf" if ext == ".pdf" else (
        "model/gltf-binary" if ext == ".glb" else "application/octet-stream")
    url = upload_bytes(data=raw, key=key, content_type=mime or fallback_mime)
    return {"url": url, "filename": name[:120], "mime": mime or fallback_mime, "size": size}
