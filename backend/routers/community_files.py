from config import env_get
"""Community design files: upload, variants, conversions, downloads, reports.

Carved out of `routers/community.py` (Feb 2026 refactor).

Surfaces:
  • Public listing + trending + leaderboard
  • Maker/buyer multi-format bundle upload (direct R2)
  • Owner-only edit + variant management
  • DXF→SVG conversion, STL→thumbnail render
  • Paywalled download metering ($5 / 180-day unlock)
  • Open-to-all abuse reports
"""
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from core import db, logger, now_iso
from seo_tags import build_seo_description, extract_seo_tags
from maker_auth import current_any_user, current_buyer, current_maker_slug

router = APIRouter()


# ===================== METERING =====================
DOWNLOAD_FREE_LIMIT = 6
DOWNLOAD_WINDOW_DAYS = 180
PAID_UNLOCK_AMOUNT = 5.00


# ===================== MODELS =====================
class DesignFileMeta(BaseModel):
    title: str
    description: str
    file_type: str
    download_url: str
    thumbnail_url: Optional[str] = None


class DesignFileEdit(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    thumbnail_url: Optional[str] = None


class FileReportRequest(BaseModel):
    reason: str
    details: Optional[str] = None


# ===================== QUALITY SCORE =====================
PROD_2D = {"dxf", "svg", "ai", "eps", "pdf"}
PROD_3D = {"stl", "obj", "3mf", "step", "stp"}
PROD_CNC = {"dwg", "nc", "tap", "gcode"}
PROD_ALL = PROD_2D | PROD_3D | PROD_CNC


def _compute_quality_score(doc: dict) -> dict:
    """Pure function over a `design_files` doc → `{score, tier, breakdown}`."""
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


def _is_design_file_owner(doc: dict, claims: dict) -> bool:
    """Strict ownership check for design-file mutations."""
    sub = claims.get("sub", "")
    if not sub:
        return False
    if doc.get("maker_slug"):
        return doc["maker_slug"] == sub
    return doc.get("uploader_id") == sub


async def _resolve_poster_email(doc: dict) -> str | None:
    """Find the poster's email so we can notify them of admin edits."""
    if doc.get("maker_slug"):
        m = await db.makers.find_one({"slug": doc["maker_slug"]}, {"_id": 0, "email": 1})
        if m and m.get("email"):
            return m["email"]
    if doc.get("uploader_id"):
        u = await db.community_users.find_one(
            {"user_id": doc["uploader_id"]}, {"_id": 0, "email": 1},
        )
        if u and u.get("email"):
            return u["email"]
    return None


async def grant_weekly_boost_credit(maker_slug: str, source: str = "file_upload") -> Optional[dict]:
    """Reward a maker with a free 1-day promotion credit when they upload
    a design file. Idempotent per ISO calendar week."""
    if not maker_slug:
        return None
    maker = await db.makers.find_one(
        {"slug": maker_slug}, {"_id": 0, "slug": 1, "email": 1, "name": 1},
    )
    if not maker:
        return None

    now = datetime.now(timezone.utc)
    iso_year, iso_week, _ = now.isocalendar()
    week_key = f"{iso_year}-W{iso_week:02d}"
    existing = await db.community_boost_credits.find_one(
        {"maker_slug": maker_slug, "iso_week": week_key},
        {"_id": 0, "id": 1},
    )
    if existing:
        return None

    credit = {
        "id": str(uuid.uuid4()),
        "maker_slug": maker_slug,
        "iso_week": week_key,
        "source": source,
        "duration_hours": 24,
        "granted_at": now.isoformat(),
        "expires_at": (now + timedelta(days=30)).isoformat(),
        "consumed_at": None,
        "consumed_for_product_slug": None,
    }
    await db.community_boost_credits.insert_one(credit)

    try:
        from routers.push import notify_buyer_push
        em = (maker.get("email") or "").strip().lower()
        if em:
            await notify_buyer_push(
                em,
                "🎁 You earned a free 24h boost",
                f"Thanks for sharing a design this week, {maker.get('name') or 'maker'}. "
                "Tap to apply your credit to a listing.",
                url="/maker/dashboard?tab=marketing",
                tag="cm-maker-boost-credit",
            )
    except Exception as e:
        logger.debug("[boost-credit push] non-fatal: %s", e)

    return credit


# iter221 — Orphan-seed guard for design files (mirrors iter218 clips fix).
# An AI-generated design row is "live" only when (1) it has a remote
# `download_url` (https — files hosted on R2 / Drive / Dropbox, no local
# dependency), OR (2) it explicitly carries `file_verified: True` (the new
# seeder sets this only after svg + dxf + preview.jpg are all confirmed on
# disk). Any other seed row is an orphan — typically a Nano Banana preview
# generation that half-failed before the deploy artifact was captured —
# and is hidden from the public listing so production never renders a
# broken-image card again.
def _design_orphan_guard() -> dict:
    return {
        "$or": [
            # Non-seed (organic maker uploads) — never gated.
            {"is_seed": {"$ne": True}},
            # Verified seed (post-iter221 generator always sets this).
            {"is_seed": True, "file_verified": True},
            # Legacy seed pointing at an external CDN URL — no local file
            # dependency, can never be an orphan.
            {"is_seed": True, "thumbnail_url": {"$regex": "^https?://"}},
        ]
    }


# ===================== LISTING =====================
@router.get("/community/files")
async def list_design_files(limit: int = 50):
    rows = await db.design_files.find(
        {"quarantined_at": None, **_design_orphan_guard()},
        {"_id": 0},
    ).sort("created_at", -1).to_list(limit)
    return [_with_quality(r) for r in rows]


@router.get("/community/files/trending")
async def files_trending(days: int = 7, limit: int = 6):
    """Top N most-downloaded files in the last `days`. Falls back to
    lifetime top-N if zero recent downloads so the rail never goes empty."""
    if days < 1 or days > 90:
        raise HTTPException(400, "days must be 1–90")
    if limit < 1 or limit > 50:
        raise HTTPException(400, "limit must be 1–50")

    cutoff_iso = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    test_filter = {"$nor": [{"title": {"$regex": "^TEST", "$options": "i"}}]}
    pipeline = [
        {"$match": {"created_at": {"$gte": cutoff_iso}}},
        {"$group": {"_id": "$file_id", "recent_downloads": {"$sum": 1}}},
        {"$sort": {"recent_downloads": -1}},
        {"$limit": limit * 3},
    ]
    rows = await db.download_logs.aggregate(pipeline).to_list(limit * 3)
    file_ids = [r["_id"] for r in rows if r.get("_id")]
    if not file_ids:
        live = await db.design_files.find(
            {"quarantined_at": None, "downloads": {"$gt": 0}, **test_filter},
            {"_id": 0},
        ).sort("downloads", -1).limit(limit).to_list(limit)
        return [
            {**_with_quality(f), "recent_downloads": 0,
             "fallback": True, "lifetime_downloads": int(f.get("downloads") or 0)}
            for f in live
        ]

    files = await db.design_files.find(
        {"id": {"$in": file_ids}, "quarantined_at": None, **test_filter},
        {"_id": 0},
    ).to_list(limit * 3)
    by_id = {f["id"]: f for f in files}

    out = []
    for r in rows:
        f = by_id.get(r["_id"])
        if not f:
            continue
        out.append({
            **_with_quality(f),
            "recent_downloads": int(r["recent_downloads"]),
            "lifetime_downloads": int(f.get("downloads") or 0),
            "fallback": False,
        })
        if len(out) >= limit:
            break

    if not out:
        live = await db.design_files.find(
            {"quarantined_at": None, "downloads": {"$gt": 0}, **test_filter},
            {"_id": 0},
        ).sort("downloads", -1).limit(limit).to_list(limit)
        return [
            {**_with_quality(f), "recent_downloads": 0,
             "fallback": True, "lifetime_downloads": int(f.get("downloads") or 0)}
            for f in live
        ]
    return out


@router.get("/community/files/leaderboard")
async def files_leaderboard(limit: int = 10):
    """Top contributors by upload count + total downloads.
    score = uploads * 5 + downloads."""
    pipeline = [
        {"$match": {"quarantined_at": None}},
        {"$group": {
            "_id": {
                "key": {"$ifNull": ["$maker_slug", "$uploader_id"]},
                "kind": {"$cond": [{"$ifNull": ["$maker_slug", False]}, "maker", "buyer"]},
                "name": {"$ifNull": ["$maker_name", "$uploader_name"]},
            },
            "uploads": {"$sum": 1},
            "downloads": {"$sum": {"$ifNull": ["$downloads", 0]}},
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


# ===================== UPLOAD =====================
@router.post("/community/files")
async def upload_design_file(payload: DesignFileMeta, slug: str = Depends(current_maker_slug)):
    """Maker-only: post a downloadable design file (URL-paste path)."""
    maker = await db.makers.find_one({"slug": slug}, {"_id": 0})
    title = payload.title or ""
    description = payload.description or ""
    seo_tags = extract_seo_tags(
        title, description,
        file_types=[payload.file_type] if payload.file_type else None,
    )
    seo_description = build_seo_description(title, description)
    doc = {
        "id": str(uuid.uuid4()),
        "maker_slug": slug,
        "maker_name": maker["name"] if maker else slug,
        **payload.model_dump(),
        "downloads": 0,
        "created_at": now_iso(),
        "seo_tags": seo_tags,
        "seo_description": seo_description,
    }
    await db.design_files.insert_one(doc)
    doc.pop("_id", None)
    if slug:
        await grant_weekly_boost_credit(slug)
    # iter320b — fire-and-forget LLM SEO tagging so new uploads land
    # in the catalog feed with full meta out-of-the-box.
    from auto_seo_inline import schedule_seo_for_design_file
    schedule_seo_for_design_file(doc.get("id"))
    return doc


@router.post("/community/files/upload")
async def upload_design_file_direct(
    files: List[UploadFile] = File(...),
    title: str = Form(...),
    description: str = Form(...),
    thumbnail_url: str = Form(""),
    claims: dict = Depends(current_any_user),
):
    """Direct multi-format file upload for the community design-file library."""
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
        if ext.lower() in seen_exts:
            raise HTTPException(400, f"Duplicate format '{ext}' in this bundle. Each format may appear once.")
        seen_exts.add(ext.lower())
        uploaded.append({
            "format": ext,
            "url": url,
            "filename": (f.filename or "").strip()[:200] or None,
            "size_bytes": len(raw),
            "uploaded_at": now_iso(),
        })

    primary = uploaded[0]
    variants = uploaded[1:]

    auto_thumb = None
    for v in uploaded:
        if v["format"].lower() in ("jpg", "jpeg", "png", "webp"):
            auto_thumb = v["url"]
            break

    file_type_codes = [primary["format"]] + [v["format"] for v in variants]
    seo_tags = extract_seo_tags(title, description, file_types=file_type_codes)
    seo_description = build_seo_description(title, description)

    doc = {
        "id": str(uuid.uuid4()),
        "maker_slug": uploader_label if role == "maker" else None,
        "uploader_role": role,
        "uploader_id": user_key,
        "maker_name": uploader_name,
        "title": title[:120],
        "description": description[:800],
        "file_type": primary["format"],
        "download_url": primary["url"],
        "thumbnail_url": (thumbnail_url or "").strip()[:600] or auto_thumb,
        "variants": variants,
        "downloads": 0,
        "size_bytes": primary["size_bytes"],
        "created_at": now_iso(),
        "seo_tags": seo_tags,
        "seo_description": seo_description,
    }
    await db.design_files.insert_one(doc)
    doc.pop("_id", None)
    if role == "maker" and uploader_label:
        await grant_weekly_boost_credit(uploader_label)
    # iter320b — fire-and-forget LLM SEO tagging on direct uploads.
    from auto_seo_inline import schedule_seo_for_design_file
    schedule_seo_for_design_file(doc.get("id"))
    return _with_quality(doc)


# ===================== EDIT =====================
@router.patch("/community/files/{file_id}")
async def update_design_file(
    file_id: str,
    payload: DesignFileEdit,
    claims: dict = Depends(current_any_user),
):
    """Owner-only edit of a community design bundle's metadata."""
    doc = await db.design_files.find_one({"id": file_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Design file not found.")
    is_admin = claims.get("role") == "admin"
    if not is_admin and not _is_design_file_owner(doc, claims):
        raise HTTPException(403, "You can only edit your own uploads.")

    updates: dict = {}
    if payload.title is not None:
        title = payload.title.strip()
        if not title or len(title) > 120:
            raise HTTPException(400, "Title is required (max 120 chars).")
        updates["title"] = title[:120]
    if payload.description is not None:
        description = payload.description.strip()
        if not description or len(description) > 800:
            raise HTTPException(400, "Description is required (max 800 chars).")
        updates["description"] = description[:800]
    if payload.thumbnail_url is not None:
        thumb = payload.thumbnail_url.strip()
        if len(thumb) > 600:
            raise HTTPException(400, "Thumbnail URL too long (max 600 chars).")
        updates["thumbnail_url"] = thumb or None
        if "thumbnail_auto_generated" in doc:
            updates["thumbnail_auto_generated"] = False

    if not updates:
        return _with_quality(doc)

    new_title = updates.get("title", doc.get("title"))
    new_description = updates.get("description", doc.get("description"))
    if "title" in updates or "description" in updates:
        file_type_codes = [doc.get("file_type")] + [
            v.get("format") for v in (doc.get("variants") or []) if v.get("format")
        ]
        updates["seo_tags"] = extract_seo_tags(
            new_title, new_description,
            file_types=[c for c in file_type_codes if c],
        )
        updates["seo_description"] = build_seo_description(new_title, new_description)

    updates["updated_at"] = now_iso()
    await db.design_files.update_one({"id": file_id}, {"$set": updates})
    fresh = await db.design_files.find_one({"id": file_id}, {"_id": 0})

    # Admin edit notification (settings-gated, fail-soft).
    if is_admin:
        try:
            from routers.settings import get_setting
            if await get_setting("email_poster_on_admin_edit", True):
                user_facing = {"title", "description", "thumbnail_url"}
                diff: dict = {}
                for k in user_facing & set(updates.keys()):
                    before = doc.get(k)
                    after = updates.get(k)
                    if (before or "") != (after or ""):
                        diff[k] = {"before": before, "after": after}
                if diff:
                    poster_email = await _resolve_poster_email(doc)
                    poster_name = doc.get("maker_name") or ""
                    if poster_email:
                        from email_service import send_admin_edited_design_file
                        await send_admin_edited_design_file(
                            poster_email,
                            poster_name,
                            (fresh or doc).get("title") or doc.get("title") or "",
                            file_id,
                            diff,
                        )
                        await db.design_files.update_one(
                            {"id": file_id},
                            {"$push": {"admin_edits": {
                                "ts": now_iso(),
                                "by": claims.get("sub"),
                                "diff": diff,
                                "emailed": True,
                            }}},
                        )
        except Exception as e:
            logger.exception("[admin_edit_email] failed for file=%s: %s", file_id, e)

    return _with_quality(fresh) if fresh else {}


# ===================== VARIANTS =====================
@router.post("/community/files/{file_id}/variants")
async def add_design_file_variants(
    file_id: str,
    files: List[UploadFile] = File(...),
    claims: dict = Depends(current_any_user),
):
    """Append additional format variants to an existing design bundle."""
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
    """Remove a single format variant from a design bundle."""
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


# ===================== CONVERSIONS =====================
@router.post("/community/files/{file_id}/convert/dxf-to-svg")
async def convert_dxf_to_svg(
    file_id: str,
    claims: dict = Depends(current_any_user),
):
    """Generate an SVG preview from a DXF in this bundle and append it as
    a new variant."""
    doc = await db.design_files.find_one({"id": file_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Design file not found.")

    if not _is_design_file_owner(doc, claims):
        raise HTTPException(403, "You can only convert your own uploads.")

    primary_fmt = (doc.get("file_type") or "").upper()
    variant_fmts = {(v.get("format") or "").upper() for v in (doc.get("variants") or [])}
    if primary_fmt == "SVG" or "SVG" in variant_fmts:
        raise HTTPException(409, "This bundle already has an SVG variant.")

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

    import httpx
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(src_url)
            resp.raise_for_status()
            dxf_bytes = resp.content
    except Exception as e:
        raise HTTPException(502, f"Couldn't fetch source DXF: {e}")

    import asyncio
    from dxf_converter import convert_dxf_bytes_to_svg
    try:
        svg_bytes = await asyncio.to_thread(convert_dxf_bytes_to_svg, dxf_bytes)
    except ValueError as e:
        msg = str(e)
        if msg.startswith("Couldn't parse DXF:"):
            msg = "This DXF appears corrupted or is in an unsupported variant. Try re-exporting from your CAD tool as DXF R2010 or newer."
        raise HTTPException(422, msg)

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
        "format": ext,
        "url": url,
        "filename": f"{doc.get('title','design')[:60]}.svg",
        "size_bytes": len(svg_bytes),
        "uploaded_at": now_iso(),
        "auto_generated": True,
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
    """Render a PNG thumbnail from an STL in this bundle and stamp it on
    `thumbnail_url`."""
    doc = await db.design_files.find_one({"id": file_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Design file not found.")
    if not _is_design_file_owner(doc, claims):
        raise HTTPException(403, "You can only render thumbnails for your own uploads.")
    if doc.get("thumbnail_url"):
        raise HTTPException(409, "This bundle already has a thumbnail.")

    primary_fmt = (doc.get("file_type") or "").upper()
    src_url = doc.get("download_url") if primary_fmt == "STL" else None
    if not src_url:
        for v in (doc.get("variants") or []):
            if (v.get("format") or "").upper() == "STL":
                src_url = v.get("url")
                break
    if not src_url:
        raise HTTPException(400, "No STL in this bundle to render.")

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


# ===================== DOWNLOADS + UNLOCK =====================
@router.get("/community/files/{file_id}/download")
async def download_design_file(file_id: str, claims: dict = Depends(current_buyer)):
    """Tracks downloads. Returns the file URL if user has free downloads
    left or has paid."""
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
    """Mint a Stripe Checkout session for the $5 unlimited-downloads unlock."""
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
        success_url=f"{env_get('PUBLIC_SITE_URL', '').rstrip('/')}/community?unlocked=1",
        cancel_url=f"{env_get('PUBLIC_SITE_URL', '').rstrip('/')}/community",
        metadata={"kind": "downloads_unlock", "user_id": user_id, "user_email": user["email"]},
    )
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


# ===================== REPORTS =====================
REPORT_REASONS = {
    "stolen":      "Stolen work / IP infringement",
    "copyright":   "Copyright violation",
    "duplicate":   "Duplicate listing",
    "malware":     "Malware / suspicious file",
    "inaccurate":  "Mislabelled or broken",
    "other":       "Other concern",
}


@router.post("/community/files/{file_id}/report")
async def report_design_file(
    file_id: str,
    body: FileReportRequest,
    claims: dict = Depends(current_any_user),
):
    """Flag a design file for admin review."""
    reason = (body.reason or "").strip()
    if reason not in REPORT_REASONS:
        raise HTTPException(400, "Invalid reason.")
    details = (body.details or "").strip()[:1000]

    file_doc = await db.design_files.find_one(
        {"id": file_id},
        {"_id": 0, "id": 1, "title": 1, "maker_name": 1, "maker_slug": 1, "uploader_id": 1},
    )
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
    await db.design_files.update_one(
        {"id": file_id},
        {"$inc": {"open_reports": 1}},
    )
    return {"ok": True, "duplicate": False, "id": doc["id"]}
