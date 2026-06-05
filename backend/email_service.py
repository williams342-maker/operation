"""Transactional email helpers for Crafters Market.

Supports seven providers via EMAIL_PROVIDER env flag:
  - "mailgun": Mailgun REST API (NEW · 2026-04-29 · primary candidate)
  - "mailtrap" (default 2026-05): Mailtrap Sending API
  - "postmark": Postmark transactional REST API
  - "sender": Sender.net transactional REST API
  - "mailersend": MailerSend / MailerLite transactional REST API
  - "brevo": Brevo / Sendinblue REST API
  - "resend": Resend SDK (legacy fallback)

Fallback chain: EMAIL_PROVIDER → EMAIL_FALLBACK_PROVIDER → EMAIL_FALLBACK_PROVIDER_2.
The chain skips any provider missing its API key and any pair where two consecutive
slots are the same (so misconfiguration can't burn three slots on the same vendor).
"""
import os
import asyncio
import logging
from pathlib import Path
from typing import Optional

import httpx
import resend
from dotenv import load_dotenv, dotenv_values

# iter224 — Selective override mirrors core.py: load .env without globally
# overriding the OS env (so production K8s vars keep winning), then for
# email-integration keys, replace any OS value that looks like an Emergent
# pod placeholder (`****` mask). Keeps preview workable with real keys
# while leaving production untouched.
_ENV_PATH = Path(__file__).parent / ".env"
if _ENV_PATH.exists():
    load_dotenv(_ENV_PATH, override=False)
    for _k, _v in dotenv_values(_ENV_PATH).items():
        if not _v:
            continue
        _cur = os.environ.get(_k, "")
        if _cur and "****" in _cur:
            os.environ[_k] = _v

logger = logging.getLogger("crafters.email")
logger.setLevel(logging.INFO)
if not logger.handlers:
    h = logging.StreamHandler()
    h.setFormatter(logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s"))
    logger.addHandler(h)
logger.propagate = True

EMAIL_PROVIDER = os.environ.get("EMAIL_PROVIDER", "mailtrap").lower()
EMAIL_FALLBACK_PROVIDER = os.environ.get("EMAIL_FALLBACK_PROVIDER", "postmark").lower()
# 3rd link in the chain. Defaults to "" (disabled) so existing 2-link
# deploys keep their behaviour unchanged. To get the user's requested
# Mailgun → Postmark → Mailtrap chain, set:
#   EMAIL_PROVIDER=mailgun
#   EMAIL_FALLBACK_PROVIDER=postmark
#   EMAIL_FALLBACK_PROVIDER_2=mailtrap
EMAIL_FALLBACK_PROVIDER_2 = os.environ.get("EMAIL_FALLBACK_PROVIDER_2", "").lower()

RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
BREVO_API_KEY = os.environ.get("BREVO_API_KEY", "")
MAILERSEND_API_KEY = os.environ.get("MAILERSEND_API_KEY", "")
SENDER_API_KEY = os.environ.get("SENDER_API_KEY", "")
POSTMARK_API_KEY = os.environ.get("POSTMARK_API_KEY", "")
POSTMARK_MESSAGE_STREAM = os.environ.get("POSTMARK_MESSAGE_STREAM", "outbound")
MAILTRAP_API_KEY = os.environ.get("MAILTRAP_API_KEY", "")
# Mailgun (REST API). Region is "us" (default) or "eu" — Mailgun runs two
# isolated stacks; calling the wrong region returns 404 with a confusing
# "domain not found" body. The domain is the *sending* subdomain
# verified in the Mailgun dashboard, e.g. "mg.craftersmarket.org".
MAILGUN_API_KEY = os.environ.get("MAILGUN_API_KEY", "")
MAILGUN_DOMAIN = os.environ.get("MAILGUN_DOMAIN", "")
MAILGUN_REGION = os.environ.get("MAILGUN_REGION", "us").lower()

SENDER_EMAIL = os.environ.get("SENDER_EMAIL", "team@craftersmarket.org")
SENDER_NAME = os.environ.get("SENDER_NAME", "Crafters Market")
OPS_EMAIL = os.environ.get("OPS_EMAIL", "")

if RESEND_API_KEY:
    resend.api_key = RESEND_API_KEY


def _has_provider() -> bool:
    if EMAIL_PROVIDER == "mailgun":
        return bool(MAILGUN_API_KEY and MAILGUN_DOMAIN)
    if EMAIL_PROVIDER == "mailtrap":
        return bool(MAILTRAP_API_KEY)
    if EMAIL_PROVIDER == "postmark":
        return bool(POSTMARK_API_KEY)
    if EMAIL_PROVIDER == "sender":
        return bool(SENDER_API_KEY)
    if EMAIL_PROVIDER == "mailersend":
        return bool(MAILERSEND_API_KEY)
    if EMAIL_PROVIDER == "brevo":
        return bool(BREVO_API_KEY)
    return bool(RESEND_API_KEY)


async def _send_mailgun(to: str, subject: str, html: str):
    """Send via Mailgun REST API.
    https://documentation.mailgun.com/docs/mailgun/api-reference/openapi-final/tag/Messages

    Endpoint: POST https://api{.eu}.mailgun.net/v3/<MAILGUN_DOMAIN>/messages
    Auth:     HTTP Basic, username=`api`, password=<MAILGUN_API_KEY>
              (httpx encodes via the `auth=(...)` tuple)
    Form-encoded body (NOT JSON) — that's a Mailgun quirk.

    Notes:
      - MAILGUN_DOMAIN is the *sending subdomain* (e.g. mg.craftersmarket.org),
        not the bare apex domain. Configure under Sending → Domains.
      - SPF + DKIM DNS records must be added & verified for that subdomain
        BEFORE production sends. Free tier allows sandbox-only sends until
        the custom domain is verified.
      - Region: "us" (api.mailgun.net) vs "eu" (api.eu.mailgun.net). Mismatch
        gives a misleading 404 "domain not found" — set MAILGUN_REGION=eu
        if your account was created in the EU stack.
      - Permanent errors (4xx) → don't retry, fall through to next provider.
        Transient errors (429/5xx/timeout) → also fall through (we don't
        retry the same provider; the fallback chain handles redundancy).
    """
    base = "https://api.eu.mailgun.net" if MAILGUN_REGION == "eu" else "https://api.mailgun.net"
    url = f"{base}/v3/{MAILGUN_DOMAIN}/messages"
    data = {
        "from": f"{SENDER_NAME} <{SENDER_EMAIL}>",
        "to": to,
        "subject": subject,
        "html": html,
        "o:tag": "transactional",
        "o:tracking": "no",  # transactional auth/receipt mail — no engagement tracking
    }
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(url, auth=("api", MAILGUN_API_KEY), data=data)
    except httpx.RequestError as e:
        logger.warning("mailgun transport error → %s: %s", to, e)
        return {"_error": True, "status": 0, "body": f"transport: {e}"[:500]}

    if r.status_code >= 400:
        logger.warning("mailgun error %d → %s: %s", r.status_code, to, r.text[:300])
        return {"_error": True, "status": r.status_code, "body": r.text[:500]}
    body = r.json() if r.content else {}
    msg_id = body.get("id")
    logger.info("mailgun sent → %s · id=%s", to, msg_id)
    return {"message_id": msg_id, "status": r.status_code}


async def send_mailgun_with_attachment(
    to: str,
    subject: str,
    html: str,
    attachment_bytes: bytes,
    attachment_filename: str,
    attachment_mime: str = "text/csv",
    reply_to: str | None = None,
) -> dict:
    """Send a Mailgun message with a single file attachment.

    Standalone helper (not part of the fallback chain) because attachments
    only matter for niche flows like "support fallback CSV forward" where
    we don't need provider redundancy — if Mailgun is down the maker can
    just retry in a minute. Returns `{ok, message_id, status, error}`.
    """
    if not (MAILGUN_API_KEY and MAILGUN_DOMAIN):
        return {"ok": False, "status": 0, "error": "Mailgun not configured"}
    base = "https://api.eu.mailgun.net" if MAILGUN_REGION == "eu" else "https://api.mailgun.net"
    url = f"{base}/v3/{MAILGUN_DOMAIN}/messages"
    data = {
        "from": f"{SENDER_NAME} <{SENDER_EMAIL}>",
        "to": to,
        "subject": subject,
        "html": html,
        "o:tag": "support-csv-forward",
        "o:tracking": "no",
    }
    if reply_to:
        data["h:Reply-To"] = reply_to
    files = {
        "attachment": (attachment_filename, attachment_bytes, attachment_mime),
    }
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(url, auth=("api", MAILGUN_API_KEY),
                                  data=data, files=files)
    except httpx.RequestError as e:
        logger.warning("mailgun (attachment) transport error: %s", e)
        return {"ok": False, "status": 0, "error": f"transport: {e}"[:300]}
    if r.status_code >= 400:
        logger.warning("mailgun (attachment) error %d: %s", r.status_code, r.text[:300])
        return {"ok": False, "status": r.status_code, "error": r.text[:300]}
    body = r.json() if r.content else {}
    msg_id = body.get("id")
    logger.info("mailgun (attachment) sent → %s · id=%s · file=%s",
                to, msg_id, attachment_filename)
    return {"ok": True, "message_id": msg_id, "status": r.status_code}


async def _send_mailtrap(to: str, subject: str, html: str):
    """Send via Mailtrap Sending API.
    https://docs.mailtrap.io/developers/email-sending/transactional

    Endpoint: POST https://send.api.mailtrap.io/api/send
    Auth: Authorization: Bearer <MAILTRAP_API_KEY>
    Note: SENDER_EMAIL's domain must be added + verified in Mailtrap
    Sending Domains (Settings → Sending Domains) before sends succeed.
    Otherwise Mailtrap returns 401/403 with an "errors" array.
    """
    payload = {
        "from": {"email": SENDER_EMAIL, "name": SENDER_NAME},
        "to": [{"email": to}],
        "subject": subject,
        "html": html,
        "category": "transactional",
    }
    headers = {
        "Authorization": f"Bearer {MAILTRAP_API_KEY}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(
            "https://send.api.mailtrap.io/api/send",
            json=payload, headers=headers,
        )
    if r.status_code >= 400:
        logger.warning("mailtrap error %d → %s: %s", r.status_code, to, r.text[:300])
        return {"_error": True, "status": r.status_code, "body": r.text[:500]}
    body = r.json() if r.content else {}
    if not body.get("success"):
        logger.warning("mailtrap logical error → %s: %s", to, body.get("errors"))
        return {"_error": True, "status": 422, "body": str(body)[:500]}
    msg_id = (body.get("message_ids") or [None])[0]
    logger.info("mailtrap sent → %s · id=%s", to, msg_id)
    return {"message_id": msg_id, "status": r.status_code}


async def _send_postmark(to: str, subject: str, html: str):
    """Send via Postmark transactional REST API.
    https://postmarkapp.com/developer/user-guide/send-email-with-api

    Endpoint: POST https://api.postmarkapp.com/email
    Auth: X-Postmark-Server-Token: <POSTMARK_API_KEY>
    Note: SENDER_EMAIL must be verified as a Sender Signature in the
    Postmark dashboard (Sender Signatures tab) before sends succeed —
    otherwise Postmark returns 422 with ErrorCode 300.
    """
    payload = {
        "From": f"{SENDER_NAME} <{SENDER_EMAIL}>",
        "To": to,
        "Subject": subject,
        "HtmlBody": html,
        "MessageStream": POSTMARK_MESSAGE_STREAM,
        "TrackOpens": False,
    }
    headers = {
        "X-Postmark-Server-Token": POSTMARK_API_KEY,
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(
            "https://api.postmarkapp.com/email",
            json=payload, headers=headers,
        )
    if r.status_code >= 400:
        logger.warning("postmark error %d → %s: %s", r.status_code, to, r.text[:300])
        return {"_error": True, "status": r.status_code, "body": r.text[:500]}
    body = r.json() if r.content else {}
    # Postmark returns ErrorCode=0 on success, MessageID is a UUID.
    if body.get("ErrorCode") and int(body.get("ErrorCode") or 0) != 0:
        logger.warning(
            "postmark logical error %s → %s: %s",
            body.get("ErrorCode"), to, body.get("Message"),
        )
        return {"_error": True, "status": 422, "body": str(body)[:500]}
    msg_id = body.get("MessageID")
    logger.info("postmark sent → %s · id=%s", to, msg_id)
    return {"message_id": msg_id, "status": r.status_code}


async def _send_sender(to: str, subject: str, html: str):
    """Send via Sender.net transactional REST API.
    https://api.sender.net/transactional-campaigns/send-transactional/

    Endpoint: POST https://api.sender.net/v2/message/send
    Auth: Bearer <SENDER_API_KEY>
    Free tier: 15,000 emails/month, no daily cap (60 req/min rate limit).
    Domain craftersmarket.org must have SPF + DKIM records added in the
    Sender.net dashboard (Account settings → Domains) before sends succeed.
    """
    payload = {
        "from": {"email": SENDER_EMAIL, "name": SENDER_NAME},
        "to": {"email": to},
        "subject": subject,
        "html": html,
    }
    headers = {
        "Authorization": f"Bearer {SENDER_API_KEY}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(
            "https://api.sender.net/v2/message/send",
            json=payload, headers=headers,
        )
    if r.status_code >= 400:
        logger.warning("sender.net error %d → %s: %s", r.status_code, to, r.text[:300])
        return {"_error": True, "status": r.status_code, "body": r.text[:500]}
    body = r.json() if r.content else {}
    msg_id = body.get("message_id") or body.get("id")
    logger.info("sender.net sent → %s · id=%s", to, msg_id)
    return {"message_id": msg_id, "status": r.status_code}


async def _send_mailersend(to: str, subject: str, html: str):
    """Send via MailerSend's transactional REST API.
    https://developers.mailersend.com/api/v1/email"""
    payload = {
        "from": {"email": SENDER_EMAIL, "name": SENDER_NAME},
        "to": [{"email": to}],
        "subject": subject,
        "html": html,
    }
    headers = {
        "Authorization": f"Bearer {MAILERSEND_API_KEY}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(
            "https://api.mailersend.com/v1/email", json=payload, headers=headers,
        )
    if r.status_code >= 400:
        logger.warning("mailersend error %d → %s: %s", r.status_code, to, r.text[:300])
        return {"_error": True, "status": r.status_code, "body": r.text[:500]}
    msg_id = r.headers.get("X-Message-Id") or r.headers.get("x-message-id")
    logger.info("mailersend sent → %s · id=%s", to, msg_id)
    return {"message_id": msg_id, "status": r.status_code}


async def _send_brevo(to: str, subject: str, html: str):
    """Send via Brevo's transactional REST API.
    https://developers.brevo.com/reference/sendtransacemail"""
    payload = {
        "sender": {"name": SENDER_NAME, "email": SENDER_EMAIL},
        "to": [{"email": to}],
        "subject": subject,
        "htmlContent": html,
    }
    headers = {
        "api-key": BREVO_API_KEY,
        "accept": "application/json",
        "content-type": "application/json",
    }
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(
            "https://api.brevo.com/v3/smtp/email", json=payload, headers=headers,
        )
    if r.status_code >= 400:
        # Surface the Brevo error body in logs so config issues are easy to spot.
        logger.warning("brevo error %d → %s: %s", r.status_code, to, r.text[:300])
        return None
    body = r.json() if r.content else {}
    logger.info("brevo sent → %s · id=%s", to, body.get("messageId"))
    return body


async def _send_resend(to: str, subject: str, html: str):
    """Legacy Resend send."""
    try:
        params = {
            "from": f"{SENDER_NAME} <{SENDER_EMAIL}>",
            "to": [to], "subject": subject, "html": html,
        }
        result = await asyncio.to_thread(resend.Emails.send, params)
        logger.info("resend sent → %s · id=%s", to,
                    getattr(result, "get", lambda *_: None)("id"))
        return result
    except Exception as e:
        logger.exception("resend failed → %s: %s", to, e)
        return None


async def _send_via(provider: str, to: str, subject: str, html: str):
    """Single dispatch — returns provider result dict or None."""
    if provider == "mailgun":
        return await _send_mailgun(to, subject, html)
    if provider == "mailtrap":
        return await _send_mailtrap(to, subject, html)
    if provider == "postmark":
        return await _send_postmark(to, subject, html)
    if provider == "sender":
        return await _send_sender(to, subject, html)
    if provider == "mailersend":
        return await _send_mailersend(to, subject, html)
    if provider == "brevo":
        return await _send_brevo(to, subject, html)
    return await _send_resend(to, subject, html)


def _provider_has_key(provider: str) -> bool:
    return bool({
        "mailgun": MAILGUN_API_KEY and MAILGUN_DOMAIN,
        "mailtrap": MAILTRAP_API_KEY,
        "postmark": POSTMARK_API_KEY,
        "sender": SENDER_API_KEY, "mailersend": MAILERSEND_API_KEY,
        "brevo": BREVO_API_KEY, "resend": RESEND_API_KEY,
    }.get(provider))


async def _send(to: str, subject: str, html: str):
    if not _has_provider() or not to:
        logger.warning("email skipped (no key or recipient): %s", subject)
        await _record_event({
            "to": to or "", "subject": subject, "provider": EMAIL_PROVIDER,
            "status": "skipped", "error_code": None, "error_body": "no_key_or_recipient",
        })
        return None

    # Build the fallback chain. Skip empty slots, missing API keys, and any
    # exact-duplicate consecutive providers (so a misconfigured deploy can't
    # waste two slots on the same vendor).
    chain = [EMAIL_PROVIDER]
    for fb in (EMAIL_FALLBACK_PROVIDER, EMAIL_FALLBACK_PROVIDER_2):
        if fb and fb != chain[-1] and _provider_has_key(fb):
            chain.append(fb)

    last_err_code = None
    last_err_body = None
    for idx, provider in enumerate(chain):
        result = await _send_via(provider, to, subject, html)
        failed = (
            result is None
            or (isinstance(result, dict) and result.get("_error"))
        )
        if not failed:
            # Success — log against THIS provider.
            status = "sent" if idx == 0 else "sent_via_fallback"
            await _record_event({
                "to": to, "subject": subject, "provider": provider,
                "status": status,
                "message_id": (result or {}).get("message_id"),
            })
            return result
        # Capture the failure for the audit trail.
        last_err_code = result.get("status") if isinstance(result, dict) else None
        last_err_body = result.get("body") if isinstance(result, dict) else "transport_error"
        await _record_event({
            "to": to, "subject": subject, "provider": provider,
            "status": "failed", "error_code": last_err_code,
            "error_body": (last_err_body or "")[:500],
        })
        # If there's another provider in the chain, log the fall-through.
        if idx + 1 < len(chain):
            logger.warning(
                "[email] %s failed (%s) — falling back to %s",
                provider, last_err_code, chain[idx + 1],
            )
    # All providers in the chain failed.
    return None


async def _record_event(row: dict) -> None:
    """Best-effort persistence — never break the email send if Mongo is down."""
    try:
        from core import db, now_iso
        import uuid as _uuid
        await db.email_events.insert_one({
            "id": str(_uuid.uuid4()),
            "to": row.get("to") or "",
            "subject": (row.get("subject") or "")[:240],
            "provider": row.get("provider") or "",
            "status": row.get("status") or "unknown",
            "message_id": row.get("message_id"),
            "error_code": row.get("error_code"),
            "error_body": row.get("error_body"),
            "created_at": now_iso(),
        })
    except Exception:
        # Persistence is observability — never break the user-visible flow.
        pass


def _shell(title: str, intro: str, body_html: str, footer: str = "") -> str:
    return f"""
    <div style="background:#0a0a0a;padding:40px 16px;font-family:'JetBrains Mono','Courier New',monospace;color:#e5e5e5">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px;margin:0 auto;background:#121212;border:1px solid #262626">
        <tr><td style="padding:32px 32px 24px;border-bottom:1px solid #262626">
          <div style="font-size:11px;letter-spacing:0.3em;color:#ff4500;text-transform:uppercase">◆ Crafters Market</div>
          <h1 style="font-family:Impact,'Arial Black',sans-serif;font-size:42px;line-height:1;margin:14px 0 0;color:#e5e5e5;text-transform:uppercase;letter-spacing:-0.01em">{title}</h1>
        </td></tr>
        <tr><td style="padding:24px 32px">
          <p style="font-size:14px;line-height:1.6;color:#a3a3a3;margin:0 0 20px">{intro}</p>
          {body_html}
        </td></tr>
        <tr><td style="padding:20px 32px;border-top:1px solid #262626;font-size:10px;letter-spacing:0.22em;color:#525252;text-transform:uppercase">
          {footer or "Precision craft · delivered."} · craftersmarket.org
        </td></tr>
      </table>
    </div>"""


def _items_table(items: list[dict]) -> str:
    """Render the order line-items table. Personalization (text + image
    URL, from iter150) is rendered as a sub-row beneath each line item
    when present — invisible no-op when the buyer didn't personalize.
    Used by buyer receipt, maker order alert, ops digest.
    """
    parts: list[str] = []
    for i in items:
        qty = int(i.get("quantity", 1))
        line_total = float(i.get("price", 0)) * qty
        parts.append(
            "<tr>"
            f"<td style='padding:10px 0;border-bottom:1px solid #262626;color:#e5e5e5'>"
            f"{i.get('title', '')} × {qty}</td>"
            f"<td style='padding:10px 0;border-bottom:1px solid #262626;text-align:right;"
            f"color:#ff4500'>${line_total:.2f}</td>"
            "</tr>"
        )
        # iter150 — personalization breakdown right under the item it
        # belongs to. Caller (checkout.py) sets these on each line dict
        # before passing into us.
        pers_text = (i.get("personalization_text") or "").strip()
        pers_img = (i.get("personalization_image_url") or "").strip()
        if pers_text or pers_img:
            inner_bits: list[str] = []
            if pers_text:
                # Escape user input — this is buyer-submitted free text
                # and we render it in the maker's inbox. Newlines → <br>.
                safe = (pers_text
                        .replace("&", "&amp;")
                        .replace("<", "&lt;")
                        .replace(">", "&gt;")
                        .replace("\n", "<br>"))
                inner_bits.append(
                    "<div style='font-size:13px;color:#e5e5e5;line-height:1.55;"
                    "margin-bottom:8px'><span style='color:#ff4500'>◆ </span>"
                    f"{safe}</div>"
                )
            if pers_img:
                inner_bits.append(
                    "<div style='margin-top:8px'>"
                    f"<a href='{pers_img}' style='display:inline-block'>"
                    f"<img src='{pers_img}' alt='Buyer reference image' "
                    "style='max-width:260px;max-height:200px;border:1px solid #262626;"
                    "display:block' />"
                    f"</a><div style='margin-top:6px'><a href='{pers_img}' "
                    "style='font-size:11px;color:#ff4500;text-transform:uppercase;"
                    "letter-spacing:0.22em;text-decoration:none'>"
                    "↗ Open full-size</a></div>"
                    "</div>"
                )
            parts.append(
                "<tr><td colspan='2' style='padding:4px 0 14px;"
                "border-bottom:1px solid #262626'>"
                "<div style='background:#1a0a05;border-left:3px solid #ff4500;"
                "padding:14px 16px;margin-top:4px'>"
                "<div style='font-size:10px;color:#ff4500;text-transform:uppercase;"
                "letter-spacing:0.22em;margin-bottom:8px'>"
                "◆ Buyer personalization</div>"
                f"{''.join(inner_bits)}"
                "</div></td></tr>"
            )
    return (
        "<table width='100%' cellpadding='0' cellspacing='0' "
        f"style='font-size:13px;margin:8px 0 16px'>{''.join(parts)}</table>"
    )


async def send_buyer_receipt(buyer_email: str, summary: str, total: float, items: list[dict]):
    body = _items_table(items) if items else f"<p style='color:#e5e5e5'>{summary}</p>"
    body += f"<div style='border-top:1px solid #262626;padding-top:14px;display:flex;justify-content:space-between;font-size:14px'><span style='color:#a3a3a3;letter-spacing:0.22em;text-transform:uppercase;font-size:11px'>Total</span> <span style='color:#ff4500;font-family:Impact,sans-serif;font-size:28px;float:right'>${total:.2f}</span></div>"
    body += "<p style='font-size:13px;line-height:1.6;color:#a3a3a3;margin-top:24px'>Your makers have been notified. Each piece is built to order — expect a tracking email within 5–7 business days. Questions? Reply to this email anytime.</p>"

    # Per-maker review CTA — drives the order-confirmation high-engagement
    # moment into UGC. One CTA per unique maker (deduped).
    seen_makers = set()
    review_buttons = ""
    site = (os.environ.get("FRONTEND_URL") or "https://craftersmarket.org").rstrip("/")
    for it in items or []:
        slug = it.get("maker_slug")
        name = it.get("maker_name") or slug
        if not slug or slug in seen_makers:
            continue
        seen_makers.add(slug)
        link = (
            f"{site}/makers/{slug}#leave-review"
            f"?utm_source=email&utm_medium=transactional&utm_campaign=order-receipt-review"
        )
        review_buttons += (
            f"<a href='{link}' style='display:inline-block;margin:6px 8px 0 0;"
            "background:transparent;color:#ff4500;border:1px solid #ff4500;"
            "padding:10px 18px;font-family:JetBrains Mono,monospace;font-size:11px;"
            f"letter-spacing:0.22em;text-transform:uppercase;text-decoration:none'>★ Review {name}</a>"
        )
    if review_buttons:
        body += (
            "<div style='border-top:1px solid #262626;padding-top:18px;margin-top:24px'>"
            "<p style='font-size:11px;letter-spacing:0.22em;text-transform:uppercase;"
            "color:#a3a3a3;margin:0 0 6px'>◆ 30 seconds · big impact</p>"
            "<p style='font-size:13px;color:#e5e5e5;line-height:1.6;margin:0 0 12px'>"
            "When the piece arrives, drop your maker a quick review — it's the single biggest "
            "thing you can do to support an independent shop. Two taps."
            "</p>"
            f"<div style='line-height:1.8'>{review_buttons}</div>"
            "</div>"
        )

    html = _shell("Order Confirmed.", "Thanks for the order — here's your receipt.", body, "Order receipt")
    return await _send(buyer_email, "Your Crafters Market order is confirmed", html)


async def send_buyer_digital_downloads(
    buyer_email: str, summary: str, downloads: list[dict],
):
    """iter328 — Instant download email for digital + hybrid orders.

    Sent IN ADDITION to the regular receipt (which doesn't carry the
    file links for security reasons). Each download row links to the
    token-gated `/api/checkout/downloads/{token}` endpoint which 302s
    to the underlying R2 file.

    Tokens are valid for 30 days — we re-state that in the email so the
    buyer doesn't park them indefinitely and then complain when they
    expire.
    """
    if not buyer_email or not downloads:
        return
    site = (os.environ.get("FRONTEND_URL") or "https://craftersmarket.org").rstrip("/")
    api_base = (os.environ.get("BACKEND_URL") or site).rstrip("/")

    rows = ""
    for d in downloads:
        ext = (d.get("ext") or "").upper()
        size = d.get("size_bytes") or 0
        if size >= 1024 * 1024:
            size_h = f"{size / 1024 / 1024:.1f} MB"
        else:
            size_h = f"{max(1, round(size / 1024))} KB"
        url = f"{api_base}/api/checkout/downloads/{d.get('token')}"
        rows += (
            "<tr><td style='padding:10px 0;border-bottom:1px solid #262626'>"
            f"<div style='font-size:13px;color:#e5e5e5'>{d.get('filename')}</div>"
            f"<div style='font-size:10px;color:#737373;letter-spacing:0.18em;text-transform:uppercase;margin-top:4px'>{ext} · {size_h}</div>"
            "</td><td style='padding:10px 0;border-bottom:1px solid #262626;text-align:right'>"
            f"<a href='{url}' style='display:inline-block;background:#ff4500;color:#000;"
            "padding:10px 16px;font-family:JetBrains Mono,monospace;font-size:11px;"
            "letter-spacing:0.22em;text-transform:uppercase;text-decoration:none'>Download</a>"
            "</td></tr>"
        )
    table = (
        "<table cellpadding=0 cellspacing=0 width='100%' "
        "style='font-family:Helvetica,Arial,sans-serif;margin:8px 0 16px'>"
        f"{rows}</table>"
    )
    body = (
        f"<p style='font-size:13px;line-height:1.6;color:#a3a3a3;margin:0 0 16px'>"
        f"Your purchase: <span style='color:#e5e5e5'>{summary[:200]}</span>"
        "</p>"
        + table
        + "<p style='font-size:12px;line-height:1.6;color:#a3a3a3;margin:16px 0 0'>"
        "Download links are valid for <strong style='color:#e5e5e5'>30 days</strong>. "
        "Save the files locally — we don't keep a copy in your account. "
        "All digital sales are final."
        "</p>"
    )
    html = _shell(
        "Files Ready.",
        f"{len(downloads)} download{'s' if len(downloads) != 1 else ''} unlocked — grab them below.",
        body,
        "Instant download",
    )
    return await _send(
        buyer_email,
        f"Your Crafters Market files are ready ({len(downloads)} download{'s' if len(downloads) != 1 else ''})",
        html,
    )


async def send_buyer_review_prompt(
    buyer_email: str,
    buyer_name: str | None,
    items: list[dict],
    days_since_delivery: int,
):
    """7-day post-delivery review nudge (the moment with the highest
    conversion). Sends ONE email per order, with a per-maker CTA so
    multi-maker orders get one button per maker.

    Skips silently when there's no email or no items. Uses the same
    `_shell()` chrome as other transactional emails for visual parity.
    """
    if not buyer_email or not items:
        return
    site = (os.environ.get("FRONTEND_URL") or "https://craftersmarket.org").rstrip("/")
    seen_makers: set[str] = set()
    cta_html = ""
    for it in items:
        slug = it.get("maker_slug")
        name = it.get("maker_name") or slug
        if not slug or slug in seen_makers:
            continue
        seen_makers.add(slug)
        # The /makers/{slug}#leave-review anchor auto-scrolls + auto-focuses
        # the review form on arrival (already wired in MakerReviews.jsx).
        link = (
            f"{site}/makers/{slug}#leave-review"
            "?utm_source=email&utm_medium=transactional&utm_campaign=post-delivery-review"
        )
        cta_html += (
            f"<a href='{link}' style='display:block;margin:8px 0;"
            "background:#ff4500;color:#000;border:1px solid #ff4500;"
            "padding:14px 20px;font-family:JetBrains Mono,monospace;font-size:11px;"
            "letter-spacing:0.22em;text-transform:uppercase;text-decoration:none;"
            f"font-weight:bold'>★ Leave a review for {name} →</a>"
        )
    if not cta_html:
        return  # nothing to ask about (e.g. all items had no maker_slug)

    name_token = (buyer_name or "").split(" ", 1)[0] if buyer_name else ""
    body = (
        f"<p style='font-size:14px;color:#e5e5e5;margin:0 0 18px;line-height:1.6'>"
        f"{('Hey ' + name_token + ',') if name_token else 'Hey,'} hope your order's been "
        "settling in nicely. It's been about a week since it landed — got 30 seconds to drop "
        "a quick review?"
        "</p>"
        "<p style='font-size:13px;color:#a3a3a3;margin:0 0 22px;line-height:1.6'>"
        "Independent makers live and die on reviews. Yours is the single biggest thing you can "
        "do to support an indie shop — and the form is two taps once you click below."
        "</p>"
        f"<div style='margin:0 0 24px'>{cta_html}</div>"
        "<p style='font-size:11px;color:#525252;margin:18px 0 0;line-height:1.6'>"
        "We send this nudge once per order. Already reviewed? Thank you — you can ignore this. "
        "Was something not right? Reply to this email and we'll fix it personally."
        "</p>"
    )
    title = "How was it?"
    intro = (
        f"Your order delivered {days_since_delivery} days ago. Quick favor: "
        "drop your maker a review."
    )
    html = _shell(title, intro, body, "Post-delivery review nudge")
    return await _send(buyer_email, "Got 30 seconds? Quick review request.", html)


async def send_admin_edited_design_file(
    poster_email: str,
    poster_name: str,
    file_title: str,
    file_id: str,
    diff: dict,
):
    """Notify the poster that an admin tidied up their community design
    file. Surfaces the field-level diff so there's no mystery.

    `diff` is a dict of `{field: {"before": "...", "after": "..."}}`.
    Only fields that actually changed should be in the dict — empty
    diff = no email sent.
    """
    if not poster_email or not diff:
        return
    rows = ""
    for field, change in diff.items():
        before = (change.get("before") or "—")
        after = (change.get("after") or "—")
        # Truncate long values so the email stays scannable.
        if len(str(before)) > 240:
            before = str(before)[:240] + "…"
        if len(str(after)) > 240:
            after = str(after)[:240] + "…"
        rows += (
            "<tr>"
            f"<td style='padding:8px 0 4px;color:#a3a3a3;font-size:11px;letter-spacing:0.22em;text-transform:uppercase'>{field}</td>"
            "</tr>"
            "<tr>"
            f"<td style='padding:0 0 4px;color:#737373;font-size:13px;line-height:1.5;text-decoration:line-through'>{before}</td>"
            "</tr>"
            "<tr>"
            f"<td style='padding:0 0 14px;color:#e5e5e5;font-size:13px;line-height:1.5;border-bottom:1px solid #262626'>→ {after}</td>"
            "</tr>"
        )
    site = (os.environ.get("FRONTEND_URL") or "https://craftersmarket.org").rstrip("/")
    body = (
        "<p style='font-size:13px;color:#e5e5e5;margin:0 0 14px;line-height:1.6'>"
        f"Heads up{(' ' + poster_name) if poster_name else ''} — a Crafters Market admin made some tidy-up edits to your community design file "
        f"<b style='color:#ff4500'>{file_title}</b>. Here's the diff:"
        "</p>"
        "<table width='100%' cellpadding='0' cellspacing='0' style='font-size:13px;border-top:1px solid #262626;margin-bottom:18px'>"
        f"{rows}"
        "</table>"
        "<p style='font-size:12px;color:#a3a3a3;line-height:1.6;margin:0 0 18px'>"
        "Admins typically only fix typos or normalize titles for search. If you think this was made in error, you can update the listing yourself "
        f"or <a href='mailto:{OPS_EMAIL or 'team@craftersmarket.org'}' style='color:#ff4500'>reply to this email</a>.</p>"
        f"<p style='margin:0'><a href='{site}/community/files/{file_id}' "
        "style='display:inline-block;padding:12px 18px;background:#ff4500;color:#000;font-family:JetBrains Mono,monospace;font-size:11px;letter-spacing:0.22em;text-transform:uppercase;font-weight:bold;text-decoration:none'>"
        "View your file →</a></p>"
    )
    html = _shell(
        "Admin Edit.",
        "We tidied up your design file — here's exactly what changed.",
        body,
        "Moderation note",
    )
    return await _send(poster_email, f"Crafters Market: edit on \"{file_title}\"", html)


async def send_ops_new_order(summary: str, total: float, items: list[dict], buyer_email: str | None):
    if not OPS_EMAIL: return
    body = _items_table(items) if items else f"<p>{summary}</p>"
    body += f"<div style='border-top:1px solid #262626;padding-top:14px;font-size:13px;color:#e5e5e5'><b style='color:#ff4500'>Total: ${total:.2f}</b></div>"
    if buyer_email:
        body += f"<p style='font-size:13px;color:#a3a3a3;margin-top:16px'>Buyer: <a href='mailto:{buyer_email}' style='color:#ff4500'>{buyer_email}</a></p>"
    html = _shell("New Order.", "A new order just landed in the workshop queue.", body, "Maker / ops alert")
    return await _send(OPS_EMAIL, f"New order · ${total:.2f}", html)


async def send_ops_new_application(name: str, studio: str, location: str, email: str, about: str):
    if not OPS_EMAIL: return
    body = f"""
      <table width='100%' cellpadding='0' cellspacing='0' style='font-size:13px;border-top:1px solid #262626'>
        {''.join(f"<tr><td style='padding:8px 0;color:#a3a3a3;font-size:11px;letter-spacing:0.22em;text-transform:uppercase'>{k}</td><td style='padding:8px 0;color:#e5e5e5;text-align:right'>{v}</td></tr>" for k,v in [('Studio', studio), ('Applicant', name), ('Location', location), ('Email', email)])}
      </table>
      <p style='font-size:13px;color:#e5e5e5;margin-top:18px;line-height:1.6'>{about}</p>"""
    html = _shell("Maker Application.", "A new maker just applied to the program.", body, "Maker / ops alert")
    return await _send(OPS_EMAIL, f"New maker application · {studio}", html)


async def send_applicant_received(applicant_email: str, name: str, studio: str,
                                  is_beta: bool = False):
    """Sent to the applicant immediately after they submit a maker (or
    Founding Seller Beta) application — a warm thank-you that confirms
    receipt and sets a 3–5 business-day review expectation. When
    `is_beta=True` we add a small Founding Seller flair to the header
    and subject; the core message and timeline stay identical so we have
    one source of truth for both flows."""
    if not applicant_email:
        return None
    program_label = "Founding Seller Beta" if is_beta else "Maker program"
    flair = (
        "<div style='display:inline-block;padding:4px 10px;border:1px solid #ff4500;"
        "border-radius:999px;font-family:JetBrains Mono,monospace;font-size:10px;"
        "letter-spacing:0.22em;text-transform:uppercase;color:#ff4500;margin:0 0 14px'>"
        "◆ Founding Seller Beta</div>"
        if is_beta else ""
    )
    body = (
        f"{flair}"
        "<p style='font-size:14px;color:#e5e5e5;line-height:1.6;margin:0 0 18px'>"
        f"Hi {name}, thank you for your application for "
        f"<b style='color:#ff4500'>{studio}</b>. It's currently under review."
        "</p>"
        "<div style='border-top:1px solid #262626;padding-top:18px;margin:18px 0'>"
        "<div style='font-family:JetBrains Mono,monospace;font-size:10px;letter-spacing:0.22em;"
        "text-transform:uppercase;color:#a3a3a3;margin:0 0 12px'>What happens next</div>"
        "<ol style='font-size:13px;color:#e5e5e5;line-height:1.7;padding-left:20px;margin:0'>"
        "<li>Expect <b style='color:#e5e5e5'>3-5 business days</b> for a founding-team member to review your application.</li>"
        "<li>If we have any questions about your application, we'll email you directly — just reply to this thread.</li>"
        "<li>If you're a fit, we'll send a welcome packet with your sign-in link, listing template, and Stripe payouts setup.</li>"
        "</ol>"
        "</div>"
        "<p style='font-size:13px;color:#a3a3a3;line-height:1.6;margin:18px 0 0'>"
        "While you wait — keep your portfolio sharp, and start thinking about your first 3 listings. "
        "The fastest path to launch day is having photos + descriptions ready when you get the green light."
        "</p>"
        "<p style='font-size:12px;color:#525252;line-height:1.6;margin-top:24px'>"
        "Questions? Just reply — this email goes straight to the team."
        "</p>"
    )
    headline = (
        "Founding Seller Application Received." if is_beta
        else "Application Received."
    )
    html = _shell(
        headline,
        "Thanks for applying — your application is currently under review.",
        body, f"{program_label} · application",
    )
    subject_prefix = "Founding Seller application received" if is_beta \
        else "We got your Crafters Market application"
    return await _send(
        applicant_email,
        f"{subject_prefix} · {studio}",
        html,
    )


async def send_ops_new_custom_order(name: str, email: str, project_type: str, material: str, description: str, budget: str | None):
    if not OPS_EMAIL: return
    body = f"""
      <table width='100%' cellpadding='0' cellspacing='0' style='font-size:13px;border-top:1px solid #262626'>
        {''.join(f"<tr><td style='padding:8px 0;color:#a3a3a3;font-size:11px;letter-spacing:0.22em;text-transform:uppercase'>{k}</td><td style='padding:8px 0;color:#e5e5e5;text-align:right'>{v or '—'}</td></tr>" for k,v in [('Project', project_type), ('Material', material), ('Budget', budget), ('Buyer', name), ('Email', email)])}
      </table>
      <p style='font-size:13px;color:#e5e5e5;margin-top:18px;line-height:1.6'>{description}</p>"""
    html = _shell("Custom Brief.", "A new custom order is ready for review.", body, "Maker / ops alert")
    return await _send(OPS_EMAIL, f"New custom brief · {project_type}", html)


async def send_buyer_custom_ack(buyer_email: str, name: str, project_type: str, tracking_number: str | None = None):
    site_url = os.environ.get("PUBLIC_SITE_URL", "https://craftersmarket.org")
    track_link = (
        f"<p style='font-size:13px;color:#a3a3a3;line-height:1.6;margin-top:14px'>"
        f"Your tracking number: <b style='color:#ff4500;font-family:monospace;letter-spacing:1px'>{tracking_number}</b><br/>"
        f"Check the status anytime: <a href='{site_url}/track/{tracking_number}' style='color:#ff4500'>{site_url}/track/{tracking_number}</a></p>"
    ) if tracking_number else ""
    body = (
        f"<p style='font-size:13px;color:#a3a3a3;line-height:1.6'>Hi {name}, we received your <b style='color:#e5e5e5'>{project_type}</b> brief and a maker will review it within 24 hours. We'll send a free quote — no commitment.</p>"
        f"{track_link}"
    )
    html = _shell("Brief Received.", "Thanks for the custom request.", body, "Custom queue")
    return await _send(buyer_email, "We got your custom brief", html)


async def send_buyer_shipped(
    buyer_email: str, buyer_name: str | None,
    tracking_number: str, carrier: str,
    items: list[dict] | None = None,
    total: float | None = None,
    order_id: str | None = None,
    tracking_url: str | None = None,
):
    """Fired the moment a maker either buys a Shippo label OR manually
    pastes a tracking number into the dashboard. The buyer gets a clean
    receipt-style summary (line items + total) PLUS the tracking number,
    carrier, and a deep-link button so they can monitor the package.

    Carrier deep-links default to the carrier's own track-by-number page
    when `tracking_url` isn't supplied. Order id is included in the
    subject when present so the buyer's mailbox sorts naturally."""
    if not buyer_email:
        return None
    name = (buyer_name or "there").split()[0]
    site = (os.environ.get("PUBLIC_SITE_URL") or os.environ.get("FRONTEND_URL")
            or "https://craftersmarket.org").rstrip("/")
    carrier_clean = (carrier or "").strip()
    carrier_lc = carrier_clean.lower()
    # Carrier deep-link fallbacks. tracking_url (when supplied by Shippo)
    # always wins because it's pre-built for the exact carrier+number.
    if not tracking_url and tracking_number:
        if "usps" in carrier_lc:
            tracking_url = f"https://tools.usps.com/go/TrackConfirmAction?tLabels={tracking_number}"
        elif "ups" in carrier_lc:
            tracking_url = f"https://www.ups.com/track?tracknum={tracking_number}"
        elif "fedex" in carrier_lc:
            tracking_url = f"https://www.fedex.com/fedextrack/?trknbr={tracking_number}"
        elif "dhl" in carrier_lc:
            tracking_url = f"https://www.dhl.com/en/express/tracking.html?AWB={tracking_number}"

    body = (
        f"<p style='font-size:14px;color:#e5e5e5;line-height:1.6;margin:0 0 18px'>"
        f"Hi {name}, your Crafters Market order is on the way.</p>"
        # Tracking pill
        "<div style='border:1px solid #ff4500;padding:18px;margin:0 0 22px'>"
        "<div style='font-family:JetBrains Mono,monospace;font-size:10px;letter-spacing:0.22em;"
        "text-transform:uppercase;color:#ff4500;margin:0 0 6px'>◆ Tracking number</div>"
        f"<div style='font-family:JetBrains Mono,monospace;font-size:18px;color:#e5e5e5;"
        f"letter-spacing:1px;margin:0 0 8px;word-break:break-all'>{tracking_number}</div>"
        f"<div style='font-family:JetBrains Mono,monospace;font-size:11px;color:#a3a3a3;"
        f"letter-spacing:0.18em;text-transform:uppercase;margin:0 0 14px'>via {carrier_clean or 'carrier'}</div>"
    )
    if tracking_url:
        body += (
            f"<a href='{tracking_url}' style='display:inline-block;background:#ff4500;color:#0a0a0a;"
            "padding:12px 22px;font-family:Impact,Arial Black,sans-serif;font-size:13px;letter-spacing:0.18em;"
            f"text-transform:uppercase;text-decoration:none;border:1px solid #ff4500'>Track package →</a>"
        )
    body += "</div>"

    # Receipt summary so the email doubles as a record of what shipped
    if items:
        body += (
            "<div style='font-family:JetBrains Mono,monospace;font-size:10px;letter-spacing:0.22em;"
            "text-transform:uppercase;color:#a3a3a3;margin:0 0 8px'>What's in the box</div>"
        )
        body += _items_table(items)
    if total is not None:
        body += (
            f"<div style='border-top:1px solid #262626;padding-top:14px;font-size:13px;color:#e5e5e5'>"
            f"<span style='color:#a3a3a3;letter-spacing:0.22em;text-transform:uppercase;font-size:11px'>"
            f"Order total</span> <span style='color:#ff4500;font-family:Impact,sans-serif;font-size:24px;"
            f"float:right;line-height:1'>${total:.2f}</span>"
            "<div style='clear:both'></div></div>"
        )
    if order_id:
        body += (
            f"<p style='font-family:JetBrains Mono,monospace;font-size:10px;color:#525252;"
            f"letter-spacing:0.18em;text-transform:uppercase;margin-top:14px'>"
            f"Order: <a href='{site}/track/{tracking_number}' style='color:#ff4500'>"
            f"{order_id[:14]}…</a></p>"
        )
    body += (
        "<p style='font-size:13px;color:#a3a3a3;line-height:1.6;margin-top:22px'>"
        "Carrier-side scans usually appear within 24-48 hours. Reply to this email "
        "anytime if anything looks off — it goes straight to the maker.</p>"
    )

    html = _shell(
        "Shipped.",
        f"Your package is on the way · {carrier_clean or 'carrier'}",
        body, "Shipping notification",
    )
    subj_suffix = f" · order {order_id[:8]}" if order_id else ""
    return await _send(
        buyer_email,
        f"Shipped · {tracking_number} · {carrier_clean or 'carrier'}{subj_suffix}",
        html,
    )

async def send_buyer_restock_signup(
    buyer_email: str, buyer_name: str, product_title: str, maker_name: str,
):
    """Soft confirmation that the buyer is on the restock waitlist.
    Sent the moment they hit "Notify when restocked" on a 0-stock listing.
    Mirrors the backorder-received tone but sets a different expectation —
    no maker decision required, just a one-shot email when stock returns."""
    if not buyer_email:
        return None
    body = (
        f"<p style='font-size:14px;color:#e5e5e5;line-height:1.6;margin:0 0 18px'>"
        f"Hi {buyer_name.split()[0] if buyer_name else 'there'}, you're on the restock waitlist for "
        f"<b style='color:#ff4500'>{product_title}</b> from {maker_name}.</p>"
        "<p style='font-size:13px;color:#a3a3a3;line-height:1.6'>"
        "We'll email you the moment this listing is back in stock — single email, no marketing, no follow-ups. "
        "If you'd rather not wait, the maker may also be open to a custom backorder.</p>"
    )
    html = _shell(
        "On the restock list.",
        f"We'll ping you the moment {product_title} is back.",
        body, "Restock waitlist",
    )
    return await _send(
        buyer_email,
        f"You're on the restock list · {product_title}",
        html,
    )


async def send_buyer_restocked(
    buyer_email: str, buyer_name: str, product_title: str,
    product_url: str, maker_name: str,
):
    """Restock notification — fired the next time stock goes from 0 → +."""
    if not buyer_email:
        return None
    body = (
        f"<p style='font-size:14px;color:#e5e5e5;line-height:1.6;margin:0 0 18px'>"
        f"Good news, {buyer_name.split()[0] if buyer_name else 'there'} — "
        f"<b style='color:#ff4500'>{product_title}</b> is back in stock at {maker_name}.</p>"
        f"<a href='{product_url}' style='display:inline-block;"
        "background:#ff4500;color:#0a0a0a;padding:14px 26px;font-family:Impact,Arial Black,sans-serif;"
        "font-size:14px;letter-spacing:0.18em;text-transform:uppercase;text-decoration:none;"
        "border:1px solid #ff4500'>Buy now →</a>"
        "<p style='font-size:12px;color:#525252;line-height:1.6;margin-top:18px'>"
        "Stock can sell out quickly. This is a one-shot notification — you won't be on the list again unless you opt back in.</p>"
    )
    html = _shell(
        "Restocked.",
        f"{product_title} is available again.",
        body, "Restock alert",
    )
    return await _send(
        buyer_email,
        f"Back in stock · {product_title}",
        html,
    )


async def send_buyer_backorder_received(
    buyer_email: str, buyer_name: str, product_title: str,
    lead_weeks: int, maker_name: str,
):
    """Confirmation that the request was logged. Sets the maker's
    expected lead time as a concrete number of weeks so the buyer knows
    when to expect a yes/no."""
    if not buyer_email:
        return None
    body = (
        f"<p style='font-size:14px;color:#e5e5e5;line-height:1.6;margin:0 0 18px'>"
        f"Hi {buyer_name.split()[0] if buyer_name else 'there'}, your backorder request for "
        f"<b style='color:#ff4500'>{product_title}</b> has been sent to {maker_name}.</p>"
        "<div style='border:1px solid #262626;padding:18px;margin:18px 0'>"
        "<div style='font-family:JetBrains Mono,monospace;font-size:10px;letter-spacing:0.22em;"
        "text-transform:uppercase;color:#a3a3a3;margin:0 0 10px'>Lead time</div>"
        f"<div style='font-family:Impact,sans-serif;font-size:28px;color:#ff4500;line-height:1'>"
        f"~{lead_weeks} {'week' if lead_weeks == 1 else 'weeks'}</div>"
        "<div style='font-family:JetBrains Mono,monospace;font-size:11px;color:#525252;margin-top:6px'>"
        "from the day the maker accepts</div></div>"
        "<p style='font-size:13px;color:#a3a3a3;line-height:1.6'>"
        f"{maker_name} will review your request and reach out by email — usually within 2 business days. "
        "Payment is collected only once they accept and confirm. No charge today."
        "</p>"
    )
    html = _shell(
        "Backorder request received.",
        f"We forwarded it to {maker_name}.",
        body, "Backorders",
    )
    return await _send(
        buyer_email,
        f"Backorder request received · {product_title}",
        html,
    )


async def send_maker_backorder_alert(
    maker_email: str, maker_name: str, buyer_name: str, buyer_email: str,
    product_title: str, quantity: int, message: str,
):
    if not maker_email:
        return None
    site = (os.environ.get("PUBLIC_SITE_URL") or os.environ.get("FRONTEND_URL")
            or "https://craftersmarket.org").rstrip("/")
    body = (
        f"<p style='font-size:14px;color:#e5e5e5;line-height:1.6;margin:0 0 18px'>"
        f"Hi {maker_name}, you have a new backorder request for "
        f"<b style='color:#ff4500'>{product_title}</b>.</p>"
        "<div style='border:1px solid #262626;padding:16px;margin:18px 0;font-size:13px;color:#e5e5e5;line-height:1.7'>"
        f"<div><span style='color:#a3a3a3'>Buyer:</span> {buyer_name} · "
        f"<a href='mailto:{buyer_email}' style='color:#ff4500'>{buyer_email}</a></div>"
        f"<div><span style='color:#a3a3a3'>Quantity:</span> {quantity}</div>"
    )
    if message:
        body += (
            "<div style='border-top:1px solid #1f1f1f;margin-top:10px;padding-top:10px'>"
            "<div style='color:#a3a3a3;font-size:11px;text-transform:uppercase;letter-spacing:0.22em;margin-bottom:6px'>Message</div>"
            f"<div style='color:#e5e5e5'>{message}</div></div>"
        )
    body += "</div>"
    body += (
        f"<a href='{site}/maker/dashboard?tab=orders' style='display:inline-block;"
        "background:#ff4500;color:#0a0a0a;padding:12px 22px;font-family:Impact,Arial Black,sans-serif;"
        "font-size:13px;letter-spacing:0.18em;text-transform:uppercase;text-decoration:none;"
        "border:1px solid #ff4500'>Review backorder →</a>"
        "<p style='font-size:12px;color:#525252;line-height:1.6;margin-top:18px'>"
        "Open the Backorders sub-tab inside Orders to accept or decline. "
        "Buyers see your decision via email; payment is handled off-platform after you accept.</p>"
    )
    html = _shell(
        "New backorder request.",
        f"{buyer_name} wants to backorder a piece.",
        body, "Maker backorder alert",
    )
    return await _send(
        maker_email,
        f"Backorder request · {product_title} · {buyer_name}",
        html,
    )


async def send_buyer_backorder_accepted(
    buyer_email: str, buyer_name: str, product_title: str, lead_weeks: int,
    maker_name: str, maker_email: str,
):
    if not buyer_email:
        return None
    name = buyer_name.split()[0] if buyer_name else "there"
    contact = (
        f"<a href='mailto:{maker_email}' style='color:#ff4500'>{maker_email}</a>"
        if maker_email else "the maker directly"
    )
    body = (
        f"<p style='font-size:14px;color:#e5e5e5;line-height:1.6;margin:0 0 18px'>"
        f"Great news, {name} — {maker_name} accepted your backorder request for "
        f"<b style='color:#ff4500'>{product_title}</b>.</p>"
        "<div style='border:1px solid #ff4500;padding:18px;margin:18px 0'>"
        "<div style='font-family:JetBrains Mono,monospace;font-size:10px;letter-spacing:0.22em;"
        "text-transform:uppercase;color:#ff4500;margin:0 0 8px'>◆ Confirmed lead time</div>"
        f"<div style='font-family:Impact,sans-serif;font-size:32px;color:#e5e5e5;line-height:1'>"
        f"~{lead_weeks} {'week' if lead_weeks == 1 else 'weeks'}</div></div>"
        "<p style='font-size:13px;color:#e5e5e5;line-height:1.6'>"
        f"{maker_name} will be in touch shortly to coordinate payment and shipping. "
        f"Reply to this email or contact them directly: {contact}.</p>"
        "<p style='font-size:12px;color:#525252;line-height:1.6;margin-top:14px'>"
        "Crafters Market doesn't process backorder payments — these are handled directly between "
        "you and the maker so they can quote materials, customizations, and shipping accurately."
        "</p>"
    )
    html = _shell(
        "Backorder accepted.",
        f"{maker_name} confirmed your request.",
        body, "Backorders",
    )
    return await _send(
        buyer_email,
        f"Backorder accepted · {product_title}",
        html,
    )


async def send_buyer_backorder_declined(
    buyer_email: str, buyer_name: str, product_title: str,
    maker_name: str, reason: str,
):
    if not buyer_email:
        return None
    name = buyer_name.split()[0] if buyer_name else "there"
    body = (
        f"<p style='font-size:14px;color:#e5e5e5;line-height:1.6;margin:0 0 18px'>"
        f"Hi {name}, {maker_name} isn't able to fulfill your backorder request for "
        f"<b style='color:#e5e5e5'>{product_title}</b> right now.</p>"
    )
    if reason:
        body += (
            "<div style='border-left:2px solid #ff4500;padding:6px 14px;margin:18px 0;"
            f"font-size:13px;color:#e5e5e5;line-height:1.6'>{reason}</div>"
        )
    body += (
        "<p style='font-size:13px;color:#a3a3a3;line-height:1.6'>"
        "Don't take it personally — capacity, materials availability, and "
        "seasonal workloads all factor in. You're welcome to browse other makers' "
        "shops or check back later when stock is restored."
        "</p>"
    )
    html = _shell(
        "Backorder update.",
        f"From {maker_name}",
        body, "Backorders",
    )
    return await _send(
        buyer_email,
        f"Backorder update · {product_title}",
        html,
    )




async def send_buyer_delivered(
    buyer_email: str, buyer_name: str | None,
    tracking_number: str, carrier: str,
    items: list[dict] | None = None, maker_slugs: list[str] | None = None,
):
    """Fired once, from the Shippo `track_updated` webhook, when tracking
    status first transitions to DELIVERED. Includes a per-maker review CTA
    so we capitalise on the delivery moment for UGC. Idempotency is
    enforced at the call site (webhook writes `delivered_email_sent=True`
    on the order tx doc before calling this)."""
    site = (os.environ.get("PUBLIC_SITE_URL") or os.environ.get("FRONTEND_URL") or "https://craftersmarket.org").rstrip("/")
    name = (buyer_name or "there").split()[0]
    body = (
        f"<p style='font-size:14px;color:#e5e5e5;line-height:1.6'>Hi {name}, your package just arrived.</p>"
        f"<p style='font-size:13px;color:#a3a3a3;line-height:1.6'>"
        f"Tracking: <b style='color:#ff4500;font-family:monospace;letter-spacing:1px'>{tracking_number}</b>"
        f" · via {carrier}</p>"
    )
    if items:
        body += _items_table(items)

    # Per-maker review CTA — same pattern as buyer_receipt, but triggered
    # at delivery which is a much higher-intent moment than order-confirm.
    review_buttons = ""
    seen = set()
    for slug in (maker_slugs or []):
        if not slug or slug in seen:
            continue
        seen.add(slug)
        link = (
            f"{site}/makers/{slug}#leave-review"
            f"?utm_source=email&utm_medium=transactional&utm_campaign=delivered-review"
        )
        review_buttons += (
            f"<a href='{link}' style='display:inline-block;margin:6px 8px 0 0;"
            "background:transparent;color:#ff4500;border:1px solid #ff4500;"
            "padding:10px 18px;font-family:JetBrains Mono,monospace;font-size:11px;"
            f"letter-spacing:0.22em;text-transform:uppercase;text-decoration:none'>★ Review {slug}</a>"
        )
    if review_buttons:
        body += (
            "<div style='border-top:1px solid #262626;padding-top:18px;margin-top:24px'>"
            "<p style='font-size:11px;letter-spacing:0.22em;text-transform:uppercase;"
            "color:#a3a3a3;margin:0 0 6px'>◆ Was the craft worth the wait?</p>"
            "<p style='font-size:13px;color:#e5e5e5;line-height:1.6;margin:0 0 12px'>"
            "Leave a quick review — it's the single biggest thing you can do to "
            "support an independent maker.</p>"
            f"<div style='line-height:1.8'>{review_buttons}</div>"
            "</div>"
        )
    html = _shell("Delivered.", "Your Crafters Market package has arrived.", body, "Delivery notification")
    return await _send(buyer_email, f"Delivered · {carrier} · {tracking_number}", html)



async def send_maker_new_order(maker_email: str, maker_name: str,
                               items: list, subtotal: float,
                               buyer_email: str | None):
    if not maker_email:
        return None
    body = _items_table(items) if items else ""
    body += f"<div style='border-top:1px solid #262626;padding-top:14px;font-size:13px;color:#e5e5e5'>Subtotal for your shop: <b style='color:#ff4500'>${subtotal:.2f}</b></div>"
    if buyer_email:
        body += f"<p style='font-size:13px;color:#a3a3a3;margin-top:16px'>Buyer: <a href='mailto:{buyer_email}' style='color:#ff4500'>{buyer_email}</a></p>"
    # Deep-link to the Orders tab so the maker can print labels / mark
    # shipped in one click. `?tab=orders` (not `#orders`) because email
    # link-rewriters often strip URL fragments.
    site = (os.environ.get("PUBLIC_SITE_URL") or os.environ.get("FRONTEND_URL")
            or "https://craftersmarket.org").rstrip("/")
    body += (
        f"<div style='margin-top:22px'>"
        f"<a href='{site}/maker/dashboard?tab=orders' style='display:inline-block;"
        "background:#ff4500;color:#0a0a0a;padding:12px 22px;font-family:Impact,Arial Black,sans-serif;"
        "font-size:13px;letter-spacing:0.18em;text-transform:uppercase;text-decoration:none;"
        "border:1px solid #ff4500'>Open orders tab →</a></div>"
    )
    body += "<p style='font-size:13px;color:#a3a3a3;line-height:1.6;margin-top:18px'>Reach out to the buyer with an ETA and tracking info as you build. Crafters Market handles the payout — you handle the craft.</p>"
    html = _shell(f"Order for {maker_name}.", "A new piece is on your bench.", body, "Maker order alert")
    return await _send(maker_email, f"New order · ${subtotal:.2f} · {maker_name}", html)


async def send_maker_low_stock(maker_email: str, maker_name: str,
                               items: list[dict]):
    """`items` is [{title, in_stock, slug}, ...] — already filtered to <3 stock."""
    if not maker_email or not items:
        return None
    rows = "".join(
        f"<tr><td style='padding:10px 0;border-bottom:1px solid #262626;color:#e5e5e5'>{i['title']}</td>"
        f"<td style='padding:10px 0;border-bottom:1px solid #262626;color:#ff4500;font-weight:bold;text-align:right'>{i['in_stock']} left</td></tr>"
        for i in items
    )
    body = (
        "<p style='font-size:14px;color:#e5e5e5;line-height:1.6;margin:0 0 18px'>"
        f"Heads up {maker_name} — these listings just dropped below 3 in stock after a sale. "
        "Restock or update quantities so buyers don't miss out.</p>"
        f"<table style='width:100%;border-collapse:collapse;font-size:13px'>"
        "<thead><tr><th style='text-align:left;color:#a3a3a3;font-weight:normal;font-size:11px;text-transform:uppercase;letter-spacing:0.2em;padding:0 0 10px;border-bottom:1px solid #262626'>Listing</th>"
        "<th style='text-align:right;color:#a3a3a3;font-weight:normal;font-size:11px;text-transform:uppercase;letter-spacing:0.2em;padding:0 0 10px;border-bottom:1px solid #262626'>Stock</th></tr></thead>"
        f"<tbody>{rows}</tbody></table>"
    )
    html = _shell("Stock alert.", "Inventory's running thin.", body, "Maker · low stock")
    return await _send(maker_email, f"Low stock · {len(items)} listing{'s' if len(items) > 1 else ''} · {maker_name}", html)


async def send_maker_listing_renewed(
    maker_email: str, maker_name: str, product_title: str,
    product_slug: str, new_expiry_iso: str,
):
    """Sent after the scheduler auto-renews a listing on the maker's behalf.
    The maker opted into automatic renewal — this is a confirmation, not an
    action request."""
    if not maker_email:
        return None
    try:
        from datetime import datetime as _dt
        nice_date = _dt.fromisoformat(
            new_expiry_iso.replace("Z", "+00:00"),
        ).strftime("%b %d, %Y")
    except Exception:
        nice_date = new_expiry_iso
    base = os.environ.get("PUBLIC_APP_URL") or "https://craftersmarket.org"
    listing_url = f"{base}/shop/{product_slug}"
    body = (
        "<p style='font-size:14px;color:#e5e5e5;line-height:1.6;margin:0 0 18px'>"
        f"Hi {maker_name}, your listing <strong style='color:#ff4500'>{product_title}</strong> "
        "just auto-renewed for another 4 months — buyers can keep finding it without "
        "any action from you.</p>"
        "<div style='border-left:3px solid #ff4500;padding:14px 18px;background:#0d0d0d;margin:18px 0'>"
        "<div style='font-size:11px;color:#a3a3a3;text-transform:uppercase;letter-spacing:0.22em;margin-bottom:6px'>"
        "Renewed through</div>"
        f"<div style='font-size:16px;color:#ff4500;font-weight:bold'>{nice_date}</div>"
        "</div>"
        f"<a href='{listing_url}' style='display:inline-block;background:#ff4500;color:#0a0a0a;"
        "padding:14px 26px;font-family:Impact,Arial Black,sans-serif;font-size:13px;letter-spacing:0.18em;"
        "text-transform:uppercase;text-decoration:none;border:1px solid #ff4500'>View listing →</a>"
        "<p style='font-size:12px;color:#525252;margin-top:24px;line-height:1.6'>"
        "Want to stop auto-renewing? Edit this listing → Renewal options → Manual.</p>"
    )
    html = _shell(
        "Listing renewed.", "Your shop kept moving — no action needed.",
        body, "Maker · auto-renew",
    )
    return await _send(maker_email, f"Auto-renewed · {product_title}", html)


async def send_maker_listing_expiring_soon(
    maker_email: str, maker_name: str, product_title: str,
    product_slug: str, expires_at_iso: str,
):
    """Sent ~7 days before a manual-renewal listing expires. Nudges the
    maker to either flip renewal to automatic or hit the renew button."""
    if not maker_email:
        return None
    try:
        from datetime import datetime as _dt
        nice_date = _dt.fromisoformat(
            expires_at_iso.replace("Z", "+00:00"),
        ).strftime("%b %d, %Y")
    except Exception:
        nice_date = expires_at_iso
    base = os.environ.get("PUBLIC_APP_URL") or "https://craftersmarket.org"
    edit_url = f"{base}/maker/listings/{product_slug}/edit"
    body = (
        "<p style='font-size:14px;color:#e5e5e5;line-height:1.6;margin:0 0 18px'>"
        f"Hi {maker_name}, your listing <strong style='color:#ff4500'>{product_title}</strong> "
        "is set to manual renewal and will expire in about a week. Once it expires, "
        "it auto-flips to draft and stops showing up in search.</p>"
        "<div style='border-left:3px solid #ff4500;padding:14px 18px;background:#0d0d0d;margin:18px 0'>"
        "<div style='font-size:11px;color:#a3a3a3;text-transform:uppercase;letter-spacing:0.22em;margin-bottom:6px'>"
        "Expires</div>"
        f"<div style='font-size:16px;color:#ff4500;font-weight:bold'>{nice_date}</div>"
        "</div>"
        "<p style='font-size:13px;color:#e5e5e5;line-height:1.6;margin:18px 0 12px'>"
        "Two quick options:</p>"
        "<ol style='font-size:13px;color:#e5e5e5;line-height:1.7;padding-left:18px;margin:0 0 18px'>"
        "<li>Switch this listing to <strong>Automatic</strong> renewal — we'll keep it live "
        "without any pings.</li>"
        "<li>Open the editor and hit the renew button when you're ready.</li>"
        "</ol>"
        f"<a href='{edit_url}' style='display:inline-block;background:#ff4500;color:#0a0a0a;"
        "padding:14px 26px;font-family:Impact,Arial Black,sans-serif;font-size:13px;letter-spacing:0.18em;"
        "text-transform:uppercase;text-decoration:none;border:1px solid #ff4500'>Open editor →</a>"
        "<p style='font-size:12px;color:#525252;margin-top:24px;line-height:1.6'>"
        "You're receiving this because the listing's renewal mode is set to manual. "
        "You can change it any time inside the editor.</p>"
    )
    html = _shell(
        "Expires soon.", "One click away from another 4 months live.",
        body, "Maker · expiry reminder",
    )
    return await _send(maker_email, f"Expires in 7 days · {product_title}", html)


async def send_maker_renewal_digest(
    maker_email: str, maker_name: str, listings: list[dict],
):
    """One-per-day digest of all manual-renewal listings expiring inside
    the reminder window for this maker. Replaces the older per-listing
    "expires in 7 days" email blast — quieter inbox, more actionable.

    `listings` is the already-sorted (soonest-first) list of expiring
    items: each row needs `slug`, `title`, `expires_at` (ISO).
    """
    if not maker_email or not listings:
        return None
    base = os.environ.get("PUBLIC_APP_URL") or "https://craftersmarket.org"
    renewals_url = f"{base}/maker/dashboard?tab=renewals"

    def _fmt(iso: str) -> str:
        try:
            from datetime import datetime as _dt
            return _dt.fromisoformat(iso.replace("Z", "+00:00")).strftime("%b %d")
        except Exception:
            return iso

    rows = "".join(
        "<tr>"
        f"<td style='padding:10px 14px;border-bottom:1px solid #1a1a1a;font-size:13px;color:#e5e5e5'>"
        f"<a href='{base}/maker/listings/{li['slug']}/edit' style='color:#e5e5e5;text-decoration:none'>"
        f"{li.get('title') or li['slug']}</a></td>"
        f"<td style='padding:10px 14px;border-bottom:1px solid #1a1a1a;font-size:12px;color:#ff4500;text-align:right;font-family:monospace'>"
        f"{_fmt(li.get('expires_at') or '')}</td>"
        "</tr>"
        for li in listings
    )
    n = len(listings)
    plural = "" if n == 1 else "s"
    body = (
        "<p style='font-size:14px;color:#e5e5e5;line-height:1.6;margin:0 0 16px'>"
        f"Hi {maker_name}, "
        f"<strong style='color:#ff4500'>{n} manual-renewal listing{plural}</strong> "
        f"expire{'s' if n == 1 else ''} in the next week. After that they auto-flip "
        "to draft and stop showing up in search.</p>"
        "<table style='width:100%;border-collapse:collapse;margin:18px 0;background:#0d0d0d;border:1px solid #262626'>"
        f"<thead><tr>"
        "<th style='padding:10px 14px;text-align:left;border-bottom:1px solid #262626;"
        "font-family:monospace;font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:#a3a3a3'>Listing</th>"
        "<th style='padding:10px 14px;text-align:right;border-bottom:1px solid #262626;"
        "font-family:monospace;font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:#a3a3a3'>Expires</th>"
        f"</tr></thead><tbody>{rows}</tbody></table>"
        "<p style='font-size:13px;color:#e5e5e5;line-height:1.6;margin:18px 0 12px'>"
        "Two quick options:</p>"
        "<ol style='font-size:13px;color:#e5e5e5;line-height:1.7;padding-left:18px;margin:0 0 18px'>"
        "<li>Open the <strong>Renewals tab</strong> to bulk-renew, bulk-pause, or "
        "flip everything to automatic renewal.</li>"
        "<li>Pick a listing above and refresh it before the deadline.</li>"
        "</ol>"
        f"<a href='{renewals_url}' style='display:inline-block;background:#ff4500;color:#0a0a0a;"
        "padding:14px 26px;font-family:Impact,Arial Black,sans-serif;font-size:13px;letter-spacing:0.18em;"
        "text-transform:uppercase;text-decoration:none;border:1px solid #ff4500'>Open renewals →</a>"
        "<p style='font-size:12px;color:#525252;margin-top:24px;line-height:1.6'>"
        "You're receiving this digest because at least one of your listings has "
        "renewal mode set to manual. Switch any listing to automatic in the editor "
        "and it will stop appearing here.</p>"
    )
    html = _shell(
        f"{n} listing{plural} expiring soon.",
        "Bulk-renew, switch to auto, or pause from the Renewals tab.",
        body, "Maker · renewal digest",
    )
    return await _send(
        maker_email, f"Renewals digest · {n} listing{plural} expiring soon", html,
    )


# iter334c — Weekly AI pricing digest
async def send_maker_pricing_digest(
    maker_email: str, maker_name: str, flagged: list[dict],
    underpriced: list[dict] | None = None,
):
    """Sent weekly to makers who have one or more listings priced ≥20%
    above the AI-derived market median (from the `price_comparisons`
    collection populated by the AI Price Check feature).

    iter334g — Now also includes a complementary "underpriced
    opportunities" section listing items 20%+ BELOW market median so
    makers can capture upside. Either list can be empty (but at least
    one will have content when this is called).

    `flagged` / `underpriced` rows look like:
        { slug, title, listed_price, market_median, delta_pct }
    For `flagged`, delta_pct is positive (>= +20). For `underpriced`,
    it's negative (<= -20). Sorted highest-abs-delta first per section.
    """
    flagged = flagged or []
    underpriced = underpriced or []
    if not maker_email or (not flagged and not underpriced):
        return None
    base = os.environ.get("PUBLIC_APP_URL") or "https://craftersmarket.org"
    n_above = len(flagged)
    n_below = len(underpriced)
    total = n_above + n_below

    def _row(li: dict, accent: str = "#ff4500") -> str:
        slug = li.get("slug") or ""
        title = li.get("title") or slug
        lp = float(li.get("listed_price") or 0)
        med = float(li.get("market_median") or 0)
        delta = int(round(float(li.get("delta_pct") or 0)))
        sign = "+" if delta >= 0 else ""
        return (
            "<tr>"
            f"<td style='padding:10px 14px;border-bottom:1px solid #1a1a1a;font-size:13px;color:#e5e5e5'>"
            f"<a href='{base}/maker/listings/{slug}/edit' style='color:#e5e5e5;text-decoration:none'>"
            f"{title}</a></td>"
            f"<td style='padding:10px 14px;border-bottom:1px solid #1a1a1a;font-size:12px;text-align:right;font-family:monospace;color:#e5e5e5'>"
            f"${lp:.0f}</td>"
            f"<td style='padding:10px 14px;border-bottom:1px solid #1a1a1a;font-size:12px;text-align:right;font-family:monospace;color:#a3a3a3'>"
            f"${med:.0f}</td>"
            f"<td style='padding:10px 14px;border-bottom:1px solid #1a1a1a;font-size:12px;text-align:right;font-family:monospace;color:{accent};font-weight:bold'>"
            f"{sign}{delta}%</td>"
            "</tr>"
        )

    def _table(rows_html: str, header_text: str, header_accent: str) -> str:
        return (
            f"<p style='font-size:11px;font-family:monospace;letter-spacing:0.22em;text-transform:uppercase;color:{header_accent};margin:24px 0 10px'>"
            f"◆ {header_text}</p>"
            "<table style='width:100%;border-collapse:collapse;margin:0 0 8px;background:#0d0d0d;border:1px solid #262626'>"
            "<thead><tr>"
            "<th style='padding:10px 14px;text-align:left;border-bottom:1px solid #262626;font-family:monospace;font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:#a3a3a3'>Listing</th>"
            "<th style='padding:10px 14px;text-align:right;border-bottom:1px solid #262626;font-family:monospace;font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:#a3a3a3'>Yours</th>"
            "<th style='padding:10px 14px;text-align:right;border-bottom:1px solid #262626;font-family:monospace;font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:#a3a3a3'>Market</th>"
            "<th style='padding:10px 14px;text-align:right;border-bottom:1px solid #262626;font-family:monospace;font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:#a3a3a3'>Delta</th>"
            f"</tr></thead><tbody>{rows_html}</tbody></table>"
        )

    # Intro — phrased based on which sections are present.
    if n_above and n_below:
        intro = (
            f"<strong style='color:#ff4500'>{n_above} above</strong> · "
            f"<strong style='color:#22d3ee'>{n_below} below</strong> market"
        )
        framing = ("Two-sided pricing pulse this week — listings above market may need a "
                   "trim, listings below market are leaving money on the table.")
    elif n_above:
        intro = f"<strong style='color:#ff4500'>{n_above} of your listing{'s' if n_above != 1 else ''}</strong> priced above market"
        framing = ("Doesn't mean you should drop prices — premium positioning works — "
                   "but worth a look if anything is sitting in the catalog without sales.")
    else:
        intro = f"<strong style='color:#22d3ee'>{n_below} of your listing{'s' if n_below != 1 else ''}</strong> priced below market"
        framing = ("These are potential upside. If they're selling well, you may be able to "
                   "raise prices and keep volume; if they're slow, the price isn't the issue.")

    above_table = _table("".join(_row(li, "#ff4500") for li in flagged[:10]),
                         f"Above market · {n_above}", "#ff4500") if n_above else ""
    below_table = _table("".join(_row(li, "#22d3ee") for li in underpriced[:10]),
                         f"Below market · {n_below}", "#22d3ee") if n_below else ""

    body = (
        "<p style='font-size:14px;color:#e5e5e5;line-height:1.6;margin:0 0 16px'>"
        f"Hi {maker_name}, your weekly pricing pulse: {intro}.</p>"
        f"<p style='font-size:13px;color:#a3a3a3;line-height:1.6;margin:0 0 8px'>{framing}</p>"
        f"{above_table}"
        f"{below_table}"
        "<p style='font-size:13px;color:#e5e5e5;line-height:1.6;margin:24px 0 12px'>"
        "Want a fresh second opinion? Open any listing → <strong>◆ AI Price Check</strong> "
        "(next to the price field). It pulls live web comparables and gives you a sharp "
        "recommendation in under 10 seconds.</p>"
        f"<a href='{base}/maker/dashboard#listings' style='display:inline-block;background:#ff4500;color:#0a0a0a;"
        "padding:14px 26px;font-family:Impact,Arial Black,sans-serif;font-size:13px;letter-spacing:0.18em;"
        "text-transform:uppercase;text-decoration:none;border:1px solid #ff4500'>Open my listings →</a>"
        "<p style='font-size:12px;color:#525252;margin-top:24px;line-height:1.6'>"
        "Reading this every week is opt-out: go to "
        f"<a href='{base}/maker/dashboard?tab=settings#notifications' style='color:#737373'>profile settings → notifications</a> → "
        "toggle <em>Weekly AI pricing digest</em>. Market median is derived from real comparable items "
        "and is a starting point, not financial advice.</p>"
    )
    # Headline + subhead vary so the email feels intentional, not templated.
    if n_above and n_below:
        headline = f"{n_above} above · {n_below} below market."
    elif n_above:
        headline = f"{n_above} listing{'s' if n_above != 1 else ''} priced 20%+ above market."
    else:
        headline = f"{n_below} listing{'s' if n_below != 1 else ''} priced 20%+ below market."

    html = _shell(
        headline,
        "AI-derived comparables · weekly pricing pulse.",
        body, "Maker · pricing digest",
    )
    # Subject too — mention the dominant side.
    if n_above and n_below:
        subject = f"Pricing digest · {n_above} above + {n_below} below market"
    elif n_above:
        subject = f"Pricing digest · {n_above} listing{'s' if n_above != 1 else ''} above market"
    else:
        subject = f"Pricing digest · {n_below} listing{'s' if n_below != 1 else ''} below market (upside)"
    return await _send(maker_email, subject, html)


async def send_maker_smart_paused(
    maker_email: str, maker_name: str, paused_count: int,
    threshold_days: int, samples: list[dict] | None = None,
):
    """Sent after the Smart-Pause scheduler hides listings with zero
    pageviews in the last `threshold_days` window. Includes optimisation
    tips and links to re-publish so makers can act in one click.

    `samples` is a small list of {title, slug} we paused, capped at 5,
    rendered as a quick-glance list.
    """
    if not maker_email or paused_count <= 0:
        return None
    base = os.environ.get("PUBLIC_APP_URL") or "https://craftersmarket.org"
    dash_url = f"{base}/maker/dashboard#listings"
    sample_rows = ""
    if samples:
        items = "".join(
            f"<li style='font-size:13px;color:#e5e5e5;margin:6px 0'>"
            f"<a href='{base}/maker/listings/{s['slug']}/edit' style='color:#ff4500'>"
            f"{s.get('title') or s['slug']}</a></li>"
            for s in samples[:5]
        )
        sample_rows = f"<ul style='padding-left:18px;margin:14px 0 18px'>{items}</ul>"
    body = (
        "<p style='font-size:14px;color:#e5e5e5;line-height:1.6;margin:0 0 18px'>"
        f"Hi {maker_name}, Smart Pause kicked in: "
        f"<strong style='color:#ff4500'>{paused_count} listing"
        f"{'' if paused_count == 1 else 's'}</strong> with zero pageviews in "
        f"the last {threshold_days} days "
        "were quietly moved to draft. Nothing is gone — they're waiting for "
        "you in the editor.</p>"
        f"{sample_rows}"
        "<div style='border-left:3px solid #ff4500;padding:14px 18px;background:#0d0d0d;margin:18px 0'>"
        "<div style='font-size:11px;color:#a3a3a3;text-transform:uppercase;letter-spacing:0.22em;margin-bottom:8px'>"
        "Why this happened</div>"
        "<p style='font-size:13px;color:#e5e5e5;line-height:1.6;margin:0'>"
        "You opted into Smart Pause to stop quietly-stale listings from "
        "dragging down your shop's search ranking. We only paused listings "
        "that had zero visitors in the entire window — they're not the "
        "problem, they're being missed.</p></div>"
        "<p style='font-size:13px;color:#e5e5e5;line-height:1.6;margin:18px 0 12px'>"
        "Two quick wins before you republish:</p>"
        "<ol style='font-size:13px;color:#e5e5e5;line-height:1.7;padding-left:18px;margin:0 0 18px'>"
        "<li><strong>Rephotograph the hero image.</strong> Listings with a "
        "lifestyle shot (not a white background) get 2-3× the click-through.</li>"
        "<li><strong>Refresh the SEO tags.</strong> The editor has an AI tag "
        "suggester — usually finds 3-4 tags you wouldn't have thought of.</li>"
        "</ol>"
        f"<a href='{dash_url}' style='display:inline-block;background:#ff4500;color:#0a0a0a;"
        "padding:14px 26px;font-family:Impact,Arial Black,sans-serif;font-size:13px;letter-spacing:0.18em;"
        "text-transform:uppercase;text-decoration:none;border:1px solid #ff4500'>Review drafts →</a>"
        "<p style='font-size:12px;color:#525252;margin-top:24px;line-height:1.6'>"
        "Want to turn Smart Pause off? Maker dashboard → Settings → Smart Pause.</p>"
    )
    html = _shell(
        "Smart Pause.", "Hiding stale listings so your strong ones stand out.",
        body, "Maker · smart pause",
    )
    return await _send(
        maker_email,
        f"Smart Pause · {paused_count} listing{'' if paused_count == 1 else 's'} moved to draft",
        html,
    )


async def send_maker_trial_ending_soon(
    maker_email: str, maker_name: str, trial_end_ts: int | None,
):
    """Stripe `customer.subscription.trial_will_end` notification — fires
    ~3 days before the 3-month Plus trial converts to paid. Lets the
    maker either confirm their card or cancel before the first charge."""
    if not maker_email:
        return None
    base = os.environ.get("PUBLIC_APP_URL") or "https://craftersmarket.org"
    billing_url = f"{base}/maker/dashboard#settings"
    end_str = "in 3 days"
    if trial_end_ts:
        try:
            from datetime import datetime as _dt, timezone as _tz
            end_str = "on " + _dt.fromtimestamp(
                int(trial_end_ts), tz=_tz.utc
            ).strftime("%b %d, %Y")
        except Exception:
            pass
    body = (
        f"<p style='font-size:14px;color:#e5e5e5;line-height:1.6;margin:0 0 18px'>"
        f"Hi {maker_name}, heads-up — your <strong style='color:#ff4500'>3-month "
        f"Crafters Plus trial</strong> ends {end_str}. After that, your card on "
        "file will be charged $12/month and Plus continues automatically.</p>"
        "<div style='border-left:3px solid #ff4500;padding:14px 18px;background:#0d0d0d;margin:18px 0'>"
        "<div style='font-size:11px;color:#a3a3a3;text-transform:uppercase;letter-spacing:0.22em;margin-bottom:8px'>"
        "What you keep with Plus</div>"
        "<ul style='font-size:13px;color:#e5e5e5;line-height:1.7;padding-left:18px;margin:0'>"
        "<li>15 free listings every month</li>"
        "<li>4% commission instead of 5%</li>"
        "<li>Priority placement in homepage rotations</li>"
        "<li>Custom shop banner image</li>"
        "</ul></div>"
        "<p style='font-size:13px;color:#e5e5e5;line-height:1.6;margin:18px 0 12px'>"
        "Nothing to do if you're happy — Plus continues automatically. "
        "Need to cancel or update your card? Use Manage billing below.</p>"
        f"<a href='{billing_url}' style='display:inline-block;background:#ff4500;color:#0a0a0a;"
        "padding:14px 26px;font-family:Impact,Arial Black,sans-serif;font-size:13px;letter-spacing:0.18em;"
        "text-transform:uppercase;text-decoration:none;border:1px solid #ff4500'>Manage billing →</a>"
        "<p style='font-size:12px;color:#525252;margin-top:24px;line-height:1.6'>"
        "Cancellation before the trial ends costs nothing — you keep Plus through "
        f"{end_str.replace('on ', '').replace('in 3 days', 'the trial end date')}.</p>"
    )
    html = _shell(
        "Trial ending soon.",
        "Your free Crafters Plus trial converts to paid in a few days.",
        body, "Plus · trial reminder",
    )
    return await _send(
        maker_email,
        "Your Crafters Plus trial ends soon",
        html,
    )




async def send_maker_magic_link(maker_email: str, maker_name: str, link: str):
    if not maker_email:
        return None
    body = (
        f"<p style='font-size:14px;color:#e5e5e5;line-height:1.6;margin:0 0 24px'>Hi {maker_name}, "
        "click below to sign in to your maker portal. The link is good for 15 minutes and works once.</p>"
        f"<a href='{link}' style='display:inline-block;background:#ff4500;color:#0a0a0a;"
        "padding:16px 28px;font-family:Impact,Arial Black,sans-serif;font-size:14px;letter-spacing:0.18em;"
        f"text-transform:uppercase;text-decoration:none;border:1px solid #ff4500'>Open Maker Portal →</a>"
        "<p style='font-size:11px;color:#525252;letter-spacing:0.18em;text-transform:uppercase;"
        f"margin:28px 0 0'>Or paste this URL</p><p style='font-size:12px;color:#a3a3a3;word-break:break-all'>"
        f"<a href='{link}' style='color:#ff4500'>{link}</a></p>"
        "<p style='font-size:12px;color:#525252;margin-top:24px;line-height:1.6'>"
        "If you didn't request this, ignore the email — no action is needed.</p>"
    )
    html = _shell("Sign In Link.", "Your maker portal is one click away.", body, "Maker portal · sign in")
    return await _send(maker_email, "Your Crafters Market sign-in link", html)


async def send_admin_magic_link(admin_email: str, link: str):
    if not admin_email:
        return None
    body = (
        "<p style='font-size:14px;color:#e5e5e5;line-height:1.6;margin:0 0 24px'>"
        "Click below to open the admin console. Good for 15 minutes, works once.</p>"
        f"<a href='{link}' style='display:inline-block;background:#ff4500;color:#0a0a0a;"
        "padding:16px 28px;font-family:Impact,Arial Black,sans-serif;font-size:14px;letter-spacing:0.18em;"
        f"text-transform:uppercase;text-decoration:none;border:1px solid #ff4500'>Open Admin Console →</a>"
        "<p style='font-size:11px;color:#525252;letter-spacing:0.18em;text-transform:uppercase;"
        f"margin:28px 0 0'>Or paste this URL</p><p style='font-size:12px;color:#a3a3a3;word-break:break-all'>"
        f"<a href='{link}' style='color:#ff4500'>{link}</a></p>"
        "<p style='font-size:12px;color:#525252;margin-top:24px;line-height:1.6'>"
        "If you didn't request this, ignore the email — no action is needed.</p>"
    )
    html = _shell("Admin Sign In.", "One-tap access to the operations console.", body, "Admin console")
    return await _send(admin_email, "Crafters Market admin sign-in link", html)


async def send_admin_team_invite(admin_email: str, capability_labels: str, link: str, invited_by: str):
    """Sent when a super admin grants admin access to a new email. Includes
    the assigned capabilities so the new admin knows what they can do."""
    if not admin_email:
        return None
    body = (
        "<p style='font-size:14px;color:#e5e5e5;line-height:1.6;margin:0 0 18px'>"
        f"<strong style='color:#ff4500'>{invited_by}</strong> added you as an admin on Crafters Market."
        "</p>"
        "<div style='border-left:3px solid #ff4500;padding:12px 18px;background:#0d0d0d;margin:16px 0'>"
        "<div style='font-size:11px;color:#a3a3a3;text-transform:uppercase;letter-spacing:0.22em;margin-bottom:8px'>"
        "Your access</div>"
        f"<div style='font-size:14px;color:#e5e5e5'>{capability_labels}</div>"
        "</div>"
        "<p style='font-size:14px;color:#e5e5e5;line-height:1.6;margin:18px 0'>"
        "Click below to sign in. Good for 15 minutes — request a fresh link any time at the admin sign-in page."
        "</p>"
        f"<a href='{link}' style='display:inline-block;background:#ff4500;color:#0a0a0a;"
        "padding:16px 28px;font-family:Impact,Arial Black,sans-serif;font-size:14px;letter-spacing:0.18em;"
        f"text-transform:uppercase;text-decoration:none;border:1px solid #ff4500'>Open Admin Console →</a>"
        "<p style='font-size:11px;color:#525252;letter-spacing:0.18em;text-transform:uppercase;margin:28px 0 0'>"
        "Or paste this URL</p>"
        f"<p style='font-size:12px;color:#a3a3a3;word-break:break-all'><a href='{link}' style='color:#ff4500'>{link}</a></p>"
    )
    html = _shell("You've been added as an admin.", "Welcome to the operations team.", body, "Admin console")
    return await _send(admin_email, "[Crafters Market] You've been added as an admin", html)



def render_application_decision_email(
    name: str, studio: str, approved: bool, note: str = "",
    sign_in_link: str = "",
    founder_number: Optional[int] = None,
    is_inaugural: bool = False,
) -> dict:
    """Pure renderer — returns `{subject, html}` without dispatching.
    Used by `send_application_decision` AND the admin preview endpoint
    so the QA preview is bit-for-bit identical to what gets sent.

    When `founder_number` is supplied (every Phase-2 approval gets one),
    we render a Founders-tier welcome panel near the top showing their
    number, status (Inaugural lifetime vs 12-month) and the tier perks.
    """
    title = "Welcome to the Workshop." if approved else "Application Update."
    intro = (
        f"Hi {name}, your studio {studio} is in. Here's everything you need to launch."
        if approved
        else f"Hi {name}, thanks for applying with {studio}. We're not moving forward right now."
    )
    if approved:
        site = (os.environ.get("FRONTEND_URL") or "https://craftersmarket.org").rstrip("/")
        link = sign_in_link or f"{site}/maker/login"
        # Founder tier banner (iter153) — every approved maker is now a
        # Founder. Render a numbered card with status so they immediately
        # understand what they're getting.
        founder_banner = ""
        if founder_number:
            badge_class = "Inaugural Founder" if is_inaugural else "Founder · 12-month"
            status_blurb = (
                "Lifetime perks. Your rate never changes."
                if is_inaugural
                else "12 months at this rate, then auto-rolls to Standard. We'll email you before that happens."
            )
            founder_banner = (
                "<div style='background:#0a0a0a;border:1px solid #ff4500;padding:18px 20px;margin:0 0 24px'>"
                "<div style='font-family:JetBrains Mono,monospace;font-size:10px;letter-spacing:0.3em;"
                "text-transform:uppercase;color:#ff4500;margin:0 0 6px'>◆ You're a Founder.</div>"
                f"<div style='font-family:Impact,Arial Black,sans-serif;font-size:32px;line-height:1;"
                f"color:#fafafa;margin:0 0 8px'>{badge_class} #{founder_number:03d}</div>"
                f"<div style='font-size:12px;color:#a3a3a3;line-height:1.55'>{status_blurb}</div>"
                "<ul style='font-size:12px;color:#e5e5e5;line-height:1.7;padding-left:18px;margin:12px 0 0'>"
                "<li><b>3% platform commission</b> (Standard pays 5%)</li>"
                "<li><b>50 free listings every month</b> (Standard gets 10 lifetime)</li>"
                "<li><b>$0 subscription</b> — no monthly fee</li>"
                "<li><b>◆ Founding Maker badge</b> on every product card and shop page</li>"
                "</ul></div>"
            )
        body = (
            founder_banner +
            "<p style='font-size:14px;color:#e5e5e5;line-height:1.6;margin:0 0 24px'>"
            "Your application's been approved. You now have access to the maker portal — your "
            "shop, listings, payouts, and analytics all live there."
            "</p>"
            f"<a href='{link}' style='display:inline-block;background:#ff4500;color:#0a0a0a;"
            "padding:16px 28px;font-family:Impact,Arial Black,sans-serif;font-size:14px;letter-spacing:0.18em;"
            f"text-transform:uppercase;text-decoration:none;border:1px solid #ff4500;margin-bottom:8px'>"
            "Open Maker Portal →</a>"
            "<p style='font-size:11px;color:#525252;letter-spacing:0.18em;text-transform:uppercase;margin:8px 0 32px'>"
            "Sign in with your application email · magic-link delivered each time"
            "</p>"

            "<div style='border-top:1px solid #262626;padding-top:20px;margin:24px 0'>"
            "<div style='font-family:JetBrains Mono,monospace;font-size:10px;letter-spacing:0.25em;"
            "text-transform:uppercase;color:#ff4500;margin:0 0 12px'>◆ Your launch checklist</div>"
            "<ol style='font-size:13px;color:#e5e5e5;line-height:1.8;padding-left:20px;margin:0'>"
            "<li><b>Connect Stripe</b> — Payouts tab → 5-min onboarding. Required before you can publish your first piece.</li>"
            "<li><b>Polish your profile</b> — Profile tab → portrait, location, bio, techniques. This is what buyers see first.</li>"
            "<li><b>Create your first 3 listings</b> — Listings tab → New Listing. Solid photos beat polished copy every time.</li>"
            "<li><b>Set up your shop</b> — pricing, dimensions, materials, optional 3D model. We auto-generate SEO meta tags.</li>"
            "</ol>"
            "</div>"

            "<div style='border-top:1px solid #262626;padding-top:20px;margin:24px 0'>"
            "<div style='font-family:JetBrains Mono,monospace;font-size:10px;letter-spacing:0.25em;"
            "text-transform:uppercase;color:#a3a3a3;margin:0 0 12px'>How payments + fees work</div>"
            "<ul style='font-size:13px;color:#e5e5e5;line-height:1.8;padding-left:20px;margin:0'>"
            "<li><b>Commission:</b> 3% for Founders (5% Standard, 4% Plus) + 2.9% + $0.30 payment processing per sale.</li>"
            "<li><b>Listings:</b> 50 free every month as a Founder (10 lifetime for Standard) · then $0.20 per publish or renewal · Plus pays $0.10.</li>"
            "<li><b>Listings auto-expire after 120 days</b> — one click to renew, your URL stays the same.</li>"
            "<li><b>Promote a listing for $5/week</b> to pin it to the top of search results. Veteran-owned makers get $10/mo in free boost credit.</li>"
            "<li><b>Payouts</b> route directly to your bank via Stripe Connect — no waiting on us to cut checks.</li>"
            "</ul>"
            "</div>"

            "<div style='border-top:1px solid #262626;padding-top:20px;margin:24px 0'>"
            "<div style='font-family:JetBrains Mono,monospace;font-size:10px;letter-spacing:0.25em;"
            "text-transform:uppercase;color:#a3a3a3;margin:0 0 12px'>Resources + support</div>"
            "<ul style='font-size:13px;color:#e5e5e5;line-height:1.8;padding-left:20px;margin:0'>"
            f"<li><a href='{site}/policy' style='color:#ff4500'>Maker Terms + Seller Agreement</a> (you accepted these on application)</li>"
            f"<li><a href='{site}/community/forum' style='color:#ff4500'>Maker forum</a> — share what's working, ask questions</li>"
            "<li>Reply to this email anytime — it goes straight to the founding team</li>"
            "</ul>"
            "</div>"
        )
        if note:
            body += (
                f"<p style='font-size:13px;color:#a3a3a3;line-height:1.6;margin-top:24px;"
                f"border-left:2px solid #ff4500;padding-left:14px'>{note}</p>"
            )
    else:
        blurb = (
            "We saw something interesting but the fit isn't quite there today. "
            "We keep notes — feel free to reapply once your portfolio grows."
        )
        body = f"<p style='font-size:14px;color:#e5e5e5;line-height:1.6'>{blurb}</p>"
        if note:
            body += (
                f"<p style='font-size:13px;color:#a3a3a3;line-height:1.6;margin-top:18px;"
                f"border-left:2px solid #ff4500;padding-left:14px'>{note}</p>"
            )
    html = _shell(title, intro, body, "Maker program")
    subject = (
        f"Welcome to Crafters Market, {studio} — your launch packet"
        if approved
        else f"Crafters Market application update — {studio}"
    )
    return {"subject": subject, "html": html}


async def send_application_decision(applicant_email: str, name: str, studio: str,
                                    approved: bool, note: str = "",
                                    sign_in_link: str = "",
                                    founder_number: Optional[int] = None,
                                    is_inaugural: bool = False):
    """Approval path emits a comprehensive welcome packet: sign-in link, first
    steps checklist, fee breakdown, support resources. Decline path stays
    short + kind."""
    rendered = render_application_decision_email(
        name, studio, approved, note=note, sign_in_link=sign_in_link,
        founder_number=founder_number, is_inaugural=is_inaugural,
    )
    return await _send(applicant_email, rendered["subject"], rendered["html"])


async def send_founder_expiry_warning(maker_email: str, name: str,
                                       founder_number: int, days_remaining: int):
    """Pre-expiry nudge sent at ~60 days out (month-10 mark) and ~14 days
    out (month-11.5 mark). Gives the maker time to upgrade to Plus
    before their rate jumps from 3% → 5% on auto-roll."""
    site = (os.environ.get("FRONTEND_URL") or "https://craftersmarket.org").rstrip("/")
    subj = f"Your Founder rate ends in {days_remaining} days — Crafters Market"
    body = (
        "<div style='background:#0a0a0a;border:1px solid #ff4500;padding:18px 20px;margin:0 0 24px'>"
        "<div style='font-family:JetBrains Mono,monospace;font-size:10px;letter-spacing:0.3em;"
        "text-transform:uppercase;color:#ff4500;margin:0 0 6px'>◆ Heads up, Founder.</div>"
        f"<div style='font-family:Impact,Arial Black,sans-serif;font-size:32px;line-height:1;"
        f"color:#fafafa;margin:0 0 8px'>{days_remaining} days remaining</div>"
        f"<div style='font-size:12px;color:#a3a3a3;line-height:1.55'>"
        f"Your 12-month Founder window (#{founder_number:03d}) is winding down. "
        f"After it ends, your commission rate goes from <b style='color:#fafafa'>3%</b> to "
        f"<b style='color:#fafafa'>5%</b> (Standard) unless you upgrade to Crafters Plus.</div>"
        "</div>"
        "<p style='font-size:14px;color:#e5e5e5;line-height:1.6;margin:0 0 16px'>"
        f"Hey {name}, you've been part of the founding 100 for nearly a year now. "
        "We wanted to give you a heads up before your rate changes so there are no surprises."
        "</p>"
        "<ul style='font-size:13px;color:#e5e5e5;line-height:1.8;padding-left:20px;margin:0 0 16px'>"
        "<li><b>Stay free at Standard tier</b> — 5% commission, 10 free listings. No action needed.</li>"
        "<li><b>Upgrade to Crafters Plus</b> — 4% commission, 100 free listings/mo, $15/mo boost credit, 24h support SLA. $12/mo.</li>"
        "</ul>"
        f"<p style='text-align:center;margin:24px 0'>"
        f"<a href='{site}/maker/dashboard?tab=subscription' style='display:inline-block;padding:14px 28px;"
        f"background:#ff4500;color:#000;font-family:JetBrains Mono,monospace;font-size:11px;"
        f"letter-spacing:0.22em;font-weight:bold;text-transform:uppercase;text-decoration:none'>"
        f"Upgrade to Plus &rarr;</a>"
        "</p>"
        "<p style='font-size:12px;color:#a3a3a3;line-height:1.6;margin:0'>"
        "No matter which path you take, your &#9670; Founding Maker badge and number are yours forever. "
        "Thank you for helping us launch Crafters Market."
        "</p>"
    )
    return await _send(maker_email, subj, body)


async def send_founder_farewell(maker_email: str, name: str, founder_number: int):
    """Sent the morning after a regular Founder auto-rolls to Standard.
    Tone: warm, grateful, never punitive. The Founder badge persists — only
    the commission rate changes."""
    site = (os.environ.get("FRONTEND_URL") or "https://craftersmarket.org").rstrip("/")
    subj = "Thank you for being a Founder — Crafters Market"
    body = (
        "<div style='background:#0a0a0a;border:1px solid #262626;padding:18px 20px;margin:0 0 24px'>"
        "<div style='font-family:JetBrains Mono,monospace;font-size:10px;letter-spacing:0.3em;"
        f"text-transform:uppercase;color:#a3a3a3;margin:0 0 6px'>&#9670; Founder #{founder_number:03d}</div>"
        "<div style='font-family:Impact,Arial Black,sans-serif;font-size:32px;line-height:1;"
        "color:#fafafa;margin:0 0 8px'>A year of building together.</div>"
        "<div style='font-size:12px;color:#a3a3a3;line-height:1.55'>"
        "Your Founder window has ended. You're now on Standard &mdash; but your badge stays.</div>"
        "</div>"
        f"<p style='font-size:14px;color:#e5e5e5;line-height:1.6;margin:0 0 16px'>"
        f"Hey {name}, we wanted to take a moment to say thank you. You shipped your first listings, "
        f"took your first orders, and helped us learn what Crafters Market should be. Your "
        "&#9670; Founding Maker badge is permanent &mdash; every product card you've ever published wears it forever."
        "</p>"
        "<p style='font-size:14px;color:#e5e5e5;line-height:1.6;margin:0 0 16px'>"
        "Here's what changes today: your commission goes from <b>3%</b> to <b>5%</b>, and your free listing "
        "quota changes from 50/month to 10 lifetime. If you'd rather keep growing without rate friction, "
        "Crafters Plus drops you back to 4% with 100 free listings/month for $12."
        "</p>"
        f"<p style='text-align:center;margin:24px 0'>"
        f"<a href='{site}/maker/dashboard?tab=subscription' style='display:inline-block;padding:14px 28px;"
        f"background:#ff4500;color:#000;font-family:JetBrains Mono,monospace;font-size:11px;"
        f"letter-spacing:0.22em;font-weight:bold;text-transform:uppercase;text-decoration:none'>"
        f"Explore Plus &rarr;</a>"
        "</p>"
        "<p style='font-size:12px;color:#a3a3a3;line-height:1.6;margin:0'>"
        "Whatever you choose, we're grateful you bet on us early."
        "</p>"
    )
    return await _send(maker_email, subj, body)



async def send_custom_order_quote(buyer_email: str, name: str, project_type: str,
                                  quote: float, message: str = ""):
    body = (
        "<p style='font-size:14px;color:#e5e5e5;line-height:1.6;margin:0 0 16px'>"
        f"Hi {name}, here's the quote for your <b style='color:#ff4500'>{project_type}</b> brief.</p>"
        "<div style='border-top:1px solid #262626;border-bottom:1px solid #262626;padding:18px 0;margin:18px 0'>"
        "<div style='font-family:JetBrains Mono,monospace;font-size:11px;letter-spacing:0.22em;"
        "text-transform:uppercase;color:#a3a3a3'>Estimated total</div>"
        f"<div style='font-family:Impact,sans-serif;font-size:44px;color:#ff4500;line-height:1;margin-top:8px'>${quote:.2f}</div>"
        "</div>"
    )
    if message:
        body += (
            f"<p style='font-size:13px;color:#a3a3a3;line-height:1.6;margin-top:8px'>{message}</p>"
        )
    body += (
        "<p style='font-size:12px;color:#525252;line-height:1.6;margin-top:18px'>"
        "Reply to this email to confirm or adjust the brief. We'll send a Stripe invoice once you're happy.</p>"
    )
    html = _shell("Your Quote.", "A maker just priced your brief.", body, "Custom queue")
    return await _send(buyer_email, f"Your Crafters Market quote · {project_type}", html)


async def send_maker_plus_roi_digest(
    maker_email: str, maker_name: str, gross_30d: float,
    commission_savings: float, net_benefit: float, upgrade_link: str,
):
    """Monthly upsell digest: shows what Plus would have saved this maker
    over the last 30 days. Only sent to free-tier makers above the threshold."""
    if not maker_email:
        return None
    pitch = (
        f"At ${gross_30d:.0f} sold this month, Crafters Plus would have netted you "
        f"<b style='color:#10b981'>+${net_benefit:.2f}</b> after the $12 subscription."
        if net_benefit >= 0
        else f"You're <b style='color:#ff4500'>${abs(net_benefit):.2f}</b> from break-even — "
             "one more big sale and Plus pays for itself."
    )
    body = (
        f"<p style='font-size:14px;color:#e5e5e5;line-height:1.6;margin:0 0 18px'>"
        f"Hey {maker_name}, here's a free-tier reality check from the last 30 days on Crafters Market:"
        "</p>"
        "<table style='width:100%;border-collapse:collapse;margin:18px 0'>"
        "<tr>"
        "<td style='width:50%;padding:18px;border:1px solid #262626;text-align:center'>"
        "<div style='font-family:JetBrains Mono,monospace;font-size:10px;letter-spacing:0.22em;"
        "text-transform:uppercase;color:#a3a3a3'>You sold (30d)</div>"
        f"<div style='font-family:Impact,sans-serif;font-size:38px;color:#e5e5e5;line-height:1;margin-top:8px'>${gross_30d:.0f}</div>"
        "</td>"
        "<td style='width:50%;padding:18px;border:1px solid #262626;border-left:none;text-align:center'>"
        "<div style='font-family:JetBrains Mono,monospace;font-size:10px;letter-spacing:0.22em;"
        "text-transform:uppercase;color:#a3a3a3'>Left on the table</div>"
        f"<div style='font-family:Impact,sans-serif;font-size:38px;color:#ff4500;line-height:1;margin-top:8px'>${commission_savings:.2f}</div>"
        "</td>"
        "</tr>"
        "</table>"
        f"<p style='font-size:14px;color:#e5e5e5;line-height:1.6;margin:18px 0'>{pitch}</p>"
        "<p style='font-size:13px;color:#a3a3a3;line-height:1.6;margin:0 0 24px'>"
        "Plus drops your commission from <b>5% → 4%</b>, gives you <b>15 free listings/month</b>, "
        "unlocks a <b>custom shop banner</b>, and adds advanced shop analytics. "
        "Cancel anytime, no contract."
        "</p>"
        f"<a href='{upgrade_link}' style='display:inline-block;background:#ff4500;color:#0a0a0a;"
        "padding:16px 28px;font-family:Impact,Arial Black,sans-serif;font-size:14px;letter-spacing:0.18em;"
        f"text-transform:uppercase;text-decoration:none;border:1px solid #ff4500'>Upgrade to Plus →</a>"
        "<p style='font-size:11px;color:#525252;line-height:1.6;margin-top:28px'>"
        "Numbers above are computed from your actual paid orders in the last 30 days. "
        "We send this digest once a month to free-tier makers who crossed our visibility threshold. "
        "Don't want them? <a href='" + upgrade_link.split('/maker')[0] +
        "/maker/dashboard?tab=billing' style='color:#a3a3a3'>Manage preferences</a>."
        "</p>"
    )
    html = _shell(
        "Plus would've paid off." if net_benefit >= 0 else "Plus is one sale away.",
        "Your monthly free-tier reality check.",
        body, "Crafters Plus · ROI digest",
    )
    subj = (
        f"You left ${commission_savings:.2f} on the table this month · {maker_name}"
        if net_benefit >= 0
        else f"You're ${abs(net_benefit):.2f} from Plus paying for itself · {maker_name}"
    )
    return await _send(maker_email, subj, html)



async def send_beta_feedback(name: str, email: str, message: str, page: str = ""):
    """Forward beta-mode feedback to the ops inbox so the team sees it instantly."""
    if not OPS_EMAIL:
        return
    safe_msg = (message or "").replace("<", "&lt;").replace(">", "&gt;").replace("\n", "<br/>")
    body = f"""
      <table width='100%' cellpadding='0' cellspacing='0' style='font-size:13px;border-top:1px solid #262626'>
        {''.join(f"<tr><td style='padding:8px 0;color:#a3a3a3;font-size:11px;letter-spacing:0.22em;text-transform:uppercase'>{k}</td><td style='padding:8px 0;color:#e5e5e5;text-align:right'>{v}</td></tr>" for k, v in [('Name', name), ('Email', email), ('Page', page or '—')])}
      </table>
      <div style='font-size:13px;color:#e5e5e5;margin-top:18px;line-height:1.6;border-left:2px solid #ff4500;padding:6px 14px;background:#0d0d0d'>{safe_msg}</div>
      <p style='font-size:11px;color:#a3a3a3;margin-top:18px'>Reply directly to <a href='mailto:{email}' style='color:#ff4500'>{email}</a> — they'll get it.</p>
    """
    html = _shell(
        "Beta Feedback.",
        "Someone just dropped feedback while testing the beta build.",
        body,
        "Crafters Market · Beta channel",
    )
    return await _send(OPS_EMAIL, f"Beta feedback · {name}", html)


async def send_beta_feedback_resolved(name: str, email: str, message: str, page: str = ""):
    """Auto-follow-up email when an admin marks beta feedback "resolved"
    without writing a custom reply. Echoes back the original message so
    the user has context, and invites them to keep sending feedback.
    Sent ONLY when the admin used the bare Resolve action — if they
    used Reply (which auto-resolves), they already got a tailored
    response, so this is suppressed by the caller."""
    if not email:
        return
    safe_msg = (message or "").replace("<", "&lt;").replace(">", "&gt;").replace("\n", "<br/>")
    site = (os.environ.get("PUBLIC_SITE_URL") or "https://craftersmarket.org").rstrip("/")
    if site.lower().endswith(".emergentagent.com") or "preview." in site.lower():
        site = "https://craftersmarket.org"
    body = (
        f"<p style='font-size:14px;color:#e5e5e5;line-height:1.6;margin:0 0 22px'>Hey {name or 'there'},</p>"
        "<p style='font-size:14px;color:#a3a3a3;line-height:1.6;margin:0 0 22px'>"
        "Quick note from the team — we've reviewed your feedback and closed it out. "
        "Thanks for taking the time to flag it; this is exactly how we improve."
        "</p>"
        "<div style='font-size:11px;letter-spacing:0.22em;color:#525252;text-transform:uppercase;margin:28px 0 8px'>◆ Your original note</div>"
        f"<div style='font-size:13px;color:#a3a3a3;line-height:1.6;border-left:2px solid #ff4500;padding:6px 14px;background:#0d0d0d'>{safe_msg}</div>"
        + (f"<p style='font-size:11px;color:#525252;margin:8px 0 0;text-align:right'>Submitted from <code style='color:#a3a3a3'>{page}</code></p>" if page else "")
        + "<p style='font-size:13px;color:#a3a3a3;line-height:1.6;margin:28px 0 0'>"
        "If something still feels off, just reply to this email — it goes straight to the team."
        "</p>"
        f"<div style='text-align:center;margin:32px 0 10px'>"
        f"<a href='{site}/updates' style='display:inline-block;background:#ff4500;color:#0a0a0a;text-decoration:none;font-weight:700;padding:14px 24px;font-size:13px;letter-spacing:0.15em;text-transform:uppercase'>See what we've shipped →</a>"
        "</div>"
    )
    html = _shell("Closed the loop.", "Your beta feedback has been reviewed and resolved.", body, "Crafters Market · Beta")
    return await _send(email, "[Crafters Market] We reviewed your feedback", html)


async def send_contact_message_resolved(name: str, email: str, message: str, subject: str = ""):
    """Auto-acknowledgment email when an admin marks a contact-form
    submission resolved without writing a tailored Reply. Sister of
    `send_beta_feedback_resolved` (iter101) — different copy because
    contact messages are usually buyer/visitor questions rather than
    bug reports, but identical guard rails on the caller side."""
    if not email:
        return
    safe_msg = (message or "").replace("<", "&lt;").replace(">", "&gt;").replace("\n", "<br/>")
    safe_subj = (subject or "").replace("<", "&lt;").replace(">", "&gt;")
    site = (os.environ.get("PUBLIC_SITE_URL") or "https://craftersmarket.org").rstrip("/")
    if site.lower().endswith(".emergentagent.com") or "preview." in site.lower():
        site = "https://craftersmarket.org"
    body = (
        f"<p style='font-size:14px;color:#e5e5e5;line-height:1.6;margin:0 0 22px'>Hey {name or 'there'},</p>"
        "<p style='font-size:14px;color:#a3a3a3;line-height:1.6;margin:0 0 22px'>"
        "Thanks for reaching out — we got your note and have addressed it on our end. "
        "If something's still on your mind, just reply to this email and it lands directly with the team."
        "</p>"
        "<div style='font-size:11px;letter-spacing:0.22em;color:#525252;text-transform:uppercase;margin:28px 0 8px'>◆ Your message</div>"
        + (f"<div style='font-size:13px;color:#e5e5e5;font-weight:700;margin:0 0 8px'>{safe_subj}</div>" if safe_subj else "")
        + f"<div style='font-size:13px;color:#a3a3a3;line-height:1.6;border-left:2px solid #ff4500;padding:6px 14px;background:#0d0d0d'>{safe_msg}</div>"
        + f"<div style='text-align:center;margin:32px 0 10px'>"
        f"<a href='{site}/shop' style='display:inline-block;background:#ff4500;color:#0a0a0a;text-decoration:none;font-weight:700;padding:14px 24px;font-size:13px;letter-spacing:0.15em;text-transform:uppercase'>Browse the catalog →</a>"
        "</div>"
    )
    html = _shell("Got your note.", "We've reviewed your message and closed it out.", body, "Crafters Market · Contact")
    return await _send(email, "[Crafters Market] We got your note", html)


async def send_contact_message_to_ops(
    name: str, email: str, message: str, subject: str = "",
    phone: str = "", topic: str = "",
):
    """Forward a public Contact-form submission to the ops inbox.
    Lighter wrapper around the beta-feedback shell with the contact-form
    fields. Ops can reply directly to the submitter (Reply-To stays on
    the submitter's address)."""
    if not OPS_EMAIL:
        return
    safe_msg = (message or "").replace("<", "&lt;").replace(">", "&gt;").replace("\n", "<br/>")
    rows = [("Name", name), ("Email", email)]
    if phone:
        rows.append(("Phone", phone))
    if topic:
        rows.append(("Topic", topic))
    if subject:
        rows.append(("Subject", subject))
    body = f"""
      <table width='100%' cellpadding='0' cellspacing='0' style='font-size:13px;border-top:1px solid #262626'>
        {''.join(f"<tr><td style='padding:8px 0;color:#a3a3a3;font-size:11px;letter-spacing:0.22em;text-transform:uppercase'>{k}</td><td style='padding:8px 0;color:#e5e5e5;text-align:right'>{v}</td></tr>" for k, v in rows)}
      </table>
      <div style='font-size:13px;color:#e5e5e5;margin-top:18px;line-height:1.6;border-left:2px solid #ff4500;padding:6px 14px;background:#0d0d0d'>{safe_msg}</div>
      <p style='font-size:11px;color:#a3a3a3;margin-top:18px'>Reply directly to <a href='mailto:{email}' style='color:#ff4500'>{email}</a> — they'll get it.</p>
    """
    html = _shell(
        "New Contact Message.",
        "Someone just submitted the website contact form.",
        body,
        "Crafters Market · Contact form",
    )
    subj = f"Contact · {name}" + (f" · {subject}" if subject else "")
    return await _send(OPS_EMAIL, subj, html)


async def send_contact_message_autoreply(
    to_email: str, to_name: str, original_message: str,
):
    """Soft confirmation to the submitter — sets a 24h SLA expectation
    and quotes the message they sent so they have a paper trail."""
    if not to_email:
        return
    safe_quote = (original_message or "").replace("<", "&lt;").replace(">", "&gt;").replace("\n", "<br/>")
    body = (
        f"<p style='font-size:14px;color:#e5e5e5;line-height:1.6;margin:0 0 18px'>"
        f"Hi {to_name.split()[0] if to_name else 'there'}, thanks for reaching out — "
        "we received your message and will reply within 24 business hours.</p>"
        "<p style='font-size:13px;color:#a3a3a3;line-height:1.6;margin:0 0 14px'>"
        "For reference, here's what you sent us:</p>"
        f"<div style='font-size:13px;color:#e5e5e5;line-height:1.6;border-left:2px solid #ff4500;"
        f"padding:6px 14px;background:#0d0d0d'>{safe_quote}</div>"
        "<p style='font-size:12px;color:#525252;line-height:1.6;margin-top:18px'>"
        "If your inquiry is urgent, you can also reach us directly at "
        "<a href='mailto:team@craftersmarket.org' style='color:#ff4500'>team@craftersmarket.org</a>.</p>"
    )
    html = _shell(
        "Message Received.",
        "We've got your note — looking into it now.",
        body, "Crafters Market · Contact",
    )
    return await _send(to_email, "We got your message · Crafters Market", html)



# ============================================================
#  Listing-publish notifications (maker confirm + ops + followers)
# ============================================================
SITE_URL = os.environ.get("SITE_URL", "https://craftersmarket.org").rstrip("/")


def _listing_card(title: str, image: str | None, price: float, listing_url: str) -> str:
    """Reusable listing-thumbnail card for emails."""
    img_html = (
        f"<img src='{image}' alt='' width='100%' style='display:block;width:100%;max-width:540px;height:auto;border:1px solid #262626' />"
        if image else
        "<div style='height:200px;background:#0a0a0a;border:1px solid #262626'></div>"
    )
    return f"""
      <a href="{listing_url}" style="text-decoration:none;color:inherit;display:block">
        {img_html}
        <table width='100%' cellpadding='0' cellspacing='0' style='border:1px solid #262626;border-top:0'>
          <tr>
            <td style='padding:18px 18px 8px'>
              <div style='font-size:18px;color:#e5e5e5;font-family:Impact,sans-serif;text-transform:uppercase;letter-spacing:-0.01em'>{title}</div>
            </td>
            <td style='padding:18px 18px 8px;text-align:right'>
              <div style='font-size:22px;color:#ff4500;font-family:Impact,sans-serif'>${price:.2f}</div>
            </td>
          </tr>
          <tr><td colspan='2' style='padding:0 18px 16px'>
            <span style='display:inline-block;padding:8px 18px;background:#ff4500;color:#0a0a0a;font-size:11px;letter-spacing:0.22em;text-transform:uppercase'>View listing →</span>
          </td></tr>
        </table>
      </a>
    """


async def send_maker_listing_published(
    maker_email: str, maker_name: str, listing_title: str, listing_slug: str,
    listing_image: str | None, listing_price: float,
):
    """Confirmation email to the maker right after they hit Publish."""
    listing_url = f"{SITE_URL}/shop/{listing_slug}"
    share_url = f"https://twitter.com/intent/tweet?text=Just listed: {listing_title}&url={listing_url}"
    body = _listing_card(listing_title, listing_image, listing_price, listing_url)
    body += f"""
      <p style='font-size:13px;line-height:1.6;color:#a3a3a3;margin-top:24px'>
        It's live, {maker_name}. Buyers can see it the moment they search the matching category or technique.
      </p>
      <table width='100%' cellpadding='0' cellspacing='0' style='margin-top:18px'>
        <tr>
          <td style='padding:0 6px 0 0'>
            <a href='{listing_url}' style='display:block;text-align:center;padding:12px;border:1px solid #262626;color:#e5e5e5;font-size:11px;letter-spacing:0.22em;text-transform:uppercase;text-decoration:none'>View live</a>
          </td>
          <td style='padding:0 0 0 6px'>
            <a href='{share_url}' style='display:block;text-align:center;padding:12px;background:#ff4500;color:#0a0a0a;font-size:11px;letter-spacing:0.22em;text-transform:uppercase;text-decoration:none'>Share to X</a>
          </td>
        </tr>
      </table>
      <p style='font-size:11px;line-height:1.6;color:#525252;margin-top:24px;letter-spacing:0.22em;text-transform:uppercase'>
        ◆ Tip — every shared listing gets ~3.4× the views in its first 24 hours.
      </p>
    """
    html = _shell(
        "You're live.",
        "Your new listing is published — here's what buyers will see.",
        body,
        f"Maker · {maker_name}",
    )
    return await _send(maker_email, f"Listing live · {listing_title}", html)


async def send_ops_new_listing(
    maker_name: str, maker_slug: str, listing_title: str, listing_slug: str,
    listing_image: str | None, listing_price: float, category: str | None = None,
    technique: str | None = None,
):
    """Heads-up to the ops team for moderation + featuring decisions."""
    if not OPS_EMAIL:
        return
    listing_url = f"{SITE_URL}/shop/{listing_slug}"
    maker_url = f"{SITE_URL}/makers/{maker_slug}"
    body = _listing_card(listing_title, listing_image, listing_price, listing_url)
    meta_rows = [("Maker", f"<a href='{maker_url}' style='color:#ff4500'>{maker_name}</a>")]
    if category: meta_rows.append(("Category", category))
    if technique: meta_rows.append(("Technique", technique))
    body += (
        "<table width='100%' cellpadding='0' cellspacing='0' style='font-size:12px;margin-top:18px;border-top:1px solid #262626'>"
        + "".join(
            f"<tr><td style='padding:8px 0;color:#a3a3a3;font-size:11px;letter-spacing:0.22em;text-transform:uppercase'>{k}</td>"
            f"<td style='padding:8px 0;color:#e5e5e5;text-align:right'>{v}</td></tr>"
            for k, v in meta_rows
        ) + "</table>"
    )
    html = _shell(
        "New listing.",
        f"{maker_name} just published a new listing. Review for content moderation or homepage feature.",
        body,
        "Crafters Market · Ops",
    )
    return await _send(OPS_EMAIL, f"New listing · {maker_name} · {listing_title}", html)


async def send_follower_new_listing(
    follower_email: str, follower_name: str, maker_name: str, maker_slug: str,
    listing_title: str, listing_slug: str, listing_image: str | None, listing_price: float,
):
    """Drop a fresh-listing notification into a follower's inbox."""
    listing_url = f"{SITE_URL}/shop/{listing_slug}"
    maker_url = f"{SITE_URL}/makers/{maker_slug}"
    unsubscribe_url = f"{SITE_URL}/makers/{maker_slug}#unfollow"
    body = _listing_card(listing_title, listing_image, listing_price, listing_url)
    body += f"""
      <p style='font-size:13px;line-height:1.6;color:#a3a3a3;margin-top:24px'>
        You're following <a href='{maker_url}' style='color:#ff4500'>{maker_name}</a> — they just dropped something new.
      </p>
      <p style='font-size:10px;line-height:1.6;color:#525252;margin-top:18px;letter-spacing:0.22em;text-transform:uppercase'>
        ◆ <a href='{unsubscribe_url}' style='color:#525252'>Unfollow</a> to stop these emails
      </p>
    """
    html = _shell(
        f"New from {maker_name}.",
        f"Hey {follower_name}, here's the latest piece from a maker you follow.",
        body,
        f"Crafters Market · Following {maker_name}",
    )
    return await _send(follower_email, f"New from {maker_name} · {listing_title}", html)



# ─────────────────────── Direct Messages (buyer ↔ maker) ───────────────────────
def _dm_body_block(sender_name: str, sender_email: str, body: str) -> str:
    """Render a message body as a quoted card, preserving line breaks."""
    safe = (
        (body or "")
        .replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        .replace("\n", "<br>")
    )
    who = f"{sender_name} &lt;{sender_email}&gt;" if sender_name else sender_email
    return (
        "<div style='border-left:3px solid #ff4500;padding:14px 18px;"
        "background:#0d0d0d;margin:18px 0;font-size:14px;line-height:1.6;color:#e5e5e5'>"
        f"<div style='font-size:11px;color:#a3a3a3;text-transform:uppercase;letter-spacing:0.22em;margin-bottom:10px'>"
        f"From · {who}</div>"
        f"<div>{safe}</div></div>"
    )


def _dm_cta_button(label: str, href: str) -> str:
    return (
        f"<a href='{href}' style='display:inline-block;background:#ff4500;color:#0a0a0a;"
        "padding:12px 22px;font-family:JetBrains Mono,monospace;font-size:11px;"
        "letter-spacing:0.22em;text-transform:uppercase;text-decoration:none;"
        f"border:1px solid #ff4500;font-weight:bold'>{label} →</a>"
    )


async def send_dm_to_maker(
    maker_email: str, maker_name: str,
    sender_display: str, sender_email: str,
    subject: str, body: str, thread_id: str,
):
    """Notify a maker that a buyer (signed in or guest) sent them a DM.
    Email contains the message preview + a CTA to open the Messages tab in the
    Maker Shop Manager. Replying happens on-site — Reply-To is intentionally
    NOT set on transactional sends so makers don't reply directly to the
    buyer's inbox bypassing the audit trail."""
    site = (os.environ.get("FRONTEND_URL") or "https://craftersmarket.org").rstrip("/")
    open_url = f"{site}/maker/dashboard#messages?thread={thread_id}"
    intro = (
        f"You have a new message from <strong style='color:#e5e5e5'>{sender_display or sender_email}</strong>"
        f" about your shop on Crafters Market."
    )
    inner = _dm_body_block(sender_display, sender_email, body)
    cta = (
        "<div style='margin-top:24px;padding-top:18px;border-top:1px solid #262626;text-align:left'>"
        f"{_dm_cta_button('Open conversation', open_url)}"
        "<p style='font-size:11px;color:#525252;margin-top:14px;letter-spacing:0.22em;text-transform:uppercase'>"
        "◆ Reply directly in your Shop Manager to keep the conversation logged."
        "</p></div>"
    )
    title = "New buyer message."
    html = _shell(title, intro, inner + cta, f"Message · {subject[:80]}")
    return await _send(
        maker_email,
        f"[Crafters Market] {sender_display or sender_email}: {subject[:80] or 'new message'}",
        html,
    )


async def send_dormant_buyer_reengage(buyer_email: str, code: str, pct: int, expires_in_days: int):
    """Dormant-buyer win-back email. One-time discount code, marketplace-wide."""
    if not buyer_email:
        return None
    site = (os.environ.get("FRONTEND_URL") or os.environ.get("PUBLIC_SITE_URL") or "https://craftersmarket.org").rstrip("/")
    intro = (
        "Hand-built CNC art doesn't show up in everyone's feed. "
        "We saved you a one-time code so you can come back and grab something new."
    )
    body = (
        "<div style='border:1px solid #ff4500;background:#0d0d0d;padding:24px;text-align:center;margin:18px 0'>"
        "<div style='font-size:11px;color:#a3a3a3;text-transform:uppercase;letter-spacing:0.22em;margin-bottom:6px'>"
        "Your code</div>"
        f"<div style='font-family:Impact,Arial Black,sans-serif;font-size:36px;letter-spacing:0.2em;color:#ff4500'>{code}</div>"
        f"<div style='font-size:13px;color:#e5e5e5;margin-top:6px'>{pct}% off · single use · expires in {expires_in_days} days</div>"
        "</div>"
        "<p style='font-size:14px;color:#e5e5e5;line-height:1.6;margin:18px 0'>"
        f"Apply <strong style='color:#ff4500'>{code}</strong> in your cart at checkout. Works on any maker on the marketplace."
        "</p>"
        f"<a href='{site}/shop' style='display:inline-block;background:#ff4500;color:#0a0a0a;"
        "padding:14px 26px;font-family:Impact,Arial Black,sans-serif;font-size:13px;letter-spacing:0.18em;"
        f"text-transform:uppercase;text-decoration:none;border:1px solid #ff4500'>Browse the shop →</a>"
        "<p style='font-size:11px;color:#525252;letter-spacing:0.18em;text-transform:uppercase;margin:32px 0 0'>"
        "◆ One code per email. Not redeemable for cash."
        "</p>"
    )
    html = _shell("We miss you.", intro, body, "Welcome back · Crafters Market")
    return await _send(
        buyer_email,
        f"[Crafters Market] {pct}% off — your welcome-back code",
        html,
    )


async def send_dm_to_buyer(
    buyer_email: str, buyer_name: str,
    maker_name: str, subject: str, body: str, thread_id: str,
):
    """Notify a buyer that a maker replied to their DM thread."""
    site = (os.environ.get("FRONTEND_URL") or "https://craftersmarket.org").rstrip("/")
    open_url = f"{site}/messages?thread={thread_id}"
    intro = (
        f"<strong style='color:#e5e5e5'>{maker_name}</strong> replied to your message on Crafters Market."
    )
    inner = _dm_body_block(maker_name, "", body)
    cta = (
        "<div style='margin-top:24px;padding-top:18px;border-top:1px solid #262626;text-align:left'>"
        f"{_dm_cta_button('Open conversation', open_url)}"
        "<p style='font-size:11px;color:#525252;margin-top:14px;letter-spacing:0.22em;text-transform:uppercase'>"
        "◆ Sign in with the same email you used to message the shop."
        "</p></div>"
    )
    title = f"{maker_name} replied."
    html = _shell(title, intro, inner + cta, f"Message · {subject[:80]}")
    return await _send(
        buyer_email,
        f"[Crafters Market] {maker_name} replied to your message",
        html,
    )



async def send_admin_message_to_applicant(
    applicant_email: str,
    applicant_name: str,
    subject: str,
    message: str,
    admin_email: str = "",
):
    """One-off message from an admin to a single maker-application applicant.

    Uses the same dark industrial shell as other transactional emails so it
    feels native to Crafters Market. Lets the team follow up on a specific
    application without copy/pasting into Gmail.
    """
    if not applicant_email:
        return None
    safe_msg = (message or "").replace("\n", "<br/>")
    body = (
        f"<p style='font-size:14px;color:#e5e5e5;line-height:1.6;margin:0 0 18px'>"
        f"Hi {applicant_name or 'there'},</p>"
        f"<div style='font-size:14px;color:#e5e5e5;line-height:1.7;"
        f"border-left:2px solid #ff4500;padding:4px 0 4px 16px;margin:0 0 18px'>"
        f"{safe_msg}</div>"
        "<p style='font-size:12px;color:#525252;line-height:1.6;margin-top:24px'>"
        "Reply to this email to reach the team directly."
        "</p>"
    )
    sender_label = admin_email or "Crafters Market Team"
    html = _shell(
        "A Note From The Team.",
        f"Personal follow-up from {sender_label}.",
        body, "Maker program · direct message",
    )
    return await _send(
        applicant_email,
        f"[Crafters Market] {subject}",
        html,
    )


async def send_admin_broadcast(
    recipient_email: str,
    subject: str,
    message: str,
    headline: str = "Announcement.",
    intro: str = "An update from the Crafters Market team.",
):
    """Single-recipient send used by the admin broadcast composer.

    The admin endpoint loops over the recipient cohort and calls this
    helper for each address — keeping per-send logging via the existing
    `_record_event` pipeline so the operator can see exactly who got it
    and which provider was used.
    """
    if not recipient_email:
        return None
    safe_msg = (message or "").replace("\n", "<br/>")
    body = (
        f"<div style='font-size:14px;color:#e5e5e5;line-height:1.7;margin:0 0 18px'>"
        f"{safe_msg}</div>"
        "<p style='font-size:12px;color:#525252;line-height:1.6;margin-top:24px;"
        "border-top:1px solid #262626;padding-top:14px'>"
        "You're receiving this because you have an account on Crafters Market. "
        "Reply to this email to reach the team."
        "</p>"
    )
    html = _shell(headline, intro, body, "Announcement · ops")
    return await _send(
        recipient_email,
        f"[Crafters Market] {subject}",
        html,
    )


# ------------------------------------------------------------------
# Production health watchdog (iter93) — one-shot alert + recovery
# emails fired by /app/backend/prod_health.py. Sent to OPS_EMAIL
# because A) that's where every other ops alert already lands and
# B) the sender header is verified for OPS so delivery is reliable.
# ------------------------------------------------------------------
async def send_ops_prod_outage_alert(*, endpoint: str, status: int, reason: str):
    if not OPS_EMAIL:
        return
    status_chip = f"HTTP {status}" if status else "UNREACHABLE"
    body = (
        "<div style='background:#2a0707;border-left:4px solid #ff4500;padding:16px 18px;margin:0 0 18px'>"
        "<div style='font-size:10px;letter-spacing:0.3em;color:#ff4500;text-transform:uppercase;margin-bottom:8px'>◆ Production alert</div>"
        f"<div style='font-size:18px;color:#ff4500;font-weight:700'>{endpoint} is failing</div>"
        f"<div style='font-size:13px;color:#fca5a5;margin-top:6px'>{status_chip} · {reason or 'no response'}</div>"
        "</div>"
        "<p style='font-size:13px;color:#a3a3a3;line-height:1.6;margin:0 0 12px'>"
        "The watchdog has seen this endpoint fail on two consecutive checks. Recommended actions:"
        "</p>"
        "<ul style='font-size:13px;color:#e5e5e5;line-height:1.7;padding-left:18px;margin:0'>"
        "<li>Redeploy production from the Emergent dashboard</li>"
        "<li>Verify the backend pod is healthy (supervisor logs)</li>"
        "<li>Purge Cloudflare cache for the affected route</li>"
        "</ul>"
        "<p style='font-size:11px;color:#525252;margin:20px 0 0'>"
        "You will receive a follow-up email when this endpoint recovers."
        "</p>"
    )
    html = _shell("Prod Down.", f"Endpoint {endpoint} is returning errors.", body, "Watchdog · ops")
    return await _send(OPS_EMAIL, f"[Crafters Market] 🚨 Prod outage: {endpoint}", html)


async def send_ops_prod_recovery(*, endpoint: str, downtime_minutes: int):
    if not OPS_EMAIL:
        return
    window = f"{downtime_minutes} min" if downtime_minutes else "under 1 min"
    body = (
        "<div style='background:#052e16;border-left:4px solid #22c55e;padding:16px 18px;margin:0 0 18px'>"
        "<div style='font-size:10px;letter-spacing:0.3em;color:#22c55e;text-transform:uppercase;margin-bottom:8px'>◆ Recovered</div>"
        f"<div style='font-size:18px;color:#86efac;font-weight:700'>{endpoint} is back online</div>"
        f"<div style='font-size:13px;color:#bbf7d0;margin-top:6px'>Approximate downtime: {window}</div>"
        "</div>"
        "<p style='font-size:13px;color:#a3a3a3;line-height:1.6;margin:0'>"
        "The watchdog has cleared the alert. No further action required."
        "</p>"
    )
    html = _shell("Prod Restored.", f"Endpoint {endpoint} is responding normally.", body, "Watchdog · ops")
    return await _send(OPS_EMAIL, f"[Crafters Market] ✅ Prod recovered: {endpoint}", html)


# ------------------------------------------------------------------
# Updates digest (iter96) — fired by the daily cron in
# updates_digest.py whenever new CHANGELOG entries are detected.
# ------------------------------------------------------------------
async def send_updates_digest(*, email: str, name: str, entries: list, unsubscribe_token: str):
    site = (os.environ.get("PUBLIC_SITE_URL") or "https://craftersmarket.org").rstrip("/")
    if site.lower().endswith(".emergentagent.com") or "preview." in site.lower():
        site = "https://craftersmarket.org"  # belt-and-suspenders
    unsub = f"{site}/api/updates/unsubscribe?token={unsubscribe_token}"
    greeting = f"Hey {name}," if name else "Hey,"
    items = []
    for e in entries[:8]:
        title = (e.get("title") or "").strip()
        blurb = (e.get("blurb") or "").strip()
        items.append(
            "<div style='border-left:2px solid #ff4500;padding:4px 0 4px 14px;margin:0 0 18px'>"
            f"<div style='font-size:11px;letter-spacing:0.22em;color:#ff4500;text-transform:uppercase;margin-bottom:4px'>◆ {e.get('date','')}</div>"
            f"<div style='font-size:17px;color:#e5e5e5;font-weight:700;margin-bottom:6px'>{title}</div>"
            + (f"<div style='font-size:13px;color:#a3a3a3;line-height:1.55'>{blurb}</div>" if blurb else "")
            + "</div>"
        )
    n = len(entries)
    headline = "1 new update" if n == 1 else f"{n} new updates"
    body = (
        f"<p style='font-size:14px;color:#e5e5e5;line-height:1.6;margin:0 0 22px'>{greeting}</p>"
        f"<p style='font-size:14px;color:#a3a3a3;line-height:1.6;margin:0 0 26px'>"
        f"Here's what shipped on Crafters Market since you last heard from us — "
        f"<b style='color:#e5e5e5'>{headline}</b>.</p>"
        + "".join(items)
        + f"<div style='text-align:center;margin:36px 0 10px'>"
        f"<a href='{site}/updates' style='display:inline-block;background:#ff4500;color:#0a0a0a;text-decoration:none;font-weight:700;padding:14px 24px;font-size:13px;letter-spacing:0.15em;text-transform:uppercase'>See the full timeline →</a>"
        "</div>"
        f"<p style='font-size:11px;color:#525252;line-height:1.55;margin:30px 0 0;text-align:center'>"
        f"You're getting this because you subscribed at {site}/updates. "
        f"<a href='{unsub}' style='color:#525252;text-decoration:underline'>Unsubscribe</a>.</p>"
    )
    html = _shell("New on Crafters Market.", f"{n} update{'s' if n != 1 else ''} since you last heard from us.", body, "Updates digest")
    return await _send(email, f"[Crafters Market] {headline} — {entries[0].get('title','')}"[:120], html)

# ------------------------------------------------------------------
# Updates digest OPS summary (iter98) — closing-loop confirmation
# fired from updates_digest.run_digest_dispatch() after a live send.
# ------------------------------------------------------------------
async def send_ops_updates_dispatch_summary(*, advanced_to: str, new_entries: int,
                                            subscribers: int, sent: int, failed: int,
                                            trigger: str = "manual"):
    if not OPS_EMAIL:
        return
    fail_chip = (
        f"<span style='color:#fca5a5'>· {failed} failed</span>"
        if failed > 0 else ""
    )
    body = (
        "<div style='background:#052e16;border-left:4px solid #22c55e;padding:16px 18px;margin:0 0 18px'>"
        "<div style='font-size:10px;letter-spacing:0.3em;color:#22c55e;text-transform:uppercase;margin-bottom:8px'>◆ Updates digest dispatched</div>"
        f"<div style='font-size:18px;color:#86efac;font-weight:700'>iter{advanced_to} sent to {sent} subscriber{'s' if sent != 1 else ''}</div>"
        f"<div style='font-size:13px;color:#bbf7d0;margin-top:6px'>"
        f"{new_entries} new entr{'ies' if new_entries != 1 else 'y'} · {subscribers} active on list {fail_chip}"
        "</div></div>"
        f"<p style='font-size:12px;color:#a3a3a3;margin:0'>Trigger: <code>{trigger}</code></p>"
    )
    html = _shell("Digest sent.", f"iter{advanced_to} delivered to {sent} subs.", body, "Updates · ops")
    return await _send(OPS_EMAIL, f"[Crafters Market] Digest dispatched · iter{advanced_to} · {sent} sent", html)



# ------------------------------------------------------------------
# Maker restock weekly digest (iter99) — fired Sundays 09:00 UTC by
# /app/backend/maker_restock_digest.py. One email per maker with at
# least one open waitlist entry, summarising every backordered product.
# ------------------------------------------------------------------
async def send_maker_restock_digest(*, email: str, name: str,
                                    products: list, total_pending: int):
    site = (os.environ.get("PUBLIC_SITE_URL") or "https://craftersmarket.org").rstrip("/")
    if site.lower().endswith(".emergentagent.com") or "preview." in site.lower():
        site = "https://craftersmarket.org"
    items = []
    for p in products[:20]:
        title = (p.get("product_title") or "").strip() or p.get("product_slug", "")
        link = f"{site}/shop/{p.get('product_slug', '')}"
        items.append(
            "<div style='border-left:2px solid #ff4500;padding:6px 0 6px 14px;margin:0 0 14px'>"
            f"<div style='font-size:14px;color:#e5e5e5;font-weight:700;margin-bottom:4px'>"
            f"<a href='{link}' style='color:#e5e5e5;text-decoration:none'>{title}</a></div>"
            f"<div style='font-size:12px;color:#a3a3a3'>"
            f"<b style='color:#ff4500'>{p.get('count', 0)}</b> buyer{'s' if p.get('count', 0) != 1 else ''} waiting"
            "</div></div>"
        )
    body = (
        f"<p style='font-size:14px;color:#e5e5e5;line-height:1.6;margin:0 0 22px'>Hey {name},</p>"
        f"<p style='font-size:14px;color:#a3a3a3;line-height:1.6;margin:0 0 26px'>"
        f"You have <b style='color:#ff4500'>{total_pending}</b> "
        f"buyer{'s' if total_pending != 1 else ''} waiting on restocks across "
        f"<b style='color:#e5e5e5'>{len(products)}</b> "
        f"product{'s' if len(products) != 1 else ''}. Here's the breakdown — restocking moves these into immediate orders.</p>"
        + "".join(items)
        + f"<div style='text-align:center;margin:32px 0 10px'>"
        f"<a href='{site}/maker/dashboard' style='display:inline-block;background:#ff4500;color:#0a0a0a;text-decoration:none;font-weight:700;padding:14px 24px;font-size:13px;letter-spacing:0.15em;text-transform:uppercase'>Open Dashboard →</a>"
        "</div>"
    )
    html = _shell("Restock queue.", f"{total_pending} buyers waiting across {len(products)} products.", body, "Maker · weekly")
    return await _send(email, f"[Crafters Market] {total_pending} buyers waiting on restocks", html)


# ------------------------------------------------------------------
# Coming-Soon waitlist confirmation (iter103) — fired from the
# /api/coming-soon/waitlist endpoint when a NEW signup goes through.
# Skipped on already-on-list re-submissions (handled by the caller).
# ------------------------------------------------------------------
async def send_coming_soon_confirmation(*, email: str, name: str, category: str):
    if not email:
        return
    site = (os.environ.get("PUBLIC_SITE_URL") or "https://craftersmarket.org").rstrip("/")
    if site.lower().endswith(".emergentagent.com") or "preview." in site.lower():
        site = "https://craftersmarket.org"
    greet = f"Hey {name}," if name else "Hey,"
    body = (
        f"<p style='font-size:14px;color:#e5e5e5;line-height:1.6;margin:0 0 22px'>{greet}</p>"
        f"<p style='font-size:14px;color:#a3a3a3;line-height:1.6;margin:0 0 22px'>"
        f"You're on the waitlist for <b style='color:#ff4500'>{category}</b>. "
        "We'll send you exactly one email — no marketing, no follow-ups — the moment this category goes live. "
        "Until then, your spot is saved.</p>"
        f"<div style='text-align:center;margin:32px 0 10px'>"
        f"<a href='{site}/shop' style='display:inline-block;background:#ff4500;color:#0a0a0a;text-decoration:none;font-weight:700;padding:14px 24px;font-size:13px;letter-spacing:0.15em;text-transform:uppercase'>Browse the catalog →</a>"
        "</div>"
    )
    html = _shell("On the list.", f"We'll ping you when {category} goes live.", body, f"Coming Soon · {category}")
    return await _send(email, f"[Crafters Market] You're on the list for {category}", html)


# ------------------------------------------------------------------
# /updates digest welcome email (iter103) — fired from the
# /api/updates/subscribe endpoint on first-time subscribe (or
# reactivation). Skipped on already-active re-submissions.
# ------------------------------------------------------------------
async def send_updates_subscribe_welcome(*, email: str, name: str, unsubscribe_token: str = ""):
    if not email:
        return
    site = (os.environ.get("PUBLIC_SITE_URL") or "https://craftersmarket.org").rstrip("/")
    if site.lower().endswith(".emergentagent.com") or "preview." in site.lower():
        site = "https://craftersmarket.org"
    unsub = f"{site}/api/updates/unsubscribe?token={unsubscribe_token}" if unsubscribe_token else ""
    greet = f"Hey {name}," if name else "Hey,"
    body = (
        f"<p style='font-size:14px;color:#e5e5e5;line-height:1.6;margin:0 0 22px'>{greet}</p>"
        "<p style='font-size:14px;color:#a3a3a3;line-height:1.6;margin:0 0 22px'>"
        "You're subscribed to Crafters Market updates. From here on out, when we ship something new — a feature, a fix, a polish — you'll get a short digest. "
        "<b style='color:#e5e5e5'>One email per release week.</b> No filler. No marketing.</p>"
        "<div style='font-size:11px;letter-spacing:0.22em;color:#525252;text-transform:uppercase;margin:28px 0 8px'>◆ What you can expect</div>"
        "<ul style='font-size:13px;color:#e5e5e5;line-height:1.7;padding-left:20px;margin:0'>"
        "<li>One short digest of recent improvements, plain English</li>"
        "<li>Occasional founder notes when there's something worth saying</li>"
        "<li>Zero marketing — we hate that as much as you do</li>"
        "</ul>"
        f"<div style='text-align:center;margin:32px 0 10px'>"
        f"<a href='{site}/updates' style='display:inline-block;background:#ff4500;color:#0a0a0a;text-decoration:none;font-weight:700;padding:14px 24px;font-size:13px;letter-spacing:0.15em;text-transform:uppercase'>See what we've shipped →</a>"
        "</div>"
        + (f"<p style='font-size:11px;color:#525252;line-height:1.55;margin:30px 0 0;text-align:center'>"
           f"Changed your mind? <a href='{unsub}' style='color:#525252;text-decoration:underline'>Unsubscribe</a> in one click — no questions asked.</p>"
           if unsub else "")
    )
    html = _shell("Welcome aboard.", "You'll hear from us when we ship something new.", body, "Crafters Market · Updates")
    return await _send(email, "[Crafters Market] You're subscribed to updates", html)



# ------------------------------------------------------------------
# Coming-Soon launch announcement (iter112) — fired by an admin click
# on the new "It's live" button per category. Distinct from the
# on-signup confirmation: this one says "the day has come, here's the
# link". One-shot per (email, category) — the admin endpoint stamps
# `notified_at` so re-clicks are no-ops.
# ------------------------------------------------------------------
async def send_coming_soon_launch_announcement(*, email: str, name: str, category: str,
                                                shop_path: str = "/shop"):
    if not email:
        return
    site = (os.environ.get("PUBLIC_SITE_URL") or "https://craftersmarket.org").rstrip("/")
    if site.lower().endswith(".emergentagent.com") or "preview." in site.lower():
        site = "https://craftersmarket.org"
    # Allow per-launch deep-link override (e.g. `/shop?category=Neon`).
    cta_href = f"{site}{shop_path}" if shop_path.startswith("/") else f"{site}/{shop_path}"
    greet = f"Hey {name}," if name else "Hey,"
    body = (
        f"<p style='font-size:14px;color:#e5e5e5;line-height:1.6;margin:0 0 22px'>{greet}</p>"
        f"<p style='font-size:14px;color:#a3a3a3;line-height:1.6;margin:0 0 22px'>"
        f"<b style='color:#ff4500'>{category}</b> is live. "
        "You signed up to be notified the moment we opened it — that moment is now. "
        "Every piece is hand-built by a vetted independent maker. Take a look while the catalog is fresh.</p>"
        f"<div style='text-align:center;margin:32px 0 10px'>"
        f"<a href='{cta_href}' style='display:inline-block;background:#ff4500;color:#0a0a0a;text-decoration:none;font-weight:700;padding:14px 24px;font-size:13px;letter-spacing:0.15em;text-transform:uppercase'>Shop {category} →</a>"
        "</div>"
        "<p style='font-size:11px;color:#525252;line-height:1.55;margin:30px 0 0;text-align:center'>"
        "This is the only email you'll get from this list. You're now off the waitlist — no further sends.</p>"
    )
    html = _shell("It's live.", f"{category} is open. Here's your first look.", body, f"Launch · {category}")
    return await _send(email, f"[Crafters Market] {category} is live — your first look", html)



# ---------------------------------------------------------------------------
# Maker Journal Digest — sent to buyers who follow a maker that just shipped
# new journal posts in the past week. One combined email per (maker, follower)
# regardless of post count, capped to once per ISO week so we never re-email
# the same follower for the same digest window.
# ---------------------------------------------------------------------------
async def send_maker_journal_digest(
    follower_email: str,
    follower_name: str,
    maker_name: str,
    maker_slug: str,
    posts: list[dict],
):
    """One email summarizing 1+ new journal posts from a maker the buyer
    follows. `posts` is a list of `{slug, title, excerpt, cover, read_min}`.
    Designed to read like a curated one-from-the-shop note — not a generic
    blast — so makers feel like the digest carries their voice."""
    site = (os.environ.get("PUBLIC_SITE_URL") or os.environ.get("FRONTEND_URL")
            or "https://craftersmarket.org").rstrip("/")
    n = len(posts)
    intro_word = "post" if n == 1 else "posts"
    intro = (
        f"{maker_name} just published {n} new journal {intro_word}. "
        f"You follow their shop, so we thought you'd want first look."
    )
    cards = ""
    for p in posts:
        slug = p.get("slug") or ""
        title = p.get("title") or "Untitled"
        excerpt = (p.get("excerpt") or "")[:240]
        read = p.get("read_min") or 4
        href = f"{site}/journal/{slug}"
        cover = p.get("cover") or ""
        cover_block = (
            f"<a href='{href}' style='display:block;text-decoration:none'>"
            f"<img src='{cover}' alt='' style='display:block;width:100%;height:auto;border:1px solid #262626'/></a>"
            if cover else ""
        )
        cards += (
            "<div style='margin:0 0 24px;padding:0 0 24px;border-bottom:1px solid #262626'>"
            f"{cover_block}"
            "<div style='font-size:10px;color:#525252;letter-spacing:0.22em;text-transform:uppercase;margin:14px 0 6px'>"
            f"◆ {read} min read</div>"
            f"<a href='{href}' style='text-decoration:none;color:#e5e5e5'>"
            f"<h2 style='font-family:Impact,Arial Black,sans-serif;font-size:24px;margin:0 0 10px;line-height:1.1;text-transform:uppercase'>{title}</h2></a>"
            f"<p style='font-size:14px;line-height:1.6;color:#a3a3a3;margin:0 0 14px'>{excerpt}</p>"
            f"<a href='{href}' style='display:inline-block;background:#ff4500;color:#0a0a0a;text-decoration:none;"
            "font-weight:700;padding:10px 18px;font-size:11px;letter-spacing:0.18em;text-transform:uppercase'>Read post →</a>"
            "</div>"
        )
    # Unsubscribe = unfollow the maker. We deep-link to the maker page
    # with a `#followers` anchor where the FollowButton lives.
    unfollow_href = f"{site}/makers/{maker_slug}"
    cards += (
        "<p style='font-size:11px;line-height:1.55;color:#525252;margin:24px 0 0'>"
        f"You're getting this because you follow <strong style='color:#a3a3a3'>{maker_name}</strong>. "
        f"<a href='{unfollow_href}' style='color:#a3a3a3;text-decoration:underline'>Unfollow</a> to stop these digests. "
        "Capped to one digest per maker per week."
        "</p>"
    )
    title = f"Words from {maker_name}"
    html = _shell(title, intro, cards, f"Journal · {maker_name}")
    subj = (
        f"[Crafters Market] {maker_name} just published a new journal post"
        if n == 1 else
        f"[Crafters Market] {maker_name} just published {n} new journal posts"
    )
    return await _send(follower_email, subj, html)


# ─────────────────────── Social Momentum Digest (iter149) ───────────────────────
async def send_social_momentum_digest(
    *, email: str, maker_name: str, maker_slug: str,
    total_shares: int, top_listings: list[dict], week_label: str,
):
    """Send a maker their weekly "your listings got N shares" email.

    `top_listings` is pre-ranked: `[{slug, title, count}, ...]`. We
    render each as a compact card with a link back to the listing
    edit page (where they can grab a fresh story-card or copy the
    share URL again to fuel another wave).

    Quiet on zero — caller is responsible for short-circuiting before
    we get here, but we still bail to avoid sending an awkward
    "0 shares" message if anything slipped through.
    """
    if total_shares <= 0 or not top_listings:
        return None

    dashboard_url = f"{SITE_URL}/maker/dashboard"
    settings_url = f"{SITE_URL}/maker/settings"

    # Build one card per top listing. Compact: title (linked) + count +
    # a "copy share link again" CTA. Image-free so the email renders
    # fast on mobile and doesn't fight Gmail's image-blocking default.
    items_html = ""
    for it in top_listings:
        listing_url = f"{SITE_URL}/shop/{it['slug']}"
        edit_url = f"{SITE_URL}/maker/listings/{it['slug']}/edit"
        items_html += (
            "<div style='border:1px solid #262626;padding:18px;margin:12px 0;"
            "background:#0d0d0d'>"
            "<div style='font-size:11px;color:#a3a3a3;text-transform:uppercase;"
            "letter-spacing:0.22em;margin-bottom:6px'>"
            f"{it['count']} share{'s' if it['count'] != 1 else ''} this week"
            "</div>"
            "<div style='font-size:18px;font-weight:600;color:#fafafa;margin:0 0 14px'>"
            f"<a href='{listing_url}' style='color:#fafafa;text-decoration:none'>{it['title']}</a>"
            "</div>"
            "<div>"
            f"<a href='{edit_url}' style='font-size:11px;color:#ff4500;"
            "text-transform:uppercase;letter-spacing:0.22em;text-decoration:none'>"
            "↗ Open listing</a>"
            "</div>"
            "</div>"
        )

    cta = (
        "<div style='margin:28px 0;padding:20px;border:1px solid #ff4500;"
        "background:#1a0a05;color:#fafafa'>"
        "<div style='font-size:11px;color:#ff4500;text-transform:uppercase;"
        "letter-spacing:0.22em;margin-bottom:8px'>◆ Keep the momentum</div>"
        "<div style='font-size:15px;line-height:1.55'>"
        "Grab a fresh 9:16 Story template from your dashboard and re-share "
        "your top listing on Instagram or TikTok. Each new share shows up on "
        "the listing page as social proof to the next buyer."
        "</div>"
        f"<div style='margin-top:14px'><a href='{dashboard_url}' "
        "style='display:inline-block;padding:10px 18px;background:#ff4500;"
        "color:#0a0a0a;text-decoration:none;font-size:11px;text-transform:"
        "uppercase;letter-spacing:0.22em;font-weight:600'>"
        "Open maker dashboard →</a></div>"
        "</div>"
    )

    intro = (
        f"Hey {maker_name}, your listings collected <strong>{total_shares} "
        f"share{'s' if total_shares != 1 else ''}</strong> this week. "
        "That's organic interest from people pasting your products into "
        "Slack, iMessage, Discord, and Pinterest DMs."
    )

    footer = (
        f"<p style='font-size:10px;line-height:1.6;color:#525252;margin-top:32px;"
        "letter-spacing:0.22em;text-transform:uppercase'>"
        f"◆ <a href='{settings_url}' style='color:#525252'>Mute these weekly recaps</a> "
        f"· Week {week_label}</p>"
    )

    html = _shell(
        f"{total_shares} share{'s' if total_shares != 1 else ''} this week.",
        intro,
        items_html + cta + footer,
        "Crafters Market · Social momentum",
    )
    subj = (
        f"[Crafters Market] You got {total_shares} share"
        f"{'s' if total_shares != 1 else ''} this week"
    )
    return await _send(email, subj, html)



async def send_showcase_quarantine_notice(
    *, email: str, name: str, post_title: str, report_count: int,
):
    """Email the poster when their showcase post is auto-quarantined.

    Tone goal: factual, non-accusatory, gives them a clear next step.
    Auto-quarantine ≠ guilt — it just buys a moderator review window.
    Reaches both buyer and maker posters via the email stamped on the
    post at creation time.
    """
    if not email:
        return
    name_safe = name or "there"
    title_safe = (post_title or "your post").strip()[:120]
    intro = "Your community showcase post is temporarily under review."
    body = f"""
        <p style="font-size:14px;color:#e5e5e5;line-height:1.6;margin:0 0 16px">
          Hi {name_safe},
        </p>
        <p style="font-size:14px;color:#e5e5e5;line-height:1.6;margin:0 0 16px">
          Your post <b>"{title_safe}"</b> was flagged by {report_count}
          community members in the last 24 hours. While our moderators take a
          look, the post has been hidden from public feeds.
        </p>
        <p style="font-size:14px;color:#e5e5e5;line-height:1.6;margin:0 0 16px">
          This is an automatic step — <b>not a judgement</b>. Most reviews
          conclude within 24 hours. If the post was flagged in error, it
          will return to the feed unchanged. If a moderator finds an issue,
          they may edit or remove the post and reach out separately.
        </p>
        <p style="font-size:13px;color:#a3a3a3;line-height:1.5;margin:24px 0 8px">
          You don't need to do anything right now. We'll email again only
          if the moderator decision requires your attention.
        </p>
        <a href="https://craftersmarket.org/community"
           style="display:inline-block;background:#ff4500;color:#0a0a0a;
                  padding:14px 24px;font-family:Impact,Arial Black,sans-serif;
                  font-size:13px;letter-spacing:0.18em;text-transform:uppercase;
                  text-decoration:none;margin-top:8px">
          Open Community →
        </a>
    """
    html = _shell("Post under review.", intro, body, "Crafters Market · Community Moderation")
    subject = "[Crafters Market] Your showcase post is under review"
    return await _send(email, subject, html)


async def send_showcase_restored_notice(
    *, email: str, name: str, post_title: str,
):
    """Email the poster when a moderator restores their previously
    quarantined showcase post. Closes the loop on the anxiety from the
    earlier 'under review' notice — short, warm, signals trust.
    """
    if not email:
        return
    name_safe = name or "there"
    title_safe = (post_title or "your post").strip()[:120]
    intro = "Your showcase post is back live."
    body = f"""
        <p style="font-size:14px;color:#e5e5e5;line-height:1.6;margin:0 0 16px">
          Hi {name_safe},
        </p>
        <p style="font-size:14px;color:#e5e5e5;line-height:1.6;margin:0 0 16px">
          Good news — a moderator reviewed your post <b>"{title_safe}"</b>
          and <b>restored it to the community feed</b>. The earlier flags
          have been cleared.
        </p>
        <p style="font-size:14px;color:#e5e5e5;line-height:1.6;margin:0 0 16px">
          Thanks for your patience while we took a look. Auto-quarantine
          is conservative by design — it errs on the side of pausing
          posts so reviews happen fast, even when most flags turn out
          to be off-base.
        </p>
        <a href="https://craftersmarket.org/community"
           style="display:inline-block;background:#ff4500;color:#0a0a0a;
                  padding:14px 24px;font-family:Impact,Arial Black,sans-serif;
                  font-size:13px;letter-spacing:0.18em;text-transform:uppercase;
                  text-decoration:none;margin-top:8px">
          View your post →
        </a>
    """
    html = _shell("All clear.", intro, body, "Crafters Market · Community Moderation")
    subject = "[Crafters Market] Your showcase post is back live"
    return await _send(email, subject, html)
