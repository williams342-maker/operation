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


def _parse_shopify_row(row: dict, by_handle: dict[str, list[dict]] | None = None) -> dict | None:
    """Map a Shopify product-export CSV row to a Crafters Market product dict.

    Shopify exports one row per *variant*; products are grouped by the
    `Handle` column. The first row of a handle carries the canonical
    Title/Body/Tags/Vendor/Type fields; subsequent rows often have only
    variant-level info. We treat the FIRST row per handle as the source of
    truth and aggregate variant inventory + image URLs across all rows."""
    handle = (row.get("Handle") or "").strip().lower()
    title = (row.get("Title") or "").strip()
    if not handle and not title:
        return None
    # Only emit a product on the first (or only) row of a handle.
    if by_handle is not None and handle:
        first = by_handle[handle][0]
        if row is not first:
            return None
    if not title:
        return None
    body = (row.get("Body (HTML)") or row.get("Body") or "").strip()
    # Strip HTML tags lightly — full sanitization happens server-side later.
    description = re.sub(r"<[^>]+>", " ", body)
    description = re.sub(r"\s+", " ", description).strip()[:4000]
    try:
        price = float(str(row.get("Variant Price") or row.get("Price") or "0").replace("$", "").replace(",", ""))
    except (ValueError, TypeError):
        return None
    if price <= 0:
        # Sum variant-level inventory across the handle group; pick first non-zero price.
        if by_handle and handle:
            for sib in by_handle[handle]:
                try:
                    p2 = float(str(sib.get("Variant Price") or 0).replace("$", "").replace(",", ""))
                    if p2 > 0:
                        price = p2
                        break
                except (ValueError, TypeError):
                    continue
        if price <= 0:
            return None
    tags_raw = (row.get("Tags") or "")
    tags = [t.strip().lower() for t in re.split(r"[,;|]", tags_raw) if t.strip()][:13]
    # Aggregate inventory across variants; default to 1 if missing.
    quantity = 0
    siblings = (by_handle or {}).get(handle, [row]) if handle else [row]
    for sib in siblings:
        try:
            quantity += max(0, int(sib.get("Variant Inventory Qty") or 0))
        except (ValueError, TypeError):
            continue
    if quantity == 0:
        quantity = 1
    # Image URLs — Shopify uses one per row; collapse across the handle.
    images: List[str] = []
    seen = set()
    for sib in siblings:
        v = (sib.get("Image Src") or "").strip()
        if v.startswith(("http://", "https://")) and v not in seen:
            seen.add(v); images.append(v)
        if len(images) >= 10:
            break
    # Type/Vendor → category fallback ladder
    category = (
        (row.get("Type") or "").strip()
        or (row.get("Product Category") or "").strip()
        or "uncategorized"
    ).lower()[:40]
    return {
        "_source_title": title,
        "title": title[:80],
        "description": description,
        "price": round(price, 2),
        "stock": quantity,
        "tags": tags,
        "materials": [],          # Shopify has no materials column out of the box
        "image_urls": images,
        "category": category,
    }


def _group_shopify_rows(reader: csv.DictReader) -> tuple[dict[str, list[dict]], list[dict]]:
    """Read all rows once, group by Handle, return (handle→rows[], all_rows[]).
    Reading once + indexing is required because Shopify's variant rows must
    be aggregated to compute total inventory + collect every image URL."""
    rows = list(reader)
    grouped: dict[str, list[dict]] = {}
    for r in rows:
        h = (r.get("Handle") or "").strip().lower()
        if not h:
            continue
        grouped.setdefault(h, []).append(r)
    return grouped, rows


@router.post("/maker/csv-import/preview")
async def csv_import_preview(
    file: UploadFile = File(...),
    source: str = Form("etsy"),
    slug: str = Depends(current_maker_slug),
):
    """Dry-run: parse the CSV, return the first 50 rows + counts. Nothing
    is written to the database. Maker reviews + clicks Commit on the
    frontend to actually create the listings."""
    src = source.lower().strip()
    if src not in ("etsy", "shopify"):
        raise HTTPException(400, "source must be 'etsy' or 'shopify'.")
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

    if src == "shopify":
        # Shopify rows are variant-grained — group, then emit once per handle.
        by_handle, all_rows = _group_shopify_rows(reader)
        # Emit unique products; a row that's not the first of its handle is silently merged.
        seen_handles: set[str] = set()
        for i, row in enumerate(all_rows):
            if i >= 1500:  # 5MB CSVs can have a lot of variant rows
                break
            handle = (row.get("Handle") or "").strip().lower()
            if handle and handle in seen_handles:
                continue
            m = _parse_shopify_row(row, by_handle if handle else None)
            if m is None:
                if not handle:  # only count truly unusable rows as skipped
                    skipped += 1
                continue
            if handle:
                seen_handles.add(handle)
            parsed.append(m)
    else:
        for i, row in enumerate(reader):
            if i >= 200:
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
        "source": src,
        "ready_to_commit": len(parsed),
    }


class CsvCommitIn(BaseModel):
    rows: List[dict]
    publish_status: str = "draft"  # 'draft' | 'active'
    source: str = "etsy"           # tracked in audit log


@router.post("/maker/csv-import/commit")
async def csv_import_commit(payload: CsvCommitIn, slug: str = Depends(current_maker_slug)):
    """Insert the preview rows as products. Default status is 'draft' so
    makers can review each listing before publishing en masse."""
    status = payload.publish_status if payload.publish_status in ("draft", "active") else "draft"
    src = (payload.source or "etsy").lower()
    if src not in ("etsy", "shopify"):
        src = "etsy"
    inserted = 0
    failed = 0
    docs = []
    for r in payload.rows[:500]:
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
                "imported_from": f"{src}_csv",
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
        "source": src,
        "inserted": inserted,
        "failed": failed,
        "publish_status": status,
        "created_at": now_iso(),
    })
    logger.info("[csv] imported %d, failed %d for maker=%s (src=%s)", inserted, failed, slug, src)
    return {"inserted": inserted, "failed": failed, "status": status, "source": src}
