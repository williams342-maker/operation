"""iter413de — Quality Score HTTP endpoints.

Public API for the versioned scoring engine. Each endpoint returns
the same `{algorithm, version, score, max_score, percent, rules[],
evaluated_at}` shape — analytics pipelines can pin a version forever.

Endpoints:
  • GET /api/maker/listings/{slug}/quality-score
        — maker-self read of their own listing's score (auth required).
  • GET /api/admin/listings/{slug}/quality-score
        — admin read of any listing (mirror for support / Ops Center).
  • GET /api/quality/scorecards
        — public listing of every registered (algorithm, version)
          scorecard so the AI Operations Center can introspect.

The endpoint accepts an optional `?version=v2` query so analytics
or A/B comparisons can score the same listing under multiple
versions of the algorithm at once.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from core import db
from maker_auth import current_admin, current_maker_slug
import quality  # noqa: F401  — import side-effect registers rules
from quality.engine import evaluate, registered_algorithms
from quality.impact import prioritize


# iter413dg — Progress timeline snapshot helper. Persists a compact
# scorecard snapshot whenever the coaching endpoint is read. Two
# safeguards: (a) deduped by content — if score AND per-rule scores
# haven't changed, we DON'T write a new row; (b) capped at the most
# recent 50 snapshots per listing via a one-shot trim. This keeps
# the timeline meaningful (every entry represents real progress)
# without unbounded growth.
TIMELINE_CAP = 50


async def _snapshot_quality(listing_slug: str, scorecard: dict) -> None:
    """Write a deduped scorecard snapshot. Best-effort: any DB error
    is logged but never blocks the coaching response (snapshot is
    nice-to-have for the timeline, not load-bearing for coaching)."""
    try:
        from datetime import datetime, timezone
        # Per-rule score map — used to compute "what changed" deltas later.
        rule_scores = {r["rule_id"]: r["score"] for r in scorecard.get("rules", [])}
        # Most-recent snapshot — skip the insert if score + rule_scores
        # are identical (i.e. the maker reloaded coaching without
        # actually changing anything).
        prev = await db.quality_score_snapshots.find_one(
            {"listing_slug": listing_slug, "algorithm": scorecard.get("algorithm"),
             "version": scorecard.get("version")},
            sort=[("taken_at", -1)],
        )
        if prev and prev.get("score") == scorecard.get("score") and \
                prev.get("rule_scores") == rule_scores:
            return
        await db.quality_score_snapshots.insert_one({
            "listing_slug": listing_slug,
            "algorithm": scorecard.get("algorithm"),
            "version": scorecard.get("version"),
            "score": scorecard.get("score"),
            "max_score": scorecard.get("max_score"),
            "percent": scorecard.get("percent"),
            "rule_scores": rule_scores,
            "taken_at": datetime.now(timezone.utc).isoformat(),
        })
        # Trim history to TIMELINE_CAP newest per (listing, alg, ver).
        cursor = db.quality_score_snapshots.find(
            {"listing_slug": listing_slug,
             "algorithm": scorecard.get("algorithm"),
             "version": scorecard.get("version")},
            {"_id": 1},
        ).sort("taken_at", -1).skip(TIMELINE_CAP)
        stale = [doc["_id"] async for doc in cursor]
        if stale:
            await db.quality_score_snapshots.delete_many({"_id": {"$in": stale}})
    except Exception as e:
        import logging
        logging.getLogger("crafters").warning(
            "[quality] snapshot persist failed for %s: %s", listing_slug, e,
        )


def _rule_label(scorecard: dict, rule_id: str) -> str:
    """Look up the human-readable rule label from a fresh scorecard.
    Used to render timeline entries with proper labels even when an
    older snapshot only has rule_ids."""
    for r in scorecard.get("rules", []):
        if r["rule_id"] == rule_id:
            return r["label"]
    return rule_id


router = APIRouter()


def _build_listing_subject(prod: dict) -> dict:
    """Project the Product doc into the dict shape the rules expect.

    Keeping this projection HERE (not inside rules) means rules stay
    portable: the same `description` rule can later score a draft
    listing payload OR an imported CSV row without changes."""
    return {
        "image": prod.get("image"),
        "images": prod.get("images") or [],
        "description": prod.get("description"),
        "listing_video": prod.get("listing_video"),
        "shipping_profile_id": prod.get("shipping_profile_id"),
        "shipping_flat_rate_cents": prod.get("shipping_flat_rate_cents"),
        "processing_time_days": prod.get("processing_time_days"),
        "title": prod.get("title"),
        "slug": prod.get("slug"),
        "meta_description": prod.get("meta_description"),
        "materials": prod.get("materials"),
    }


async def _load_listing_for_quality(slug: str) -> dict:
    prod = await db.products.find_one(
        {"slug": slug, "deleted_at": None}, {"_id": 0},
    )
    if not prod:
        raise HTTPException(404, "Listing not found.")
    return prod


@router.get("/maker/listings/{slug}/quality-score")
async def maker_listing_quality(
    slug: str,
    version: Optional[str] = None,
    maker_slug: str = Depends(current_maker_slug),
):
    """Maker-self read. Confirms the listing belongs to this maker
    before exposing the scorecard."""
    prod = await _load_listing_for_quality(slug)
    if prod.get("maker_slug") != maker_slug:
        raise HTTPException(403, "Not your listing.")
    report = evaluate("listing_quality", version, _build_listing_subject(prod))
    return report


@router.get("/admin/listings/{slug}/quality-score")
async def admin_listing_quality(
    slug: str,
    version: Optional[str] = None,
    _: dict = Depends(current_admin),
):
    """Admin read — same shape, any listing. Powers the AI Operations
    Center's quality rollup card."""
    prod = await _load_listing_for_quality(slug)
    return evaluate("listing_quality", version, _build_listing_subject(prod))


@router.get("/quality/scorecards")
async def list_scorecards():
    """Public introspection — every (algorithm, version) scorecard
    currently registered. Empty `version` query on the listing/admin
    routes defaults to the algorithm's current default."""
    return {"scorecards": [{"algorithm": a, "version": v}
                            for (a, v) in registered_algorithms()]}


# ── iter413df — Impact Engine coaching endpoints ─────────────────────
# Same scorecard as `/quality-score`, run through `prioritize()` to
# return a ranked action plan: highest-leverage move first, deep-link
# included, plain-English summary. Powers both:
#   • The Seller Success Dashboard coaching panel (P3 UI).
#   • Compass — when a seller asks "why isn't my listing selling?",
#     Compass calls this endpoint and frames the top action.
@router.get("/maker/listings/{slug}/coaching")
async def maker_listing_coaching(
    slug: str,
    version: Optional[str] = None,
    maker_slug: str = Depends(current_maker_slug),
):
    prod = await _load_listing_for_quality(slug)
    if prod.get("maker_slug") != maker_slug:
        raise HTTPException(403, "Not your listing.")
    card = evaluate("listing_quality", version, _build_listing_subject(prod))
    await _snapshot_quality(slug, card)
    return prioritize(card, identifier=slug)


@router.get("/admin/listings/{slug}/coaching")
async def admin_listing_coaching(
    slug: str,
    version: Optional[str] = None,
    _: dict = Depends(current_admin),
):
    """Admin mirror of the coaching endpoint — same shape, any
    listing. Powers the AI Operations Center's "top recommendations"
    rollup AND lets staff inspect what Compass will say to a maker
    before the maker asks."""
    prod = await _load_listing_for_quality(slug)
    card = evaluate("listing_quality", version, _build_listing_subject(prod))
    await _snapshot_quality(slug, card)
    return prioritize(card, identifier=slug)


# iter413dg — Progress Timeline. Returns the recent score history for
# this listing with the per-event deltas — "you went 39 → 64, gained
# +15 on Product Video and +10 on Shipping". Powers the Seller Success
# Dashboard's "What changed?" panel.
@router.get("/maker/listings/{slug}/coaching/timeline")
async def maker_listing_timeline(
    slug: str,
    version: Optional[str] = None,
    limit: int = 10,
    maker_slug: str = Depends(current_maker_slug),
):
    prod = await _load_listing_for_quality(slug)
    if prod.get("maker_slug") != maker_slug:
        raise HTTPException(403, "Not your listing.")
    return await _build_timeline(slug, version, limit, prod)


@router.get("/admin/listings/{slug}/coaching/timeline")
async def admin_listing_timeline(
    slug: str,
    version: Optional[str] = None,
    limit: int = 10,
    _: dict = Depends(current_admin),
):
    prod = await _load_listing_for_quality(slug)
    return await _build_timeline(slug, version, limit, prod)


async def _build_timeline(
    slug: str, version: Optional[str], limit: int, prod: dict,
) -> dict:
    """Build the progress timeline payload. Reads up to `limit`
    snapshots NEWEST-FIRST and computes the delta against the prior
    snapshot for each entry. Labels are resolved from a fresh evaluate
    call so they stay accurate even if rule labels evolve across
    algorithm versions."""
    # Resolve effective version exactly the way evaluate() does.
    fresh = evaluate("listing_quality", version, _build_listing_subject(prod))
    effective_version = fresh["version"]
    limit = max(1, min(50, int(limit or 10)))
    rows = await db.quality_score_snapshots.find(
        {"listing_slug": slug, "algorithm": "listing_quality",
         "version": effective_version},
        {"_id": 0},
    ).sort("taken_at", -1).to_list(limit + 1)
    entries: list = []
    for i, snap in enumerate(rows[:limit]):
        prev = rows[i + 1] if i + 1 < len(rows) else None
        deltas: list = []
        if prev:
            for rule_id, score in (snap.get("rule_scores") or {}).items():
                prev_score = (prev.get("rule_scores") or {}).get(rule_id, 0)
                diff = round(float(score) - float(prev_score), 1)
                if abs(diff) >= 0.5:
                    deltas.append({
                        "rule_id": rule_id,
                        "label": _rule_label(fresh, rule_id),
                        "delta": diff,
                    })
            deltas.sort(key=lambda d: -abs(d["delta"]))
        entries.append({
            "taken_at": snap.get("taken_at"),
            "score": snap.get("score"),
            "percent": snap.get("percent"),
            "score_delta": (
                round(snap.get("score", 0) - prev.get("score", 0), 1)
                if prev else None
            ),
            "deltas": deltas,
        })
    return {
        "listing_slug": slug,
        "algorithm": "listing_quality",
        "version": effective_version,
        "entries": entries,
        "current": {
            "score": fresh["score"],
            "max_score": fresh["max_score"],
            "percent": fresh["percent"],
        },
    }


# iter413dg — Roll-up across all of a maker's listings. Used by the
# Seller Success Dashboard "Coach" tab to show every listing ranked
# worst-first (i.e. priority-first). Cheap projection — does NOT run
# the full Impact-Engine prioritization (that's per-listing on demand).
@router.get("/maker/listings-coaching/rollup")
async def maker_listings_rollup(
    version: Optional[str] = None,
    maker_slug: str = Depends(current_maker_slug),
):
    cursor = db.products.find(
        {"maker_slug": maker_slug, "deleted_at": None},
        {"_id": 0, "slug": 1, "title": 1, "image": 1, "images": 1,
         "description": 1, "listing_video": 1, "shipping_profile_id": 1,
         "shipping_flat_rate_cents": 1, "processing_time_days": 1,
         "meta_description": 1, "materials": 1, "status": 1},
    )
    rows: list = []
    async for prod in cursor:
        card = evaluate("listing_quality", version, _build_listing_subject(prod))
        plan = prioritize(card, identifier=prod["slug"])
        rows.append({
            "slug": prod["slug"],
            "title": prod.get("title"),
            "image": prod.get("image"),
            "status": prod.get("status"),
            "score": plan["score"],
            "max_score": plan["max_score"],
            "percent": plan["percent"],
            "ceiling": plan["ceiling"],
            "gap": plan["gap"],
            "sales_opportunity": plan["sales_opportunity"],
            "next_action_label": (plan["next_action"] or {}).get("label"),
            "next_action_points": (plan["next_action"] or {}).get("points_gain"),
        })
    # Sort worst-first — biggest opportunity at the top.
    rows.sort(key=lambda r: r["percent"])
    return {
        "maker_slug": maker_slug,
        "algorithm": "listing_quality",
        "version": version or "v1",
        "count": len(rows),
        "rows": rows,
    }
