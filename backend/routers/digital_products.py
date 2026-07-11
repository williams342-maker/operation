"""iter453 — Digital Products Phase 4.

Chunked uploads (100MB, proxy-safe 4-5MB chunks), heuristic malware
scanning gate, versioned file replacement with release notes, per-listing
delivery settings (optional download limit / link TTL), and the buyer
Purchases surface (re-download + history) so legitimate customers never
lose access.

Scanning: ClamAV isn't available in this environment, so files pass a
deterministic heuristic gate before becoming available — magic-byte vs
extension validation, executable signature rejection (PE/ELF/Mach-O/
shebang), dangerous-member + zip-bomb inspection for zip containers
(.zip/.epub/.3mf). Status persisted per file; blocked files never serve.
"""
import io
import os
import shutil
import uuid
import zipfile
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from core import db, logger, now_iso
from maker_auth import current_buyer, current_maker_slug

router = APIRouter()

ALLOWED_EXTS = {"pdf", "svg", "dxf", "dwg", "ai", "eps", "stl", "step", "stp",
                "3mf", "zip", "png", "jpg", "jpeg", "epub", "mp3", "mp4"}
MAX_FILE_BYTES = 100 * 1024 * 1024
MAX_FILES_PER_LISTING = 5
MAX_CHUNK_BYTES = 6 * 1024 * 1024
CHUNK_ROOT = "/tmp/cm_digital_uploads"

MIME_BY_EXT = {
    "pdf": "application/pdf", "svg": "image/svg+xml", "dxf": "application/dxf",
    "dwg": "application/acad", "ai": "application/postscript",
    "eps": "application/postscript", "stl": "model/stl",
    "step": "model/step", "stp": "model/step",
    "3mf": "model/3mf", "zip": "application/zip",
    "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
    "epub": "application/epub+zip", "mp3": "audio/mpeg", "mp4": "video/mp4",
}

# ── Heuristic malware / integrity scan ───────────────────────────────────────

_EXEC_SIGNATURES = (b"MZ", b"\x7fELF", b"\xca\xfe\xba\xbe", b"\xfe\xed\xfa")
_DANGEROUS_MEMBER_EXTS = {"exe", "dll", "bat", "cmd", "sh", "msi", "scr", "com",
                          "pif", "vbs", "js", "jse", "wsf", "ps1", "jar", "apk"}
_MAGIC = {
    "pdf": (b"%PDF",), "png": (b"\x89PNG",), "jpg": (b"\xff\xd8\xff",),
    "jpeg": (b"\xff\xd8\xff",), "zip": (b"PK\x03\x04", b"PK\x05\x06"),
    "epub": (b"PK\x03\x04",), "3mf": (b"PK\x03\x04",),
    "mp3": (b"ID3", b"\xff\xfb", b"\xff\xf3", b"\xff\xf2"),
}


def scan_digital_file(data: bytes, ext: str) -> tuple[str, str]:
    """Return ("clean", "") or ("blocked", reason). Deterministic heuristics."""
    if not data:
        return "blocked", "Empty file."
    head = data[:16]
    if any(head.startswith(sig) for sig in _EXEC_SIGNATURES):
        return "blocked", "Executable binaries are not allowed."
    if head.startswith(b"#!"):
        return "blocked", "Script files are not allowed."
    magics = _MAGIC.get(ext)
    if magics and not any(head.startswith(m) for m in magics):
        return "blocked", f"File content does not match .{ext} format."
    if ext == "mp4" and data[4:8] not in (b"ftyp", b"moov", b"mdat"):
        return "blocked", "File content does not match .mp4 format."
    if ext in ("zip", "epub", "3mf"):
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                total_uncompressed = 0
                for info in z.infolist():
                    member_ext = info.filename.rsplit(".", 1)[-1].lower() \
                        if "." in info.filename else ""
                    if member_ext in _DANGEROUS_MEMBER_EXTS:
                        return "blocked", f"Archive contains a blocked file type (.{member_ext})."
                    total_uncompressed += info.file_size
                if total_uncompressed > 2 * 1024 * 1024 * 1024:
                    return "blocked", "Archive expands beyond the 2GB safety limit."
                if len(data) > 0 and total_uncompressed / max(len(data), 1) > 300:
                    return "blocked", "Archive compression ratio is suspicious (zip bomb)."
        except zipfile.BadZipFile:
            return "blocked", "Corrupt or invalid archive."
        except Exception:
            return "blocked", "Archive could not be inspected."
    return "clean", ""


# ── Chunked upload flow ───────────────────────────────────────────────────────

class UploadInit(BaseModel):
    filename: str = Field(min_length=1, max_length=200)
    size_bytes: int = Field(gt=0, le=MAX_FILE_BYTES)
    total_chunks: int = Field(gt=0, le=64)
    replace_file_id: Optional[str] = None   # versioned replacement target
    release_notes: Optional[str] = Field(default=None, max_length=1000)


async def _own_digital_listing(product_slug: str, maker_slug: str) -> dict:
    prod = await db.products.find_one({"slug": product_slug}, {"_id": 0})
    if not prod:
        raise HTTPException(404, "Product not found.")
    if prod.get("maker_slug") != maker_slug:
        raise HTTPException(403, "You can only edit your own listings.")
    if prod.get("listing_type") not in ("digital", "both"):
        raise HTTPException(400, "Switch this listing to 'digital' or 'both' first.")
    return prod


@router.post("/maker/listings/{product_slug}/digital-uploads/init")
async def digital_upload_init(product_slug: str, body: UploadInit,
                              slug: str = Depends(current_maker_slug)):
    prod = await _own_digital_listing(product_slug, slug)
    ext = body.filename.rsplit(".", 1)[-1].lower() if "." in body.filename else ""
    if ext not in ALLOWED_EXTS:
        raise HTTPException(400, f".{ext or '?'} files aren't supported. "
                                 f"Allowed: {', '.join(sorted(ALLOWED_EXTS))}")
    files = prod.get("digital_files") or []
    if body.replace_file_id:
        if not any(f.get("id") == body.replace_file_id for f in files):
            raise HTTPException(404, "File to replace not found on this listing.")
    elif len(files) >= MAX_FILES_PER_LISTING and len(files) < 10:
        # 10-file legacy listings are grandfathered; new cap is 5.
        raise HTTPException(400, f"Maximum {MAX_FILES_PER_LISTING} files per listing.")
    elif len(files) >= 10:
        raise HTTPException(400, "Maximum files per listing reached.")

    upload_id = uuid.uuid4().hex
    os.makedirs(f"{CHUNK_ROOT}/{upload_id}", exist_ok=True)
    await db.digital_upload_sessions.insert_one({
        "id": upload_id, "maker_slug": slug, "product_slug": product_slug,
        "filename": body.filename, "ext": ext, "size_bytes": body.size_bytes,
        "total_chunks": body.total_chunks,
        "replace_file_id": body.replace_file_id,
        "release_notes": (body.release_notes or "").strip() or None,
        "received": [], "created_at": now_iso(),
    })
    return {"upload_id": upload_id, "chunk_bytes_max": MAX_CHUNK_BYTES}


async def _upload_session(upload_id: str, maker_slug: str) -> dict:
    sess = await db.digital_upload_sessions.find_one({"id": upload_id}, {"_id": 0})
    if not sess or sess["maker_slug"] != maker_slug:
        raise HTTPException(404, "Upload session not found.")
    return sess


@router.put("/maker/listings/{product_slug}/digital-uploads/{upload_id}/chunks/{index}")
async def digital_upload_chunk(product_slug: str, upload_id: str, index: int,
                               request: Request,
                               slug: str = Depends(current_maker_slug)):
    sess = await _upload_session(upload_id, slug)
    if index < 0 or index >= sess["total_chunks"]:
        raise HTTPException(400, "Chunk index out of range.")
    data = await request.body()
    if not data or len(data) > MAX_CHUNK_BYTES:
        raise HTTPException(400, "Chunk empty or too large.")
    with open(f"{CHUNK_ROOT}/{upload_id}/{index}", "wb") as f:
        f.write(data)
    await db.digital_upload_sessions.update_one(
        {"id": upload_id}, {"$addToSet": {"received": index}})
    return {"ok": True, "index": index}


@router.post("/maker/listings/{product_slug}/digital-uploads/{upload_id}/complete")
async def digital_upload_complete(product_slug: str, upload_id: str,
                                  slug: str = Depends(current_maker_slug)):
    sess = await _upload_session(upload_id, slug)
    prod = await _own_digital_listing(product_slug, slug)

    missing = [i for i in range(sess["total_chunks"])
               if not os.path.exists(f"{CHUNK_ROOT}/{upload_id}/{i}")]
    if missing:
        raise HTTPException(400, f"Missing chunks: {missing[:5]}")

    buf = io.BytesIO()
    for i in range(sess["total_chunks"]):
        with open(f"{CHUNK_ROOT}/{upload_id}/{i}", "rb") as f:
            buf.write(f.read())
    data = buf.getvalue()
    shutil.rmtree(f"{CHUNK_ROOT}/{upload_id}", ignore_errors=True)
    await db.digital_upload_sessions.delete_one({"id": upload_id})
    if len(data) > MAX_FILE_BYTES:
        raise HTTPException(400, "Assembled file exceeds the 100MB limit.")

    ext = sess["ext"]
    status, reason = scan_digital_file(data, ext)
    if status == "blocked":
        raise HTTPException(422, f"File failed the security scan: {reason}")

    from r2_storage import is_configured as r2_ok, upload_bytes
    if not r2_ok():
        raise HTTPException(503, "Storage is not configured.")
    key = f"digital-listings/{slug}/{product_slug}/{uuid.uuid4().hex}.{ext}"
    try:
        url = upload_bytes(data, key, MIME_BY_EXT.get(ext, "application/octet-stream"),
                           cache_control="private, max-age=0",
                           max_bytes=MAX_FILE_BYTES)
    except Exception as e:
        logger.exception("[digital-uploads] storage put failed: %s", e)
        raise HTTPException(502, "Could not store the file.")

    scan = {"status": "clean", "engine": "heuristic-v1", "scanned_at": now_iso()}
    if sess.get("replace_file_id"):
        files = prod.get("digital_files") or []
        entry = next((f for f in files if f.get("id") == sess["replace_file_id"]), None)
        if not entry:
            raise HTTPException(404, "File to replace no longer exists.")
        prev_version = int(entry.get("version") or 1)
        versions = entry.get("versions") or [{
            "version": prev_version, "url": entry.get("url"),
            "size_bytes": entry.get("size_bytes"),
            "uploaded_at": entry.get("uploaded_at"), "release_notes": None}]
        new_version = prev_version + 1
        versions.append({"version": new_version, "url": url,
                         "size_bytes": len(data), "uploaded_at": now_iso(),
                         "release_notes": sess.get("release_notes")})
        updated = {**entry, "filename": sess["filename"][:200], "ext": ext,
                   "size_bytes": len(data), "url": url, "version": new_version,
                   "versions": versions, "scan": scan, "uploaded_at": now_iso()}
        await db.products.update_one(
            {"slug": product_slug, "digital_files.id": entry["id"]},
            {"$set": {"digital_files.$": updated}})
        return updated

    entry = {
        "id": str(uuid.uuid4()), "filename": sess["filename"][:200],
        "size_bytes": len(data), "content_type": MIME_BY_EXT.get(ext, ""),
        "ext": ext, "url": url, "version": 1,
        "versions": [{"version": 1, "url": url, "size_bytes": len(data),
                      "uploaded_at": now_iso(), "release_notes": None}],
        "scan": scan, "uploaded_at": now_iso(),
    }
    await db.products.update_one(
        {"slug": product_slug}, {"$push": {"digital_files": entry}})
    return entry


# ── Per-listing delivery settings ────────────────────────────────────────────

class DeliverySettings(BaseModel):
    download_limit: Optional[int] = Field(default=None, ge=1, le=1000)
    download_ttl_days: Optional[int] = Field(default=None, ge=1, le=365)
    clear_limit: bool = False


@router.patch("/maker/listings/{product_slug}/digital-settings")
async def digital_settings(product_slug: str, body: DeliverySettings,
                           slug: str = Depends(current_maker_slug)):
    await _own_digital_listing(product_slug, slug)
    updates: dict = {}
    if body.clear_limit:
        updates["download_limit"] = None
    elif body.download_limit is not None:
        updates["download_limit"] = body.download_limit
    if body.download_ttl_days is not None:
        updates["download_ttl_days"] = body.download_ttl_days
    if updates:
        await db.products.update_one({"slug": product_slug}, {"$set": updates})
    prod = await db.products.find_one(
        {"slug": product_slug}, {"_id": 0, "download_limit": 1, "download_ttl_days": 1})
    return {"ok": True, **prod}


# ── Buyer Purchases (re-download forever) ────────────────────────────────────

def _email_of(claims: dict) -> str:
    return (claims.get("email") or "").lower().strip()


async def _owned_tx(session_id: str, email: str) -> dict:
    tx = await db.payment_transactions.find_one(
        {"session_id": session_id}, {"_id": 0})
    if not tx or (tx.get("customer_email") or "").lower().strip() != email:
        raise HTTPException(404, "Purchase not found on this account.")
    if tx.get("payment_status") != "paid":
        raise HTTPException(403, "This order isn't paid.")
    return tx


@router.get("/buyer/purchases")
async def buyer_purchases(claims: dict = Depends(current_buyer)):
    """Every paid order on this buyer's email that carries digital files."""
    email = _email_of(claims)
    if not email:
        raise HTTPException(400, "No email on this account.")
    rows = await db.payment_transactions.find(
        {"payment_status": "paid", "digital_downloads.0": {"$exists": True}},
        {"_id": 0, "session_id": 1, "created_at": 1, "amount": 1,
         "customer_email": 1, "digital_downloads": 1, "summary": 1},
    ).sort("created_at", -1).to_list(500)
    mine = []
    for tx in rows:
        if (tx.get("customer_email") or "").lower().strip() != email:
            continue
        mine.append({
            "session_id": tx["session_id"], "created_at": tx.get("created_at"),
            "amount": tx.get("amount"), "summary": tx.get("summary"),
            "files": [{
                "file_id": f.get("file_id"), "filename": f.get("filename"),
                "ext": f.get("ext"), "size_bytes": f.get("size_bytes"),
                "product_slug": f.get("product_slug"),
                "product_title": f.get("product_title"),
                "downloads": f.get("downloads") or 0,
                "last_downloaded_at": f.get("last_downloaded_at"),
            } for f in tx.get("digital_downloads") or []],
        })
    return {"purchases": mine}


@router.post("/buyer/purchases/{session_id}/download-links")
async def buyer_fresh_links(session_id: str, claims: dict = Depends(current_buyer)):
    """Re-mint fresh signed links — legitimate buyers never lose access."""
    email = _email_of(claims)
    tx = await _owned_tx(session_id, email)
    from digital_delivery import mint_download_token, DOWNLOAD_TTL_SECONDS
    import time
    links = []
    ttl_cache: dict[str, int] = {}
    for f in tx.get("digital_downloads") or []:
        pslug = f.get("product_slug") or ""
        if pslug not in ttl_cache:
            p = await db.products.find_one(
                {"slug": pslug}, {"_id": 0, "download_ttl_days": 1}) or {}
            ttl_cache[pslug] = int(p.get("download_ttl_days") or 30) * 24 * 3600
        token, exp = mint_download_token(
            session_id, f["file_id"],
            expires_at_unix=int(time.time() + ttl_cache[pslug]))
        links.append({"file_id": f["file_id"], "filename": f.get("filename"),
                      "product_title": f.get("product_title"),
                      "token": token, "expires_at_unix": exp})
    return {"links": links}


@router.get("/buyer/purchases/{session_id}/download-history")
async def buyer_download_history(session_id: str,
                                 claims: dict = Depends(current_buyer)):
    await _owned_tx(session_id, _email_of(claims))
    rows = await db.download_history.find(
        {"session_id": session_id}, {"_id": 0}).sort("at", -1).to_list(200)
    return {"history": rows}
