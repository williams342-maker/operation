"""Public Contact-form messages + admin inbox.

Architecture mirrors `routers/settings.py`'s beta-feedback endpoints
(public POST + admin GET/resolve/reply) so the admin UX is consistent.

Flow:
  1. Public form on `/contact` → POST /api/contact-messages
     → persists to db.contact_messages
     → emails ops inbox (team@craftersmarket.org)
     → auto-replies to submitter with a 24h SLA confirmation
  2. Admin reviews via /api/admin/contact-messages (sorted newest-first)
  3. Admin replies via /api/admin/contact-messages/{id}/reply
     (auto-resolves the ticket on send by default)
  4. Admin can resolve without reply via .../resolve

Note: rate-limited at the router level by a 10/min IP cap to mitigate
spam without requiring captcha. Stricter than the beta-feedback flow
since this is open to the entire internet (beta-feedback was gated by
beta_mode).
"""
from __future__ import annotations
import secrets
import time as _time
import uuid
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field

from core import db, logger, now_iso
from email_service import (
    send_contact_message_autoreply,
    send_contact_message_to_ops,
    send_admin_broadcast,
)
from maker_auth import current_admin

router = APIRouter()


# ── Cheap in-process IP rate limiter ──────────────────────────────────
# 10 submissions per IP per 60s. Resets on process restart, which is
# fine — anything more sophisticated (Redis token bucket) is overkill
# for a contact form. Map cleanup is opportunistic to keep the dict small.
_RATE_BUCKET: dict[str, list[float]] = {}
_RATE_LIMIT = 10
_RATE_WINDOW_S = 60.0


def _check_rate_limit(ip: str):
    now = _time.monotonic()
    arr = [t for t in _RATE_BUCKET.get(ip, []) if now - t < _RATE_WINDOW_S]
    if len(arr) >= _RATE_LIMIT:
        raise HTTPException(429, "Too many messages — please try again in a minute.")
    arr.append(now)
    _RATE_BUCKET[ip] = arr
    # Opportunistic cleanup
    if len(_RATE_BUCKET) > 1024:
        for k in list(_RATE_BUCKET.keys()):
            _RATE_BUCKET[k] = [t for t in _RATE_BUCKET[k] if now - t < _RATE_WINDOW_S]
            if not _RATE_BUCKET[k]:
                _RATE_BUCKET.pop(k, None)


CONTACT_TOPICS = (
    "general",
    "custom_order",
    "order_help",
    "maker_program",
    "press",
    "partnership",
    "bug",
    "other",
)


# ── Public endpoint ───────────────────────────────────────────────────
class ContactMessageIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    message: str = Field(min_length=8, max_length=4000)
    subject: Optional[str] = Field(default="", max_length=200)
    topic: Optional[str] = Field(default="general", max_length=40)
    phone: Optional[str] = Field(default="", max_length=40)
    # Honeypot. Real users have JS-disabled forms autofill their first/
    # last name into this, but bots posting raw JSON tend to pre-fill it.
    # If non-empty we silently 200 without persisting.
    website: Optional[str] = ""


@router.post("/contact-messages")
async def submit_contact_message(
    payload: ContactMessageIn, request: Request, bg: BackgroundTasks,
):
    """Public contact form submission. Anyone on the internet can hit this."""
    ip = (
        request.headers.get("x-forwarded-for", "").split(",")[0].strip()
        or (request.client.host if request.client else "0.0.0.0")
    )
    _check_rate_limit(ip)

    # Honeypot — silently succeed so the bot doesn't retry with variations.
    if (payload.website or "").strip():
        logger.info("[contact] honeypot tripped from ip=%s", ip)
        return {"received": True, "id": str(uuid.uuid4())}

    topic = payload.topic if payload.topic in CONTACT_TOPICS else "general"
    doc = {
        "id": str(uuid.uuid4()),
        "name": payload.name.strip(),
        "email": payload.email.lower().strip(),
        "subject": (payload.subject or "").strip()[:200],
        "topic": topic,
        "phone": (payload.phone or "").strip()[:40],
        "message": payload.message.strip(),
        "ip": ip[:64],
        "created_at": now_iso(),
        "resolved": False,
        "replied_at": None,
        "replied_by": None,
    }
    await db.contact_messages.insert_one(dict(doc))

    # Fire-and-forget ops alert + submitter auto-reply.
    bg.add_task(
        send_contact_message_to_ops,
        name=doc["name"], email=doc["email"], message=doc["message"],
        subject=doc["subject"], phone=doc["phone"], topic=doc["topic"],
    )
    bg.add_task(
        send_contact_message_autoreply,
        to_email=doc["email"], to_name=doc["name"],
        original_message=doc["message"],
    )
    logger.info(
        "[contact] message received from %s · topic=%s · id=%s",
        doc["email"], topic, doc["id"],
    )
    return {"received": True, "id": doc["id"]}


# ── Admin inbox ───────────────────────────────────────────────────────
@router.get("/admin/contact-messages")
async def admin_list_contact_messages(
    limit: int = 100, resolved: Optional[bool] = None,
    topic: Optional[str] = None,
    _: dict = Depends(current_admin),
):
    flt: dict = {}
    if resolved is not None:
        flt["resolved"] = resolved
    if topic and topic in CONTACT_TOPICS:
        flt["topic"] = topic
    rows: List[dict] = await db.contact_messages.find(
        flt, {"_id": 0, "ip": 0},  # never expose IPs to the admin UI
    ).sort("created_at", -1).to_list(max(1, min(limit, 500)))
    return {"items": rows, "count": len(rows)}


@router.post("/admin/contact-messages/{message_id}/resolve")
async def admin_resolve_contact_message(
    message_id: str, bg: BackgroundTasks,
    claims: dict = Depends(current_admin),
):
    msg = await db.contact_messages.find_one({"id": message_id}, {"_id": 0})
    if not msg:
        raise HTTPException(404, "Message not found.")
    update = {
        "resolved": True,
        "resolved_by": claims["email"],
        "resolved_at": now_iso(),
    }
    # iter102 — fire an automated acknowledgment email when an admin
    # marks a contact message resolved without writing a tailored Reply.
    # Same three guards as the beta-feedback follow-up (iter101):
    # email present, no prior reply, no prior follow-up.
    will_send = bool(
        msg.get("email")
        and not msg.get("replied_at")
        and not msg.get("followup_sent_at")
    )
    if will_send:
        from email_service import send_contact_message_resolved
        bg.add_task(
            send_contact_message_resolved,
            name=msg.get("name", ""),
            email=msg["email"],
            message=msg.get("message", ""),
            subject=msg.get("subject", ""),
        )
        update["followup_sent_at"] = now_iso()
    await db.contact_messages.update_one({"id": message_id}, {"$set": update})
    return {"resolved": True, "followup_sent": will_send}


class ContactReplyRequest(BaseModel):
    subject: str = Field(min_length=1, max_length=180)
    message: str = Field(min_length=2, max_length=10000)
    auto_resolve: bool = True


@router.post("/admin/contact-messages/{message_id}/reply")
async def admin_reply_contact_message(
    message_id: str, body: ContactReplyRequest,
    bg: BackgroundTasks, claims: dict = Depends(current_admin),
):
    """Email reply to a contact-form submitter. Auto-resolves on send."""
    msg = await db.contact_messages.find_one({"id": message_id}, {"_id": 0})
    if not msg:
        raise HTTPException(404, "Message not found.")
    if not msg.get("email"):
        raise HTTPException(400, "Message has no email on file.")

    bg.add_task(
        send_admin_broadcast,
        msg["email"], body.subject.strip(), body.message.strip(),
        "Reply from Crafters Market",
        "Re: your contact-form message",
    )
    update: dict = {
        "replied_at": now_iso(),
        "replied_by": claims["email"],
        "replied_subject": body.subject.strip()[:200],
    }
    if body.auto_resolve and not msg.get("resolved"):
        update.update({
            "resolved": True,
            "resolved_by": claims["email"],
            "resolved_at": now_iso(),
        })
    await db.contact_messages.update_one({"id": message_id}, {"$set": update})
    await db.admin_audit.insert_one({
        "id": secrets.token_hex(12),
        "kind": "contact_reply",
        "actor": claims["email"],
        "message_id": message_id,
        "to": msg["email"],
        "subject": body.subject.strip()[:200],
        "created_at": now_iso(),
    })
    return {"sent": True, "resolved": bool(body.auto_resolve)}
