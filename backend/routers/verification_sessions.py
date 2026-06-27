"""iter413cz — Verification Session Framework.

A permanent infrastructure layer for capturing structured observation
sessions across the platform — production verifications, founder
onboarding walks, feature validations, seller interviews, buyer
research, beta feedback. Every session quietly builds institutional
knowledge that feeds:

  • AI Operations Center (recurring-issue surfacing)
  • Compass recommendations
  • Product roadmap (what's confusing, what's missing)
  • Seller coaching playbooks
  • Buyer experience research

Design rules:
  • One Mongo collection (`verification_sessions`) — keep schema flat.
  • Sessions are CREATED + CLOSED explicitly by an admin (or a future
    automated triggering endpoint). They never time-out passively —
    that would silently drop observation data.
  • While a session is open, any Compass help-chat turn POSTed with the
    matching `verification_session_id` auto-appends to the session's
    `turns` array. The help_chat router handles that pin (see hook
    in routers/help_chat.py).
  • Issues + recommendations are tagged free-form so this generalises
    to founder_onboarding / seller_interview / buyer_research without
    a schema migration each time.

Schema (per session document):
  {
    id: str (uuid),
    verification_type: str  # one of VERIFICATION_TYPES
    title: str,             # human-readable label
    feature_area: str|None, # e.g. "listing_video_phase1", "compass_v1"
    subject: dict|None,     # who's being observed (e.g. {role: maker, slug: loretta-alvarado})
    started_at: iso,
    started_by: str,        # admin email
    closed_at: iso|None,
    closed_by: str|None,
    completion_status: str, # open | passed | failed | abandoned
    turns: [{
      ts: iso,
      kind: "question"|"response"|"action"|"issue"|"recommendation"|"note",
      author: "user"|"compass"|"admin"|"system",
      text: str,
      meta: dict|None,      # arbitrary structured payload
    }],
    issues_count: int,      # denormalised for fast dashboard reads
    recommendations_count: int,
  }
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from core import db
from maker_auth import current_admin

router = APIRouter()
logger = logging.getLogger("crafters")


# Canonical session types. Add new ones here as the platform grows.
VERIFICATION_TYPES = {
    "production_verification",   # e.g. Loretta walking iter413cy checklist
    "founder_onboarding",        # first 30 days with a new founding seller
    "feature_validation",        # new feature dogfooded against real flows
    "seller_interview",          # qualitative seller research
    "buyer_research",            # qualitative buyer research
    "beta_feedback",             # structured beta-cohort observation
    "ai_evaluation",             # explicit AI/Compass eval runs
}

VALID_TURN_KINDS = {"question", "response", "action", "issue", "recommendation", "note"}
VALID_AUTHORS = {"user", "compass", "admin", "system"}
VALID_COMPLETION = {"open", "passed", "failed", "abandoned"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Schemas ───────────────────────────────────────────────────────────
class StartSessionIn(BaseModel):
    verification_type: str
    title: str = Field(min_length=2, max_length=200)
    feature_area: Optional[str] = Field(default=None, max_length=120)
    subject: Optional[dict] = None


class AppendTurnIn(BaseModel):
    kind: str = Field(pattern=r"^(question|response|action|issue|recommendation|note)$")
    author: str = Field(pattern=r"^(user|compass|admin|system)$")
    text: str = Field(min_length=1, max_length=4000)
    meta: Optional[dict] = None


class CloseSessionIn(BaseModel):
    completion_status: str = Field(pattern=r"^(passed|failed|abandoned)$")
    summary: Optional[str] = Field(default=None, max_length=2000)


# ── Internal helpers (exported for help_chat to use) ─────────────────
async def record_compass_turn(
    session_id: str,
    question: str,
    response: str,
    user_role: Optional[str] = None,
    page_url: Optional[str] = None,
) -> bool:
    """Append a Compass exchange to an open verification session.

    Best-effort: returns False silently if the session is missing or
    already closed — we never want a chat call to error because the
    optional session metadata is stale."""
    doc = await db.verification_sessions.find_one(
        {"id": session_id, "completion_status": "open"},
        {"_id": 0, "id": 1},
    )
    if not doc:
        return False
    now = _now()
    question_turn = {
        "ts": now,
        "kind": "question",
        "author": "user",
        "text": question,
        "meta": {"role": user_role, "page_url": page_url},
    }
    response_turn = {
        "ts": now,
        "kind": "response",
        "author": "compass",
        "text": response,
        "meta": None,
    }
    await db.verification_sessions.update_one(
        {"id": session_id},
        {"$push": {"turns": {"$each": [question_turn, response_turn]}}},
    )
    return True


# ── HTTP routes (admin-only) ──────────────────────────────────────────
@router.post("/admin/verification-sessions/start")
async def start_session(payload: StartSessionIn, claims: dict = Depends(current_admin)):
    if payload.verification_type not in VERIFICATION_TYPES:
        raise HTTPException(
            400,
            f"verification_type must be one of: {sorted(VERIFICATION_TYPES)}",
        )
    admin_email = (claims.get("email") or "admin").lower().strip()
    doc = {
        "id": str(uuid.uuid4()),
        "verification_type": payload.verification_type,
        "title": payload.title.strip(),
        "feature_area": (payload.feature_area or "").strip() or None,
        "subject": payload.subject,
        "started_at": _now(),
        "started_by": admin_email,
        "closed_at": None,
        "closed_by": None,
        "completion_status": "open",
        "turns": [],
        "issues_count": 0,
        "recommendations_count": 0,
    }
    await db.verification_sessions.insert_one(doc)
    doc.pop("_id", None)
    logger.info("[verify] session opened type=%s by=%s id=%s",
                payload.verification_type, admin_email, doc["id"])
    return {"session": doc}


@router.post("/admin/verification-sessions/{session_id}/turns")
async def append_turn(session_id: str, payload: AppendTurnIn,
                      claims: dict = Depends(current_admin)):
    """Manual turn append — used for admin/system observations during a
    session (e.g. tagging an issue, recording a recommendation). Compass
    turns are auto-appended via record_compass_turn from help_chat."""
    turn = {
        "ts": _now(),
        "kind": payload.kind,
        "author": payload.author,
        "text": payload.text,
        "meta": payload.meta,
    }
    inc_ops: dict = {}
    if payload.kind == "issue":
        inc_ops["issues_count"] = 1
    elif payload.kind == "recommendation":
        inc_ops["recommendations_count"] = 1
    update: dict = {"$push": {"turns": turn}}
    if inc_ops:
        update["$inc"] = inc_ops
    result = await db.verification_sessions.update_one(
        {"id": session_id, "completion_status": "open"}, update,
    )
    if result.matched_count == 0:
        raise HTTPException(404, "Open session not found.")
    return {"appended": True, "turn": turn}


@router.post("/admin/verification-sessions/{session_id}/close")
async def close_session(session_id: str, payload: CloseSessionIn,
                        claims: dict = Depends(current_admin)):
    admin_email = (claims.get("email") or "admin").lower().strip()
    update_set = {
        "closed_at": _now(),
        "closed_by": admin_email,
        "completion_status": payload.completion_status,
    }
    update: dict = {"$set": update_set}
    if payload.summary:
        update["$push"] = {"turns": {
            "ts": _now(), "kind": "note", "author": "admin",
            "text": payload.summary.strip(), "meta": {"closing_summary": True},
        }}
    result = await db.verification_sessions.update_one(
        {"id": session_id, "completion_status": "open"}, update,
    )
    if result.matched_count == 0:
        raise HTTPException(404, "Open session not found.")
    doc = await db.verification_sessions.find_one({"id": session_id}, {"_id": 0})
    logger.info("[verify] session closed id=%s status=%s by=%s",
                session_id, payload.completion_status, admin_email)
    return {"session": doc}


@router.get("/admin/verification-sessions/{session_id}")
async def get_session(session_id: str, claims: dict = Depends(current_admin)):
    doc = await db.verification_sessions.find_one({"id": session_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Session not found.")
    return {"session": doc}


@router.get("/admin/verification-sessions")
async def list_sessions(
    verification_type: Optional[str] = None,
    feature_area: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 50,
    claims: dict = Depends(current_admin),
):
    """List sessions with optional filters. Sorted newest-first.
    Cheap dashboard read — sessions are denormalised so we don't have
    to scan the full turns array."""
    query: dict = {}
    if verification_type:
        if verification_type not in VERIFICATION_TYPES:
            raise HTTPException(400, "unknown verification_type")
        query["verification_type"] = verification_type
    if feature_area:
        query["feature_area"] = feature_area
    if status:
        if status not in VALID_COMPLETION:
            raise HTTPException(400, "unknown completion_status")
        query["completion_status"] = status
    limit = max(1, min(200, int(limit or 50)))
    rows = await db.verification_sessions.find(
        query, {"_id": 0, "turns": 0},  # drop the heavy turns array
    ).sort("started_at", -1).to_list(limit)
    return {"rows": rows, "count": len(rows), "valid_types": sorted(VERIFICATION_TYPES)}
