"""Per-shop discount codes for makers.

Phase 2 scope: maker-facing CRUD + listing/expiration. Codes are stored in
db.discount_codes and tied to maker_slug. Checkout-side application of
codes is a separate ~2h task — surfaced in the UI as "Codes you create here
will apply to your shop's checkout once that ships next." Avoids a
half-finished checkout integration.
"""
from __future__ import annotations

import secrets
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from core import db, logger, now_iso
from maker_auth import current_maker_slug

router = APIRouter()

CodeKind = Literal["percent", "fixed", "free_shipping"]


class DiscountCodeIn(BaseModel):
    code: str = Field(min_length=3, max_length=32)
    kind: CodeKind
    amount: float = Field(ge=0, le=100)            # % for percent, $ for fixed, ignored for free_shipping
    min_order_total: float = Field(default=0, ge=0)
    max_uses: int | None = Field(default=None, ge=1)
    expires_at: str | None = None                   # ISO datetime, optional
    notes: str | None = Field(default=None, max_length=200)


def _normalise_code(c: str) -> str:
    return "".join(ch.upper() for ch in c if ch.isalnum() or ch in "-_")


@router.get("/maker/discount-codes")
async def list_codes(slug: str = Depends(current_maker_slug)):
    rows = await db.discount_codes.find(
        {"maker_slug": slug}, {"_id": 0},
    ).sort("created_at", -1).limit(200).to_list(200)
    return {"codes": rows}


@router.post("/maker/discount-codes")
async def create_code(payload: DiscountCodeIn, slug: str = Depends(current_maker_slug)):
    code = _normalise_code(payload.code)
    if len(code) < 3:
        raise HTTPException(400, "Code must be at least 3 alphanumeric characters.")
    # Per-shop uniqueness — same code can exist across different shops
    existing = await db.discount_codes.find_one({"maker_slug": slug, "code": code})
    if existing:
        raise HTTPException(409, f"You already have a code '{code}'.")
    if payload.kind == "percent" and payload.amount > 100:
        raise HTTPException(400, "Percent discount cannot exceed 100%.")
    doc = {
        "id": secrets.token_urlsafe(8),
        "maker_slug": slug,
        "code": code,
        "kind": payload.kind,
        "amount": float(payload.amount),
        "min_order_total": float(payload.min_order_total),
        "max_uses": payload.max_uses,
        "uses_count": 0,
        "expires_at": payload.expires_at,
        "notes": (payload.notes or "")[:200],
        "active": True,
        "created_at": now_iso(),
    }
    await db.discount_codes.insert_one(doc)
    doc.pop("_id", None)
    logger.info("[discount] created · maker=%s · code=%s", slug, code)
    return doc


@router.patch("/maker/discount-codes/{code_id}")
async def toggle_code(
    code_id: str,
    payload: dict,
    slug: str = Depends(current_maker_slug),
):
    """Currently supports flipping `active`. Other fields stay immutable —
    if a maker wants different terms they delete + re-create."""
    if "active" not in payload:
        raise HTTPException(400, "Only the 'active' field can be patched.")
    r = await db.discount_codes.update_one(
        {"id": code_id, "maker_slug": slug},
        {"$set": {"active": bool(payload["active"]), "updated_at": now_iso()}},
    )
    if not r.matched_count:
        raise HTTPException(404, "Code not found.")
    return {"updated": True, "active": bool(payload["active"])}


@router.delete("/maker/discount-codes/{code_id}")
async def delete_code(code_id: str, slug: str = Depends(current_maker_slug)):
    r = await db.discount_codes.delete_one({"id": code_id, "maker_slug": slug})
    if not r.deleted_count:
        raise HTTPException(404, "Code not found.")
    return {"deleted": True}
