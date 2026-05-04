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

from fastapi import APIRouter, BackgroundTasks, Depends
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
async def join_coming_soon_waitlist(body: _SignupBody, bg: BackgroundTasks):
    """Public endpoint — auth-free. Idempotent on (email, category).
    Fires a one-shot confirmation email on NEW signups (suppressed on
    re-submissions so users aren't spammed)."""
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
    # iter103 — confirm in writing so the user knows their email saved.
    from email_service import send_coming_soon_confirmation
    bg.add_task(send_coming_soon_confirmation, email=email, name=name or "", category=cat)
    logger.info("[coming_soon_waitlist] new signup category=%s email=%s", cat, email)
    return {"ok": True, "already": False}


@router.get("/admin/coming-soon/waitlist")
async def admin_list_coming_soon(_: dict = Depends(current_admin)):
    """Admin-only — group counts by category + sample of recent signups.
    iter112: also surfaces pending vs. notified counts per category so the
    admin can see at a glance how many people will be emailed by a launch."""
    rows = await db.coming_soon_waitlist.find({}, {"_id": 0}).sort("joined_at", -1).to_list(2000)
    by_cat: dict[str, dict] = {}
    for r in rows:
        cat = r["category"]
        d = by_cat.setdefault(cat, {"total": 0, "pending": 0, "notified": 0})
        d["total"] += 1
        if r.get("notified_at"):
            d["notified"] += 1
        else:
            d["pending"] += 1
    return {
        "total": len(rows),
        "by_category": by_cat,
        "categories": sorted(ALLOWED_CATEGORIES),
        "recent": rows[:50],
    }


# ============================================================
# Launch announcement — admin clicks "It's live" per category
# ============================================================
class _LaunchBody(BaseModel):
    category: str
    dry_run: bool = False
    shop_path: Optional[str] = None  # e.g. "/shop?category=Neon" — defaults to "/shop"


@router.post("/admin/coming-soon/launch")
async def admin_launch_coming_soon(body: _LaunchBody, bg: BackgroundTasks,
                                    _: dict = Depends(current_admin)):
    """Notify every PENDING (unnotified) waitlist subscriber for `category`
    that it's live. Idempotent: rows with `notified_at` already set are
    skipped, so re-clicks don't double-email. Dry-run returns the count of
    eligible recipients without sending anything — useful for the admin
    to confirm before pulling the trigger."""
    cat = (body.category or "").strip()
    if cat not in ALLOWED_CATEGORIES:
        return {"ok": False, "error": "unknown_category"}

    pending = await db.coming_soon_waitlist.find(
        {"category": cat, "notified_at": None},
        {"_id": 0, "email": 1, "name": 1, "joined_at": 1},
    ).to_list(10000)

    if body.dry_run:
        return {
            "ok": True, "dry_run": True, "category": cat,
            "would_notify": len(pending),
            "sample": [r["email"] for r in pending[:5]],
        }

    if not pending:
        return {"ok": True, "category": cat, "notified": 0, "reason": "no_pending"}

    # Stamp notified_at FIRST so a crash mid-send doesn't double-email
    # anyone on a retry. The email send itself is best-effort in
    # background tasks; if a single send fails the row is still marked
    # (operator can manually re-trigger via a future "resend failed" feature
    # if needed). This is the same idempotency pattern iter101/102 use.
    notified_iso = now_iso()
    emails = [r["email"] for r in pending]
    await db.coming_soon_waitlist.update_many(
        {"category": cat, "email": {"$in": emails}, "notified_at": None},
        {"$set": {"notified_at": notified_iso}},
    )

    from email_service import send_coming_soon_launch_announcement
    shop_path = (body.shop_path or "/shop").strip() or "/shop"
    for row in pending:
        bg.add_task(
            send_coming_soon_launch_announcement,
            email=row["email"], name=row.get("name") or "",
            category=cat, shop_path=shop_path,
        )
    logger.info("[coming_soon_launch] category=%s notified=%d", cat, len(pending))
    return {"ok": True, "category": cat, "notified": len(pending),
            "notified_at": notified_iso}
