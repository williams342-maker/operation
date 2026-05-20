"""Founders Tier — recruiting + lifecycle.

Endpoints:
    GET  /api/founders/slots                  — public slot counter
    GET  /api/founders/list                   — public Founder wall
    POST /api/admin/founders/promote          — admin: promote a maker
    POST /api/admin/founders/expire-due       — admin: trigger expiry sweep
    POST /api/admin/founders/release-stale    — admin: revoke unused 14d slots

Lifecycle:
    1. Maker is approved as a Founder → `tier="founder"`,
       `founder_status="inaugural"` if there are <100 inaugural slots
       remaining, otherwise `"regular"`. `founder_started_at=now`,
       `founder_expires_at=now+365d` (for regular only; inaugural is
       lifetime — null `founder_expires_at`), `founder_grace_until=now+14d`.
    2. The grace cron runs daily: any Founder past grace with zero
       published products gets demoted back to Standard, freeing the slot.
    3. The expiry cron runs daily: any regular Founder past
       `founder_expires_at` auto-rolls to Standard and gets a farewell email.

This module is intentionally narrow — fee resolution lives in `revenue.py`,
which is the single source of truth for what each tier means.
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from maker_auth import current_admin
from core import db, logger, now_iso
from revenue import (
    FOUNDER_GRACE_DAYS,
    FOUNDER_INAUGURAL_CAP,
    FOUNDER_PLATFORM_FEE_BPS,
    FOUNDER_MONTHLY_LISTING_QUOTA,
    FOUNDER_WINDOW_DAYS,
)

router = APIRouter(tags=["founders"])


# ----------------------- Helpers ----------------------- #
async def _count_inaugural() -> int:
    return await db.makers.count_documents(
        {"tier": "founder", "founder_status": "inaugural"}
    )


async def _count_active_founders() -> int:
    """All Founders (inaugural + regular) currently holding a slot,
    including those still in their 14-day grace window."""
    return await db.makers.count_documents({"tier": "founder"})


# ----------------------- Public surfaces ----------------------- #
class SlotResponse(BaseModel):
    inaugural_total: int
    inaugural_taken: int
    inaugural_remaining: int
    founders_total: int  # all-time, including expired (rolled to standard)
    enabled: bool


@router.get("/founders/slots", response_model=SlotResponse)
async def slots():
    """Powers the public 'X / 100 slots remaining' counter on /founders."""
    taken = await _count_inaugural()
    settings = await db.platform_meta.find_one({"key": "site_settings"}) or {}
    enabled = (settings.get("value") or {}).get("beta_signup_enabled", True)
    return SlotResponse(
        inaugural_total=FOUNDER_INAUGURAL_CAP,
        inaugural_taken=taken,
        inaugural_remaining=max(0, FOUNDER_INAUGURAL_CAP - taken),
        founders_total=await _count_active_founders(),
        enabled=enabled,
    )


@router.get("/founders/list")
async def founders_list(limit: int = 60):
    """Public Founder wall — the bragging surface. Only returns active
    founders with at least one published product (so we don't show ghost
    shops that grabbed a slot and never shipped)."""
    cap = max(1, min(int(limit or 60), 200))
    cursor = db.makers.find(
        {"tier": "founder"},
        {
            "_id": 0, "slug": 1, "name": 1, "shop_name": 1, "avatar_url": 1,
            "founder_number": 1, "founder_status": 1, "is_beta_tester": 1,
            "is_veteran_owned": 1, "location": 1,
        },
    ).sort("founder_number", 1).limit(cap)
    return {"founders": await cursor.to_list(cap)}


# ----------------------- Admin promotion ----------------------- #
class PromoteRequest(BaseModel):
    slug: str
    is_beta_tester: bool = False
    force_status: Optional[str] = None  # "inaugural" | "regular" | None


@router.post("/admin/founders/promote")
async def admin_promote(body: PromoteRequest, _: dict = Depends(current_admin)):
    maker = await db.makers.find_one({"slug": body.slug}, {"_id": 0})
    if not maker:
        raise HTTPException(404, "Maker not found")

    # Determine status: explicit override → respected; otherwise auto
    # (inaugural if there are slots left, regular if cap is full).
    if body.force_status in ("inaugural", "regular"):
        status = body.force_status
    else:
        taken = await _count_inaugural()
        status = "inaugural" if taken < FOUNDER_INAUGURAL_CAP else "regular"

    now = datetime.now(timezone.utc)
    starts = now.isoformat()
    grace = (now + timedelta(days=FOUNDER_GRACE_DAYS)).isoformat()
    # Inaugural + beta testers never expire — `founder_expires_at` stays None.
    expires = (
        None if status == "inaugural" or body.is_beta_tester
        else (now + timedelta(days=FOUNDER_WINDOW_DAYS)).isoformat()
    )

    # Assign a stable Founder number — monotonically increasing, never
    # reused even after expiry, so each Founder owns their digit forever.
    counter_doc = await db.platform_meta.find_one_and_update(
        {"key": "founder_counter"},
        {"$inc": {"value": 1}},
        upsert=True,
        return_document=True,
    )
    founder_number = int((counter_doc or {}).get("value") or 1)

    # Re-use any pre-existing founder_number on this maker so re-promoting
    # someone (e.g. demote/re-promote during admin testing) doesn't burn
    # through the monotonic counter and inflate the apparent applicant count.
    final_number = maker.get("founder_number") or founder_number
    update = {
        "tier": "founder",
        "founder_status": status,
        "founder_started_at": starts,
        "founder_expires_at": expires,
        "founder_grace_until": grace,
        "founder_number": final_number,
        "is_beta_tester": bool(body.is_beta_tester) or bool(maker.get("is_beta_tester")),
    }
    await db.makers.update_one({"slug": body.slug}, {"$set": update})

    # Send the welcome email — only when promoting a maker who isn't
    # already a Founder (avoid re-spamming on a re-promote). Idempotent
    # check via tier transition.
    if maker.get("tier") != "founder":
        try:
            from email_service import send_application_decision
            from maker_auth import issue_magic_token
            site = (os.environ.get("FRONTEND_URL") or "https://craftersmarket.org").rstrip("/")
            token = issue_magic_token(maker["email"])
            sign_in_link = f"{site}/maker/verify?token={token}"
            await send_application_decision(
                maker["email"],
                maker.get("name") or maker.get("shop_name") or "there",
                maker.get("shop_name") or "your studio",
                True, "", sign_in_link,
                founder_number=final_number,
                is_inaugural=(status == "inaugural"),
            )
        except Exception as e:
            logger.warning("[founders] welcome email failed for %s: %s", body.slug, e)

    # Surface in the public activity ticker — "Mike Williams just became
    # Founder #003" — same psychology as the homepage 'just bought X' feed.
    try:
        await db.activity_events.insert_one({
            "kind": "founder_joined",
            "text": f"{maker.get('name') or maker.get('shop_name') or 'A new maker'} just became Founder #{final_number:03d}",
            "location": maker.get("location") or "",
            "amount": None,
            "session_id": None,
            "created_at": starts,
            "id": f"founder-{body.slug}-{final_number}",
        })
    except Exception as e:
        logger.warning("[founders] activity event insert failed: %s", e)

    logger.info("[founders] promoted slug=%s status=%s number=%s beta=%s",
                body.slug, status, final_number, update["is_beta_tester"])
    return {"ok": True, **update}


# ----------------------- Lifecycle crons ----------------------- #
async def expire_due_founders() -> dict:
    """Daily sweep — three things at once:
       1. Send month-10 warning emails (~60 days remaining)
       2. Send month-11.5 warning emails (~14 days remaining)
       3. Roll regular Founders past `founder_expires_at` to Standard
          and email them a farewell.
       Inaugural Founders (expires_at is null) are never touched.
    """
    cutoff = datetime.now(timezone.utc)
    cutoff_iso = cutoff.isoformat()

    # Per-stage day windows. Each warning is gated by a `founder_warning_60d_sent`
    # / `founder_warning_14d_sent` flag so the daily cron doesn't re-spam.
    warn_60_low = (cutoff + timedelta(days=58)).isoformat()
    warn_60_high = (cutoff + timedelta(days=62)).isoformat()
    warn_14_low = (cutoff + timedelta(days=12)).isoformat()
    warn_14_high = (cutoff + timedelta(days=16)).isoformat()

    # Lazy import to avoid circular dependency at module load.
    from email_service import send_founder_expiry_warning, send_founder_farewell

    # -- Stage 1: 60-day warning --
    warned_60 = 0
    cursor60 = db.makers.find(
        {
            "tier": "founder", "founder_status": "regular",
            "founder_warning_60d_sent": {"$ne": True},
            "founder_expires_at": {"$gte": warn_60_low, "$lte": warn_60_high},
        },
        {"_id": 0, "slug": 1, "email": 1, "name": 1, "founder_number": 1},
    )
    async for m in cursor60:
        try:
            await send_founder_expiry_warning(m["email"], m.get("name") or "there",
                                               int(m.get("founder_number") or 0), 60)
            await db.makers.update_one({"slug": m["slug"]},
                                        {"$set": {"founder_warning_60d_sent": True}})
            warned_60 += 1
        except Exception as e:
            logger.warning("[founders] 60d warning failed for %s: %s", m["slug"], e)

    # -- Stage 2: 14-day warning --
    warned_14 = 0
    cursor14 = db.makers.find(
        {
            "tier": "founder", "founder_status": "regular",
            "founder_warning_14d_sent": {"$ne": True},
            "founder_expires_at": {"$gte": warn_14_low, "$lte": warn_14_high},
        },
        {"_id": 0, "slug": 1, "email": 1, "name": 1, "founder_number": 1},
    )
    async for m in cursor14:
        try:
            await send_founder_expiry_warning(m["email"], m.get("name") or "there",
                                               int(m.get("founder_number") or 0), 14)
            await db.makers.update_one({"slug": m["slug"]},
                                        {"$set": {"founder_warning_14d_sent": True}})
            warned_14 += 1
        except Exception as e:
            logger.warning("[founders] 14d warning failed for %s: %s", m["slug"], e)

    # -- Stage 3: auto-roll the truly expired --
    cursor = db.makers.find(
        {
            "tier": "founder", "founder_status": "regular",
            "founder_expires_at": {"$ne": None, "$lt": cutoff_iso},
        },
        {"_id": 0, "slug": 1, "email": 1, "name": 1, "founder_number": 1},
    )
    rolled = 0
    async for m in cursor:
        await db.makers.update_one(
            {"slug": m["slug"]},
            {"$set": {"tier": "standard", "founder_rolled_at": cutoff_iso}},
        )
        rolled += 1
        try:
            await send_founder_farewell(m["email"], m.get("name") or "there",
                                         int(m.get("founder_number") or 0))
        except Exception as e:
            logger.warning("[founders] farewell email failed for %s: %s", m["slug"], e)
        logger.info("[founders] auto-rolled to standard: slug=%s number=%s",
                    m["slug"], m.get("founder_number"))

    return {
        "warned_60d": warned_60, "warned_14d": warned_14,
        "rolled": rolled, "as_of": cutoff_iso,
    }


async def release_stale_grace_slots() -> dict:
    """Daily sweep — Founders past their 14-day grace window with zero
    published products get demoted back to Standard, freeing the slot
    so we can hand it to someone who'll actually use it.
    """
    cutoff = now_iso()
    cursor = db.makers.find(
        {
            "tier": "founder",
            "founder_grace_until": {"$ne": None, "$lt": cutoff},
        },
        {"_id": 0, "slug": 1, "founder_number": 1, "founder_status": 1},
    )
    released = 0
    async for m in cursor:
        n_pub = await db.products.count_documents(
            {"maker_slug": m["slug"], "status": "published", "deleted_at": None},
        )
        if n_pub > 0:
            # Honoured the grace — wipe the grace deadline so we don't re-check.
            await db.makers.update_one(
                {"slug": m["slug"]},
                {"$set": {"founder_grace_until": None}},
            )
            continue
        # No published listings — revoke.
        await db.makers.update_one(
            {"slug": m["slug"]},
            {
                "$set": {
                    "tier": "standard",
                    "founder_grace_revoked_at": cutoff,
                    # Clear so the slot frees up; preserve number for audit.
                    "founder_status": None,
                    "founder_expires_at": None,
                    "founder_grace_until": None,
                },
            },
        )
        released += 1
        logger.info("[founders] grace revoked (no listings): slug=%s number=%s",
                    m["slug"], m.get("founder_number"))
    return {"released": released, "as_of": cutoff}


@router.post("/admin/founders/expire-due")
async def admin_expire_due(_: dict = Depends(current_admin)):
    return await expire_due_founders()


@router.post("/admin/founders/release-stale")
async def admin_release_stale(_: dict = Depends(current_admin)):
    return await release_stale_grace_slots()


@router.post("/admin/founders/replenish-credits")
async def admin_replenish_credits(_: dict = Depends(current_admin)):
    """One-click button on the admin dashboard. Bumps every Plus
    subscriber's boost credit to $15 and every veteran-owned maker's to
    $10 immediately, without waiting for the monthly cron on the 1st.

    Idempotent — repeated calls in the same month just keep resetting to
    the same value, since `replenish_*_boost_credits` sets (not
    increments) the field. Safe to wire to a public-on-click admin
    button.
    """
    from revenue import (
        replenish_plus_boost_credits, replenish_veteran_boost_credits,
    )
    plus = await replenish_plus_boost_credits()
    vet = await replenish_veteran_boost_credits()
    logger.info("[founders] admin-triggered credit replenish: plus=%s vet=%s",
                plus, vet)
    return {"plus": plus, "veteran": vet}

