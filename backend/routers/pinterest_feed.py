"""Pinterest Catalog data source feed (iter290).

Public, unauthenticated CSV at `GET /api/pinterest/feed.csv` formatted to
Pinterest's "Provide a URL link" data source spec
( https://help.pinterest.com/en/business/article/data-source-specifications ).

Why a separate endpoint from `/api/enrich/v1/feed.csv`:
  • Pinterest's daily crawler hits the URL without custom headers, so
    the EnrichLabs API-key guard would 401 every request.
  • Pinterest requires a richer schema (9 required columns) than
    EnrichLabs' minimal {name, image, link} triple.
  • Keeping them separate means we can tune each feed for its consumer
    without one breaking the other.

Required columns (all rows have them, in this order):
  id              — unique product identifier (slug)
  title           — product name, ≤ 100 chars
  description     — product description, ≤ 500 chars
  link            — destination URL (https://craftersmarket.org/shop/<slug>)
  image_link      — primary product image (https URL, ≥ 1000×1000 ideal)
  price           — "29.99 USD" format
  availability    — "in stock" | "out of stock"
  condition       — "new" (all our pieces are made-to-order)
  brand           — maker shop_name or name (falls back to "Crafters Market")

Additional helpful columns (Pinterest uses them for category targeting):
  google_product_category — e.g. "Home & Garden > Decor > Wall Decor"
  product_type            — our own taxonomy: "Wall Art > CNC > <technique>"
  additional_image_link   — pipe-separated extra image URLs

Respects each maker's `external_ads_opt_out` toggle (Settings → Privacy).
"""
from __future__ import annotations

import csv
import io
import os
from datetime import datetime, timezone

from fastapi import APIRouter, Request, Response, HTTPException

from core import db


router = APIRouter()


SITE_BASE = (os.environ.get("PUBLIC_APP_URL") or "https://craftersmarket.org").rstrip("/")


def _abs(url: str) -> str:
    if not url:
        return ""
    url = url.strip()
    if url.startswith("http://") or url.startswith("https://"):
        return url
    return f"{SITE_BASE}{url if url.startswith('/') else '/' + url}"


def _truncate(s: str, n: int) -> str:
    s = (s or "").strip().replace("\r", " ").replace("\n", " ")
    return s if len(s) <= n else s[: n - 1].rstrip() + "…"


def _google_product_category(category: str, technique: str) -> str:
    """Best-fit Google Product Taxonomy ID. Pinterest accepts either the
    numeric ID or the breadcrumb path; we use breadcrumbs for clarity.
    `technique` is reserved for future technique-specific mapping."""
    _ = technique  # placeholder — kept for future technique-specific mapping
    cat = (category or "").lower()
    if "sign" in cat:
        return "Home & Garden > Decor > Signs"
    if "wall" in cat or "art" in cat:
        return "Home & Garden > Decor > Wall Decor"
    if "furniture" in cat or "table" in cat or "shelf" in cat:
        return "Furniture"
    if "ornament" in cat or "decor" in cat:
        return "Home & Garden > Decor"
    if "jewel" in cat or "gift" in cat:
        return "Arts & Entertainment > Hobbies & Creative Arts > Arts & Crafts"
    return "Home & Garden > Decor"


def _availability(p: dict) -> str:
    stock = p.get("in_stock")
    # In our schema `in_stock` can be a bool, an int, or missing.
    # Treat missing as in-stock (matches the rest of the codebase).
    if stock is None:
        return "in stock"
    if isinstance(stock, bool):
        return "in stock" if stock else "out of stock"
    try:
        return "in stock" if int(stock) > 0 else "out of stock"
    except (TypeError, ValueError):
        return "in stock"


async def _maker_brand_map(maker_slugs: list[str]) -> dict[str, str]:
    if not maker_slugs:
        return {}
    cursor = db.makers.find(
        {"slug": {"$in": maker_slugs}},
        {"_id": 0, "slug": 1, "shop_name": 1, "name": 1},
    )
    out = {}
    async for m in cursor:
        out[m["slug"]] = (m.get("shop_name") or m.get("name") or "").strip()
    return out


@router.get("/pinterest/feed.csv")
async def pinterest_feed_csv(request: Request) -> Response:
    """Public CSV consumed by Pinterest's daily catalog crawler.

    iter293 — HTTP Basic Auth required (Pinterest's enterprise flow
    requires login credentials on the data source URL). Admin can view
    + rotate the password from Settings → Sales channel feeds.

    On bad/missing auth: returns 401 with `WWW-Authenticate: Basic`
    so Pinterest's crawler knows to retry with credentials.
    """
    # ── iter293 — Basic Auth gate ──
    import base64
    from feed_auth import verify as _verify_creds
    auth_header = request.headers.get("authorization", "")
    ok = False
    if auth_header.lower().startswith("basic "):
        try:
            decoded = base64.b64decode(auth_header.split(" ", 1)[1]).decode("utf-8", errors="ignore")
            user, _, pwd = decoded.partition(":")
            ok = await _verify_creds("pinterest", user, pwd)
        except Exception:
            ok = False
    if not ok:
        raise HTTPException(
            status_code=401,
            detail="Pinterest crawler authentication required.",
            headers={"WWW-Authenticate": 'Basic realm="Crafters Market Pinterest Feed"'},
        )
    # ── /Basic Auth gate ──
    opted_out = await db.makers.distinct(
        "slug",
        {"external_ads_opt_out": True,
         "deleted_at": {"$in": [None, ""]}},
    )
    q = {
        "status": "published",
        "deleted_at": {"$in": [None, ""]},
    }
    if opted_out:
        q["maker_slug"] = {"$nin": opted_out}
    # No `in_stock` filter — Pinterest accepts both states. Out-of-stock
    # listings stay in the feed with `availability=out of stock` so the
    # pin can update automatically once restocked instead of being
    # de-listed and re-listed.
    products = await db.products.find(
        q,
        {"_id": 0, "slug": 1, "title": 1, "description": 1, "price": 1,
         "images": 1, "image_url": 1, "in_stock": 1, "category": 1,
         "technique": 1, "maker_slug": 1},
    ).sort("created_at", -1).limit(5000).to_list(5000)

    brand_map = await _maker_brand_map(
        list({p.get("maker_slug") for p in products if p.get("maker_slug")}),
    )

    buf = io.StringIO()
    w = csv.writer(buf, quoting=csv.QUOTE_MINIMAL, lineterminator="\n")
    w.writerow([
        "id", "title", "description", "link", "image_link",
        "price", "availability", "condition", "brand",
        "google_product_category", "product_type", "additional_image_link",
    ])

    rows_written = 0
    for p in products:
        slug = (p.get("slug") or "").strip()
        if not slug:
            continue
        # Primary image is required by Pinterest. Skip rows without one
        # rather than uploading rows that will fail validation.
        images = [img for img in (p.get("images") or []) if img]
        primary_img = _abs(images[0] if images else (p.get("image_url") or ""))
        if not primary_img:
            continue
        extras = [_abs(u) for u in images[1:6] if u]  # Pinterest accepts up to 10; cap at 5 to keep CSV small.

        price = p.get("price")
        try:
            price_str = f"{float(price):.2f} USD" if price is not None else ""
        except (TypeError, ValueError):
            price_str = ""
        if not price_str:
            # Pinterest rejects rows without a valid price.
            continue

        brand = brand_map.get(p.get("maker_slug") or "", "") or "Crafters Market"
        technique = (p.get("technique") or "").strip()
        category = (p.get("category") or "").strip()

        w.writerow([
            slug,
            _truncate(p.get("title") or "", 100),
            _truncate(p.get("description") or p.get("title") or "Handcrafted item", 500),
            f"{SITE_BASE}/shop/{slug}",
            primary_img,
            price_str,
            _availability(p),
            "new",
            _truncate(brand, 70),
            _google_product_category(category, technique),
            _truncate(f"{category} > {technique}".strip(" >"), 750),
            "|".join(extras),
        ])
        rows_written += 1

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    fname = f"crafters_market_pinterest_{today}.csv"
    # iter292 — Log the crawler hit for the admin "Sales channel feeds"
    # card so operators have proof Pinterest actually fetched.
    try:
        from feed_access_log import record_hit
        await record_hit(request, channel="pinterest", rows=rows_written)
    except Exception:
        pass  # best-effort logging — never blocks the response
    return Response(
        content=buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'inline; filename="{fname}"',
            # Encourage Pinterest's crawler to cache for an hour — we
            # regenerate per-request anyway, and product data doesn't
            # change minute-by-minute. Reduces backend load if Pinterest
            # retries within the hour.
            "Cache-Control": "public, max-age=3600",
            "X-Feed-Rows": str(rows_written),
        },
    )
