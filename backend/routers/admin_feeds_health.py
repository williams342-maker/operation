"""iter316c — Admin "Feed health" widget.

Single endpoint snapshot of how each external catalog feed will look
when the next downstream sync pulls it. Surfaces per-channel:

    • ready    — # listings that will publish cleanly
    • blocked  — # listings excluded by the feed's eligibility rules
    • blockers — top 5 reasons listings get blocked
                 (missing image, sub-3-level GPC, $0 price, etc.)

Channels covered:
    1. Google Merchant  (XML feed at /api/google-merchant/feed.xml)
    2. Pinterest        (CSV feed at /api/pinterest/feed.csv)
    3. Meta Commerce    (CSV feed at /api/meta/feed.csv)
    4. EnrichLabs       (JSON read-only API used by partner integrations)
    5. Showcase posts   (community feed surfaced to partners)
    6. Design files     (free SVG/DXF lead-magnet feed)

Reasoning is intentionally identical to the live feed code paths
(`shop_feeds.py`, `pinterest_feed.py`, `enrichlabs.py`) so the admin
sees the same view the downstream channel does.
"""
from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends

from core import db
from maker_auth import require_capability

router = APIRouter()
log = logging.getLogger("crafters.admin.feeds_health")


# ──────────────────────────────────────────────────────────────────
# Eligibility rules
# ──────────────────────────────────────────────────────────────────

def _has_image(p: dict) -> bool:
    return bool((p.get("images") or [None])[0] or p.get("image_url"))


def _has_price(p: dict) -> bool:
    return bool(p.get("price") and p["price"] > 0)


def _has_description(p: dict, *, min_chars: int = 50) -> bool:
    return len(p.get("description") or "") >= min_chars


def _has_gpc_3plus(p: dict) -> bool:
    """Pinterest alert 126 trips on paths < 3 levels. We trust the
    backend `_resolve_gpc` mapper to always emit ≥3 — but a maker-
    supplied override could be shallow, so check explicitly."""
    from routers.pinterest_feed import _resolve_gpc
    path = _resolve_gpc(p) or ""
    return path.count(">") >= 2


def _check_listing(p: dict, *, channel: str) -> list[str]:
    """Returns the list of blocker reasons (empty list = ready). Different
    channels apply different strictness — Google is the most lenient
    (description + price + image + GPC), Pinterest is the strictest
    (description ≥50 chars + image + ≥3-level GPC + price > 0)."""
    issues: list[str] = []
    if not _has_image(p):
        issues.append("missing_image")
    if not _has_price(p):
        issues.append("missing_price")
    if not p.get("in_stock") or p["in_stock"] < 1:
        # In-stock=0 still goes through with availability=out_of_stock
        # on Google, but Pinterest / Meta drop it. So channel-dependent:
        if channel in {"pinterest", "meta"}:
            issues.append("out_of_stock")
    if not _has_gpc_3plus(p):
        issues.append("shallow_gpc")
    if channel == "pinterest" and not _has_description(p, min_chars=50):
        issues.append("short_description")
    return issues


# ──────────────────────────────────────────────────────────────────
# Per-channel runners
# ──────────────────────────────────────────────────────────────────

async def _fetch_eligible_products() -> list[dict]:
    """Same base filter the live feeds use — published, not deleted,
    maker not opted-out of external ads."""
    opted_out = await db.makers.distinct(
        "slug",
        {"external_ads_opt_out": True, "deleted_at": {"$in": [None, ""]}},
    )
    q: dict[str, Any] = {
        "status": "published",
        "deleted_at": {"$in": [None, ""]},
    }
    if opted_out:
        q["maker_slug"] = {"$nin": opted_out}
    return await db.products.find(
        q,
        {"_id": 0, "slug": 1, "title": 1, "description": 1, "price": 1,
         "images": 1, "image_url": 1, "in_stock": 1, "category": 1,
         "technique": 1, "maker_slug": 1, "gpc_path": 1},
    ).limit(5000).to_list(5000)


def _bucket(channel: str, products: list[dict]) -> dict[str, Any]:
    """Compute ready / blocked / blocker-histogram for one channel."""
    ready = 0
    blocked = 0
    blocker_counts: dict[str, int] = {}
    blocked_examples: list[dict] = []
    for p in products:
        issues = _check_listing(p, channel=channel)
        if not issues:
            ready += 1
            continue
        blocked += 1
        for i in issues:
            blocker_counts[i] = blocker_counts.get(i, 0) + 1
        if len(blocked_examples) < 5:
            blocked_examples.append({
                "slug": p.get("slug"),
                "title": p.get("title"),
                "maker_slug": p.get("maker_slug"),
                "blockers": issues,
            })
    blockers_sorted = sorted(blocker_counts.items(), key=lambda x: -x[1])[:5]
    return {
        "channel": channel,
        "ready": ready,
        "blocked": blocked,
        "total": ready + blocked,
        "top_blockers": [
            {"reason": k, "count": v} for k, v in blockers_sorted
        ],
        "blocked_examples": blocked_examples,
    }


async def _showcase_health() -> dict[str, Any]:
    """Showcase posts feed health — items need an image to be useful in
    Pinterest / EnrichLabs distribution. Counts approved posts (gate:
    not deleted, status=public)."""
    total = await db.community_showcase.count_documents(
        {"deleted_at": {"$in": [None, ""]}},
    )
    ready = await db.community_showcase.count_documents(
        {"deleted_at": {"$in": [None, ""]},
         "images": {"$exists": True, "$ne": []}},
    )
    return {
        "channel": "showcase",
        "ready": ready,
        "blocked": max(0, total - ready),
        "total": total,
        "top_blockers": [
            {"reason": "missing_image", "count": max(0, total - ready)},
        ] if total > ready else [],
        "blocked_examples": [],
    }


async def _design_files_health() -> dict[str, Any]:
    """Free SVG/DXF design-files feed — need at least one file URL and
    a preview image to be partner-distributable."""
    total = await db.community_files.count_documents(
        {"deleted_at": {"$in": [None, ""]}, "is_free": True},
    )
    ready = await db.community_files.count_documents(
        {"deleted_at": {"$in": [None, ""]}, "is_free": True,
         "preview_url": {"$exists": True, "$ne": None}},
    )
    return {
        "channel": "design_files",
        "ready": ready,
        "blocked": max(0, total - ready),
        "total": total,
        "top_blockers": (
            [{"reason": "missing_preview", "count": total - ready}]
            if total > ready else []
        ),
        "blocked_examples": [],
    }


@router.get("/admin/feeds/health")
async def admin_feeds_health(
    _: dict = Depends(require_capability("content", "marketplace")),
):
    """Snapshot of every catalog feed's eligibility status. Cached
    nowhere — Mongo aggregates are < 200ms even at 5k listings, and
    the admin views it occasionally."""
    products = await _fetch_eligible_products()
    channels = [
        _bucket("google_merchant", products),
        _bucket("pinterest", products),
        _bucket("meta", products),
        _bucket("enrichlabs", products),
    ]
    channels.append(await _showcase_health())
    channels.append(await _design_files_health())

    # Quick rollup numbers for the card header.
    total_products = len(products)
    fully_ready = sum(
        1 for p in products
        if not _check_listing(p, channel="pinterest")  # strictest channel
    )
    return {
        "as_of": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
        "products_total": total_products,
        "products_fully_ready": fully_ready,
        "channels": channels,
        "blocker_glossary": {
            "missing_image": "Listing has no images[] or image_url — feed drops it.",
            "missing_price": "Price is 0 or unset — Google / Pinterest / Meta reject.",
            "out_of_stock": "Pinterest + Meta drop out-of-stock items entirely. Google flips availability instead.",
            "shallow_gpc": "GPC path < 3 levels deep — Pinterest alert 126 / Google collapses to root.",
            "short_description": "Pinterest needs ≥50 characters of description for ad approval.",
        },
    }
