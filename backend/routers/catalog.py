"""Public catalog: products, makers, reviews, blog, activity, custom-orders, maker-applications."""
import math as _math
import os
import random as _random
import re as _re
import time as _time
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional
from fastapi import APIRouter, BackgroundTasks, File, HTTPException, Request, UploadFile
from fastapi import Response

from core import db, now_iso, logger
from email_service import (
    send_applicant_received, send_buyer_custom_ack,
    send_ops_new_application, send_ops_new_custom_order,
)
from models import (
    ActivityEvent, BlogPost, CustomOrder, CustomOrderCreate,
    Maker, MakerApplication, MakerApplicationCreate,
    Product, Review, ReviewCreate,
)

router = APIRouter()

# Bot UA filter — kept tight to common crawlers so legit non-listed
# user-agents (curl debug calls, mobile previews) still get logged.
BOT_RE = _re.compile(
    r"bot|crawl|spider|googlebot|bingbot|facebookexternalhit|slurp|"
    r"yandex|baiduspider|duckduckbot|applebot|semrush|ahrefs|mj12bot",
    _re.IGNORECASE,
)


# iter334n — Lightweight in-process TTL cache for /api/products list reads.
# Keyed by the full (category, technique, q, featured, featured_example,
# maker) tuple. Skipped when maker= is set (private dashboard fetches).
# Resets on process restart, which is fine — we lean on the short TTL to
# keep data fresh and the cap to keep memory bounded.
_LIST_PRODUCTS_CACHE: dict[tuple, tuple[float, list]] = {}
_LIST_PRODUCTS_TTL_S = 60.0
_LIST_PRODUCTS_CACHE_MAX = 32
_LIST_PRODUCTS_HITS = 0
_LIST_PRODUCTS_MISSES = 0


def clear_list_products_cache() -> dict:
    """Drop every cached entry — used by the admin "Clear cache" button
    when a maker pushes a hotfix and doesn't want to wait for TTL."""
    cleared = len(_LIST_PRODUCTS_CACHE)
    _LIST_PRODUCTS_CACHE.clear()
    return {"cleared": cleared}


def get_list_products_cache_stats() -> dict:
    """Snapshot of the /api/products cache — surfaced on the admin
    Prod Health tab so ops can sanity-check hit rate + entry age."""
    now = _time.monotonic()
    entries = []
    for key, (ts, val) in _LIST_PRODUCTS_CACHE.items():
        entries.append({
            "key": "·".join(str(k) if k is not None else "—" for k in key),
            "age_s": round(now - ts, 1),
            "size": len(val),
        })
    entries.sort(key=lambda e: e["age_s"], reverse=True)
    total = _LIST_PRODUCTS_HITS + _LIST_PRODUCTS_MISSES
    return {
        "hits": _LIST_PRODUCTS_HITS,
        "misses": _LIST_PRODUCTS_MISSES,
        "hit_rate": round(_LIST_PRODUCTS_HITS / total, 3) if total else 0.0,
        "entries": entries,
        "entries_count": len(entries),
        "cap": _LIST_PRODUCTS_CACHE_MAX,
        "ttl_s": _LIST_PRODUCTS_TTL_S,
        "oldest_age_s": entries[0]["age_s"] if entries else 0.0,
    }


# ── iter324 — Maker-application anti-spam: cheap in-process IP rate
# limiter. 5 submissions per IP per 60s. Same pattern as contact_messages.
# Resets on process restart, which is fine — anything more sophisticated
# (Redis token bucket) is overkill for a maker apply form.
_MAKER_APP_RATE_BUCKET: dict[str, list[float]] = {}
_MAKER_APP_RATE_LIMIT = 5
_MAKER_APP_RATE_WINDOW_S = 60.0


def _check_maker_app_rate_limit(ip: str) -> None:
    now = _time.monotonic()
    arr = [t for t in _MAKER_APP_RATE_BUCKET.get(ip, []) if now - t < _MAKER_APP_RATE_WINDOW_S]
    if len(arr) >= _MAKER_APP_RATE_LIMIT:
        raise HTTPException(429, "Too many applications from your network — please try again in a minute.")
    arr.append(now)
    _MAKER_APP_RATE_BUCKET[ip] = arr
    # Opportunistic cleanup so the dict never grows unbounded.
    if len(_MAKER_APP_RATE_BUCKET) > 1024:
        for k in list(_MAKER_APP_RATE_BUCKET.keys()):
            _MAKER_APP_RATE_BUCKET[k] = [t for t in _MAKER_APP_RATE_BUCKET[k] if now - t < _MAKER_APP_RATE_WINDOW_S]
            if not _MAKER_APP_RATE_BUCKET[k]:
                _MAKER_APP_RATE_BUCKET.pop(k, None)


@router.get("/policy/version")
async def policy_version():
    """Public — frontend stamps this onto consent payloads so audit trail
    and live UI agree on the policy text the buyer agreed to."""
    from core import POLICY_VERSION
    return {"version": POLICY_VERSION}


@router.get("/policy/fee-policy")
async def fee_policy():
    """Public — surfaces the live fee structure (commission, processing,
    listing fees, Plus tier, off-site ad fee) so the Apply page and the
    Stripe Connect onboarding card render numbers from a single source of
    truth instead of hard-coded copy that can drift from `backend/.env`."""
    from revenue import (
        LISTING_FEE_CENTS, LISTING_FREE_QUOTA,
        PROMOTION_WEEKLY_FEE_CENTS, PLUS_PLATFORM_FEE_BPS,
        PLUS_MONTHLY_LISTING_QUOTA, PLUS_PRICE_USD, OFFSITE_AD_FEE_BPS,
    )
    from routers.stripe_connect import (
        PLATFORM_FEE_BPS, PROCESSING_FEE_BPS, PROCESSING_FEE_FIXED_CENTS,
    )
    from routers.shipping import SHIPPING_MARKUP_PCT
    return {
        "platform_fee_bps": PLATFORM_FEE_BPS,
        "processing_fee_bps": PROCESSING_FEE_BPS,
        "processing_fee_fixed_cents": PROCESSING_FEE_FIXED_CENTS,
        "plus_platform_fee_bps": PLUS_PLATFORM_FEE_BPS,
        "offsite_ad_fee_bps": OFFSITE_AD_FEE_BPS,
        "listing_fee_cents": LISTING_FEE_CENTS,
        "listing_free_quota": LISTING_FREE_QUOTA,
        "plus_monthly_listing_quota": PLUS_MONTHLY_LISTING_QUOTA,
        "plus_price_usd": PLUS_PRICE_USD,
        "promotion_weekly_fee_cents": PROMOTION_WEEKLY_FEE_CENTS,
        "shipping_markup_pct": SHIPPING_MARKUP_PCT,
    }


@router.get("/")
async def root():
    return {"service": "crafters-market", "status": "ok"}


@router.get("/products", response_model=List[Product])
async def list_products(category: Optional[str] = None, technique: Optional[str] = None,
                        q: Optional[str] = None, featured: Optional[bool] = None,
                        featured_example: Optional[bool] = None,
                        maker: Optional[str] = None,
                        sort: Optional[str] = None):
    # iter360 — Validate the optional `?sort=` override. Default is
    # "best" which uses the iter359 weighted relevance score. Other
    # modes short-circuit the score and apply a deterministic key:
    #   newest        → created_at DESC
    #   best_selling  → sales_30d DESC (ties: relevance score)
    #   top_rated     → review_avg DESC (≥3 reviews; ties: review_count)
    #   price_asc     → price ASC
    #   price_desc    → price DESC
    ALLOWED_SORTS = {
        "best", "newest", "best_selling", "top_rated",
        "price_asc", "price_desc",
    }
    sort_mode = (sort or "best").lower()
    if sort_mode not in ALLOWED_SORTS:
        sort_mode = "best"
    # iter334n — 60s in-process TTL cache for the popular catalog reads
    # (homepage rails, hero pill teasers, /shop landing). Keyed by the
    # full param tuple. Cap at 32 entries; oldest evicted FIFO. Skipped
    # for `maker=` queries so the maker dashboard always sees fresh data.
    cache_key = (category, technique, q, featured, featured_example, maker, sort_mode)
    if maker is None:
        hit = _LIST_PRODUCTS_CACHE.get(cache_key)
        if hit and _time.monotonic() - hit[0] < _LIST_PRODUCTS_TTL_S:
            global _LIST_PRODUCTS_HITS
            _LIST_PRODUCTS_HITS += 1
            return hit[1]
        global _LIST_PRODUCTS_MISSES
        _LIST_PRODUCTS_MISSES += 1

    # Exclude soft-deleted listings AND drafts. In Mongo, `field: None` matches
    # both missing-field AND explicit-null docs — covers Pydantic's habit of
    # serializing Optional fields as null. Backwards-compat: products predating
    # the `status` field have no `status` key, so we use $ne:"draft" instead of
    # status:"published" so they keep showing up.
    query: Dict = {"deleted_at": None, "status": {"$ne": "draft"}}
    if category:
        query["category"] = category
    if technique:
        query["technique"] = technique.upper()
    if featured is not None:
        query["featured"] = featured
    # `featured_example=true` filters down to platform-seeded "Featured
    # Example" listings — used by the homepage Featured Builds rail and the
    # /shop?featured=examples view-all destination.
    if featured_example is not None:
        query["featured_example"] = featured_example
    if maker:
        query["maker_slug"] = maker
    if q:
        query["$or"] = [
            {"title": {"$regex": q, "$options": "i"}},
            {"description": {"$regex": q, "$options": "i"}},
        ]
    # Promoted listings (those with promoted_until in the future) bubble to
    # the top. Sort key: is_promoted desc, then is_plus_maker desc, then
    # created_at desc. Crafters Plus subscribers get a stable rank boost
    # — they sit above the rest of the catalog but below paid promotions.
    from core import now_iso
    products = await db.products.find(query, {"_id": 0}).to_list(400)
    nowiso = now_iso()

    # Denormalize the veteran-owned + plus-subscriber flags from each
    # maker so ProductCard can render the right badges without a second
    # round-trip. Two bulk fetches keep this O(badged_count).
    vet_slugs = {
        m["slug"] async for m in db.makers.find(
            {"is_veteran_owned": True}, {"_id": 0, "slug": 1},
        )
    }
    # `subscription_status == "active"` covers both `active` and
    # `trialing` Stripe states (see _sync_sub_to_maker).
    plus_slugs = {
        m["slug"] async for m in db.makers.find(
            {"subscription_status": "active"}, {"_id": 0, "slug": 1},
        )
    }
    for p in products:
        p["maker_is_veteran"] = p.get("maker_slug") in vet_slugs
        p["maker_is_plus"] = p.get("maker_slug") in plus_slugs

    # iter318c — Denormalize maker fields onto the product so ProductCard
    # can render the trust strip (location, lead time, custom-order
    # availability) without an N+1 maker fetch per card. Veteran +
    # plus flags already get bulk-resolved above; this adds the
    # human-facing facts on the same code path.
    maker_meta = {
        m["slug"]: m async for m in db.makers.find(
            {"deleted_at": {"$in": [None, ""]}},
            {"_id": 0, "slug": 1, "location": 1, "lead_time_days": 1,
             "processing_time_days": 1, "accepts_custom_orders": 1,
             "response_time_hours": 1, "is_veteran_owned": 1},
        )
    }
    for p in products:
        m = maker_meta.get(p.get("maker_slug")) or {}
        # Don't overwrite product-level fields if a maker explicitly
        # set them on the listing (per-listing overrides win).
        if not p.get("maker_location"):
            p["maker_location"] = m.get("location") or None
        if not p.get("lead_time_days"):
            p["lead_time_days"] = p.get("processing_time_days") or m.get("lead_time_days") or m.get("processing_time_days")
        if "accepts_custom_orders" not in p:
            p["accepts_custom_orders"] = bool(m.get("accepts_custom_orders"))
        if "maker_response_time_hours" not in p:
            p["maker_response_time_hours"] = m.get("response_time_hours")

    # iter359 — Weighted relevance score (replaces the legacy 3-tier
    # promoted→plus→rest sort). Each listing gets a single number; we
    # sort desc once. Signal weights are tuned for "trust the catalog,
    # but reward what's converting + freshly published":
    #
    #   sales_30d (log1p × 1.4)   — proven conversion, the strongest
    #                               signal we have once orders flow.
    #   views_7d  (log1p × 0.8)   — current demand from the mosaic +
    #                               organic PDP traffic via /impression.
    #   review_avg (× 0.5 √count) — quality, scaled by trust (1 review
    #                               worth 1× weight; 25 worth 5×).
    #   recency  (exp half-life)  — newest listings get the floor, then
    #                               decay over a 30-day half-life.
    #   new-listing bump          — first 14 days get +0.5 so a freshly
    #                               published shop isn't immediately
    #                               buried by older bestsellers.
    #   promoted_active     +1.5  — paid surface, soft boost (not a
    #                               hard tier — a 1-star promoted item
    #                               will still lose to a 5-star native).
    #   maker_is_plus       +0.3  — Plus baseline visibility.
    #   featured            +0.4  — editorial picks.
    #   out_of_stock        -0.4  — don't surface what we can't ship.
    #   slow_lead (>21d)    -0.3  — buyers expect prompt shipping.
    #   jitter (× 0.05)           — break ties without permanent rank
    #                               so two visitors don't see the same
    #                               grid forever.
    slugs = [p.get("slug") for p in products if p.get("slug")]
    iso_30d = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    iso_7d  = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()

    sales_30d_map: Dict[str, int] = {
        d["_id"]: int(d.get("count") or 0)
        async for d in db.events.aggregate([
            {"$match": {
                "type": "product_buy",
                "product_slug": {"$in": slugs},
                "created_at": {"$gte": iso_30d},
            }},
            {"$group": {"_id": "$product_slug", "count": {"$sum": 1}}},
        ])
    } if slugs else {}

    views_7d_map: Dict[str, int] = {
        d["_id"]: int(d.get("count") or 0)
        async for d in db.events.aggregate([
            {"$match": {
                "type": "product_view",
                "product_slug": {"$in": slugs},
                "created_at": {"$gte": iso_7d},
            }},
            {"$group": {"_id": "$product_slug", "count": {"$sum": 1}}},
        ])
    } if slugs else {}

    # `published_publicly` defaults true on native reviews; imported
    # rows opt-in. We exclude opt-out rows so a hidden 1-star can't
    # tank ranking.
    review_map: Dict[str, Dict[str, float]] = {
        d["_id"]: {"avg": float(d.get("avg") or 0.0),
                   "count": int(d.get("count") or 0)}
        async for d in db.reviews.aggregate([
            {"$match": {
                "product_slug": {"$in": slugs},
                "published_publicly": {"$ne": False},
            }},
            {"$group": {
                "_id": "$product_slug",
                "avg": {"$avg": "$rating"},
                "count": {"$sum": 1},
            }},
        ])
    } if slugs else {}

    now_dt = datetime.now(timezone.utc)
    new_listing_floor = (now_dt - timedelta(days=14)).isoformat()

    def _recency_decay(created_at: Optional[str]) -> float:
        if not created_at:
            return 0.0
        try:
            ts = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
        except Exception:
            return 0.0
        days = max(0.0, (now_dt - ts).total_seconds() / 86400.0)
        # Half-life of 30 days → exp(-ln2 · days / 30).
        return _math.exp(-0.693147 * days / 30.0)

    def _score(p: dict) -> float:
        slug = p.get("slug") or ""
        promo_until = p.get("promoted_until")
        promoted = bool(promo_until and promo_until > nowiso)
        rev = review_map.get(slug) or {}
        review_avg = float(rev.get("avg") or 0.0)
        review_count = int(rev.get("count") or 0)

        score = 0.0
        score += _math.log1p(sales_30d_map.get(slug, 0)) * 1.4
        score += _math.log1p(views_7d_map.get(slug, 0)) * 0.8
        if review_count:
            score += (review_avg - 3.5) * _math.sqrt(review_count) * 0.5
        score += _recency_decay(p.get("created_at")) * 0.6
        if (p.get("created_at") or "") >= new_listing_floor:
            score += 0.5
        if promoted:
            score += 1.5
        if p.get("maker_is_plus"):
            score += 0.3
        if p.get("featured"):
            score += 0.4
        if int(p.get("in_stock") or 0) <= 0:
            score -= 0.4
        if int(p.get("lead_time_days") or 0) > 21:
            score -= 0.3
        score += (_random.random() - 0.5) * 0.05   # jitter ±0.025
        return score

    # Annotate so admin/debugging can spot why something ranks high.
    # The `Product` model has `extra="ignore"` so these survive the
    # response_model serialization for inspection in tests/curl without
    # leaking into the public schema.
    for p in products:
        p["_relevance_score"] = _score(p)

    # iter360 — Apply the requested sort mode. `best` (default) uses
    # the weighted score above; everything else is a deterministic
    # override the buyer explicitly asked for via the UI dropdown.
    if sort_mode == "newest":
        products.sort(key=lambda p: (p.get("created_at") or ""), reverse=True)
    elif sort_mode == "best_selling":
        products.sort(
            key=lambda p: (sales_30d_map.get(p.get("slug") or "", 0),
                           p["_relevance_score"]),
            reverse=True,
        )
    elif sort_mode == "top_rated":
        # Require ≥3 reviews to participate in the top-rated bucket
        # so a single 5★ doesn't outrank a 4.8 with 200 reviews.
        def _tr_key(p):
            rev = review_map.get(p.get("slug") or "") or {}
            count = int(rev.get("count") or 0)
            avg = float(rev.get("avg") or 0.0)
            qualifies = 1 if count >= 3 else 0
            return (qualifies, avg, count, p["_relevance_score"])
        products.sort(key=_tr_key, reverse=True)
    elif sort_mode == "price_asc":
        products.sort(key=lambda p: float(p.get("price") or 0))
    elif sort_mode == "price_desc":
        products.sort(key=lambda p: float(p.get("price") or 0), reverse=True)
    else:  # "best"
        products.sort(key=lambda p: p["_relevance_score"], reverse=True)
    result = products[:200]
    # iter334n — Cache the final sorted+denormalized list. Cap eviction
    # is FIFO (not strict LRU) — good-enough for ~4-10 hot keys.
    # Backfill any product missing `id`/`created_at` BEFORE caching so
    # repeat hits don't generate fresh Pydantic defaults each response.
    if maker is None:
        import uuid as _uuid
        for _p in result:
            if not _p.get("id"):
                _p["id"] = str(_uuid.uuid4())
            if not _p.get("created_at"):
                _p["created_at"] = nowiso
        if len(_LIST_PRODUCTS_CACHE) >= _LIST_PRODUCTS_CACHE_MAX:
            oldest = min(_LIST_PRODUCTS_CACHE, key=lambda k: _LIST_PRODUCTS_CACHE[k][0])
            _LIST_PRODUCTS_CACHE.pop(oldest, None)
        _LIST_PRODUCTS_CACHE[cache_key] = (_time.monotonic(), result)
    return result


@router.get("/products/trending", response_model=List[Product])
async def list_trending_products(hours: int = 24, limit: int = 6,
                                 source: Optional[str] = None):
    """iter360 — Top products by `events.product_view` count over the
    last `hours` window. Used by the homepage "Trending in the mosaic"
    strip; pass `source=mosaic` to scope the signal to the mosaic
    beacon only (vs. all PDP/organic views).

    Returns full Product docs in trending order. Listings without
    images are dropped so the strip never renders empty tiles.
    """
    hours = max(1, min(168, int(hours)))   # 1h..7d
    limit = max(1, min(24, int(limit)))
    since_iso = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()

    match: Dict = {"type": "product_view", "created_at": {"$gte": since_iso}}
    if source:
        match["source"] = source

    top = [
        {"slug": d["_id"], "count": int(d.get("count") or 0)}
        async for d in db.events.aggregate([
            {"$match": match},
            {"$group": {"_id": "$product_slug", "count": {"$sum": 1}}},
            {"$sort": {"count": -1}},
            {"$limit": limit * 3},   # over-fetch; some slugs won't resolve
        ])
    ]
    if not top:
        return []

    slugs = [t["slug"] for t in top]
    prod_docs = await db.products.find(
        {"slug": {"$in": slugs}, "deleted_at": None,
         "status": {"$ne": "draft"},
         "images.0": {"$exists": True}},
        {"_id": 0},
    ).to_list(len(slugs))
    by_slug = {p["slug"]: p for p in prod_docs}

    vet_slugs = {
        m["slug"] async for m in db.makers.find(
            {"is_veteran_owned": True}, {"_id": 0, "slug": 1},
        )
    }
    plus_slugs = {
        m["slug"] async for m in db.makers.find(
            {"subscription_status": "active"}, {"_id": 0, "slug": 1},
        )
    }
    ordered: List[dict] = []
    for t in top:
        p = by_slug.get(t["slug"])
        if not p:
            continue
        p["maker_is_veteran"] = p.get("maker_slug") in vet_slugs
        p["maker_is_plus"] = p.get("maker_slug") in plus_slugs
        p["trend_views"] = t["count"]  # iter362 — view-count badge
        ordered.append(p)
        if len(ordered) >= limit:
            break
    return ordered


@router.get("/products/{slug}", response_model=Product)
async def get_product(slug: str):
    doc = await db.products.find_one(
        {"slug": slug, "deleted_at": None, "status": {"$ne": "draft"}}, {"_id": 0}
    )
    if not doc:
        raise HTTPException(404, "Product not found")
    # Denormalize veteran-owned + Plus subscription from the maker so
    # the product page can render both badges (see list_products note).
    maker = await db.makers.find_one(
        {"slug": doc.get("maker_slug")},
        {"_id": 0, "is_veteran_owned": 1, "subscription_status": 1},
    )
    doc["maker_is_veteran"] = bool(maker and maker.get("is_veteran_owned"))
    doc["maker_is_plus"] = bool(
        maker and (maker.get("subscription_status") or "free") == "active"
    )
    return doc


@router.post("/products/{slug}/impression")
async def record_product_impression(slug: str, request: Request):
    """iter358 — Lightweight impression beacon for discovery surfaces.

    The Shop / Makers hero mosaic calls this on tile click via
    `navigator.sendBeacon` so the rotation directly feeds the same
    `events.product_view` stream that listing_budgets reads to compute
    MTD impressions. No auth — public discovery surfaces are open to
    anyone. We deduplicate by (visitor cookie hash, slug, minute) so
    a quickly-rotating tile doesn't spam the counter.

    Returns 204 on success or skip — clients don't read the body.
    """
    from core import now_iso
    import hashlib
    from datetime import datetime as _dt
    ua = request.headers.get("user-agent", "")
    if BOT_RE.search(ua):
        return Response(status_code=204)
    # Reject unknown slugs cheaply so we don't write garbage rows.
    exists = await db.products.find_one(
        {"slug": slug, "deleted_at": None, "status": {"$ne": "draft"}},
        {"_id": 0, "slug": 1, "maker_slug": 1},
    )
    if not exists:
        return Response(status_code=204)
    visitor = (
        request.cookies.get("cm_visitor_id")
        or request.headers.get("x-visitor-id")
        or (request.client.host if request.client else "anon")
    )
    minute_bucket = _dt.utcnow().strftime("%Y%m%d%H%M")
    dedupe_key = hashlib.sha1(
        f"{visitor}|{slug}|{minute_bucket}".encode("utf-8"),
    ).hexdigest()
    await db.events.update_one(
        {"_id": f"impr_{dedupe_key}"},
        {
            "$setOnInsert": {
                "_id": f"impr_{dedupe_key}",
                "type": "product_view",
                "product_slug": slug,
                "maker_slug": exists.get("maker_slug"),
                "source": "mosaic",
                "created_at": now_iso(),
            },
        },
        upsert=True,
    )
    # `upserted_id` is set on the *first* hit; subsequent identical
    # beacons within the same minute do nothing.
    return Response(status_code=204)


@router.get("/makers", response_model=List[Maker])
async def list_makers():
    """Public maker roster — excludes obvious test/incomplete rows.
    A maker is shown only if it has a non-empty cover image and a bio,
    and isn't flagged as a temporary test slug (test-*, iter*-acct-*, etc.).
    """
    q = {
        "cover": {"$nin": [None, ""]},
        "bio": {"$nin": [None, ""]},
        "slug": {"$not": {"$regex": "^(test-|iter\\d+-|beta-|TEST_)"}},
    }
    return await db.makers.find(q, {"_id": 0}).sort("listings_count", -1).to_list(200)


@router.get("/makers/{slug}", response_model=Maker)
async def get_maker(slug: str):
    """Resolves by canonical slug first, then by Plus `custom_url` so
    vanity URLs (`/makers/<vanity>`) work without a second round-trip.
    Vanity URLs only resolve while the maker is still on Plus —
    otherwise the URL is taken-but-inactive (returns 404)."""
    norm = (slug or "").strip().lower()
    doc = await db.makers.find_one({"slug": norm}, {"_id": 0})
    if not doc:
        doc = await db.makers.find_one({"custom_url": norm}, {"_id": 0})
        if doc and (doc.get("subscription_status") or "free") != "active":
            doc = None
    if not doc:
        raise HTTPException(404, "Maker not found")
    return doc


@router.get("/reviews", response_model=List[Review])
async def list_reviews(
    limit: int = 20,
    maker_slug: Optional[str] = None,
    product_slug: Optional[str] = None,
):
    """Returns recent reviews. Optional filters by maker or product slug.

    Imported reviews from Etsy/Shopify (source != None) are filtered
    out when the maker has toggled them to unpublished. Native reviews
    (source is None) are always public — never set published_publicly
    on those, the filter intentionally only kicks in when source exists.
    """
    q: Dict = {
        # `source` field is missing on legacy native reviews → "$exists: false"
        # matches them naturally. Imports always have source set, so when
        # published_publicly is False they get filtered here.
        "$or": [
            {"source": {"$exists": False}},
            {"source": None},
            {"published_publicly": {"$ne": False}},
        ],
    }
    if maker_slug:
        q["maker_slug"] = maker_slug
    if product_slug:
        q["product_slug"] = product_slug
    return await db.reviews.find(q, {"_id": 0}).sort("created_at", -1).to_list(limit)


@router.get("/reviews/aggregate")
async def review_aggregate(
    maker_slug: Optional[str] = None,
    product_slug: Optional[str] = None,
):
    """Returns `{count, average}` for the public reviews matching the
    filter. Fuels JSON-LD `AggregateRating` on PDPs and maker pages so
    Google can render star snippets in SERP results (iter302).

    Mirrors the visibility logic from `list_reviews`:
      • Native reviews (no `source`) always count.
      • Imported reviews count only when `published_publicly != False`.

    Returns zeroed values when no reviews match — callers MUST drop
    AggregateRating from JSON-LD when count is 0 (Schema.org requires
    `reviewCount >= 1`).
    """
    if not maker_slug and not product_slug:
        # Sitewide aggregate — useful for the homepage Organization
        # schema; cheap because it's a single count + sum.
        q: Dict = {
            "$or": [
                {"source": {"$exists": False}},
                {"source": None},
                {"published_publicly": {"$ne": False}},
            ],
        }
    else:
        q = {
            "$or": [
                {"source": {"$exists": False}},
                {"source": None},
                {"published_publicly": {"$ne": False}},
            ],
        }
        if maker_slug:
            q["maker_slug"] = maker_slug
        if product_slug:
            q["product_slug"] = product_slug

    pipeline = [
        {"$match": q},
        {"$group": {
            "_id": None,
            "count": {"$sum": 1},
            "sum": {"$sum": "$rating"},
        }},
    ]
    cursor = db.reviews.aggregate(pipeline)
    rows = await cursor.to_list(1)
    if not rows or rows[0]["count"] == 0:
        return {"count": 0, "average": None}
    row = rows[0]
    return {
        "count": row["count"],
        # Round to 1 decimal — matches the precision Google displays.
        "average": round(row["sum"] / row["count"], 1),
    }


@router.post("/reviews", response_model=Review)
async def create_review(payload: ReviewCreate, bg: BackgroundTasks):
    """Public review submission. Lightly validated — no auth required to keep
    the post-purchase email CTA frictionless."""
    if not payload.name.strip() or not payload.text.strip():
        raise HTTPException(400, "Name and text are required.")
    if not (1 <= payload.rating <= 5):
        raise HTTPException(400, "Rating must be between 1 and 5.")
    if not (payload.maker_slug or payload.product_slug):
        raise HTTPException(400, "Either maker_slug or product_slug is required.")
    # If only product is given, derive the maker so listings can roll up cleanly.
    maker_slug = payload.maker_slug
    if payload.product_slug and not maker_slug:
        prod = await db.products.find_one(
            {"slug": payload.product_slug}, {"_id": 0, "maker_slug": 1},
        )
        if prod:
            maker_slug = prod.get("maker_slug")
    review = Review(
        name=payload.name.strip()[:80],
        location=(payload.location or "").strip()[:60],
        rating=payload.rating,
        text=payload.text.strip()[:1500],
        product_slug=payload.product_slug,
        maker_slug=maker_slug,
    )
    review_doc = review.model_dump()
    await db.reviews.insert_one(review_doc)

    return review


@router.get("/blog", response_model=List[BlogPost])
async def list_posts():
    return await db.blog_posts.find({}, {"_id": 0}).sort("created_at", -1).to_list(50)


@router.get("/blog/{slug}", response_model=BlogPost)
async def get_post(slug: str):
    doc = await db.blog_posts.find_one({"slug": slug}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Post not found")
    return doc


@router.get("/makers/{maker_slug}/blog")
async def list_maker_blog_posts(maker_slug: str, limit: int = 6):
    """Public list of journal posts authored by a specific maker.
    Powers the "More from this maker" section on the maker profile
    page. Caps at 12 entries no matter what `limit` says — keeps the
    response light for the SSR/social-card prerender path."""
    cap = max(1, min(int(limit or 6), 12))
    return await db.blog_posts.find(
        {"created_by_maker": maker_slug},
        {"_id": 0},
    ).sort("created_at", -1).limit(cap).to_list(cap)


@router.post("/blog/{slug}/view")
async def increment_blog_view(slug: str):
    """Lightweight click-counter — bumps `views` on a blog post.

    Powers the homepage Trending Journal rail. We accept any caller
    (no auth) because the rail is a public discovery surface and the
    counter only drives ordering, not ranking that affects revenue.
    Per-post timestamp window approach (not unique-IP) keeps the
    backend cheap; bot inflation is mitigated downstream by capping
    a single client to 1 increment per post per browser session via
    the frontend (sessionStorage)."""
    res = await db.blog_posts.update_one(
        {"slug": slug},
        {
            "$inc": {"views": 1},
            "$push": {
                "view_log": {
                    "$each": [now_iso()],
                    "$slice": -200,  # keep last 200 timestamps
                },
            },
        },
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Post not found")
    return {"ok": True}


@router.get("/blog-trending", response_model=List[BlogPost])
async def trending_blog_posts(limit: int = 6, days: int = 14):
    """Top-clicked journal posts in the last `days` window. Window
    is calculated against the truncated `view_log` so a viral post
    from 6 months ago doesn't dominate forever — only views inside
    the window count toward the trending sort.

    Falls back to recency for the "no clicks yet" case so the rail
    is never empty on a fresh deploy.
    """
    days = max(1, min(int(days or 14), 60))
    cap = max(1, min(int(limit or 6), 12))
    since_iso = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat().replace("+00:00", "Z")

    # Aggregation: count entries in `view_log` ≥ since_iso, then sort.
    pipeline = [
        {"$project": {
            "_id": 0,
            "slug": 1, "title": 1, "excerpt": 1, "body": 1, "cover": 1,
            "author": 1, "read_min": 1, "created_at": 1, "id": 1,
            "views": {"$ifNull": ["$views", 0]},
            "trend_views": {
                "$size": {
                    "$filter": {
                        "input": {"$ifNull": ["$view_log", []]},
                        "as": "ts",
                        "cond": {"$gte": ["$$ts", since_iso]},
                    },
                },
            },
        }},
        {"$sort": {"trend_views": -1, "views": -1, "created_at": -1}},
        {"$limit": cap},
    ]
    out = await db.blog_posts.aggregate(pipeline).to_list(cap)
    # Drop the trend_views/views helpers from the response so it
    # validates cleanly against BlogPost — they're sort keys only.
    for p in out:
        p.pop("trend_views", None)
    return out


@router.post("/custom-orders", response_model=CustomOrder)
async def create_custom_order(payload: CustomOrderCreate, bg: BackgroundTasks):
    if not payload.policy_accepted:
        raise HTTPException(400, "You must accept the Site Policies to submit a custom order.")
    from core import POLICY_VERSION
    data = payload.model_dump()
    # Policy audit trail — stamp server time, server-known version.
    data["policy_version"] = POLICY_VERSION
    data["policy_accepted_at"] = now_iso()
    data.pop("policy_accepted", None)
    order = CustomOrder(**data)
    # Tracking number uniqueness — re-roll on the rare collision. 10 digits
    # = 10B address space so collisions are vanishingly unlikely, but we
    # still guard for correctness.
    for _ in range(5):
        existing = await db.custom_orders.find_one(
            {"tracking_number": order.tracking_number}, {"_id": 1},
        )
        if not existing:
            break
        order = order.model_copy(update={
            "tracking_number": "".join(__import__("secrets").choice("0123456789") for _ in range(10)),
        })
    await db.custom_orders.insert_one(order.model_dump())
    await db.activity_events.insert_one(
        ActivityEvent(kind="applied",
                      text=f"New custom order — {payload.project_type}",
                      location="Custom queue").model_dump()
    )
    bg.add_task(send_ops_new_custom_order,
                payload.name, payload.email, payload.project_type,
                payload.material, payload.description, payload.budget)
    bg.add_task(send_buyer_custom_ack, payload.email, payload.name, payload.project_type, order.tracking_number)
    return order


@router.get("/custom-orders/track/{tracking_number}")
async def public_track_brief(tracking_number: str):
    """Public lookup — anyone with the tracking number can see basic
    status. Returns a sanitised view (no buyer email/phone, no admin
    notes) so the URL is safe to share."""
    if not tracking_number.isdigit() or len(tracking_number) != 10:
        raise HTTPException(400, "Invalid tracking number.")
    order = await db.custom_orders.find_one(
        {"tracking_number": tracking_number}, {"_id": 0},
    )
    if not order:
        raise HTTPException(404, "Brief not found.")

    # Compute a public-friendly status pill from the lifecycle fields.
    status = "submitted"
    if order.get("maker_response_status") == "won_bid":
        status = "won_bid"
    elif order.get("maker_response_status") == "completed":
        status = "completed"
    elif order.get("maker_response_status") == "in_progress":
        status = "in_progress"
    elif order.get("maker_response_status") == "accepted":
        status = "accepted"
    elif order.get("maker_response_status") == "declined":
        status = "declined"
    elif order.get("assigned_maker_slug"):
        status = "assigned"
    elif order.get("status") == "quoted":
        status = "quoted"

    return {
        "tracking_number": tracking_number,
        "status": status,
        "project_type": order.get("project_type"),
        "material": order.get("material"),
        "submitted_at": order.get("created_at"),
        "quoted_at": order.get("quoted_at"),
        "assigned_at": order.get("assigned_at"),
        "assigned_maker_name": order.get("assigned_maker_name"),
        "won_bid_at": order.get("won_bid_at"),
        "reddit_post_url": order.get("reddit_post_url"),
        "reddit_subreddit": order.get("reddit_subreddit"),
    }


@router.post("/custom-orders/upload-design")
async def upload_custom_order_design(file: UploadFile = File(...)):
    """Upload a buyer's design/sketch/reference for a custom-order brief.

    Public endpoint (no auth) because the custom-order wizard is itself
    public. Hard-capped at 10 MB and limited to common design formats so
    we don't accept arbitrary uploads from anonymous traffic.
    """
    try:
        from r2_storage import is_configured as _r2_ok, upload_bytes
    except Exception:
        raise HTTPException(503, "Upload service is not available.")
    if not _r2_ok():
        raise HTTPException(503, "Upload service is not configured.")

    fname = (file.filename or "").lower()
    allowed_ext = (".jpg", ".jpeg", ".png", ".svg", ".pdf", ".dxf", ".webp")
    if not fname.endswith(allowed_ext):
        raise HTTPException(400, f"Supported formats: {', '.join(allowed_ext)}")

    body = await file.read()
    if len(body) > 10 * 1024 * 1024:
        raise HTTPException(413, "Max file size is 10 MB.")

    ct_map = {
        ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
        ".webp": "image/webp", ".svg": "image/svg+xml",
        ".pdf": "application/pdf", ".dxf": "application/dxf",
    }
    ext = next((e for e in ct_map if fname.endswith(e)), ".bin")
    ct = ct_map[ext]
    import uuid as _uuid
    key = f"custom-orders/designs/{_uuid.uuid4().hex}{ext}"
    try:
        url = upload_bytes(body, key, ct, max_bytes=10 * 1024 * 1024)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception:
        raise HTTPException(502, "Could not upload design.")
    return {"url": url, "filename": file.filename, "size": len(body)}


@router.post("/maker-applications", response_model=MakerApplication)
async def create_maker_application(
    payload: MakerApplicationCreate, bg: BackgroundTasks, request: Request,
):
    # iter324 — Anti-spam guard: rate-limit + honeypot + 24h soft dedupe.
    # The contact form has the same shape; keep them in sync if you tune
    # either knob.
    ip = (
        request.headers.get("x-forwarded-for", "").split(",")[0].strip()
        or (request.client.host if request.client else "0.0.0.0")
    )
    _check_maker_app_rate_limit(ip)

    # Honeypot — `MakerApplicationCreate.website` is a hidden field most
    # real applicants never see. Bots that scrape <form> elements fill
    # everything including the honeypot. If it's non-empty, silently
    # return a fabricated success so the bot doesn't retry with variations.
    if (getattr(payload, "website", "") or "").strip():
        logger.info("[maker-app] honeypot tripped from ip=%s", ip)
        # Return a plausible Pydantic instance — same shape as success.
        return MakerApplication(**payload.model_dump(
            exclude={"website", "event_id", "fbp", "fbc"},
        ))

    # Honour the "Allow new maker applications" admin switch.
    from routers.settings import get_setting
    if not await get_setting("allow_maker_applications", True):
        msg = await get_setting(
            "applications_closed_message",
            "We're at capacity for new makers right now. Applications will reopen soon.",
        )
        raise HTTPException(403, msg)

    # iter327 — Duplicate-email guard. If this email already has a
    # pending-email-verification application in the queue, tell them to
    # go check their inbox instead of stacking a second row. This runs
    # BEFORE the 24h dedupe below because the intent is different:
    # dedupe is "you already submitted this today, we hear you";
    # verify-block is "you already submitted — please confirm the email
    # we sent you before starting over".
    pending = await db.maker_applications.find_one(
        {"email": payload.email, "email_verified": False},
        {"_id": 0, "id": 1, "created_at": 1},
    )
    if pending:
        logger.info(
            "[maker-app] dedupe-verify hit for email=%s app_id=%s",
            payload.email, pending.get("id"),
        )
        raise HTTPException(
            status_code=409,
            detail=(
                "You already applied — please check your email to verify. "
                "If you can't find it, check spam or contact us."
            ),
        )

    # iter324 — 24h soft dedupe. If the SAME email submitted in the last
    # 24h, surface the existing row instead of inserting a duplicate.
    # Honest re-submitters get an idempotent response (no error toast,
    # no double email to ops). Bots get exactly the same response, so
    # they can't probe for dupes either.
    from datetime import datetime, timezone, timedelta
    cutoff_iso = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    existing = await db.maker_applications.find_one(
        {"email": payload.email, "created_at": {"$gte": cutoff_iso}},
        {"_id": 0},
        sort=[("created_at", -1)],
    )
    if existing:
        logger.info("[maker-app] dedupe hit for email=%s ip=%s", payload.email, ip)
        return MakerApplication(**{k: v for k, v in existing.items() if k in MakerApplication.model_fields})

    app_obj = MakerApplication(**payload.model_dump(
        exclude={"website", "event_id", "fbp", "fbc"},
    ))
    # Auto-detect Founding Access signups (BetaPage prefixes the about
    # field with this marker before hitting /api/maker-applications).
    if "[FOUNDING SELLER BETA]" in (payload.about or ""):
        # Gate: Founding Access signups must also be enabled by admin toggle.
        if not await get_setting("beta_signup_enabled", True):
            raise HTTPException(
                403,
                "Founding Access signups are closed right now. "
                "Please apply at /apply instead.",
            )
        app_obj.is_beta = True
    # iter327 — Mark verification email as being sent now so the admin
    # queue's "Verification email sent at" tooltip stays accurate. We
    # persist BEFORE the background dispatch so a failed send still
    # leaves a legitimate resend timestamp the admin can act on.
    from datetime import datetime, timezone
    now_iso_str = datetime.now(timezone.utc).isoformat()
    app_obj.email_verification_sent_at = now_iso_str
    await db.maker_applications.insert_one(app_obj.model_dump())
    await db.activity_events.insert_one(
        ActivityEvent(kind="applied",
                      text=f"{payload.studio_name} applied to the program",
                      location=payload.location).model_dump()
    )
    bg.add_task(send_ops_new_application,
                payload.name, payload.studio_name, payload.location,
                payload.email, payload.about)
    # Confirm receipt to the applicant immediately so they know we got it.
    bg.add_task(send_applicant_received,
                payload.email, payload.name, payload.studio_name,
                app_obj.is_beta)
    # iter327 — One-time verification link. Sits alongside the receipt
    # email so the applicant gets both: a warm thank-you AND an explicit
    # confirm-your-email CTA. 7-day TTL. Admin queue view shows a badge
    # (Pending Email Verification / Email Verified) and can resend.
    from maker_auth import issue_application_verify_token
    from email_service import send_application_verify_email
    site = (os.environ.get("FRONTEND_URL") or "https://craftersmarket.org").rstrip("/")
    verify_token = issue_application_verify_token(app_obj.id, payload.email)
    verify_url = f"{site}/apply/verify?token={verify_token}"
    bg.add_task(
        send_application_verify_email,
        payload.email, payload.name, payload.studio_name, verify_url, app_obj.is_beta,
    )

    # iter413bt — Server-side Meta CAPI fire. Uses the SAME event_id the
    # browser pixel already fired (passed in by ApplyPage/BetaPage just
    # before posting) so Meta dedupes the two events into a single
    # attributed conversion. If no event_id was provided (e.g. older
    # frontend cache, ad-blocker stripped the helper), we still fire
    # but Meta will count it as a fresh event — that's fine, the only
    # downside is potential double-count for one applicant. Always
    # backgrounded so a Meta Graph hiccup can't block the form response.
    from routers.meta_capi import send_meta_event
    capi_event_id = payload.event_id or f"app-{app_obj.id}"
    bg.add_task(
        send_meta_event,
        event_name="signup_maker",
        event_id=capi_event_id,
        email=payload.email,
        client_ip=ip,
        user_agent=(request.headers.get("user-agent") or "")[:512],
        fbp=payload.fbp,
        fbc=payload.fbc,
        event_source_url=str(request.headers.get("referer") or "https://craftersmarket.org/apply"),
        custom_data={
            "event_label": "maker_application",
            "is_beta": bool(app_obj.is_beta),
        },
    )
    # iter413cf — TikTok Events API mirror: same event_id as the
    # browser pixel CompleteRegistration fired by ApplyPage so the
    # two streams dedupe into a single attributed signup.
    from routers.tiktok_capi import send_tiktok_event
    bg.add_task(
        send_tiktok_event,
        event_name="signup_maker",
        event_id=capi_event_id,
        email=payload.email,
        external_id=payload.email,
        client_ip=ip,
        user_agent=(request.headers.get("user-agent") or "")[:512],
        ttclid=getattr(payload, "ttclid", None),
        event_source_url=str(request.headers.get("referer") or "https://craftersmarket.org/apply"),
        content_name="maker_application",
        custom_data={
            "event_label": "maker_application",
            "is_beta": bool(app_obj.is_beta),
        },
    )
    return app_obj


@router.get("/activity", response_model=List[ActivityEvent])
async def list_activity(limit: int = 20):
    # Exclude internal admin housekeeping events from the public ticker.
    return await db.activity_events.find(
        {"kind": {"$ne": "admin"}}, {"_id": 0},
    ).sort("created_at", -1).to_list(limit)


# ---------------------------------------------------------------------------
# Shop of the Week — Crafters Plus spotlight
# ---------------------------------------------------------------------------
# Surfaces the highest-GMV active Plus subscriber on the homepage with their
# custom shop banner + 3 best-selling products. Designed to give Plus
# subscribers a tangible, visible payoff and incentivise upgrades.
# ---------------------------------------------------------------------------
@router.get("/shop-of-the-week")
async def shop_of_the_week():
    # 1) Find all Plus subscribers (active OR trialing — both have full perks).
    plus_makers = await db.makers.find(
        {"subscription_status": {"$in": ["active", "trialing"]}}, {"_id": 0}
    ).to_list(200)
    if not plus_makers:
        return {"maker": None, "products": [], "weekly_gmv": 0.0}

    # 2) Aggregate paid GMV per maker over last 30 days. We pull from
    #    `maker_payouts` (already keyed by maker_slug + session) and resolve
    #    per-item units via `payment_transactions.items` joined to products.
    cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    payout_rows = await db.maker_payouts.find(
        {"updated_at": {"$gte": cutoff}},
        {"_id": 0, "maker_slug": 1, "amount": 1, "session_id": 1},
    ).to_list(2000)

    gmv_by_maker: Dict[str, float] = defaultdict(float)
    sessions_by_maker: Dict[str, set] = defaultdict(set)
    for row in payout_rows:
        slug = row.get("maker_slug")
        if not slug:
            continue
        try:
            gmv_by_maker[slug] += float(row.get("amount") or 0)
        except (TypeError, ValueError):
            continue
        if row.get("session_id"):
            sessions_by_maker[slug].add(row["session_id"])

    # 3) Pick winner: highest GMV among Plus subscribers; tie-break on most
    #    recent subscription start (newest energetic shops bubble up).
    plus_slugs = {m["slug"] for m in plus_makers}
    ranked = sorted(
        plus_makers,
        key=lambda m: (
            -gmv_by_maker.get(m["slug"], 0.0),
            -((m.get("subscription_started_at") or "").__hash__()),
        ),
    )
    winner = ranked[0]

    # 4) Top 3 best-selling products in last 30d, fallback to newest published.
    #    Resolve via the winner's paid sessions → items → products.
    top_slugs: List[str] = []
    winner_sessions = list(sessions_by_maker.get(winner["slug"], set()))
    if winner_sessions:
        units: Dict[str, int] = defaultdict(int)
        txs = await db.payment_transactions.find(
            {"session_id": {"$in": winner_sessions[:500]}},
            {"_id": 0, "items": 1},
        ).to_list(500)
        # Build a set of product ids referenced, then resolve to slugs in one shot.
        wanted_ids: set[str] = set()
        line_qty: Dict[str, int] = defaultdict(int)
        for tx in txs:
            for it in tx.get("items") or []:
                pid = it.get("product_id")
                if not pid:
                    continue
                try:
                    qty = max(1, int(it.get("quantity") or 1))
                except (TypeError, ValueError):
                    qty = 1
                line_qty[pid] += qty
                wanted_ids.add(pid)
        if wanted_ids:
            id_docs = await db.products.find(
                {"$or": [{"id": {"$in": list(wanted_ids)}},
                         {"slug": {"$in": list(wanted_ids)}}],
                 "maker_slug": winner["slug"]},
                {"_id": 0, "id": 1, "slug": 1},
            ).to_list(200)
            for doc in id_docs:
                key = doc["id"] if doc["id"] in line_qty else doc.get("slug")
                if key in line_qty:
                    units[doc["slug"]] += line_qty[key]
        top_slugs = [s for s, _ in sorted(units.items(), key=lambda kv: kv[1], reverse=True)][:3]
    products: List[dict] = []
    if top_slugs:
        seen = set()
        docs = await db.products.find(
            {"slug": {"$in": top_slugs}, "deleted_at": None,
             "status": {"$ne": "draft"}, "maker_slug": winner["slug"]},
            {"_id": 0},
        ).to_list(10)
        # Preserve top-sellers order.
        by_slug = {d["slug"]: d for d in docs}
        for s in top_slugs:
            if s in by_slug and s not in seen:
                products.append(by_slug[s])
                seen.add(s)
    if len(products) < 3:
        # Fill with newest published from the same maker.
        existing = {p["slug"] for p in products}
        fillers = await db.products.find(
            {"maker_slug": winner["slug"], "deleted_at": None,
             "status": {"$ne": "draft"}},
            {"_id": 0},
        ).sort("created_at", -1).to_list(10)
        for f in fillers:
            if f["slug"] not in existing:
                products.append(f)
            if len(products) >= 3:
                break

    return {
        "maker": winner,
        "products": products[:3],
        "weekly_gmv": round(gmv_by_maker.get(winner["slug"], 0.0), 2),
        "plus_subscribers_count": len(plus_slugs),
    }
