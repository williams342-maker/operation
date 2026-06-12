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

from fastapi import APIRouter, Body, Depends, Request

from core import db, listing_price_range
from maker_auth import require_capability, current_admin

router = APIRouter()
log = logging.getLogger("crafters.admin.feeds_health")


# ──────────────────────────────────────────────────────────────────
# Eligibility rules
# ──────────────────────────────────────────────────────────────────

def _has_image(p: dict) -> bool:
    return bool((p.get("images") or [None])[0] or p.get("image_url"))


def _has_price(p: dict) -> bool:
    # iter375 — variable-priced listings count as priced when any variant
    # resolves to a positive effective price (base + delta or override).
    try:
        return listing_price_range(p)[0] > 0
    except (TypeError, ValueError):
        return False


def _has_description(p: dict, *, min_chars: int = 50) -> bool:
    return len(p.get("description") or "") >= min_chars


def _normalize_seo_tags(v: Any) -> list[str]:
    """iter338d — accept either a list[str] or a CSV string from the
    Quick Edit modals and return a deduped, trimmed list[str] (max 12
    tags, each ≤40 chars). Returns [] for None/empty.
    """
    if isinstance(v, list):
        raw = [str(x) for x in v]
    elif isinstance(v, str):
        raw = v.split(",")
    else:
        return []
    out: list[str] = []
    seen: set[str] = set()
    for t in raw:
        t = t.strip()[:40]
        if not t:
            continue
        key = t.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(t)
        if len(out) >= 12:
            break
    return out


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
         "variants": 1, "images": 1, "image_url": 1, "in_stock": 1, "category": 1,
         "technique": 1, "maker_slug": 1, "gpc_path": 1, "materials": 1,
         "colors": 1, "merchant_color": 1},
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
    """Showcase posts feed health — counts approved posts (not admin-
    hidden) that have at least one image so they're useful in
    Pinterest / EnrichLabs distribution.

    iter319a — the actual collection name is `showcase_posts` (NOT
    `community_showcase`) and the visibility filter is
    `admin_hidden != true`. Image lives on either `image_url` or
    `image_urls[0]`.

    iter338 — surface 5 example blocked posts so the admin can drill
    in + fix them (matches the design-files row's UX).
    """
    base = {"admin_hidden": {"$ne": True}}
    has_img = {"$or": [
        {"image_url": {"$exists": True, "$nin": [None, ""]}},
        {"image_urls.0": {"$exists": True}},
    ]}
    total = await db.showcase_posts.count_documents(base)
    ready = await db.showcase_posts.count_documents({**base, **has_img})
    blocked = max(0, total - ready)
    examples_raw = await db.showcase_posts.find(
        {**base, "$nor": [
            {"image_url": {"$exists": True, "$nin": [None, ""]}},
            {"image_urls.0": {"$exists": True}},
        ]},
        {"_id": 0, "id": 1, "slug": 1, "title": 1, "caption": 1,
         "maker_slug": 1, "image_url": 1, "image_urls": 1,
         "seo_title": 1, "seo_description": 1, "seo_tags": 1, "alt_text": 1},
    ).limit(5).to_list(5)
    blocked_examples = [
        {
            "id": e.get("id"),
            "slug": e.get("slug") or e.get("id"),
            "title": (e.get("title") or e.get("caption") or "—")[:60],
            "caption": e.get("caption") or "",
            "image_url": e.get("image_url") or "",
            "maker_slug": e.get("maker_slug") or "—",
            "seo_title": e.get("seo_title") or "",
            "seo_description": e.get("seo_description") or "",
            "seo_tags": e.get("seo_tags") or [],
            "alt_text": e.get("alt_text") or "",
            "blockers": ["missing_image"],
        }
        for e in examples_raw
    ]
    return {
        "channel": "showcase",
        "ready": ready,
        "blocked": blocked,
        "total": total,
        "top_blockers": (
            [{"reason": "missing_image", "count": blocked}] if blocked else []
        ),
        "blocked_examples": blocked_examples,
    }


async def _design_files_health() -> dict[str, Any]:
    """Free SVG/DXF design-files feed — count distributable rows on
    `db.design_files` (the live collection — `community_files` is a
    legacy stub that's never populated).

    iter319a — eligibility now mirrors the public `/community/files`
    feed exactly: applies the same `_design_orphan_guard` predicate
    used by the live router so test/stub rows that the public never
    sees don't pollute the count.

    iter319b — "Ready" requires BOTH a downloadable file URL
    (`primary_url`) AND a thumbnail. A row missing either is not
    distributable.
    """
    # Reuse the live feed's orphan guard so the count mirrors what
    # buyers actually see — avoids the "155 zombies in the feed"
    # phantom-blocker problem.
    from routers.community_files import _design_orphan_guard
    base = {"quarantined_at": None, **_design_orphan_guard()}
    total = await db.design_files.count_documents(base)
    has_thumb = {"thumbnail_url": {"$exists": True, "$nin": [None, ""]}}
    has_file = {"primary_url": {"$exists": True, "$nin": [None, ""]}}
    ready = await db.design_files.count_documents({**base, **has_thumb, **has_file})
    missing_thumb = await db.design_files.count_documents({**base, **has_file, "$or": [
        {"thumbnail_url": {"$exists": False}},
        {"thumbnail_url": {"$in": [None, ""]}},
    ]})
    missing_file = await db.design_files.count_documents({**base, **has_thumb, "$or": [
        {"primary_url": {"$exists": False}},
        {"primary_url": {"$in": [None, ""]}},
    ]})
    missing_both = await db.design_files.count_documents({**base, "$and": [
        {"$or": [{"thumbnail_url": {"$exists": False}}, {"thumbnail_url": {"$in": [None, ""]}}]},
        {"$or": [{"primary_url": {"$exists": False}}, {"primary_url": {"$in": [None, ""]}}]},
    ]})
    # Surface 5 example blocked rows so the admin can act on them.
    examples = await db.design_files.find(
        {**base, "$or": [
            {"thumbnail_url": {"$in": [None, ""]}},
            {"primary_url": {"$in": [None, ""]}},
        ]},
        {"_id": 0, "id": 1, "slug": 1, "title": 1, "thumbnail_url": 1, "primary_url": 1,
         "description": 1, "seo_title": 1, "seo_description": 1, "seo_tags": 1, "alt_text": 1},
    ).limit(5).to_list(5)
    blocked_examples = [
        {
            "id": e.get("id"),
            "slug": e.get("slug") or e.get("id"),
            "title": e.get("title"),
            "description": e.get("description") or "",
            "thumbnail_url": e.get("thumbnail_url") or "",
            "primary_url": e.get("primary_url") or "",
            "maker_slug": "—",
            "seo_title": e.get("seo_title") or "",
            "seo_description": e.get("seo_description") or "",
            "seo_tags": e.get("seo_tags") or [],
            "alt_text": e.get("alt_text") or "",
            "blockers": [
                *(["missing_preview"] if not e.get("thumbnail_url") else []),
                *(["missing_file_url"] if not e.get("primary_url") else []),
            ],
        }
        for e in examples
    ]
    top_blockers = []
    if missing_both:
        top_blockers.append({"reason": "empty_stub", "count": missing_both})
    if missing_thumb:
        top_blockers.append({"reason": "missing_preview", "count": missing_thumb})
    if missing_file:
        top_blockers.append({"reason": "missing_file_url", "count": missing_file})
    return {
        "channel": "design_files",
        "ready": ready,
        "blocked": max(0, total - ready),
        "total": total,
        "top_blockers": top_blockers,
        "blocked_examples": blocked_examples,
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

    # iter366b — Google Merchant attribute quality: rows whose attributes
    # needed a fallback (Multi-color color, underivable material). These
    # still publish fine, but enriching the listing's materials/photos
    # bumps feed quality. Mirrors the live feed's internal warnings.
    from routers.pinterest_feed import _resolve_gpc
    from services.merchant_attributes import merchant_attributes
    quality_examples: list[dict] = []
    quality_warn_rows = 0
    for p in products:
        res = merchant_attributes(p, _resolve_gpc(p))
        if not res["warnings"]:
            continue
        quality_warn_rows += 1
        if len(quality_examples) < 8:
            quality_examples.append({
                "slug": p.get("slug"),
                "title": (p.get("title") or "")[:70],
                "maker_slug": p.get("maker_slug"),
                "warnings": res["warnings"],
            })
    merchant_quality = {
        "rows_total": len(products),
        "rows_with_warnings": quality_warn_rows,
        "examples": quality_examples,
    }

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
        "merchant_quality": merchant_quality,
        "blocker_glossary": {
            "missing_image": "Listing has no images[] or image_url — feed drops it.",
            "missing_price": "Price is 0 or unset — Google / Pinterest / Meta reject.",
            "out_of_stock": "Pinterest + Meta drop out-of-stock items entirely. Google flips availability instead.",
            "shallow_gpc": "GPC path < 3 levels deep — Pinterest alert 126 / Google collapses to root.",
            "short_description": "Pinterest needs ≥50 characters of description for ad approval.",
            "missing_preview": "Design file has no thumbnail — partners can't render a card.",
            "missing_file_url": "Design file has no primary_url — nothing to download.",
            "empty_stub": "Design file has neither a download URL nor a thumbnail — likely a leftover test/AI-stub row. Use Quarantine action to clear.",
        },
    }


@router.post("/admin/feeds/design-files/quarantine-stubs")
async def admin_quarantine_design_file_stubs(
    _: dict = Depends(require_capability("content", "marketplace")),
):
    """iter319b — One-click cleanup for design-file stubs.

    Quarantines any row that lacks a usable download URL — covers
    both empty stubs (no primary_url, no thumbnail) and partially-
    seeded test rows (thumbnail but no primary_url AND no usable
    variant url either). The public `/community/files` listing
    drops quarantined rows automatically.

    Safe to re-run; idempotent. Doesn't delete — just sets
    `quarantined_at` so an operator can review + restore if needed.

    iter319c — Also catches rows whose title literally starts with
    "TEST" (case-insensitive) since those are unambiguously dev
    fixtures that should never reach production buyers.
    """
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    # Step 1 — empty stubs (no primary_url AND no thumbnail).
    res_empty = await db.design_files.update_many(
        {
            "quarantined_at": None,
            "$and": [
                {"$or": [{"thumbnail_url": {"$exists": False}}, {"thumbnail_url": {"$in": [None, ""]}}]},
                {"$or": [{"primary_url": {"$exists": False}}, {"primary_url": {"$in": [None, ""]}}]},
            ],
        },
        {"$set": {"quarantined_at": now, "quarantined_reason": "empty_stub_iter319b"}},
    )
    # Step 2 — TEST_* prefix rows (case-insensitive). These were left
    # behind by iter66/iter221 test runs and never represent a real
    # distributable design file.
    res_test = await db.design_files.update_many(
        {
            "quarantined_at": None,
            "title": {"$regex": "^test[_ -]", "$options": "i"},
        },
        {"$set": {"quarantined_at": now, "quarantined_reason": "test_fixture_iter319c"}},
    )
    # Step 3 — no usable download URL anywhere (primary_url empty AND
    # no variant with a non-empty url). These are partially seeded
    # rows that can't be distributed even though they have a thumbnail.
    res_nofile = await db.design_files.update_many(
        {
            "quarantined_at": None,
            "$and": [
                {"$or": [{"primary_url": {"$exists": False}}, {"primary_url": {"$in": [None, ""]}}]},
                {"$or": [
                    {"variants": {"$exists": False}},
                    {"variants": {"$size": 0}},
                    {"variants.url": {"$in": [None, ""]}},
                ]},
            ],
        },
        {"$set": {"quarantined_at": now, "quarantined_reason": "no_download_url_iter319c"}},
    )
    return {
        "ok": True,
        "quarantined_count": (
            res_empty.modified_count
            + res_test.modified_count
            + res_nofile.modified_count
        ),
        "breakdown": {
            "empty_stub": res_empty.modified_count,
            "test_fixture": res_test.modified_count,
            "no_download_url": res_nofile.modified_count,
        },
        "quarantined_at": now,
    }


@router.post("/admin/feeds/design-files/auto-thumbnail")
async def admin_auto_thumbnail_design_files(
    limit: int = 25,
    _: dict = Depends(require_capability("content", "marketplace")),
):
    """iter319c — Bulk auto-render thumbnails for design files that
    have a downloadable source URL but no `thumbnail_url`.

    Picks up to `limit` rows per call (default 25 — kept low so a
    blocking R2 upload chain stays under the 60s admin-fetch timeout).
    Renders SVG via CairoSVG, DXF via ezdxf+matplotlib, STL via the
    existing stl_renderer, and rasters via Pillow.

    Returns per-row outcome so the admin can re-run for the next
    batch. Safe to re-run; only acts on rows that still lack a
    thumbnail at query time.
    """
    if limit < 1 or limit > 200:
        from fastapi import HTTPException
        raise HTTPException(400, "limit must be 1-200")
    from auto_thumbnail import generate_and_store_thumbnail
    rows = await db.design_files.find(
        {
            "quarantined_at": None,
            "$or": [
                {"thumbnail_url": {"$exists": False}},
                {"thumbnail_url": {"$in": [None, ""]}},
            ],
        },
        {"_id": 0, "id": 1, "title": 1, "file_type": 1, "primary_url": 1,
         "download_url": 1, "variants": 1, "maker_slug": 1, "uploader_id": 1},
    ).limit(limit).to_list(limit)

    results = []
    succeeded = 0
    for doc in rows:
        try:
            url = await generate_and_store_thumbnail(doc)
        except Exception as e:
            log.exception("[auto_thumb] error on %s: %s", doc.get("id"), e)
            url = None
        if url:
            await db.design_files.update_one(
                {"id": doc["id"]},
                {"$set": {"thumbnail_url": url, "thumbnail_auto_generated": True}},
            )
            succeeded += 1
            results.append({"id": doc["id"], "title": doc.get("title"), "ok": True, "url": url})
        else:
            results.append({"id": doc["id"], "title": doc.get("title"), "ok": False,
                             "reason": "no_renderable_source"})
    return {
        "ok": True,
        "attempted": len(rows),
        "succeeded": succeeded,
        "failed": len(rows) - succeeded,
        "results": results,
    }


@router.post("/admin/seo/auto-tag/design-files")
async def admin_auto_tag_design_files(
    limit: int = 25,
    force: bool = False,
    _: dict = Depends(require_capability("content", "marketplace")),
):
    """iter320 — LLM-powered SEO tag backfill for design files.

    Walks `db.design_files` looking for non-quarantined rows that are
    missing any of seo_title / seo_description / seo_tags / alt_text
    (or all of them when `force=true`) and uses Claude Sonnet 4.5 to
    fill them in. Writes back with a `seo_auto_generated_at` audit
    stamp.

    Batch size is capped at 50 per call to keep within the admin
    fetch timeout — re-run for the next batch.
    """
    if limit < 1 or limit > 50:
        from fastapi import HTTPException
        raise HTTPException(400, "limit must be 1-50")
    from auto_seo_tags import bulk_tag_design_files
    r = await bulk_tag_design_files(db, limit=limit, force=force)
    return {"ok": True, **r}


@router.post("/admin/seo/auto-tag/showcase")


# ──────────────────────────────────────────────────────────────────
# iter338 — Manual export-tuning endpoints for design files +
# showcase posts. These give the admin "FeedHealthCard" drill-downs
# the ability to FIX what's blocked, not just count it.
# ──────────────────────────────────────────────────────────────────

@router.post("/admin/feeds/showcase/auto-attach-maker-image")
async def admin_showcase_attach_maker_image(
    limit: int = 50,
    _: dict = Depends(require_capability("content", "marketplace")),
):
    """iter338 — Bulk-attach each maker's `hero_image_url` to their
    showcase posts that currently have no image.

    Mirrors the design-files auto-thumbnail flow: idempotent, batched,
    only acts on rows that still lack imagery at query time. Skips any
    post whose maker has no hero_image_url (those need manual upload).
    """
    if limit < 1 or limit > 500:
        from fastapi import HTTPException
        raise HTTPException(400, "limit must be 1-500")
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    rows = await db.showcase_posts.find(
        {"admin_hidden": {"$ne": True},
         "$nor": [
             {"image_url": {"$exists": True, "$nin": [None, ""]}},
             {"image_urls.0": {"$exists": True}},
         ]},
        {"_id": 0, "id": 1, "slug": 1, "title": 1, "maker_slug": 1},
    ).limit(limit).to_list(limit)
    attached = 0
    skipped: list[dict] = []
    for r in rows:
        maker_slug = r.get("maker_slug")
        if not maker_slug:
            skipped.append({"id": r.get("id"), "reason": "no_maker_slug"})
            continue
        m = await db.makers.find_one(
            {"slug": maker_slug},
            {"hero_image_url": 1, "image_url": 1, "_id": 0},
        )
        img = (m or {}).get("hero_image_url") or (m or {}).get("image_url")
        if not img:
            skipped.append({"id": r.get("id"), "reason": "maker_has_no_hero"})
            continue
        await db.showcase_posts.update_one(
            {"id": r["id"]},
            {"$set": {"image_url": img,
                      "image_auto_attached": True,
                      "image_auto_attached_at": now}},
        )
        attached += 1
    return {
        "ok": True,
        "attempted": len(rows),
        "attached": attached,
        "skipped": len(skipped),
        "skipped_details": skipped[:20],
    }


@router.post("/admin/feeds/showcase/{post_id}/admin-hide")
async def admin_showcase_admin_hide(
    post_id: str,
    _: dict = Depends(require_capability("content", "marketplace")),
):
    """iter338 — Per-row escape hatch for showcase posts that will
    never be distributable (no usable maker image, NSFW, etc.).
    Idempotent. Sets `admin_hidden=true` which removes the row from
    every downstream feed's `ready` count + the public showcase grid.
    """
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    r = await db.showcase_posts.update_one(
        {"id": post_id},
        {"$set": {"admin_hidden": True, "admin_hidden_at": now}},
    )
    if r.matched_count == 0:
        from fastapi import HTTPException
        raise HTTPException(404, f"Showcase post {post_id} not found")
    return {"ok": True, "post_id": post_id, "admin_hidden": True}


@router.patch("/admin/feeds/design-files/{file_id}")
async def admin_patch_design_file(
    file_id: str,
    request: Request,
    claims: dict = Depends(current_admin),
):
    """iter338 — Per-row patch for design files. Limited to the fields
    that actually unblock distribution (thumbnail_url, primary_url,
    title, description, file_type) so the admin can hand-fix a stuck
    row from the FeedHealthCard drill-down without leaving the panel.

    NOTE: uses `current_admin` (header-only) instead of
    `require_capability(...)` because the latter binds the PATCH JSON
    body to its internal `claims: dict` parameter (FastAPI quirk for
    typed-dict params). We re-check the capability inline.
    """
    from fastapi import HTTPException
    from maker_auth import admin_capabilities
    is_super, caps = await admin_capabilities(claims)
    if not (is_super or any(c in caps for c in ("content", "marketplace"))):
        raise HTTPException(403, "Missing capability: content, marketplace.")
    try:
        payload = await request.json()
    except Exception:
        payload = {}
    if not isinstance(payload, dict):
        payload = {}
    ALLOWED = {"thumbnail_url", "primary_url", "title", "description", "file_type",
               "seo_title", "seo_description", "seo_tags", "alt_text"}
    updates = {k: v for k, v in payload.items() if k in ALLOWED}
    if "seo_tags" in updates:
        updates["seo_tags"] = _normalize_seo_tags(updates["seo_tags"])
    if not updates:
        raise HTTPException(400, f"No allowed fields in payload. Allowed: {sorted(ALLOWED)}")
    from datetime import datetime, timezone
    updates["admin_patched_at"] = datetime.now(timezone.utc).isoformat()
    r = await db.design_files.update_one({"id": file_id}, {"$set": updates})
    if r.matched_count == 0:
        raise HTTPException(404, f"Design file {file_id} not found")
    return {"ok": True, "file_id": file_id, "updated_fields": sorted(updates.keys())}


@router.patch("/admin/feeds/showcase/{post_id}")
async def admin_patch_showcase_post(
    post_id: str,
    request: Request,
    claims: dict = Depends(current_admin),
):
    """iter338c — Per-row patch for community showcase posts. Same
    shape as the design-files PATCH: allow-listed fields, header-only
    auth + inline capability check (dodges FastAPI `claims: dict =
    Depends(...)` body-vs-deps collision on PATCH).

    Allows the admin to attach an image_url, fix the caption, or set
    a title on a stuck showcase post without leaving the FeedHealthCard
    drill-down.
    """
    from fastapi import HTTPException
    from maker_auth import admin_capabilities
    is_super, caps = await admin_capabilities(claims)
    if not (is_super or any(c in caps for c in ("content", "marketplace"))):
        raise HTTPException(403, "Missing capability: content, marketplace.")
    try:
        payload = await request.json()
    except Exception:
        payload = {}
    if not isinstance(payload, dict):
        payload = {}
    ALLOWED = {"image_url", "caption", "title",
               "seo_title", "seo_description", "seo_tags", "alt_text"}
    updates = {k: v for k, v in payload.items() if k in ALLOWED}
    if "seo_tags" in updates:
        updates["seo_tags"] = _normalize_seo_tags(updates["seo_tags"])
    if not updates:
        raise HTTPException(400, f"No allowed fields in payload. Allowed: {sorted(ALLOWED)}")
    from datetime import datetime, timezone
    updates["admin_patched_at"] = datetime.now(timezone.utc).isoformat()
    r = await db.showcase_posts.update_one({"id": post_id}, {"$set": updates})
    if r.matched_count == 0:
        raise HTTPException(404, f"Showcase post {post_id} not found")
    return {"ok": True, "post_id": post_id, "updated_fields": sorted(updates.keys())}


async def admin_auto_tag_showcase_posts(
    limit: int = 25,
    force: bool = False,
    _: dict = Depends(require_capability("content", "marketplace")),
):
    """iter320 — LLM-powered SEO tag backfill for showcase posts.
    Sibling to `/admin/seo/auto-tag/design-files`. Skips admin-hidden
    rows. Writes back to `db.showcase_posts`.
    """
    if limit < 1 or limit > 50:
        from fastapi import HTTPException
        raise HTTPException(400, "limit must be 1-50")
    from auto_seo_tags import bulk_tag_showcase_posts
    r = await bulk_tag_showcase_posts(db, limit=limit, force=force)
    return {"ok": True, **r}

