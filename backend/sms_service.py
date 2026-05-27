"""Telnyx SMS service (iter265).

Pure-Python, kill-switched at the env-var layer. When any of the 3 env
vars is missing every send is a recorded no-op. Webhook signature
verification uses Ed25519 against the Telnyx-supplied public key.

Public API
==========
- send_sms(to, body, dedup_key)  — primary outbound helper. Idempotent.
- record_opt_out(phone, source)
- is_opted_out(phone)
- e164_normalize(raw, default_country)
- verify_telnyx_signature(raw_body, signature_b64, timestamp)
- is_configured()
"""
from __future__ import annotations

import base64
import os
import re
import time
from typing import Optional

from core import db, logger, now_iso

_E164_RE = re.compile(r"^\+[1-9]\d{6,14}$")
TELNYX_TIMESTAMP_TOLERANCE_SECONDS = 300  # 5 min replay-attack window


def _cfg() -> dict:
    return {
        "api_key": os.environ.get("TELNYX_API_KEY", "").strip(),
        "messaging_profile_id": os.environ.get("TELNYX_MESSAGING_PROFILE_ID", "").strip(),
        "public_key": os.environ.get("TELNYX_PUBLIC_KEY", "").strip(),
    }


def is_configured() -> bool:
    c = _cfg()
    return bool(c["api_key"] and c["messaging_profile_id"])


def e164_normalize(raw: str, default_country: str = "US") -> Optional[str]:
    if not raw:
        return None
    digits = re.sub(r"\D", "", raw)
    if not digits:
        return None
    candidate = "+" + digits
    if default_country == "US" and len(digits) == 10:
        candidate = "+1" + digits
    elif default_country == "US" and len(digits) == 11 and digits.startswith("1"):
        candidate = "+" + digits
    return candidate if _E164_RE.match(candidate) else None


async def record_opt_out(phone: str, source: str = "stop_keyword") -> None:
    if not phone:
        return
    await db.sms_optouts.update_one(
        {"phone": phone},
        {"$set": {"phone": phone, "source": source, "updated_at": now_iso()},
         "$setOnInsert": {"created_at": now_iso()}},
        upsert=True,
    )


async def is_opted_out(phone: str) -> bool:
    if not phone:
        return True
    return bool(await db.sms_optouts.find_one({"phone": phone}, {"_id": 0, "phone": 1}))


class TelnyxSignatureError(Exception):
    """Raised when an inbound webhook fails Ed25519 verification."""


def verify_telnyx_signature(
    raw_body: bytes,
    signature_b64: Optional[str],
    timestamp_str: Optional[str],
) -> None:
    """Reconstruct `{timestamp}|{raw_body}`, verify Ed25519 sig against
    the configured public key, and reject anything older than the 5-min
    tolerance window. Raises TelnyxSignatureError on any failure."""
    pubkey_b64 = _cfg()["public_key"]
    if not pubkey_b64:
        raise TelnyxSignatureError("TELNYX_PUBLIC_KEY not configured")
    if not signature_b64 or not timestamp_str:
        raise TelnyxSignatureError("Missing Telnyx signature headers")
    try:
        timestamp = int(timestamp_str)
    except ValueError as e:
        raise TelnyxSignatureError(f"Invalid timestamp: {e}") from e
    if abs(int(time.time()) - timestamp) > TELNYX_TIMESTAMP_TOLERANCE_SECONDS:
        raise TelnyxSignatureError("timestamp outside tolerance")
    try:
        from cryptography.exceptions import InvalidSignature
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
        pub_bytes = base64.b64decode(pubkey_b64)
        public_key = Ed25519PublicKey.from_public_bytes(pub_bytes)
        sig_bytes = base64.b64decode(signature_b64)
        signed = f"{timestamp_str}|".encode("utf-8") + raw_body
        public_key.verify(sig_bytes, signed)
    except InvalidSignature as e:
        raise TelnyxSignatureError("Invalid signature") from e
    except Exception as e:
        raise TelnyxSignatureError(f"Signature verification failed: {e}") from e


async def send_sms(
    *,
    to: str,
    body: str,
    dedup_key: Optional[str] = None,
    kind: str = "transactional",
) -> dict:
    """Send one SMS via the configured Messaging Profile. Returns a
    `{sent, status, reason?, message_sid?}` dict; never raises."""
    if not is_configured():
        return {"sent": False, "status": "disabled", "reason": "telnyx_unconfigured"}
    if not to or not _E164_RE.match(to):
        return {"sent": False, "status": "skipped", "reason": "invalid_e164", "to": to}
    if await is_opted_out(to):
        return {"sent": False, "status": "skipped", "reason": "opted_out", "to": to}
    if dedup_key:
        existing = await db.sms_messages.find_one(
            {"dedup_key": dedup_key,
             "status": {"$in": ["queued", "sent", "delivered", "sending"]}},
            {"_id": 0, "id": 1, "status": 1},
        )
        if existing:
            return {"sent": False, "status": "deduped", "reason": "already_sent",
                    "existing_id": existing.get("id")}

    body_trimmed = (body or "").strip()[:320]
    if not body_trimmed:
        return {"sent": False, "status": "skipped", "reason": "empty_body"}

    cfg = _cfg()
    try:
        import telnyx
        telnyx.api_key = cfg["api_key"]
        resp = telnyx.Message.create(
            messaging_profile_id=cfg["messaging_profile_id"],
            to=to,
            text=body_trimmed,
        )
        sid = getattr(resp, "id", None) or (resp.get("id") if hasattr(resp, "get") else None)
        status = getattr(resp, "status", None) or "queued"
    except Exception as e:
        logger.exception("[sms] send failed to=%s err=%s", to, e)
        await db.sms_messages.insert_one({
            "id": f"failed_{int(time.time()*1000)}",
            "to": to, "body": body_trimmed, "dedup_key": dedup_key,
            "kind": kind, "status": "failed",
            "error": str(e)[:500], "created_at": now_iso(),
        })
        return {"sent": False, "status": "failed", "reason": str(e)[:200]}

    await db.sms_messages.insert_one({
        "id": sid or f"queued_{int(time.time()*1000)}",
        "to": to, "body": body_trimmed, "dedup_key": dedup_key,
        "kind": kind, "status": status, "message_sid": sid,
        "created_at": now_iso(),
    })
    logger.info("[sms] sent kind=%s to=%s sid=%s", kind, to, sid)
    return {"sent": True, "status": status, "message_sid": sid}
