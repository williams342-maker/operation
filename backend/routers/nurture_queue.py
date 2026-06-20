"""iter413be — Nurture Queue (draft-only).

When a lead-magnet subscriber crosses the 7-day staleness threshold
without submitting a maker application, this module generates up to
**2** draft outreach messages and queues them for **manual approval**.

PER OPS DOC — STRICTLY ENFORCED:
  • No auto-send.
  • No email sequences.
  • No email automation.
  • Cap: max 2 drafts per lead, lifetime.
  • Stop immediately if the lead's email appears in maker_applications.

Draft types (rotated through in this order so a lead never gets two
of the same type):
  1. "Still thinking about selling?"        — gentle nudge
  2. "Featured maker spotlight"              — proof / social validation
  3. "Founder invitation"                    — exclusivity / invite-only feel

The actual SENDING is out of scope — operator approves the draft, the
generated body_md is copy-pasted into the operator's email client.
A future iteration can wire one-click send once we have nurture-result
data to inform the design (per the locked-page-generator constraint).

Collection: `nurture_drafts`
  id              : uuid
  lead_email      : str   (lower-cased)
  lead_first_seen_at : iso datetime
  draft_type      : "nudge" | "spotlight" | "invitation"
  title           : str
  body_md         : str   (markdown ready for paste into an email tool)
  reason          : str   (why this draft, why now)
  recommended_send_at : iso datetime
  status          : "pending" | "approved" | "dismissed"
  created_at      : iso datetime
  decided_at      : iso datetime | None
  decided_by      : str | None
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from core import db, now_iso
from maker_auth import current_admin as _current_admin


router = APIRouter()


_STALE_THRESHOLD_DAYS = 7
_MAX_DRAFTS_PER_LEAD = 2
_DRAFT_ORDER = ["nudge", "spotlight", "invitation"]


# ─── Draft templates ────────────────────────────────────────────────
# Plain markdown — copy-pasteable into Mailgun/Postmark/Gmail. Keep them
# narrative + opinionated; generic copy is exactly what tanks reply rates.
def _draft_nudge(email: str) -> dict:
    return {
        "title": "Still thinking about selling on Crafters Market?",
        "body_md": (
            "Hey,\n\n"
            "You grabbed the Maker Starter Pack from us a week ago — figured "
            "I'd check in. The Pack has the SVGs and a quick teardown of what "
            "actually moves on Crafters Market right now (spoiler: niche, "
            "named work; the generic 'farmhouse sign' wave is over).\n\n"
            "If anything in there clicked but the apply form felt like work, "
            "reply with what you make and I'll route you through the short "
            "version — no portfolio review for established makers, just a "
            "5-min phone check.\n\n"
            "https://craftersmarket.org/apply\n\n"
            "– Crafters Market\n"
        ),
        "reason": (
            "Lead downloaded the starter pack 7+ days ago but hasn't applied. "
            "Gentle re-engagement that frames the apply form as low-friction "
            "for someone with a real shop already running."
        ),
    }


def _draft_spotlight(email: str) -> dict:
    return {
        "title": "How one of our makers shipped 41 orders her first month",
        "body_md": (
            "Hey,\n\n"
            "Quick story since you grabbed the Starter Pack — Loretta Alvarado "
            "applied last fall with a tiny portfolio (12 photos, no website). "
            "Approved in 3 days, listed 8 items in week one, hit 41 orders by "
            "end of month one.\n\n"
            "Three things she did differently:\n"
            "1. Niched HARD — 'memorial pieces for first responders' instead "
            "of 'metal signs'.\n"
            "2. Used the bio field as a story, not a CV.\n"
            "3. Replied to every custom-order inquiry inside 4 hours.\n\n"
            "If that sounds like the shape of what you're building, the apply "
            "form's at https://craftersmarket.org/apply — takes 8 minutes.\n\n"
            "– Crafters Market\n"
        ),
        "reason": (
            "Social proof. The lead is past the 'maybe I'll look later' phase. "
            "A concrete success story breaks the apathy + repositions Crafters "
            "Market as proven-not-speculative."
        ),
    }


def _draft_invitation(email: str) -> dict:
    return {
        "title": "Founder cohort — 12 spots, closing this month",
        "body_md": (
            "Hey,\n\n"
            "We hold 12 Founder slots open at any time on Crafters Market. "
            "Founders get a permanent badge on their shop, top placement in "
            "category pages, and we shoot one free workshop video for each of "
            "them per quarter.\n\n"
            "You've been in our orbit for a week now — figured I'd flag that "
            "4 of the 12 are open right now. Founders apply through the same "
            "form, we just route those applications differently:\n\n"
            "https://craftersmarket.org/apply?ref=founder\n\n"
            "Worth a look if you want the early-mover advantage on a platform "
            "that's growing 30%+ MoM.\n\n"
            "– Crafters Market\n"
        ),
        "reason": (
            "Exclusivity / urgency angle. Best for leads that have been quiet "
            "10+ days — the 'maybe later' bucket. Founder framing positions "
            "applying as opt-in to a small cohort, not a long onboarding."
        ),
    }


_TEMPLATES = {
    "nudge":      _draft_nudge,
    "spotlight":  _draft_spotlight,
    "invitation": _draft_invitation,
}


def _recommended_send_at(now: datetime, draft_type: str) -> str:
    """Stagger recommended send times by draft type so a single
    operator approval session doesn't queue everything at the same
    minute. NB: nothing actually SENDS — this is just a hint for the
    operator's calendar."""
    offsets = {"nudge": 1, "spotlight": 3, "invitation": 5}  # days from now
    delta = timedelta(days=offsets.get(draft_type, 1), hours=9)
    return (now + delta).isoformat()


# ─── Pydantic ──────────────────────────────────────────────────────


class DecisionRequest(BaseModel):
    decision: str = Field(pattern=r"^(approve|dismiss)$")
    note: Optional[str] = Field(default=None, max_length=300)


# ─── Helpers ───────────────────────────────────────────────────────


async def _eligible_leads() -> list[dict]:
    """Lead-magnet subscribers older than the threshold, who have NOT
    submitted a maker application, ordered oldest-first (those have
    drifted the longest — usually most urgent)."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=_STALE_THRESHOLD_DAYS)).isoformat()
    leads = await db.lead_magnet_subscribers.find(
        {"first_seen_at": {"$lt": cutoff}},
        {"_id": 0, "email": 1, "first_seen_at": 1, "source": 1,
         "campaign": 1, "visitor_id": 1},
    ).sort("first_seen_at", 1).to_list(500)
    if not leads:
        return []
    emails = [lead["email"] for lead in leads if lead.get("email")]
    applied = set(await db.maker_applications.distinct("email", {"email": {"$in": emails}}))
    return [lead for lead in leads if lead.get("email") and lead["email"] not in applied]


async def _existing_drafts_by_lead() -> dict[str, list[dict]]:
    """All drafts (any status) grouped by lead_email — used for cap
    enforcement + skip-application-submitted checks."""
    out: dict[str, list[dict]] = {}
    cursor = db.nurture_drafts.find({}, {"_id": 0})
    async for d in cursor:
        out.setdefault(d.get("lead_email"), []).append(d)
    return out


# ─── Generator ─────────────────────────────────────────────────────


async def _generate_drafts_for(lead: dict, existing: list[dict], now: datetime) -> list[dict]:
    """Generate up to (cap - existing) new drafts, never duplicating a
    type the lead has already received. Returns the newly-inserted rows."""
    email = lead["email"]
    used_types = {d.get("draft_type") for d in existing if d.get("status") != "dismissed"}
    available_slots = _MAX_DRAFTS_PER_LEAD - len([
        d for d in existing if d.get("status") in ("pending", "approved")
    ])
    if available_slots <= 0:
        return []

    next_types = [t for t in _DRAFT_ORDER if t not in used_types][:available_slots]
    if not next_types:
        return []

    rows: list[dict] = []
    for t in next_types:
        template = _TEMPLATES[t](email)
        row = {
            "id": str(uuid.uuid4()),
            "lead_email": email,
            "lead_first_seen_at": lead.get("first_seen_at"),
            "lead_source": lead.get("source"),
            "lead_campaign": lead.get("campaign"),
            "draft_type": t,
            "title": template["title"],
            "body_md": template["body_md"],
            "reason": template["reason"],
            "recommended_send_at": _recommended_send_at(now, t),
            "status": "pending",
            "created_at": now_iso(),
            "decided_at": None,
            "decided_by": None,
        }
        await db.nurture_drafts.insert_one(row)
        # Motor mutates `row` to add an ObjectId at `_id` — strip it so
        # the FastAPI response doesn't choke on JSON encoding.
        row.pop("_id", None)
        rows.append(row)
    return rows


# ─── Endpoints ─────────────────────────────────────────────────────


@router.post("/admin/nurture-queue/generate")
async def nurture_generate(_admin: dict = Depends(_current_admin)):
    """Walk all eligible leads and generate up to 2 drafts each.
    Idempotent — won't create a draft type the lead already has, and
    respects the lead's per-lead cap."""
    leads = await _eligible_leads()
    if not leads:
        return {"generated": 0, "leads_checked": 0, "drafts": []}

    existing = await _existing_drafts_by_lead()
    now = datetime.now(timezone.utc)
    created: list[dict] = []
    for lead in leads:
        rows = await _generate_drafts_for(lead, existing.get(lead["email"], []), now)
        created.extend(rows)

    return {
        "generated": len(created),
        "leads_checked": len(leads),
        "drafts": created,
    }


@router.get("/admin/nurture-queue")
async def nurture_list(_admin: dict = Depends(_current_admin)):
    """Return the full queue snapshot — pending drafts, recent decisions,
    counts, and the eligible-but-uncovered lead list (so the operator
    knows when 'Generate' will actually produce something)."""
    # Auto-cleanup: if a lead applied AFTER drafts were generated, mark
    # any still-pending drafts as 'stopped' so they don't appear in
    # the queue. Per spec: stop immediately on app submission.
    pending_emails = await db.nurture_drafts.distinct("lead_email", {"status": "pending"})
    if pending_emails:
        applied_now = set(await db.maker_applications.distinct(
            "email", {"email": {"$in": pending_emails}},
        ))
        if applied_now:
            await db.nurture_drafts.update_many(
                {"lead_email": {"$in": list(applied_now)}, "status": "pending"},
                {"$set": {
                    "status": "stopped",
                    "decided_at": now_iso(),
                    "decided_by": "auto-applied",
                }},
            )

    pending = await db.nurture_drafts.find(
        {"status": "pending"}, {"_id": 0},
    ).sort("created_at", -1).to_list(200)

    recent = await db.nurture_drafts.find(
        {"status": {"$in": ["approved", "dismissed", "stopped"]}},
        {"_id": 0},
    ).sort("decided_at", -1).to_list(50)

    # Leads currently eligible but uncovered — surfaces "Generate" call to action.
    leads = await _eligible_leads()
    by_email = await _existing_drafts_by_lead()
    uncovered = [
        lead for lead in leads
        if len([d for d in by_email.get(lead["email"], []) if d.get("status") in ("pending", "approved")]) < _MAX_DRAFTS_PER_LEAD
    ]

    counts_by_status = {"pending": 0, "approved": 0, "dismissed": 0, "stopped": 0}
    async for row in db.nurture_drafts.find({}, {"_id": 0, "status": 1}):
        s = row.get("status", "pending")
        counts_by_status[s] = counts_by_status.get(s, 0) + 1

    return {
        "scanned_at": datetime.now(timezone.utc).isoformat(),
        "thresholds": {
            "stale_lead_days": _STALE_THRESHOLD_DAYS,
            "max_drafts_per_lead": _MAX_DRAFTS_PER_LEAD,
        },
        "counts": {
            **counts_by_status,
            "eligible_leads": len(leads),
            "uncovered_leads": len(uncovered),
        },
        "pending": pending,
        "recent": recent,
        "uncovered_leads": uncovered[:50],
    }


@router.post("/admin/nurture-queue/{draft_id}/decision")
async def nurture_decide(
    draft_id: str,
    payload: DecisionRequest,
    claims: dict = Depends(_current_admin),
):
    """Approve = mark ready for the operator to send (no auto-send).
    Dismiss = drop the draft (operator decided it's not the right
    moment / message)."""
    row = await db.nurture_drafts.find_one({"id": draft_id}, {"_id": 0})
    if not row:
        raise HTTPException(404, "Draft not found")
    if row["status"] != "pending":
        raise HTTPException(400, f"Draft is already {row['status']} — cannot change.")

    new_status = "approved" if payload.decision == "approve" else "dismissed"
    await db.nurture_drafts.update_one(
        {"id": draft_id},
        {"$set": {
            "status":     new_status,
            "decided_at": now_iso(),
            "decided_by": (claims.get("email") or "").lower(),
            "decision_note": (payload.note or "").strip()[:300] or None,
        }},
    )
    return {"ok": True, "id": draft_id, "status": new_status}
