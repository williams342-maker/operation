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
