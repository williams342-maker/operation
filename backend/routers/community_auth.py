from config import env_get
"""Community auth: Google OAuth handshake, magic-link sign-in, EUA gate, profile.

Carved out of `routers/community.py` (Feb 2026 refactor). The `/community/me/avatar`
upload also lives here since it's a profile mutation, not content.
"""
import base64
import os
import uuid

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Request, UploadFile
from pydantic import BaseModel, EmailStr

from core import db, logger, now_iso
from email_service import _send, _shell
from maker_auth import (
    current_buyer, issue_buyer_magic_token, issue_session_jwt,
    verify_buyer_magic_token,
)

from .community_common import CURRENT_EUA_VERSION

router = APIRouter()

EMERGENT_AUTH_URL = env_get(
    "EMERGENT_AUTH_URL",
    "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
)


# ===================== MODELS =====================
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


# ===================== HELPERS =====================
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
        return {**existing, **updates, "_is_new_signup": False}
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
    user["_is_new_signup"] = True
    return user


# iter413cj — Server-side conversion mirror for buyer signups.
# Fires Meta CAPI + TikTok Events API in a background task whenever a
# brand-new buyer signs in. Mints a deterministic event_id keyed on
# the user_id so the browser can pass the SAME id into its pixel calls
# and Meta + TikTok will dedupe the two streams into one attributed
# conversion. Source-attribution (`event_label`) distinguishes
# magic-link vs google_oauth funnels.
def _schedule_buyer_signup_mirror(
    bg: BackgroundTasks,
    *,
    user: dict,
    request: Request,
    label: str,  # 'magic_link' or 'google_oauth'
) -> str:
    """Schedule the Meta + TikTok server-side fires and return the
    `event_id` the caller must echo back in the JSON response so the
    browser pixels can dedup."""
    event_id = f"buyer-signup-{user['user_id']}"
    ip = (
        request.headers.get("x-forwarded-for", "").split(",")[0].strip()
        or (request.client.host if request.client else "")
    )
    ua = (request.headers.get("user-agent") or "")[:512]
    referer = request.headers.get("referer") or "https://craftersmarket.org/community"

    # Meta CAPI mirror.
    try:
        from routers.meta_capi import send_meta_event
        bg.add_task(
            send_meta_event,
            event_name="signup_buyer",
            event_id=event_id,
            email=user["email"],
            client_ip=ip,
            user_agent=ua,
            event_source_url=referer,
            custom_data={"event_label": label},
        )
    except Exception as e:
        logger.warning("[meta-capi] buyer-signup schedule failed: %s", e)

    # TikTok Events API mirror.
    try:
        from routers.tiktok_capi import send_tiktok_event
        bg.add_task(
            send_tiktok_event,
            event_name="signup_buyer",
            event_id=event_id,
            email=user["email"],
            external_id=user["user_id"],
            client_ip=ip,
            user_agent=ua,
            event_source_url=referer,
            content_name=f"signup_{label}",
            custom_data={"event_label": label},
        )
    except Exception as e:
        logger.warning("[tiktok-capi] buyer-signup schedule failed: %s", e)

    return event_id


# ===================== ENDPOINTS =====================
@router.post("/community/auth/google")
async def community_auth_google(payload: GoogleSessionRequest, request: Request, bg: BackgroundTasks):
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
    is_new = user.pop("_is_new_signup", False)
    jwt_token = issue_session_jwt(user["user_id"], user["email"], role="buyer")
    # iter413cj — Fire Meta CAPI + TikTok Events API on brand-new signups.
    signup_event_id = ""
    if is_new:
        signup_event_id = _schedule_buyer_signup_mirror(
            bg, user=user, request=request, label="google_oauth",
        )
    return {
        "token": jwt_token, "user": user, "is_new_signup": is_new,
        "signup_event_id": signup_event_id,
    }


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
async def community_auth_magic_verify(payload: MagicVerifyRequest, request: Request, bg: BackgroundTasks):
    email = verify_buyer_magic_token(payload.token)
    # EUA gate: pass for returning users on the current version,
    # require explicit acceptance otherwise.
    existing = await db.community_users.find_one({"email": email}, {"_id": 0, "eua_version": 1})
    if not existing or existing.get("eua_version") != CURRENT_EUA_VERSION:
        _require_eua(payload.accept_eua, payload.eua_version)
    eua_version = CURRENT_EUA_VERSION if (payload.accept_eua and payload.eua_version == CURRENT_EUA_VERSION) else ""

    user = await _upsert_buyer(email=email, eua_version=eua_version)
    is_new = user.pop("_is_new_signup", False)
    jwt_token = issue_session_jwt(user["user_id"], user["email"], role="buyer")
    # iter413cj — Fire Meta CAPI + TikTok Events API on brand-new signups.
    signup_event_id = ""
    if is_new:
        signup_event_id = _schedule_buyer_signup_mirror(
            bg, user=user, request=request, label="magic_link",
        )
    return {
        "token": jwt_token, "user": user, "is_new_signup": is_new,
        "signup_event_id": signup_event_id,
    }


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
