"""iter246 — One-time admin merge endpoints for william accounts.

After preview verified the merge worked, we expose the same logic as a
strictly admin-gated POST endpoint so the user can run it on production
without needing shell access or platform support. Idempotent — safe to
hit multiple times; subsequent calls just confirm "already merged".

Endpoints:
  • GET  /admin/merge-williams/preview  — dry-run, returns planned changes
  • POST /admin/merge-williams/commit   — applies the merge, returns final state

Once committed in production, you can leave these endpoints alive (they
become no-ops) or remove this router. Recommend leaving them — useful
reference for future account merges.
"""
from __future__ import annotations
import logging

from fastapi import APIRouter, Depends, HTTPException

from core import db
from maker_auth import current_admin

logger = logging.getLogger("crafters.merge_williams")
router = APIRouter()

OLD_EMAIL = "williams1cnc@gmail.com"
NEW_EMAIL = "williams342@gmail.com"
MAKER_SLUG = "williams-cnc"
HISTORICAL_COLS = [
    ("maker_applications", "email"),
    ("login_attempts", "email"),
    ("audit_log", "email"),
]


async def _gather_plan() -> dict:
    maker_row = await db.makers.find_one(
        {"slug": MAKER_SLUG},
        {"_id": 0, "slug": 1, "email": 1, "tier": 1, "name": 1},
    )
    cu_old = await db.community_users.find_one(
        {"email": OLD_EMAIL},
        {"_id": 0, "user_id": 1, "name": 1, "created_at": 1},
    )
    historical = {}
    for col, field in HISTORICAL_COLS:
        historical[f"{col}.{field}"] = await db[col].count_documents({field: OLD_EMAIL})
    return {
        "old_email": OLD_EMAIL,
        "new_email": NEW_EMAIL,
        "maker_slug": MAKER_SLUG,
        "maker_row": maker_row,
        "community_user_to_delete": cu_old,
        "historical_rows_to_rewrite": historical,
        "already_merged": bool(maker_row and maker_row.get("email") == NEW_EMAIL and not cu_old),
    }


@router.get("/admin/merge-williams/preview")
async def merge_preview(_: dict = Depends(current_admin)):
    plan = await _gather_plan()
    plan["mode"] = "preview"
    return plan


@router.post("/admin/merge-williams/commit")
async def merge_commit(_: dict = Depends(current_admin)):
    before = await _gather_plan()
    if before["already_merged"]:
        return {"ok": True, "mode": "commit", "already_merged": True, "result": before}

    # 1. Re-bind the maker shop's contact email
    if before["maker_row"] and before["maker_row"].get("email") != NEW_EMAIL:
        await db.makers.update_one(
            {"slug": MAKER_SLUG},
            {"$set": {"email": NEW_EMAIL}},
        )
        logger.info("[merge_williams] rebound maker %s email → %s", MAKER_SLUG, NEW_EMAIL)

    # 2. Delete the zombie community_user (only if 0 activity tied to its user_id)
    if before["community_user_to_delete"]:
        uid = before["community_user_to_delete"].get("user_id")
        if uid:
            activity = 0
            for col, field in [
                ("community_messages", "user_id"),
                ("forum_posts", "author_id"),
                ("showcase_posts", "user_id"),
                ("design_files", "owner_id"),
                ("studio_kits", "owner_id"),
            ]:
                try:
                    activity += await db[col].count_documents({field: uid})
                except Exception:
                    pass
            if activity > 0:
                raise HTTPException(
                    409,
                    f"Refusing to delete community_user {uid} — {activity} downstream "
                    "activity rows found. Manual review required.",
                )
        await db.community_users.delete_one({"email": OLD_EMAIL})
        logger.info("[merge_williams] deleted zombie community_user %s", uid)

    # 3. Rewrite historical email rows
    rewritten = {}
    for col, field in HISTORICAL_COLS:
        r = await db[col].update_many(
            {field: OLD_EMAIL},
            {"$set": {field: NEW_EMAIL}},
        )
        rewritten[f"{col}.{field}"] = r.modified_count

    after = await _gather_plan()
    return {
        "ok": True,
        "mode": "commit",
        "before": before,
        "rewritten_historical_counts": rewritten,
        "after": after,
    }
