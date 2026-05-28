"""Social auto-post API routes (iter271).

Two router surfaces:
  • `/api/maker/social-auto-post/status`     — maker-side eligibility + queue snapshot
  • `/api/admin/social-auto-post/queue`      — admin queue list + mark-published/skipped

Pricing logic lives in `social_auto_post_service.eligibility_for`. This
module is pure plumbing — auth, query, and shape.
"""
from __future__ import annotations
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from pydantic import BaseModel, Field

from core import db, logger, now_iso
from maker_auth import current_admin, current_maker_slug
from social_auto_post_service import eligibility_for, queue_summary
from social_publisher import (
    credentials_status as _cred_status,
    publish_row_by_id,
)


router = APIRouter()


# ───────────────────────────── maker side ─────────────────────────────
@router.get("/maker/social-auto-post/status")
async def maker_social_status(slug: str = Depends(current_maker_slug)):
    """Returns the maker's current auto-post eligibility + per-shop
    queue summary so the dashboard can render the tier badge + pending
    counts in one round-trip."""
    maker = await db.makers.find_one({"slug": slug}, {"_id": 0})
    if not maker:
        raise HTTPException(404, "Maker not found.")
    elig = eligibility_for(maker)
    summary = await queue_summary(maker_slug=slug)
    pending_rows = await (
        db.social_auto_post_queue.find(
            {"maker_slug": slug, "status": "pending"},
            {"_id": 0, "id": 1, "product_slug": 1, "product_title": 1,
             "image_url": 1, "queued_at": 1},
        ).sort("queued_at", -1).limit(10).to_list(10)
    )
    return {
        "eligibility": elig,
        "queue_summary": summary,
        "recent_pending": pending_rows,
    }


# ───────────────────────────── admin side ─────────────────────────────
admin_router = APIRouter()


@admin_router.get("/admin/social-auto-post/queue")
async def admin_queue(
    _admin: str = Depends(current_admin),
    status: str = Query("pending", regex="^(pending|published|skipped|all)$"),
    limit: int = Query(50, ge=1, le=200),
):
    """Returns the auto-post queue, newest first, filtered by status.

    Status default = `pending` so the admin lands on the actionable view.
    `all` shows everything for audit purposes."""
    q: dict = {}
    if status != "all":
        q["status"] = status
    rows = await (
        db.social_auto_post_queue.find(q, {"_id": 0})
        .sort("queued_at", -1).limit(limit).to_list(limit)
    )
    summary = await queue_summary()
    return {"rows": rows, "summary": summary}


@admin_router.post("/admin/social-auto-post/{row_id}/mark-published")
async def admin_mark_published(
    row_id: str,
    _admin: str = Depends(current_admin),
):
    """Ops manually posted to social — flag this queue row as done.

    Once a future Buffer/Meta API integration ships, this endpoint stays
    — it's still the source-of-truth audit hook even when the actual
    publish is automated."""
    r = await db.social_auto_post_queue.update_one(
        {"id": row_id, "status": "pending"},
        {"$set": {"status": "published",
                  "published_at": now_iso(),
                  "published_by": "admin"}},
    )
    if r.matched_count == 0:
        raise HTTPException(404, "Queue row not found or not pending.")
    logger.info("[social_auto_post] row=%s marked published", row_id)
    return {"ok": True}


@admin_router.post("/admin/social-auto-post/{row_id}/skip")
async def admin_skip(
    row_id: str,
    reason: str = Query("", max_length=200),
    _admin: str = Depends(current_admin),
):
    """Don't post this listing to social — flagged + reason recorded.

    Common reasons: low-quality image, off-brand, already posted manually."""
    r = await db.social_auto_post_queue.update_one(
        {"id": row_id, "status": "pending"},
        {"$set": {"status": "skipped",
                  "skipped_reason": (reason or "no reason given")[:200],
                  "published_at": now_iso(),  # closure timestamp
                  "published_by": "admin"}},
    )
    if r.matched_count == 0:
        raise HTTPException(404, "Queue row not found or not pending.")
    logger.info("[social_auto_post] row=%s skipped reason=%s", row_id, reason)
    return {"ok": True}


@admin_router.get("/admin/social-auto-post/eligibility-counts")
async def admin_eligibility_counts(_admin: str = Depends(current_admin)):
    """Returns counts of makers by their auto-post eligibility tier.
    Useful for the admin Settings tab dashboard widget."""
    cursor = db.makers.find(
        {"deleted_at": {"$in": [None, ""]}},
        {"_id": 0, "tier": 1, "founder_status": 1,
         "founder_expires_at": 1, "subscription_status": 1},
    )
    counts = {"inaugural_founder": 0, "founder": 0, "plus": 0, "none": 0}
    async for m in cursor:
        e = eligibility_for(m)
        counts[e["tier"]] = counts.get(e["tier"], 0) + 1
    return {"counts": counts, "total": sum(counts.values())}


# ─────────────── Auto-publish to Meta/Pinterest (iter273) ───────────────
@admin_router.get("/admin/social-auto-post/credentials-status")
async def admin_credentials_status(_admin: str = Depends(current_admin)):
    """Reports which of {instagram, facebook, pinterest} currently have
    valid env credentials. The admin UI uses this to enable/disable the
    'Publish now' button — no UI ambiguity, no failed clicks when creds
    are missing. Booleans only; we never expose the tokens themselves."""
    return {"channels": _cred_status()}


class _CaptionsBody(BaseModel):
    """Optional per-channel caption overrides. Empty strings clear the
    override (publisher falls back to the platform-tuned template)."""
    instagram: str | None = Field(default=None, max_length=4000)
    facebook:  str | None = Field(default=None, max_length=4000)
    pinterest: str | None = Field(default=None, max_length=2000)


@admin_router.patch("/admin/social-auto-post/{row_id}/captions")
async def admin_save_captions(
    row_id: str,
    body: _CaptionsBody,
    _admin: str = Depends(current_admin),
):
    """Persist the admin's edited per-channel captions onto the queue
    row so that 'Publish now' uses them. Without this the captions live
    only in the clipboard."""
    captions = {k: (v or "").strip()
                for k, v in body.model_dump().items() if v}
    r = await db.social_auto_post_queue.update_one(
        {"id": row_id},
        {"$set": {"captions": captions, "captions_updated_at": now_iso()}},
    )
    if r.matched_count == 0:
        raise HTTPException(404, "Queue row not found.")
    logger.info("[social_auto_post] row=%s captions saved: %s",
                row_id, list(captions))
    return {"ok": True, "saved_channels": list(captions)}


@admin_router.post("/admin/social-auto-post/{row_id}/publish-now")
async def admin_publish_now(
    row_id: str,
    _admin: str = Depends(current_admin),
):
    """Fire the actual external API calls to publish this queue row to
    Instagram / Facebook Page / Pinterest. Returns a structured per-
    channel result so the UI can show success vs. skipped vs. error.

    No external creds = soft-skip for that channel; one failing platform
    never blocks the others. See `social_publisher.publish_row_by_id`."""
    res = await publish_row_by_id(row_id, actor="admin")
    if res.get("reason") == "not_found":
        raise HTTPException(404, "Queue row not found.")
    if res.get("reason") == "not_pending":
        raise HTTPException(
            409,
            f"Row already {res.get('current_status')}. "
            "Only pending or previously-failed rows can be published.",
        )
    return res
