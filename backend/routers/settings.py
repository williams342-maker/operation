"""Site-level admin switches + beta feedback intake.

A single Mongo document `site_settings/{ _id: 'global' }` stores every
admin-toggleable flag. Public `GET /api/settings` returns the subset the
frontend needs. Admin endpoints read/write the full document.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Optional, List
import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field

from core import db, logger, now_iso
from email_service import send_beta_feedback
from maker_auth import current_admin

router = APIRouter()

# ---------------- Defaults ----------------
DEFAULT_SETTINGS: dict = {
    "_id": "global",
    "maintenance_mode": False,
    "maintenance_message": "We're making the workshop better. We'll be back shortly.",
    "maintenance_scheduled_on": None,   # ISO datetime · cron flips ON at this time
    "maintenance_scheduled_off": None,  # ISO datetime · cron flips OFF at this time
    "beta_mode": False,
    "beta_message": "You're using Crafters Market Beta. Found a bug or have an idea?",
    "allow_maker_applications": True,
    "applications_closed_message": "We're at capacity for new makers right now. Applications will reopen soon.",
    "live_chat_enabled": True,
    "auto_clear_idle_rooms": False,
    "idle_clear_minutes": 60,
    "ai_moderator_enabled": False,
}


async def _get_or_create_settings() -> dict:
    """Return the singleton settings doc, creating it lazily on first read."""
    doc = await db.site_settings.find_one({"_id": "global"})
    if not doc:
        await db.site_settings.insert_one(DEFAULT_SETTINGS.copy())
        return DEFAULT_SETTINGS.copy()
    # Backfill any new keys added in later versions.
    merged = {**DEFAULT_SETTINGS, **doc}
    if set(merged.keys()) != set(doc.keys()):
        await db.site_settings.update_one(
            {"_id": "global"}, {"$set": merged}, upsert=True,
        )
    return merged


async def get_setting(key: str, default=None):
    """Lightweight helper used by other routers/jobs to check a flag."""
    s = await _get_or_create_settings()
    return s.get(key, default)


# ---------------- Public ----------------
@router.get("/settings")
async def public_settings():
    """Public-facing flags only — no admin-only fields."""
    s = await _get_or_create_settings()
    return {
        "maintenance_mode": s["maintenance_mode"],
        "maintenance_message": s["maintenance_message"],
        "beta_mode": s["beta_mode"],
        "beta_message": s["beta_message"],
        "allow_maker_applications": s["allow_maker_applications"],
        "applications_closed_message": s["applications_closed_message"],
        "live_chat_enabled": s["live_chat_enabled"],
    }


# ---------------- Beta feedback ----------------
class BetaFeedbackIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    message: str = Field(min_length=4, max_length=4000)
    page: Optional[str] = None  # which URL the user was on


@router.post("/feedback")
async def submit_beta_feedback(payload: BetaFeedbackIn, bg: BackgroundTasks):
    """Persist + email beta feedback. Open to the public — only available
    when beta_mode is on (the frontend hides the form otherwise)."""
    s = await _get_or_create_settings()
    if not s["beta_mode"]:
        raise HTTPException(403, "Beta feedback is not currently accepted.")
    doc = {
        "id": str(uuid.uuid4()),
        "name": payload.name.strip(),
        "email": payload.email,
        "message": payload.message.strip(),
        "page": (payload.page or "").strip()[:300],
        "created_at": now_iso(),
        "resolved": False,
    }
    await db.beta_feedback.insert_one(doc.copy())
    bg.add_task(
        send_beta_feedback,
        name=doc["name"],
        email=doc["email"],
        message=doc["message"],
        page=doc["page"],
    )
    logger.info("[beta] feedback received from %s on %s", doc["email"], doc["page"] or "?")
    return {"received": True, "id": doc["id"]}


# ---------------- Admin ----------------
@router.get("/admin/settings")
async def admin_get_settings(_: dict = Depends(current_admin)):
    s = await _get_or_create_settings()
    s.pop("_id", None)
    return s


class SettingsPatch(BaseModel):
    """Every field optional — PATCH semantics."""
    maintenance_mode: Optional[bool] = None
    maintenance_message: Optional[str] = None
    maintenance_scheduled_on: Optional[str] = None   # ISO datetime, "" to clear
    maintenance_scheduled_off: Optional[str] = None  # ISO datetime, "" to clear
    beta_mode: Optional[bool] = None
    beta_message: Optional[str] = None
    allow_maker_applications: Optional[bool] = None
    applications_closed_message: Optional[str] = None
    live_chat_enabled: Optional[bool] = None
    auto_clear_idle_rooms: Optional[bool] = None
    idle_clear_minutes: Optional[int] = Field(default=None, ge=5, le=1440)
    ai_moderator_enabled: Optional[bool] = None


@router.patch("/admin/settings")
async def admin_patch_settings(
    patch: SettingsPatch, claims: dict = Depends(current_admin),
):
    raw = patch.model_dump(exclude_unset=True)
    # Allow `null` / "" to *clear* the scheduled timestamps; otherwise keep
    # the standard "skip None values" semantics.
    schedulable = {"maintenance_scheduled_on", "maintenance_scheduled_off"}
    updates = {}
    for k, v in raw.items():
        if k in schedulable:
            updates[k] = v if v else None
        elif v is not None:
            updates[k] = v
    if not updates:
        raise HTTPException(400, "No fields to update.")
    updates["updated_at"] = now_iso()
    updates["updated_by"] = claims["email"]
    await db.site_settings.update_one(
        {"_id": "global"}, {"$set": updates}, upsert=True,
    )
    logger.info("[settings] %s updated %s", claims["email"], list(updates.keys()))
    s = await _get_or_create_settings()
    s.pop("_id", None)
    return s


@router.post("/admin/chat/clear-all")
async def admin_clear_all_chat(claims: dict = Depends(current_admin)):
    """Hard-purge every chat message. Audit-logged. Forum threads untouched."""
    r = await db.chat_messages.delete_many({})
    logger.warning("[settings] %s HARD-CLEARED chat — %d messages purged",
                   claims["email"], r.deleted_count)
    await db.activity_events.insert_one({
        "id": str(uuid.uuid4()),
        "kind": "admin",
        "text": f"All chat messages cleared by {claims['email']}",
        "created_at": now_iso(),
    })
    return {"deleted": r.deleted_count}


@router.post("/admin/chat/clear-idle")
async def admin_clear_idle_chat(
    minutes: Optional[int] = None, _: dict = Depends(current_admin),
):
    """Manual trigger for the idle-chat cleanup job. Same code path as the
    scheduler — useful for spot-checking before relying on the cron."""
    from chat_cleanup import clear_idle_rooms
    return await clear_idle_rooms(idle_minutes=minutes)


@router.get("/admin/feedback")
async def admin_list_feedback(
    limit: int = 100, resolved: Optional[bool] = None,
    _: dict = Depends(current_admin),
):
    flt: dict = {}
    if resolved is not None:
        flt["resolved"] = resolved
    rows: List[dict] = await db.beta_feedback.find(
        flt, {"_id": 0},
    ).sort("created_at", -1).to_list(limit)
    return {"items": rows, "count": len(rows)}


@router.post("/admin/feedback/{feedback_id}/resolve")
async def admin_resolve_feedback(
    feedback_id: str, claims: dict = Depends(current_admin),
):
    r = await db.beta_feedback.update_one(
        {"id": feedback_id},
        {"$set": {"resolved": True, "resolved_by": claims["email"], "resolved_at": now_iso()}},
    )
    if r.matched_count == 0:
        raise HTTPException(404, "Feedback not found.")
    return {"resolved": True}


@router.get("/admin/ai-mod-log")
async def admin_ai_mod_log(limit: int = 100, _: dict = Depends(current_admin)):
    """Recent AI moderation events for the admin Audit tab."""
    from ai_moderator import list_recent
    return {"items": await list_recent(limit), "limit": limit}


# ============================================================
#  Email Status (admin diagnostic surface)
# ============================================================
@router.get("/admin/email-status")
async def admin_email_status(_: dict = Depends(current_admin)):
    """Summary stats + last-N events for the admin Email tab."""
    from datetime import datetime, timezone
    today_iso = datetime.now(timezone.utc).date().isoformat()
    today_filter = {"created_at": {"$gte": today_iso}}
    sent_today = await db.email_events.count_documents({**today_filter, "status": "sent"})
    failed_today = await db.email_events.count_documents({**today_filter, "status": "failed"})
    skipped_today = await db.email_events.count_documents({**today_filter, "status": "skipped"})
    last_sent = await db.email_events.find_one(
        {"status": "sent"}, sort=[("created_at", -1)], projection={"_id": 0},
    )
    last_failed = await db.email_events.find_one(
        {"status": "failed"}, sort=[("created_at", -1)], projection={"_id": 0},
    )
    recent = await db.email_events.find(
        {}, {"_id": 0},
    ).sort("created_at", -1).to_list(50)
    return {
        "provider": os.environ.get("EMAIL_PROVIDER", "postmark"),
        "sender": os.environ.get("SENDER_EMAIL", ""),
        "ops_email": os.environ.get("OPS_EMAIL", ""),
        "today": {"sent": sent_today, "failed": failed_today, "skipped": skipped_today},
        "last_sent": last_sent,
        "last_failed": last_failed,
        "recent": recent,
    }


class TestEmailIn(BaseModel):
    to: Optional[str] = None  # default OPS_EMAIL


@router.post("/admin/email-test")
async def admin_email_test(payload: TestEmailIn, claims: dict = Depends(current_admin)):
    """Fire a real diagnostic email through the configured provider. Used to
    verify domain/token/quota status from the admin UI without leaving the dashboard."""
    from email_service import _send
    to = (payload.to or os.environ.get("OPS_EMAIL") or claims.get("email") or "").strip()
    if not to:
        raise HTTPException(400, "No recipient configured (OPS_EMAIL missing).")
    html = (
        "<div style='font-family:JetBrains Mono,monospace;color:#e5e5e5;padding:24px;background:#0a0a0a'>"
        f"<p style='color:#ff4500;font-size:11px;letter-spacing:0.3em;text-transform:uppercase'>◆ Diagnostic ping</p>"
        f"<p>This email was triggered by <b>{claims.get('email')}</b> from the admin Email Status tab.</p>"
        f"<p>If you see this, your provider is delivering — and the daily quota has room.</p>"
        "</div>"
    )
    result = await _send(to, "Crafters Market · Email diagnostic", html)
    if result is None:
        # _send already persisted a 'failed' event; surface the latest one to the caller.
        last = await db.email_events.find_one(
            {"to": to, "status": "failed"}, sort=[("created_at", -1)], projection={"_id": 0},
        )
        return {"sent": False, "to": to, "last_error": last}
    return {"sent": True, "to": to, "result": result}
