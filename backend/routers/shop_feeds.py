"""Google Merchant Center + Meta Shop catalog feeds (iter291).

Two more public catalog feeds in the formats their respective crawlers
require, both populated from the same `products` collection as the
Pinterest feed (iter290). One source of truth, three sales channels.

Endpoints:
  GET /api/google-merchant/feed.xml   — Google Shopping RSS 2.0 + g: namespace
  GET /api/meta/feed.csv              — Meta (Facebook + Instagram Shop) CSV

Why each format:
  • Google Merchant Center requires the legacy RSS-2.0-with-`g:`-namespace
    XML format. CSV submission exists but XML is far more reliable for
    larger catalogs and supports richer attributes (additional_image_link
    as repeated elements rather than pipe-separated, structured shipping).
  • Meta Catalog Manager accepts both CSV and XML, but CSV is dramatically
    simpler to debug when something doesn't import — every row a row.
    Meta's required columns are a superset of Pinterest's so we reuse the
    Pinterest builder where it overlaps.

Both feeds:
  • are public (no auth — crawlers don't send custom headers)
  • respect maker `external_ads_opt_out`
  • include out-of-stock listings (auto-reactivate on restock)
  • return `Cache-Control: public, max-age=3600` to spare the backend
"""
from __future__ import annotations
from config import env_get

import csv
import io
import os
import re
from datetime import datetime, timezone
from xml.sax.saxutils import escape as xml_escape

from fastapi import APIRouter, Request, Response

from core import db, effective_variant_price, listing_price_range
from routers.pinterest_feed import (
    _abs, _availability, _maker_brand_map, _resolve_gpc, _truncate,
)


def _google_id(slug: str) -> str:
    """Google Merchant caps `g:id` at 50 chars; over-long slugs trigger
    the "Value too long in attribute: id" warning in the feed report.

    Strategy:
      • Slugs ≤ 50 chars → pass through unchanged so existing catalog
        entries keep their performance history.
      • Longer slugs → deterministic 40-char prefix + 8-char hash suffix
        (49 chars total). The hash is stable per slug so re-uploads
        consistently match the same Google catalog row; the prefix keeps
        the ID human-readable in the Merchant Center UI.

    The hash uses sha1 → hex → first 8 chars. Collision probability
    across 5,000 listings is ~6e-12, well below catastrophic.
    """
    if len(slug) <= 50:
        return slug
    import hashlib
    digest = hashlib.sha1(slug.encode("utf-8")).hexdigest()[:8]
    return f"{slug[:40].rstrip('-')}-{digest}"


def _variant_gid(slug: str, vid: str) -> str:
    """iter376 — g:id for a per-variant row: the product id trimmed to
    leave room for an 8-char variant suffix (Google caps g:id at 50)."""
    base = _google_id(slug)
    suffix = (str(vid) or "0")[:8]
    return f"{base[:41].rstrip('-')}-{suffix}"


_COLOR_GROUP_RE = re.compile(r"colou?r|finish|stain", re.I)
_SIZE_GROUP_RE = re.compile(r"size|dimension|length|width", re.I)


def _variant_option_attrs(p: dict) -> dict:
    """iter376 — Map option_id → ('color'|'size', label) using the maker's
    named variant groups, so per-variant feed rows carry g:color / g:size
    (improves Google Shopping relevance for size/color-specific queries)."""
    out: dict = {}
    for g in (p.get("variant_groups") or []):
        name = g.get("name") or ""
        kind = ("color" if _COLOR_GROUP_RE.search(name)
                else "size" if _SIZE_GROUP_RE.search(name) else None)
        if not kind:
            continue
        for o in (g.get("options") or []):
            if o.get("id") and (o.get("label") or "").strip():
                out[o["id"]] = (kind, o["label"].strip())
    return out


router = APIRouter()


SITE_BASE = (env_get("PUBLIC_APP_URL") or "https://craftersmarket.org").rstrip("/")


async def _fetch_products() -> list[dict]:
    """Shared query — same opt-out logic as Pinterest feed."""
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
    return await db.products.find(
        q,
        {"_id": 0, "slug": 1, "title": 1, "description": 1, "price": 1,
         "images": 1, "image_url": 1, "in_stock": 1, "category": 1,
         "technique": 1, "maker_slug": 1, "materials": 1,
         "dimensions": 1, "published_at": 1, "gpc_path": 1,
         # iter365/369 — Google Merchant feed controls + attribute sources.
         "merchant_title": 1, "merchant_auto_optimize": 1,
         "merchant_exclude": 1, "merchant_color": 1, "colors": 1,
         # iter375/376 — variable pricing + per-variant feed rows.
         "variants": 1, "variant_groups": 1},
    ).sort("created_at", -1).limit(5000).to_list(5000)


# ─────────────── Google Shopping (XML, g: namespace) ───────────────
@router.get("/google-merchant/feed.xml")
async def google_merchant_feed_xml(request: Request) -> Response:
    """RSS 2.0 feed with `xmlns:g="http://base.google.com/ns/1.0"`.

    Google Merchant Center pulls this URL daily and reconciles each
    `<g:id>` against its existing catalog — adds new SKUs, marks
    missing ones inactive, refreshes price/availability on the rest.
    """
    products = await _fetch_products()
    brand_map = await _maker_brand_map(
        list({p.get("maker_slug") for p in products if p.get("maker_slug")}),
    )
    # iter365 — Restricted-term mitigation: admin category rules + per-
    # listing controls decide whether each row syncs as-is, gets its
    # title/description rewritten, or is dropped. Google feed ONLY.
    from services.merchant_sanitizer import load_category_rules, resolve_merchant_listing
    from services.merchant_attributes import merchant_attributes
    category_rules = await load_category_rules(db)
    attr_warnings = 0  # iter366 — internal feed-quality counter

    parts: list[str] = []
    parts.append('<?xml version="1.0" encoding="UTF-8"?>')
    parts.append('<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">')
    parts.append("<channel>")
    parts.append("<title>Crafters Market — CNC-crafted goods</title>")
    parts.append(f"<link>{SITE_BASE}/shop</link>")
    parts.append("<description>Handmade pieces from independent CNC fabricators across the US</description>")

    rows_written = 0
    for p in products:
        slug = (p.get("slug") or "").strip()
        if not slug:
            continue
        # iter294 — Same hard-skip pattern as Pinterest: never emit a row
        # with empty required fields. Google Merchant rejects them too.
        title = (p.get("title") or "").strip()
        if not title:
            continue
        description = (p.get("description") or "").strip()
        if not description:
            continue
        # iter365 — Apply merchant controls: per-listing exclude, category
        # rules, title override, restricted-term auto-rewrite.
        merchant = resolve_merchant_listing(p, category_rules)
        if not merchant["include"]:
            continue
        title = (merchant["title"] or title).strip()
        description = (merchant["description"] or description).strip()
        images = [img for img in (p.get("images") or []) if img]
        primary_img = _abs(images[0] if images else (p.get("image_url") or ""))
        if not primary_img:
            continue
        try:
            # iter375 — min effective variant price stands in when base = $0.
            price = listing_price_range(p)[0]
        except (TypeError, ValueError):
            continue
        if price <= 0:
            continue

        brand = brand_map.get(p.get("maker_slug") or "", "") or "Crafters Market"
        # Google requires a description ≥ 1 char; pad with the title if missing.
        desc = _truncate(description, 5000)
        link = f"{SITE_BASE}/shop/{slug}"

        gpc = _resolve_gpc(p)
        # iter366 — Category-aware attributes: send only what the GPC
        # profile needs (material/color for decor & boxes; full apparel
        # set incl. unisex/adult defaults for jewelry); suppress the rest
        # so Merchant Center stops asking for gender on trinket boxes.
        attr_res = merchant_attributes(p, gpc)
        attr_warnings += len(attr_res["warnings"])
        pt = _truncate(f"{p.get('category') or ''} > {p.get('technique') or ''}".strip(" >"), 750)

        # iter376 — Per-variant feed items: each size/color combo becomes
        # its own <item> with its EXACT price, grouped via g:item_group_id
        # so Google treats them as one product family. Listings without
        # variants emit the single row exactly as before.
        base_price = float(p.get("price") or 0)
        variants = [v for v in (p.get("variants") or []) if isinstance(v, dict)][:100]
        opt_attrs = _variant_option_attrs(p) if variants else {}
        group_id = _google_id(slug)

        rows: list[dict] = []
        for idx, v in enumerate(variants):
            v_price = effective_variant_price(base_price, v)
            if v_price <= 0:
                continue
            v_label = (v.get("label") or "").strip()
            v_stock = v.get("in_stock")
            in_stock = ((v_stock or 0) > 0) if v_stock is not None \
                else _availability(p) == "in stock"
            color = size = None
            for oid in (v.get("option_ids") or []):
                kind_label = opt_attrs.get(oid)
                if kind_label and kind_label[0] == "color":
                    color = kind_label[1]
                elif kind_label and kind_label[0] == "size":
                    size = kind_label[1]
            rows.append({
                "id": _variant_gid(slug, v.get("id") or v.get("sku") or idx),
                "group_id": group_id,
                "title": _truncate(f"{title} — {v_label}" if v_label else title, 150),
                "price": v_price,
                "availability": "in_stock" if in_stock else "out_of_stock",
                "color": color,
                "size": size,
            })
        if not rows:
            rows = [{
                "id": group_id,
                "group_id": None,
                "title": _truncate(title, 150),
                "price": price,
                "availability": _availability(p).replace(" ", "_"),
                "color": None,
                "size": None,
            }]

        for row in rows:
            item: list[str] = ["<item>"]
            # iter304 — shorten over-50-char IDs to keep Google Merchant
            # happy (warning "Value too long in attribute: id" in upload report).
            item.append(f"<g:id>{xml_escape(row['id'])}</g:id>")
            if row["group_id"]:
                item.append(f"<g:item_group_id>{xml_escape(row['group_id'])}</g:item_group_id>")
            item.append(f"<g:title>{xml_escape(row['title'])}</g:title>")
            item.append(f"<g:description>{xml_escape(desc)}</g:description>")
            item.append(f"<g:link>{xml_escape(link)}</g:link>")
            item.append(f"<g:image_link>{xml_escape(primary_img)}</g:image_link>")
            for extra in images[1:10]:  # Google supports up to 10 additional images
                item.append(f"<g:additional_image_link>{xml_escape(_abs(extra))}</g:additional_image_link>")
            item.append(f"<g:availability>{row['availability']}</g:availability>")
            item.append(f"<g:price>{row['price']:.2f} USD</g:price>")
            item.append("<g:condition>new</g:condition>")
            item.append(f"<g:brand>{xml_escape(_truncate(brand, 70))}</g:brand>")
            # google_product_category accepts the breadcrumb path verbatim.
            # iter297 — Honor the maker-supplied override when set.
            item.append(f"<g:google_product_category>{xml_escape(gpc)}</g:google_product_category>")
            # `product_type` lets us pass our own taxonomy alongside Google's.
            if pt:
                item.append(f"<g:product_type>{xml_escape(pt)}</g:product_type>")
            for name in ("material", "color", "gender", "age_group", "size"):
                # Variant-specific color/size win over product-level deductions.
                val = (row["color"] if name == "color" and row["color"]
                       else row["size"] if name == "size" and row["size"]
                       else attr_res["attributes"].get(name))
                if val:
                    item.append(f"<g:{name}>{xml_escape(_truncate(val, 100))}</g:{name}>")
            # `identifier_exists=false` because handmade pieces have no GTIN/MPN.
            item.append("<g:identifier_exists>false</g:identifier_exists>")
            item.append("</item>")
            parts.append("".join(item))
            rows_written += 1

    parts.append("</channel></rss>")

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    # iter366 — internal-only feed-quality log (never buyer-facing).
    if attr_warnings:
        import logging
        logging.getLogger("crafters.feeds").info(
            "[google-feed] %d attribute fallback warning(s) across %d rows",
            attr_warnings, rows_written,
        )
    # iter292 — Log the crawler hit for the admin "Sales channel feeds" card.
    try:
        from feed_access_log import record_hit
        await record_hit(request, channel="google", rows=rows_written)
    except Exception:
        pass
    return Response(
        content="\n".join(parts),
        media_type="application/xml; charset=utf-8",
        headers={
            "Content-Disposition": f'inline; filename="crafters_market_google_{today}.xml"',
            "Cache-Control": "public, max-age=3600",
            "X-Feed-Rows": str(rows_written),
            "X-Feed-Attr-Warnings": str(attr_warnings),
        },
    )


# ─────────────── Meta (Facebook + Instagram Shop) CSV ───────────────
@router.get("/meta/feed.csv")
async def meta_feed_csv(request: Request) -> Response:
    """Meta Catalog Manager pulls this URL on whatever schedule the user
    configures (default daily). Format identical to Pinterest aside from
    minor field-name nits — easier to debug than Meta's alternate XML.
    """
    products = await _fetch_products()
    brand_map = await _maker_brand_map(
        list({p.get("maker_slug") for p in products if p.get("maker_slug")}),
    )

    buf = io.StringIO()
    w = csv.writer(buf, quoting=csv.QUOTE_MINIMAL, lineterminator="\n")
    w.writerow([
        "id", "title", "description", "availability", "condition",
        "price", "link", "image_link", "brand",
        "google_product_category", "fb_product_category",
        "additional_image_link",
    ])

    rows_written = 0
    for p in products:
        slug = (p.get("slug") or "").strip()
        if not slug:
            continue
        # iter294 — Hard skip rows missing required Meta catalog fields.
        title = (p.get("title") or "").strip()
        if not title:
            continue
        description = (p.get("description") or "").strip()
        if not description:
            continue
        images = [img for img in (p.get("images") or []) if img]
        primary_img = _abs(images[0] if images else (p.get("image_url") or ""))
        if not primary_img:
            continue
        try:
            # iter375 — min effective variant price stands in when base = $0.
            price_val = listing_price_range(p)[0]
        except (TypeError, ValueError):
            continue
        if price_val <= 0:
            continue
        price_str = f"{price_val:.2f} USD"
        extras = [_abs(u) for u in images[1:10] if u]
        brand = brand_map.get(p.get("maker_slug") or "", "") or "Crafters Market"
        category = (p.get("category") or "").strip()
        technique = (p.get("technique") or "").strip()

        w.writerow([
            slug,
            _truncate(title, 150),
            _truncate(description, 5000),
            _availability(p),
            "new",
            price_str,
            f"{SITE_BASE}/shop/{slug}",
            primary_img,
            _truncate(brand, 70),
            _resolve_gpc(p),
            _truncate(f"{category} > {technique}".strip(" >"), 750),
            "|".join(extras),
        ])
        rows_written += 1

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    # iter292 — Log the Meta crawler hit.
    try:
        from feed_access_log import record_hit
        await record_hit(request, channel="meta", rows=rows_written)
    except Exception:
        pass
    return Response(
        content=buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'inline; filename="crafters_market_meta_{today}.csv"',
            "Cache-Control": "public, max-age=3600",
            "X-Feed-Rows": str(rows_written),
        },
    )
