"""iter327 — Founder / Maker application email verification.

Two routes:

- ``GET /api/applications/verify-email?token=<t>``  Public. Decodes the
  signed token issued when the applicant submitted their form; on match
  flips the row to ``email_verified=True`` and stamps
  ``email_verified_at``. Idempotent — re-clicking a spent link still
  returns ``ok=true``.

- ``POST /api/admin/maker-applications/{id}/resend-verification``  Admin.
  Re-issues a fresh 7-day token, updates ``email_verification_sent_at``,
  and re-sends the confirm-email template. Also idempotent-safe: if the
  applicant is already verified, returns ``ok=true, already_verified=true``
  without spamming a new email.

The token itself is stateless (URLSafeTimedSerializer) — see
``maker_auth.issue_application_verify_token``.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel

from core import db, logger
from maker_auth import (
    current_admin,
    issue_application_verify_token,
    verify_application_verify_token,
)
from email_service import send_application_verify_email

router = APIRouter(tags=["applications"])


class VerifyResponse(BaseModel):
    ok: bool
    already_verified: bool = False
    studio_name: Optional[str] = None
    is_beta: bool = False


@router.get("/applications/verify-email", response_model=VerifyResponse)
async def verify_application_email(token: str):
    """Public one-time click target. Marks the application row referenced
    by the token as email-verified. Re-clicking a spent link returns
    ``ok=true, already_verified=true`` so a bookmarked landing page
    doesn't scare the applicant with an error."""
    data = verify_application_verify_token(token)
    app_id = data["app_id"]
    email = (data["email"] or "").lower().strip()

    row = await db.maker_applications.find_one(
        {"id": app_id},
        {"_id": 0, "email": 1, "email_verified": 1, "studio_name": 1, "is_beta": 1},
    )
    if not row:
        # Token decodes fine but the app row was deleted — treat as invalid
        # rather than exposing that we know the id was valid at some point.
        raise HTTPException(status_code=404, detail="Application no longer exists.")

    # Belt-and-suspenders: the token also embeds the email so a leaked
    # token can't be replayed against a different app_id even if the
    # attacker knew the id.
    if (row.get("email") or "").lower().strip() != email:
        raise HTTPException(status_code=401, detail="Token / application mismatch.")

    if row.get("email_verified"):
        return VerifyResponse(
            ok=True,
            already_verified=True,
            studio_name=row.get("studio_name"),
            is_beta=bool(row.get("is_beta")),
        )

    verified_at = datetime.now(timezone.utc).isoformat()
    await db.maker_applications.update_one(
        {"id": app_id},
        {"$set": {
            "email_verified": True,
            "email_verified_at": verified_at,
        }},
    )
    logger.info("[app-verify] app_id=%s email=%s verified", app_id, email)
    return VerifyResponse(
        ok=True,
        already_verified=False,
        studio_name=row.get("studio_name"),
        is_beta=bool(row.get("is_beta")),
    )


class ResendResponse(BaseModel):
    ok: bool
    already_verified: bool = False
    verify_sent_at: Optional[str] = None


class FunnelBucket(BaseModel):
    submitted: int
    verified: int
    pending: int
    stale_pending: int
    verification_rate_pct: float


class FunnelResponse(BaseModel):
    window_days: int
    generated_at: str
    last_7d: FunnelBucket
    all_time: FunnelBucket


@router.get(
    "/admin/applications/verification-funnel",
    response_model=FunnelResponse,
)
async def admin_applications_verification_funnel(
    _: dict = Depends(current_admin),
):
    """iter327b — Verification funnel tile for the applications tab.
    Answers: "of the applications we received in the last 7 days, how
    many confirmed their email? How many are ghosting?"

    Two windows returned in one call so the tile can show a compact
    7-day headline with an all-time reference underneath. `stale_pending`
    counts applications older than 7 days that still haven't verified
    — those are the ones most likely to be dead/typo emails an admin
    can prune."""
    from datetime import datetime, timedelta, timezone

    now = datetime.now(timezone.utc)
    seven_days_ago = (now - timedelta(days=7)).isoformat()

    async def _bucket(cutoff_iso: Optional[str]) -> FunnelBucket:
        submitted_q = {}
        verified_q = {"email_verified": True}
        pending_q = {"email_verified": False}
        stale_q = {"email_verified": False, "created_at": {"$lt": seven_days_ago}}
        if cutoff_iso is not None:
            submitted_q["created_at"] = {"$gte": cutoff_iso}
            verified_q["created_at"] = {"$gte": cutoff_iso}
            pending_q["created_at"] = {"$gte": cutoff_iso}
            # stale_q intentionally NOT window-scoped — "stale" always
            # means "older than 7d and still unverified".

        submitted = await db.maker_applications.count_documents(submitted_q)
        verified = await db.maker_applications.count_documents(verified_q)
        pending = await db.maker_applications.count_documents(pending_q)
        stale = await db.maker_applications.count_documents(stale_q)
        rate = round((verified / submitted * 100.0), 1) if submitted else 0.0
        return FunnelBucket(
            submitted=submitted,
            verified=verified,
            pending=pending,
            stale_pending=stale,
            verification_rate_pct=rate,
        )

    return FunnelResponse(
        window_days=7,
        generated_at=now.isoformat(),
        last_7d=await _bucket(seven_days_ago),
        all_time=await _bucket(None),
    )


@router.post(
    "/admin/maker-applications/{app_id}/resend-verification",
    response_model=ResendResponse,
)
async def admin_resend_application_verification(
    app_id: str,
    bg: BackgroundTasks,
    _: dict = Depends(current_admin),
):
    """Admin surface for the "resend verification" button on the
    application queue card. Fresh 7-day token, fresh
    ``email_verification_sent_at`` stamp. Idempotent — a resend against
    an already-verified applicant returns ``already_verified=true``
    without generating a new email."""
    row = await db.maker_applications.find_one(
        {"id": app_id},
        {"_id": 0, "id": 1, "name": 1, "email": 1, "studio_name": 1,
         "is_beta": 1, "email_verified": 1},
    )
    if not row:
        raise HTTPException(status_code=404, detail="Application not found.")

    if row.get("email_verified"):
        return ResendResponse(ok=True, already_verified=True)

    now_iso_str = datetime.now(timezone.utc).isoformat()
    await db.maker_applications.update_one(
        {"id": app_id},
        {"$set": {"email_verification_sent_at": now_iso_str}},
    )

    site = (os.environ.get("FRONTEND_URL") or "https://craftersmarket.org").rstrip("/")
    token = issue_application_verify_token(app_id, row.get("email") or "")
    verify_url = f"{site}/apply/verify?token={token}"
    bg.add_task(
        send_application_verify_email,
        row.get("email"),
        row.get("name") or "there",
        row.get("studio_name") or "your studio",
        verify_url,
        bool(row.get("is_beta")),
    )
    logger.info("[app-verify] resend app_id=%s email=%s", app_id, row.get("email"))
    return ResendResponse(ok=True, verify_sent_at=now_iso_str)
