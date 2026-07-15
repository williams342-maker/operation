from config import env_get
"""EnrichLabs read-only data API (iter258 · 2026-05-26).

Read-only JSON endpoints for the EnrichLabs marketing agent to pull
business metrics from Crafters Market.

Auth: static API key in header `X-EnrichLabs-Key`. The key is set once
in `backend/.env` as `ENRICHLABS_API_KEY`. Rotate by changing the env
var and pushing the new value to EnrichLabs.

Surface (all under /api/enrich/v1, GET-only):
  /orders     — anonymized paid orders (no buyer PII)
  /sellers    — maker shops with tier + GMV
  /listings   — products with status + price
  /funnel     — onboarding funnel: applied → approved → first_listing → first_sale → plus
  /traffic    — daily pageview/session aggregates from pageview_events
  /schema     — self-describing endpoint manifest

Anonymization: orders never include buyer email/name/address. The buyer
is exposed only as a stable hash so EnrichLabs can compute repeat-buyer
rates without seeing PII. Maker slugs ARE exposed (public on the site).
"""
import csv
import hashlib
import io
import os
import secrets
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from fastapi.responses import Response

from core import db, logger

router = APIRouter(prefix="/enrich/v1", tags=["enrichlabs"])


# ─────────────────────────────────────────────────────────────────────
# Auth — static API key via header. Constant-time compare so the key
# can't be timing-side-channelled. Returns 401 if the env var is unset
# (i.e. the integration is "off") so a misconfigured deploy doesn't
# silently serve data with a blank key.
# ─────────────────────────────────────────────────────────────────────
def _enrich_key_guard(
    x_enrichlabs_key: Optional[str] = Header(None, alias="X-EnrichLabs-Key"),
):
    expected = (env_get("ENRICHLABS_API_KEY") or "").strip()
    if not expected:
        raise HTTPException(503, "EnrichLabs integration not configured.")
    if not x_enrichlabs_key or not secrets.compare_digest(x_enrichlabs_key, expected):
        raise HTTPException(401, "Invalid or missing X-EnrichLabs-Key.")
    return True


def _iso_or_none(s: Optional[str]) -> Optional[str]:
    """Validate an ISO-ish date string, return canonical form or None."""
    if not s:
        return None
    try:
        # accept YYYY-MM-DD or full ISO 8601
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    except Exception:
        raise HTTPException(400, f"Invalid ISO date: {s!r}")


def _hash_email(email: str) -> str:
    """Stable, salted SHA-256 of a buyer email. Cannot be reversed without
    the salt, but two orders from the same buyer produce the same hash —
    enough for EnrichLabs to compute repeat-buyer rates."""
    salt = (env_get("ENRICHLABS_HASH_SALT") or "cm-enrich-v1").encode()
    return hashlib.sha256(salt + (email or "").lower().strip().encode()).hexdigest()[:32]


# ─────────────────────────────────────────────────────────────────────
# /orders — anonymized paid orders
# ─────────────────────────────────────────────────────────────────────
@router.get("/orders")
async def enrich_orders(
    _: bool = Depends(_enrich_key_guard),
    since: Optional[str] = Query(None, description="ISO date · only orders created at or after"),
    until: Optional[str] = Query(None, description="ISO date · only orders created strictly before"),
    limit: int = Query(200, ge=1, le=500),
    cursor: Optional[str] = Query(None, description="ISO `created_at` of the last row in the previous page"),
):
    """Paid orders, sorted newest first. PII-free.

    Each row: id, created_at, amount, currency, status, summary,
    buyer_hash (anonymized), maker_slugs[], items[{maker_slug, title, price, quantity}].
    """
    since_iso = _iso_or_none(since)
    until_iso = _iso_or_none(until)
    cursor_iso = _iso_or_none(cursor)

    q: dict = {"payment_status": "paid"}
    created_range: dict = {}
    if since_iso:
        created_range["$gte"] = since_iso
    if until_iso:
        created_range["$lt"] = until_iso
    if cursor_iso:
        # cursor pagination — orders strictly older than the last seen row
        created_range["$lt"] = min(cursor_iso, created_range.get("$lt", cursor_iso))
    if created_range:
        q["created_at"] = created_range

    rows = await db.payment_transactions.find(
        q,
        {
            "_id": 0, "id": 1, "created_at": 1, "amount": 1, "currency": 1,
            "status": 1, "payment_status": 1, "summary": 1, "items": 1,
            "customer_email": 1, "discount_code": 1, "discount_amount": 1,
            "attribution_source": 1,
        },
    ).sort("created_at", -1).limit(limit).to_list(limit)

    out: list[dict] = []
    for r in rows:
        items = r.get("items") or []
        maker_slugs = sorted({(it.get("maker_slug") or "").strip()
                              for it in items if it.get("maker_slug")})
        out.append({
            "id": r.get("id"),
            "created_at": r.get("created_at"),
            "amount": round(float(r.get("amount") or 0), 2),
            "currency": (r.get("currency") or "usd").lower(),
            "status": r.get("status") or "complete",
            "payment_status": r.get("payment_status"),
            "summary": r.get("summary") or "",
            "buyer_hash": _hash_email(r.get("customer_email") or ""),
            "maker_slugs": maker_slugs,
            "item_count": sum(int(it.get("quantity") or 1) for it in items),
            "items": [
                {
                    "maker_slug": it.get("maker_slug"),
                    "title": it.get("title") or it.get("name"),
                    "price": round(float(it.get("price") or 0), 2),
                    "quantity": int(it.get("quantity") or 1),
                }
                for it in items
            ],
            "discount_code": r.get("discount_code") or None,
            "discount_amount": round(float(r.get("discount_amount") or 0), 2) or None,
            "attribution_source": r.get("attribution_source") or None,
        })

    next_cursor = out[-1]["created_at"] if len(out) == limit and out else None
    return {"rows": out, "count": len(out), "next_cursor": next_cursor}


# ─────────────────────────────────────────────────────────────────────
# /sellers — maker shops with revenue
# ─────────────────────────────────────────────────────────────────────
@router.get("/sellers")
async def enrich_sellers(
    _: bool = Depends(_enrich_key_guard),
    tier: Optional[str] = Query(None, regex="^(plus|free)$"),
    limit: int = Query(500, ge=1, le=1000),
):
    """Active maker shops. Includes GMV + paid_orders_count computed
    on the fly from payment_transactions."""
    q: dict = {"deletion_requested_at": {"$in": [None, ""]}}
    if tier:
        if tier == "plus":
            q["subscription_status"] = {"$in": ["active", "trialing"]}
        else:
            # "free" = anything that isn't an active Plus subscription
            q["$or"] = [
                {"subscription_status": {"$in": [None, "", "canceled", "incomplete_expired"]}},
                {"subscription_status": {"$exists": False}},
            ]

    makers = await db.makers.find(
        q,
        {
            "_id": 0, "slug": 1, "name": 1, "shop_title": 1, "email": 1,
            "created_at": 1, "subscription_status": 1, "tier": 1,
            "location": 1, "shop_closed": 1, "vacation_mode": 1,
            "stripe_payouts_enabled": 1, "listings_count": 1,
            "founder_status": 1,
        },
    ).limit(limit).to_list(limit)

    # One aggregation to compute GMV + order count per maker
    pipeline = [
        {"$match": {"payment_status": "paid"}},
        {"$unwind": "$items"},
        {"$match": {"items.maker_slug": {"$ne": None}}},
        {"$group": {
            "_id": "$items.maker_slug",
            "gmv": {"$sum": {"$multiply": [
                {"$ifNull": ["$items.price", 0]},
                {"$ifNull": ["$items.quantity", 1]},
            ]}},
            "order_ids": {"$addToSet": "$id"},
        }},
    ]
    by_slug: dict[str, dict] = {}
    async for row in db.payment_transactions.aggregate(pipeline):
        by_slug[row["_id"]] = {
            "gmv": round(float(row.get("gmv") or 0), 2),
            "paid_orders_count": len(row.get("order_ids") or []),
        }

    out = []
    for m in makers:
        slug = m.get("slug")
        agg = by_slug.get(slug, {"gmv": 0.0, "paid_orders_count": 0})
        sub_status = (m.get("subscription_status") or "").lower()
        is_plus = sub_status in ("active", "trialing")
        out.append({
            "slug": slug,
            "name": m.get("name") or m.get("shop_title") or slug,
            "shop_title": m.get("shop_title") or None,
            "email_hash": _hash_email(m.get("email") or ""),
            "tier": "plus" if is_plus else "free",
            "subscription_status": m.get("subscription_status") or None,
            "founder_status": m.get("founder_status") or None,
            "location": m.get("location") or None,
            "onboarded_at": m.get("created_at"),
            "listings_count": int(m.get("listings_count") or 0),
            "paid_orders_count": agg["paid_orders_count"],
            "gross_revenue": agg["gmv"],
            "shop_open": not (m.get("shop_closed") or m.get("vacation_mode")),
            "stripe_payouts_enabled": bool(m.get("stripe_payouts_enabled")),
        })
    out.sort(key=lambda r: r["gross_revenue"], reverse=True)
    return {"rows": out, "count": len(out)}


# ─────────────────────────────────────────────────────────────────────
# /listings — product catalog snapshot
# ─────────────────────────────────────────────────────────────────────
@router.get("/listings")
async def enrich_listings(
    _: bool = Depends(_enrich_key_guard),
    maker_slug: Optional[str] = Query(None),
    status: Optional[str] = Query(None, regex="^(published|draft|sold_out|paused)$"),
    limit: int = Query(500, ge=1, le=1000),
):
    """Public-facing product catalog."""
    q: dict = {"deleted_at": {"$in": [None, ""]}}
    if maker_slug:
        q["maker_slug"] = maker_slug
    if status:
        q["status"] = status

    rows = await db.products.find(
        q,
        {
            "_id": 0, "id": 1, "slug": 1, "title": 1, "price": 1,
            "category": 1, "technique": 1, "maker_slug": 1, "status": 1,
            "in_stock": 1, "created_at": 1, "published_at": 1,
            "featured": 1, "image_url": 1,
        },
    ).sort("created_at", -1).limit(limit).to_list(limit)

    out = []
    for p in rows:
        out.append({
            "id": p.get("id"),
            "slug": p.get("slug"),
            "title": p.get("title"),
            "price": round(float(p.get("price") or 0), 2),
            "currency": "usd",
            "category": p.get("category") or None,
            "technique": p.get("technique") or None,
            "maker_slug": p.get("maker_slug"),
            "status": p.get("status") or "live",
            "in_stock": bool(p.get("in_stock", True)),
            "featured": bool(p.get("featured")),
            "image_url": p.get("image_url") or None,
            "created_at": p.get("created_at"),
            "published_at": p.get("published_at"),
        })
    return {"rows": out, "count": len(out)}


# ─────────────────────────────────────────────────────────────────────
# /feed.{csv,json} — minimal product feed for EnrichLabs / external
# marketing agents (iter270). Only the three columns EnrichLabs needs:
#   product_name · image_url · listing_url
# Published-only, in-stock by default. Same API-key gate as the rest of
# this router. JSON variant returns a top-level array (no envelope) so
# it imports cleanly into spreadsheet tools.
# ─────────────────────────────────────────────────────────────────────
SITE_BASE = "https://craftersmarket.org"


def _absolute_url(url: str) -> str:
    """Convert relative paths (`/foo.jpg`) to absolute URLs so EnrichLabs
    can fetch them directly without a base-URL guess."""
    u = (url or "").strip()
    if not u:
        return ""
    if u.startswith("//"):
        return f"https:{u}"
    if u.startswith("http://") or u.startswith("https://"):
        return u
    if u.startswith("/"):
        return f"{SITE_BASE}{u}"
    return f"{SITE_BASE}/{u}"


def _build_feed_rows(rows: list[dict]) -> list[dict]:
    out: list[dict] = []
    for p in rows:
        # Prefer the first uploaded image; fall back to legacy image_url.
        img = ""
        if isinstance(p.get("images"), list) and p["images"]:
            img = (p["images"][0] or "").strip()
        if not img:
            img = (p.get("image_url") or "").strip()
        img = _absolute_url(img)
        if not img:
            continue  # EnrichLabs can't use an entry with no image
        slug = (p.get("slug") or "").strip()
        if not slug:
            continue
        out.append({
            "product_name": (p.get("title") or "").strip(),
            "image_url": img,
            "listing_url": f"{SITE_BASE}/shop/{slug}",
        })
    return out


async def _fetch_feed_products(
    *, maker_slug: Optional[str], include_oos: bool, limit: int,
) -> list[dict]:
    # iter276 — Honor each maker's `external_ads_opt_out` toggle (lives
    # on the maker doc, surfaced via Settings → Privacy). When True, none
    # of that maker's listings are returned to EnrichLabs / external
    # marketing partners. Default = False (opt-in) so the feed stays
    # comprehensive unless the maker explicitly opts out. Same field
    # already powers external-attribution payout exclusion in
    # `routers/stripe_connect.py`, so the toggle has one consistent
    # meaning across the codebase.
    opted_out_slugs = await db.makers.distinct(
        "slug",
        {
            "external_ads_opt_out": True,
            "deleted_at": {"$in": [None, ""]},
        },
    )

    q: dict = {
        "deleted_at": {"$in": [None, ""]},
        "status": "published",
    }
    if maker_slug:
        # When an explicit maker_slug filter is supplied, respect their
        # opt-out — return an empty list instead of leaking listings the
        # maker didn't consent to be in the feed.
        if maker_slug in opted_out_slugs:
            return []
        q["maker_slug"] = maker_slug
    elif opted_out_slugs:
        q["maker_slug"] = {"$nin": opted_out_slugs}
    if not include_oos:
        # Treat missing field as in-stock (matches the rest of the codebase).
        q["$or"] = [
            {"in_stock": {"$exists": False}},
            {"in_stock": {"$gt": 0}},
            {"in_stock": True},
        ]
    return await db.products.find(
        q,
        {"_id": 0, "slug": 1, "title": 1, "image_url": 1, "images": 1},
    ).sort("created_at", -1).limit(limit).to_list(limit)


@router.get("/feed.json")
async def enrich_feed_json(
    _: bool = Depends(_enrich_key_guard),
    maker_slug: Optional[str] = Query(None),
    include_out_of_stock: bool = Query(False),
    limit: int = Query(1000, ge=1, le=5000),
):
    """Top-level array of {product_name, image_url, listing_url}."""
    rows = await _fetch_feed_products(
        maker_slug=maker_slug,
        include_oos=include_out_of_stock,
        limit=limit,
    )
    return _build_feed_rows(rows)


@router.get("/feed.csv")
async def enrich_feed_csv(
    _: bool = Depends(_enrich_key_guard),
    maker_slug: Optional[str] = Query(None),
    include_out_of_stock: bool = Query(False),
    limit: int = Query(1000, ge=1, le=5000),
):
    """RFC-4180 CSV — header row + one product per line. Streams as
    attachment so the browser downloads instead of rendering inline."""
    rows = await _fetch_feed_products(
        maker_slug=maker_slug,
        include_oos=include_out_of_stock,
        limit=limit,
    )
    feed = _build_feed_rows(rows)
    buf = io.StringIO()
    w = csv.writer(buf, quoting=csv.QUOTE_MINIMAL, lineterminator="\n")
    w.writerow(["product_name", "image_url", "listing_url"])
    for r in feed:
        w.writerow([r["product_name"], r["image_url"], r["listing_url"]])
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    fname = f"crafters_market_feed_{today}.csv"
    return Response(
        content=buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


# ─────────────────────────────────────────────────────────────────────
# iter313 — Showcase + Design-file feeds for external distribution
# partners. Same auth + URL contract as /feed.{csv,json} so EnrichLabs
# (or any other agent) can ingest community content with one extra row
# in their pipeline. Three columns each, deliberately identical shape:
#   item_name · image_url · permalink
# So partners can reuse their listing-feed parser unchanged.
# ─────────────────────────────────────────────────────────────────────
async def _fetch_feed_showcase(*, maker_slug: Optional[str], limit: int) -> list[dict]:
    """Public, non-hidden showcase posts with at least one image.

    Respects each maker's `external_ads_opt_out` (same toggle the
    product feed honors) so opt-out is a one-flip decision.
    """
    opted_out = await db.makers.distinct(
        "slug",
        {"external_ads_opt_out": True, "deleted_at": {"$in": [None, ""]}},
    )
    q: dict = {
        "$or": [{"admin_hidden": {"$exists": False}}, {"admin_hidden": False}],
    }
    if maker_slug:
        if maker_slug in opted_out:
            return []
        q["maker_slug"] = maker_slug
    elif opted_out:
        q["maker_slug"] = {"$nin": opted_out}
    return await db.showcase_posts.find(
        q,
        {
            "_id": 0, "id": 1, "title": 1, "description": 1,
            "image_url": 1, "image_urls": 1, "maker_slug": 1,
            "user_name": 1, "created_at": 1, "likes": 1,
        },
    ).sort("created_at", -1).limit(limit).to_list(limit)


def _build_showcase_rows(rows: list[dict]) -> list[dict]:
    out: list[dict] = []
    for s in rows:
        img = ""
        if isinstance(s.get("image_urls"), list) and s["image_urls"]:
            img = (s["image_urls"][0] or "").strip()
        if not img:
            img = (s.get("image_url") or "").strip()
        img = _absolute_url(img)
        if not img:
            continue  # no usable image for a partner to ingest
        # Showcase posts surface on the community showcase tab; deep-link
        # to the dedicated post route so partner traffic lands somewhere
        # buyers can actually convert from.
        pid = s.get("id") or ""
        if not pid:
            continue
        title = (s.get("title") or "").strip()
        if not title:
            title = "Showcase from Crafters Market"
        out.append({
            "item_name": title,
            "image_url": img,
            "permalink": f"{SITE_BASE}/community/showcase/{pid}",
        })
    return out


@router.get("/showcase/feed.json")
async def enrich_showcase_feed_json(
    _: bool = Depends(_enrich_key_guard),
    maker_slug: Optional[str] = Query(None),
    limit: int = Query(1000, ge=1, le=5000),
):
    """Top-level array of {item_name, image_url, permalink} for the
    Community Showcase wall — buyer + maker photos of finished pieces.
    Newest-first, opt-out aware."""
    rows = await _fetch_feed_showcase(maker_slug=maker_slug, limit=limit)
    return _build_showcase_rows(rows)


@router.get("/showcase/feed.csv")
async def enrich_showcase_feed_csv(
    _: bool = Depends(_enrich_key_guard),
    maker_slug: Optional[str] = Query(None),
    limit: int = Query(1000, ge=1, le=5000),
):
    rows = await _fetch_feed_showcase(maker_slug=maker_slug, limit=limit)
    feed = _build_showcase_rows(rows)
    buf = io.StringIO()
    w = csv.writer(buf, quoting=csv.QUOTE_MINIMAL, lineterminator="\n")
    w.writerow(["item_name", "image_url", "permalink"])
    for r in feed:
        w.writerow([r["item_name"], r["image_url"], r["permalink"]])
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    return Response(
        content=buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="crafters_showcase_feed_{today}.csv"'},
    )


async def _fetch_feed_design_files(*, maker_slug: Optional[str], limit: int) -> list[dict]:
    """Published design files with a usable thumbnail. Honors the maker
    opt-out toggle just like the showcase + product feeds.
    """
    opted_out = await db.makers.distinct(
        "slug",
        {"external_ads_opt_out": True, "deleted_at": {"$in": [None, ""]}},
    )
    q: dict = {"thumbnail_url": {"$nin": [None, ""]}}
    if maker_slug:
        if maker_slug in opted_out:
            return []
        q["maker_slug"] = maker_slug
    elif opted_out:
        q["maker_slug"] = {"$nin": opted_out + [""]}
    return await db.design_files.find(
        q,
        {
            "_id": 0, "id": 1, "title": 1, "description": 1,
            "thumbnail_url": 1, "maker_slug": 1, "maker_name": 1,
            "file_type": 1, "created_at": 1, "downloads": 1,
        },
    ).sort("created_at", -1).limit(limit).to_list(limit)


def _build_design_file_rows(rows: list[dict]) -> list[dict]:
    out: list[dict] = []
    for d in rows:
        thumb = _absolute_url((d.get("thumbnail_url") or "").strip())
        if not thumb:
            continue
        title = (d.get("title") or "").strip() or "Free CNC Design File"
        # Design files are surfaced on /community (Design Files tab) and
        # also drive the lead-magnet funnel at /free-svg-pack. Point
        # external partners at the lead-magnet page — it's purpose-built
        # for email capture and has its own conversion tracking, so
        # partner traffic converts predictably.
        out.append({
            "item_name": title,
            "image_url": thumb,
            "permalink": f"{SITE_BASE}/free-svg-pack?utm_source=enrichlabs&utm_medium=feed",
        })
    return out


@router.get("/design-files/feed.json")
async def enrich_design_files_feed_json(
    _: bool = Depends(_enrich_key_guard),
    maker_slug: Optional[str] = Query(None),
    limit: int = Query(1000, ge=1, le=5000),
):
    """Top-level array of {item_name, image_url, permalink} for the
    Community Design Files (free SVG/DXF) catalog. Permalink points at
    the lead-magnet landing page (/free-svg-pack) for predictable
    conversion attribution."""
    rows = await _fetch_feed_design_files(maker_slug=maker_slug, limit=limit)
    return _build_design_file_rows(rows)


@router.get("/design-files/feed.csv")
async def enrich_design_files_feed_csv(
    _: bool = Depends(_enrich_key_guard),
    maker_slug: Optional[str] = Query(None),
    limit: int = Query(1000, ge=1, le=5000),
):
    rows = await _fetch_feed_design_files(maker_slug=maker_slug, limit=limit)
    feed = _build_design_file_rows(rows)
    buf = io.StringIO()
    w = csv.writer(buf, quoting=csv.QUOTE_MINIMAL, lineterminator="\n")
    w.writerow(["item_name", "image_url", "permalink"])
    for r in feed:
        w.writerow([r["item_name"], r["image_url"], r["permalink"]])
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    return Response(
        content=buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="crafters_design_files_feed_{today}.csv"'},
    )


# ─────────────────────────────────────────────────────────────────────
# /funnel — onboarding funnel for last N days
# ─────────────────────────────────────────────────────────────────────
@router.get("/funnel")
async def enrich_funnel(
    _: bool = Depends(_enrich_key_guard),
    days: int = Query(30, ge=1, le=365),
):
    """Counts the maker funnel: applied → approved → first_listing →
    first_sale → upgraded_to_plus, scoped to the last N days."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat().replace("+00:00", "Z")

    applied = await db.maker_applications.count_documents(
        {"created_at": {"$gte": cutoff}}
    )
    approved = await db.maker_applications.count_documents(
        {"created_at": {"$gte": cutoff}, "status": "approved"}
    )

    # makers created in the window
    new_makers = await db.makers.find(
        {"created_at": {"$gte": cutoff}},
        {"_id": 0, "slug": 1, "subscription_status": 1},
    ).to_list(5000)
    new_maker_slugs = {m["slug"] for m in new_makers if m.get("slug")}

    # of those, how many published at least 1 listing
    listed = 0
    if new_maker_slugs:
        listed = len(set(await db.products.distinct(
            "maker_slug", {"maker_slug": {"$in": list(new_maker_slugs)}}
        )))

    # of those, how many landed at least 1 paid sale
    sold = 0
    if new_maker_slugs:
        sold = len(set(await db.payment_transactions.distinct(
            "items.maker_slug",
            {"payment_status": "paid", "items.maker_slug": {"$in": list(new_maker_slugs)}},
        )))

    plus = sum(
        1 for m in new_makers
        if (m.get("subscription_status") or "").lower() in ("active", "trialing")
    )

    return {
        "window_days": days,
        "since": cutoff,
        "stages": [
            {"key": "applied",         "label": "Applied",            "count": applied},
            {"key": "approved",        "label": "Approved",           "count": approved},
            {"key": "first_listing",   "label": "Published 1st listing", "count": listed},
            {"key": "first_sale",      "label": "Landed 1st paid sale",  "count": sold},
            {"key": "plus_upgrade",    "label": "Upgraded to Plus",      "count": plus},
        ],
    }


# ─────────────────────────────────────────────────────────────────────
# /traffic — daily aggregates from pageview_events
# ─────────────────────────────────────────────────────────────────────
@router.get("/traffic")
async def enrich_traffic(
    _: bool = Depends(_enrich_key_guard),
    days: int = Query(30, ge=1, le=90),
):
    """Daily pageview + unique-session counts from `pageview_events`.

    GA4 remains the source of truth for richer traffic data — this
    endpoint surfaces the on-platform first-party events so EnrichLabs
    can correlate marketplace activity without a GA4 dependency.
    """
    cutoff_dt = datetime.now(timezone.utc) - timedelta(days=days)
    cutoff = cutoff_dt.isoformat().replace("+00:00", "Z")

    rows = await db.pageview_events.find(
        {"ts": {"$gte": cutoff}},
        {"_id": 0, "ts": 1, "session_id": 1, "visitor_id": 1, "source": 1, "medium": 1, "country": 1},
    ).to_list(200000)

    by_day: dict[str, dict] = defaultdict(lambda: {"pageviews": 0, "sessions": set(), "visitors": set()})
    by_source: dict[str, int] = defaultdict(int)
    by_country: dict[str, int] = defaultdict(int)

    for r in rows:
        ts = r.get("ts") or ""
        day = ts[:10]
        bucket = by_day[day]
        bucket["pageviews"] += 1
        if r.get("session_id"):
            bucket["sessions"].add(r["session_id"])
        if r.get("visitor_id"):
            bucket["visitors"].add(r["visitor_id"])
        src = (r.get("source") or "direct").lower()
        by_source[src] += 1
        cc = (r.get("country") or "").upper() or "unknown"
        by_country[cc] += 1

    daily = sorted(
        [
            {
                "date": day,
                "pageviews": v["pageviews"],
                "sessions": len(v["sessions"]),
                "visitors": len(v["visitors"]),
            }
            for day, v in by_day.items() if day
        ],
        key=lambda r: r["date"],
    )

    return {
        "window_days": days,
        "since": cutoff,
        "totals": {
            "pageviews": sum(d["pageviews"] for d in daily),
            "sessions": sum(d["sessions"] for d in daily),
            "visitors": sum(d["visitors"] for d in daily),
        },
        "daily": daily,
        "by_source": [{"source": k, "pageviews": v}
                      for k, v in sorted(by_source.items(), key=lambda kv: -kv[1])][:20],
        "by_country": [{"country": k, "pageviews": v}
                       for k, v in sorted(by_country.items(), key=lambda kv: -kv[1])][:20],
        "note": "GA4 is the source of truth for richer traffic data. This endpoint reports first-party pageview_events only.",
    }


# ─────────────────────────────────────────────────────────────────────
# /schema — self-describing manifest
# ─────────────────────────────────────────────────────────────────────
@router.get("/schema")
async def enrich_schema(_: bool = Depends(_enrich_key_guard)):
    """Manifest of every endpoint EnrichLabs can call, plus the field
    list each one returns. Use this for introspection / contract pinning."""
    return {
        "version": "1.0",
        "base_url_hint": "https://craftersmarket.org/api/enrich/v1",
        "auth": {"type": "api_key", "header": "X-EnrichLabs-Key"},
        "endpoints": [
            {
                "path": "/orders",
                "method": "GET",
                "description": "Anonymized paid orders, newest first. Buyer is exposed as `buyer_hash` only.",
                "query": ["since (ISO)", "until (ISO)", "limit (1-500)", "cursor (ISO)"],
                "fields": [
                    "id", "created_at", "amount", "currency", "status", "payment_status",
                    "summary", "buyer_hash", "maker_slugs[]", "item_count",
                    "items[].maker_slug", "items[].title", "items[].price", "items[].quantity",
                    "discount_code", "discount_amount", "attribution_source",
                ],
            },
            {
                "path": "/sellers",
                "method": "GET",
                "description": "Active maker shops with computed GMV + paid orders count.",
                "query": ["tier (plus|free)", "limit (1-1000)"],
                "fields": [
                    "slug", "name", "shop_title", "email_hash", "tier",
                    "subscription_status", "founder_status", "location",
                    "onboarded_at", "listings_count", "paid_orders_count",
                    "gross_revenue", "shop_open", "stripe_payouts_enabled",
                ],
            },
            {
                "path": "/listings",
                "method": "GET",
                "description": "Product catalog snapshot.",
                "query": ["maker_slug", "status (published|draft|sold_out|paused)", "limit (1-1000)"],
                "fields": [
                    "id", "slug", "title", "price", "currency", "category", "technique",
                    "maker_slug", "status", "in_stock", "featured", "image_url",
                    "created_at", "published_at",
                ],
            },
            {
                "path": "/funnel",
                "method": "GET",
                "description": "Maker onboarding funnel for the last N days.",
                "query": ["days (1-365, default 30)"],
                "fields": ["window_days", "since", "stages[].key", "stages[].label", "stages[].count"],
            },
            {
                "path": "/traffic",
                "method": "GET",
                "description": "Daily on-platform pageview/session aggregates. GA4 is the canonical source for richer attribution.",
                "query": ["days (1-90, default 30)"],
                "fields": ["window_days", "since", "totals.*", "daily[].date",
                           "daily[].pageviews", "daily[].sessions", "daily[].visitors",
                           "by_source[]", "by_country[]"],
            },
            {
                "path": "/feed.json",
                "method": "GET",
                "description": "Minimal product feed (top-level array). Published + in-stock by default.",
                "query": ["maker_slug", "include_out_of_stock (bool)", "limit (1-5000, default 1000)"],
                "fields": ["product_name", "image_url", "listing_url"],
            },
            {
                "path": "/feed.csv",
                "method": "GET",
                "description": "Same data as /feed.json but RFC-4180 CSV download.",
                "query": ["maker_slug", "include_out_of_stock (bool)", "limit (1-5000, default 1000)"],
                "fields": ["product_name", "image_url", "listing_url"],
            },
            {
                "path": "/showcase/feed.json",
                "method": "GET",
                "description": "Community showcase (buyer + maker photos of finished pieces). Newest-first, opt-out aware. Identical 3-column shape as /feed.json so partners can reuse their listing-feed parser.",
                "query": ["maker_slug", "limit (1-5000, default 1000)"],
                "fields": ["item_name", "image_url", "permalink"],
            },
            {
                "path": "/showcase/feed.csv",
                "method": "GET",
                "description": "Same as /showcase/feed.json but RFC-4180 CSV download.",
                "query": ["maker_slug", "limit (1-5000, default 1000)"],
                "fields": ["item_name", "image_url", "permalink"],
            },
            {
                "path": "/design-files/feed.json",
                "method": "GET",
                "description": "Free SVG/DXF design files. Permalink points at /free-svg-pack (the lead-magnet landing page) for predictable conversion attribution.",
                "query": ["maker_slug", "limit (1-5000, default 1000)"],
                "fields": ["item_name", "image_url", "permalink"],
            },
            {
                "path": "/design-files/feed.csv",
                "method": "GET",
                "description": "Same as /design-files/feed.json but RFC-4180 CSV download.",
                "query": ["maker_slug", "limit (1-5000, default 1000)"],
                "fields": ["item_name", "image_url", "permalink"],
            },
            {
                "path": "/schema",
                "method": "GET",
                "description": "This manifest.",
            },
        ],
    }


# ─────────────────────────────────────────────────────────────────────
# Admin proxy router (iter270) — same data as `/enrich/v1/feed.{csv,json}`
# but gated by the admin JWT instead of the EnrichLabs key, so the admin
# UI's download button doesn't have to know/expose the static API key.
# Mounted at `/api/admin/integrations/enrichlabs/...`.
# ─────────────────────────────────────────────────────────────────────
from maker_auth import current_admin  # noqa: E402

admin_router = APIRouter(
    prefix="/admin/integrations/enrichlabs",
    tags=["enrichlabs-admin"],
)


@admin_router.get("/feed.json")
async def admin_enrich_feed_json(
    _admin: str = Depends(current_admin),
    maker_slug: Optional[str] = Query(None),
    include_out_of_stock: bool = Query(False),
    limit: int = Query(1000, ge=1, le=5000),
):
    rows = await _fetch_feed_products(
        maker_slug=maker_slug,
        include_oos=include_out_of_stock,
        limit=limit,
    )
    return _build_feed_rows(rows)


@admin_router.get("/feed.csv")
async def admin_enrich_feed_csv(
    _admin: str = Depends(current_admin),
    maker_slug: Optional[str] = Query(None),
    include_out_of_stock: bool = Query(False),
    limit: int = Query(1000, ge=1, le=5000),
):
    rows = await _fetch_feed_products(
        maker_slug=maker_slug,
        include_oos=include_out_of_stock,
        limit=limit,
    )
    feed = _build_feed_rows(rows)
    buf = io.StringIO()
    w = csv.writer(buf, quoting=csv.QUOTE_MINIMAL, lineterminator="\n")
    w.writerow(["product_name", "image_url", "listing_url"])
    for r in feed:
        w.writerow([r["product_name"], r["image_url"], r["listing_url"]])
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    fname = f"crafters_market_feed_{today}.csv"
    return Response(
        content=buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )



# iter313 — Admin-proxy versions of the new showcase + design-file feeds.
# Same shape, admin-JWT gated so the admin Settings page can render
# "Download" buttons without exposing ENRICHLABS_API_KEY to the browser.

@admin_router.get("/showcase/feed.json")
async def admin_enrich_showcase_feed_json(
    _admin: str = Depends(current_admin),
    maker_slug: Optional[str] = Query(None),
    limit: int = Query(1000, ge=1, le=5000),
):
    rows = await _fetch_feed_showcase(maker_slug=maker_slug, limit=limit)
    return _build_showcase_rows(rows)


@admin_router.get("/showcase/feed.csv")
async def admin_enrich_showcase_feed_csv(
    _admin: str = Depends(current_admin),
    maker_slug: Optional[str] = Query(None),
    limit: int = Query(1000, ge=1, le=5000),
):
    rows = await _fetch_feed_showcase(maker_slug=maker_slug, limit=limit)
    feed = _build_showcase_rows(rows)
    buf = io.StringIO()
    w = csv.writer(buf, quoting=csv.QUOTE_MINIMAL, lineterminator="\n")
    w.writerow(["item_name", "image_url", "permalink"])
    for r in feed:
        w.writerow([r["item_name"], r["image_url"], r["permalink"]])
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    return Response(
        content=buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="crafters_showcase_feed_{today}.csv"'},
    )


@admin_router.get("/design-files/feed.json")
async def admin_enrich_design_files_feed_json(
    _admin: str = Depends(current_admin),
    maker_slug: Optional[str] = Query(None),
    limit: int = Query(1000, ge=1, le=5000),
):
    rows = await _fetch_feed_design_files(maker_slug=maker_slug, limit=limit)
    return _build_design_file_rows(rows)


@admin_router.get("/design-files/feed.csv")
async def admin_enrich_design_files_feed_csv(
    _admin: str = Depends(current_admin),
    maker_slug: Optional[str] = Query(None),
    limit: int = Query(1000, ge=1, le=5000),
):
    rows = await _fetch_feed_design_files(maker_slug=maker_slug, limit=limit)
    feed = _build_design_file_rows(rows)
    buf = io.StringIO()
    w = csv.writer(buf, quoting=csv.QUOTE_MINIMAL, lineterminator="\n")
    w.writerow(["item_name", "image_url", "permalink"])
    for r in feed:
        w.writerow([r["item_name"], r["image_url"], r["permalink"]])
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    return Response(
        content=buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="crafters_design_files_feed_{today}.csv"'},
    )



# ─────────────────────────────────────────────────────────────────────
# iter328 — Founder × Product-Feed audit (diagnostic)
#
# Explains why the Founders Wall count (`tier: "founder"`) can be
# larger than the number of makers that appear in the EnrichLabs
# product feed. The wall counts every promoted founder; the feed only
# includes founders who have at least one published, in-stock,
# non-deleted product AND haven't opted out of external ads.
#
# Read-only. Admin JWT gated. Same prefix as the rest of the admin
# EnrichLabs proxy so it lives with the tool that produces the feed.
# ─────────────────────────────────────────────────────────────────────
@admin_router.get("/founder-feed-audit")
async def admin_founder_feed_audit(_admin: str = Depends(current_admin)):
    """Per-founder feed-inclusion audit.

    For every maker with `tier="founder"`, returns:
      - founder_number, slug, name, founder_status
      - external_ads_opt_out
      - product counts: total / published / published_in_stock / published_in_stock_with_image
      - in_feed: bool — would this maker's slug appear in /feed.csv?
      - reason: plain-English explanation when in_feed=False

    Also returns aggregate counters that mirror what Enrichlabs sees.
    """
    # Load every founder, sorted by number so output is stable.
    founders = await db.makers.find(
        {"tier": "founder"},
        {
            "_id": 0, "slug": 1, "name": 1, "shop_title": 1,
            "founder_number": 1, "founder_status": 1,
            "external_ads_opt_out": 1, "deleted_at": 1,
            "founder_grace_until": 1, "founder_started_at": 1,
        },
    ).sort("founder_number", 1).to_list(500)

    # One aggregation to bucket product counts per founder slug.
    founder_slugs = [f["slug"] for f in founders if f.get("slug")]
    pipeline = [
        {"$match": {"maker_slug": {"$in": founder_slugs}}},
        {"$group": {
            "_id": "$maker_slug",
            "total": {"$sum": 1},
            "published": {"$sum": {"$cond": [
                {"$and": [
                    {"$eq": ["$status", "published"]},
                    {"$in": [{"$ifNull": ["$deleted_at", None]}, [None, ""]]},
                ]},
                1, 0,
            ]}},
            "published_in_stock": {"$sum": {"$cond": [
                {"$and": [
                    {"$eq": ["$status", "published"]},
                    {"$in": [{"$ifNull": ["$deleted_at", None]}, [None, ""]]},
                    {"$or": [
                        {"$eq": [{"$type": "$in_stock"}, "missing"]},
                        {"$eq": ["$in_stock", True]},
                        {"$gt": [{"$ifNull": ["$in_stock", 0]}, 0]},
                    ]},
                ]},
                1, 0,
            ]}},
            "published_in_stock_with_image": {"$sum": {"$cond": [
                {"$and": [
                    {"$eq": ["$status", "published"]},
                    {"$in": [{"$ifNull": ["$deleted_at", None]}, [None, ""]]},
                    {"$or": [
                        {"$eq": [{"$type": "$in_stock"}, "missing"]},
                        {"$eq": ["$in_stock", True]},
                        {"$gt": [{"$ifNull": ["$in_stock", 0]}, 0]},
                    ]},
                    {"$or": [
                        # Non-empty legacy image_url ...
                        {"$and": [
                            {"$ne": [{"$ifNull": ["$image_url", ""]}, ""]},
                        ]},
                        # ... or a non-empty first entry in images[].
                        {"$and": [
                            {"$eq": [{"$type": "$images"}, "array"]},
                            {"$gt": [{"$size": {"$ifNull": ["$images", []]}}, 0]},
                        ]},
                    ]},
                ]},
                1, 0,
            ]}},
        }},
    ]
    by_slug: dict[str, dict] = {}
    async for row in db.products.aggregate(pipeline):
        by_slug[row["_id"]] = {
            "total": int(row.get("total") or 0),
            "published": int(row.get("published") or 0),
            "published_in_stock": int(row.get("published_in_stock") or 0),
            "published_in_stock_with_image": int(
                row.get("published_in_stock_with_image") or 0
            ),
        }

    out: list[dict] = []
    for f in founders:
        slug = f.get("slug")
        counts = by_slug.get(slug, {
            "total": 0, "published": 0,
            "published_in_stock": 0, "published_in_stock_with_image": 0,
        })
        opt_out = bool(f.get("external_ads_opt_out"))
        deleted = (f.get("deleted_at") or "") not in ("", None)

        # Mirror the exact rules from `_fetch_feed_products` +
        # `_build_feed_rows` so `in_feed` is definitive.
        if deleted:
            in_feed = False
            reason = "Maker doc is soft-deleted (deleted_at is set)."
        elif opt_out:
            in_feed = False
            reason = "Maker toggled external_ads_opt_out — feed is respecting their choice."
        elif counts["total"] == 0:
            in_feed = False
            reason = "No products at all yet — maker hasn't listed anything."
        elif counts["published"] == 0:
            in_feed = False
            reason = f"{counts['total']} product(s) exist but none are status='published'."
        elif counts["published_in_stock"] == 0:
            in_feed = False
            reason = f"{counts['published']} published product(s), but all are out of stock (in_stock=0/False)."
        elif counts["published_in_stock_with_image"] == 0:
            in_feed = False
            reason = f"{counts['published_in_stock']} published+in-stock product(s), but none have a usable image (feed skips imageless rows)."
        else:
            in_feed = True
            reason = None

        out.append({
            "founder_number": f.get("founder_number"),
            "slug": slug,
            "name": f.get("name") or f.get("shop_title") or slug,
            "founder_status": f.get("founder_status"),
            "founder_started_at": f.get("founder_started_at"),
            "founder_grace_until": f.get("founder_grace_until"),
            "external_ads_opt_out": opt_out,
            "products": counts,
            "in_feed": in_feed,
            "reason_excluded": reason,
        })

    # Aggregate summary
    total_founders = len(out)
    in_feed_count = sum(1 for r in out if r["in_feed"])
    excluded = total_founders - in_feed_count
    reason_buckets: dict[str, int] = defaultdict(int)
    for r in out:
        if not r["in_feed"] and r["reason_excluded"]:
            # Bucket by first-sentence prefix so the histogram is compact.
            key = r["reason_excluded"].split(" — ")[0].split(".")[0]
            reason_buckets[key] += 1

    return {
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "summary": {
            "founders_total": total_founders,
            "founders_in_feed": in_feed_count,
            "founders_excluded": excluded,
            "reason_histogram": dict(reason_buckets),
        },
        "founders": out,
    }
