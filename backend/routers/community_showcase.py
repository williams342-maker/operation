"""Community showcase: buyer + maker photo/video posts, analytics, AI describe.

Carved out of `routers/community.py` (Feb 2026 refactor).

Surfaces:
  • Public list + recent feed (homepage + product-page strip)
  • Buyer/maker post creation with image/video uploads
  • Like + view + click analytics events
  • Admin analytics aggregation
  • Claude Haiku 4.5 vision-assisted description writer
"""
import base64
import hashlib
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import List, Optional

import httpx
from fastapi import (
    APIRouter, Body, Depends, File, HTTPException, Request, UploadFile,
)
from pydantic import BaseModel

from core import db, logger, now_iso
from maker_auth import current_admin, current_any_user, current_buyer

from .community_common import _ensure_user_can_post

router = APIRouter()


# ===================== MODELS =====================
class ShowcasePost(BaseModel):
    title: str
    description: str
    # iter114 — multi-image showcase. New posts populate `image_urls`;
    # `image_url` is kept for backwards compat with the existing card UI
    # (it always holds image_urls[0] when present).
    image_url: Optional[str] = None
    image_urls: List[str] = []
    # Feb 2026 — optional maker-uploaded video clip (≤50 MB, ≤60 s).
    # When set, showcase cards render a <video> element in place of the
    # image carousel. The first image (if any) is used as the poster.
    video_url: Optional[str] = None
    product_slug: Optional[str] = None
    maker_slug: Optional[str] = None


# ===================== LISTING =====================
@router.get("/community/showcase")
async def list_showcase(limit: int = 50):
    return await db.showcase_posts.find({}, {"_id": 0}).sort("created_at", -1).to_list(limit)


@router.get("/community/showcase/recent")
async def list_recent_showcase(
    limit: int = 4,
    product_slug: Optional[str] = None,
    maker_slug: Optional[str] = None,
    strict: bool = False,
):
    """Public, no-auth, lightweight feed for the homepage + product-page
    'Recently shared by buyers' strip (iter116). Prefers posts tagged with
    the requested product or maker; falls back to general newest-first
    when nothing is tagged or the tagged feed is too thin to render a
    full row.

    `strict=true` disables the newest-first fallback — used by maker
    profile pages where showing another maker's work would be confusing.
    """
    try:
        n = int(limit) if limit is not None else 4
    except (TypeError, ValueError):
        n = 4
    limit = max(1, min(n, 12))
    proj = {
        "_id": 0, "id": 1, "title": 1,
        "image_url": 1, "image_urls": 1, "video_url": 1,
        "product_slug": 1, "maker_slug": 1,
        "user_name": 1, "user_picture": 1, "user_role": 1,
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

    if len(rows) < limit and not strict:
        more = await _query({"id": {"$nin": list(seen_ids)}}, limit - len(rows))
        rows.extend(more)

    return {"items": rows[:limit], "count": len(rows[:limit])}


@router.post("/community/showcase")
async def create_showcase(post: ShowcasePost, claims: dict = Depends(current_any_user)):
    """Create a showcase post. Accepts buyer OR maker JWTs.
    Buyers post photos of items they bought (original surface).
    Makers post photos + optional video clips of work in their shop.

    The user-attribution fields (`user_email/name/picture`) are sourced
    from `community_users` for buyers and from `makers` for makers so
    the card renders identically regardless of who posted."""
    role = claims.get("role")
    if role == "maker":
        maker = await db.makers.find_one(
            {"slug": claims["sub"]},
            {"_id": 0, "email": 1, "name": 1, "shop_name": 1, "portrait": 1, "slug": 1},
        )
        if not maker:
            raise HTTPException(404, "Maker not found.")
        user_email = maker.get("email", "")
        user_name = maker.get("shop_name") or maker.get("name", "")
        user_picture = maker.get("portrait", "")
        user_id_for_doc = f"maker:{maker['slug']}"
        if not post.maker_slug:
            post.maker_slug = maker["slug"]
    else:
        user = await db.community_users.find_one({"user_id": claims["sub"]}, {"_id": 0})
        if not user:
            raise HTTPException(404, "User not found")
        user_email = user["email"]
        user_name = user.get("name", "")
        user_picture = user.get("picture", "")
        user_id_for_doc = claims["sub"]

    payload = post.model_dump()
    urls = list(payload.get("image_urls") or [])
    if payload.get("image_url") and payload["image_url"] not in urls:
        urls.insert(0, payload["image_url"])
    has_video = bool(payload.get("video_url"))
    if not urls and not has_video:
        raise HTTPException(400, "Add at least one image — or a video clip.")
    if has_video and role != "maker":
        # Defence in depth — only makers can attach videos via upload-video,
        # but reject any buyer attempt to post a `video_url` directly.
        raise HTTPException(403, "Video clips are a maker-only feature for now.")
    urls = urls[:8]
    payload["image_urls"] = urls
    payload["image_url"] = urls[0] if urls else None

    doc = {
        "id": str(uuid.uuid4()),
        "user_id": user_id_for_doc,
        "user_email": user_email,
        "user_name": user_name,
        "user_picture": user_picture,
        "user_role": role,
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
class _ShowcaseEventBody(BaseModel):
    source: Optional[str] = None


async def _record_showcase_event(post_id: str, kind: str, source: Optional[str], request: Request):
    """Insert one event row + bump the denormalized counter on the post."""
    if kind not in ("view", "click"):
        return False
    post = await db.showcase_posts.find_one({"id": post_id}, {"_id": 0, "id": 1})
    if not post:
        return False
    raw_ip = (request.client.host if request.client else "") + (request.headers.get("user-agent") or "")
    fingerprint = hashlib.sha1(raw_ip.encode("utf-8", "ignore")).hexdigest()[:16]
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=30)).isoformat()
    recent = await db.showcase_events.find_one({
        "post_id": post_id, "kind": kind,
        "fingerprint": fingerprint,
        "created_at": {"$gte": cutoff},
    }, {"_id": 0, "post_id": 1})
    if recent:
        return True
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
    """Public — fired by `RecentShowcaseStrip` when a tile becomes visible."""
    ok = await _record_showcase_event(post_id, "view", body.source, request)
    return {"ok": ok}


@router.post("/community/showcase/{post_id}/click")
async def record_showcase_click(post_id: str, request: Request,
                                 body: _ShowcaseEventBody = Body(default=_ShowcaseEventBody())):
    """Public — fired when a buyer clicks a strip tile."""
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
    try:
        d = int(days) if days is not None else 7
        n = int(limit) if limit is not None else 10
    except (TypeError, ValueError):
        d, n = 7, 10
    days = max(1, min(d, 90))
    limit = max(1, min(n, 50))
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()

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
            continue
        view_count = v["n"]
        click_count = clicks_by_id.get(pid, 0)
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


# ===================== SHOWCASE — image + video upload =====================
SHOWCASE_MAX_IMAGE_BYTES = 8 * 1024 * 1024
SHOWCASE_ALLOWED_IMG_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif"}

# Maker video clips (Feb 2026). 50 MB cap matches a ~60s 1080p H.264 export.
SHOWCASE_MAX_VIDEO_BYTES = 50 * 1024 * 1024
SHOWCASE_ALLOWED_VIDEO_EXT = {".mp4", ".webm", ".mov", ".m4v"}
SHOWCASE_ALLOWED_VIDEO_MIME = {
    "video/mp4", "video/webm", "video/quicktime", "video/x-m4v",
}


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


@router.post("/community/showcase/upload-video")
async def upload_showcase_video(
    file: UploadFile = File(...), claims: dict = Depends(current_any_user),
):
    """Maker-only video clip uploader for the showcase form. One clip per
    showcase post — the returned URL is stored in `ShowcasePost.video_url`.

    50 MB cap. Allowed: .mp4, .webm, .mov, .m4v. We don't transcode and we
    don't enforce duration server-side — the size cap is a hard backstop
    against multi-minute uploads. The client trims to 60s before upload
    when supported by the browser/media-recorder API."""
    if claims.get("role") != "maker":
        raise HTTPException(403, "Maker access required for video uploads.")
    from r2_storage import is_configured as r2_ok, upload_bytes
    if not r2_ok():
        raise HTTPException(503, "File uploads are not configured.")
    raw = await file.read()
    size = len(raw)
    mime = (file.content_type or "").lower()
    name = file.filename or "upload"
    ext = ("." + name.rsplit(".", 1)[-1].lower()) if "." in name else ""
    if ext not in SHOWCASE_ALLOWED_VIDEO_EXT:
        raise HTTPException(400, f"Allowed formats: mp4, webm, mov, m4v — got '{name}'.")
    if mime and mime not in SHOWCASE_ALLOWED_VIDEO_MIME:
        if not mime.startswith("video/") and mime != "application/octet-stream":
            raise HTTPException(400, f"Video files only — got '{mime}'.")
    if size > SHOWCASE_MAX_VIDEO_BYTES:
        raise HTTPException(400, f"Clip must be ≤ {SHOWCASE_MAX_VIDEO_BYTES // (1024 * 1024)}MB.")
    served_mime = (
        mime if mime in SHOWCASE_ALLOWED_VIDEO_MIME
        else {"mp4": "video/mp4", "m4v": "video/x-m4v", "webm": "video/webm",
              "mov": "video/quicktime"}.get(ext.lstrip("."), "video/mp4")
    )
    key = f"showcase/videos/{claims['sub']}/{uuid.uuid4().hex}{ext}"
    url = upload_bytes(
        data=raw, key=key, content_type=served_mime,
        max_bytes=SHOWCASE_MAX_VIDEO_BYTES,
    )
    return {"url": url, "filename": name[:120], "size": size, "mime": served_mime}


# ===================== SHOWCASE — AI description help (iter114) =====================
EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "")
SHOWCASE_AI_VISION_MAX_IMAGES = 3
SHOWCASE_AI_VISION_MAX_BYTES = 4 * 1024 * 1024


async def _fetch_image_for_vision(url: str) -> str | None:
    """Download an image URL → base64 string. Returns None on any failure
    (timeout, oversized, non-image content-type) so the caller can move
    on without aborting the whole request."""
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
    """
    title = (body.title or "").strip()
    if not title:
        raise HTTPException(400, "Title is required to generate a description.")

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
