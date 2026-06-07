"""iter335.12 — Cross-maker theme campaigns (Phase 2 Promote).

Concept: a marketplace-wide budget pool (e.g. "Outdoor Decor Week",
"Father's Day", "Veteran Makers") that subsidizes boosts on listings
matching a category filter. Multiple makers benefit from a single
shared pool, and per-maker accounting tracks which themes contributed
to each listing's boost so we can attribute ROAS correctly.

Data model:
  `theme_campaigns` — one doc per theme:
      {
        "_id": "<theme_id>",
        "name": "Outdoor Decor Week",
        "slug": "outdoor-decor-week",
        "status": "active" | "scheduled" | "paused" | "ended",
        "start_date": "2026-06-10",   # ISO date strings, inclusive
        "end_date":   "2026-06-17",
        "pool_total_cents": 250000,   # $2500 total budget
        "pool_remaining_cents": 250000,
        "category_filter": ["outdoor", "garden", "patio"],  # tag match
        "per_maker_cap_cents": 5000,  # max $50 subsidy per maker per theme
        "per_listing_cap_cents": 2000,
        "created_by": "team@craftersmarket.org",
        "created_at": ISO,
        "updated_at": ISO,
      }

  `theme_contributions` — append-only audit log:
      {
        "theme_id": "<id>", "maker_slug": "x", "listing_slug": "y",
        "amount_cents": 500, "applied_at": ISO,
      }

Allocator integration (Phase 2):
  When `apply_allocations` is about to debit a maker's wallet for a
  listing boost, check `find_active_themes_for_listing(slug)`. For
  each matching theme with budget remaining, subsidize up to:
      min(boost_cost, theme.per_listing_cap, theme.per_maker_cap_remaining,
          theme.pool_remaining)
  The subsidy reduces what the maker's wallet pays. Theme pool +
  contribution log are decremented atomically with the maker debit.
"""
from __future__ import annotations
import logging
import secrets
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from core import db, now_iso
from maker_auth import current_admin

router = APIRouter()
log = logging.getLogger("crafters.promote.themes")


class ThemeCreate(BaseModel):
    name: str = Field(..., min_length=3, max_length=120)
    slug: str = Field(..., min_length=3, max_length=80, pattern=r"^[a-z0-9-]+$")
    start_date: str  # YYYY-MM-DD
    end_date: str
    pool_total_cents: int = Field(..., ge=1000, le=10_000_000)
    category_filter: list[str] = Field(default_factory=list)
    per_maker_cap_cents: int = Field(default=5000, ge=100)
    per_listing_cap_cents: int = Field(default=2000, ge=100)


def _validate_dates(start: str, end: str) -> None:
    try:
        s = datetime.strptime(start, "%Y-%m-%d").date()
        e = datetime.strptime(end, "%Y-%m-%d").date()
    except ValueError as ex:
        raise HTTPException(400, f"start_date / end_date must be YYYY-MM-DD: {ex}")
    if e < s:
        raise HTTPException(400, "end_date must be on or after start_date")


@router.post("/admin/promote/themes")
async def create_theme(body: ThemeCreate, _: dict = Depends(current_admin)):
    """Create a new cross-maker theme campaign in `scheduled` state.

    The status auto-flips to `active` on/after `start_date` when the
    allocator next runs; admins can also manually set status via
    `/admin/promote/themes/{id}/status`."""
    _validate_dates(body.start_date, body.end_date)
    if await db.theme_campaigns.find_one({"slug": body.slug}):
        raise HTTPException(409, f"Theme slug '{body.slug}' already exists.")
    theme_id = "theme_" + secrets.token_urlsafe(10)
    doc = {
        "_id": theme_id,
        "theme_id": theme_id,
        "name": body.name,
        "slug": body.slug,
        "status": "scheduled",
        "start_date": body.start_date,
        "end_date": body.end_date,
        "pool_total_cents": int(body.pool_total_cents),
        "pool_remaining_cents": int(body.pool_total_cents),
        "category_filter": list(body.category_filter),
        "per_maker_cap_cents": int(body.per_maker_cap_cents),
        "per_listing_cap_cents": int(body.per_listing_cap_cents),
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.theme_campaigns.insert_one(doc)
    doc.pop("_id", None)
    return {"theme": doc}


@router.get("/admin/promote/themes")
async def list_themes(_: dict = Depends(current_admin)):
    out: list[dict] = []
    async for d in db.theme_campaigns.find({}).sort("created_at", -1):
        d.pop("_id", None)
        out.append(d)
    return {"themes": out}


@router.post("/admin/promote/themes/{theme_id}/status")
async def set_theme_status(theme_id: str, status: str,
                           _: dict = Depends(current_admin)):
    if status not in ("active", "paused", "ended", "scheduled"):
        raise HTTPException(400, "status must be one of active|paused|ended|scheduled")
    r = await db.theme_campaigns.update_one(
        {"_id": theme_id},
        {"$set": {"status": status, "updated_at": now_iso()}},
    )
    if r.matched_count == 0:
        raise HTTPException(404, "Theme not found")
    return {"status": status}


# ── Allocator helper (used by services.promote_allocator) ──────────────
async def find_active_themes_for_listing(slug: str) -> list[dict]:
    """Returns active themes whose category_filter intersects the
    listing's tags. Cheap query — used per-listing during allocation.

    Phase 2 v1: matches if ANY of the listing's tags appear in the
    theme's `category_filter`. Empty category_filter on the theme
    means "matches everything" (e.g. a "Veteran Makers" theme that's
    not category-restricted)."""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    listing = await db.products.find_one(
        {"slug": slug, "deleted_at": None},
        {"_id": 0, "tags": 1, "categories": 1, "maker_slug": 1},
    )
    if not listing:
        return []
    listing_tags = set((listing.get("tags") or []) + (listing.get("categories") or []))

    out: list[dict] = []
    async for t in db.theme_campaigns.find({
        "status": "active",
        "start_date": {"$lte": today},
        "end_date": {"$gte": today},
        "pool_remaining_cents": {"$gt": 0},
    }):
        cat = set(t.get("category_filter") or [])
        if not cat or (cat & listing_tags):
            out.append(t)
    return out


async def claim_theme_subsidy(theme_id: str, maker_slug: str,
                              listing_slug: str, want_cents: int) -> int:
    """Atomically debit the theme's pool by up to `want_cents`,
    respecting per-listing + per-maker + pool caps. Returns the
    actual amount subsidized (may be 0 if all caps already hit)."""
    theme = await db.theme_campaigns.find_one({"_id": theme_id})
    if not theme:
        return 0
    # Per-maker contribution so far for this theme.
    per_maker_used = 0
    async for row in db.theme_contributions.find(
        {"theme_id": theme_id, "maker_slug": maker_slug},
        {"amount_cents": 1},
    ):
        per_maker_used += int(row.get("amount_cents") or 0)

    # Per-listing contribution so far.
    per_listing_used = 0
    async for row in db.theme_contributions.find(
        {"theme_id": theme_id, "listing_slug": listing_slug},
        {"amount_cents": 1},
    ):
        per_listing_used += int(row.get("amount_cents") or 0)

    cap = min(
        int(want_cents),
        max(0, int(theme.get("per_maker_cap_cents") or 0) - per_maker_used),
        max(0, int(theme.get("per_listing_cap_cents") or 0) - per_listing_used),
    )
    if cap <= 0:
        return 0

    # Atomic pool decrement — only succeeds if pool_remaining >= cap.
    updated = await db.theme_campaigns.find_one_and_update(
        {"_id": theme_id, "pool_remaining_cents": {"$gte": cap}},
        {"$inc": {"pool_remaining_cents": -cap},
         "$set": {"updated_at": now_iso()}},
        return_document=True,
    )
    if not updated:
        return 0  # race condition — pool drained between read and update

    await db.theme_contributions.insert_one({
        "theme_id": theme_id, "maker_slug": maker_slug,
        "listing_slug": listing_slug, "amount_cents": int(cap),
        "applied_at": now_iso(),
    })
    return int(cap)
