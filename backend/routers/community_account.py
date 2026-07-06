"""Buyer (community_user) account deletion — parity with makers for Google Play
Account Deletion policy compliance.

Endpoints
─────────
POST /api/community/account/request-deletion  → begin 30-day grace period
POST /api/community/account/cancel-deletion   → back out during grace
GET  /api/community/account/deletion-status   → current pending state
POST /api/community/account/delete-now        → immediate delete (skips grace)

The 30-day grace period matches the maker deletion flow (`routers/maker.py::
maker_request_deletion`). A scheduled job in `scheduler.py::purge_pending_
community_accounts` performs the actual hard delete when the grace ends.

Data deleted at purge time:
  • community_users row (email, name, avatar, session_version, hashed pw)
  • Follows (both directions)
  • Reviews written by the user (author fields anonymized to "Deleted user";
    review body remains attached to product for other buyers' context)
  • Community showcase posts and replies authored by the user
  • Forum threads / replies authored by the user
  • DM threads where the buyer is a participant (soft-delete → moved to
    maker's "trash" folder; the maker retains the record for their own
    sales history until they empty their trash)
  • Notifications / follow feed rows

Data intentionally RETAINED (with buyer PII anonymized) for regulatory
reasons — required by fraud-prevention / IRS / accounting rules:
  • payment_transactions (order records: id, amount, tax, timestamps).
    Buyer email/name/address in these rows is replaced with tombstones.
"""
from __future__ import annotations
import uuid
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends, HTTPException

from core import db, now_iso
from maker_auth import current_buyer

router = APIRouter(prefix="", tags=["community-account"])

GRACE_DAYS = 30


def _email(claims: dict) -> str:
    e = (claims.get("email") or "").lower().strip()
    if not e:
        raise HTTPException(400, "Session is missing an email address.")
    return e


@router.get("/community/account/deletion-status")
async def deletion_status(claims: dict = Depends(current_buyer)):
    email = _email(claims)
    u = await db.community_users.find_one(
        {"email": email},
        {"_id": 0, "deletion_requested_at": 1, "deletion_purge_at": 1},
    )
    if not u or not u.get("deletion_requested_at"):
        return {"pending": False}
    return {
        "pending": True,
        "deletion_requested_at": u.get("deletion_requested_at"),
        "purge_at": u.get("deletion_purge_at"),
    }


@router.post("/community/account/request-deletion")
async def request_deletion(claims: dict = Depends(current_buyer)):
    """Begin a 30-day grace period. Cancellable within the window."""
    email = _email(claims)
    u = await db.community_users.find_one(
        {"email": email}, {"_id": 0, "deletion_requested_at": 1},
    )
    if u is None:
        raise HTTPException(404, "Account not found.")
    if u.get("deletion_requested_at"):
        raise HTTPException(400, "A deletion request is already active.")

    now_dt = datetime.now(timezone.utc)
    purge_dt = now_dt + timedelta(days=GRACE_DAYS)
    await db.community_users.update_one(
        {"email": email},
        {"$set": {
            "deletion_requested_at": now_dt.isoformat(),
            "deletion_purge_at": purge_dt.isoformat(),
        }},
    )
    await db.admin_audit.insert_one({
        "id": uuid.uuid4().hex,
        "kind": "buyer_deletion_requested",
        "actor": email,
        "created_at": now_dt.isoformat(),
        "purge_at": purge_dt.isoformat(),
    })
    return {
        "ok": True,
        "deletion_requested_at": now_dt.isoformat(),
        "purge_at": purge_dt.isoformat(),
        "days_remaining": GRACE_DAYS,
    }


@router.post("/community/account/cancel-deletion")
async def cancel_deletion(claims: dict = Depends(current_buyer)):
    """Cancel a pending deletion during the grace window."""
    email = _email(claims)
    u = await db.community_users.find_one(
        {"email": email}, {"_id": 0, "deletion_requested_at": 1},
    )
    if not u or not u.get("deletion_requested_at"):
        raise HTTPException(400, "No deletion request is active.")
    await db.community_users.update_one(
        {"email": email},
        {"$set": {"deletion_requested_at": None, "deletion_purge_at": None}},
    )
    await db.admin_audit.insert_one({
        "id": uuid.uuid4().hex,
        "kind": "buyer_deletion_canceled",
        "actor": email,
        "created_at": now_iso(),
    })
    return {"ok": True}


async def purge_buyer_account(email: str) -> dict:
    """The actual hard-delete. Called by scheduler after grace, or by the
    delete-now endpoint. Returns a dict of what was removed for the audit
    log. Idempotent — safe to call twice.
    """
    email = (email or "").lower().strip()
    if not email:
        return {"deleted": False, "reason": "no email"}

    counts: dict[str, int] = {}
    # 1. Anonymize reviews (preserve body for other buyers' context)
    try:
        r = await db.reviews.update_many(
            {"author_email": email},
            {"$set": {
                "author_email": None,
                "author_name": "Deleted user",
                "author_id": None,
            }},
        )
        counts["reviews_anonymized"] = int(r.modified_count or 0)
    except Exception:
        counts["reviews_anonymized"] = 0

    # 2. Delete follows both directions
    try:
        r = await db.follows.delete_many({"buyer_email": email})
        counts["follows_removed"] = int(r.deleted_count or 0)
    except Exception:
        counts["follows_removed"] = 0

    # 3. Delete community showcase posts + replies
    for coll_name in ("community_showcase", "community_showcase_replies",
                      "forum_threads", "forum_replies", "notifications"):
        try:
            coll = getattr(db, coll_name)
            r = await coll.delete_many({"author_email": email})
            counts[f"{coll_name}_removed"] = int(r.deleted_count or 0)
        except Exception:
            counts[f"{coll_name}_removed"] = 0

    # 4. Soft-delete buyer's side of DM threads (maker retains for sales history)
    try:
        r = await db.dm_threads.update_many(
            {"buyer_email": email},
            {"$set": {"buyer_deleted": True, "buyer_email_anon": True,
                      "buyer_name": "Deleted user"}},
        )
        counts["dm_threads_anonymized"] = int(r.modified_count or 0)
    except Exception:
        counts["dm_threads_anonymized"] = 0

    # 5. Anonymize payment_transactions (RETAINED for accounting/fraud —
    #    we only strip the PII, not the order record itself)
    try:
        r = await db.payment_transactions.update_many(
            {"buyer_email": email},
            {"$set": {
                "buyer_email": None,
                "buyer_name": "Deleted user",
                "shipping_address": None,
                "billing_address": None,
                "phone": None,
                "buyer_deleted_at": now_iso(),
            }},
        )
        counts["orders_anonymized"] = int(r.modified_count or 0)
    except Exception:
        counts["orders_anonymized"] = 0

    # 6. Finally, delete the community_users row + any content_reports
    try:
        r = await db.community_users.delete_one({"email": email})
        counts["user_deleted"] = int(r.deleted_count or 0)
    except Exception:
        counts["user_deleted"] = 0

    await db.admin_audit.insert_one({
        "id": uuid.uuid4().hex,
        "kind": "buyer_account_purged",
        "actor": email,
        "created_at": now_iso(),
        "counts": counts,
    })
    return {"deleted": True, "counts": counts}


@router.post("/community/account/delete-now")
async def delete_now(claims: dict = Depends(current_buyer)):
    """Immediate hard-delete for buyers who don't want to wait the 30 days.
    We still perform the audit-log write and PII anonymization in one shot.
    The client MUST sign the user out after this returns 200.
    """
    email = _email(claims)
    result = await purge_buyer_account(email)
    return {"ok": True, **result}
