"""Maker → CSV review import (iter183).

Both Etsy and Shopify let shop owners export reviews to CSV from their
admin dashboards (Etsy: Shop Manager → Stats → Reviews → Download;
Shopify reviews apps like Judge.me / Yotpo / Stamped all export CSV).
This router lets a maker upload that CSV here so their full track record
shows up alongside native Crafters Market reviews — flagged with an
"Imported from Etsy" badge for transparency.

Endpoints:
  • POST   /api/maker/reviews/import          — multipart CSV upload
  • GET    /api/maker/reviews/imports         — list past batches
  • PATCH  /api/maker/reviews/imports/{batch} — toggle public visibility
  • DELETE /api/maker/reviews/imports/{batch} — undo a batch

CSV format (header-tolerant — case-insensitive, accepts common synonyms):
    date,name,rating,text,product
Synonyms accepted:
    date     → created_at, time, review_date
    name     → reviewer_name, buyer, buyer_username, customer, author
    rating   → stars, score
    text     → review, body, comment, content, message
    product  → product_slug, product_handle, item, listing

Star ratings outside 1-5 get clamped. Empty rating rows are skipped.
Duplicate detection: (date + reviewer + first 50 chars of text) hash —
re-uploading the same CSV will skip every row instead of double-posting.
"""
from __future__ import annotations

import csv
import hashlib
import io
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import (
    APIRouter, Body, Depends, File, Form, HTTPException, UploadFile,
)
from pydantic import BaseModel

from core import db, logger, now_iso
from maker_auth import current_maker_slug

router = APIRouter()

# ---------------- CSV header normalization ---------------------------------

_HEADER_SYNONYMS: dict[str, set[str]] = {
    "date":    {"date", "created_at", "time", "review_date", "review date", "timestamp"},
    "name":    {"name", "reviewer_name", "reviewer", "buyer", "buyer_username",
                "buyer username", "customer", "customer_name", "author"},
    "rating":  {"rating", "stars", "score", "review_rating"},
    "text":    {"text", "review", "body", "comment", "content", "message",
                "review_body", "review_text"},
    "product": {"product", "product_slug", "product_handle", "item", "listing",
                "item_title", "product_name", "item title"},
}

_MAX_ROWS = 5000          # upload cap — refuse files bigger than this
_MAX_BYTES = 5 * 1024 * 1024   # 5 MB hard cap
_ALLOWED_SOURCES = {"etsy", "shopify", "csv"}


def _normalize_header(raw: str) -> Optional[str]:
    """Return the canonical column name (`date`, `name`, …) for a raw CSV
    header, or None when the header isn't one we recognize."""
    k = (raw or "").strip().lower().replace("-", "_").replace(" ", "_")
    for canonical, syns in _HEADER_SYNONYMS.items():
        if k in syns or k == canonical:
            return canonical
    return None


def _parse_rating(raw) -> Optional[int]:
    """Extract an int 1..5 from a noisy rating cell. Strips text like
    '5 stars' or '4/5' before parsing. Returns None when unparseable."""
    if raw is None:
        return None
    s = str(raw).strip()
    if not s:
        return None
    # Pull the first integer in the string.
    digits = ""
    for ch in s:
        if ch.isdigit():
            digits += ch
        elif digits:
            break
    if not digits:
        return None
    try:
        n = int(digits)
    except ValueError:
        return None
    return max(1, min(5, n))


def _parse_date(raw) -> str:
    """Best-effort date parse. Accepts ISO-8601, common Etsy / Shopify
    formats, or just returns the raw string when nothing else works
    (the value still ends up in db.reviews so it's never lost — sort
    order may just be off for unparseable rows)."""
    s = (raw or "").strip()
    if not s:
        return now_iso()
    # Try ISO first.
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return dt.astimezone(timezone.utc).isoformat()
    except Exception:
        pass
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y",
                "%d/%m/%Y", "%b %d, %Y", "%B %d, %Y"):
        try:
            dt = datetime.strptime(s, fmt).replace(tzinfo=timezone.utc)
            return dt.isoformat()
        except ValueError:
            continue
    return s   # last resort — keep the raw string


def _row_dedupe_hash(date_iso: str, name: str, text: str) -> str:
    """Stable hash so re-uploading the same CSV skips every row.
    Keyed on the date day + reviewer name + first 50 chars of text —
    enough specificity that two real reviews never collide, but stable
    against whitespace / formatting changes between exports."""
    day = date_iso[:10] if date_iso else ""
    name_n = (name or "").strip().lower()
    text_n = " ".join((text or "").split())[:50].lower()
    return hashlib.sha256(f"{day}|{name_n}|{text_n}".encode()).hexdigest()[:32]


# ---------------- Upload endpoint ----------------------------------------

@router.post("/maker/reviews/import")
async def maker_review_import(
    file: UploadFile = File(...),
    source: str = Form("csv"),
    published_publicly: bool = Form(True),
    slug: str = Depends(current_maker_slug),
):
    """Upload a CSV export of reviews from Etsy / Shopify / any platform
    and import them under the signed-in maker."""
    source = (source or "csv").strip().lower()
    if source not in _ALLOWED_SOURCES:
        raise HTTPException(400, f"source must be one of {sorted(_ALLOWED_SOURCES)}")

    raw = await file.read()
    if not raw:
        raise HTTPException(400, "Empty file.")
    if len(raw) > _MAX_BYTES:
        raise HTTPException(413, f"File too large (cap {_MAX_BYTES // 1024 // 1024} MB).")

    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        try:
            text = raw.decode("latin-1")
        except Exception:
            raise HTTPException(400, "Couldn't decode CSV — save as UTF-8 and try again.")

    reader = csv.reader(io.StringIO(text))
    try:
        header = next(reader)
    except StopIteration:
        raise HTTPException(400, "CSV has no rows.")

    # Map header positions to canonical column names.
    col_map: dict[str, int] = {}
    for i, h in enumerate(header):
        canonical = _normalize_header(h)
        if canonical and canonical not in col_map:
            col_map[canonical] = i

    missing = [c for c in ("name", "rating", "text") if c not in col_map]
    if missing:
        raise HTTPException(
            422,
            f"CSV is missing required columns: {', '.join(missing)}. "
            f"At minimum the file needs columns for reviewer name, rating, "
            f"and review text. Accepted header synonyms: "
            f"{', '.join(sorted(_HEADER_SYNONYMS['name'] | _HEADER_SYNONYMS['rating'] | _HEADER_SYNONYMS['text']))}",
        )

    batch_id = str(uuid.uuid4())
    imported_at = now_iso()

    # Pre-load existing dedupe hashes for THIS maker so we can skip
    # duplicates in a single round-trip.
    existing_hashes = {
        r.get("dedupe_hash")
        for r in await db.reviews.find(
            {"maker_slug": slug, "dedupe_hash": {"$exists": True}},
            {"_id": 0, "dedupe_hash": 1},
        ).to_list(50_000)
        if r.get("dedupe_hash")
    }

    inserted = 0
    skipped_dup = 0
    errors: list[dict] = []
    docs_to_insert: list[dict] = []
    batch_hashes: set[str] = set()  # also de-dupe within the same upload

    for line_no, row in enumerate(reader, start=2):  # header was line 1
        if line_no - 1 > _MAX_ROWS:
            errors.append({"line": line_no, "error": f"Row cap {_MAX_ROWS} exceeded — extra rows skipped."})
            break
        if not row or not any((c or "").strip() for c in row):
            continue   # blank line

        def _cell(col: str) -> str:
            i = col_map.get(col)
            if i is None or i >= len(row):
                return ""
            return (row[i] or "").strip()

        name = _cell("name")[:80]
        rating = _parse_rating(_cell("rating"))
        text_val = _cell("text")[:1500]
        if not name or not rating or not text_val:
            errors.append({
                "line": line_no,
                "error": "missing name, rating, or text",
            })
            continue

        date_iso = _parse_date(_cell("date"))
        product_slug = _cell("product")[:120] or None

        dedupe = _row_dedupe_hash(date_iso, name, text_val)
        if dedupe in existing_hashes or dedupe in batch_hashes:
            skipped_dup += 1
            continue
        batch_hashes.add(dedupe)

        docs_to_insert.append({
            "id": str(uuid.uuid4()),
            "name": name,
            "location": "",
            "rating": rating,
            "text": text_val,
            "product_slug": product_slug,
            "maker_slug": slug,
            "created_at": date_iso,
            "maker_response": None,
            "maker_response_at": None,
            "dispute_status": None,
            "dispute_id": None,
            "source": source,
            "imported_at": imported_at,
            "imported_batch_id": batch_id,
            "published_publicly": bool(published_publicly),
            "dedupe_hash": dedupe,
        })

    if docs_to_insert:
        await db.reviews.insert_many(docs_to_insert)
        inserted = len(docs_to_insert)

    # Persist a batch summary row so the dashboard can list past imports
    # without rescanning the reviews collection.
    await db.review_import_batches.insert_one({
        "batch_id": batch_id,
        "maker_slug": slug,
        "source": source,
        "filename": file.filename or "upload.csv",
        "imported_at": imported_at,
        "inserted": inserted,
        "skipped_duplicates": skipped_dup,
        "errors": errors[:50],   # cap so a malformed file doesn't bloat the doc
        "error_count": len(errors),
        "published_publicly": bool(published_publicly),
    })
    logger.info(
        "[review_import] maker=%s source=%s file=%s inserted=%d dup=%d errors=%d",
        slug, source, file.filename, inserted, skipped_dup, len(errors),
    )
    return {
        "batch_id": batch_id,
        "source": source,
        "inserted": inserted,
        "skipped_duplicates": skipped_dup,
        "error_count": len(errors),
        "errors": errors[:20],   # only return the first 20 to the UI
        "published_publicly": bool(published_publicly),
    }


# ---------------- Batch management ---------------------------------------

@router.get("/maker/reviews/imports")
async def maker_review_imports_list(slug: str = Depends(current_maker_slug)):
    """List the maker's past import batches, newest first."""
    rows = await db.review_import_batches.find(
        {"maker_slug": slug}, {"_id": 0},
    ).sort("imported_at", -1).to_list(200)
    return {"items": rows, "count": len(rows)}


class _PatchBatch(BaseModel):
    published_publicly: bool


@router.patch("/maker/reviews/imports/{batch_id}")
async def maker_review_import_patch(
    batch_id: str,
    payload: _PatchBatch = Body(...),
    slug: str = Depends(current_maker_slug),
):
    """Toggle the public visibility of every review in a batch."""
    batch = await db.review_import_batches.find_one(
        {"batch_id": batch_id, "maker_slug": slug}, {"_id": 0},
    )
    if not batch:
        raise HTTPException(404, "Batch not found.")
    await db.reviews.update_many(
        {"imported_batch_id": batch_id, "maker_slug": slug},
        {"$set": {"published_publicly": bool(payload.published_publicly)}},
    )
    await db.review_import_batches.update_one(
        {"batch_id": batch_id, "maker_slug": slug},
        {"$set": {"published_publicly": bool(payload.published_publicly)}},
    )
    return {"ok": True, "batch_id": batch_id,
            "published_publicly": bool(payload.published_publicly)}


@router.delete("/maker/reviews/imports/{batch_id}")
async def maker_review_import_delete(
    batch_id: str,
    slug: str = Depends(current_maker_slug),
):
    """Undo a batch — deletes every review row in it AND the batch summary.
    Native reviews (`source` is None) are never touched."""
    batch = await db.review_import_batches.find_one(
        {"batch_id": batch_id, "maker_slug": slug}, {"_id": 0},
    )
    if not batch:
        raise HTTPException(404, "Batch not found.")
    result = await db.reviews.delete_many({
        "imported_batch_id": batch_id, "maker_slug": slug,
        "source": {"$ne": None},   # belt-and-suspenders: never touch native rows
    })
    await db.review_import_batches.delete_one({"batch_id": batch_id, "maker_slug": slug})
    return {"ok": True, "batch_id": batch_id, "deleted": result.deleted_count}



# ============================================================================
# Support-fallback CSV forward (iter185)
# ----------------------------------------------------------------------------
# When a maker can't get the regular CSV upload working (busted Etsy
# export, weird headers, fragmented data across multiple files, etc.),
# they tap this button to ship the file straight to the support inbox
# along with a freeform note. Support handles the import manually and
# replies via email. Turns "I give up" moments into a 5-minute touch.
# ============================================================================

SUPPORT_INBOX = "team@craftersmarket.org"


@router.post("/maker/reviews/import/send-to-support")
async def maker_review_import_send_to_support(
    file: UploadFile = File(...),
    note: str = Form(""),
    slug: str = Depends(current_maker_slug),
):
    """Forward a CSV file to the support inbox with a note from the maker.
    Used as a fallback when the auto-import flow can't parse the file."""
    raw = await file.read()
    if not raw:
        raise HTTPException(400, "Empty file.")
    if len(raw) > _MAX_BYTES:
        raise HTTPException(413, f"File too large (cap {_MAX_BYTES // 1024 // 1024} MB).")

    # Pull a friendly maker name + email so support can reply directly.
    maker = await db.makers.find_one(
        {"slug": slug}, {"_id": 0, "name": 1, "email": 1, "contact_email": 1},
    ) or {}
    maker_name = maker.get("name") or slug
    reply_to = (maker.get("contact_email") or maker.get("email") or "").strip() or None

    note_clean = (note or "").strip()[:2000]
    filename = file.filename or "reviews.csv"

    subject = f"[Review CSV] {maker_name} ({slug}) needs import help"
    html = (
        f"<p><b>Maker:</b> {maker_name} (<code>{slug}</code>)</p>"
        f"<p><b>File:</b> {filename} · {len(raw)} bytes</p>"
        f"<p><b>Reply-to:</b> {reply_to or '— not on file —'}</p>"
        f"<p><b>Maker note:</b></p>"
        f"<pre style='white-space:pre-wrap;font-family:ui-monospace,monospace;background:#f6f6f6;padding:12px;border:1px solid #ddd'>{(note_clean or '(no note provided)')}</pre>"
        f"<hr/>"
        f"<p style='font-size:11px;color:#888'>Forwarded from the maker dashboard "
        f"Review-Import fallback. Reply directly to this email to reach the maker.</p>"
    )

    from email_service import send_mailgun_with_attachment
    result = await send_mailgun_with_attachment(
        to=SUPPORT_INBOX,
        subject=subject,
        html=html,
        attachment_bytes=raw,
        attachment_filename=filename,
        attachment_mime=file.content_type or "text/csv",
        reply_to=reply_to,
    )

    # Audit log — even on failure, so support knows the maker tried.
    await db.review_import_support_requests.insert_one({
        "maker_slug": slug,
        "filename": filename,
        "size_bytes": len(raw),
        "note": note_clean,
        "reply_to": reply_to,
        "created_at": now_iso(),
        "ok": bool(result.get("ok")),
        "message_id": result.get("message_id"),
        "error": result.get("error"),
    })

    if not result.get("ok"):
        logger.warning("[review_import.support] send failed maker=%s: %s",
                       slug, result.get("error"))
        # Surface a generic message — the maker shouldn't need to know
        # whether Mailgun is misconfigured, just that we'll retry.
        raise HTTPException(
            502,
            "Couldn't reach our support inbox right now. Email "
            f"{SUPPORT_INBOX} directly with your CSV attached and we'll handle it.",
        )

    logger.info("[review_import.support] forwarded CSV to %s for maker=%s file=%s",
                SUPPORT_INBOX, slug, filename)
    return {"ok": True, "support_email": SUPPORT_INBOX,
            "message_id": result.get("message_id")}
