"""Merchant feed controls (iter365).

Two small API surfaces around the Google Merchant sanitizer:

ADMIN — category rules engine
  GET /api/admin/merchant/category-rules
      → { rules: [{category, mode}], categories: [all product categories] }
  PUT /api/admin/merchant/category-rules  { rules: [{category, mode}] }
      Replaces the full rule set. mode ∈ sync | rewrite | exclude.

MAKER — live preview for the listing editor
  POST /api/maker/merchant/preview
      { title, description?, category?, merchant_title?,
        merchant_auto_optimize?, merchant_exclude? }
      → { include, mode, title, hits }
      Pure function of the inputs + current category rules; never writes.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from core import db
from maker_auth import current_admin, current_maker_slug
from services.merchant_sanitizer import load_category_rules, resolve_merchant_listing

router = APIRouter()

VALID_MODES = ("sync", "rewrite", "exclude")


class CategoryRule(BaseModel):
    category: str = Field(min_length=1, max_length=120)
    mode: str


class CategoryRulesPayload(BaseModel):
    rules: List[CategoryRule] = Field(default=[], max_length=200)


@router.get("/admin/merchant/category-rules")
async def get_category_rules(_admin=Depends(current_admin)) -> dict:
    docs = await db.merchant_category_rules.find(
        {}, {"_id": 0, "category": 1, "mode": 1, "updated_at": 1},
    ).sort("category", 1).to_list(200)
    categories = sorted(
        c for c in await db.products.distinct(
            "category", {"status": "published", "deleted_at": {"$in": [None, ""]}},
        ) if c
    )
    return {"rules": docs, "categories": categories}


@router.put("/admin/merchant/category-rules")
async def put_category_rules(
    payload: CategoryRulesPayload, _admin=Depends(current_admin),
) -> dict:
    seen: set[str] = set()
    now = datetime.now(timezone.utc).isoformat()
    docs = []
    for r in payload.rules:
        if r.mode not in VALID_MODES:
            raise HTTPException(400, f"Invalid mode '{r.mode}' — use sync, rewrite, or exclude.")
        key = r.category.strip()
        if not key or key.lower() in seen:
            continue
        seen.add(key.lower())
        docs.append({"category": key, "mode": r.mode, "updated_at": now})
    # Full replace — the admin UI always submits the complete set.
    await db.merchant_category_rules.delete_many({})
    if docs:
        await db.merchant_category_rules.insert_many(docs)
    return {"saved": len(docs)}


class MerchantPreviewRequest(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    description: Optional[str] = Field(default="", max_length=6000)
    category: Optional[str] = Field(default="", max_length=120)
    merchant_title: Optional[str] = Field(default=None, max_length=150)
    merchant_auto_optimize: Optional[bool] = None
    merchant_exclude: bool = False
    # iter366 — attribute preview inputs
    materials: Optional[str] = Field(default="", max_length=300)
    gpc_path: Optional[str] = Field(default="", max_length=300)
    technique: Optional[str] = Field(default="", max_length=60)


@router.get("/maker/merchant/feed-quality")
async def maker_feed_quality(slug: str = Depends(current_maker_slug)) -> dict:
    """iter366c — The maker's own Google-feed attribute quality.

    Same computation the admin Feed Health card runs, scoped to this
    maker's published listings. Powers the Listings-tab nudge banner so
    sellers fix their own rows (add materials → derived color/material)
    without admin intervention.
    """
    from routers.pinterest_feed import _resolve_gpc
    from services.merchant_attributes import merchant_attributes

    prods = await db.products.find(
        {"maker_slug": slug, "status": "published", "deleted_at": {"$in": [None, ""]}},
        {"_id": 0, "slug": 1, "title": 1, "description": 1, "category": 1,
         "technique": 1, "materials": 1, "gpc_path": 1},
    ).limit(500).to_list(500)

    examples = []
    flagged = 0
    for p in prods:
        res = merchant_attributes(p, _resolve_gpc(p))
        if not res["warnings"]:
            continue
        flagged += 1
        if len(examples) < 10:
            examples.append({
                "slug": p.get("slug"),
                "title": (p.get("title") or "")[:70],
                "warnings": res["warnings"],
            })
    return {"rows_total": len(prods), "rows_with_warnings": flagged, "examples": examples}


@router.post("/maker/merchant/preview")
async def preview_merchant_listing(
    req: MerchantPreviewRequest, _slug: str = Depends(current_maker_slug),
) -> dict:
    rules = await load_category_rules(db)
    pseudo = {
        "title": req.title,
        "description": req.description or "",
        "category": req.category or "",
        "merchant_title": req.merchant_title,
        "merchant_auto_optimize": req.merchant_auto_optimize,
        "merchant_exclude": req.merchant_exclude,
        "materials": req.materials or "",
        "gpc_path": req.gpc_path or "",
        "technique": req.technique or "",
    }
    res = resolve_merchant_listing(pseudo, rules)

    # iter366 — category-aware attribute preview: exactly what the live
    # feed row will carry (✓ sent / ✗ suppressed) + internal warnings.
    from routers.pinterest_feed import _resolve_gpc
    from services.merchant_attributes import merchant_attributes
    gpc = _resolve_gpc(pseudo)
    attr_res = merchant_attributes(pseudo, gpc)

    return {
        "include": res["include"],
        "mode": res["mode"],
        "title": res["title"],
        "hits": res["hits"],
        "category_rule": rules.get((req.category or "").strip().lower()),
        "gpc": gpc,
        "attribute_profile": attr_res["profile"],
        "attributes_sent": attr_res["attributes"],
        "attributes_suppressed": attr_res["suppressed"],
        "attribute_warnings": attr_res["warnings"],
    }
