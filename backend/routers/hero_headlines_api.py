"""Public + admin endpoints for the rotating hero headline pool.

Public:
  GET  /api/hero/headlines              → live + pinned variants (Cache-Control: 5m)

Admin (requires admin JWT):
  GET  /api/admin/hero/headlines/list   → full pool (live + archived)
  POST /api/admin/hero/headlines/refresh   → trigger one Gemini draft cycle
  POST /api/admin/hero/headlines/pin/{id}  → pin (clears any other pin)
  POST /api/admin/hero/headlines/unpin     → clear all pins
  POST /api/admin/hero/headlines/archive/{id}
  POST /api/admin/hero/headlines/restore/{id}
  POST /api/admin/hero/headlines/create     → manual variant (admin-authored)
  DELETE /api/admin/hero/headlines/{id}     → hard-delete (seeds + ai)
"""
from __future__ import annotations

import uuid
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field

from core import db
from hero_headlines import (
    MAX_ACCENT,
    MAX_CLOSER,
    MAX_STATEMENT,
    _normalize_variant,
    ensure_seed_pool,
    now_iso,
    refresh_pool,
)
from maker_auth import current_admin

router = APIRouter(tags=["hero-headlines"])


class HeadlineIn(BaseModel):
    statement: str = Field(..., max_length=MAX_STATEMENT + 4)
    accent: str = Field(..., max_length=MAX_ACCENT + 4)
    closer: str = Field(..., max_length=MAX_CLOSER + 4)


# ─────────────────────────────────────────────────────────────────────────────
# Public
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/hero/headlines")
async def list_public_headlines(response: Response):
    """Returns the LIVE pool the hero rotates through. If any headline
    is pinned, the response collapses to just that one — the frontend
    treats a 1-item list as "no rotation, render this only"."""
    pinned = await db.hero_headlines.find_one(
        {"pinned": True, "status": "live"},
        {"_id": 0, "id": 1, "statement": 1, "accent": 1, "closer": 1, "source": 1, "pinned": 1},
    )
    if pinned:
        response.headers["Cache-Control"] = "public, max-age=60"
        return {"items": [pinned], "pinned": True, "count": 1}

    # No pin → return full live pool
    items: list[dict] = []
    async for d in db.hero_headlines.find(
        {"status": "live"},
        {"_id": 0, "id": 1, "statement": 1, "accent": 1, "closer": 1, "source": 1, "pinned": 1},
    ).sort("created_at", -1).limit(20):
        items.append(d)
    response.headers["Cache-Control"] = "public, max-age=300"  # 5 min
    return {"items": items, "pinned": False, "count": len(items)}


# ─────────────────────────────────────────────────────────────────────────────
# Admin
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/admin/hero/headlines/list")
async def admin_list(_: dict = Depends(current_admin)):
    """Full pool incl. archived. Sorted newest first."""
    await ensure_seed_pool()
    items: list[dict] = []
    async for d in db.hero_headlines.find({}, {"_id": 0}).sort("created_at", -1):
        items.append(d)
    return {
        "items": items,
        "counts": {
            "live": sum(1 for i in items if i.get("status") == "live"),
            "archived": sum(1 for i in items if i.get("status") == "archived"),
            "ai": sum(1 for i in items if i.get("source") == "ai"),
            "seed": sum(1 for i in items if i.get("source") == "seed"),
            "manual": sum(1 for i in items if i.get("source") == "manual"),
            "pinned": sum(1 for i in items if i.get("pinned")),
        },
    }


@router.post("/admin/hero/headlines/refresh")
async def admin_refresh(_: dict = Depends(current_admin)):
    """Trigger one Gemini draft cycle on-demand. Same logic as the cron."""
    stats = await refresh_pool()
    return {"ok": True, **stats}


@router.post("/admin/hero/headlines/pin/{headline_id}")
async def admin_pin(headline_id: str, _: dict = Depends(current_admin)):
    """Pin a headline — clears any other pin so only one is active at a time."""
    target = await db.hero_headlines.find_one({"id": headline_id, "status": "live"}, {"_id": 0, "id": 1})
    if not target:
        raise HTTPException(404, "Headline not found or archived")
    await db.hero_headlines.update_many({"pinned": True}, {"$set": {"pinned": False}})
    await db.hero_headlines.update_one({"id": headline_id}, {"$set": {"pinned": True}})
    return {"ok": True, "pinned_id": headline_id}


@router.post("/admin/hero/headlines/unpin")
async def admin_unpin(_: dict = Depends(current_admin)):
    r = await db.hero_headlines.update_many({"pinned": True}, {"$set": {"pinned": False}})
    return {"ok": True, "cleared": r.modified_count}


@router.post("/admin/hero/headlines/archive/{headline_id}")
async def admin_archive(headline_id: str, _: dict = Depends(current_admin)):
    r = await db.hero_headlines.update_one(
        {"id": headline_id},
        {"$set": {"status": "archived", "pinned": False}},
    )
    if r.matched_count == 0:
        raise HTTPException(404, "Headline not found")
    return {"ok": True}


@router.post("/admin/hero/headlines/restore/{headline_id}")
async def admin_restore(headline_id: str, _: dict = Depends(current_admin)):
    r = await db.hero_headlines.update_one({"id": headline_id}, {"$set": {"status": "live"}})
    if r.matched_count == 0:
        raise HTTPException(404, "Headline not found")
    return {"ok": True}


@router.post("/admin/hero/headlines/create")
async def admin_create(body: HeadlineIn, _: dict = Depends(current_admin)):
    """Admin-authored manual variant — bypasses Gemini. Runs through the
    same validator so length/format rules can't be broken."""
    norm = _normalize_variant(body.dict())
    if not norm:
        raise HTTPException(
            400,
            f"Validation failed — statement ≤{MAX_STATEMENT}, accent ≤{MAX_ACCENT} (single word), closer ≤{MAX_CLOSER}.",
        )
    # Dedupe
    existing = await db.hero_headlines.find_one(
        {"statement": norm["statement"], "accent": norm["accent"], "closer": norm["closer"]},
        {"_id": 0, "id": 1},
    )
    if existing:
        raise HTTPException(409, "An identical headline already exists in the pool")
    doc = {
        "id": str(uuid.uuid4()),
        **norm,
        "source": "manual",
        "status": "live",
        "pinned": False,
        "ai_model": None,
        "created_at": now_iso(),
    }
    await db.hero_headlines.insert_one(doc)
    return {"ok": True, "id": doc["id"]}


@router.delete("/admin/hero/headlines/{headline_id}")
async def admin_delete(headline_id: str, _: dict = Depends(current_admin)):
    r = await db.hero_headlines.delete_one({"id": headline_id})
    if r.deleted_count == 0:
        raise HTTPException(404, "Headline not found")
    return {"ok": True}
