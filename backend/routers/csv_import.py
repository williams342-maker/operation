"""CSV import for migrating from Etsy (and later Shopify) to Crafters Market.

Phase 2 scope: Etsy CSV format → dry-run preview → commit.

Etsy export format columns (verified Apr 2026):
  TITLE, DESCRIPTION, PRICE, CURRENCY_CODE, QUANTITY, TAGS, MATERIALS,
  IMAGE1..IMAGE10, VARIATIONS, SKU, ...

We map only the universally useful columns. Images are imported as URLs —
makers paste in image hosts they control or we accept R2-uploaded URLs.
Phase 2.5 can add a "fetch + reupload to R2" worker if needed.
"""
from __future__ import annotations

import csv
import io
import re
import secrets
from typing import List

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from core import db, logger, now_iso
from maker_auth import current_maker_slug

router = APIRouter()


def _slugify(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")
    return s[:60] or f"item-{secrets.token_hex(3)}"


def _parse_etsy_row(row: dict) -> dict | None:
    """Map an Etsy CSV row to a Crafters Market product dict.
    Returns None if the row is unusable (no title or no price)."""
    title = (row.get("TITLE") or row.get("Title") or "").strip()
    if not title:
        return None
    try:
        price = float(str(row.get("PRICE") or row.get("Price") or "0").replace("$", "").replace(",", ""))
    except (ValueError, TypeError):
        return None
    if price <= 0:
        return None
    description = (row.get("DESCRIPTION") or row.get("Description") or "").strip()[:4000]
    tags_raw = (row.get("TAGS") or row.get("Tags") or "")
    tags = [t.strip().lower() for t in re.split(r"[,;|]", tags_raw) if t.strip()][:13]
    quantity = 1
    try:
        quantity = max(1, int(row.get("QUANTITY") or row.get("Quantity") or 1))
    except (ValueError, TypeError):
        pass
    images: List[str] = []
    for i in range(1, 11):
        v = row.get(f"IMAGE{i}") or row.get(f"Image{i}") or ""
        v = (v or "").strip()
        if v.startswith(("http://", "https://")):
            images.append(v)
    materials_raw = (row.get("MATERIALS") or row.get("Materials") or "")
    materials = [m.strip() for m in re.split(r"[,;|]", materials_raw) if m.strip()][:8]
    return {
        "_source_title": title,
        "title": title[:80],
        "description": description,
        "price": round(price, 2),
        "stock": quantity,
        "tags": tags,
        "materials": materials,
        "image_urls": images,
        "category": "uncategorized",
    }


@router.post("/maker/csv-import/preview")
async def csv_import_preview(
    file: UploadFile = File(...),
    source: str = Form("etsy"),
    slug: str = Depends(current_maker_slug),
):
    """Dry-run: parse the CSV, return the first 50 rows + counts. Nothing
    is written to the database. Maker reviews + clicks Commit on the
    frontend to actually create the listings."""
    if source.lower() != "etsy":
        raise HTTPException(400, "Only Etsy CSV is supported in this release. Shopify is coming.")
    raw = await file.read()
    if len(raw) > 5 * 1024 * 1024:
        raise HTTPException(413, "CSV too large (max 5MB).")
    try:
        text = raw.decode("utf-8-sig", errors="ignore")
    except Exception:
        raise HTTPException(400, "CSV must be UTF-8 encoded.")
    reader = csv.DictReader(io.StringIO(text))
    parsed: List[dict] = []
    skipped = 0
    for i, row in enumerate(reader):
        if i >= 200:  # cap preview at 200 rows so a 5MB CSV doesn't lag the UI
            break
        m = _parse_etsy_row(row)
        if m is None:
            skipped += 1
            continue
        parsed.append(m)
    return {
        "preview_rows": parsed[:50],
        "total_parsed": len(parsed),
        "total_skipped": skipped,
        "source": source.lower(),
        "ready_to_commit": len(parsed),
    }


class CsvCommitIn(BaseModel):
    rows: List[dict]
    publish_status: str = "draft"  # 'draft' | 'active'


@router.post("/maker/csv-import/commit")
async def csv_import_commit(payload: CsvCommitIn, slug: str = Depends(current_maker_slug)):
    """Insert the preview rows as products. Default status is 'draft' so
    makers can review each listing before publishing en masse."""
    status = payload.publish_status if payload.publish_status in ("draft", "active") else "draft"
    inserted = 0
    failed = 0
    docs = []
    for r in payload.rows[:500]:  # hard cap of 500 per import
        try:
            base_slug = _slugify(r.get("title", ""))
            unique = f"{base_slug}-{secrets.token_hex(3)}"
            docs.append({
                "id": secrets.token_urlsafe(10),
                "slug": unique,
                "maker_slug": slug,
                "title": r.get("title", "")[:80],
                "description": r.get("description", "")[:4000],
                "price": float(r.get("price") or 0),
                "stock": int(r.get("stock") or 1),
                "tags": (r.get("tags") or [])[:13],
                "materials": (r.get("materials") or [])[:8],
                "image_urls": (r.get("image_urls") or [])[:10],
                "category": (r.get("category") or "uncategorized").lower()[:40],
                "status": status,
                "imported_from": "etsy_csv",
                "created_at": now_iso(),
                "deleted_at": None,
            })
        except Exception as e:
            logger.exception("[csv] row failed: %s", e)
            failed += 1
    if docs:
        try:
            await db.products.insert_many(docs)
            inserted = len(docs)
        except Exception as e:
            logger.exception("[csv] insert_many failed: %s", e)
            raise HTTPException(500, "Could not insert listings — try a smaller batch.")
    await db.audit_log.insert_one({
        "kind": "csv_import",
        "maker_slug": slug,
        "source": "etsy",
        "inserted": inserted,
        "failed": failed,
        "publish_status": status,
        "created_at": now_iso(),
    })
    logger.info("[csv] imported %d, failed %d for maker=%s", inserted, failed, slug)
    return {"inserted": inserted, "failed": failed, "status": status}
