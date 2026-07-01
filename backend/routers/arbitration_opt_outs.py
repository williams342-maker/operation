"""Arbitration opt-out tracker (Legal / Compliance).

Terms of Service §12 and Maker Agreement §27 give every User a 30-day
window to opt out of the mandatory-arbitration clause by sending a
written notice to policy@craftersmarket.org.

This module records ACCEPTED opt-out notices in the database so that
Legal / Compliance has an internal source of truth beyond the inbox.

Contract:
  - Email remains the authoritative legal submission method.
  - Opt-outs are logged here manually by Legal / Compliance after
    they've validated the incoming email meets the §12 requirements
    (legal name, account email, clear statement of opt-out, within
    30 days of first acceptance).
  - The record includes: user identity, opt-out date, who processed
    it, and verification notes.

No front-end UI is exposed at Version 1 (per Phase D feature freeze);
Legal / Compliance interacts via curl or the admin scripts. The router
is admin-gated so it cannot leak sensitive PII.

Endpoints:
  POST /api/legal/arbitration-opt-outs      — record a new accepted opt-out
  GET  /api/legal/arbitration-opt-outs      — list all accepted opt-outs
  GET  /api/legal/arbitration-opt-outs/lookup?account_email=... — lookup by account
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, EmailStr, Field

from core import db, logger, now_iso
from maker_auth import require_super_admin

router = APIRouter()

COLLECTION = "arbitration_opt_outs"


class OptOutIn(BaseModel):
    account_email: EmailStr = Field(
        ..., description="The account email address named in the opt-out notice."
    )
    legal_name: str = Field(
        ..., min_length=1, description="Legal name of the User opting out."
    )
    role: str = Field(
        ..., description="Buyer, Maker, or Both."
    )
    opt_out_received_at: datetime = Field(
        ..., description="Date/time the opt-out notice arrived (UTC ISO 8601)."
    )
    terms_first_accepted_at: Optional[datetime] = Field(
        None,
        description=(
            "Date/time the User first accepted the Terms of Service and/or "
            "Maker Agreement. Used to confirm the 30-day opt-out window "
            "under ToS §12 / Maker §27."
        ),
    )
    verification_notes: str = Field(
        "",
        description=(
            "Free-form notes from the Legal / Compliance reviewer: how the "
            "opt-out was verified, what documents were referenced, any "
            "follow-up actions."
        ),
    )


class OptOutOut(BaseModel):
    id: str
    account_email: str
    legal_name: str
    role: str
    opt_out_received_at: str
    terms_first_accepted_at: Optional[str] = None
    within_window: Optional[bool] = None
    processed_by: str
    processed_at: str
    verification_notes: str


def _within_window(received_at: datetime, first_accepted: Optional[datetime]) -> Optional[bool]:
    if not first_accepted:
        return None
    delta = received_at - first_accepted
    return delta.total_seconds() <= 30 * 24 * 3600 and delta.total_seconds() >= 0


def _to_out(doc: dict) -> OptOutOut:
    return OptOutOut(
        id=str(doc.get("_id")),
        account_email=doc["account_email"],
        legal_name=doc["legal_name"],
        role=doc["role"],
        opt_out_received_at=doc["opt_out_received_at"],
        terms_first_accepted_at=doc.get("terms_first_accepted_at"),
        within_window=doc.get("within_window"),
        processed_by=doc["processed_by"],
        processed_at=doc["processed_at"],
        verification_notes=doc.get("verification_notes", ""),
    )


@router.post("/legal/arbitration-opt-outs", response_model=OptOutOut)
async def record_opt_out(
    payload: OptOutIn,
    admin=Depends(require_super_admin()),
):
    """Record a validated arbitration opt-out notice.

    Only callable by super-admins. Email remains the authoritative legal
    submission channel; this endpoint is the internal ledger.
    """
    if payload.role not in ("Buyer", "Maker", "Both"):
        raise HTTPException(status_code=400, detail="role must be Buyer, Maker, or Both")

    within = _within_window(
        payload.opt_out_received_at, payload.terms_first_accepted_at
    )

    processed_by = getattr(admin, "email", None) or getattr(admin, "id", "admin")
    doc = {
        "account_email": payload.account_email.lower().strip(),
        "legal_name": payload.legal_name.strip(),
        "role": payload.role,
        "opt_out_received_at": payload.opt_out_received_at.astimezone(timezone.utc).isoformat(),
        "terms_first_accepted_at": (
            payload.terms_first_accepted_at.astimezone(timezone.utc).isoformat()
            if payload.terms_first_accepted_at
            else None
        ),
        "within_window": within,
        "processed_by": str(processed_by),
        "processed_at": now_iso(),
        "verification_notes": payload.verification_notes.strip(),
    }
    result = await db[COLLECTION].insert_one(doc)
    doc["_id"] = result.inserted_id
    logger.info(
        "arbitration_opt_out_recorded",
        extra={
            "account_email": doc["account_email"],
            "role": doc["role"],
            "within_window": within,
            "processed_by": doc["processed_by"],
        },
    )
    return _to_out(doc)


@router.get("/legal/arbitration-opt-outs", response_model=list[OptOutOut])
async def list_opt_outs(
    admin=Depends(require_super_admin()),
    limit: int = Query(200, ge=1, le=1000),
):
    """List all accepted arbitration opt-out records (super-admin only)."""
    cursor = db[COLLECTION].find({}).sort("processed_at", -1).limit(limit)
    return [_to_out(d) async for d in cursor]


@router.get("/legal/arbitration-opt-outs/lookup", response_model=list[OptOutOut])
async def lookup_opt_out(
    account_email: str = Query(..., description="Case-insensitive account email lookup."),
    admin=Depends(require_super_admin()),
):
    """Look up all opt-out records for a specific account email."""
    normalized = account_email.lower().strip()
    cursor = db[COLLECTION].find({"account_email": normalized}).sort("processed_at", -1)
    return [_to_out(d) async for d in cursor]
