"""iter428 — Beta App Testing program.

Endpoints
─────────
GET  /api/beta-program/config       → { enabled, android_url, ios_url, headline?, updated_at }
POST /api/beta-program/signup       → { name, email, device: android|ios|both, state? }
GET  /api/beta-program/stats        → { android_count, ios_count, latest_joined[],
                                          bugs_fixed, features_requested, features_released }
GET  /api/admin/beta-program/config → admin config incl. draft URLs
PATCH /api/admin/beta-program/config → { enabled, android_url, ios_url, headline?, bugs_fixed?, features_requested?, features_released? }
GET  /api/admin/beta-program/signups → list of all signups (admin only, PII allowed here)

Data lives in two collections:
  • `settings.beta_program` — singleton config document
  • `beta_signups` — one row per user who signs up
"""
from __future__ import annotations
import uuid
from datetime import datetime, timezone
from typing import Literal, Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field

from core import db, now_iso
from maker_auth import current_admin

router = APIRouter(prefix="", tags=["beta-program"])

_DEFAULT_CONFIG = {
    "enabled": True,
    "android_url": "https://play.google.com/apps/testing/org.craftersmarket.app",
    "ios_url":     "https://testflight.apple.com/join/PLACEHOLDER",
    "headline":    "Help Build the Crafters Market App",
    "bugs_fixed":       0,
    "features_requested": 0,
    "features_released":  0,
    "updated_at": now_iso(),
}


async def _get_config() -> dict:
    doc = await db.settings.find_one({"_id": "beta_program"}, {"_id": 0})
    if not doc:
        # Seed on first read; safe idempotent upsert.
        await db.settings.update_one(
            {"_id": "beta_program"},
            {"$setOnInsert": {**_DEFAULT_CONFIG}}, upsert=True,
        )
        doc = {**_DEFAULT_CONFIG}
    return doc


# ─────────────────────────── PUBLIC ─────────────────────────────────────
@router.get("/beta-program/config")
async def public_config():
    c = await _get_config()
    return {
        "enabled":     bool(c.get("enabled")),
        "android_url": c.get("android_url"),
        "ios_url":     c.get("ios_url"),
        "headline":    c.get("headline") or _DEFAULT_CONFIG["headline"],
    }


class SignupIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    email: EmailStr
    device: Literal["android", "ios", "both"]
    state: Optional[str] = Field(None, max_length=40)


@router.post("/beta-program/signup")
async def signup(payload: SignupIn):
    # Dedup on (email, device) so double-tap doesn't inflate the counter.
    email = payload.email.lower()
    existing = await db.beta_signups.find_one(
        {"email": email, "device": payload.device}, {"_id": 0, "id": 1},
    )
    if existing:
        return {"ok": True, "id": existing["id"], "duplicate": True}
    row = {
        "id": uuid.uuid4().hex,
        "name": payload.name.strip(),
        "email": email,
        "device": payload.device,
        "state": (payload.state or "").strip() or None,
        "created_at": now_iso(),
    }
    await db.beta_signups.insert_one(row)
    return {"ok": True, "id": row["id"], "duplicate": False}


@router.get("/beta-program/stats")
async def stats():
    c = await _get_config()
    android_count = await db.beta_signups.count_documents({"device": {"$in": ["android", "both"]}})
    ios_count     = await db.beta_signups.count_documents({"device": {"$in": ["ios", "both"]}})
    # Latest 4 — expose ONLY first name + state (privacy-safe live-stats copy)
    latest_docs = await db.beta_signups.find(
        {}, {"_id": 0, "name": 1, "state": 1, "device": 1, "created_at": 1},
    ).sort("created_at", -1).limit(4).to_list(4)
    latest: list[dict] = []
    for d in latest_docs:
        raw = d.get("name") or ""
        first = raw.split(" ", 1)[0][:20] or "Someone"
        latest.append({
            "first_name": first,
            "state": d.get("state") or "—",
            "device": d.get("device"),
        })
    return {
        "android_count": android_count,
        "ios_count":     ios_count,
        "latest_joined": latest,
        "bugs_fixed":         int(c.get("bugs_fixed") or 0),
        "features_requested": int(c.get("features_requested") or 0),
        "features_released":  int(c.get("features_released") or 0),
    }


# ─────────────────────────── ADMIN ──────────────────────────────────────
class ConfigPatch(BaseModel):
    enabled:     Optional[bool] = None
    android_url: Optional[str]  = Field(None, max_length=500)
    ios_url:     Optional[str]  = Field(None, max_length=500)
    headline:    Optional[str]  = Field(None, max_length=140)
    bugs_fixed:         Optional[int] = None
    features_requested: Optional[int] = None
    features_released:  Optional[int] = None


@router.get("/admin/beta-program/config")
async def admin_config(_: dict = Depends(current_admin)):
    return await _get_config()


@router.patch("/admin/beta-program/config")
async def admin_config_patch(patch: ConfigPatch, _: dict = Depends(current_admin)):
    updates = {k: v for k, v in patch.model_dump(exclude_unset=True).items() if v is not None}
    if not updates:
        raise HTTPException(400, "No fields to update.")
    updates["updated_at"] = now_iso()
    # $setOnInsert must not overlap $set keys — otherwise Mongo errors.
    insert_only = {k: v for k, v in _DEFAULT_CONFIG.items() if k not in updates}
    op = {"$set": updates}
    if insert_only:
        op["$setOnInsert"] = insert_only
    await db.settings.update_one({"_id": "beta_program"}, op, upsert=True)
    return await _get_config()


@router.get("/admin/beta-program/signups")
async def admin_signups(limit: int = 500, _: dict = Depends(current_admin)):
    limit = max(1, min(2000, int(limit or 500)))
    rows = await db.beta_signups.find({}, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    return {"signups": rows, "total": len(rows)}
