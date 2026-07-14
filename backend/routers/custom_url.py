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
from maker_auth import current_maker_slug, current_admin

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
    # "Reserved categories / techniques (avoid clobbering future taxonomy URLs)
    "cnc", "laser", "wood", "metal", "ceramic", "leather", "resin",
    "category", "categories", "tag", "tags", "technique", "techniques",
    "founder", "founders", "veteran", "veterans", "plus", "free",
    "trial", "pro", "premium",
    # iter460 — live route segments under /makers/* and misc system words
    "state", "resolve", "digital-downloads", "journal", "clips",
    "custom-order", "grow", "updates", "purchases", "kits", "studio",
    "apply", "featured", "new",
    # Single-letter / two-letter (too noisy)
    "a", "b", "c", "x", "y", "z",
})


SLUG_RE = re.compile(r"^(?!-)[a-z0-9-]{3,30}(?<!-)$")


class CustomUrlState(BaseModel):
    custom_url: Optional[str] = None
    custom_url_changed_at: Optional[str] = None
    previous_slugs: list = []
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
    # min_length 0 — empty string clears the vanity URL.
    custom_url: str = Field(default="", max_length=30)


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


async def _get_maker(slug: str) -> dict:
    """iter460 — Vanity URLs are now available to EVERY maker (previously
    a Plus/Founder perk). Short branded addresses help all sellers market
    their store; old auto-slugs and retired vanity names permanently
    redirect via `previous_slugs`, so SEO and existing links survive."""
    m = await db.makers.find_one({"slug": slug}, {"_id": 0})
    if not m:
        raise HTTPException(404, "Maker not found.")
    return m


async def _collision(cand: str, own_slug: str) -> Optional[str]:
    """Namespace check across canonical slugs, live vanity names, and
    retired vanity names (previous_slugs stay reserved so their
    redirects keep working)."""
    if cand != own_slug and await db.makers.find_one({"slug": cand}, {"_id": 1}):
        return "That name collides with an existing shop ID."
    if await db.makers.find_one({"custom_url": cand, "slug": {"$ne": own_slug}}, {"_id": 1}):
        return "Another maker already claimed that URL."
    if await db.makers.find_one({"previous_slugs": cand, "slug": {"$ne": own_slug}}, {"_id": 1}):
        return "That URL was recently used by another shop and is reserved."
    return None


async def _apply_change(m: dict, cand: Optional[str], actor: str) -> dict:
    """Set (or clear when cand is None) a maker's vanity URL, keeping the
    old value in `previous_slugs` so it 301-redirects forever."""
    slug, old = m["slug"], m.get("custom_url")
    ts = now_iso()
    await db.makers.update_one(
        {"slug": slug},
        {"$set": {"custom_url": cand, "custom_url_changed_at": ts},
         **({"$pull": {"previous_slugs": cand}} if cand else {})})
    if old and old != cand:
        await db.makers.update_one(
            {"slug": slug}, {"$addToSet": {"previous_slugs": old}})
    logger.info("vanity-url: maker=%s %s → %s (by %s)", slug, old, cand, actor)
    fresh = await db.makers.find_one(
        {"slug": slug},
        {"_id": 0, "slug": 1, "custom_url": 1, "previous_slugs": 1,
         "custom_url_changed_at": 1})
    return fresh


@router.get("/maker/custom-url", response_model=CustomUrlState)
async def get_custom_url(slug: str = Depends(current_maker_slug)):
    m = await _get_maker(slug)
    return CustomUrlState(
        custom_url=m.get("custom_url"),
        custom_url_changed_at=m.get("custom_url_changed_at"),
        previous_slugs=m.get("previous_slugs") or [],
    )


@router.get("/maker/custom-url/check/{candidate}", response_model=CheckResp)
async def check_custom_url(
    candidate: str, slug: str = Depends(current_maker_slug),
):
    """Live availability check — instant feedback while the maker types."""
    await _get_maker(slug)
    cand = _normalize(candidate)
    err = _validate_format(cand)
    if err:
        return CheckResp(candidate=cand, available=False, reason=err)
    err = await _collision(cand, slug)
    if err:
        return CheckResp(candidate=cand, available=False,
                         reason="That URL is already taken.")
    return CheckResp(candidate=cand, available=True)


@router.post("/maker/custom-url", response_model=CustomUrlState)
async def claim_custom_url(
    payload: ClaimReq, slug: str = Depends(current_maker_slug),
):
    """Idempotent claim — re-POSTing the same value is a no-op. Empty
    string clears the vanity URL (old one keeps redirecting)."""
    m = await _get_maker(slug)
    cand = _normalize(payload.custom_url)
    if not cand:
        fresh = await _apply_change(m, None, f"maker:{slug}")
        return CustomUrlState(custom_url=None,
                              custom_url_changed_at=fresh.get("custom_url_changed_at"),
                              previous_slugs=fresh.get("previous_slugs") or [])
    err = _validate_format(cand)
    if err:
        raise HTTPException(400, err)
    err = await _collision(cand, slug)
    if err:
        raise HTTPException(409, "That URL is already taken.")
    fresh = await _apply_change(m, cand, f"maker:{slug}")
    return CustomUrlState(custom_url=cand,
                          custom_url_changed_at=fresh.get("custom_url_changed_at"),
                          previous_slugs=fresh.get("previous_slugs") or [])


# ---------------- Admin controls (iter460) ----------------

class AdminVanityReq(BaseModel):
    custom_url: Optional[str] = None  # None / "" = reset


def _admin_view(m: dict) -> dict:
    return {"slug": m["slug"], "custom_url": m.get("custom_url"),
            "previous_slugs": m.get("previous_slugs") or [],
            "custom_url_changed_at": m.get("custom_url_changed_at")}


@router.get("/admin/makers/{maker_slug}/custom-url")
async def admin_get_vanity(maker_slug: str, _: dict = Depends(current_admin)):
    return _admin_view(await _get_maker(maker_slug))


@router.post("/admin/makers/{maker_slug}/custom-url")
async def admin_set_vanity(maker_slug: str, payload: AdminVanityReq,
                           admin: dict = Depends(current_admin)):
    m = await _get_maker(maker_slug)
    cand = _normalize(payload.custom_url or "")
    if not cand:
        fresh = await _apply_change(m, None, f"admin:{admin.get('email')}")
        return _admin_view({**m, **fresh})
    err = _validate_format(cand)
    if err:
        raise HTTPException(400, err)
    err = await _collision(cand, m["slug"])
    if err:
        raise HTTPException(409, err)
    fresh = await _apply_change(m, cand, f"admin:{admin.get('email')}")
    return _admin_view({**m, **fresh})


# ---------------- Public resolver ----------------

@router.get("/makers/resolve/{name}")
async def resolve_maker(name: str):
    """Resolve a name (vanity custom_url, canonical slug, or retired
    vanity) to the maker. Public — no auth, no tier gate (iter460:
    vanity URLs are a feature for every maker).

    Returns {slug, public_slug, matched_via}. When matched_via is
    "previous" the caller should permanent-redirect to public_slug.
    """
    norm = _normalize(name)
    if not norm:
        raise HTTPException(404, "Not found.")
    proj = {"_id": 0, "slug": 1, "custom_url": 1}
    by_custom = await db.makers.find_one({"custom_url": norm}, proj)
    if by_custom:
        return {"slug": by_custom["slug"], "public_slug": norm,
                "matched_via": "custom_url"}
    by_slug = await db.makers.find_one({"slug": norm}, proj)
    if by_slug:
        return {"slug": norm,
                "public_slug": by_slug.get("custom_url") or norm,
                "matched_via": "slug"}
    by_prev = await db.makers.find_one({"previous_slugs": norm}, proj)
    if by_prev:
        return {"slug": by_prev["slug"],
                "public_slug": by_prev.get("custom_url") or by_prev["slug"],
                "matched_via": "previous"}
    raise HTTPException(404, "Shop not found.")
