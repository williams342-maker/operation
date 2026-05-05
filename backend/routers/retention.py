"""Dormant buyer retention.

Workflow:
  1. Admin opens the Retention tab → "Dormant Buyers" panel.
  2. Sets a threshold (default 60 days since last paid order).
  3. Clicks "Scan" — backend returns the cohort.
  4. Picks discount % + expiry days and clicks "Send re-engagement code".
  5. Backend: per buyer
       a. Generates a one-time discount code (`marketing_codes` collection).
       b. Tags them in Kit.com as `dormant-buyer-reengaged` (best effort).
       c. Sends an email via the standard Mailtrap → Postmark → Resend chain.

No scheduler — this is admin-triggered. A nightly cron can reuse the same
endpoints later by calling them from a small worker if/when desired.
"""
from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field

from core import db, logger, now_iso
from email_service import send_dormant_buyer_reengage
from kit_service import _ensure_tag, _enabled as _kit_enabled, _kit, subscribe
from maker_auth import current_admin

router = APIRouter()

DEFAULT_DAYS = 60
MAX_DAYS = 365
MAX_BATCH = 200


def _gen_code() -> str:
    return f"WELCOME{secrets.token_hex(3).upper()}"


@router.get("/admin/retention/dormant")
async def admin_list_dormant(
    days: int = DEFAULT_DAYS,
    limit: int = 200,
    _: dict = Depends(current_admin),
):
    """Buyers who placed at least one paid order in the past 365 days but
    haven't bought anything in `days`. Returns one row per email with the
    last_order_at + total_orders so admins can decide who to re-engage.

    Source-of-truth is `payment_transactions` (`payment_status='paid'`,
    `customer_email`, `amount`) — the legacy `orders` collection is empty
    in production."""
    days = max(7, min(days, MAX_DAYS))
    cutoff_iso = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    bottom_iso = (datetime.now(timezone.utc) - timedelta(days=365)).isoformat()
    pipeline = [
        {"$match": {
            "payment_status": "paid",
            "customer_email": {"$nin": [None, ""]},
            "created_at": {"$gte": bottom_iso},
        }},
        {"$group": {
            "_id": {"$toLower": "$customer_email"},
            "last_order_at": {"$max": "$created_at"},
            "total_orders": {"$sum": 1},
            "lifetime_value": {"$sum": "$amount"},
        }},
        {"$match": {"last_order_at": {"$lte": cutoff_iso}}},
        {"$sort": {"last_order_at": 1}},
        {"$limit": int(limit)},
    ]
    rows = await db.payment_transactions.aggregate(pipeline).to_list(int(limit))
    out = [
        {
            "email": r["_id"],
            "last_order_at": r.get("last_order_at"),
            "total_orders": int(r.get("total_orders", 0)),
            "lifetime_value": round(float(r.get("lifetime_value", 0) or 0), 2),
        }
        for r in rows if r.get("_id")
    ]
    return {
        "days": days,
        "cutoff_iso": cutoff_iso,
        "count": len(out),
        "buyers": out,
    }


class ReengageIn(BaseModel):
    emails: list[str] = Field(min_length=1, max_length=MAX_BATCH)
    discount_pct: int = Field(ge=5, le=50, default=15)
    expires_in_days: int = Field(ge=3, le=90, default=21)
    note: str | None = None


@router.post("/admin/retention/reengage")
async def admin_reengage(
    payload: ReengageIn, bg: BackgroundTasks,
    claims: dict = Depends(current_admin),
):
    """Per buyer: create a single-use marketplace-wide discount code, tag
    them in Kit, queue an email. Idempotent on (email + day): we won't
    double-mail the same buyer twice within 24h."""
    emails = sorted({e.strip().lower() for e in payload.emails if e and "@" in e})
    if not emails:
        raise HTTPException(400, "No valid emails provided.")
    if len(emails) > MAX_BATCH:
        raise HTTPException(400, f"Max {MAX_BATCH} emails per batch.")

    # Skip recently re-engaged buyers (idempotency window).
    skip_iso = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    recent = await db.marketing_codes.find(
        {"email": {"$in": emails}, "kind": "dormant_reengage",
         "created_at": {"$gte": skip_iso}},
        {"_id": 0, "email": 1},
    ).to_list(MAX_BATCH)
    skip = {r["email"] for r in recent}

    sent, skipped = 0, len(skip)
    expires_at = (datetime.now(timezone.utc) + timedelta(days=payload.expires_in_days)).isoformat()
    for email in emails:
        if email in skip:
            continue
        code = _gen_code()
        doc = {
            "id": secrets.token_urlsafe(8),
            "code": code,
            "email": email,
            "kind": "dormant_reengage",
            "discount_pct": payload.discount_pct,
            "scope": "marketplace_wide",  # honored at checkout for any maker
            "single_use": True,
            "uses_count": 0,
            "max_uses": 1,
            "expires_at": expires_at,
            "issued_by": claims["email"],
            "note": (payload.note or "").strip()[:400] or None,
            "active": True,
            "created_at": now_iso(),
        }
        await db.marketing_codes.insert_one(doc)
        # Best-effort Kit tag — skipped silently if Kit isn't configured.
        bg.add_task(_kit_tag_safe, email, "dormant-buyer-reengaged")
        # Queue the email via the existing dispatcher.
        bg.add_task(
            send_dormant_buyer_reengage,
            email, code, payload.discount_pct, payload.expires_in_days,
        )
        sent += 1

    await db.audit_log.insert_one({
        "kind": "dormant_reengage_batch",
        "actor": claims["email"], "sent": sent, "skipped": skipped,
        "discount_pct": payload.discount_pct,
        "expires_in_days": payload.expires_in_days,
        "created_at": now_iso(),
    })
    logger.info("[retention] reengaged %d, skipped %d (24h window)", sent, skipped)
    return {"sent": sent, "skipped": skipped, "expires_at": expires_at}


async def _kit_tag_safe(email: str, tag_name: str):
    """Tag a subscriber in Kit if configured; swallow errors so a bad Kit
    config can never block the audit log + email send path."""
    try:
        if not _kit_enabled():
            return
        sub = await subscribe(email, source="admin-reengage")
        sub_id = sub.get("subscriber_id")
        tag_id = await _ensure_tag(tag_name)
        if sub_id and tag_id:
            await _kit("POST", f"/v4/tags/{tag_id}/subscribers/{sub_id}", {})
    except Exception as e:
        logger.warning("[retention] kit tag failed for %s: %s", email, e)


async def run_auto_dormant_reengage(
    *,
    days: int = 60,
    discount_pct: int = 15,
    expires_in_days: int = 21,
    max_per_run: int = 50,
) -> dict:
    """Scheduler entrypoint — find dormant buyers and send them re-engagement
    codes automatically. Mirrors the manual `/admin/retention/reengage`
    flow but runs unattended:

      1. Bail out if the master toggle (`auto_dormant_reengage_enabled`
         in `site_settings`) is OFF. Default is OFF — operators must
         explicitly opt in via the admin Settings tab.
      2. Find buyers dormant `days`+ days. Cap at `max_per_run` per run
         so a sudden spike of dormancy doesn't blast 1000 emails in one
         shot.
      3. Skip anyone already issued a `dormant_reengage` code in the
         last 30 days (the manual flow's window is 24h, but for the
         automated cadence we want a longer cool-off so we don't
         re-pester someone who already ignored the discount).
      4. Tag in Kit (`dormant-buyer-reengaged-auto` distinguishes
         scheduled from manual blasts).
      5. Email + audit-log everything for traceability.

    Returns a summary dict the scheduler can log.
    """
    from routers.settings import get_setting
    if not await get_setting("auto_dormant_reengage_enabled", False):
        return {"ran": False, "reason": "toggle_off"}

    days = max(30, min(days, MAX_DAYS))
    cutoff_iso = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    year_ago = (datetime.now(timezone.utc) - timedelta(days=365)).isoformat()

    # 30-day cooldown for auto-flow vs 24h for manual — see docstring.
    cooldown_iso = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    recent = await db.marketing_codes.find(
        {"kind": "dormant_reengage", "created_at": {"$gte": cooldown_iso}},
        {"_id": 0, "email": 1},
    ).to_list(10_000)
    skip_set = {r["email"].lower() for r in recent if r.get("email")}

    # Aggregate orders just like the admin endpoint to find dormant buyers.
    # Source-of-truth: `payment_transactions` w/ `payment_status='paid'`
    # and `customer_email` (NOT the empty legacy `orders.buyer_email`).
    pipeline = [
        {"$match": {"payment_status": "paid", "customer_email": {"$exists": True, "$ne": None}}},
        {"$match": {"created_at": {"$gte": year_ago}}},
        {"$group": {
            "_id": {"$toLower": "$customer_email"},
            "last_order_at": {"$max": "$created_at"},
            "total_orders": {"$sum": 1},
            "lifetime_value": {"$sum": "$amount"},
        }},
        {"$match": {"last_order_at": {"$lt": cutoff_iso}}},
        {"$sort": {"lifetime_value": -1}},  # highest-LTV first
        {"$limit": max_per_run * 4},  # over-fetch so post-skip we still hit max
    ]
    candidates = await db.payment_transactions.aggregate(pipeline).to_list(max_per_run * 4)

    sent, skipped = 0, 0
    expires_at = (datetime.now(timezone.utc) + timedelta(days=expires_in_days)).isoformat()
    for cand in candidates:
        if sent >= max_per_run:
            break
        email = (cand.get("_id") or "").strip().lower()
        if not email or "@" not in email:
            continue
        if email in skip_set:
            skipped += 1
            continue
        code = _gen_code()
        doc = {
            "id": secrets.token_urlsafe(8),
            "code": code, "email": email,
            "kind": "dormant_reengage",
            "discount_pct": discount_pct,
            "scope": "marketplace_wide",
            "single_use": True, "uses_count": 0, "max_uses": 1,
            "expires_at": expires_at,
            "issued_by": "scheduler:auto-dormant",
            "note": f"Auto-issued · {days}d dormant · ${cand.get('lifetime_value', 0):.0f} LTV",
            "active": True,
            "created_at": now_iso(),
        }
        try:
            await db.marketing_codes.insert_one(doc)
        except Exception as e:
            logger.warning("[retention.auto] insert failed for %s: %s", email, e)
            continue
        # Use a distinct tag so ops can analyze which cohort responds better.
        try:
            await _kit_tag_safe(email, "dormant-buyer-reengaged-auto")
        except Exception:
            pass
        try:
            await send_dormant_buyer_reengage(email, code, discount_pct, expires_in_days)
        except Exception as e:
            logger.warning("[retention.auto] email send failed for %s: %s", email, e)
        sent += 1

    summary = {
        "ran": True, "sent": sent, "skipped": skipped,
        "candidate_count": len(candidates),
        "discount_pct": discount_pct, "expires_in_days": expires_in_days,
        "days": days,
    }
    await db.audit_log.insert_one({
        "kind": "dormant_reengage_batch_auto",
        "actor": "scheduler", **summary,
        "created_at": now_iso(),
    })
    logger.info("[retention.auto] %s", summary)
    return summary
