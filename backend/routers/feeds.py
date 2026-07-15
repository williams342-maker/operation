"""Product-catalog feeds for off-site channels.

Generates Meta (Facebook + Instagram) Commerce, Pinterest, and Google
Merchant Center compatible CSV feeds. The same schema works across all
three because Pinterest and Meta both adopt Google Merchant's column
names. Each consumer hits the same row data with slightly different
required columns.

Usage:
  - Meta:      Commerce Manager → Catalogs → Add data feed →
               https://craftersmarket.org/api/feeds/meta-catalog.csv
               Schedule: Daily at 03:00 UTC.
  - Pinterest: Business → Catalogs → Add data source →
               https://craftersmarket.org/api/feeds/pinterest.csv
  - Google:    Merchant Center → Products → Feeds → Scheduled fetch →
               https://craftersmarket.org/api/feeds/google-merchant.csv

The feed is regenerated on every request from `db.products` (only
published, non-deleted, in-stock listings) so there's no separate cron
job to maintain. Cache-Control: public, max-age=3600 keeps Cloudflare
serving the same CSV for an hour at the edge.
"""
from __future__ import annotations
from config import env_get

import csv
import io
import os
from datetime import datetime, timezone

from fastapi import APIRouter
from fastapi.responses import Response

from core import db, listing_price_range


router = APIRouter()


SITE_URL = (env_get("PUBLIC_SITE_URL") or "https://craftersmarket.org").rstrip("/")


def _row_for_product(p: dict, maker: dict) -> dict:
    """Coerce a Product DB row → Google-Merchant-style feed row.

    Output keys are the exact Google Merchant column headers, which
    Meta Commerce and Pinterest both accept. Required fields that the
    seller might not have filled in get safe defaults so the feed
    never fails Meta validation."""
    images = [u for u in (p.get("images") or []) if u]
    primary_img = images[0] if images else f"{SITE_URL}/icons/icon-512.png"
    additional = "|".join(images[1:9])  # Meta accepts up to 9 additional

    # iter375 — min effective variant price stands in when base = $0
    # (variable-priced listings: price depends on size/type variants).
    base_price = listing_price_range(p)[0]
    sale_price = ""
    if p.get("promoted_until"):
        # 10% promo discount surfaces in the feed when boosted (purely
        # cosmetic — actual checkout discount is separate).
        sale_price = f"{round(base_price * 0.9, 2):.2f} USD"

    return {
        "id": p["slug"],
        "title": (p.get("title") or "")[:150],
        "description": (p.get("description") or p.get("title") or "")[:5000],
        "availability": "in_stock" if (p.get("in_stock") or 0) > 0 else "out_of_stock",
        "condition": p.get("condition") or "new",
        "price": f"{base_price:.2f} USD",
        "sale_price": sale_price,
        "link": f"{SITE_URL}/products/{p['slug']}",
        "image_link": primary_img,
        "additional_image_link": additional,
        "brand": (maker.get("name") or "Crafters Market")[:70],
        "google_product_category": (p.get("gpc_path") or "").strip() or _category_for(p.get("category"), p.get("technique")),
        "product_type": " > ".join(filter(None, [
            "Crafters Market",
            (p.get("category") or "").title(),
            (p.get("technique") or "").title(),
        ])),
        "shipping": "US::Standard:0.00 USD" if p.get("free_shipping") else "",
        "shipping_weight": (
            f"{p['weight_lbs']:.2f} lb" if p.get("weight_lbs") else ""
        ),
        "color": ", ".join((p.get("colors") or [])[:6]),
        "material": ", ".join((p.get("materials") or [])[:6]),
        "custom_label_0": (p.get("technique") or "").upper(),  # for ad campaigns
        "custom_label_1": maker.get("slug") or "",             # group by maker
    }


def _category_for(cat: str | None, tech: str | None) -> str:
    """Map Crafters Market category → Google Product Taxonomy id."""
    cat_l = (cat or "").lower()
    tech_l = (tech or "").lower()
    # Order matters — check more specific keywords first.
    if "kitchen" in cat_l or "cutting" in cat_l or "board" in cat_l:
        return "638"     # Home & Garden > Kitchen & Dining
    if "outdoor" in cat_l:
        return "696"     # Home & Garden > Lawn & Garden > Outdoor Living
    if "sign" in cat_l:
        return "499831"  # Home & Garden > Decor > Signs
    # iter330 — Jewelry & Wearables. "jewelry" catches the broadened
    # label "Jewelry & Wearables" too (substring). "wearable" / "apparel"
    # / "leather" / "patch" route through the same Apparel & Accessories
    # > Jewelry bucket (188) for now — most listings are still jewelry-
    # like accessories. Makers selling pure apparel can override per-
    # listing via the GPC picker in the editor.
    if "jewelry" in cat_l or "wearable" in cat_l or "apparel" in cat_l:
        return "188"     # Apparel & Accessories > Jewelry
    if "wall" in cat_l or "art" in cat_l:
        return "500044"  # Home & Garden > Decor > Artwork > Posters, Prints
    if "monogram" in tech_l or "engrav" in tech_l:
        return "499831"
    return "696"


COLUMNS = [
    "id", "title", "description", "availability", "condition", "price", "sale_price",
    "link", "image_link", "additional_image_link", "brand",
    "google_product_category", "product_type", "shipping", "shipping_weight",
    "color", "material", "custom_label_0", "custom_label_1",
]


async def _build_rows(limit: int = 5000) -> list[dict]:
    """Walk published, in-stock products and produce feed rows."""
    cursor = db.products.find(
        {"status": "published", "deleted_at": None, "in_stock": {"$gt": 0}},
        {"_id": 0},
    ).sort("created_at", -1).limit(limit)

    # Cache makers as we go
    maker_cache: dict[str, dict] = {}
    rows = []
    async for p in cursor:
        ms = p.get("maker_slug") or ""
        if ms not in maker_cache:
            m = await db.makers.find_one({"slug": ms}, {"_id": 0, "name": 1, "slug": 1}) or {}
            maker_cache[ms] = m
        rows.append(_row_for_product(p, maker_cache[ms]))
    return rows


def _csv_response(rows: list[dict], filename: str) -> Response:
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=COLUMNS)
    writer.writeheader()
    writer.writerows(rows)
    return Response(
        content=buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "public, max-age=3600",
            "X-Generated-At": datetime.now(timezone.utc).isoformat(),
            "X-Row-Count": str(len(rows)),
        },
    )


# ─────────────────── public feed endpoints ───────────────────
@router.get("/feeds/meta-catalog.csv")
async def meta_catalog_feed():
    """Facebook + Instagram Commerce Manager feed."""
    rows = await _build_rows()
    return _csv_response(rows, "craftersmarket-meta-catalog.csv")


@router.get("/feeds/pinterest.csv")
async def pinterest_feed():
    """Pinterest Catalogs feed (same schema as Meta)."""
    rows = await _build_rows()
    return _csv_response(rows, "craftersmarket-pinterest.csv")


@router.get("/feeds/google-merchant.csv")
async def google_merchant_feed():
    """Google Merchant Center feed (same schema)."""
    rows = await _build_rows()
    return _csv_response(rows, "craftersmarket-google.csv")


# iter413cd — TikTok Ads catalog. TikTok for Business → Assets →
# Catalogs accepts Google Merchant Center format natively, EXCEPT for
# the `availability` field — TikTok rejects `in_stock` / `out_of_stock`
# (underscores, Google's spec) and only accepts the space-separated
# variants. iter413dj (2026-06-29) — remap availability only for this
# endpoint so Google / Meta / Pinterest feeds stay untouched.
_TIKTOK_AVAILABILITY = {
    "in_stock": "in stock",
    "out_of_stock": "out of stock",
    "preorder": "preorder",
    "backorder": "available for order",
    "discontinued": "discontinued",
}


@router.get("/feeds/tiktok.csv")
async def tiktok_feed():
    """TikTok Ads catalog feed (Google Merchant Center schema with
    TikTok-required space-separated availability values)."""
    rows = await _build_rows()
    for row in rows:
        avail = row.get("availability")
        if avail in _TIKTOK_AVAILABILITY:
            row["availability"] = _TIKTOK_AVAILABILITY[avail]
    return _csv_response(rows, "craftersmarket-tiktok.csv")


# ─────────────────── health endpoint ───────────────────
@router.get("/feeds/health")
async def feeds_health():
    """Returns row counts + last-generated metadata so the maker dashboard
    Channel Health panel can show live status without downloading the
    full CSV."""
    count = await db.products.count_documents(
        {"status": "published", "deleted_at": None, "in_stock": {"$gt": 0}},
    )
    return {
        "ok": True,
        "site_url": SITE_URL,
        "row_count": count,
        "feeds": [
            {
                "channel": "meta",
                "label": "Facebook + Instagram",
                "url": f"{SITE_URL}/api/feeds/meta-catalog.csv",
                "manager_url": "https://business.facebook.com/commerce_manager",
                "instructions": "Commerce Manager → Catalogs → Add data feed → paste URL above. Schedule: daily.",
            },
            {
                "channel": "pinterest",
                "label": "Pinterest Catalogs",
                "url": f"{SITE_URL}/api/feeds/pinterest.csv",
                "manager_url": "https://www.pinterest.com/business/catalogs/",
                "instructions": "Business → Catalogs → Add data source → paste URL.",
            },
            {
                "channel": "google",
                "label": "Google Merchant Center",
                "url": f"{SITE_URL}/api/feeds/google-merchant.csv",
                "manager_url": "https://merchants.google.com/",
                "instructions": "Merchant Center → Products → Feeds → Scheduled fetch.",
            },
            {
                "channel": "tiktok",
                "label": "TikTok Ads Catalog",
                "url": f"{SITE_URL}/api/feeds/tiktok.csv",
                "manager_url": "https://ads.tiktok.com/i18n/dashboard/asset/catalog",
                "instructions": "TikTok for Business → Assets → Catalogs → Add catalog → Data feed → paste URL above. Schedule: daily.",
            },
        ],
    }
