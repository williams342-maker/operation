from config import env_get
"""iter453 — Maker/Seller Agreement DB opt-in.

Versioned, append-only acceptance records with a full audit trail
(version, timestamp, IP, user-agent). Records are NEVER overwritten —
each (re-)acceptance is a new row so previous versions remain auditable.
Current agreement text lives at /policies (maker-agreement section);
DB versioning starts at 1.0 per product decision 2026-07-11.
"""
import os
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from core import db, now_iso
from maker_auth import current_admin, current_maker_slug

router = APIRouter()

CURRENT_AGREEMENT_VERSION = env_get("MAKER_AGREEMENT_VERSION", "1.0")


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else ""


class AcceptBody(BaseModel):
    version: str = Field(min_length=1, max_length=20)


@router.get("/maker/agreement/status")
async def agreement_status(slug: str = Depends(current_maker_slug)):
    latest = await db.maker_agreement_acceptances.find_one(
        {"maker_slug": slug, "version": CURRENT_AGREEMENT_VERSION},
        {"_id": 0, "version": 1, "accepted_at": 1})
    history_n = await db.maker_agreement_acceptances.count_documents(
        {"maker_slug": slug})
    return {
        "current_version": CURRENT_AGREEMENT_VERSION,
        "accepted": bool(latest),
        "accepted_at": (latest or {}).get("accepted_at"),
        "requires_acceptance": not latest,
        "acceptance_count": history_n,
    }


@router.post("/maker/agreement/accept", status_code=201)
async def accept_agreement(body: AcceptBody, request: Request,
                           slug: str = Depends(current_maker_slug)):
    if body.version != CURRENT_AGREEMENT_VERSION:
        raise HTTPException(409, "The agreement was updated — please reload and review the current version.")
    maker = await db.makers.find_one({"slug": slug}, {"_id": 0, "email": 1, "name": 1})
    row = {
        "id": str(uuid.uuid4()),
        "maker_slug": slug,
        "maker_email": (maker or {}).get("email"),
        "version": body.version,
        "accepted_at": now_iso(),
        "ip": _client_ip(request)[:64],
        "user_agent": (request.headers.get("user-agent") or "")[:300],
    }
    # Append-only — every acceptance (incl. re-acceptance of the same
    # version) is a new immutable row for the audit trail.
    await db.maker_agreement_acceptances.insert_one({**row})
    return {"ok": True, "acceptance": row}


@router.get("/admin/agreement/acceptances")
async def admin_acceptances(version: str = "", maker: str = "",
                            _: dict = Depends(current_admin)):
    q: dict = {}
    if version:
        q["version"] = version
    if maker:
        q["maker_slug"] = maker
    rows = await db.maker_agreement_acceptances.find(
        q, {"_id": 0}).sort("accepted_at", -1).to_list(1000)
    by_version: dict[str, int] = {}
    async for g in db.maker_agreement_acceptances.aggregate([
            {"$group": {"_id": {"v": "$version", "m": "$maker_slug"}}},
            {"$group": {"_id": "$_id.v", "n": {"$sum": 1}}}]):
        by_version[g["_id"]] = g["n"]
    total_makers = await db.makers.count_documents({})
    accepted_current = by_version.get(CURRENT_AGREEMENT_VERSION, 0)
    return {
        "current_version": CURRENT_AGREEMENT_VERSION,
        "acceptances": rows,
        "makers_by_version": by_version,
        "total_makers": total_makers,
        "pending_current": max(total_makers - accepted_current, 0),
    }
