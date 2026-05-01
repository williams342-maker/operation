"""Coming-Soon waitlist — captures email signups against pending product
categories on /custom-order (Neon & Light, Furniture, etc.) so we can
notify them when the category launches.

Mirrors `restock_waitlist` patterns: idempotent per (email, category),
no-auth public POST, admin-only listing/export.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, EmailStr

from core import db, logger, now_iso
from maker_auth import current_admin

router = APIRouter()

EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
# Only categories we've actually teased on the public site. Anything else
# is rejected at the boundary so we don't accumulate junk waitlist rows.
ALLOWED_CATEGORIES = {"Neon & Light", "Furniture"}


class _SignupBody(BaseModel):
    email: EmailStr
    category: str
    name: Optional[str] = None


@router.post("/coming-soon/waitlist")
async def join_coming_soon_waitlist(body: _SignupBody):
    """Public endpoint — auth-free. Idempotent on (email, category)."""
    cat = (body.category or "").strip()
    if cat not in ALLOWED_CATEGORIES:
        return {"ok": False, "error": "unknown_category"}
    email = str(body.email).strip().lower()
    name = (body.name or "").strip()[:120] or None
    existing = await db.coming_soon_waitlist.find_one(
        {"email": email, "category": cat}, {"_id": 0},
    )
    if existing:
        return {"ok": True, "already": True}
    await db.coming_soon_waitlist.insert_one({
        "email": email,
        "category": cat,
        "name": name,
        "joined_at": now_iso(),
        "notified_at": None,
    })
    logger.info("[coming_soon_waitlist] new signup category=%s email=%s", cat, email)
    return {"ok": True, "already": False}


@router.get("/admin/coming-soon/waitlist")
async def admin_list_coming_soon(_: dict = Depends(current_admin)):
    """Admin-only — group counts by category + sample of recent signups."""
    rows = await db.coming_soon_waitlist.find({}, {"_id": 0}).sort("joined_at", -1).to_list(2000)
    by_cat: dict[str, int] = {}
    for r in rows:
        by_cat[r["category"]] = by_cat.get(r["category"], 0) + 1
    return {
        "total": len(rows),
        "by_category": by_cat,
        "recent": rows[:50],
    }
