"""iter350 — Pinterest Catalog Sync (Phase 5).

Exposes a TSV product feed at `/api/pinterest/catalog.tsv` that Pinterest's
Business Hub data-source crawler can pull every 24-48 hours. Each row
becomes a Rich Product Pin with live price + availability — buyers see
your inventory in Pinterest visual search and shopping placements with
zero per-pin API plumbing.

Independent of the existing one-off Pin-publishing flow in
`social_publisher.py` (which uses PINTEREST_ACCESS_TOKEN to POST single
pins). This module is pull-based — Pinterest hits a public URL, no token.

Feed format follows Pinterest's spec (mirrors Google Merchant):
  id, title, description, link, image_link, price (NNN.NN CUR),
  availability (in stock|out of stock|preorder), condition (new),
  brand, google_product_category, product_type, item_group_id,
  additional_image_link, color, size

User-side setup (one-time, ~5 min):
  1. Pinterest Business Hub → Ads → Catalogs → Add data source.
  2. Feed URL: https://craftersmarket.org/api/pinterest/catalog.tsv
  3. Format: TSV · Country: US · Language: en · Currency: USD.
  4. Save. Pinterest fetches within 24 h and surfaces Product Pins.

Diagnostic endpoint: GET /api/pinterest/catalog/health → returns last
fetch timestamp + product count for the admin Settings card.
"""
from __future__ import annotations
import csv
import logging
import os
import re
from io import StringIO
from typing import AsyncIterator

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from core import db, now_iso
from maker_auth import current_admin

router = APIRouter()
log = logging.getLogger("crafters.pinterest_catalog")

PUBLIC_SITE_URL = (os.environ.get("PUBLIC_SITE_URL") or "https://craftersmarket.org").rstrip("/")
DEFAULT_CURRENCY = (os.environ.get("PINTEREST_FEED_CURRENCY") or "USD").upper()
# Pinterest = Google Merchant taxonomy. Map our internal `category` strings to
# the closest official Google product category. Keep simple — when in doubt
# the field is omitted (Pinterest auto-classifies from title/description).
GOOGLE_CATEGORY_MAP = {
    "Wall Art":     "Home & Garden > Decor > Artwork > Posters, Prints, & Visual Artwork",
    "Custom Signs": "Home & Garden > Decor > Signs",
    "Outdoor Art":  "Home & Garden > Decor > Artwork",
    "Furniture":    "Home & Garden > Decor > Home Decor Accents",
    "Jewelry":      "Apparel & Accessories > Jewelry",
}

FIELDNAMES = [
    "id", "title", "description", "link", "image_link",
    "additional_image_link", "price", "availability", "condition",
    "brand", "google_product_category", "product_type",
    "item_group_id", "color", "size",
]

# Pinterest forbids tabs/newlines inside TSV fields. Replace defensively.
_BAD_CHARS = re.compile(r"[\t\r\n]+")
# Strip HTML tags from descriptions — Pinterest renders fields as plain
# text and raw HTML would appear as visible angle brackets in pins.
_HTML_TAG_RE = re.compile(r"<[^>]+>")
_UNMAPPED_CATEGORIES_SEEN: set[str] = set()


def _clean(s: str | None, max_len: int = 5000) -> str:
    if not s:
        return ""
    out = _HTML_TAG_RE.sub("", str(s))
    out = _BAD_CHARS.sub(" ", out).strip()
    return out[:max_len]


def _format_price(price: float | int | None) -> str:
    if price is None:
        return ""
    try:
        return f"{float(price):.2f} {DEFAULT_CURRENCY}"
    except (TypeError, ValueError):
        return ""


def _availability(in_stock: int | None, status: str | None) -> str:
    """Map our internal stock signals to Pinterest's spec values.
    Pinterest expects 'in stock' | 'out of stock' | 'preorder'.

    Defaults to 'out of stock' on unparseable input — safer than showing
    a paused/broken item as in-stock and getting an order we can't fulfill
    (per code-review note iter_84 #1)."""
    if (status or "").lower() == "draft":
        return "out of stock"
    if in_stock is None:
        return "in stock"
    try:
        return "in stock" if int(in_stock) > 0 else "out of stock"
    except (TypeError, ValueError):
        return "out of stock"


def _absolutize(url: str | None) -> str:
    """Pinterest requires absolute http(s) URLs for image_link. Resolve
    site-root-relative paths (e.g. /seed-images/foo.jpg) against
    PUBLIC_SITE_URL. Already-absolute URLs pass through unchanged."""
    if not url:
        return ""
    u = str(url).strip()
    if u.startswith("http://") or u.startswith("https://"):
        return u
    if u.startswith("//"):
        return "https:" + u
    if u.startswith("/"):
        return f"{PUBLIC_SITE_URL}{u}"
    return f"{PUBLIC_SITE_URL}/{u}"


def _product_to_row(p: dict, maker: dict | None) -> dict:
    """Flatten one MongoDB product doc to a Pinterest feed row.

    For listings with variants, we emit ONE row per published product (variant
    breakout would require unique variant URLs which we don't expose yet).
    Future enhancement: per-variant rows with shared item_group_id."""
    slug = p.get("slug") or str(p.get("_id") or "")
    title = _clean(p.get("title"), 150)
    description = _clean(p.get("description") or title, 5000)
    link = f"{PUBLIC_SITE_URL}/shop/{slug}"
    images = p.get("images") or ([p.get("image_url")] if p.get("image_url") else [])
    images = [_absolutize(i) for i in images if i]
    primary = images[0] if images else ""
    extras = ",".join(images[1:11]) if len(images) > 1 else ""
    brand = _clean(
        (maker or {}).get("shop_title") or (maker or {}).get("name")
        or p.get("brand") or "Crafters Market",
        100,
    )
    category = p.get("category") or "Wall Art"
    google_cat = GOOGLE_CATEGORY_MAP.get(category, "")
    if not google_cat and category and category not in _UNMAPPED_CATEGORIES_SEEN:
        # Log once per unmapped category so coverage gaps surface in admin
        # logs (per code-review note iter_84 #3) — avoid log spam by tracking
        # what we've already warned about.
        _UNMAPPED_CATEGORIES_SEEN.add(category)
        log.warning(
            "[pinterest-feed] category %r has no GOOGLE_CATEGORY_MAP entry "
            "— emitting empty google_product_category for affected rows. "
            "Add it to GOOGLE_CATEGORY_MAP in routers/pinterest_catalog.py.",
            category,
        )
    # `product_type` = our own taxonomy path. Gives Pinterest internal grouping
    # for shop tabs and improves search match quality.
    technique = (p.get("technique") or "").upper()
    product_type = " > ".join([t for t in (category, technique) if t])

    return {
        "id":                       slug,
        "title":                    title,
        "description":              description,
        "link":                     link,
        "image_link":               primary,
        "additional_image_link":    extras,
        "price":                    _format_price(p.get("price")),
        "availability":             _availability(p.get("in_stock"), p.get("status")),
        "condition":                "new",
        "brand":                    brand,
        "google_product_category":  google_cat,
        "product_type":             product_type,
        # Reserved for future per-variant breakout. Stable parent-SKU pattern.
        "item_group_id":            "",
        "color":                    "",
        "size":                     "",
    }


async def _tsv_stream() -> AsyncIterator[str]:
    """Streams the feed row-by-row. Memory-bounded for large catalogs."""
    buf = StringIO()
    writer = csv.DictWriter(buf, fieldnames=FIELDNAMES, dialect="excel-tab")
    writer.writeheader()
    yield buf.getvalue()
    buf.seek(0)
    buf.truncate(0)

    # Maker lookup cache — keyed by slug. Avoids N+1 round-trips per row.
    maker_cache: dict[str, dict] = {}

    cursor = db.products.find(
        {"status": "published", "deleted_at": None},
        {
            "slug": 1, "title": 1, "description": 1, "images": 1,
            "image_url": 1, "price": 1, "in_stock": 1, "status": 1,
            "category": 1, "technique": 1, "maker_slug": 1, "brand": 1,
        },
    )
    count = 0
    async for p in cursor:
        maker_slug = p.get("maker_slug")
        maker = None
        if maker_slug:
            if maker_slug not in maker_cache:
                m = await db.makers.find_one(
                    {"slug": maker_slug},
                    {"shop_title": 1, "name": 1},
                )
                maker_cache[maker_slug] = m or {}
            maker = maker_cache[maker_slug]
        try:
            row = _product_to_row(p, maker)
            if not row["title"] or not row["image_link"] or not row["price"]:
                # Skip rows missing Pinterest-required fields rather than emit a
                # broken feed that triggers ingestion errors.
                continue
            writer.writerow(row)
            count += 1
            yield buf.getvalue()
            buf.seek(0)
            buf.truncate(0)
        except Exception as e:
            log.warning("[pinterest-feed] skipping product %s: %s", p.get("slug"), e)
            continue
    log.info("[pinterest-feed] streamed %d product rows", count)


@router.get("/pinterest/catalog.tsv", include_in_schema=False)
async def pinterest_catalog_tsv(request: Request):
    """The public TSV product feed Pinterest's data-source crawler pulls.
    Logged to `pinterest_feed_logs` so the admin Settings card can show
    when the catalog was last ingested."""
    try:
        await db.pinterest_feed_logs.insert_one({
            "ts": now_iso(),
            "user_agent": (request.headers.get("user-agent") or "")[:300],
            "ip": (request.client.host if request.client else "") or "",
        })
    except Exception:
        # Non-fatal — feed must still serve even if log insert fails.
        pass
    return StreamingResponse(
        _tsv_stream(),
        media_type="text/tab-separated-values; charset=utf-8",
        headers={
            # Honor Pinterest's expected filename in case they download it.
            "Content-Disposition": 'inline; filename="crafters-market-catalog.tsv"',
            # 30-min edge cache — Pinterest re-pulls every 24h anyway, but
            # protects against burst-curl from any other source.
            "Cache-Control": "public, max-age=1800",
        },
    )


@router.get("/pinterest/catalog/health")
async def pinterest_catalog_health():
    """Public-readable summary the admin Settings card calls to show
    feed state. No PII, no admin gating — same posture as /seo/diag."""
    last = await db.pinterest_feed_logs.find_one({}, sort=[("ts", -1)])
    product_count = await db.products.count_documents(
        {"status": "published", "deleted_at": None}
    )
    last_pinterest_fetch = None
    # Heuristic: if the most-recent UA contains "pinterest", treat that
    # log row as Pinterest's actual ingestion (vs. an admin curl test).
    if last and "pinterest" in (last.get("user_agent") or "").lower():
        last_pinterest_fetch = last.get("ts")
    return {
        "feed_url": f"{PUBLIC_SITE_URL}/api/pinterest/catalog.tsv",
        "product_count": product_count,
        "last_any_fetch_at":  (last or {}).get("ts"),
        "last_any_fetch_ua":  (last or {}).get("user_agent"),
        "last_pinterest_fetch_at": last_pinterest_fetch,
        "currency": DEFAULT_CURRENCY,
        "site_root": PUBLIC_SITE_URL,
    }



# ── iter352 — Real-time catalog sync (admin) ───────────────────────────
@router.get("/admin/pinterest/catalog-status")
async def admin_pinterest_catalog_status(force: bool = False,
                                         _: dict = Depends(current_admin)):
    """Probe the current `PINTEREST_ACCESS_TOKEN` for catalog scopes.

    Returns scope-detection result from `services.pinterest_catalog_sync`
    so the admin can see at-a-glance whether the token can do real-time
    item updates (catalogs:write) or whether it's stuck on the 24-48h
    feed cadence only. Set `?force=1` to skip the 10-min scope cache."""
    from services.pinterest_catalog_sync import check_catalog_scope
    result = await check_catalog_scope(force=bool(force))
    # Trim the raw response to keep this endpoint payload small.
    raw = result.get("raw") or {}
    if isinstance(raw, dict) and "items" in raw:
        raw = {"item_count": len(raw.get("items") or []),
               "first_catalog_id": (raw.get("items") or [{}])[0].get("id")
                                   if raw.get("items") else None}
    return {**result, "raw": raw}


class CatalogResyncRequest(BaseModel):
    limit: int = Field(20, ge=1, le=500)


@router.post("/admin/pinterest/catalog-resync")
async def admin_pinterest_catalog_resync(body: CatalogResyncRequest,
                                         _: dict = Depends(current_admin)):
    """Push the most-recently-updated N products as a real-time batch
    UPDATE to Pinterest (so price changes show within minutes instead
    of waiting for the next 24h feed ingestion).

    No-ops cleanly when the token lacks `catalogs:write` — caller can
    inspect `result.reason` and prompt the user to reconnect Pinterest
    with the expanded scope set. Audit row is logged to
    `pinterest_resync_log` either way for traceability."""
    from services.pinterest_catalog_sync import push_items_batch

    # Snapshot the N most-recently-updated published products.
    cursor = (
        db.products.find(
            {"status": "published", "deleted_at": None},
            {"slug": 1, "title": 1, "price": 1, "in_stock": 1,
             "images": 1, "image_url": 1, "category": 1, "technique": 1},
        )
        .sort([("updated_at", -1), ("created_at", -1)])
        .limit(body.limit)
    )
    items: list[dict] = []
    async for p in cursor:
        slug = p.get("slug")
        if not slug or not p.get("price"):
            continue
        attrs: dict = {
            "price": f"{float(p['price']):.2f} USD",
            "availability": (
                "out of stock" if (p.get("in_stock") is not None
                                   and int(p.get("in_stock") or 0) <= 0)
                else "in stock"
            ),
        }
        link = f"{PUBLIC_SITE_URL}/shop/{slug}"
        attrs["link"] = link
        items.append({"item_id": slug, "attributes": attrs})

    if not items:
        return {"ok": False, "pushed": 0, "reason": "no eligible products",
                "result": None}

    result = await push_items_batch(items, operation="UPDATE")
    await db.pinterest_resync_log.insert_one({
        "ts": now_iso(),
        "requested_limit": body.limit,
        "pushed_count": len(items),
        "ok": bool(result.get("ok")),
        "status_code": result.get("status_code"),
        "reason": result.get("reason"),
    })
    return {
        "ok": bool(result.get("ok")),
        "pushed": len(items),
        "result": result,
    }
