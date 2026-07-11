"""iter450 — Store Sections (Phase 1).

Maker-defined storefront departments ("Store Sections" maker-facing,
"Browse Sections" buyer-facing). Completely separate from Marketplace
Categories. db.store_sections:
  {id, maker_slug, name, slug, previous_slugs[], description, image,
   position, visible, created_at, updated_at}
Products reference sections via `section_slugs: [str]` — listings without
the field keep working untouched (backwards compatible).
"""
import re
import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from core import db, now_iso
from maker_auth import current_maker_slug

router = APIRouter()

# Reserved path segments under /makers/{slug}/… — a section can never take
# these slugs, protecting current and future storefront sub-routes.
RESERVED_SLUGS = {
    "products", "product", "reviews", "about", "contact", "settings", "shop",
    "followers", "following", "orders", "collections", "collection",
    "section", "sections", "edit", "admin", "api", "blog", "journal", "new",
    "all", "search", "state",
}
MAX_SECTIONS = 50


def _slugify(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")
    return s[:60] or "section"


async def _unique_slug(maker_slug: str, name: str, exclude_id: str | None = None) -> str:
    base = _slugify(name)
    candidate = f"{base}-1" if base in RESERVED_SLUGS else base
    n = 1
    while True:
        clash = await db.store_sections.find_one({
            "maker_slug": maker_slug, "id": {"$ne": exclude_id},
            "$or": [{"slug": candidate}, {"previous_slugs": candidate}]},
            {"_id": 1})
        if not clash and candidate not in RESERVED_SLUGS:
            return candidate
        n += 1
        candidate = f"{base}-{n}"


async def _counts_for(maker_slug: str) -> dict:
    """Published-listing count per section slug — single aggregation, no N+1."""
    out: dict[str, int] = {}
    async for g in db.products.aggregate([
            {"$match": {"maker_slug": maker_slug, "status": "published",
                        "section_slugs.0": {"$exists": True}}},
            {"$unwind": "$section_slugs"},
            {"$group": {"_id": "$section_slugs", "n": {"$sum": 1}}}]):
        out[g["_id"]] = g["n"]
    return out


async def _own_section(sid: str, maker_slug: str) -> dict:
    sec = await db.store_sections.find_one({"id": sid}, {"_id": 0})
    if not sec:
        raise HTTPException(404, "Section not found")
    if sec["maker_slug"] != maker_slug:
        raise HTTPException(403, "You can only manage your own store sections.")
    return sec


class SectionCreate(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    description: Optional[str] = Field(default=None, max_length=500)
    image: Optional[str] = None


class SectionUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=60)
    description: Optional[str] = Field(default=None, max_length=500)
    image: Optional[str] = None
    visible: Optional[bool] = None
    regenerate_slug: bool = False


class ReorderBody(BaseModel):
    order: List[str]


class MembershipBody(BaseModel):
    product_slugs: List[str]


class AssignBody(BaseModel):
    product_slug: str
    section_slugs: List[str]


# ── Maker management ─────────────────────────────────────────────────────────

@router.get("/maker/sections")
async def maker_sections(slug: str = Depends(current_maker_slug)):
    rows = await db.store_sections.find(
        {"maker_slug": slug}, {"_id": 0}).sort("position", 1).to_list(MAX_SECTIONS)
    counts = await _counts_for(slug)
    for r in rows:
        r["count"] = counts.get(r["slug"], 0)
    total = await db.products.count_documents({"maker_slug": slug, "status": "published"})
    return {"sections": rows, "all_count": total}


@router.post("/maker/sections", status_code=201)
async def create_section(body: SectionCreate, slug: str = Depends(current_maker_slug)):
    n = await db.store_sections.count_documents({"maker_slug": slug})
    if n >= MAX_SECTIONS:
        raise HTTPException(400, f"Maximum {MAX_SECTIONS} sections per store.")
    if await db.store_sections.find_one(
            {"maker_slug": slug, "name": body.name.strip()}, {"_id": 1}):
        raise HTTPException(400, "You already have a section with that name.")
    sec = {
        "id": uuid.uuid4().hex,
        "maker_slug": slug,
        "name": body.name.strip(),
        "slug": await _unique_slug(slug, body.name),
        "previous_slugs": [],
        "description": (body.description or "").strip(),
        "image": body.image or None,
        "position": n,
        "visible": True,
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.store_sections.insert_one(dict(sec))
    sec["count"] = 0
    return sec


@router.patch("/maker/sections/{sid}")
async def update_section(sid: str, body: SectionUpdate,
                         slug: str = Depends(current_maker_slug)):
    sec = await _own_section(sid, slug)
    upd: dict = {"updated_at": now_iso()}
    if body.name is not None and body.name.strip() != sec["name"]:
        clash = await db.store_sections.find_one(
            {"maker_slug": slug, "name": body.name.strip(), "id": {"$ne": sid}}, {"_id": 1})
        if clash:
            raise HTTPException(400, "You already have a section with that name.")
        upd["name"] = body.name.strip()
    if body.description is not None:
        upd["description"] = body.description.strip()
    if body.image is not None:
        upd["image"] = body.image or None
    if body.visible is not None:
        upd["visible"] = body.visible
    if body.regenerate_slug:
        # Explicit opt-in only — renames NEVER change the slug so URLs stay
        # stable. The old slug is preserved for 301-style redirects.
        new_slug = await _unique_slug(slug, upd.get("name", sec["name"]), exclude_id=sid)
        if new_slug != sec["slug"]:
            upd["slug"] = new_slug
            upd["previous_slugs"] = list(dict.fromkeys(
                (sec.get("previous_slugs") or []) + [sec["slug"]]))
            await db.products.update_many(
                {"maker_slug": slug, "section_slugs": sec["slug"]},
                {"$set": {"section_slugs.$": new_slug}})
    await db.store_sections.update_one({"id": sid}, {"$set": upd})
    out = await db.store_sections.find_one({"id": sid}, {"_id": 0})
    out["count"] = (await _counts_for(slug)).get(out["slug"], 0)
    return out


@router.post("/maker/sections/reorder")
async def reorder_sections(body: ReorderBody, slug: str = Depends(current_maker_slug)):
    own = {s["id"] async for s in db.store_sections.find(
        {"maker_slug": slug}, {"_id": 0, "id": 1})}
    if set(body.order) != own:
        raise HTTPException(400, "Order must contain exactly your section ids.")
    for pos, sid in enumerate(body.order):
        await db.store_sections.update_one(
            {"id": sid, "maker_slug": slug},
            {"$set": {"position": pos, "updated_at": now_iso()}})
    return {"ok": True}


@router.delete("/maker/sections/{sid}")
async def delete_section(sid: str, slug: str = Depends(current_maker_slug)):
    sec = await _own_section(sid, slug)
    await db.store_sections.delete_one({"id": sid})
    # Detach from listings — products themselves are untouched.
    await db.products.update_many(
        {"maker_slug": slug},
        {"$pull": {"section_slugs": sec["slug"]}})
    return {"ok": True, "deleted": sec["slug"]}


@router.put("/maker/sections/{sid}/products")
async def set_section_members(sid: str, body: MembershipBody,
                              slug: str = Depends(current_maker_slug)):
    """Bulk membership for one section: listed products get it, all the
    maker's other products lose it."""
    sec = await _own_section(sid, slug)
    own_slugs = {p["slug"] async for p in db.products.find(
        {"maker_slug": slug}, {"_id": 0, "slug": 1})}
    wanted = [s for s in body.product_slugs if s in own_slugs]
    await db.products.update_many(
        {"maker_slug": slug, "slug": {"$in": wanted}},
        {"$addToSet": {"section_slugs": sec["slug"]}})
    await db.products.update_many(
        {"maker_slug": slug, "slug": {"$nin": wanted}},
        {"$pull": {"section_slugs": sec["slug"]}})
    return {"ok": True, "count": len(wanted)}


@router.post("/maker/sections/assign")
async def assign_product_sections(body: AssignBody,
                                  slug: str = Depends(current_maker_slug)):
    """Set the full section list for one product (listing editor)."""
    prod = await db.products.find_one({"slug": body.product_slug}, {"_id": 0, "maker_slug": 1})
    if not prod:
        raise HTTPException(404, "Product not found")
    if prod["maker_slug"] != slug:
        raise HTTPException(403, "You can only edit your own listings.")
    valid = {s["slug"] async for s in db.store_sections.find(
        {"maker_slug": slug}, {"_id": 0, "slug": 1})}
    clean = [s for s in dict.fromkeys(body.section_slugs) if s in valid]
    await db.products.update_one(
        {"slug": body.product_slug}, {"$set": {"section_slugs": clean}})
    return {"ok": True, "section_slugs": clean}


# ── Public storefront ────────────────────────────────────────────────────────

@router.get("/makers/{maker_slug}/sections")
async def public_sections(maker_slug: str):
    """Visible sections + counts for the storefront nav. Hidden sections and
    the maker's ordering are respected; old slugs map to their replacement
    so the SPA can redirect."""
    rows = await db.store_sections.find(
        {"maker_slug": maker_slug}, {"_id": 0}).sort("position", 1).to_list(MAX_SECTIONS)
    counts = await _counts_for(maker_slug)
    redirects = {}
    visible = []
    for r in rows:
        for old in r.get("previous_slugs") or []:
            redirects[old] = r["slug"]
        if r.get("visible", True):
            visible.append({
                "id": r["id"], "name": r["name"], "slug": r["slug"],
                "description": r.get("description") or "",
                "image": r.get("image"),
                "count": counts.get(r["slug"], 0),
            })
    all_count = await db.products.count_documents(
        {"maker_slug": maker_slug, "status": "published"})
    return {"sections": visible, "all_count": all_count, "redirects": redirects}
