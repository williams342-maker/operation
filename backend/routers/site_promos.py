"""iter346 — Admin-managed on-site promo placements.

Lets ops/admins create scheduled banners that render on the public
site (e.g. homepage hero strip, /shop top, cart top). Different from
PromoteThemes — themes subsidize maker boosts on third-party platforms,
these are *internal* CMS banners shown directly on craftersmarket.org.

Data model: `site_promos` collection (one doc per banner)
    {
      "_id": "<promo_id>",
      "title": "Mother's Day Sale",
      "body": "20% off all wall art through Sunday.",
      "cta_label": "Shop the sale",          # optional
      "cta_url": "/shop?category=Wall+Art",  # optional, relative or absolute
      "image_url": "...",                    # optional
      "placement": "home_hero" | "shop_top" | "cart_top" | "product_top" | "global_top",
      "status": "scheduled" | "active" | "paused" | "ended",
      "start_date": "2026-06-10",            # YYYY-MM-DD, inclusive
      "end_date":   "2026-06-17",
      "priority": 0,                         # higher = wins when multiple promos share a slot
      "dismissible": True,                    # user can close it (stored in localStorage)
      "tone": "default" | "celebration" | "warning",  # affects styling
      "created_by": "<email>",
      "created_at": ISO, "updated_at": ISO,
    }
"""
from __future__ import annotations
import logging
import secrets
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, HttpUrl

from core import db, now_iso
from maker_auth import current_admin

router = APIRouter()
log = logging.getLogger("crafters.site_promos")

VALID_PLACEMENTS = {"home_hero", "shop_top", "cart_top", "product_top", "global_top"}
VALID_TONES = {"default", "celebration", "warning"}
VALID_STATUSES = {"scheduled", "active", "paused", "ended"}


class PromoCreate(BaseModel):
    title: str = Field(..., min_length=2, max_length=120)
    body: str = Field("", max_length=400)
    cta_label: str = Field("", max_length=40)
    cta_url: str = Field("", max_length=400)
    image_url: str = Field("", max_length=500)
    placement: str
    start_date: str  # YYYY-MM-DD
    end_date: str
    priority: int = Field(default=0, ge=0, le=100)
    dismissible: bool = True
    tone: str = "default"


class PromoPatch(BaseModel):
    title: Optional[str] = Field(None, min_length=2, max_length=120)
    body: Optional[str] = Field(None, max_length=400)
    cta_label: Optional[str] = Field(None, max_length=40)
    cta_url: Optional[str] = Field(None, max_length=400)
    image_url: Optional[str] = Field(None, max_length=500)
    placement: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    priority: Optional[int] = Field(None, ge=0, le=100)
    dismissible: Optional[bool] = None
    tone: Optional[str] = None
    status: Optional[str] = None


def _validate_dates(start: str, end: str) -> None:
    try:
        s = datetime.strptime(start, "%Y-%m-%d").date()
        e = datetime.strptime(end, "%Y-%m-%d").date()
    except ValueError as ex:
        raise HTTPException(400, f"start_date / end_date must be YYYY-MM-DD: {ex}")
    if e < s:
        raise HTTPException(400, "end_date must be on or after start_date")


def _validate_enums(placement: Optional[str], tone: Optional[str],
                    status: Optional[str]) -> None:
    if placement is not None and placement not in VALID_PLACEMENTS:
        raise HTTPException(400, f"placement must be one of {sorted(VALID_PLACEMENTS)}")
    if tone is not None and tone not in VALID_TONES:
        raise HTTPException(400, f"tone must be one of {sorted(VALID_TONES)}")
    if status is not None and status not in VALID_STATUSES:
        raise HTTPException(400, f"status must be one of {sorted(VALID_STATUSES)}")


@router.post("/admin/site-promos")
async def create_promo(body: PromoCreate, admin: dict = Depends(current_admin)):
    """Create a new promo banner. Starts in 'scheduled' state — the public
    GET endpoint won't surface it until status is flipped to 'active' AND
    today is within the start/end window."""
    _validate_dates(body.start_date, body.end_date)
    _validate_enums(body.placement, body.tone, None)
    promo_id = "promo_" + secrets.token_urlsafe(10)
    doc = {
        "_id": promo_id,
        "promo_id": promo_id,
        "title": body.title.strip(),
        "body": body.body.strip(),
        "cta_label": body.cta_label.strip(),
        "cta_url": body.cta_url.strip(),
        "image_url": body.image_url.strip(),
        "placement": body.placement,
        "status": "scheduled",
        "start_date": body.start_date,
        "end_date": body.end_date,
        "priority": int(body.priority),
        "dismissible": bool(body.dismissible),
        "tone": body.tone,
        "created_by": (admin or {}).get("email") or "admin",
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.site_promos.insert_one(doc)
    doc.pop("_id", None)
    return {"promo": doc}


@router.get("/admin/site-promos")
async def list_promos_admin(_: dict = Depends(current_admin)):
    out: list[dict] = []
    async for d in db.site_promos.find({}).sort([("priority", -1), ("created_at", -1)]):
        d.pop("_id", None)
        out.append(d)
    return {"promos": out}


@router.patch("/admin/site-promos/{promo_id}")
async def update_promo(promo_id: str, body: PromoPatch,
                       _: dict = Depends(current_admin)):
    patch = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if not patch:
        raise HTTPException(400, "No fields to update.")
    if "start_date" in patch or "end_date" in patch:
        # If only one is being updated, fetch the other from the existing doc.
        existing = await db.site_promos.find_one({"_id": promo_id}, {"start_date": 1, "end_date": 1})
        if not existing:
            raise HTTPException(404, "Promo not found")
        _validate_dates(
            patch.get("start_date", existing["start_date"]),
            patch.get("end_date", existing["end_date"]),
        )
    _validate_enums(patch.get("placement"), patch.get("tone"), patch.get("status"))
    patch["updated_at"] = now_iso()
    r = await db.site_promos.update_one({"_id": promo_id}, {"$set": patch})
    if r.matched_count == 0:
        raise HTTPException(404, "Promo not found")
    doc = await db.site_promos.find_one({"_id": promo_id})
    if doc:
        doc.pop("_id", None)
    return {"promo": doc}


@router.delete("/admin/site-promos/{promo_id}")
async def delete_promo(promo_id: str, _: dict = Depends(current_admin)):
    r = await db.site_promos.delete_one({"_id": promo_id})
    if r.deleted_count == 0:
        raise HTTPException(404, "Promo not found")
    return {"deleted": True}


# ── Public endpoint ────────────────────────────────────────────────────
@router.get("/site-promos")
async def get_active_promo(placement: str = Query(..., description="One of: home_hero, shop_top, cart_top, product_top, global_top")):
    """Returns the single highest-priority active promo for a placement,
    or null. Public — no auth. Filtered by current date window."""
    if placement not in VALID_PLACEMENTS:
        raise HTTPException(400, f"placement must be one of {sorted(VALID_PLACEMENTS)}")
    today = datetime.utcnow().strftime("%Y-%m-%d")
    doc = await db.site_promos.find_one(
        {
            "placement": placement,
            "status": "active",
            "start_date": {"$lte": today},
            "end_date": {"$gte": today},
        },
        sort=[("priority", -1), ("created_at", -1)],
    )
    if not doc:
        return {"promo": None}
    doc.pop("_id", None)
    # Strip internal/admin-only fields from the public payload.
    for k in ("created_by",):
        doc.pop(k, None)
    return {"promo": doc}
