"""Community: buyer auth (Google + magic link), showcase, design files, forum.

Live chat (WebSocket + history + presence) lives in `community_chat.py`.
Per-channel chat moderation (admin) lives in `chat_mod.py`.
"""
import base64
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional

import httpx
from fastapi import (
    APIRouter, BackgroundTasks, Depends, HTTPException,
    UploadFile, File, Form,
)
from fastapi.responses import Response
from pydantic import BaseModel, EmailStr

from core import db, logger, now_iso
from email_service import _send, _shell  # reuse Resend helper directly for buyer link
from maker_auth import (
    current_any_user, current_buyer, current_maker_slug, decode_session_jwt,
    issue_buyer_magic_token, issue_session_jwt, verify_buyer_magic_token,
)

router = APIRouter()

EMERGENT_AUTH_URL = os.environ.get(
    "EMERGENT_AUTH_URL",
    "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
)

DOWNLOAD_FREE_LIMIT = 6
DOWNLOAD_WINDOW_DAYS = 180  # 6 months
PAID_UNLOCK_AMOUNT = 5.00


# ===================== AUTH =====================
# Bump this when Terms / Code-of-Conduct text changes substantively. Any user
# whose stored eua_version doesn't match this is gated until they re-accept.
CURRENT_EUA_VERSION = "2026-04"


class GoogleSessionRequest(BaseModel):
    session_id: str
    accept_eua: bool = False
    eua_version: str = ""


class MagicRequest(BaseModel):
    email: EmailStr
    origin_url: str
    accept_eua: bool = False
    eua_version: str = ""


class MagicVerifyRequest(BaseModel):
    token: str
    accept_eua: bool = False
    eua_version: str = ""


def _require_eua(accept: bool, version: str) -> str:
    """Reject the call when EUA isn't accepted or version mismatches.
    Returns the validated version on success."""
    if not accept or version != CURRENT_EUA_VERSION:
        raise HTTPException(
            status_code=400,
            detail=(
                "You must accept the Crafters Market Community Terms "
                f"(version {CURRENT_EUA_VERSION}) to sign in."
            ),
        )
    return version


async def _upsert_buyer(email: str, name: str = "", picture: str = "",
                        eua_version: str = "") -> dict:
    """Idempotent buyer upsert by email. If `eua_version` is provided, stamp
    the user's terms/community-guidelines acceptance with that version + ts."""
    email = email.lower().strip()
    existing = await db.community_users.find_one({"email": email}, {"_id": 0})
    if existing:
        updates = {"last_seen": now_iso()}
        if name and not existing.get("name"):
            updates["name"] = name
        if picture and not existing.get("picture"):
            updates["picture"] = picture
        if eua_version and existing.get("eua_version") != eua_version:
            updates["eua_version"] = eua_version
            updates["eua_accepted_at"] = now_iso()
        await db.community_users.update_one({"email": email}, {"$set": updates})
        return {**existing, **updates}
    user = {
        "user_id": f"user_{uuid.uuid4().hex[:12]}",
        "email": email,
        "name": name or email.split("@")[0],
        "picture": picture or "",
        "created_at": now_iso(),
        "last_seen": now_iso(),
        "eua_version": eua_version or None,
        "eua_accepted_at": now_iso() if eua_version else None,
    }
    await db.community_users.insert_one(user)
    user.pop("_id", None)
    return user


@router.post("/community/auth/google")
async def community_auth_google(payload: GoogleSessionRequest):
    """Exchange an Emergent Google session_id for a buyer JWT.
    First-time users must include accept_eua + eua_version. Returning users
    who already stamped the current version skip the gate."""
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

    email = (data.get("email") or "").lower().strip()
    # EUA gate: pass if user already accepted current version, otherwise require
    # the client to send accept_eua=true with the right version.
    existing = await db.community_users.find_one({"email": email}, {"_id": 0, "eua_version": 1})
    if not existing or existing.get("eua_version") != CURRENT_EUA_VERSION:
        _require_eua(payload.accept_eua, payload.eua_version)
    eua_version = CURRENT_EUA_VERSION if (payload.accept_eua and payload.eua_version == CURRENT_EUA_VERSION) else ""

    user = await _upsert_buyer(
        email=email,
        name=data.get("name", ""),
        picture=data.get("picture", ""),
        eua_version=eua_version,
    )
    jwt_token = issue_session_jwt(user["user_id"], user["email"], role="buyer")
    return {"token": jwt_token, "user": user}


@router.post("/community/auth/magic/request")
async def community_auth_magic_request(payload: MagicRequest, bg: BackgroundTasks):
    email = payload.email.lower().strip()
    # Same gate as the verify endpoint — first-time signers must accept.
    existing = await db.community_users.find_one({"email": email}, {"_id": 0, "eua_version": 1})
    if not existing or existing.get("eua_version") != CURRENT_EUA_VERSION:
        _require_eua(payload.accept_eua, payload.eua_version)
        # Stamp acceptance now so the verify call doesn't need to ask again.
        await _upsert_buyer(email=email, eua_version=CURRENT_EUA_VERSION)

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
    # EUA gate: pass for returning users on the current version,
    # require explicit acceptance otherwise.
    existing = await db.community_users.find_one({"email": email}, {"_id": 0, "eua_version": 1})
    if not existing or existing.get("eua_version") != CURRENT_EUA_VERSION:
        _require_eua(payload.accept_eua, payload.eua_version)
    eua_version = CURRENT_EUA_VERSION if (payload.accept_eua and payload.eua_version == CURRENT_EUA_VERSION) else ""

    user = await _upsert_buyer(email=email, eua_version=eua_version)
    jwt_token = issue_session_jwt(user["user_id"], user["email"], role="buyer")
    return {"token": jwt_token, "user": user}


@router.get("/community/eua")
async def community_eua():
    """Public endpoint — current EUA version + summary, used by the sign-in
    UI to render the checkbox label and link."""
    return {
        "version": CURRENT_EUA_VERSION,
        "title": "Crafters Market Community Terms",
        "summary": (
            "Be respectful, no spam, no harassment, no harvesting other "
            "members' personal info. Your posts may be moderated. By signing "
            "in you agree to these Community Terms and our Privacy Policy."
        ),
        "links": {
            "policy": "/policy",
        },
    }


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
    # Quarantined files (flagged + actioned by admin) are hidden from the
    # public list so abuse reports can be resolved without a race where
    # the file stays discoverable until a cache invalidation.
    return await db.design_files.find(
        {"quarantined_at": None},
        {"_id": 0},
    ).sort("created_at", -1).to_list(limit)


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


@router.post("/community/files/upload")
async def upload_design_file_direct(
    file: UploadFile = File(...),
    title: str = Form(...),
    description: str = Form(...),
    thumbnail_url: str = Form(""),
    claims: dict = Depends(current_any_user),
):
    """Direct file upload for the community design-file library.

    Any signed-in community user (buyer OR maker) can post a design file.
    Files are uploaded to R2 under `community-files/<user>/<uuid>.<ext>`,
    then a `design_files` row is created with the resolved public URL.

    The existing URL-paste endpoint (`POST /community/files`) is kept for
    makers who host on Dropbox/Drive. This endpoint is the preferred
    path — no external hosting required, and we can moderate the bytes.
    """
    title = (title or "").strip()
    description = (description or "").strip()
    if not title or len(title) > 120:
        raise HTTPException(400, "Title is required (max 120 chars).")
    if not description or len(description) > 800:
        raise HTTPException(400, "Description is required (max 800 chars).")

    from r2_storage import is_configured as r2_ok, upload_design_file_bytes
    if not r2_ok():
        raise HTTPException(503, "File uploads are not configured.")

    raw = await file.read()
    if not raw:
        raise HTTPException(400, "Empty file.")

    role = claims.get("role", "buyer")
    if role == "maker":
        user_key = claims.get("sub", "maker")
        uploader_label = claims.get("sub", "maker")
        maker = await db.makers.find_one({"slug": user_key}, {"_id": 0, "name": 1})
        uploader_name = (maker or {}).get("name") or user_key
    else:
        user_key = claims.get("sub", "buyer")
        u = await db.community_users.find_one({"user_id": user_key}, {"_id": 0, "name": 1})
        uploader_label = user_key
        uploader_name = (u or {}).get("name") or "Community Member"

    try:
        url, ext = upload_design_file_bytes(
            raw,
            key_prefix=f"community-files/{uploader_label}",
            filename=file.filename,
            content_type=file.content_type or "",
        )
    except ValueError as e:
        raise HTTPException(400, str(e))

    doc = {
        "id": str(uuid.uuid4()),
        "maker_slug": uploader_label if role == "maker" else None,
        "uploader_role": role,
        "uploader_id": user_key,
        "maker_name": uploader_name,  # kept as `maker_name` for backward compat with existing UI
        "title": title[:120],
        "description": description[:800],
        "file_type": ext,
        "download_url": url,
        "thumbnail_url": (thumbnail_url or "").strip()[:600] or None,
        "downloads": 0,
        "size_bytes": len(raw),
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
        "status": "active",
        "expires_at": {"$gte": now_iso()},
    }, {"_id": 0})

    if recent_count >= DOWNLOAD_FREE_LIMIT and not paid:
        # Silent metering — frontend never advertises the quota up-front, so we
        # surface the paywall only at the moment the wall is hit.
        return {
            "locked": True,
            "downloads_used": recent_count,
            "free_limit": DOWNLOAD_FREE_LIMIT,
            "unlock_amount": PAID_UNLOCK_AMOUNT,
            "message": "Unlock unlimited downloads for $5 (180 days).",
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



# ===================== DESIGN FILE REPORTS =====================
# Open-to-all design-file uploads mean anyone can post a file they ripped
# off another maker's listing / an external copyrighted source. This
# report flow gives any community user (buyer or maker) a one-click way
# to flag a file, and admin a quarantine/dismiss moderation queue.

REPORT_REASONS = {
    "stolen":      "Stolen work / IP infringement",
    "copyright":   "Copyright violation",
    "duplicate":   "Duplicate listing",
    "malware":     "Malware / suspicious file",
    "inaccurate":  "Mislabelled or broken",
    "other":       "Other concern",
}


class FileReportRequest(BaseModel):
    reason: str               # one of REPORT_REASONS keys
    details: Optional[str] = None


@router.post("/community/files/{file_id}/report")
async def report_design_file(
    file_id: str,
    body: FileReportRequest,
    claims: dict = Depends(current_any_user),
):
    """Flag a design file for admin review (stolen work, copyright, etc.).

    Any signed-in community user can report. We de-dupe by
    (file_id, reported_by) so a single user can't spam the queue — they
    can only have one open report per file. Reports are private (never
    exposed to the uploader) to avoid retaliation.
    """
    reason = (body.reason or "").strip()
    if reason not in REPORT_REASONS:
        raise HTTPException(400, "Invalid reason.")
    details = (body.details or "").strip()[:1000]

    file_doc = await db.design_files.find_one({"id": file_id}, {"_id": 0, "id": 1, "title": 1, "maker_name": 1, "maker_slug": 1, "uploader_id": 1})
    if not file_doc:
        raise HTTPException(404, "File not found.")

    reporter = claims.get("sub", "")
    existing = await db.design_file_reports.find_one({
        "file_id": file_id,
        "reported_by": reporter,
        "status": "open",
    }, {"_id": 0, "id": 1})
    if existing:
        return {"ok": True, "duplicate": True, "id": existing["id"]}

    doc = {
        "id": str(uuid.uuid4()),
        "file_id": file_id,
        "file_title": file_doc.get("title"),
        "file_uploader": file_doc.get("maker_name") or file_doc.get("maker_slug") or file_doc.get("uploader_id"),
        "reported_by": reporter,
        "reported_role": claims.get("role"),
        "reason": reason,
        "reason_label": REPORT_REASONS[reason],
        "details": details,
        "status": "open",
        "created_at": now_iso(),
        "resolved_at": None,
        "resolver": None,
        "resolver_note": None,
    }
    await db.design_file_reports.insert_one(doc)
    # Increment a fast counter on the file itself so the admin queue can
    # sort by "most reported" without a join.
    await db.design_files.update_one(
        {"id": file_id},
        {"$inc": {"open_reports": 1}},
    )
    return {"ok": True, "duplicate": False, "id": doc["id"]}


# ===================== FORUM =====================
# Six canonical categories for organising threads. Adding a new one? Append it
# to FORUM_CATEGORIES — the frontend tabs read from /community/forum/categories.
FORUM_CATEGORIES = [
    {"id": "general",     "label": "General"},
    {"id": "machine-help", "label": "Machine Help"},
    {"id": "techniques",  "label": "Techniques"},
    {"id": "finishing",   "label": "Finishing"},
    {"id": "resources",   "label": "Resources"},
    {"id": "show-tell",   "label": "Show & Tell"},
]
FORUM_CATEGORY_IDS = {c["id"] for c in FORUM_CATEGORIES}


class ForumAttachment(BaseModel):
    """File attached to a forum thread or reply (lives in R2)."""
    url: str
    filename: str
    mime: str
    size: int


class ForumThreadCreate(BaseModel):
    title: str
    body: str
    category: str = "general"   # one of FORUM_CATEGORY_IDS
    attachments: List[ForumAttachment] = []
    # Legacy alias kept for backward compat with old clients.
    tag: Optional[str] = None


class ForumReplyCreate(BaseModel):
    body: str
    attachments: List[ForumAttachment] = []


@router.get("/community/forum/categories")
async def list_forum_categories():
    """Public category list — frontend renders these as tabs."""
    return {"categories": FORUM_CATEGORIES}


@router.get("/community/forum")
async def list_threads(
    category: Optional[str] = None, tag: Optional[str] = None, limit: int = 50,
):
    q: Dict = {}
    cat = category or tag
    if cat:
        q["category"] = cat
    # Hide threads from banned users (their veiled stub is below).
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


def _veil_if_removed(doc: dict) -> dict:
    """If a moderator removed this thread/reply, replace user-facing content
    with a clear stub. Preserves the timestamp + UUID for audit."""
    if doc.get("removed_by_mod"):
        doc["body"] = "[removed by moderators]"
        doc["title"] = doc.get("title") or "[removed]"
        doc["attachments"] = []
        doc["user_name"] = "[removed]"
    return doc


async def _ensure_user_can_post(user_id: str) -> dict:
    """Block banned/frozen users from posting. Returns the user doc on pass."""
    user = await db.community_users.find_one({"user_id": user_id}, {"_id": 0})
    if not user:
        raise HTTPException(404, "User not found")
    status = user.get("moderation_status")
    if status == "banned":
        raise HTTPException(403, "Your account has been permanently suspended for policy violations.")
    if status == "frozen":
        raise HTTPException(403, "Your account is temporarily frozen — contact support to restore access.")
    return user


@router.post("/community/forum")
async def create_thread(payload: ForumThreadCreate, claims: dict = Depends(current_buyer)):
    user = await _ensure_user_can_post(claims["sub"])
    cat = (payload.category or payload.tag or "general").lower()
    if cat not in FORUM_CATEGORY_IDS:
        raise HTTPException(400, f"Unknown category '{cat}'.")
    title = payload.title.strip()[:200]
    body = payload.body.strip()[:8000]
    # AI moderation pre-insert. Fails-open on any error so a transient LLM
    # outage doesn't block legit posts. Same allow/warn/block model as chat.
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
        "attachments": [a.model_dump() for a in (payload.attachments or [])][:6],
        "tag": cat,           # alias for backward compat
        "reply_count": 0,
        "created_at": now_iso(),
        "ai_mod_action": action,    # 'allow' | 'warn'
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
    # AI moderation pre-insert.
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


# ─────────────────── Forum file uploads ───────────────────
FORUM_ALLOWED_IMAGE = {"image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"}
FORUM_ALLOWED_DOC = {
    "application/pdf",
    "application/octet-stream",   # generic — needed for .glb/.dxf/.svg without proper mime
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
    `forum/<user_id>/<uuid>.<ext>`. Returns the URL + metadata to splice into
    the thread/reply payload."""
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


# Chat: extracted to routers/community_chat.py in iter43.


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
