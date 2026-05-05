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
    APIRouter, BackgroundTasks, Body, Depends, HTTPException, Request,
    UploadFile, File, Form,
)
from fastapi.responses import Response
from pydantic import BaseModel, EmailStr

from core import db, logger, now_iso
from email_service import _send, _shell  # reuse Resend helper directly for buyer link
from maker_auth import (
    current_admin, current_any_user, current_buyer, current_maker_slug,
    decode_session_jwt, issue_buyer_magic_token, issue_session_jwt,
    verify_buyer_magic_token,
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
    # iter114 — multi-image showcase. New posts populate `image_urls`;
    # `image_url` is kept for backwards compat with the existing card UI
    # (it always holds image_urls[0] when present).
    image_url: Optional[str] = None
    image_urls: List[str] = []
    product_slug: Optional[str] = None
    maker_slug: Optional[str] = None


@router.get("/community/showcase")
async def list_showcase(limit: int = 50):
    return await db.showcase_posts.find({}, {"_id": 0}).sort("created_at", -1).to_list(limit)


@router.get("/community/showcase/recent")
async def list_recent_showcase(
    limit: int = 4,
    product_slug: Optional[str] = None,
    maker_slug: Optional[str] = None,
):
    """Public, no-auth, lightweight feed for the homepage + product-page
    'Recently shared by buyers' strip (iter116). Prefers posts tagged with
    the requested product or maker; falls back to general newest-first
    when nothing is tagged or the tagged feed is too thin to render a
    full row.

    Why this is its own endpoint and not just the existing /showcase:
    - Keeps the homepage payload bounded (limit cap of 12) so the strip
      never accidentally renders 50 cards.
    - Allows targeted fall-back: a product page first asks for posts that
      tag *that* product, and only widens the net when it has fewer than
      `limit` matches.
    - Ships a minimum-image projection so we don't waste bandwidth pulling
      the full description / user_email blobs the card doesn't show."""
    # Clamp to [1, 12]. Note: `int(limit or 4)` would be wrong here —
    # Python's truthiness coerces 0 to the fallback. Explicit None check.
    try:
        n = int(limit) if limit is not None else 4
    except (TypeError, ValueError):
        n = 4
    limit = max(1, min(n, 12))
    proj = {
        "_id": 0, "id": 1, "title": 1,
        "image_url": 1, "image_urls": 1,
        "product_slug": 1, "maker_slug": 1,
        "user_name": 1, "user_picture": 1,
        "likes": 1, "created_at": 1,
    }

    async def _query(filt: dict, n: int) -> list[dict]:
        return await db.showcase_posts.find(filt, proj).sort("created_at", -1).limit(n).to_list(n)

    rows: list[dict] = []
    seen_ids: set[str] = set()

    if product_slug:
        rows = await _query({"product_slug": product_slug}, limit)
        seen_ids = {r["id"] for r in rows}

    if maker_slug and len(rows) < limit:
        more = await _query(
            {"maker_slug": maker_slug, "id": {"$nin": list(seen_ids)}},
            limit - len(rows),
        )
        rows.extend(more)
        seen_ids.update(r["id"] for r in more)

    if len(rows) < limit:
        more = await _query({"id": {"$nin": list(seen_ids)}}, limit - len(rows))
        rows.extend(more)

    return {"items": rows[:limit], "count": len(rows[:limit])}


@router.post("/community/showcase")
async def create_showcase(post: ShowcasePost, claims: dict = Depends(current_buyer)):
    user = await db.community_users.find_one({"user_id": claims["sub"]}, {"_id": 0})
    if not user:
        raise HTTPException(404, "User not found")
    # Normalize image fields — accept either shape from the client and
    # land both populated in the DB so old + new card renderers both work.
    payload = post.model_dump()
    urls = list(payload.get("image_urls") or [])
    if payload.get("image_url") and payload["image_url"] not in urls:
        urls.insert(0, payload["image_url"])
    if not urls:
        raise HTTPException(400, "At least one image is required.")
    # Soft cap matches the frontend picker — 8 photos per showcase post.
    urls = urls[:8]
    payload["image_urls"] = urls
    payload["image_url"] = urls[0]

    doc = {
        "id": str(uuid.uuid4()),
        "user_id": claims["sub"],
        "user_email": user["email"],
        "user_name": user.get("name", ""),
        "user_picture": user.get("picture", ""),
        **payload,
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


# ============================================================
# Showcase analytics — view + click events (iter117)
# ============================================================
# Events are written to a dedicated collection so we can answer
# arbitrary-window questions ("top posts last 7 days," "click-through
# in the last hour") without per-doc counters going stale. Showcase
# posts also keep a denormalized `views`/`clicks` counter for the
# common "all-time totals" query the discovery strip might want later.
class _ShowcaseEventBody(BaseModel):
    # Optional surface tag — "home", "product", "maker" — so we can later
    # answer "did the homepage strip drive more clicks than the product-page
    # strip?" without having to re-derive context from referer headers.
    source: Optional[str] = None


async def _record_showcase_event(post_id: str, kind: str, source: Optional[str], request: Request):
    """Insert one event row + bump the denormalized counter on the post."""
    if kind not in ("view", "click"):
        return False
    # Confirm the post exists — cheap projection-only lookup. Avoids us
    # logging events for fabricated post IDs.
    post = await db.showcase_posts.find_one({"id": post_id}, {"_id": 0, "id": 1})
    if not post:
        return False
    # Hash the IP for a coarse anonymous "viewer fingerprint" — enough to
    # dedupe within a window without persisting raw PII.
    import hashlib
    raw_ip = (request.client.host if request.client else "") + (request.headers.get("user-agent") or "")
    fingerprint = hashlib.sha1(raw_ip.encode("utf-8", "ignore")).hexdigest()[:16]
    # Best-effort dedupe: same (post, kind, fingerprint) within 30 min counts once.
    from datetime import datetime, timedelta, timezone
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=30)).isoformat()
    recent = await db.showcase_events.find_one({
        "post_id": post_id, "kind": kind,
        "fingerprint": fingerprint,
        "created_at": {"$gte": cutoff},
    }, {"_id": 0, "post_id": 1})
    if recent:
        return True  # already counted recently — silent no-op
    await db.showcase_events.insert_one({
        "post_id": post_id,
        "kind": kind,
        "source": (source or "")[:32],
        "fingerprint": fingerprint,
        "created_at": now_iso(),
    })
    counter_field = "views" if kind == "view" else "clicks"
    await db.showcase_posts.update_one({"id": post_id}, {"$inc": {counter_field: 1}})
    return True


@router.post("/community/showcase/{post_id}/view")
async def record_showcase_view(post_id: str, request: Request,
                                body: _ShowcaseEventBody = Body(default=_ShowcaseEventBody())):
    """Public — fired by `RecentShowcaseStrip` when a tile becomes visible.
    Anonymous (no auth required) since the strip renders for guests too.
    Best-effort + dedupes by IP+UA within 30 minutes so a refresh or a
    page that mounts the strip multiple times doesn't inflate counts."""
    ok = await _record_showcase_event(post_id, "view", body.source, request)
    return {"ok": ok}


@router.post("/community/showcase/{post_id}/click")
async def record_showcase_click(post_id: str, request: Request,
                                 body: _ShowcaseEventBody = Body(default=_ShowcaseEventBody())):
    """Public — fired when a buyer clicks a strip tile to navigate to the
    showcase post in the community feed. Same dedupe rules as views."""
    ok = await _record_showcase_event(post_id, "click", body.source, request)
    return {"ok": ok}


@router.get("/admin/community/showcase/analytics")
async def admin_showcase_analytics(
    days: int = 7,
    limit: int = 10,
    _: dict = Depends(current_admin),
):
    """Top showcase posts by views in the last `days` days, with their
    click count and computed CTR. Source-attribution counts (home vs.
    product strip) are surfaced alongside so the operator can see which
    placement converts harder."""
    from datetime import datetime, timedelta, timezone
    # Clamp without falling into the `int(x or 7)` truthiness trap —
    # explicit None check so `days=0` correctly clamps to 1.
    try:
        d = int(days) if days is not None else 7
        n = int(limit) if limit is not None else 10
    except (TypeError, ValueError):
        d, n = 7, 10
    days = max(1, min(d, 90))
    limit = max(1, min(n, 50))
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()

    # Aggregate views + clicks in one pass per kind. Two parallel pipelines
    # keep the logic readable; the index on (post_id, kind, created_at)
    # makes both fast even at 6-figure event counts.
    pipeline_views = [
        {"$match": {"kind": "view", "created_at": {"$gte": cutoff}}},
        {"$group": {"_id": "$post_id", "n": {"$sum": 1},
                    "by_source": {"$push": "$source"}}},
        {"$sort": {"n": -1}}, {"$limit": limit},
    ]
    top_views = await db.showcase_events.aggregate(pipeline_views).to_list(limit)

    if not top_views:
        return {"days": days, "rows": [], "totals": {"views": 0, "clicks": 0}}

    post_ids = [r["_id"] for r in top_views]
    posts = await db.showcase_posts.find(
        {"id": {"$in": post_ids}},
        {"_id": 0, "id": 1, "title": 1, "user_name": 1, "image_url": 1,
         "image_urls": 1, "product_slug": 1, "maker_slug": 1, "created_at": 1},
    ).to_list(len(post_ids))
    posts_by_id = {p["id"]: p for p in posts}

    # Single click query for all top posts — one round-trip, then bucket
    # by post_id in Python. Cheaper than N separate aggregates.
    clicks_pipeline = [
        {"$match": {"kind": "click", "post_id": {"$in": post_ids},
                    "created_at": {"$gte": cutoff}}},
        {"$group": {"_id": "$post_id", "n": {"$sum": 1}}},
    ]
    clicks_rows = await db.showcase_events.aggregate(clicks_pipeline).to_list(len(post_ids))
    clicks_by_id = {r["_id"]: r["n"] for r in clicks_rows}

    rows = []
    for v in top_views:
        pid = v["_id"]
        p = posts_by_id.get(pid)
        if not p:
            continue  # post deleted but events linger — skip
        view_count = v["n"]
        click_count = clicks_by_id.get(pid, 0)
        # Source breakdown — counts of each non-empty source string.
        source_counts: dict[str, int] = {}
        for s in (v.get("by_source") or []):
            if s:
                source_counts[s] = source_counts.get(s, 0) + 1
        cover = (p.get("image_urls") or [None])[0] or p.get("image_url")
        rows.append({
            "post_id": pid,
            "title": p.get("title", ""),
            "user_name": p.get("user_name", ""),
            "image_url": cover,
            "product_slug": p.get("product_slug"),
            "maker_slug": p.get("maker_slug"),
            "post_created_at": p.get("created_at"),
            "views": view_count,
            "clicks": click_count,
            "ctr": round((click_count / view_count) * 100, 1) if view_count else 0,
            "by_source": source_counts,
        })

    return {
        "days": days,
        "rows": rows,
        "totals": {
            "views": sum(r["views"] for r in rows),
            "clicks": sum(r["clicks"] for r in rows),
        },
    }


# ===================== SHOWCASE — multi-image upload (iter114) =====================
SHOWCASE_MAX_IMAGE_BYTES = 8 * 1024 * 1024          # per-file, matches forum
SHOWCASE_ALLOWED_IMG_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif"}


@router.post("/community/showcase/upload")
async def upload_showcase_image(
    file: UploadFile = File(...), claims: dict = Depends(current_buyer),
):
    """Image-only uploader for the showcase form. The frontend calls this
    once per picked file (the picker accepts up to 8) and accumulates the
    returned URLs into `image_urls[]` before POST /community/showcase."""
    await _ensure_user_can_post(claims["sub"])
    from r2_storage import is_configured as r2_ok, upload_bytes
    if not r2_ok():
        raise HTTPException(503, "File uploads are not configured.")
    raw = await file.read()
    size = len(raw)
    mime = (file.content_type or "").lower()
    name = file.filename or "upload"
    ext = ("." + name.rsplit(".", 1)[-1].lower()) if "." in name else ""
    if ext not in SHOWCASE_ALLOWED_IMG_EXT or not mime.startswith("image/"):
        raise HTTPException(400, f"Images only — got '{name}' ({mime or ext or 'unknown'})")
    if size > SHOWCASE_MAX_IMAGE_BYTES:
        raise HTTPException(400, f"Image must be ≤ {SHOWCASE_MAX_IMAGE_BYTES // (1024 * 1024)}MB.")
    key = f"showcase/{claims['sub']}/{uuid.uuid4().hex}{ext}"
    url = upload_bytes(data=raw, key=key, content_type=mime)
    return {"url": url, "filename": name[:120], "size": size}


# ===================== SHOWCASE — AI description help (iter114) =====================
# iter115 — vision upgrade: Claude Haiku 4.5 actually looks at the buyer's
# photos before writing the description. Up to 3 images are downloaded
# and base64-encoded; failures fall back to text-only mode without
# breaking the response.
EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "")
SHOWCASE_AI_VISION_MAX_IMAGES = 3
SHOWCASE_AI_VISION_MAX_BYTES = 4 * 1024 * 1024  # per image, keep payload bounded


async def _fetch_image_for_vision(url: str) -> str | None:
    """Download an image URL → base64 string. Returns None on any failure
    (timeout, oversized, non-image content-type) so the caller can move
    on without aborting the whole request."""
    import base64
    import httpx
    try:
        async with httpx.AsyncClient(timeout=8.0, follow_redirects=True) as client:
            r = await client.get(url)
            if r.status_code != 200:
                logger.info("[showcase_ai] image fetch %s → HTTP %s", url, r.status_code)
                return None
            ctype = (r.headers.get("content-type") or "").lower()
            if not ctype.startswith("image/"):
                logger.info("[showcase_ai] %s is not an image (%s)", url, ctype)
                return None
            blob = r.content
            if len(blob) > SHOWCASE_AI_VISION_MAX_BYTES:
                logger.info("[showcase_ai] %s skipped (%d B > cap)", url, len(blob))
                return None
            return base64.b64encode(blob).decode("ascii")
    except Exception as e:
        logger.info("[showcase_ai] image fetch failed for %s: %s", url, e)
        return None


async def _claude_vision_describe(*, system: str, user_text: str,
                                  image_b64s: list[str]) -> dict | None:
    """One-shot Claude call with optional image attachments. Returns the
    parsed JSON dict or None on any LLM error (caller fails open).
    Uses the playbook-confirmed full model id `claude-haiku-4-5-20251001`
    — the version that supports vision via the universal multimodal path."""
    if not EMERGENT_LLM_KEY:
        return None
    from emergentintegrations.llm.chat import (
        LlmChat, UserMessage, ImageContent,
    )
    from routers.ai_marketing import _parse_json
    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"showcase-{uuid.uuid4().hex[:12]}",
        system_message=system,
    ).with_model("anthropic", "claude-haiku-4-5-20251001")
    msg_kwargs: dict = {"text": user_text[:4000]}
    if image_b64s:
        msg_kwargs["file_contents"] = [ImageContent(image_base64=b) for b in image_b64s]
    try:
        reply = await chat.send_message(UserMessage(**msg_kwargs))
    except Exception as e:
        logger.exception("[showcase_ai] LLM error: %s", e)
        return None
    return _parse_json(reply)


class _ShowcaseAiBody(BaseModel):
    title: str
    image_urls: List[str] = []
    product_slug: Optional[str] = None
    maker_slug: Optional[str] = None


@router.post("/community/showcase/ai-describe")
async def ai_describe_showcase(body: _ShowcaseAiBody, claims: dict = Depends(current_buyer)):
    """Generate a punchy 2-3 sentence showcase description from the title,
    optional product/maker context, AND the actual photos the buyer
    just uploaded. Fail-open: returns `{description: ""}` on any LLM
    error so the UI can fall back to manual entry without a broken state.

    iter115: vision upgrade. Up to 3 images get downloaded + base64-encoded
    and shipped to Claude Haiku 4.5 as `ImageContent`. Image-fetch failures
    are silently dropped so a single broken URL doesn't kill the request."""
    title = (body.title or "").strip()
    if not title:
        raise HTTPException(400, "Title is required to generate a description.")

    # Pull product/maker context if tagged.
    context_lines: list[str] = []
    if body.product_slug:
        p = await db.products.find_one(
            {"slug": body.product_slug},
            {"_id": 0, "title": 1, "category": 1, "description": 1, "maker_name": 1},
        )
        if p:
            context_lines.append(f"Tagged product: {p.get('title','')} "
                                 f"(category: {p.get('category','')}, "
                                 f"maker: {p.get('maker_name','')})")
            if p.get("description"):
                context_lines.append(f"Product description: {p['description'][:400]}")
    if body.maker_slug and not body.product_slug:
        m = await db.makers.find_one(
            {"slug": body.maker_slug},
            {"_id": 0, "name": 1, "tagline": 1, "bio": 1},
        )
        if m:
            context_lines.append(f"Tagged maker: {m.get('name','')} — {m.get('tagline','') or m.get('bio','')[:200]}")

    # Download up to N images concurrently — gather lets one slow URL not
    # serialize the whole batch.
    import asyncio as _asyncio
    image_b64s: list[str] = []
    if body.image_urls:
        results = await _asyncio.gather(
            *[_fetch_image_for_vision(u) for u in body.image_urls[:SHOWCASE_AI_VISION_MAX_IMAGES]],
            return_exceptions=False,
        )
        image_b64s = [r for r in results if r]
        if image_b64s:
            context_lines.append(
                f"Buyer attached {len(body.image_urls)} photo(s); "
                f"the {len(image_b64s)} highest-priority are shown below."
            )

    user_msg = (
        f"Title: {title}\n"
        + ("\n".join(context_lines) if context_lines else "(No additional context provided.)")
        + (
            "\n\nLook carefully at the photos and describe what stands out — "
            "the actual cuts, colors, mounting, lighting, materials. "
            if image_b64s else
            "\n\nWrite a description from the title and context alone "
            "(no photos were attached)."
        )
        + " Write a 2-3 sentence first-person description: where the piece "
          "lives in the buyer's space, what catches the eye, why they love "
          "it. Conversational, not salesy. "
          'Return ONLY a JSON object: {"description": "..."}.'
    )
    system_msg = (
        "You are a concise copywriter helping buyers post about a "
        "hand-built CNC art / wood / metal piece they bought on Crafters Market. "
        "When images are attached, describe what you actually see — concrete "
        "details ground the post and make it feel real. "
        'Respond ONLY with valid JSON: {"description": "..."}. '
        "Keep the description 2-3 sentences, under 280 characters, "
        "warm and authentic, no marketing fluff."
    )
    parsed = await _claude_vision_describe(
        system=system_msg, user_text=user_msg, image_b64s=image_b64s,
    )
    desc = ((parsed or {}).get("description") or "").strip()
    return {
        "description": desc,
        "vision_used": len(image_b64s) > 0,
        "images_seen": len(image_b64s),
    }


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
    rows = await db.design_files.find(
        {"quarantined_at": None},
        {"_id": 0},
    ).sort("created_at", -1).to_list(limit)
    return [_with_quality(r) for r in rows]


@router.get("/community/files/leaderboard")
async def files_leaderboard(limit: int = 10):
    """Top contributors of community design files by upload count + total
    downloads. Public — surfaces who's powering the library so contributors
    get social credit (Etsy "best seller" effect for free shares).
    Returns an array of {handle, display_name, avatar, uploads, downloads,
    score} sorted score desc; score = uploads * 5 + downloads."""
    pipeline = [
        {"$match": {"quarantined_at": None}},
        {"$group": {
            "_id": {
                # Prefer maker_slug when present (maker-uploaded), else
                # fall back to the buyer uploader_id. Bucket label first.
                "key": {"$ifNull": ["$maker_slug", "$uploader_id"]},
                "kind": {"$cond": [{"$ifNull": ["$maker_slug", False]}, "maker", "buyer"]},
                "name": {"$ifNull": ["$maker_name", "$uploader_name"]},
            },
            "uploads": {"$sum": 1},
            "downloads": {"$sum": {"$ifNull": ["$download_count", 0]}},
        }},
        {"$match": {"_id.key": {"$ne": None}}},
        {"$sort": {"uploads": -1}},
        {"$limit": 100},
    ]
    rows = await db.design_files.aggregate(pipeline).to_list(100)
    out = []
    for r in rows:
        key = r["_id"]["key"]
        kind = r["_id"]["kind"]
        display_name = r["_id"].get("name") or key
        avatar = ""
        # Hydrate avatar — makers from `makers.portrait`, buyers from
        # `community_users.avatar` so the leaderboard has real faces.
        if kind == "maker":
            m = await db.makers.find_one({"slug": key}, {"_id": 0, "portrait": 1, "name": 1})
            if m:
                avatar = m.get("portrait", "") or ""
                display_name = m.get("name") or display_name
        else:
            u = await db.community_users.find_one({"id": key}, {"_id": 0, "avatar": 1, "username": 1})
            if u:
                avatar = u.get("avatar", "") or ""
                display_name = u.get("username") or display_name
        score = int(r["uploads"]) * 5 + int(r.get("downloads", 0))
        out.append({
            "handle": key,
            "kind": kind,
            "display_name": display_name,
            "avatar": avatar,
            "uploads": int(r["uploads"]),
            "downloads": int(r.get("downloads", 0)),
            "score": score,
        })
    out.sort(key=lambda x: x["score"], reverse=True)
    return out[: max(1, min(limit, 50))]


# ── Bundle Quality Score ──────────────────────────────────────────────
# Buyers download community files for one reason — to make stuff. So we
# rank bundles on how usable they are, not on aesthetic polish:
#
#   • Visual preview      (thumbnail, auto-generated OR uploaded)  · 25
#   • Context/description (≥60 chars — actually explains the file) · 15
#   • Multi-format bundle (≥2 variants — laser AND CNC etc.)       · 20
#   • Production-ready    (DXF / SVG / STL / DWG / NC present)     · 20
#   • Both 2D AND 3D      (laser AND 3D-printable coverage)        · 20
#
# Tiers: ⭐ Excellent (80+) · Good (60-79) · Basic (40-59) · Incomplete (<40)
PROD_2D = {"dxf", "svg", "ai", "eps", "pdf"}
PROD_3D = {"stl", "obj", "3mf", "step", "stp"}
PROD_CNC = {"dwg", "nc", "tap", "gcode"}
PROD_ALL = PROD_2D | PROD_3D | PROD_CNC


def _compute_quality_score(doc: dict) -> dict:
    """Pure function over a `design_files` doc → `{score, tier, breakdown}`.
    Computed on-the-fly per request so editing a bundle (adding a thumb,
    fleshing out the description) recomputes immediately — no batch job
    or migration needed."""
    formats: set[str] = set()
    if doc.get("file_type"):
        formats.add(str(doc["file_type"]).lower())
    for v in doc.get("variants") or []:
        if v.get("format"):
            formats.add(str(v["format"]).lower())
    desc = (doc.get("description") or "").strip()
    has_thumb = bool(doc.get("thumbnail_url"))
    multi_format = len(formats) >= 2
    prod_ready = bool(formats & PROD_ALL)
    has_2d = bool(formats & PROD_2D)
    has_3d = bool(formats & PROD_3D)
    has_cnc = bool(formats & PROD_CNC)
    coverage_count = sum([has_2d, has_3d, has_cnc])

    breakdown = [
        {"label": "Visual preview",     "earned": has_thumb,                      "points": 25, "hint": "Add a thumbnail or generate one with the STL/DXF auto-render."},
        {"label": "Context",            "earned": len(desc) >= 60,                "points": 15, "hint": "Describe the design in 60+ chars (size, intended use, materials)."},
        {"label": "Multi-format",       "earned": multi_format,                   "points": 20, "hint": "Add format variants (DXF + SVG, STL + STEP, etc.)."},
        {"label": "Production-ready",   "earned": prod_ready,                     "points": 20, "hint": "Include at least one CNC/laser/3D-print-ready format (DXF, SVG, STL, DWG, NC)."},
        {"label": "2D + 3D coverage",   "earned": coverage_count >= 2,            "points": 20, "hint": "Cover both 2D (laser/CNC) and 3D (STL/STEP) workflows for max reach."},
    ]
    score = sum(b["points"] for b in breakdown if b["earned"])
    if score >= 80:
        tier = "excellent"
    elif score >= 60:
        tier = "good"
    elif score >= 40:
        tier = "basic"
    else:
        tier = "incomplete"
    return {"score": score, "tier": tier, "breakdown": breakdown}


def _with_quality(doc: dict) -> dict:
    """Inject `quality` into a design_file response payload."""
    if not doc:
        return doc
    doc = dict(doc)
    doc["quality"] = _compute_quality_score(doc)
    return doc


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
    files: List[UploadFile] = File(...),
    title: str = Form(...),
    description: str = Form(...),
    thumbnail_url: str = Form(""),
    claims: dict = Depends(current_any_user),
):
    """Direct file upload for the community design-file library.

    Multi-format bundles: pass 1+ files in a single request. The first
    file becomes the **primary** (back-compat: `file_type` + `download_url`
    keep their classic single-file meaning). Every additional file lands
    in the `variants[]` array. Typical maker bundle for one design:
    ``hero.jpg`` + ``model.stl`` + ``cut.dxf`` + ``preview.svg`` +
    ``program.gcode`` — all attached to one community card.

    Any signed-in community user (buyer OR maker) can post a design file.
    Files are uploaded to R2 under
    ``community-files/<user>/<uuid>.<ext>``, then a `design_files` row is
    created with the resolved public URLs. The existing URL-paste
    endpoint (`POST /community/files`) is kept for makers who host on
    Dropbox/Drive.
    """
    title = (title or "").strip()
    description = (description or "").strip()
    if not title or len(title) > 120:
        raise HTTPException(400, "Title is required (max 120 chars).")
    if not description or len(description) > 800:
        raise HTTPException(400, "Description is required (max 800 chars).")
    if not files:
        raise HTTPException(400, "At least one file is required.")
    if len(files) > 10:
        raise HTTPException(400, "At most 10 format variants per design.")

    from r2_storage import is_configured as r2_ok, upload_design_file_bytes
    if not r2_ok():
        raise HTTPException(503, "File uploads are not configured.")

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

    uploaded = []
    seen_exts: set[str] = set()
    for idx, f in enumerate(files):
        raw = await f.read()
        if not raw:
            raise HTTPException(400, f"File '{f.filename or idx}' is empty.")
        try:
            url, ext = upload_design_file_bytes(
                raw,
                key_prefix=f"community-files/{uploader_label}",
                filename=f.filename,
                content_type=f.content_type or "",
            )
        except ValueError as e:
            raise HTTPException(400, f"{f.filename or 'file'}: {e}")
        # Reject duplicate format variants — one row per format keeps the
        # download dropdown clean. Re-uploading the same format should go
        # through the dedicated PATCH endpoint instead.
        if ext.lower() in seen_exts:
            raise HTTPException(400, f"Duplicate format '{ext}' in this bundle. Each format may appear once.")
        seen_exts.add(ext.lower())
        uploaded.append({
            "format": ext,           # e.g. "STL", "DXF", "JPG"
            "url": url,
            "filename": (f.filename or "").strip()[:200] or None,
            "size_bytes": len(raw),
            "uploaded_at": now_iso(),
        })

    primary = uploaded[0]
    variants = uploaded[1:]  # may be empty for single-file uploads

    # Auto-thumbnail: if the user didn't supply one and the bundle has a
    # raster image (jpg/png/webp), promote it to thumbnail so cards look
    # right out of the gate.
    auto_thumb = None
    for v in uploaded:
        if v["format"].lower() in ("jpg", "jpeg", "png", "webp"):
            auto_thumb = v["url"]
            break

    doc = {
        "id": str(uuid.uuid4()),
        "maker_slug": uploader_label if role == "maker" else None,
        "uploader_role": role,
        "uploader_id": user_key,
        "maker_name": uploader_name,  # kept for back-compat with existing UI
        "title": title[:120],
        "description": description[:800],
        "file_type": primary["format"],
        "download_url": primary["url"],
        "thumbnail_url": (thumbnail_url or "").strip()[:600] or auto_thumb,
        "variants": variants,
        "downloads": 0,
        "size_bytes": primary["size_bytes"],
        "created_at": now_iso(),
    }
    await db.design_files.insert_one(doc)
    doc.pop("_id", None)
    return _with_quality(doc)


def _is_design_file_owner(doc: dict, claims: dict) -> bool:
    """Strict ownership check for design-file mutations.

    Pre-iter68 versions had a buggy `role != "maker" and uploader_id != sub`
    test that let ANY maker mutate ANY other maker's bundle (the test
    agent caught this on the /convert endpoint in iter67). The fix:
    require an exact slug/sub match — admins go through admin endpoints.
    """
    sub = claims.get("sub", "")
    if not sub:
        return False
    # Maker-uploaded bundle: maker_slug must match the JWT subject (slug).
    if doc.get("maker_slug"):
        return doc["maker_slug"] == sub
    # Buyer-uploaded bundle: uploader_id must match the JWT subject.
    return doc.get("uploader_id") == sub


@router.post("/community/files/{file_id}/variants")
async def add_design_file_variants(
    file_id: str,
    files: List[UploadFile] = File(...),
    claims: dict = Depends(current_any_user),
):
    """Append additional format variants to an existing design bundle.
    Only the original uploader can add (admins use admin endpoints)."""
    doc = await db.design_files.find_one({"id": file_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Design file not found.")

    if not _is_design_file_owner(doc, claims):
        raise HTTPException(403, "You can only add variants to your own uploads.")

    from r2_storage import is_configured as r2_ok, upload_design_file_bytes
    if not r2_ok():
        raise HTTPException(503, "File uploads are not configured.")

    existing_variants = doc.get("variants") or []
    seen_exts = {v.get("format", "").lower() for v in existing_variants}
    seen_exts.add((doc.get("file_type") or "").lower())

    new_variants = []
    uploader_label = doc.get("maker_slug") or doc.get("uploader_id") or "user"
    for f in files:
        raw = await f.read()
        if not raw:
            continue
        try:
            url, ext = upload_design_file_bytes(
                raw,
                key_prefix=f"community-files/{uploader_label}",
                filename=f.filename,
                content_type=f.content_type or "",
            )
        except ValueError as e:
            raise HTTPException(400, f"{f.filename or 'file'}: {e}")
        if ext.lower() in seen_exts:
            raise HTTPException(409, f"Format '{ext}' is already attached to this design. Delete it first to replace.")
        seen_exts.add(ext.lower())
        new_variants.append({
            "format": ext,
            "url": url,
            "filename": (f.filename or "").strip()[:200] or None,
            "size_bytes": len(raw),
            "uploaded_at": now_iso(),
        })

    if new_variants:
        await db.design_files.update_one(
            {"id": file_id},
            {"$push": {"variants": {"$each": new_variants}}},
        )
    return {"ok": True, "added": new_variants}


@router.delete("/community/files/{file_id}/variants/{fmt}")
async def delete_design_file_variant(
    file_id: str, fmt: str,
    claims: dict = Depends(current_any_user),
):
    """Remove a single format variant from a design bundle. The primary
    file (file_type / download_url) cannot be removed via this endpoint
    — delete the whole bundle if you need that."""
    doc = await db.design_files.find_one({"id": file_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Design file not found.")

    if not _is_design_file_owner(doc, claims):
        raise HTTPException(403, "You can only edit your own uploads.")

    fmt_norm = fmt.upper()
    if (doc.get("file_type") or "").upper() == fmt_norm:
        raise HTTPException(400, "Cannot remove the primary file via this endpoint.")

    r = await db.design_files.update_one(
        {"id": file_id},
        {"$pull": {"variants": {"format": fmt_norm}}},
    )
    if r.modified_count == 0:
        raise HTTPException(404, f"No '{fmt_norm}' variant found on this design.")
    return {"ok": True, "removed": fmt_norm}


@router.post("/community/files/{file_id}/convert/dxf-to-svg")
async def convert_dxf_to_svg(
    file_id: str,
    claims: dict = Depends(current_any_user),
):
    """Generate an SVG preview from a DXF in this bundle and append it
    as a new variant. Used to enrich uploads that arrived as DXF-only.

    Auth: same rule as variant management — uploader OR any maker.
    Idempotency: if the bundle already has an SVG (primary or variant),
    we return 409 to avoid silent overwrites.
    """
    doc = await db.design_files.find_one({"id": file_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Design file not found.")

    if not _is_design_file_owner(doc, claims):
        raise HTTPException(403, "You can only convert your own uploads.")

    # Already has an SVG anywhere in the bundle? short-circuit.
    primary_fmt = (doc.get("file_type") or "").upper()
    variant_fmts = {(v.get("format") or "").upper() for v in (doc.get("variants") or [])}
    if primary_fmt == "SVG" or "SVG" in variant_fmts:
        raise HTTPException(409, "This bundle already has an SVG variant.")

    # Find the DXF source. Prefer primary; fall back to the first DXF
    # variant. If neither exists, this design isn't a candidate.
    src_url = None
    if primary_fmt == "DXF":
        src_url = doc.get("download_url")
    else:
        for v in (doc.get("variants") or []):
            if (v.get("format") or "").upper() == "DXF":
                src_url = v.get("url")
                break
    if not src_url:
        raise HTTPException(400, "No DXF in this bundle to convert.")

    # Fetch the DXF bytes from R2 (URL is public). httpx is already a dep.
    import httpx
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(src_url)
            resp.raise_for_status()
            dxf_bytes = resp.content
    except Exception as e:
        raise HTTPException(502, f"Couldn't fetch source DXF: {e}")

    # Convert in a thread executor — ezdxf is CPU-bound and may take a
    # few seconds on a large drawing; keeping it off the event loop
    # avoids blocking other requests.
    import asyncio
    from dxf_converter import convert_dxf_bytes_to_svg
    try:
        svg_bytes = await asyncio.to_thread(convert_dxf_bytes_to_svg, dxf_bytes)
    except ValueError as e:
        # The raw ezdxf message can be cryptic (e.g. "DXFTagError: ..."). Map
        # the common parse-failure case to friendlier copy; keep the rendering
        # message verbatim because that's actually useful (which entity blew up).
        msg = str(e)
        if msg.startswith("Couldn't parse DXF:"):
            msg = "This DXF appears corrupted or is in an unsupported variant. Try re-exporting from your CAD tool as DXF R2010 or newer."
        # All other ValueError messages from the converter (empty
        # bounding box → friendly hint, paperspace fallback exhaustion,
        # near-empty SVG output) are already user-facing — let them
        # through verbatim.
        raise HTTPException(422, msg)

    # Upload the SVG to R2 under the same uploader prefix.
    from r2_storage import upload_design_file_bytes
    uploader_label = doc.get("maker_slug") or doc.get("uploader_id") or "user"
    try:
        url, ext = upload_design_file_bytes(
            svg_bytes,
            key_prefix=f"community-files/{uploader_label}",
            filename=f"{doc.get('id')}-auto.svg",
            content_type="image/svg+xml",
        )
    except ValueError as e:
        raise HTTPException(500, f"Couldn't store generated SVG: {e}")

    new_variant = {
        "format": ext,                  # "SVG"
        "url": url,
        "filename": f"{doc.get('title','design')[:60]}.svg",
        "size_bytes": len(svg_bytes),
        "uploaded_at": now_iso(),
        "auto_generated": True,         # flag for UI ("✦ generated") if we want it later
        "source_format": "DXF",
    }
    await db.design_files.update_one(
        {"id": file_id},
        {"$push": {"variants": new_variant}},
    )
    logger.info("[dxf2svg] generated variant for file_id=%s size=%dB", file_id, len(svg_bytes))
    return {"ok": True, "variant": new_variant}


@router.post("/community/files/{file_id}/render/stl-thumbnail")
async def render_stl_thumbnail(
    file_id: str,
    claims: dict = Depends(current_any_user),
):
    """Render a PNG thumbnail from an STL in this bundle and stamp it
    on `thumbnail_url`. Same auth + idempotency pattern as DXF→SVG.

    Idempotency: 409 if the bundle already has a thumbnail_url AND
    the maker is requesting a regeneration without `?force=true`. We
    keep this simple for now (no force flag) — UI prompt only appears
    when thumbnail is missing.
    """
    doc = await db.design_files.find_one({"id": file_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Design file not found.")
    if not _is_design_file_owner(doc, claims):
        raise HTTPException(403, "You can only render thumbnails for your own uploads.")
    if doc.get("thumbnail_url"):
        raise HTTPException(409, "This bundle already has a thumbnail.")

    # Find the STL source (primary or first STL variant).
    primary_fmt = (doc.get("file_type") or "").upper()
    src_url = doc.get("download_url") if primary_fmt == "STL" else None
    if not src_url:
        for v in (doc.get("variants") or []):
            if (v.get("format") or "").upper() == "STL":
                src_url = v.get("url")
                break
    if not src_url:
        raise HTTPException(400, "No STL in this bundle to render.")

    # Fetch + render off the event loop (matplotlib is CPU-heavy).
    import httpx
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(src_url)
            resp.raise_for_status()
            stl_bytes = resp.content
    except Exception as e:
        raise HTTPException(502, f"Couldn't fetch source STL: {e}")

    import asyncio
    from stl_renderer import render_stl_to_png
    try:
        png_bytes = await asyncio.to_thread(render_stl_to_png, stl_bytes)
    except ValueError as e:
        msg = str(e)
        if msg.startswith("Couldn't parse STL:"):
            msg = "This STL appears corrupted or unreadable. Try re-exporting from your slicer."
        raise HTTPException(422, msg)

    from r2_storage import upload_design_file_bytes
    uploader_label = doc.get("maker_slug") or doc.get("uploader_id") or "user"
    try:
        url, _ext = upload_design_file_bytes(
            png_bytes,
            key_prefix=f"community-files/{uploader_label}",
            filename=f"{doc.get('id')}-thumbnail.png",
            content_type="image/png",
        )
    except ValueError as e:
        raise HTTPException(500, f"Couldn't store generated thumbnail: {e}")

    await db.design_files.update_one(
        {"id": file_id},
        {"$set": {"thumbnail_url": url, "thumbnail_auto_generated": True}},
    )
    logger.info("[stl2png] generated thumbnail for file_id=%s size=%dB", file_id, len(png_bytes))
    return {"ok": True, "thumbnail_url": url, "size_bytes": len(png_bytes)}



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
