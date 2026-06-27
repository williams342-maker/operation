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

# iter413cz+ — Canonical platform-area enums. Used to roll up sessions
# by surface in the AI Operations Center (e.g. "all open production_
# verification sessions touching the Compass area"). Keep this list
# tight — adding a new area is an explicit, considered change.
PLATFORM_AREAS = {
    "marketplace", "compass", "dashboard", "checkout",
    "maker_portal", "admin", "community", "email", "ops",
}

# Participant types in the observed session (who's being watched/
# interviewed/evaluated). Distinct from `author` on a turn — a single
# session can involve multiple participants (e.g. seller + admin in
# the same call).
PARTICIPANT_TYPES = {"seller", "buyer", "founder", "admin", "visitor"}

# Severity floor for issues raised inside a session — surfaced on the
# AI Operations Center "AI-Diagnosed Issues" card aggregations.
SEVERITY_LEVELS = {"info", "low", "medium", "high", "critical"}

# Issue & recommendation categories. Free-form additions are also
# allowed via per-turn `meta.category` for niche taxonomies, but these
# canonical buckets cover the high-volume reporting paths.
ISSUE_CATEGORIES = {
    "bug", "ux_confusion", "missing_feature", "performance",
    "data_quality", "content_quality", "accessibility", "security",
    "compliance", "billing", "moderation", "other",
}
RECOMMENDATION_CATEGORIES = {
    "copy", "ui", "workflow", "feature", "documentation",
    "policy", "onboarding", "ai_prompt", "other",
}

# Resolution state distinct from completion_status — a session can be
# CLOSED (passed/failed) AND still have a `resolution_status` of
# "deferred" or "in_progress" if the follow-up work isn't done. The
# AI Operations Center reads BOTH to triage open follow-ups.
RESOLUTION_STATES = {
    "open", "in_progress", "resolved", "deferred", "wont_fix",
}

VALID_TURN_KINDS = {"question", "response", "action", "issue", "recommendation", "note"}
VALID_AUTHORS = {"user", "compass", "admin", "system"}
VALID_COMPLETION = {"open", "passed", "failed", "abandoned"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _validate_enum(value: Optional[str], allowed: set, field_name: str) -> None:
    """Raise 400 if `value` is non-None but not in `allowed`. None passes."""
    if value is not None and value not in allowed:
        raise HTTPException(
            400, f"{field_name} must be one of: {sorted(allowed)} (got {value!r})",
        )


# ── Schemas ───────────────────────────────────────────────────────────
class StartSessionIn(BaseModel):
    """iter413cz+ schema — fully additive over the original iter413cz
    contract. All new fields are Optional so callers from before today
    keep working unchanged. The `metadata` bag is the official escape
    hatch for future attributes that don't yet warrant a top-level
    field — we promote a field out of `metadata` once usage stabilises."""
    verification_type: str
    title: str = Field(min_length=2, max_length=200)
    feature_area: Optional[str] = Field(default=None, max_length=120)
    subject: Optional[dict] = None

    # iter413cz+ — Structured optional fields. Each one is queryable
    # by the AI Operations Center (filter / group-by / aggregate).
    platform_area: Optional[str] = Field(default=None, max_length=40)
    participants: Optional[list] = None    # list[dict]: {type, identifier?, name?}
    severity: Optional[str] = Field(default=None, max_length=20)
    tags: Optional[list] = None            # list[str], lowercased + deduped on insert
    linked_refs: Optional[dict] = None     # {github_issue, github_pr, iteration, ticket}
    resolution_status: Optional[str] = Field(default="open", max_length=20)
    follow_up_owner: Optional[str] = Field(default=None, max_length=120)
    # Generic escape-hatch — any future attribute that doesn't yet
    # justify a top-level field. Read by the Ops Center via JSONPath.
    metadata: Optional[dict] = None


class AppendTurnIn(BaseModel):
    """iter413cz+ — Per-turn enrichment for issues / recommendations /
    AI evaluations. `category`, `severity`, `ai_confidence`, and
    `attachments` are first-class so the AI Operations Center can
    aggregate without re-parsing the free-form `meta` blob."""
    kind: str = Field(pattern=r"^(question|response|action|issue|recommendation|note)$")
    author: str = Field(pattern=r"^(user|compass|admin|system)$")
    text: str = Field(min_length=1, max_length=4000)
    meta: Optional[dict] = None

    # iter413cz+ enrichment
    category: Optional[str] = Field(default=None, max_length=40)
    severity: Optional[str] = Field(default=None, max_length=20)
    ai_confidence: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    attachments: Optional[list] = None    # list[dict]: {url, kind, caption?}
    tags: Optional[list] = None


class UpdateSessionIn(BaseModel):
    """iter413cz+ — Mutate the long-lived session attributes WITHOUT
    closing. Useful when an admin learns new context mid-session
    (e.g. tags it as `compass`, raises severity to `high`, assigns
    follow_up_owner). Every field is optional — only supplied keys
    are written via `$set`."""
    platform_area: Optional[str] = Field(default=None, max_length=40)
    severity: Optional[str] = Field(default=None, max_length=20)
    tags: Optional[list] = None
    linked_refs: Optional[dict] = None
    resolution_status: Optional[str] = Field(default=None, max_length=20)
    follow_up_owner: Optional[str] = Field(default=None, max_length=120)
    metadata: Optional[dict] = None


class CloseSessionIn(BaseModel):
    completion_status: str = Field(pattern=r"^(passed|failed|abandoned)$")
    summary: Optional[str] = Field(default=None, max_length=2000)
    # iter413cz+ — On close, optionally promote the session to a
    # follow-up state (e.g. closed=failed BUT resolution_status=
    # in_progress with follow_up_owner=team@…). Lets the Ops Center
    # surface "closed sessions with open follow-ups" rollups.
    resolution_status: Optional[str] = Field(default=None, max_length=20)
    follow_up_owner: Optional[str] = Field(default=None, max_length=120)


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


def _norm_tags(tags) -> list:
    """Lowercased, deduped, length-capped tag list. Returns [] for falsy."""
    if not tags:
        return []
    seen: set = set()
    out: list = []
    for t in tags:
        if not isinstance(t, str):
            continue
        s = t.strip().lower()
        if not s or len(s) > 40 or s in seen:
            continue
        seen.add(s)
        out.append(s)
        if len(out) >= 25:
            break
    return out


# ── HTTP routes (admin-only) ──────────────────────────────────────────
@router.post("/admin/verification-sessions/start")
async def start_session(payload: StartSessionIn, claims: dict = Depends(current_admin)):
    if payload.verification_type not in VERIFICATION_TYPES:
        raise HTTPException(
            400,
            f"verification_type must be one of: {sorted(VERIFICATION_TYPES)}",
        )
    # iter413cz+ — validate the new structured fields against their enums.
    _validate_enum(payload.platform_area, PLATFORM_AREAS, "platform_area")
    _validate_enum(payload.severity, SEVERITY_LEVELS, "severity")
    _validate_enum(payload.resolution_status, RESOLUTION_STATES, "resolution_status")
    if payload.participants:
        for p in payload.participants:
            if not isinstance(p, dict) or p.get("type") not in PARTICIPANT_TYPES:
                raise HTTPException(
                    400, f"participant.type must be one of: {sorted(PARTICIPANT_TYPES)}",
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
        # iter413cz+ — Structured optional fields. All default to None
        # so the doc shape stays grep-able and downstream readers can
        # rely on key presence.
        "platform_area": payload.platform_area,
        "participants": payload.participants or [],
        "severity": payload.severity,
        "tags": _norm_tags(payload.tags),
        "linked_refs": payload.linked_refs or {},
        "resolution_status": payload.resolution_status or "open",
        "follow_up_owner": (payload.follow_up_owner or "").strip().lower() or None,
        "metadata": payload.metadata or {},
    }
    await db.verification_sessions.insert_one(doc)
    doc.pop("_id", None)
    logger.info("[verify] session opened type=%s by=%s id=%s area=%s",
                payload.verification_type, admin_email, doc["id"],
                payload.platform_area or "—")
    return {"session": doc}


@router.post("/admin/verification-sessions/{session_id}/turns")
async def append_turn(session_id: str, payload: AppendTurnIn,
                      claims: dict = Depends(current_admin)):
    """Manual turn append — used for admin/system observations during a
    session (e.g. tagging an issue, recording a recommendation). Compass
    turns are auto-appended via record_compass_turn from help_chat."""
    # iter413cz+ — per-turn enrichment validation.
    _validate_enum(payload.severity, SEVERITY_LEVELS, "severity")
    if payload.category:
        # Use the right canonical set based on kind for clearer 400s.
        if payload.kind == "issue":
            _validate_enum(payload.category, ISSUE_CATEGORIES, "category (issue)")
        elif payload.kind == "recommendation":
            _validate_enum(payload.category, RECOMMENDATION_CATEGORIES, "category (recommendation)")
        # For other kinds (question/response/note/action), category is free-form.

    turn = {
        "ts": _now(),
        "kind": payload.kind,
        "author": payload.author,
        "text": payload.text,
        "meta": payload.meta,
        # iter413cz+ first-class enrichment fields. Always present on
        # new turns so the Ops Center aggregator can `$match` them
        # without `$ifNull` gymnastics.
        "category": payload.category,
        "severity": payload.severity,
        "ai_confidence": payload.ai_confidence,
        "attachments": payload.attachments or [],
        "tags": _norm_tags(payload.tags),
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


@router.patch("/admin/verification-sessions/{session_id}")
async def update_session(session_id: str, payload: UpdateSessionIn,
                          claims: dict = Depends(current_admin)):
    """iter413cz+ — Mutate long-lived session attributes mid-flight.
    Only writes the fields the caller actually supplied (no implicit
    nulling). Session must still be open."""
    _validate_enum(payload.platform_area, PLATFORM_AREAS, "platform_area")
    _validate_enum(payload.severity, SEVERITY_LEVELS, "severity")
    _validate_enum(payload.resolution_status, RESOLUTION_STATES, "resolution_status")

    update_set: dict = {}
    if payload.platform_area is not None:
        update_set["platform_area"] = payload.platform_area
    if payload.severity is not None:
        update_set["severity"] = payload.severity
    if payload.tags is not None:
        update_set["tags"] = _norm_tags(payload.tags)
    if payload.linked_refs is not None:
        update_set["linked_refs"] = payload.linked_refs
    if payload.resolution_status is not None:
        update_set["resolution_status"] = payload.resolution_status
    if payload.follow_up_owner is not None:
        update_set["follow_up_owner"] = payload.follow_up_owner.strip().lower() or None
    if payload.metadata is not None:
        # Merge (don't replace) — admins can incrementally enrich the
        # metadata bag without re-supplying prior keys.
        for k, v in payload.metadata.items():
            update_set[f"metadata.{k}"] = v
    if not update_set:
        raise HTTPException(400, "No fields supplied to update.")

    result = await db.verification_sessions.update_one(
        {"id": session_id, "completion_status": "open"},
        {"$set": update_set},
    )
    if result.matched_count == 0:
        raise HTTPException(404, "Open session not found.")
    doc = await db.verification_sessions.find_one({"id": session_id}, {"_id": 0})
    return {"session": doc}


@router.post("/admin/verification-sessions/{session_id}/close")
async def close_session(session_id: str, payload: CloseSessionIn,
                        claims: dict = Depends(current_admin)):
    _validate_enum(payload.resolution_status, RESOLUTION_STATES, "resolution_status")
    admin_email = (claims.get("email") or "admin").lower().strip()
    update_set = {
        "closed_at": _now(),
        "closed_by": admin_email,
        "completion_status": payload.completion_status,
    }
    # iter413cz+ — let close payload promote follow-up state.
    if payload.resolution_status is not None:
        update_set["resolution_status"] = payload.resolution_status
    if payload.follow_up_owner is not None:
        update_set["follow_up_owner"] = payload.follow_up_owner.strip().lower() or None
    update: dict = {"$set": update_set}
    if payload.summary:
        update["$push"] = {"turns": {
            "ts": _now(), "kind": "note", "author": "admin",
            "text": payload.summary.strip(), "meta": {"closing_summary": True},
            "category": None, "severity": None, "ai_confidence": None,
            "attachments": [], "tags": [],
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
    # iter413cz+ — Filter on the new structured attributes so the AI
    # Ops Center can roll up by area / severity / tag / resolution.
    platform_area: Optional[str] = None,
    severity: Optional[str] = None,
    tag: Optional[str] = None,
    resolution_status: Optional[str] = None,
    follow_up_owner: Optional[str] = None,
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
    # iter413cz+ — apply the new structured-attribute filters.
    if platform_area:
        _validate_enum(platform_area, PLATFORM_AREAS, "platform_area")
        query["platform_area"] = platform_area
    if severity:
        _validate_enum(severity, SEVERITY_LEVELS, "severity")
        query["severity"] = severity
    if tag:
        # Tags are normalized lowercase at write time.
        query["tags"] = tag.strip().lower()
    if resolution_status:
        _validate_enum(resolution_status, RESOLUTION_STATES, "resolution_status")
        query["resolution_status"] = resolution_status
    if follow_up_owner:
        query["follow_up_owner"] = follow_up_owner.strip().lower()
    limit = max(1, min(200, int(limit or 50)))
    rows = await db.verification_sessions.find(
        query, {"_id": 0, "turns": 0},  # drop the heavy turns array
    ).sort("started_at", -1).to_list(limit)
    return {"rows": rows, "count": len(rows), "valid_types": sorted(VERIFICATION_TYPES)}
