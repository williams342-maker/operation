"""Telnyx SMS webhook + admin endpoints (iter265).

Endpoints
=========
- POST /api/sms/webhook           — primary (configure in Telnyx Console)
- POST /api/sms/webhook/failover  — failover (configure in Telnyx Console)
- GET  /api/admin/sms/diag        — admin status panel
- POST /api/admin/sms/test-send   — manual one-off send
- POST /api/admin/sms/optouts/clear — undo an opt-out
"""
from __future__ import annotations
from config import env_get

import json
import os
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from core import db, logger, now_iso
from maker_auth import current_admin
from sms_service import (
    TelnyxSignatureError,
    e164_normalize,
    is_configured,
    record_opt_out,
    send_sms,
    verify_telnyx_signature,
)

router = APIRouter(tags=["sms"])

_STOP_KEYWORDS = {"stop", "stopall", "stop all", "unsubscribe", "cancel", "end", "quit"}
_START_KEYWORDS = {"start", "unstop", "yes"}
_HELP_KEYWORDS = {"help", "info", "support"}


async def _process_event(event: dict) -> None:
    """Dispatch a Telnyx v2 webhook into our handlers. Idempotent — we
    use `data.id` as the `_id` of `sms_webhook_events` so duplicate
    deliveries are dropped by the unique index."""
    data = event.get("data") or {}
    meta = event.get("meta") or {}
    event_id = data.get("id")
    event_type = data.get("event_type") or ""
    payload = data.get("payload") or {}
    if not event_id:
        return

    # Idempotency: insert-or-skip. Using `id` (not `_id`) since Mongo's
    # default `_id` ObjectId would conflict with Telnyx's uuid string.
    try:
        await db.sms_webhook_events.insert_one({
            "id": event_id,
            "event_type": event_type,
            "payload": payload,
            "meta": meta,
            "received_at": now_iso(),
        })
    except Exception:
        # Duplicate-key (already processed) or any insert error — skip.
        return

    if event_type == "message.received":
        from_obj = payload.get("from") or {}
        from_number = (from_obj.get("phone_number") or "").strip()
        text_norm = (payload.get("text") or "").strip().lower()
        if not from_number:
            return
        if text_norm in _STOP_KEYWORDS:
            await record_opt_out(from_number, source=f"keyword_{text_norm.replace(' ', '_')}")
            logger.info("[sms] STOP from %s", from_number)
        elif text_norm in _START_KEYWORDS:
            await db.sms_optouts.delete_one({"phone": from_number})
            logger.info("[sms] START from %s — opt-out cleared", from_number)
        elif text_norm in _HELP_KEYWORDS:
            # Twilio/Telnyx auto-reply HELP. We don't fire a 2nd reply
            # to avoid double-messaging compliance issues.
            logger.info("[sms] HELP from %s", from_number)
    elif event_type in ("message.sent", "message.finalized"):
        # Roll the per-recipient status forward on our local row.
        message_id = payload.get("id")
        to_list = payload.get("to") or []
        rec_status = (to_list[0].get("status") if to_list else None) or payload.get("status") or event_type
        if message_id:
            await db.sms_messages.update_one(
                {"$or": [{"id": message_id}, {"message_sid": message_id}]},
                {"$set": {"status": rec_status, "last_event_type": event_type,
                          "updated_at": now_iso()}},
            )


async def _webhook_handler(request: Request) -> JSONResponse:
    """Shared logic for primary + failover. Both URLs run identical
    code; Telnyx just retries the failover one if the primary 5xxs."""
    raw_body = await request.body()
    sig = request.headers.get("telnyx-signature-ed25519") \
          or request.headers.get("Telnyx-Signature-ED25519")
    ts = request.headers.get("telnyx-timestamp") \
         or request.headers.get("Telnyx-Timestamp")
    try:
        verify_telnyx_signature(raw_body, sig, ts)
    except TelnyxSignatureError as e:
        logger.warning("[sms] webhook signature rejected: %s", e)
        raise HTTPException(status_code=403, detail=str(e))
    try:
        event = json.loads(raw_body.decode("utf-8"))
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON")
    await _process_event(event)
    # Telnyx wants a quick 2xx — we already persisted, business logic
    # ran in the same coroutine since it's all sub-ms Mongo ops.
    return JSONResponse({"status": "ok"})


@router.post("/sms/webhook")
async def sms_webhook_primary(request: Request):
    return await _webhook_handler(request)


@router.post("/sms/webhook/failover")
async def sms_webhook_failover(request: Request):
    return await _webhook_handler(request)


# ─────────────────────────────────────────────────────────────────────
# Admin endpoints
# ─────────────────────────────────────────────────────────────────────
@router.get("/admin/sms/diag")
async def admin_sms_diag(_: dict = Depends(current_admin)):
    """Surface enough info for the admin UI to render a status card."""
    recent = await db.sms_messages.find(
        {}, {"_id": 0, "id": 1, "to": 1, "kind": 1, "status": 1,
             "created_at": 1, "error": 1},
    ).sort("created_at", -1).limit(5).to_list(5)
    last_inbound = await db.sms_webhook_events.find_one(
        {"event_type": "message.received"},
        {"_id": 0, "payload": 1, "received_at": 1},
        sort=[("received_at", -1)],
    )
    return {
        "configured": is_configured(),
        "missing_env": [
            k for k in ("TELNYX_API_KEY", "TELNYX_MESSAGING_PROFILE_ID", "TELNYX_PUBLIC_KEY")
            if not (env_get(k) or "").strip()
        ],
        "recent_sends": recent,
        "optout_count": await db.sms_optouts.count_documents({}),
        "last_inbound": last_inbound,
    }


class _SmsTestSendIn(BaseModel):
    to: str = Field(..., min_length=4, max_length=20)
    body: str = Field("Test from Crafters Market admin. Reply STOP to opt out.",
                       min_length=1, max_length=320)


@router.post("/admin/sms/test-send")
async def admin_sms_test_send(
    payload: _SmsTestSendIn,
    claims: dict = Depends(current_admin),
):
    normalized = e164_normalize(payload.to) or payload.to
    result = await send_sms(to=normalized, body=payload.body, kind="admin_test")
    logger.info("[sms] admin test send by %s → %s · %s",
                claims.get("email"), normalized, result.get("status"))
    return {"requested_to": payload.to, "normalized_to": normalized, **result}


class _SmsOptOutClearIn(BaseModel):
    phone: str


@router.post("/admin/sms/optouts/clear")
async def admin_sms_clear_optout(
    payload: _SmsOptOutClearIn,
    claims: dict = Depends(current_admin),
):
    normalized = e164_normalize(payload.phone) or payload.phone
    res = await db.sms_optouts.delete_one({"phone": normalized})
    if res.deleted_count == 0:
        raise HTTPException(404, f"No opt-out on file for {normalized}")
    try:
        await db.admin_audit.insert_one({
            "kind": "sms_optout_cleared",
            "admin_email": claims.get("email"),
            "phone": normalized,
            "created_at": now_iso(),
        })
    except Exception:
        pass
    return {"ok": True, "phone": normalized}
