"""
Clip feed — TikTok-style short-form workshop videos.

Collection schema (`clips`):
  id (str, uuid)
  slug (str)                     — URL-safe, derived from title
  maker_slug (str | None)        — None for AI-seeded / workshop clips
  maker_name (str)               — display byline ("CRAFTERS MARKET WORKSHOP TEAM" for seeds)
  uploader_email (str | None)    — if a buyer / community user uploaded, who
  title (str)
  description (str)
  category (str)                 — one of CATEGORIES below
  tags (list[str])
  source_type (str)              — "youtube" | "vimeo" | "r2"
  source_id (str | None)         — YouTube / Vimeo video ID
  video_url (str)                — embed URL (YT/Vimeo) or R2 public URL (mp4)
  poster_url (str | None)        — thumbnail (full-bleed)
  duration_seconds (int)
  product_slug (str | None)      — optional "shop this" deep-link
  views (int)
  likes (int)
  saves (int)
  shares (int)
  is_seed (bool)
  ai_generated (bool)
  ai_model (str | None)          — e.g. "sora-2"
  quarantined_at (str | None)
  created_at (str)               — iso

Engagement is denormalized into per-user docs (`clip_engagement`) so we
can answer "did I like this?" in O(1) without scanning the whole counter.
"""
from __future__ import annotations

import re
import uuid
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from core import db, logger, now_iso
from maker_auth import current_any_user, current_maker_slug

# Reuse the maker's URL-parser so YouTube/Vimeo embeds work the same way
# across both surfaces.
from routers.maker_workshop_videos import parse_video_url

router = APIRouter()

CATEGORIES = [
    # iter344 — Broadened from 6 industrial-skewed categories to 16 covering
    # the full handmade-craft spectrum (matches `clip_seeder.PROMPTS`).
    # Original 6 kept first so legacy clips and their counts stay grouped
    # the same way in the feed.
    {"id": "workshop",      "label": "Workshop clips",    "emoji": "◆"},
    {"id": "cuts",          "label": "Satisfying cuts",   "emoji": "✕"},
    {"id": "welding",       "label": "Welding sparks",    "emoji": "⚡"},
    {"id": "powder-coat",   "label": "Powder coating",    "emoji": "▣"},
    {"id": "engraving",     "label": "Engraving",         "emoji": "✎"},
    {"id": "before-after",  "label": "Before / after",    "emoji": "↺"},
    {"id": "textiles",      "label": "Textiles & fiber",  "emoji": "✦"},
    {"id": "pottery",       "label": "Pottery & ceramics", "emoji": "◍"},
    {"id": "jewelry",       "label": "Jewelry",           "emoji": "◇"},
    {"id": "leather",       "label": "Leatherwork",       "emoji": "▰"},
    {"id": "candles-soap",  "label": "Candles & soap",    "emoji": "❋"},
    {"id": "glass",         "label": "Glass",             "emoji": "❖"},
    {"id": "knife-making",  "label": "Knife making",      "emoji": "▲"},
    {"id": "paper",         "label": "Paper & print",     "emoji": "▤"},
    {"id": "resin",         "label": "Resin",             "emoji": "◐"},
    {"id": "florals",       "label": "Florals & botanicals", "emoji": "✿"},
]
VALID_CATEGORIES = {c["id"] for c in CATEGORIES}
MAX_TITLE = 120
MAX_DESC = 600

# Founding-50 maker incentive: every brand-new organic clip is automatically
# promoted to `featured: true` until 50 such clips have been posted.
# `featured` clips render above non-featured ones inside their recency window
# and carry a small star badge in the UI. Once we hit the cap the feature
# quietly stops auto-flagging — older Featured rows keep their badge.
FOUNDING_FEATURED_CAP = 50


async def _organic_clip_count() -> int:
    """Count non-seed, non-quarantined clips — the universe for the
    Founding-50 Featured slot incentive."""
    return await db.clips.count_documents({
        "is_seed": {"$ne": True},
        "quarantined_at": None,
    })


async def _featured_clip_count() -> int:
    return await db.clips.count_documents({
        "featured": True,
        "is_seed": {"$ne": True},
        "quarantined_at": None,
    })


# iter218 + iter225 — Orphan-seed guard.
#
# Original iter218 design: a seed clip is "live" only when it carries
# `file_verified: True` (set by clip_seeder.generate_one_clip after the
# MP4 has actually landed on disk with non-zero size) OR points to an
# external `http(s)://` URL (no local file dependency).
#
# iter225 hardening: `file_verified` was set at *seed time* against the
# local pod's filesystem — but the pod's `/app/frontend/public/seed-clips/`
# is ephemeral. A restart, redeploy, or pod migration wipes the MP4
# while the DB row still claims `file_verified: True`. Result: clip
# appears in the feed but the browser hits 404 on `/seed-clips/.../clip.mp4`
# → black video panel on craftersmarket.org (user-reported, 2026-05-25).
#
# Hardened policy: seed clips MUST point at an `http(s)://` URL (R2 CDN
# or external embed) to clear the guard. Local `/seed-clips/...` paths
# are treated as orphans — even if `file_verified=True`. The new
# clip_seeder uploads to R2 so this is the steady state going forward.
# Legacy local-path rows get caught by the purge-orphans endpoint.
def _orphan_guard() -> dict:
    return {
        "$or": [
            # Organic maker uploads (no seed flag) — never gated.
            {"is_seed": {"$ne": True}},
            # Seeds whose video_url is an absolute http(s) URL — these
            # include R2-uploaded seed clips and YouTube/Vimeo embeds.
            # `file_verified` no longer matters once we've left the
            # ephemeral local filesystem behind.
            {"is_seed": True, "video_url": {"$regex": "^https?://"}},
        ]
    }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _slugify(t: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (t or "").lower()).strip("-")[:80]
    return s or f"clip-{uuid.uuid4().hex[:8]}"


async def _unique_slug(base: str) -> str:
    c = base
    n = 1
    while await db.clips.find_one({"slug": c}, {"_id": 0, "slug": 1}):
        n += 1
        c = f"{base}-{n}"
    return c


def _public_row(doc: dict, viewer_email: Optional[str] = None) -> dict:
    """Strip mongo `_id`, attach `i_liked` / `i_saved` flags for the
    signed-in viewer when present."""
    out = {k: v for k, v in doc.items() if k != "_id"}
    out["i_liked"] = False
    out["i_saved"] = False
    return out


async def _annotate_engagement(rows: list[dict], viewer_email: Optional[str]) -> list[dict]:
    """One DB round-trip to flip `i_liked` / `i_saved` for the viewer."""
    if not viewer_email or not rows:
        return rows
    ids = [r["id"] for r in rows]
    cursor = db.clip_engagement.find(
        {"user_email": viewer_email, "clip_id": {"$in": ids},
         "action": {"$in": ["like", "save"]}},
        {"_id": 0, "clip_id": 1, "action": 1},
    )
    by_clip: dict[str, set] = {}
    async for d in cursor:
        by_clip.setdefault(d["clip_id"], set()).add(d["action"])
    for r in rows:
        s = by_clip.get(r["id"], set())
        r["i_liked"] = "like" in s
        r["i_saved"] = "save" in s
    return rows


# ---------------------------------------------------------------------------
# Public feed
# ---------------------------------------------------------------------------
@router.get("/clips/categories")
async def list_categories():
    """Static category list with live counts. Counts skip quarantined rows."""
    counts: dict[str, int] = {}
    pipeline = [
        {"$match": {"quarantined_at": None, **_orphan_guard()}},
        {"$group": {"_id": "$category", "n": {"$sum": 1}}},
    ]
    async for row in db.clips.aggregate(pipeline):
        counts[row["_id"]] = row["n"]
    total = sum(counts.values())
    return {
        "categories": [{**c, "count": counts.get(c["id"], 0)} for c in CATEGORIES],
        "total": total,
    }


@router.get("/clips/incentive-status")
async def incentive_status():
    """Founding-50 Featured slot status — drives the empty-state banner on
    /clips and the maker dashboard upload card.

    Once we hit `FOUNDING_FEATURED_CAP` featured organic clips, `claimed`
    flips to true and the banner switches to a "thanks for joining"
    success state."""
    featured = await _featured_clip_count()
    organic = await _organic_clip_count()
    return {
        "slots_total": FOUNDING_FEATURED_CAP,
        "slots_used": featured,
        "slots_remaining": max(0, FOUNDING_FEATURED_CAP - featured),
        "organic_clips_total": organic,
        "claimed": featured >= FOUNDING_FEATURED_CAP,
    }


@router.get("/clips/feed")
async def feed(
    category: Optional[str] = Query(None),
    cursor: Optional[str] = Query(None, description="ISO created_at — fetch older than this"),
    limit: int = Query(12, ge=1, le=40),
    authorization: Optional[str] = None,
):
    """Paginated feed, newest first. Cursor = ISO `created_at` of the
    oldest clip in the previous page. No auth required, but if a JWT is
    present we annotate `i_liked` / `i_saved` so the UI renders the
    correct heart state immediately."""
    q: dict = {"quarantined_at": None, **_orphan_guard()}
    if category:
        if category not in VALID_CATEGORIES:
            raise HTTPException(400, f"Unknown category {category}")
        q["category"] = category
    if cursor:
        q["created_at"] = {"$lt": cursor}

    rows: list[dict] = []
    # Pure chronological sort — cursor pagination relies on `created_at`
    # being monotonic. Featured clips earn a star badge in the UI instead
    # of priority placement, which keeps pagination correctness.
    async for d in db.clips.find(q, {"_id": 0}).sort("created_at", -1).limit(limit):
        rows.append(_public_row(d))

    # Try to read JWT — optional. If it's valid, annotate i_liked/i_saved.
    viewer_email: Optional[str] = None
    if authorization and authorization.lower().startswith("bearer "):
        try:
            from maker_auth import decode_session_jwt
            claims = decode_session_jwt(authorization.split(" ", 1)[1].strip())
            viewer_email = (claims.get("email") or "").lower() or None
        except Exception:
            viewer_email = None
    await _annotate_engagement(rows, viewer_email)

    next_cursor = rows[-1]["created_at"] if len(rows) == limit else None
    return {"items": rows, "next_cursor": next_cursor}


@router.get("/clips/{slug}")
async def get_clip(slug: str, authorization: Optional[str] = None):
    doc = await db.clips.find_one(
        {"slug": slug, "quarantined_at": None, **_orphan_guard()},
        {"_id": 0},
    )
    if not doc:
        raise HTTPException(404, "Clip not found.")
    viewer_email: Optional[str] = None
    if authorization and authorization.lower().startswith("bearer "):
        try:
            from maker_auth import decode_session_jwt
            claims = decode_session_jwt(authorization.split(" ", 1)[1].strip())
            viewer_email = (claims.get("email") or "").lower() or None
        except Exception:
            viewer_email = None
    rows = await _annotate_engagement([_public_row(doc)], viewer_email)
    return rows[0]


# ---------------------------------------------------------------------------
# Engagement — views are anonymous, like/save require auth, share is anon
# ---------------------------------------------------------------------------
@router.post("/clips/{clip_id}/view")
async def record_view(clip_id: str):
    """Atomic counter bump on impression. Public — we trust the client
    not to spam, but the impact is purely cosmetic so OK to be loose.
    Anonymous (no engagement row written) — `views` is just a counter."""
    r = await db.clips.update_one(
        {"id": clip_id, "quarantined_at": None},
        {"$inc": {"views": 1}},
    )
    if r.matched_count == 0:
        raise HTTPException(404, "Clip not found.")
    return {"ok": True}


@router.post("/clips/{clip_id}/share")
async def record_share(clip_id: str):
    """Cosmetic share counter — fires from any of the share buttons.
    Anonymous because the platform of the share isn't bound to a user."""
    r = await db.clips.update_one(
        {"id": clip_id, "quarantined_at": None},
        {"$inc": {"shares": 1}},
    )
    if r.matched_count == 0:
        raise HTTPException(404, "Clip not found.")
    return {"ok": True}


async def _toggle_engagement(clip_id: str, email: str, action: str) -> dict:
    """Toggle a like / save. Returns the new state ({on: bool, count: int})."""
    if action not in ("like", "save"):
        raise HTTPException(400, "Unknown action.")
    counter_field = "likes" if action == "like" else "saves"
    clip = await db.clips.find_one(
        {"id": clip_id, "quarantined_at": None},
        {"_id": 0, "id": 1},
    )
    if not clip:
        raise HTTPException(404, "Clip not found.")

    existing = await db.clip_engagement.find_one(
        {"user_email": email, "clip_id": clip_id, "action": action},
        {"_id": 0, "user_email": 1},
    )
    if existing:
        await db.clip_engagement.delete_one(
            {"user_email": email, "clip_id": clip_id, "action": action},
        )
        await db.clips.update_one({"id": clip_id}, {"$inc": {counter_field: -1}})
        on = False
    else:
        await db.clip_engagement.insert_one({
            "user_email": email,
            "clip_id": clip_id,
            "action": action,
            "created_at": now_iso(),
        })
        await db.clips.update_one({"id": clip_id}, {"$inc": {counter_field: 1}})
        on = True
    fresh = await db.clips.find_one({"id": clip_id}, {"_id": 0, counter_field: 1})
    return {"ok": True, "on": on, "count": max(0, (fresh or {}).get(counter_field, 0))}


@router.post("/clips/{clip_id}/like")
async def toggle_like(clip_id: str, claims: dict = Depends(current_any_user)):
    email = (claims.get("email") or "").lower()
    if not email:
        raise HTTPException(401, "Sign in to like clips.")
    return await _toggle_engagement(clip_id, email, "like")


@router.post("/clips/{clip_id}/save")
async def toggle_save(clip_id: str, claims: dict = Depends(current_any_user)):
    email = (claims.get("email") or "").lower()
    if not email:
        raise HTTPException(401, "Sign in to save clips.")
    return await _toggle_engagement(clip_id, email, "save")


@router.get("/clips/me/saved")
async def my_saved(claims: dict = Depends(current_any_user)):
    """All clips a user has saved (for a personal feed page later)."""
    email = (claims.get("email") or "").lower()
    saved_ids = []
    async for d in db.clip_engagement.find(
        {"user_email": email, "action": "save"},
        {"_id": 0, "clip_id": 1},
    ).sort("created_at", -1).limit(50):
        saved_ids.append(d["clip_id"])
    if not saved_ids:
        return {"items": []}
    rows: list[dict] = []
    async for d in db.clips.find(
        {"id": {"$in": saved_ids}, "quarantined_at": None},
        {"_id": 0},
    ):
        rows.append(_public_row(d))
    await _annotate_engagement(rows, email)
    # Preserve the saved-order
    by_id = {r["id"]: r for r in rows}
    return {"items": [by_id[i] for i in saved_ids if i in by_id]}


# ---------------------------------------------------------------------------
# Maker uploads — YouTube/Vimeo URL flow (fast path; R2 native upload is
# a follow-up). Adds to the global `clips` collection with maker
# attribution.
# ---------------------------------------------------------------------------
class _CreateFromUrl(BaseModel):
    url: str = Field(..., min_length=8, max_length=400)
    title: str = Field(..., min_length=3, max_length=MAX_TITLE)
    description: str = Field("", max_length=MAX_DESC)
    category: str = Field("workshop")
    tags: list[str] = Field(default_factory=list)
    product_slug: Optional[str] = Field(None, max_length=200)


@router.post("/maker/clips")
async def maker_create_clip(
    payload: _CreateFromUrl = Body(...),
    slug: str = Depends(current_maker_slug),
):
    """Maker creates a clip from a YouTube or Vimeo URL."""
    if payload.category not in VALID_CATEGORIES:
        raise HTTPException(422, f"Pick a category from: {sorted(VALID_CATEGORIES)}")
    parsed = parse_video_url(payload.url)
    if not parsed:
        raise HTTPException(
            422,
            "URL not recognized. Paste a YouTube watch link or Vimeo link.",
        )
    # Dedupe — same maker shouldn't upload the same video_id twice.
    existing = await db.clips.find_one(
        {"maker_slug": slug, "source_type": parsed["provider"],
         "source_id": parsed["video_id"], "quarantined_at": None},
        {"_id": 0, "id": 1},
    )
    if existing:
        raise HTTPException(409, "You've already added this clip.")

    maker = await db.makers.find_one({"slug": slug}, {"_id": 0, "name": 1, "studio_name": 1})
    maker_name = (maker or {}).get("studio_name") or (maker or {}).get("name") or slug

    base = _slugify(payload.title)
    slug_val = await _unique_slug(base)
    tags = [t.strip().lower() for t in (payload.tags or []) if t.strip()][:10]

    # Founding-50 Featured slot — auto-flag the first 50 organic clips.
    is_featured = (await _featured_clip_count()) < FOUNDING_FEATURED_CAP

    doc = {
        "id": str(uuid.uuid4()),
        "slug": slug_val,
        "maker_slug": slug,
        "maker_name": maker_name,
        "uploader_email": None,
        "title": payload.title.strip(),
        "description": payload.description.strip(),
        "category": payload.category,
        "tags": tags,
        "source_type": parsed["provider"],
        "source_id": parsed["video_id"],
        "video_url": parsed["embed_url"],
        "poster_url": parsed.get("thumbnail"),
        "duration_seconds": 0,
        "product_slug": (payload.product_slug or "").strip() or None,
        "views": 0,
        "likes": 0,
        "saves": 0,
        "shares": 0,
        "featured": is_featured,
        "is_seed": False,
        "ai_generated": False,
        "ai_model": None,
        "quarantined_at": None,
        "created_at": now_iso(),
    }
    await db.clips.insert_one(doc)
    logger.info("[clips] maker %s posted %s/%s · %s · featured=%s", slug,
                parsed["provider"], parsed["video_id"], slug_val, is_featured)
    return {"ok": True, "clip": _public_row(doc), "featured": is_featured}


@router.get("/maker/clips/mine")
async def maker_list_mine(slug: str = Depends(current_maker_slug)):
    rows: list[dict] = []
    async for d in db.clips.find({"maker_slug": slug}, {"_id": 0}).sort("created_at", -1):
        rows.append(_public_row(d))
    return {"items": rows}


@router.delete("/maker/clips/{clip_id}")
async def maker_delete_clip(clip_id: str, slug: str = Depends(current_maker_slug)):
    r = await db.clips.delete_one({"id": clip_id, "maker_slug": slug})
    if r.deleted_count == 0:
        raise HTTPException(404, "Clip not found or not yours.")
    # Also clean engagement rows so counters stay honest if the same id is
    # re-used (shouldn't happen — uuids — but defensive).
    await db.clip_engagement.delete_many({"clip_id": clip_id})
    return {"ok": True}


# ---------------------------------------------------------------------------
# Maker native upload — drag-drop MP4/WebM/MOV → R2.
#
# We keep the file size cap modest (matches existing video uploader: 50 MB)
# so 60-second 9:16 clips fit comfortably without us standing up Cloudflare
# Stream. Poster frame is best-effort via ffmpeg — if it fails we fall back
# to the maker's avatar or null.
# ---------------------------------------------------------------------------
from fastapi import File, Form, UploadFile  # noqa: E402

import r2_storage  # noqa: E402


@router.post("/maker/clips/upload")
async def maker_upload_clip(
    file: UploadFile = File(...),
    title: str = Form(...),
    description: str = Form(""),
    category: str = Form("workshop"),
    tags: str = Form(""),
    product_slug: str = Form(""),
    slug: str = Depends(current_maker_slug),
):
    """Upload a native MP4/WebM/MOV (≤50 MB). Extracts a poster JPG via
    ffmpeg and inserts a `clips` row pointing at the R2 public URL.

    Form-encoded so the browser can stream multipart without us needing
    a separate chunked-upload protocol. For files larger than 50 MB the
    maker should keep using the YouTube/Vimeo URL embed flow.
    """
    if not r2_storage.is_configured():
        raise HTTPException(503, "Video storage isn't configured. Use a YouTube/Vimeo URL for now.")
    if category not in VALID_CATEGORIES:
        raise HTTPException(422, f"Pick a category from: {sorted(VALID_CATEGORIES)}")
    title = (title or "").strip()
    if not (3 <= len(title) <= MAX_TITLE):
        raise HTTPException(422, f"Title must be 3–{MAX_TITLE} chars.")

    data = await file.read()
    ct = (file.content_type or "").lower() or "video/mp4"
    fname = file.filename or "clip.mp4"
    try:
        video_url = r2_storage.upload_video_bytes(
            data, key_prefix=f"maker-clips/{slug}",
            filename=fname, content_type=ct,
        )
    except ValueError as e:
        raise HTTPException(422, str(e))
    except Exception as e:
        logger.exception("[clips] R2 upload failed: %s", e)
        raise HTTPException(502, "Upload failed — try again or use a YouTube/Vimeo URL.")

    # ── Best-effort poster frame via ffmpeg. Skip if ffmpeg missing or fails.
    poster_url: Optional[str] = None
    try:
        import subprocess
        import tempfile
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as src_f, \
             tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as out_f:
            src_f.write(data)
            src_f.flush()
            subprocess.run(
                ["ffmpeg", "-y", "-i", src_f.name, "-vframes", "1", "-q:v", "3", out_f.name],
                check=True, capture_output=True, timeout=20,
            )
            with open(out_f.name, "rb") as fh:
                poster_bytes = fh.read()
        if poster_bytes:
            poster_url = r2_storage.upload_bytes(
                poster_bytes,
                key=f"maker-clips/{slug}/posters/{uuid.uuid4().hex}.jpg",
                content_type="image/jpeg",
            )
    except Exception as e:
        logger.warning("[clips] poster frame failed for %s: %s", slug, e)

    maker = await db.makers.find_one({"slug": slug}, {"_id": 0, "name": 1, "studio_name": 1})
    maker_name = (maker or {}).get("studio_name") or (maker or {}).get("name") or slug

    title_slug = await _unique_slug(_slugify(title))
    tags_list = [t.strip().lower() for t in (tags or "").split(",") if t.strip()][:10]

    # Founding-50 Featured slot — same auto-flag rule as the URL path.
    is_featured = (await _featured_clip_count()) < FOUNDING_FEATURED_CAP

    doc = {
        "id": str(uuid.uuid4()),
        "slug": title_slug,
        "maker_slug": slug,
        "maker_name": maker_name,
        "uploader_email": None,
        "title": title,
        "description": (description or "").strip()[:MAX_DESC],
        "category": category,
        "tags": tags_list,
        "source_type": "r2",
        "source_id": None,
        "video_url": video_url,
        "poster_url": poster_url,
        "duration_seconds": 0,
        "product_slug": (product_slug or "").strip() or None,
        "views": 0,
        "likes": 0,
        "saves": 0,
        "shares": 0,
        "featured": is_featured,
        "is_seed": False,
        "ai_generated": False,
        "ai_model": None,
        "quarantined_at": None,
        "created_at": now_iso(),
    }
    await db.clips.insert_one(doc)
    logger.info("[clips] maker %s uploaded native clip %s (%d KB) · featured=%s",
                slug, title_slug, len(data) // 1024, is_featured)
    return {"ok": True, "clip": _public_row(doc), "featured": is_featured}
