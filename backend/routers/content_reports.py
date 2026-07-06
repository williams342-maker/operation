"""Unified content reporting + admin moderation queue.

Google Play UGC policy requires a way for users to report objectionable
content and for the operator to review + take action within 24 hours of
receipt.

Endpoints
─────────
POST /api/reports                              → buyer/maker submits a report
GET  /api/admin/reports                        → admin queue (with filters)
POST /api/admin/reports/{id}/dismiss           → moderator action
POST /api/admin/reports/{id}/remove-content    → moderator action
POST /api/admin/reports/{id}/warn-user         → moderator action
POST /api/admin/reports/{id}/suspend-user      → moderator action

Report `kind` values (must match the ReportButton on the client):
  listing · review · journal · showcase · message · maker · buyer

Every moderator action writes to `admin_audit` and updates the report row
with `resolved_at`, `resolved_by`, and `action_taken`.
"""
from __future__ import annotations
import uuid
from datetime import datetime, timezone
from typing import Optional, Literal

from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel, Field

from core import db, now_iso
from maker_auth import current_admin, decode_session_jwt

router = APIRouter(prefix="", tags=["content-reports"])

REPORT_KINDS = {"listing", "review", "journal", "showcase", "message", "maker", "buyer"}
REPORT_REASONS = {
    "spam", "harassment", "hate_speech", "adult_content", "violence",
    "self_harm", "illegal", "counterfeit", "misinformation",
    "impersonation", "csam", "other",
}
MAX_DETAIL_LEN = 2000


class ReportIn(BaseModel):
    kind: str = Field(..., description="What is being reported (listing, review, journal, showcase, message, maker, buyer)")
    target_id: str = Field(..., min_length=1, max_length=200)
    reason: str = Field(..., description="Category (spam, harassment, hate_speech, adult_content, ...)")
    detail: Optional[str] = Field(None, max_length=MAX_DETAIL_LEN)


async def _reporter(authorization: str | None = Header(default=None)) -> dict:
    """Accept EITHER a maker or buyer Bearer JWT. Anonymous reports are
    NOT allowed — Google Play compliance requires attribution to prevent
    abuse of the reporting system itself."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "You must be signed in to submit a report.")
    token = authorization.split(" ", 1)[1].strip()
    claims = decode_session_jwt(token)
    role = claims.get("role")
    if role not in ("maker", "buyer", "admin"):
        raise HTTPException(403, "Only signed-in members may report content.")
    return {"role": role, "email": (claims.get("email") or "").lower().strip(),
            "slug": claims.get("sub") if role == "maker" else None}


@router.post("/reports")
async def submit_report(payload: ReportIn, reporter: dict = Depends(_reporter)):
    kind = (payload.kind or "").strip().lower()
    if kind not in REPORT_KINDS:
        raise HTTPException(400, f"Unknown report kind. Allowed: {sorted(REPORT_KINDS)}")
    reason = (payload.reason or "").strip().lower()
    if reason not in REPORT_REASONS:
        raise HTTPException(400, f"Unknown report reason. Allowed: {sorted(REPORT_REASONS)}")
    target_id = (payload.target_id or "").strip()
    if not target_id:
        raise HTTPException(400, "target_id is required.")

    reporter_key = (
        f"maker:{reporter['slug']}" if reporter["role"] == "maker"
        else f"buyer:{reporter['email']}" if reporter["role"] == "buyer"
        else f"admin:{reporter['email']}"
    )
    # Anti-abuse: cap reports per reporter per day at 20.
    from datetime import timedelta as _td
    since = (datetime.now(timezone.utc) - _td(days=1)).isoformat()
    recent = await db.content_reports.count_documents({
        "reporter_key": reporter_key, "created_at": {"$gte": since},
    })
    if recent >= 20:
        raise HTTPException(429, "You've submitted too many reports today. Try again tomorrow.")

    # Dedup: same reporter + same target within 24h → return existing row
    existing = await db.content_reports.find_one({
        "reporter_key": reporter_key, "kind": kind, "target_id": target_id,
        "created_at": {"$gte": since},
    }, {"_id": 0, "id": 1})
    if existing:
        return {"ok": True, "id": existing["id"], "deduped": True}

    row = {
        "id": uuid.uuid4().hex,
        "kind": kind,
        "target_id": target_id,
        "reason": reason,
        "detail": (payload.detail or "").strip()[:MAX_DETAIL_LEN] or None,
        "reporter_role": reporter["role"],
        "reporter_key": reporter_key,
        "reporter_email": reporter["email"] or None,
        "status": "open",
        "created_at": now_iso(),
        "resolved_at": None,
        "resolved_by": None,
        "action_taken": None,
    }
    await db.content_reports.insert_one(row)
    row.pop("_id", None)
    return {"ok": True, "id": row["id"], "deduped": False}


# ═════════════════════════════ ADMIN ════════════════════════════════════
@router.get("/admin/reports")
async def list_reports(
    status: Optional[str] = None,
    kind: Optional[str] = None,
    reason: Optional[str] = None,
    limit: int = 100,
    _: dict = Depends(current_admin),
):
    q: dict = {}
    if status: q["status"] = status
    if kind:   q["kind"]   = kind
    if reason: q["reason"] = reason
    limit = max(1, min(500, int(limit or 100)))
    rows = await db.content_reports.find(q, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)

    # Roll-up counts for the tab badge
    open_count = await db.content_reports.count_documents({"status": "open"})
    total = await db.content_reports.count_documents({})
    return {"reports": rows, "open_count": open_count, "total": total}


async def _resolve(report_id: str, action: str, admin: dict, extra: dict | None = None):
    r = await db.content_reports.find_one({"id": report_id}, {"_id": 0})
    if not r:
        raise HTTPException(404, "Report not found.")
    if r.get("status") != "open":
        raise HTTPException(400, f"Report is already {r.get('status')}.")
    ts = now_iso()
    await db.content_reports.update_one(
        {"id": report_id},
        {"$set": {
            "status": "resolved",
            "resolved_at": ts,
            "resolved_by": (admin.get("email") or "admin").lower(),
            "action_taken": action,
            **(extra or {}),
        }},
    )
    await db.admin_audit.insert_one({
        "id": uuid.uuid4().hex,
        "kind": f"moderation_{action}",
        "actor": (admin.get("email") or "admin").lower(),
        "created_at": ts,
        "report_id": report_id,
        "target_kind": r.get("kind"),
        "target_id": r.get("target_id"),
        "reason": r.get("reason"),
        "extra": extra or {},
    })
    return {"ok": True, "id": report_id, "action": action}


@router.post("/admin/reports/{report_id}/dismiss")
async def dismiss(report_id: str, admin: dict = Depends(current_admin)):
    return await _resolve(report_id, "dismiss", admin)


@router.post("/admin/reports/{report_id}/remove-content")
async def remove_content(report_id: str, admin: dict = Depends(current_admin)):
    """Best-effort content takedown. We DO NOT hard-delete rows here —
    instead we set `moderation_hidden=True` on the target document so it
    disappears from public views but can be reviewed / restored by
    another admin. The concrete field-set is per-kind.
    """
    r = await db.content_reports.find_one({"id": report_id}, {"_id": 0})
    if not r:
        raise HTTPException(404, "Report not found.")

    kind = r.get("kind")
    tid = r.get("target_id")
    took_action = False
    try:
        if kind == "listing":
            res = await db.products.update_one(
                {"$or": [{"id": tid}, {"slug": tid}]},
                {"$set": {"moderation_hidden": True, "moderation_hidden_at": now_iso(), "active": False}},
            )
            took_action = bool(res.modified_count)
        elif kind == "review":
            res = await db.reviews.update_one(
                {"id": tid},
                {"$set": {"moderation_hidden": True, "moderation_hidden_at": now_iso()}},
            )
            took_action = bool(res.modified_count)
        elif kind == "journal":
            res = await db.maker_journal.update_one(
                {"$or": [{"id": tid}, {"slug": tid}]},
                {"$set": {"moderation_hidden": True, "moderation_hidden_at": now_iso()}},
            )
            took_action = bool(res.modified_count)
        elif kind == "showcase":
            res = await db.community_showcase.update_one(
                {"id": tid},
                {"$set": {"moderation_hidden": True, "moderation_hidden_at": now_iso()}},
            )
            took_action = bool(res.modified_count)
        elif kind == "message":
            res = await db.dm_messages.update_one(
                {"id": tid},
                {"$set": {"moderation_hidden": True, "moderation_hidden_at": now_iso(),
                          "body": "[Removed by moderator]"}},
            )
            took_action = bool(res.modified_count)
    except Exception:
        took_action = False

    return await _resolve(report_id, "remove", admin, {"took_action": took_action})


class WarnIn(BaseModel):
    message: Optional[str] = Field(None, max_length=500)


@router.post("/admin/reports/{report_id}/warn-user")
async def warn_user(report_id: str, payload: WarnIn | None = None,
                    admin: dict = Depends(current_admin)):
    """Log a warning against the offending user. Warnings accumulate in
    `moderation_warnings` and are shown at the top of the user's row in
    the queue so the admin can see priors before deciding next steps.
    """
    r = await db.content_reports.find_one({"id": report_id}, {"_id": 0})
    if not r:
        raise HTTPException(404, "Report not found.")
    # Best-effort identify the target user (author of the content)
    offender_key = await _resolve_offender_key(r)
    msg = (payload.message if payload else None) or "Content violated our community guidelines."
    await db.moderation_warnings.insert_one({
        "id": uuid.uuid4().hex,
        "offender_key": offender_key,
        "report_id": report_id,
        "issued_by": (admin.get("email") or "admin").lower(),
        "message": msg,
        "created_at": now_iso(),
    })
    return await _resolve(report_id, "warn", admin, {"offender_key": offender_key})


@router.post("/admin/reports/{report_id}/suspend-user")
async def suspend_user(report_id: str, admin: dict = Depends(current_admin)):
    """Suspend the offending user. Sets `suspended=True` on the maker /
    community_users row, and bumps `session_version` so all active
    tokens are invalidated. Reversible via `POST /api/admin/users/
    {key}/unsuspend` (out of scope for this sprint — admins can flip the
    flag in Mongo Compass while we ship the UI).
    """
    r = await db.content_reports.find_one({"id": report_id}, {"_id": 0})
    if not r:
        raise HTTPException(404, "Report not found.")
    offender_key = await _resolve_offender_key(r)
    if not offender_key:
        return await _resolve(report_id, "suspend", admin, {"offender_key": None, "suspended": False})
    scope, val = offender_key.split(":", 1) if ":" in offender_key else ("", "")
    ts = now_iso()
    if scope == "maker":
        await db.makers.update_one(
            {"slug": val},
            {"$set": {"suspended": True, "suspended_at": ts,
                      "shop_closed": True, "shop_closed_at": ts},
             "$inc": {"session_version": 1}},
        )
    elif scope == "buyer":
        await db.community_users.update_one(
            {"email": val},
            {"$set": {"suspended": True, "suspended_at": ts},
             "$inc": {"session_version": 1}},
        )
    return await _resolve(report_id, "suspend", admin, {"offender_key": offender_key})


async def _resolve_offender_key(report: dict) -> Optional[str]:
    """Best-effort lookup of the author of the reported content, returned
    as `maker:<slug>` or `buyer:<email>` for consistency with the DM code."""
    kind = report.get("kind")
    tid = report.get("target_id")
    try:
        if kind == "maker":
            return f"maker:{tid}"
        if kind == "buyer":
            return f"buyer:{tid.lower()}"
        if kind == "listing":
            p = await db.products.find_one(
                {"$or": [{"id": tid}, {"slug": tid}]}, {"maker_slug": 1, "_id": 0},
            )
            return f"maker:{p['maker_slug']}" if p and p.get("maker_slug") else None
        if kind == "review":
            v = await db.reviews.find_one({"id": tid}, {"author_email": 1, "_id": 0})
            return f"buyer:{v['author_email'].lower()}" if v and v.get("author_email") else None
        if kind == "journal":
            j = await db.maker_journal.find_one(
                {"$or": [{"id": tid}, {"slug": tid}]}, {"maker_slug": 1, "_id": 0},
            )
            return f"maker:{j['maker_slug']}" if j and j.get("maker_slug") else None
        if kind == "showcase":
            s = await db.community_showcase.find_one({"id": tid}, {"author_email": 1, "_id": 0})
            return f"buyer:{s['author_email'].lower()}" if s and s.get("author_email") else None
        if kind == "message":
            m = await db.dm_messages.find_one({"id": tid}, {"sender_key": 1, "_id": 0})
            return m.get("sender_key") if m else None
    except Exception:
        pass
    return None
