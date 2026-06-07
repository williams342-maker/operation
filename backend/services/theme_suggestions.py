"""iter335.14 — Auto-suggest theme campaigns to admins.

Detects trending tags/categories from recent paid orders. Surfaces them
to admins as one-click theme drafts in PromoteThemesCard.

Algorithm
---------
For each tag/category found across published listings:
  recent_orders  = orders on listings carrying that tag in the last 7 days
  baseline       = orders on the same tag in the prior 7-day window (days 8-14)
  growth_pct     = (recent - baseline) / max(1, baseline) × 100

Returns the top N tags by growth_pct that:
  • have at least MIN_RECENT_ORDERS in the recent window (signal floor)
  • are not already covered by an active theme campaign
  • have ≥ MIN_DISTINCT_MAKERS distinct makers with a matching listing
    (avoids subsidizing a single shop's vocabulary)

The admin can click "Use this" on a suggestion → opens the NewThemeForm
pre-filled with the tag as the category filter, slug auto-derived, a
7-day window starting tomorrow, and a $500 default pool.
"""
from __future__ import annotations

import logging
import re
from collections import Counter
from datetime import datetime, timedelta, timezone

from core import db

log = logging.getLogger("crafters.promote.theme_suggest")

RECENT_DAYS = 7
BASELINE_DAYS = 7
TOP_N = 5
MIN_RECENT_ORDERS = 3
MIN_DISTINCT_MAKERS = 2
MAX_TAG_LEN = 32
TAG_BLACKLIST = {"handmade", "etsy", "custom", "made-to-order", "new", "sale"}


def _slugify(s: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    return s[:60] or "tag"


async def _orders_in_window(start_iso: str, end_iso: str) -> list[dict]:
    """Returns paid orders in [start, end) — only the fields needed."""
    out = []
    async for o in db.orders.find({
        "status": "paid",
        "paid_at": {"$gte": start_iso, "$lt": end_iso},
    }, {"items": 1, "_id": 0}):
        out.append(o)
    return out


def _extract_tags(order: dict) -> list[str]:
    """Pulls tags + category from each line item's snapshot. Falls back
    to empty list — never raises."""
    tags = set()
    for item in (order.get("items") or []):
        snap = item.get("snapshot") or item
        for t in (snap.get("tags") or []):
            if t and isinstance(t, str):
                tags.add(t.strip().lower())
        for c in (snap.get("categories") or []):
            if c and isinstance(c, str):
                tags.add(c.strip().lower())
    return list(tags)


async def _active_theme_filters() -> set[str]:
    """All categories currently covered by an active theme — we skip
    suggestions that would duplicate them."""
    covered = set()
    async for t in db.theme_campaigns.find(
        {"status": "active"}, {"category_filter": 1},
    ):
        for c in (t.get("category_filter") or []):
            covered.add(str(c).lower())
    return covered


async def _maker_count_for_tag(tag: str) -> int:
    """Distinct makers with a published listing carrying this tag."""
    makers = set()
    async for p in db.products.find({
        "$or": [
            {"tags": tag}, {"categories": tag},
        ],
        "status": {"$ne": "draft"}, "deleted_at": None,
    }, {"maker_slug": 1}):
        if p.get("maker_slug"):
            makers.add(p["maker_slug"])
    return len(makers)


async def suggest(limit: int = TOP_N) -> dict:
    """Returns up to `limit` theme suggestions, ranked by growth_pct."""
    now = datetime.now(timezone.utc)
    recent_start = (now - timedelta(days=RECENT_DAYS)).isoformat()
    baseline_start = (now - timedelta(days=RECENT_DAYS + BASELINE_DAYS)).isoformat()
    recent_end = now.isoformat()
    baseline_end = (now - timedelta(days=RECENT_DAYS)).isoformat()

    recent_orders = await _orders_in_window(recent_start, recent_end)
    baseline_orders = await _orders_in_window(baseline_start, baseline_end)

    recent_count: Counter[str] = Counter()
    baseline_count: Counter[str] = Counter()
    for o in recent_orders:
        for t in _extract_tags(o):
            if t and len(t) <= MAX_TAG_LEN and t not in TAG_BLACKLIST:
                recent_count[t] += 1
    for o in baseline_orders:
        for t in _extract_tags(o):
            if t and len(t) <= MAX_TAG_LEN and t not in TAG_BLACKLIST:
                baseline_count[t] += 1

    already_covered = await _active_theme_filters()

    suggestions = []
    for tag, recent in recent_count.most_common(40):
        if tag in already_covered:
            continue
        if recent < MIN_RECENT_ORDERS:
            continue
        baseline = baseline_count.get(tag, 0)
        # Growth pct — bias toward double-window of activity vs prior.
        growth_pct = round(((recent - baseline) / max(1, baseline)) * 100, 1)
        # Filter to growth ≥ 25% (otherwise it's noise, not a trend).
        if growth_pct < 25 and baseline > 0:
            continue
        n_makers = await _maker_count_for_tag(tag)
        if n_makers < MIN_DISTINCT_MAKERS:
            continue
        tomorrow = (now + timedelta(days=1)).strftime("%Y-%m-%d")
        end = (now + timedelta(days=8)).strftime("%Y-%m-%d")
        title_human = tag.replace("-", " ").title()
        suggestions.append({
            "tag": tag,
            "recent_orders": recent,
            "baseline_orders": baseline,
            "growth_pct": growth_pct,
            "distinct_makers": n_makers,
            # Pre-filled theme draft — UI splats these into the form.
            "draft": {
                "name": f"{title_human} Week",
                "slug": _slugify(f"{tag}-week"),
                "category_filter": [tag],
                "start_date": tomorrow,
                "end_date": end,
                "pool_total_cents": 50000,        # $500 default
                "per_maker_cap_cents": 5000,      # $50
                "per_listing_cap_cents": 2000,    # $20
            },
        })
        if len(suggestions) >= limit:
            break

    return {
        "suggestions": suggestions,
        "recent_window_days": RECENT_DAYS,
        "baseline_window_days": BASELINE_DAYS,
        "computed_at": now.isoformat(),
    }
