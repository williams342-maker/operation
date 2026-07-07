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

from core import db, listing_price_range


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
    """Best-fit Google Product Taxonomy node. Pinterest matches against
    Google's actual taxonomy and collapses any unrecognized path to the
    longest valid prefix — which then trips alert 126 ("only 1 or 2
    levels"). Every value returned here is a verbatim node from the
    official taxonomy
    ( https://www.google.com/basepages/producttype/taxonomy.en-US.txt ).

    `technique` is reserved for future technique-specific mapping.
    """
    _ = technique  # placeholder
    cat = (category or "").lower()
    # Order matters — most specific matches first so e.g. "Wedding Gifts"
    # hits the wedding branch before falling through to "gift".
    if "fragrance" in cat or "candle" in cat or "wellness" in cat or "aromatherapy" in cat:
        # Home Fragrances — verified leaf, 3 levels (iter430).
        return "Home & Garden > Decor > Home Fragrances"
    if "address" in cat or "house number" in cat:
        # House Numbers & Letters — verified leaf, 3 levels.
        return "Home & Garden > Decor > House Numbers & Letters"
    if "sign" in cat:
        # GPC ID 6325 — verified leaf, 3 levels.
        return "Home & Garden > Decor > Signs"
    if "wedding" in cat or "bridal" in cat:
        # Wedding Decor — verified leaf, 4 levels.
        return "Arts & Entertainment > Party & Celebration > Special Occasion Decor > Wedding Decor"
    if "holiday" in cat or "season" in cat or "christmas" in cat:
        # Seasonal & Holiday Decorations — verified leaf, 3 levels.
        return "Home & Garden > Decor > Seasonal & Holiday Decorations"
    if "outdoor" in cat or "garden" in cat or "yard" in cat:
        # Garden Art — verified leaf, 4 levels. Best fit for CNC plasma
        # cut yard pieces, hose-reel art, garden stakes, etc.
        return "Home & Garden > Lawn & Garden > Outdoor Living > Garden Art"
    if "kitchen" in cat or "bar" in cat or "cutting" in cat:
        # Cutting Boards — verified leaf, 4 levels. Single most-common
        # CNC kitchen item (engraved boards, charcuterie, bar plaques).
        return "Home & Garden > Kitchen & Dining > Kitchen Tools & Utensils > Cutting Boards"
    if "lighting" in cat or "lamp" in cat or "lantern" in cat:
        # Lamps — verified leaf, 3 levels.
        return "Home & Garden > Lighting > Lamps"
    if "memorial" in cat or "tribute" in cat or " urn" in cat or cat.startswith("urn"):
        # Plaques — verified leaf, 3 levels. Best fit for memorial
        # plaques / dedication pieces. (Use a leading-space check on
        # "urn" so it doesn't accidentally match "f-urn-iture".)
        return "Home & Garden > Decor > Plaques"
    if "furniture" in cat or "table" in cat:
        # GPC ID 4239, 3 levels.
        return "Furniture > Tables > Accent Tables"
    if "shelf" in cat or "shelv" in cat:
        # GPC ID 6361, 3 levels.
        return "Furniture > Cabinets & Storage > Storage Cabinets"
    if "wall" in cat or "art" in cat:
        # GPC ID 500044 — verified leaf, 4 levels. (The non-existent
        # "Home & Garden > Decor > Wall Art" path was the iter294 bug.)
        return "Home & Garden > Decor > Artwork > Posters, Prints, & Visual Artwork"
    if "ornament" in cat or "decor" in cat:
        # GPC ID 500045 — verified leaf, 4 levels.
        return "Home & Garden > Decor > Artwork > Sculptures & Statues"
    if "jewel" in cat:
        # GPC ID 188, 3 levels.
        return "Apparel & Accessories > Jewelry > Necklaces"
    if "gift" in cat or "craft" in cat:
        # GPC ID 16, 3 levels.
        return "Arts & Entertainment > Hobbies & Creative Arts > Arts & Crafts"
    # Default for unmapped categories — Sculptures & Statues is the best
    # generic fit for one-of-a-kind handmade pieces. 4 levels.
    return "Home & Garden > Decor > Artwork > Sculptures & Statues"


def _resolve_gpc(p: dict) -> str:
    """Return the GPC path to ship in catalog feeds. Maker-supplied
    `gpc_path` wins when set (verbatim — they own the taxonomy choice);
    otherwise fall back to the category→GPC auto-mapper. iter297."""
    override = (p.get("gpc_path") or "").strip()
    if override and ">" in override:
        return override
    return _google_product_category(p.get("category") or "", p.get("technique") or "")


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
         "variants": 1, "images": 1, "image_url": 1, "in_stock": 1, "category": 1,
         "technique": 1, "maker_slug": 1, "gpc_path": 1},
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

        # iter294 — Hard skip when Pinterest-required fields are empty.
        # The validator counts every empty title/description/price/image
        # as an error and refuses to publish the row. Better to omit the
        # row entirely than ship a broken one.
        title = (p.get("title") or "").strip()
        if not title:
            continue
        description = (p.get("description") or "").strip()
        if not description:
            continue

        # Primary image is required by Pinterest. Skip rows without one
        # rather than uploading rows that will fail validation.
        images = [img for img in (p.get("images") or []) if img]
        primary_img = _abs(images[0] if images else (p.get("image_url") or ""))
        if not primary_img:
            continue
        extras = [_abs(u) for u in images[1:6] if u]  # Pinterest accepts up to 10; cap at 5 to keep CSV small.

        # Pinterest rejects rows with $0 or missing price.
        try:
            # iter375 — min effective variant price stands in when base = $0.
            price_val = listing_price_range(p)[0]
        except (TypeError, ValueError):
            continue
        if price_val <= 0:
            continue
        price_str = f"{price_val:.2f} USD"

        brand = brand_map.get(p.get("maker_slug") or "", "") or "Crafters Market"
        technique = (p.get("technique") or "").strip()
        category = (p.get("category") or "").strip()

        w.writerow([
            slug,
            _truncate(title, 100),
            _truncate(description, 500),
            f"{SITE_BASE}/shop/{slug}",
            primary_img,
            price_str,
            _availability(p),
            "new",
            _truncate(brand, 70),
            _resolve_gpc(p),
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
