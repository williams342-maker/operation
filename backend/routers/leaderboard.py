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

from fastapi import APIRouter, Depends, HTTPException, Query

from core import db
from maker_auth import current_maker_slug
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


async def _orders_per_maker(since_iso: str, until_iso: str | None = None) -> dict[str, dict]:
    """Aggregate orders + revenue per maker over [since_iso, until_iso).

    Reads `orders.items[].snapshot.maker_slug` so we still credit the
    maker even if the snapshot is the only record of the original
    listing (e.g. archived/deleted SKUs)."""
    q: dict = {"status": "paid"}
    if until_iso:
        q["paid_at"] = {"$gte": since_iso, "$lt": until_iso}
    else:
        q["paid_at"] = {"$gte": since_iso}
    by_maker: dict[str, dict] = {}
    async for o in db.orders.find(q, {"items": 1, "_id": 0}):
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


async def _reviews_per_maker(since_iso: str, until_iso: str | None = None) -> dict[str, int]:
    out: dict[str, int] = {}
    q: dict = {}
    if until_iso:
        q["created_at"] = {"$gte": since_iso, "$lt": until_iso}
    else:
        q["created_at"] = {"$gte": since_iso}
    async for r in db.reviews.find(q, {"maker_slug": 1, "_id": 0}):
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


async def compute_ranked(
    end_iso: str | None = None,
    window_days: int = WINDOW_DAYS,
    limit: int | None = None,
) -> list[dict]:
    """Pure ranking computation — returned in score-desc order with
    rank already assigned (1-based, contiguous).

    Args:
      end_iso:     the right edge of the window (inclusive). Defaults to
                   now. Passing an earlier `end_iso` gives the
                   leaderboard "as of" that timestamp — used by the
                   maker rank-delta widget to fetch last-week ranks.
      window_days: rolling window size (typ. 30).
      limit:       optional max rows. None = return all eligible makers,
                   which the rank-widget needs to find a maker that
                   isn't in the top 10.
    """
    end_dt = (
        datetime.fromisoformat(end_iso) if end_iso
        else datetime.now(timezone.utc)
    )
    since = (end_dt - timedelta(days=window_days)).isoformat()
    end_cutoff = end_dt.isoformat()

    orders = await _orders_per_maker(since, end_cutoff)
    reviews = await _reviews_per_maker(since, end_cutoff)
    listings = await _listings_and_views_per_maker(since)

    slugs = set(orders) | set(reviews) | set(listings)
    if not slugs:
        return []

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
            continue
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
    if limit:
        ranked = ranked[:limit]
    for i, m in enumerate(ranked, 1):
        m["rank"] = i
    return ranked


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
    makers = await compute_ranked(window_days=window_days, limit=limit)
    return {
        "makers": makers,
        "window_days": window_days,
        "computed_at": datetime.now(timezone.utc).isoformat(),
    }

@router.get("/maker/leaderboard-rank")
async def maker_rank(maker_slug: str = Depends(current_maker_slug)):
    """iter335.17 — Maker-side rank widget.

    Returns this maker's current rank + the week-over-week delta so the
    dashboard can render "#12 (↑3 this week)".

    Implementation: compute the full leaderboard twice — once "as of
    now" and once "as of 7 days ago" — then look up this maker's
    position in each. delta = prev_rank - current_rank, so positive =
    climbing, negative = sliding, zero = held position.

    Returns 503 when the admin has toggled `leaderboard_enabled` OFF
    (matches the public endpoint).
    Returns {on_leaderboard: False, ...} when the maker has zero
    activity in the current window — used by the widget to show a
    "Make your first sale to enter the leaderboard" CTA instead of a
    rank pill.
    """
    enabled = await get_setting("leaderboard_enabled", True)
    if not enabled:
        raise HTTPException(503, "Maker leaderboard is currently disabled.")

    now = datetime.now(timezone.utc)
    last_week = now - timedelta(days=7)

    current = await compute_ranked(end_iso=now.isoformat(), limit=None)
    prev = await compute_ranked(end_iso=last_week.isoformat(), limit=None)

    me_now = next((m for m in current if m["slug"] == maker_slug), None)
    me_prev = next((m for m in prev if m["slug"] == maker_slug), None)

    if not me_now:
        return {
            "on_leaderboard": False,
            "rank": None,
            "score": 0,
            "badge": None,
            "delta": None,
            "prev_rank": me_prev["rank"] if me_prev else None,
            "prev_score": me_prev["score"] if me_prev else 0,
            "total_makers": len(current),
            "window_days": WINDOW_DAYS,
            "computed_at": now.isoformat(),
        }

    if me_prev:
        delta = me_prev["rank"] - me_now["rank"]  # positive = climbed
    else:
        # New entry to the leaderboard this week — treat the rank
        # outside the prior leaderboard as "ranked: not-on-list" rather
        # than fabricating a number; UI shows "NEW" pill.
        delta = None

    return {
        "on_leaderboard": True,
        "rank": me_now["rank"],
        "score": me_now["score"],
        "badge": me_now["badge"],
        "delta": delta,
        "prev_rank": me_prev["rank"] if me_prev else None,
        "prev_score": me_prev["score"] if me_prev else 0,
        "orders": me_now["orders"],
        "revenue_cents": me_now["revenue_cents"],
        "reviews": me_now["reviews"],
        "total_makers": len(current),
        "window_days": WINDOW_DAYS,
        "computed_at": now.isoformat(),
    }

