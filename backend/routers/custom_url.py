"""Crafters Plus — custom shop URL picker (Founder Tier Phase 4 #4).

Endpoints (Plus subscribers only — `subscription_status == "active"`):
    GET  /api/maker/custom-url                       → current value + rules
    GET  /api/maker/custom-url/check/{candidate}     → availability check
    POST /api/maker/custom-url                       → claim / change

Plus the public resolver:
    GET  /api/makers/resolve/{name}                  → maker for either
                                                       slug OR custom_url

Validation rules (kept tight to avoid impersonation / SEO trouble):
    - lowercase a-z, digit 0-9, hyphen (no leading/trailing hyphen)
    - length 3-30
    - reserved-word blocklist (system routes, taxonomy keywords)
    - cannot collide with any existing `slug` or another maker's
      `custom_url`
"""
from __future__ import annotations
import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from core import db, logger, now_iso
from maker_auth import current_maker_slug

router = APIRouter()


# Anything that would conflict with an existing or near-future URL
# segment, plus impersonation risks. Lowercase comparison.
RESERVED_WORDS: frozenset[str] = frozenset({
    # System routes & docs
    "admin", "api", "auth", "login", "logout", "signup", "signin",
    "register", "verify", "dashboard", "settings", "billing", "checkout",
    "cart", "search", "static", "public", "assets", "favicon",
    # Marketplace structure
    "shop", "shops", "maker", "makers", "buyer", "buyers", "seller",
    "sellers", "product", "products", "listing", "listings", "order",
    "orders", "review", "reviews", "blog", "forum", "showcase",
    "community", "newsletter", "press", "support", "help", "contact",
    "about", "faq", "policy", "policies", "terms", "privacy",
    "cookies", "legal",
    # Brand / impersonation
    "crafters", "craftersmarket", "craftermarket", "etsy", "amazon",
    "ebay", "google", "facebook", "instagram", "tiktok", "pinterest",
    "twitter", "x",
    # Reserved categories / techniques (avoid clobbering future taxonomy URLs)
    "cnc", "laser", "wood", "metal", "ceramic", "leather", "resin",
    "category", "categories", "tag", "tags", "technique", "techniques",
    "founder", "founders", "veteran", "veterans", "plus", "free",
    "trial", "pro", "premium",
    # Single-letter / two-letter (too noisy)
    "a", "b", "c", "x", "y", "z",
})


SLUG_RE = re.compile(r"^(?!-)[a-z0-9-]{3,30}(?<!-)$")


class CustomUrlState(BaseModel):
    custom_url: Optional[str] = None
    custom_url_changed_at: Optional[str] = None
    min_length: int = 3
    max_length: int = 30
    rules: str = (
        "Lowercase letters, numbers, and hyphens. 3-30 chars. "
        "Can't start/end with a hyphen."
    )


class CheckResp(BaseModel):
    candidate: str
    available: bool
    reason: Optional[str] = None


class ClaimReq(BaseModel):
    custom_url: str = Field(min_length=3, max_length=30)


def _normalize(raw: str) -> str:
    return (raw or "").strip().lower()


def _validate_format(candidate: str) -> Optional[str]:
    """Return error message if invalid, None if format passes."""
    if not candidate:
        return "Pick something — can't be blank."
    if len(candidate) < 3:
        return "Too short — 3 characters minimum."
    if len(candidate) > 30:
        return "Too long — 30 characters maximum."
    if not SLUG_RE.match(candidate):
        return (
            "Only lowercase letters, numbers, and hyphens. "
            "Can't start or end with a hyphen."
        )
    if candidate in RESERVED_WORDS:
        return "That name is reserved by the platform — try another."
    return None


async def _require_plus(slug: str) -> dict:
    m = await db.makers.find_one({"slug": slug}, {"_id": 0})
    if not m:
        raise HTTPException(404, "Maker not found.")
    if (m.get("subscription_status") or "free") != "active":
        raise HTTPException(403, {
            "code": "plus_required",
            "message": "Custom shop URLs are a Crafters Plus benefit.",
        })
    return m


@router.get("/maker/custom-url", response_model=CustomUrlState)
async def get_custom_url(slug: str = Depends(current_maker_slug)):
    m = await _require_plus(slug)
    return CustomUrlState(
        custom_url=m.get("custom_url"),
        custom_url_changed_at=m.get("custom_url_changed_at"),
    )


@router.get("/maker/custom-url/check/{candidate}", response_model=CheckResp)
async def check_custom_url(
    candidate: str, slug: str = Depends(current_maker_slug),
):
    """Live availability check — used by the picker UI to give instant
    feedback as the maker types. Plus gating still enforced server-side
    so a free maker can't probe the namespace."""
    await _require_plus(slug)
    cand = _normalize(candidate)
    err = _validate_format(cand)
    if err:
        return CheckResp(candidate=cand, available=False, reason=err)
    # Collide with any existing maker slug (canonical IDs are sacred)
    if await db.makers.find_one({"slug": cand}, {"_id": 1}):
        return CheckResp(candidate=cand, available=False, reason="Taken.")
    # Collide with another maker's custom_url (excluding the caller)
    if await db.makers.find_one(
        {"custom_url": cand, "slug": {"$ne": slug}}, {"_id": 1},
    ):
        return CheckResp(candidate=cand, available=False, reason="Taken.")
    return CheckResp(candidate=cand, available=True)


@router.post("/maker/custom-url", response_model=CustomUrlState)
async def claim_custom_url(
    payload: ClaimReq, slug: str = Depends(current_maker_slug),
):
    """Idempotent claim — re-POSTing the same value is a no-op. Empty
    string clears the vanity URL."""
    await _require_plus(slug)
    cand = _normalize(payload.custom_url)
    err = _validate_format(cand)
    if err:
        raise HTTPException(400, err)
    if await db.makers.find_one({"slug": cand}, {"_id": 1}):
        raise HTTPException(409, "That name collides with an existing shop ID.")
    if await db.makers.find_one(
        {"custom_url": cand, "slug": {"$ne": slug}}, {"_id": 1},
    ):
        raise HTTPException(409, "Another maker already claimed that URL.")
    ts = now_iso()
    await db.makers.update_one(
        {"slug": slug},
        {"$set": {"custom_url": cand, "custom_url_changed_at": ts}},
    )
    logger.info("plus: maker=%s claimed custom_url=%s", slug, cand)
    return CustomUrlState(custom_url=cand, custom_url_changed_at=ts)


# ---------------- Public resolver ----------------

@router.get("/makers/resolve/{name}")
async def resolve_maker(name: str):
    """Resolve a name (canonical slug OR custom_url) to the maker's
    canonical slug. Public — no auth required. Frontend can call this
    from `/makers/:name` to handle vanity URLs without needing a second
    routing pass.

    Returns {slug, matched_via} where matched_via is "slug" or "custom_url".
    """
    norm = _normalize(name)
    if not norm:
        raise HTTPException(404, "Not found.")
    by_slug = await db.makers.find_one({"slug": norm}, {"_id": 0, "slug": 1})
    if by_slug:
        return {"slug": by_slug["slug"], "matched_via": "slug"}
    by_custom = await db.makers.find_one(
        {"custom_url": norm}, {"_id": 0, "slug": 1, "subscription_status": 1},
    )
    if by_custom:
        # Defense in depth: a vanity URL only resolves while the maker
        # is still on Plus. Otherwise the URL is taken-but-inactive.
        if (by_custom.get("subscription_status") or "free") != "active":
            raise HTTPException(404, "Shop not found.")
        return {"slug": by_custom["slug"], "matched_via": "custom_url"}
    raise HTTPException(404, "Shop not found.")
