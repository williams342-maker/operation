"""
Community Design Library — makers share royalty-free DXF/SVG/PNG design
files with the wider Crafters Market community. v1 is intentionally
minimal: list/get/download endpoints public, upload restricted to
authenticated makers, no payment flow yet (everything free with a clear
license string).

Storage: SVG + DXF + preview PNG all live in R2 (already configured
for product photos) so the catalogue survives redeploys. Seeded
designs come from the static fixture / public seed-designs directory
so they ship in the deploy artifact alongside the rest of the seed
content.
"""
from __future__ import annotations

import io
import logging
import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, Form
from pydantic import BaseModel, Field

from core import db, now_iso
from maker_auth import current_maker_slug

router = APIRouter()
logger = logging.getLogger("crafters.community_designs")

ALLOWED_PREVIEW_CT = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}
ALLOWED_VECTOR_CT = {
    "image/svg+xml": "svg",
    "application/dxf": "dxf",
    "application/vnd.dxf": "dxf",
    "application/x-dxf": "dxf",
    "image/x-dxf": "dxf",
    "application/octet-stream": "bin",  # browsers often misreport DXF this way
    "text/plain": "txt",
}
MAX_PREVIEW_BYTES = 4 * 1024 * 1024   # 4 MB preview PNG/JPG
MAX_VECTOR_BYTES = 10 * 1024 * 1024   # 10 MB per vector file


class CommunityDesign(BaseModel):
    """One downloadable design entry in the community library."""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    slug: str
    title: str
    description: str = ""
    category: str = "General"
    technique: Optional[str] = None       # PLASMA / LASER / ROUTER / 3D — guides which workflows fit
    license: str = "CC-BY 4.0"             # display-only string; we don't enforce
    preview_url: str                       # PNG/JPG thumbnail
    svg_url: Optional[str] = None
    dxf_url: Optional[str] = None
    width_in: Optional[float] = None
    height_in: Optional[float] = None
    tags: list = []
    downloads: int = 0
    maker_slug: Optional[str] = None       # null = platform-seeded
    maker_name: Optional[str] = None
    is_seed: bool = False
    created_at: str = Field(default_factory=now_iso)


# ----------------------------------------------------------------------------
# Public read endpoints
# ----------------------------------------------------------------------------
@router.get("/community/designs", response_model=List[CommunityDesign])
async def list_community_designs(
    category: Optional[str] = None,
    technique: Optional[str] = None,
    q: Optional[str] = None,
):
    """Paginated-less list — at expected catalogue scale (<200 designs)
    sending the full set keeps the frontend simple and lets visitors
    use the in-page search / category filters without round-trips."""
    query: dict = {}
    if category and category != "All":
        query["category"] = category
    if technique and technique != "All":
        query["technique"] = technique.upper()
    if q:
        # Lightweight client-side-style search across title/desc/tags.
        # At <200 designs this is fine; if the catalogue grows past
        # 1k we'll swap in a proper text index.
        ql = q.lower()
        query["$or"] = [
            {"title": {"$regex": ql, "$options": "i"}},
            {"description": {"$regex": ql, "$options": "i"}},
            {"tags": {"$elemMatch": {"$regex": ql, "$options": "i"}}},
        ]
    cursor = db.community_designs.find(query, {"_id": 0}).sort("created_at", -1)
    return await cursor.to_list(500)


@router.get("/community/designs/{slug}", response_model=CommunityDesign)
async def get_community_design(slug: str):
    doc = await db.community_designs.find_one({"slug": slug}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Design not found.")
    return doc


@router.post("/community/designs/{slug}/download")
async def record_download(slug: str, format: str):
    """Increment the downloads counter when a visitor pulls a file.
    Called by the frontend as a `keepalive` fetch right before the
    real download link fires. `format` is just for analytics — we don't
    gate access on it."""
    if format not in ("svg", "dxf"):
        raise HTTPException(400, "Format must be 'svg' or 'dxf'.")
    r = await db.community_designs.update_one(
        {"slug": slug},
        {"$inc": {"downloads": 1, f"downloads_by_format.{format}": 1}},
    )
    if r.matched_count == 0:
        raise HTTPException(404, "Design not found.")
    return {"ok": True}


# ----------------------------------------------------------------------------
# Maker upload — POST a new design (multipart: preview + svg + optional dxf)
# ----------------------------------------------------------------------------
@router.post("/community/designs", response_model=CommunityDesign)
async def upload_community_design(
    title: str = Form(...),
    description: str = Form(""),
    category: str = Form("General"),
    technique: Optional[str] = Form(None),
    tags: str = Form(""),          # comma-separated
    width_in: Optional[float] = Form(None),
    height_in: Optional[float] = Form(None),
    license: str = Form("CC-BY 4.0"),
    preview: UploadFile = File(...),
    svg_file: Optional[UploadFile] = File(None),
    dxf_file: Optional[UploadFile] = File(None),
    slug: str = Depends(current_maker_slug),
):
    """Maker-gated upload. At least one of svg_file / dxf_file is
    required — sharing a design without a downloadable vector source
    would defeat the point. Preview thumbnail is always required."""
    if not svg_file and not dxf_file:
        raise HTTPException(400, "At least one vector file (SVG or DXF) is required.")
    if len(title.strip()) < 3:
        raise HTTPException(400, "Title must be at least 3 characters.")

    try:
        from r2_storage import is_configured as _r2_ok, upload_bytes
    except Exception:
        raise HTTPException(503, "R2 storage unavailable.")
    if not _r2_ok():
        raise HTTPException(503, "R2 storage is not configured.")

    # Slug uniqueness — based on title + maker so two makers can share
    # designs with the same name without collision.
    base_slug = "".join(c.lower() if c.isalnum() else "-" for c in title.strip())[:80].strip("-")
    candidate = f"{slug}-{base_slug}"
    n = 1
    while await db.community_designs.find_one({"slug": candidate}, {"_id": 0, "slug": 1}):
        n += 1
        candidate = f"{slug}-{base_slug}-{n}"
    design_slug = candidate

    # Preview thumbnail.
    p_ct = (preview.content_type or "").lower()
    if p_ct not in ALLOWED_PREVIEW_CT:
        raise HTTPException(400, "Preview must be PNG / JPG / WebP.")
    p_bytes = await preview.read()
    if len(p_bytes) > MAX_PREVIEW_BYTES or len(p_bytes) == 0:
        raise HTTPException(400, "Preview must be 1 byte – 4 MB.")
    p_key = f"community-designs/{design_slug}/preview.{ALLOWED_PREVIEW_CT[p_ct]}"
    try:
        preview_url = upload_bytes(p_bytes, p_key, p_ct)
    except Exception as e:
        logger.exception("preview upload failed: %s", e)
        raise HTTPException(502, "Preview upload failed.")

    # SVG (optional)
    svg_url = None
    if svg_file:
        s_bytes = await svg_file.read()
        if len(s_bytes) > MAX_VECTOR_BYTES or len(s_bytes) == 0:
            raise HTTPException(400, "SVG file must be 1 byte – 10 MB.")
        if b"<svg" not in s_bytes[:512].lower():
            raise HTTPException(400, "SVG file does not look like SVG content.")
        try:
            svg_url = upload_bytes(s_bytes, f"community-designs/{design_slug}/source.svg", "image/svg+xml")
        except Exception as e:
            logger.exception("svg upload failed: %s", e)
            raise HTTPException(502, "SVG upload failed.")

    # DXF (optional)
    dxf_url = None
    if dxf_file:
        d_bytes = await dxf_file.read()
        if len(d_bytes) > MAX_VECTOR_BYTES or len(d_bytes) == 0:
            raise HTTPException(400, "DXF file must be 1 byte – 10 MB.")
        # DXF text files start with "0\nSECTION" — quick sanity check.
        head = d_bytes[:64].decode("ascii", errors="ignore").lower()
        if "section" not in head and "header" not in head:
            raise HTTPException(400, "DXF file does not look like DXF content.")
        try:
            dxf_url = upload_bytes(d_bytes, f"community-designs/{design_slug}/source.dxf", "application/dxf")
        except Exception as e:
            logger.exception("dxf upload failed: %s", e)
            raise HTTPException(502, "DXF upload failed.")

    maker_doc = await db.makers.find_one({"slug": slug}, {"_id": 0, "name": 1})
    design = CommunityDesign(
        slug=design_slug, title=title.strip(), description=description.strip(),
        category=category.strip() or "General",
        technique=(technique or "").upper() or None,
        license=license.strip() or "CC-BY 4.0",
        preview_url=preview_url, svg_url=svg_url, dxf_url=dxf_url,
        width_in=width_in, height_in=height_in,
        tags=[t.strip() for t in tags.split(",") if t.strip()][:10],
        maker_slug=slug, maker_name=(maker_doc or {}).get("name"),
    )
    await db.community_designs.insert_one(design.model_dump())
    return design
