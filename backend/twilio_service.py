"""Thin Twilio SMS wrapper — used for transactional buyer nudges.

Configured via three env vars:
    * TWILIO_ACCOUNT_SID
    * TWILIO_AUTH_TOKEN
    * TWILIO_FROM_NUMBER   (E.164, e.g. "+15551234567")

If any are missing, `send_sms()` is a no-op that logs + returns None —
the webhook path that calls us (Shippo DELIVERED) will simply skip the
SMS leg and continue with the email. This keeps deploys without Twilio
keys fully functional.
"""
from __future__ import annotations
import os
import re
from typing import Optional

from core import logger


def is_configured() -> bool:
    return all([
        os.environ.get("TWILIO_ACCOUNT_SID"),
        os.environ.get("TWILIO_AUTH_TOKEN"),
        os.environ.get("TWILIO_FROM_NUMBER"),
    ])


def _to_e164(phone: str) -> Optional[str]:
    """Best-effort E.164 normalisation. Assumes US if no country code."""
    if not phone:
        return None
    raw = re.sub(r"[^\d+]", "", phone)
    if raw.startswith("+"):
        return raw
    digits = re.sub(r"\D", "", raw)
    if len(digits) == 10:
        return f"+1{digits}"
    if len(digits) == 11 and digits.startswith("1"):
        return f"+{digits}"
    return None  # refuse to guess country for anything else


def send_sms(to: str, body: str) -> Optional[str]:
    """Fire a single SMS. Returns the Twilio Message SID on success,
    None if not configured / invalid number / Twilio rejected. NEVER
    raises — caller is fire-and-forget."""
    if not is_configured():
        logger.info("[twilio] skipped — not configured")
        return None
    e164 = _to_e164(to)
    if not e164:
        logger.info("[twilio] skipped — can't parse %r as E.164", to)
        return None
    try:
        from twilio.rest import Client
        c = Client(os.environ["TWILIO_ACCOUNT_SID"], os.environ["TWILIO_AUTH_TOKEN"])
        msg = c.messages.create(
            from_=os.environ["TWILIO_FROM_NUMBER"],
            to=e164,
            body=body[:1500],  # Twilio splits at 1600; clip comfortably
        )
        logger.info("[twilio] sent to=%s sid=%s", e164, msg.sid)
        return msg.sid
    except Exception as e:
        logger.warning("[twilio] send failed to=%s: %s", e164, e)
        return None
