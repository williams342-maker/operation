"""Customer photo uploads for personalized orders (iter364).

Buyers attach reference photos (engraving art, fingerprints, pet nose
prints, memorial portraits…) in the personalization panel BEFORE adding
to cart. Files land in Emergent object storage; only metadata lives in
Mongo (`customer_uploads`). Upload ids ride on the cart line →
tx doc → maker order detail, where the maker gets thumbnails + a
"Download all" zip.

Endpoints
---------
POST /api/personalization/files          (public, multipart, ≤25 MB)
GET  /api/personalization/files/{id}     (public — unguessable UUID id)
GET  /api/maker/orders/{sid}/uploads.zip (maker-authed bulk download)

Abuse mitigations on the public upload endpoint:
  • 25 MB hard cap per file, content-type + extension whitelist
  • per-IP sliding-window rate limit (40/hour — 10 files/item, buyers
    legitimately retry on flaky mobile networks)
  • orphan tracking: docs start `referenced=False`; payment success
    flips them True and stamps `order_session_id`
"""
from __future__ import annotations

import hashlib
import io
import uuid
import zipfile
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response, StreamingResponse

from core import db, logger
from maker_auth import current_maker_slug
from obj_storage import APP_NAME, get_object, put_object

router = APIRouter()

MAX_FILE_BYTES = 25 * 1024 * 1024       # 25 MB per file (per seller spec)
MAX_FILES_PER_ITEM = 10
RATE_LIMIT_PER_HOUR = 40
RATE_WINDOW_SECONDS = 3600

# Extension → canonical MIME. Whitelist per the seller spec (jpg/png/
# webp/heic). HEIF rides along since iPhones emit both interchangeably.
ALLOWED_TYPES = {
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "png": "image/png",
    "webp": "image/webp",
    "heic": "image/heic",
    "heif": "image/heif",
}
ALLOWED_MIMES = set(ALLOWED_TYPES.values()) | {"image/jpg"}


def _ip_hash(request: Request) -> str:
    ip = (
        request.headers.get("cf-connecting-ip")
        or (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
        or (request.client.host if request.client else "")
        or "unknown"
    )
    return hashlib.sha256(ip.encode("utf-8")).hexdigest()[:24]


@router.post("/personalization/files")
async def upload_customer_file(
    request: Request,
    file: UploadFile = File(...),
    product_slug: str = Form(default=""),
) -> dict:
    """Accept one multipart image → object storage → return file id.

    Anonymous by design (buyers aren't authenticated while shopping).
    The frontend uploads each picked file individually so per-file
    progress and failures stay isolated.
    """
    ext = (file.filename or "").rsplit(".", 1)[-1].lower() if "." in (file.filename or "") else ""
    mime = (file.content_type or "").lower()
    if ext not in ALLOWED_TYPES and mime not in ALLOWED_MIMES:
        raise HTTPException(400, "Please upload a JPG, PNG, WEBP, or HEIC photo.")
    content_type = ALLOWED_TYPES.get(ext) or mime or "application/octet-stream"

    # Per-IP sliding-window rate limit (shared collection with iter150
    # so admin tooling sees one upload ledger).
    iph = _ip_hash(request)
    now = datetime.now(timezone.utc)
    cutoff_iso = (now - timedelta(seconds=RATE_WINDOW_SECONDS)).isoformat()
    same_window = await db.customer_uploads.count_documents({
        "ip_hash": iph, "created_at": {"$gte": cutoff_iso},
    })
    if same_window >= RATE_LIMIT_PER_HOUR:
        raise HTTPException(429, "Too many uploads in the last hour. Please try again later.")

    data = await file.read()
    if len(data) > MAX_FILE_BYTES:
        raise HTTPException(413, "Photo is too large. Max 25 MB per file.")
    if not data:
        raise HTTPException(400, "Empty file.")

    file_id = str(uuid.uuid4())
    storage_path = f"{APP_NAME}/personalization/{file_id}.{ext or 'bin'}"
    try:
        result = await put_object(storage_path, data, content_type)
    except Exception as e:
        logger.exception("[customer-uploads] storage put failed: %s", e)
        raise HTTPException(502, "Upload failed. Please try again.")

    await db.customer_uploads.insert_one({
        "id": file_id,
        "storage_path": result.get("path") or storage_path,
        "original_filename": (file.filename or f"photo.{ext or 'bin'}")[:200],
        "content_type": content_type,
        "size": len(data),
        "ip_hash": iph,
        "product_slug": (product_slug or "")[:120] or None,
        "order_session_id": None,
        "referenced": False,
        "is_deleted": False,
        "created_at": now.isoformat(),
    })
    return {
        "id": file_id,
        "filename": file.filename,
        "size": len(data),
        "url": f"/api/personalization/files/{file_id}",
    }


@router.get("/personalization/files/{file_id}")
async def serve_customer_file(file_id: str):
    """Stream a customer upload back out. Public — the UUID id is the
    capability (matches the iter150 model where R2 URLs are public)."""
    rec = await db.customer_uploads.find_one(
        {"id": file_id, "is_deleted": False}, {"_id": 0},
    )
    if not rec:
        raise HTTPException(404, "File not found.")
    try:
        data, ct = await get_object(rec["storage_path"])
    except Exception as e:
        logger.exception("[customer-uploads] storage get failed: %s", e)
        raise HTTPException(502, "Could not retrieve the file.")
    return Response(
        content=data,
        media_type=rec.get("content_type") or ct,
        headers={
            "Content-Disposition": f"inline; filename=\"{rec.get('original_filename') or file_id}\"",
            "Cache-Control": "public, max-age=86400",
        },
    )


@router.get("/maker/orders/{session_id}/uploads.zip")
async def download_order_uploads_zip(
    session_id: str, slug: str = Depends(current_maker_slug),
):
    """Bundle every customer upload on the maker's lines of an order into
    one zip ("Download all"). Cross-maker isolation mirrors the order
    detail endpoint — only uploads attached to THIS maker's products."""
    tx = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})
    if not tx:
        raise HTTPException(404, "Order not found.")

    my_products = await db.products.find(
        {"maker_slug": slug}, {"_id": 0, "id": 1, "slug": 1},
    ).to_list(500)
    my_ids = {p["id"] for p in my_products if p.get("id")} | {
        p["slug"] for p in my_products if p.get("slug")
    }

    upload_ids: list[str] = []
    for ci in tx.get("items", []):
        if ci.get("product_id") in my_ids:
            upload_ids.extend(ci.get("personalization_upload_ids") or [])
    if not upload_ids:
        raise HTTPException(404, "No customer uploads on this order.")

    recs = await db.customer_uploads.find(
        {"id": {"$in": upload_ids}, "is_deleted": False}, {"_id": 0},
    ).to_list(100)
    if not recs:
        raise HTTPException(404, "No customer uploads on this order.")

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        seen_names: set[str] = set()
        for rec in recs:
            try:
                data, _ = await get_object(rec["storage_path"])
            except Exception as e:
                logger.warning("[customer-uploads] zip skip %s: %s", rec["id"], e)
                continue
            name = rec.get("original_filename") or f"{rec['id']}.bin"
            # De-dupe names inside the archive (two "photo.jpg" uploads).
            if name in seen_names:
                stem, _, ext = name.rpartition(".")
                name = f"{stem or name}-{rec['id'][:8]}.{ext or 'bin'}"
            seen_names.add(name)
            zf.writestr(name, data)
    buf.seek(0)
    short = session_id.replace("cs_", "")[:12]
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={
            "Content-Disposition": f"attachment; filename=\"customer-uploads-{short}.zip\"",
        },
    )
