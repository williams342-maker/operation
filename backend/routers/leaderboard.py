"""iter335.15 — Maker Leaderboard (gamification widget).

Public endpoint that returns the top makers by a composite "Workshop
Score" computed over a rolling window. Designed to live on the
`/makers` page above the maker grid — when admins flip the
`leaderboard_enabled` site setting OFF, the endpoint returns 503
and the widget hides itself.

Composite score (per maker, last 30 days unless overridden):
    50 × orders_count
   + 1  × revenue_dollars
   + 5  × reviews_received
   + 2  × listings_published
   + 1  × log10(total_views + 1)

The mix is deliberately weighted toward conversion (orders / revenue)
so that visitors see "who's actually selling" rather than "who posted
the most." All weights are pure ints + rounded so the leaderboard
order is stable + auditable.

Returned per maker:
    {rank, slug, name, hero_image_url, veteran_owned,
     score, orders, revenue_cents, reviews, listings, views, badge}

`badge` is a short human label — "🥇 Top Seller", "🚀 Rising", "🆕 New",
"⭐ Reviewer Favorite" — derived from which signal dominates that
maker's score. Surfaces personality without exposing raw numbers.
"""
from __future__ import annotations

import logging
import math
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Query

from core import db
from routers.settings import get_setting

router = APIRouter()
log = logging.getLogger("crafters.leaderboard")

WINDOW_DAYS = 30
TOP_N = 10

# Score weights (see module docstring for the rationale).
W_ORDERS = 50
W_REVENUE_DOLLARS = 1
W_REVIEWS = 5
W_LISTINGS = 2
W_VIEWS_LOG = 1  # multiplier on log10(views+1)


def _badge_for(stats: dict) -> str:
    """Pick one short label based on which signal dominated this
    maker's score. Falls back to 'Workshop Hero' for balanced shops."""
    orders = stats["orders"]
    reviews = stats["reviews"]
    listings_new = stats["listings_new"]
    revenue = stats["revenue_cents"]
    if revenue >= 50000 and orders >= 5:
        return "Top Seller"
    if reviews >= 5 and reviews / max(1, orders) >= 0.6:
        return "Reviewer Favorite"
    if listings_new >= 5 and orders <= 1:
        return "Rising"
    if listings_new >= 3 and orders >= 1:
        return "On the Rise"
    if orders == 0 and reviews <= 1:
        return "New"
    return "Workshop Hero"


async def _orders_per_maker(since_iso: str) -> dict[str, dict]:
    """Aggregate orders + revenue per maker over the window.

    Reads `orders.items[].snapshot.maker_slug` so we still credit the
    maker even if the snapshot is the only record of the original
    listing (e.g. archived/deleted SKUs)."""
    by_maker: dict[str, dict] = {}
    async for o in db.orders.find(
        {"status": "paid", "paid_at": {"$gte": since_iso}},
        {"items": 1, "_id": 0},
    ):
        for item in (o.get("items") or []):
            snap = item.get("snapshot") or item
            slug = snap.get("maker_slug")
            if not slug:
                continue
            row = by_maker.setdefault(slug, {"orders": 0, "revenue_cents": 0})
            row["orders"] += 1
            unit_cents = int(item.get("price_cents") or snap.get("price_cents") or 0)
            qty = int(item.get("quantity") or 1)
            row["revenue_cents"] += max(0, unit_cents * qty)
    return by_maker


async def _reviews_per_maker(since_iso: str) -> dict[str, int]:
    out: dict[str, int] = {}
    async for r in db.reviews.find(
        {"created_at": {"$gte": since_iso}},
        {"maker_slug": 1, "_id": 0},
    ):
        slug = r.get("maker_slug")
        if slug:
            out[slug] = out.get(slug, 0) + 1
    return out


async def _listings_and_views_per_maker(since_iso: str) -> dict[str, dict]:
    """Returns per-maker {listings_new (in window), listings_total, views_total}."""
    out: dict[str, dict] = {}
    async for p in db.products.find(
        {"status": "published", "deleted_at": None},
        {"maker_slug": 1, "created_at": 1, "metrics": 1, "_id": 0},
    ):
        slug = p.get("maker_slug")
        if not slug:
            continue
        row = out.setdefault(slug, {"listings_new": 0, "listings_total": 0, "views_total": 0})
        row["listings_total"] += 1
        if (p.get("created_at") or "") >= since_iso:
            row["listings_new"] += 1
        row["views_total"] += int(((p.get("metrics") or {}).get("views")) or 0)
    return out


def _score(stats: dict) -> int:
    return int(round(
        W_ORDERS * stats["orders"]
        + W_REVENUE_DOLLARS * (stats["revenue_cents"] / 100)
        + W_REVIEWS * stats["reviews"]
        + W_LISTINGS * stats["listings_new"]
        + W_VIEWS_LOG * math.log10(stats["views_total"] + 1)
    ))


@router.get("/leaderboard/makers")
async def maker_leaderboard(
    window_days: int = Query(WINDOW_DAYS, ge=1, le=365),
    limit: int = Query(TOP_N, ge=1, le=50),
):
    """Returns top makers by Workshop Score over the window.
    Returns 503 when the admin has toggled `leaderboard_enabled` OFF."""
    enabled = await get_setting("leaderboard_enabled", True)
    if not enabled:
        raise HTTPException(503, "Maker leaderboard is currently disabled.")

    since = (datetime.now(timezone.utc) - timedelta(days=window_days)).isoformat()
    orders = await _orders_per_maker(since)
    reviews = await _reviews_per_maker(since)
    listings = await _listings_and_views_per_maker(since)

    # Union of all maker slugs that have ANY signal — skips inactive shops.
    slugs = set(orders) | set(reviews) | set(listings)
    if not slugs:
        return {
            "makers": [],
            "window_days": window_days,
            "computed_at": datetime.now(timezone.utc).isoformat(),
        }

    # Pull maker metadata in one round-trip.
    metas = {}
    async for m in db.makers.find(
        {"slug": {"$in": list(slugs)}, "status": {"$ne": "rejected"}},
        {"slug": 1, "name": 1, "hero_image_url": 1, "image_url": 1,
         "veteran_owned": 1, "_id": 0},
    ):
        metas[m["slug"]] = m

    ranked = []
    for slug in slugs:
        meta = metas.get(slug)
        if not meta:
            continue  # maker may have been rejected / deleted
        stats = {
            "orders": orders.get(slug, {}).get("orders", 0),
            "revenue_cents": orders.get(slug, {}).get("revenue_cents", 0),
            "reviews": reviews.get(slug, 0),
            "listings_new": listings.get(slug, {}).get("listings_new", 0),
            "listings_total": listings.get(slug, {}).get("listings_total", 0),
            "views_total": listings.get(slug, {}).get("views_total", 0),
        }
        score = _score(stats)
        if score <= 0:
            continue
        ranked.append({
            "slug": slug,
            "name": meta.get("name") or slug,
            "hero_image_url": meta.get("hero_image_url") or meta.get("image_url"),
            "veteran_owned": bool(meta.get("veteran_owned")),
            "score": score,
            "badge": _badge_for(stats),
            **stats,
        })

    ranked.sort(key=lambda m: m["score"], reverse=True)
    ranked = ranked[:limit]
    for i, m in enumerate(ranked, 1):
        m["rank"] = i

    return {
        "makers": ranked,
        "window_days": window_days,
        "computed_at": datetime.now(timezone.utc).isoformat(),
    }
