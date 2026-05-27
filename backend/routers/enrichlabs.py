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
import hashlib
import os
import secrets
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query

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
    expected = (os.environ.get("ENRICHLABS_API_KEY") or "").strip()
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
    salt = (os.environ.get("ENRICHLABS_HASH_SALT") or "cm-enrich-v1").encode()
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
                "path": "/schema",
                "method": "GET",
                "description": "This manifest.",
            },
        ],
    }
