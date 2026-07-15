"""Policy versioning and acknowledgement lifecycle.

This router turns the existing static policy library into DB-backed policy
versions without invalidating the current public URLs. It intentionally uses
the same Mongo + admin_audit + maker_agreement_acceptances patterns already
present in the app.
"""
from __future__ import annotations

import difflib
import hashlib
import html
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Optional, Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from core import db, logger, now_iso
from maker_auth import current_admin, current_maker_slug

router = APIRouter()

POLICY_STATUSES = {"draft", "scheduled", "published", "superseded", "archived"}
MAKER_POLICY_SLUGS = {"maker-agreement", "fee-pricing", "prohibited-items", "community-guidelines"}
ADVANCE_NOTICE_DAYS = {
    "fee-pricing": int(os.environ.get("FEE_POLICY_NOTICE_DAYS", "30") or "30"),
}

SEED_POLICIES = [
    ("terms", "Terms of Service", "core", "2.6", "The foundational contract between every user and Crafters Market."),
    ("privacy", "Privacy Policy", "core", "3.4", "How Crafters Market collects, uses, shares, and protects personal information."),
    ("cookies", "Cookie Policy", "core", "3.0", "What cookies and similar technologies Crafters Market uses and how users can control them."),
    ("maker-agreement", "Maker Agreement", "core", "3.6", "The seller contract between each Maker and Crafters Market."),
    ("returns", "Returns & Refunds Policy", "core", "3.0", "How returns, refunds, cancellations, and marketplace assistance work."),
    ("shipping", "Shipping & Logistics Policy", "core", "2.0", "Shipping, tracking, customs, and delivery expectations."),
    ("prohibited-items", "Prohibited Items Policy", "core", "3.3", "What may not be sold on Crafters Market."),
    ("community-guidelines", "Community Guidelines", "core", "3.1", "Conduct standards for marketplace community spaces."),
    ("fee-pricing", "Fee & Pricing Policy", "operational", "1.3", "Crafters Market fees, payouts, subscriptions, and pricing rules."),
    ("ip-dmca", "Intellectual Property & DMCA Policy", "operational", "2.1", "How copyright, trademark, takedown, and repeat-infringer matters are handled."),
    ("accessibility", "Accessibility Statement", "trust", "1.0", "Crafters Market's accessibility commitment."),
    ("marketplace-promise", "Our Marketplace Promise", "trust", "1.0", "Plain-language values statement for buyers and makers."),
    ("privacy-at-a-glance", "Privacy at a Glance", "trust", "1.0", "Plain-English summary companion to the Privacy Policy."),
]


class DraftCreate(BaseModel):
    change_reason: Optional[str] = Field(default="", max_length=1000)


class DraftUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    content: Optional[str] = Field(default=None, min_length=1)
    approved_summary: Optional[str] = Field(default=None, max_length=5000)
    change_reason: Optional[str] = Field(default=None, max_length=1000)
    publication_at: Optional[str] = None
    effective_at: Optional[str] = None
    acknowledgement_required: Optional[bool] = None
    acknowledgement_deadline: Optional[str] = None
    email_enabled: Optional[bool] = None
    enforcement_behavior: Optional[str] = Field(default=None, max_length=80)


class ScheduleBody(BaseModel):
    publication_at: str
    effective_at: str
    acknowledgement_required: bool = False
    acknowledgement_deadline: Optional[str] = None
    email_enabled: bool = True
    override_insufficient_notice: bool = False
    override_reason: Optional[str] = Field(default=None, max_length=1000)


class PublishBody(BaseModel):
    effective_at: Optional[str] = None
    acknowledgement_required: bool = False
    acknowledgement_deadline: Optional[str] = None
    email_enabled: bool = True
    override_insufficient_notice: bool = False
    override_reason: Optional[str] = Field(default=None, max_length=1000)


class ReviewBody(BaseModel):
    notification_id: str


class AckBody(BaseModel):
    notification_id: str
    version_id: str
    accepted: bool


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_dt(value: Optional[str], *, field: str = "date") -> Optional[datetime]:
    if not value:
        return None
    try:
        v = value.replace("Z", "+00:00")
        dt = datetime.fromisoformat(v)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        raise HTTPException(400, f"Invalid {field}.")


def _iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.astimezone(timezone.utc).isoformat() if dt else None


def _sanitize_content(value: str) -> str:
    text = value or ""
    text = re.sub(r"(?is)<\s*(script|iframe|object|embed)[^>]*>.*?<\s*/\s*\1\s*>", "", text)
    text = re.sub(r"(?is)<\s*(script|iframe|object|embed)[^>]*\/?>", "", text)
    text = re.sub(r"\son\w+\s*=\s*(['\"]).*?\1", "", text)
    text = re.sub(r"(?i)(href|src)\s*=\s*(['\"])\s*javascript:[^'\"]*\2", r"\1=\"#\"", text)
    return text.strip()


def _hash_content(content: str) -> str:
    return hashlib.sha256((content or "").encode("utf-8")).hexdigest()

def _clean_doc(doc):
    if isinstance(doc, dict):
        return {k: _clean_doc(v) for k, v in doc.items() if k != "_id"}
    if isinstance(doc, list):
        return [_clean_doc(v) for v in doc]
    return doc


def _version_key(v: str) -> list[int]:
    nums = []
    for p in re.split(r"[^0-9]+", str(v)):
        if p:
            nums.append(int(p))
    return nums or [0]


def _next_version(current: str) -> str:
    parts = _version_key(current)
    if len(parts) == 1:
        return f"{parts[0] + 1}.0"
    parts[-1] += 1
    return ".".join(str(p) for p in parts)


def _diff(old: str, new: str) -> dict:
    old_lines = (old or "").splitlines()
    new_lines = (new or "").splitlines()
    html_diff = difflib.HtmlDiff(wrapcolumn=96).make_table(
        old_lines, new_lines, fromdesc="Current", todesc="Proposed", context=True, numlines=3,
    )
    opcodes = difflib.SequenceMatcher(None, old_lines, new_lines).get_opcodes()
    added = removed = changed = equal = 0
    sections = []
    for tag, i1, i2, j1, j2 in opcodes:
        if tag == "equal":
            equal += i2 - i1
            continue
        if tag == "insert":
            added += j2 - j1
        elif tag == "delete":
            removed += i2 - i1
        elif tag == "replace":
            changed += max(i2 - i1, j2 - j1)
        sections.append({
            "type": tag,
            "old": old_lines[i1:i2],
            "new": new_lines[j1:j2],
        })
    return {
        "summary": {"added": added, "removed": removed, "changed": changed, "unchanged": equal},
        "sections": sections[:80],
        "html": html_diff,
    }


def _notice_state(policy_slug: str, notice_starts_at: Optional[str], effective_at: Optional[str]) -> dict:
    required = ADVANCE_NOTICE_DAYS.get(policy_slug, 0)
    start = _parse_dt(notice_starts_at, field="notice_starts_at") if notice_starts_at else None
    eff = _parse_dt(effective_at, field="effective_at") if effective_at else None
    if not required or not start or not eff:
        return {"required_days": required, "days_remaining": 0, "satisfied": True, "in_effect": bool(eff and eff <= _utc_now())}
    delta_days = max((eff.date() - _utc_now().date()).days, 0)
    notice_days = max((eff.date() - start.date()).days, 0)
    return {
        "required_days": required,
        "notice_days": notice_days,
        "days_remaining": delta_days,
        "satisfied": notice_days >= required,
        "in_effect": eff <= _utc_now(),
    }


async def _audit(kind: str, admin: Optional[dict], policy_id: str, version_id: Optional[str] = None, **detail) -> None:
    await db.admin_audit.insert_one({
        "id": str(uuid.uuid4()),
        "kind": kind,
        "policy_id": policy_id,
        "version_id": version_id,
        "admin_email": (admin or {}).get("email"),
        "created_at": now_iso(),
        "detail": detail,
    })


async def ensure_policy_indexes() -> None:
    await db.policies.create_index("slug", unique=True)
    await db.policy_versions.create_index([("policy_id", 1), ("version_number", 1)], unique=True)
    await db.policy_versions.create_index([("policy_id", 1), ("status", 1)])
    await db.policy_versions.create_index("effective_at")
    await db.policy_notifications.create_index([("maker_slug", 1), ("version_id", 1)], unique=True)
    await db.policy_notifications.create_index([("version_id", 1), ("status", 1)])
    await db.policy_acknowledgements.create_index([("maker_slug", 1), ("version_id", 1)], unique=True)
    await db.policy_ai_log.create_index("created_at")
    await seed_initial_policies()


async def seed_initial_policies() -> dict:
    created = 0
    for slug, title, category, version, description in SEED_POLICIES:
        policy_id = slug
        policy_doc = {
            "id": policy_id,
            "slug": slug,
            "title": title,
            "category": category,
            "description": description,
            "applies_to": "makers" if slug in MAKER_POLICY_SLUGS else "all",
            "created_at": now_iso(),
            "updated_at": now_iso(),
        }
        await db.policies.update_one({"slug": slug}, {"$setOnInsert": policy_doc}, upsert=True)
        existing = await db.policy_versions.find_one({"policy_id": policy_id, "status": "published"}, {"_id": 0, "id": 1})
        if not existing:
            content = (
                f"<h2>{html.escape(title)}</h2>\n"
                f"<p>{html.escape(description)}</p>\n"
                "<p>This initial database version preserves the currently published public policy page. "
                "The canonical public wording remains available at the existing policy URL.</p>"
            )
            doc = {
                "id": str(uuid.uuid4()),
                "policy_id": policy_id,
                "policy_slug": slug,
                "version_number": version,
                "title": title,
                "content": content,
                "content_hash": _hash_content(content),
                "change_summary": "Initial published version migrated from the existing policy module.",
                "ai_summary": "",
                "approved_summary": "Initial published version migrated from the existing policy module.",
                "change_reason": "Initial migration",
                "status": "published",
                "published_at": "2026-06-30T00:00:00+00:00",
                "notice_starts_at": "2026-06-30T00:00:00+00:00",
                "effective_at": "2026-06-30T00:00:00+00:00",
                "acknowledgement_required": False,
                "acknowledgement_deadline": None,
                "notification_sent_at": None,
                "created_by": "system",
                "updated_by": "system",
                "created_at": now_iso(),
                "updated_at": now_iso(),
            }
            await db.policy_versions.insert_one(doc)
            created += 1
    return {"ok": True, "created": created}


async def _policy_or_404(slug: str) -> dict:
    p = await db.policies.find_one({"slug": slug}, {"_id": 0})
    if not p:
        raise HTTPException(404, "Policy not found.")
    return p


async def _version_or_404(version_id: str) -> dict:
    v = await db.policy_versions.find_one({"id": version_id}, {"_id": 0})
    if not v:
        raise HTTPException(404, "Policy version not found.")
    return v


async def _current_version(policy_id: str) -> Optional[dict]:
    return await db.policy_versions.find_one(
        {"policy_id": policy_id, "status": "published"},
        {"_id": 0},
        sort=[("effective_at", -1), ("published_at", -1)],
    )


async def _notification_payload(policy: dict, version: dict) -> dict:
    return {
        "policy_id": policy["id"],
        "policy_slug": policy["slug"],
        "policy_title": version.get("title") or policy["title"],
        "version_id": version["id"],
        "version_number": version["version_number"],
        "published_at": version.get("published_at"),
        "effective_at": version.get("effective_at"),
        "summary": version.get("approved_summary") or version.get("ai_summary") or version.get("change_summary") or "",
        "acknowledgement_required": bool(version.get("acknowledgement_required")),
        "acknowledgement_deadline": version.get("acknowledgement_deadline"),
        "url": f"/policies/{policy['slug']}",
        "compare_url": f"/policies/{policy['slug']}/versions/{version['version_number']}",
    }


async def notify_makers_for_version(policy: dict, version: dict, *, email_enabled: bool = True, admin: Optional[dict] = None) -> dict:
    makers = await db.makers.find({}, {"_id": 0, "slug": 1, "email": 1, "name": 1}).to_list(10000)
    payload = await _notification_payload(policy, version)
    created = emailed = 0
    for maker in makers:
        slug = maker.get("slug")
        if not slug:
            continue
        row = {
            "id": str(uuid.uuid4()),
            "maker_slug": slug,
            "maker_email": maker.get("email"),
            "policy_id": policy["id"],
            "policy_slug": policy["slug"],
            "version_id": version["id"],
            "version_number": version["version_number"],
            "payload": payload,
            "status": "pending_ack" if version.get("acknowledgement_required") else "unread",
            "delivery": {"dashboard": "created", "email": "skipped"},
            "created_at": now_iso(),
            "updated_at": now_iso(),
            "reviewed_at": None,
            "acknowledged_at": None,
        }
        try:
            await db.policy_notifications.insert_one(row)
            created += 1
        except Exception:
            continue
        if email_enabled and maker.get("email"):
            try:
                from email_service import send_policy_update_notice
                await send_policy_update_notice(
                    maker_email=maker["email"],
                    maker_name=maker.get("name") or slug,
                    notice=payload,
                )
                emailed += 1
                await db.policy_notifications.update_one(
                    {"id": row["id"]},
                    {"$set": {"delivery.email": "sent", "email_sent_at": now_iso()}},
                )
            except Exception as e:
                logger.warning("[policy] email failed maker=%s version=%s: %s", slug, version["id"], e)
                await db.policy_notifications.update_one(
                    {"id": row["id"]},
                    {"$set": {"delivery.email": "failed", "delivery.email_error": str(e)[:240]}},
                )
    await db.policy_versions.update_one({"id": version["id"]}, {"$set": {"notification_sent_at": now_iso()}})
    await _audit("policy_notifications_sent", admin, policy["id"], version["id"], created=created, emailed=emailed)
    return {"created": created, "emailed": emailed}


async def publish_due_versions(now: Optional[datetime] = None) -> dict:
    now = now or _utc_now()
    due = await db.policy_versions.find(
        {"status": "scheduled", "effective_at": {"$lte": _iso(now)}},
        {"_id": 0},
    ).to_list(1000)
    published = 0
    for v in due:
        if v.get("published_transition_at"):
            continue
        policy = await db.policies.find_one({"id": v["policy_id"]}, {"_id": 0})
        if not policy:
            continue
        prev = await _current_version(v["policy_id"])
        await db.policy_versions.update_many(
            {"policy_id": v["policy_id"], "status": "published", "id": {"$ne": v["id"]}},
            {"$set": {"status": "superseded", "superseded_at": now_iso(), "updated_at": now_iso()}},
        )
        await db.policy_versions.update_one(
            {"id": v["id"], "status": "scheduled"},
            {"$set": {"status": "published", "published_transition_at": now_iso(), "updated_at": now_iso()}},
        )
        published += 1
        await _audit("policy_version_published", {"email": "scheduler"}, v["policy_id"], v["id"], previous_version_id=(prev or {}).get("id"))
    return {"published": published}


def _enforce_notice(policy_slug: str, publication_at: datetime, effective_at: datetime, override: bool, reason: Optional[str]) -> None:
    required = ADVANCE_NOTICE_DAYS.get(policy_slug, 0)
    if not required:
        return
    notice_days = max((effective_at.date() - publication_at.date()).days, 0)
    if notice_days >= required:
        return
    if not override:
        raise HTTPException(400, f"{policy_slug} requires at least {required} days notice.")
    if not (reason or "").strip():
        raise HTTPException(400, "Override reason is required for insufficient notice.")


@router.get("/admin/policies")
async def admin_list_policies(_: dict = Depends(current_admin)):
    await ensure_policy_indexes()
    policies = await db.policies.find({}, {"_id": 0}).sort("title", 1).to_list(200)
    out = []
    for p in policies:
        current = await _current_version(p["id"])
        scheduled = await db.policy_versions.find_one(
            {"policy_id": p["id"], "status": "scheduled"}, {"_id": 0}, sort=[("effective_at", 1)],
        )
        ack_total = ack_done = 0
        if scheduled and scheduled.get("acknowledgement_required"):
            ack_total = await db.policy_notifications.count_documents({"version_id": scheduled["id"]})
            ack_done = await db.policy_acknowledgements.count_documents({"version_id": scheduled["id"]})
        elif current and current.get("acknowledgement_required"):
            ack_total = await db.policy_notifications.count_documents({"version_id": current["id"]})
            ack_done = await db.policy_acknowledgements.count_documents({"version_id": current["id"]})
        out.append({
            **p,
            "current_version": current,
            "scheduled_version": scheduled,
            "notice": _notice_state(p["slug"], (scheduled or current or {}).get("notice_starts_at"), (scheduled or current or {}).get("effective_at")),
            "acknowledgement": {"required": bool((scheduled or current or {}).get("acknowledgement_required")), "total": ack_total, "acknowledged": ack_done},
            "last_updated": (scheduled or current or p).get("updated_at"),
        })
    return {"policies": out}


@router.get("/admin/policies/{slug}")
async def admin_policy_detail(slug: str, _: dict = Depends(current_admin)):
    await ensure_policy_indexes()
    policy = await _policy_or_404(slug)
    versions = await db.policy_versions.find({"policy_id": policy["id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)
    audits = await db.admin_audit.find({"policy_id": policy["id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return {"policy": policy, "versions": versions, "audit": audits}


@router.post("/admin/policies/{slug}/draft", status_code=201)
async def create_draft(slug: str, body: DraftCreate, admin: dict = Depends(current_admin)):
    policy = await _policy_or_404(slug)
    current = await _current_version(policy["id"])
    if not current:
        raise HTTPException(409, "Policy has no current version to draft from.")
    if await db.policy_versions.find_one({"policy_id": policy["id"], "status": "draft"}, {"_id": 0, "id": 1}):
        raise HTTPException(409, "A draft already exists for this policy.")
    doc = {
        **{k: current.get(k) for k in ("title", "content")},
        "id": str(uuid.uuid4()),
        "policy_id": policy["id"],
        "policy_slug": policy["slug"],
        "version_number": _next_version(current.get("version_number") or "1.0"),
        "change_summary": "",
        "ai_summary": "",
        "approved_summary": "",
        "change_reason": body.change_reason or "",
        "status": "draft",
        "published_at": None,
        "notice_starts_at": None,
        "effective_at": None,
        "acknowledgement_required": False,
        "acknowledgement_deadline": None,
        "email_enabled": True,
        "created_by": admin.get("email"),
        "updated_by": admin.get("email"),
        "created_at": now_iso(),
        "updated_at": now_iso(),
        "content_hash": _hash_content(current.get("content") or ""),
        "base_version_id": current.get("id"),
    }
    await db.policy_versions.insert_one(doc)
    await _audit("policy_draft_created", admin, policy["id"], doc["id"], base_version_id=current.get("id"))
    return {"version": _clean_doc(doc)}


@router.patch("/admin/policies/versions/{version_id}")
async def update_draft(version_id: str, body: DraftUpdate, admin: dict = Depends(current_admin)):
    v = await _version_or_404(version_id)
    if v["status"] not in {"draft", "scheduled"}:
        raise HTTPException(409, "Only draft or scheduled versions can be edited.")
    patch = {k: val for k, val in body.model_dump(exclude_unset=True).items() if val is not None}
    if "content" in patch:
        patch["content"] = _sanitize_content(patch["content"])
        patch["content_hash"] = _hash_content(patch["content"])
    patch["updated_by"] = admin.get("email")
    patch["updated_at"] = now_iso()
    await db.policy_versions.update_one({"id": version_id}, {"$set": patch})
    if "approved_summary" in patch:
        await _audit("policy_summary_edited", admin, v["policy_id"], version_id)
    else:
        await _audit("policy_draft_edited", admin, v["policy_id"], version_id, fields=list(patch.keys()))
    return {"version": await _version_or_404(version_id)}


@router.get("/admin/policies/versions/{version_id}/diff")
async def version_diff(version_id: str, admin: dict = Depends(current_admin)):
    v = await _version_or_404(version_id)
    current = await _current_version(v["policy_id"]) or {}
    d = _diff(current.get("content") or "", v.get("content") or "")
    await _audit("policy_diff_generated", admin, v["policy_id"], version_id, summary=d["summary"])
    return {"diff": d, "from_version": current, "to_version": v}


@router.post("/admin/policies/versions/{version_id}/ai-summary")
async def generate_ai_summary(version_id: str, admin: dict = Depends(current_admin)):
    v = await _version_or_404(version_id)
    current = await _current_version(v["policy_id"]) or {}
    d = _diff(current.get("content") or "", v.get("content") or "")
    prompt = (
        "Summarize material policy changes for Crafters Market makers in plain language. "
        "Do not give legal conclusions or invent changes. Mention fee, payout, refund, data use, "
        "account suspension, and seller obligation changes prominently when present.\n\n"
        f"Diff summary: {d['summary']}\nChanged sections: {d['sections'][:20]}"
    )
    summary = ""
    status = "failed"
    error = ""
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
        key = os.environ.get("EMERGENT_LLM_KEY", "")
        if not key:
            raise RuntimeError("EMERGENT_LLM_KEY not configured")
        chat = LlmChat(api_key=key, session_id=f"policy-{version_id}", system_message="You write concise, accurate marketplace policy change summaries.").with_model("anthropic", "claude-haiku-4-5")
        raw = await chat.send_message(UserMessage(text=prompt[:12000]))
        summary = str(raw).strip()[:5000]
        status = "ok"
    except Exception as e:
        error = str(e)[:500]
        summary = ""
        logger.warning("[policy] AI summary failed version=%s: %s", version_id, e)
    await db.policy_ai_log.insert_one({"id": str(uuid.uuid4()), "version_id": version_id, "policy_id": v["policy_id"], "status": status, "error": error, "created_by": admin.get("email"), "created_at": now_iso()})
    if summary:
        await db.policy_versions.update_one({"id": version_id}, {"$set": {"ai_summary": summary, "updated_at": now_iso()}})
    await _audit("policy_ai_summary_generated" if summary else "policy_ai_summary_failed", admin, v["policy_id"], version_id, error=error)
    return {"ok": bool(summary), "ai_summary": summary, "error": error}


@router.post("/admin/policies/versions/{version_id}/schedule")
async def schedule_version(version_id: str, body: ScheduleBody, bg: BackgroundTasks, admin: dict = Depends(current_admin)):
    v = await _version_or_404(version_id)
    if v["status"] not in {"draft", "scheduled"}:
        raise HTTPException(409, "Only draft versions can be scheduled.")
    pub = _parse_dt(body.publication_at, field="publication_at")
    eff = _parse_dt(body.effective_at, field="effective_at")
    if eff < pub:
        raise HTTPException(400, "Effective date cannot be before publication date.")
    _enforce_notice(v["policy_slug"], pub, eff, body.override_insufficient_notice, body.override_reason)
    patch = {
        "status": "scheduled",
        "published_at": _iso(pub),
        "notice_starts_at": _iso(pub),
        "effective_at": _iso(eff),
        "acknowledgement_required": body.acknowledgement_required,
        "acknowledgement_deadline": body.acknowledgement_deadline,
        "email_enabled": body.email_enabled,
        "updated_by": admin.get("email"),
        "updated_at": now_iso(),
    }
    await db.policy_versions.update_one({"id": version_id}, {"$set": patch})
    if body.override_insufficient_notice:
        await _audit("policy_insufficient_notice_override", admin, v["policy_id"], version_id, reason=body.override_reason)
    await _audit("policy_version_scheduled", admin, v["policy_id"], version_id, publication_at=_iso(pub), effective_at=_iso(eff))
    policy = await _policy_or_404(v["policy_slug"])
    fresh = await _version_or_404(version_id)
    bg.add_task(notify_makers_for_version, policy, fresh, email_enabled=body.email_enabled, admin=admin)
    return {"version": fresh}


@router.post("/admin/policies/versions/{version_id}/publish")
async def publish_now(version_id: str, body: PublishBody, bg: BackgroundTasks, admin: dict = Depends(current_admin)):
    v = await _version_or_404(version_id)
    if v["status"] not in {"draft", "scheduled"}:
        raise HTTPException(409, "Only draft or scheduled versions can be published.")
    now = _utc_now()
    eff = _parse_dt(body.effective_at, field="effective_at") or now
    _enforce_notice(v["policy_slug"], now, eff, body.override_insufficient_notice, body.override_reason)
    await db.policy_versions.update_many(
        {"policy_id": v["policy_id"], "status": "published", "id": {"$ne": v["id"]}},
        {"$set": {"status": "superseded", "superseded_at": now_iso(), "updated_at": now_iso()}},
    )
    patch = {
        "status": "published" if eff <= now else "scheduled",
        "published_at": now_iso(),
        "notice_starts_at": now_iso(),
        "effective_at": _iso(eff),
        "acknowledgement_required": body.acknowledgement_required,
        "acknowledgement_deadline": body.acknowledgement_deadline,
        "email_enabled": body.email_enabled,
        "updated_by": admin.get("email"),
        "updated_at": now_iso(),
    }
    await db.policy_versions.update_one({"id": version_id}, {"$set": patch})
    if body.override_insufficient_notice:
        await _audit("policy_insufficient_notice_override", admin, v["policy_id"], version_id, reason=body.override_reason)
    await _audit("policy_version_published", admin, v["policy_id"], version_id)
    policy = await _policy_or_404(v["policy_slug"])
    fresh = await _version_or_404(version_id)
    bg.add_task(notify_makers_for_version, policy, fresh, email_enabled=body.email_enabled, admin=admin)
    return {"version": fresh}


@router.post("/admin/policies/versions/{version_id}/cancel")
async def cancel_schedule(version_id: str, admin: dict = Depends(current_admin)):
    v = await _version_or_404(version_id)
    if v["status"] != "scheduled":
        raise HTTPException(409, "Only scheduled versions can be cancelled.")
    await db.policy_versions.update_one({"id": version_id}, {"$set": {"status": "draft", "updated_at": now_iso(), "updated_by": admin.get("email")}})
    await _audit("policy_schedule_changed", admin, v["policy_id"], version_id, action="cancel")
    return {"version": await _version_or_404(version_id)}


@router.post("/admin/policies/versions/{version_id}/archive")
async def archive_version(version_id: str, admin: dict = Depends(current_admin)):
    v = await _version_or_404(version_id)
    if v["status"] not in {"draft", "scheduled"}:
        raise HTTPException(409, "Only unused drafts or schedules can be archived.")
    await db.policy_versions.update_one({"id": version_id}, {"$set": {"status": "archived", "updated_at": now_iso(), "updated_by": admin.get("email")}})
    await _audit("policy_version_archived", admin, v["policy_id"], version_id)
    return {"version": await _version_or_404(version_id)}


@router.get("/admin/policies/versions/{version_id}/notification-preview")
async def notification_preview(version_id: str, _: dict = Depends(current_admin)):
    v = await _version_or_404(version_id)
    policy = await _policy_or_404(v["policy_slug"])
    return {"notification": await _notification_payload(policy, v)}


@router.get("/admin/policies/versions/{version_id}/acknowledgements")
async def acknowledgement_stats(version_id: str, _: dict = Depends(current_admin)):
    total = await db.policy_notifications.count_documents({"version_id": version_id})
    acknowledged = await db.policy_acknowledgements.count_documents({"version_id": version_id})
    reviewed = await db.policy_notifications.count_documents({"version_id": version_id, "reviewed_at": {"$ne": None}})
    rows = await db.policy_acknowledgements.find({"version_id": version_id}, {"_id": 0}).sort("accepted_at", -1).to_list(1000)
    return {"total": total, "acknowledged": acknowledged, "reviewed": reviewed, "percent": round(acknowledged / total * 100, 1) if total else 0, "acknowledgements": rows}


@router.get("/maker/policy-notices")
async def maker_policy_notices(slug: str = Depends(current_maker_slug)):
    await ensure_policy_indexes()
    rows = await db.policy_notifications.find(
        {"maker_slug": slug, "status": {"$in": ["unread", "pending_ack"]}},
        {"_id": 0},
    ).sort("created_at", -1).to_list(50)
    for r in rows:
        p = r.get("payload") or {}
        p["notice"] = _notice_state(r.get("policy_slug") or p.get("policy_slug"), p.get("published_at"), p.get("effective_at"))
    history = await db.policy_acknowledgements.find({"maker_slug": slug}, {"_id": 0}).sort("accepted_at", -1).to_list(100)
    return {"notices": rows, "acknowledgements": history}


@router.post("/maker/policy-notices/review")
async def maker_review_notice(body: ReviewBody, slug: str = Depends(current_maker_slug)):
    row = await db.policy_notifications.find_one({"id": body.notification_id, "maker_slug": slug}, {"_id": 0})
    if not row:
        raise HTTPException(404, "Policy notice not found.")
    if row.get("payload", {}).get("acknowledgement_required"):
        raise HTTPException(400, "This policy update requires acknowledgement.")
    await db.policy_notifications.update_one({"id": body.notification_id}, {"$set": {"status": "reviewed", "reviewed_at": now_iso(), "updated_at": now_iso()}})
    return {"ok": True}


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else ""


@router.post("/maker/policy-notices/acknowledge", status_code=201)
async def maker_acknowledge_notice(body: AckBody, request: Request, slug: str = Depends(current_maker_slug)):
    if not body.accepted:
        raise HTTPException(400, "Affirmative acknowledgement is required.")
    row = await db.policy_notifications.find_one({"id": body.notification_id, "maker_slug": slug, "version_id": body.version_id}, {"_id": 0})
    if not row:
        raise HTTPException(404, "Policy notice not found.")
    version = await _version_or_404(body.version_id)
    if version["status"] not in {"published", "scheduled"}:
        raise HTTPException(409, "This policy version is not currently available for acknowledgement.")
    if not version.get("acknowledgement_required"):
        raise HTTPException(400, "This policy version does not require acknowledgement.")
    maker = await db.makers.find_one({"slug": slug}, {"_id": 0, "email": 1, "name": 1}) or {}
    ack = {
        "id": str(uuid.uuid4()),
        "maker_slug": slug,
        "maker_email": maker.get("email"),
        "policy_id": version["policy_id"],
        "policy_slug": version["policy_slug"],
        "version_id": version["id"],
        "version_number": version["version_number"],
        "accepted_at": now_iso(),
        "ip": _client_ip(request)[:64],
        "user_agent": (request.headers.get("user-agent") or "")[:300],
        "content_hash": version.get("content_hash") or _hash_content(version.get("content") or ""),
        "acceptance_text": f"I have read and agree to {version.get('title')} v{version.get('version_number')}.",
    }
    try:
        await db.policy_acknowledgements.insert_one(ack)
    except Exception:
        existing = await db.policy_acknowledgements.find_one({"maker_slug": slug, "version_id": version["id"]}, {"_id": 0})
        ack = existing or ack
    await db.policy_notifications.update_one({"id": body.notification_id}, {"$set": {"status": "acknowledged", "acknowledged_at": ack.get("accepted_at"), "reviewed_at": ack.get("accepted_at"), "updated_at": now_iso()}})
    if version["policy_slug"] == "maker-agreement":
        await db.maker_agreement_acceptances.insert_one({
            "id": str(uuid.uuid4()),
            "maker_slug": slug,
            "maker_email": maker.get("email"),
            "version": version["version_number"],
            "policy_version_id": version["id"],
            "accepted_at": ack["accepted_at"],
            "ip": ack["ip"],
            "user_agent": ack["user_agent"],
            "content_hash": ack["content_hash"],
        })
    return {"ok": True, "acknowledgement": _clean_doc(ack)}


@router.get("/policies/{slug}")
async def public_policy(slug: str):
    await ensure_policy_indexes()
    policy = await _policy_or_404(slug)
    current = await _current_version(policy["id"])
    upcoming = await db.policy_versions.find_one(
        {"policy_id": policy["id"], "status": "scheduled", "published_at": {"$lte": now_iso()}},
        {"_id": 0},
        sort=[("effective_at", 1)],
    )
    history = await db.policy_versions.find(
        {"policy_id": policy["id"], "status": {"$in": ["published", "superseded"]}},
        {"_id": 0, "content": 0},
    ).sort("effective_at", -1).to_list(50)
    return {"policy": policy, "current": current, "upcoming": upcoming, "history": history}


@router.get("/policies/{slug}/versions/{version_number}")
async def public_policy_version(slug: str, version_number: str):
    await ensure_policy_indexes()
    policy = await _policy_or_404(slug)
    v = await db.policy_versions.find_one(
        {"policy_id": policy["id"], "version_number": version_number, "status": {"$in": ["published", "superseded", "scheduled"]}},
        {"_id": 0},
    )
    if not v:
        raise HTTPException(404, "Public policy version not found.")
    if v["status"] == "scheduled" and (v.get("published_at") or "") > now_iso():
        raise HTTPException(404, "Public policy version not found.")
    return {"policy": policy, "version": v, "is_current": v.get("status") == "published", "canonical": f"/policies/{slug}"}
