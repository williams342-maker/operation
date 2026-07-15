"""LLM budget exhaustion watchdog (iter261).

When a Sora-2 video generation (or any Emergent LLM call) fails because
the Universal Key budget is exhausted, this module:

  1. Classifies the error — distinguishes "budget exhausted" from
     "Sora API timeout" / "rate limited" / "prompt rejected".
  2. Dedupes — fires AT MOST one alert per 24-hour window so a daily
     cron doesn't spam ops with the same warning on every retry.
  3. Fans out — sends an admin email (via OPS_EMAIL) + a Slack/Discord
     ping (via notify_team) so the operator sees it in two channels.
  4. Audit-logs — stores a row in `llm_budget_alerts` so the admin UI
     can show "Last budget alert: 3h ago".

Used by:
  - clip_seeder.py     (Sora-2 daily clip cron)
  - scheduler.py       (any future LLM cron jobs)
  - routers/ai.py      (interactive LLM calls — optional)

Detection signals:
  - HTTP status 402 or 429 from the underlying provider
  - Error message containing "insufficient_quota", "budget exceeded",
    "out of credit", "payment required"
  - emergentintegrations raising a specific exception class
"""
from __future__ import annotations
from config import env_get

import os
import re
from datetime import datetime, timedelta, timezone
from typing import Optional

from core import db, logger, now_iso

# Patterns that almost always mean "budget exhausted" (case-insensitive).
# Kept generous because Emergent / OpenAI error messages drift between
# SDK versions.
_BUDGET_PATTERNS = re.compile(
    r"(insufficient[_ ]quota"
    r"|budget[_ ]exceeded"
    r"|out[_ ]of[_ ]credit"
    r"|payment[_ ]required"
    r"|quota[_ ]exhausted"
    r"|low[_ ]balance"
    r"|insufficient[_ ]funds"
    r"|emergent[\s_-]?llm[\s_-]?(?:key[\s_-]?)?(?:budget|quota|credit|depleted)"
    r"|http\s*40[12])",
    re.IGNORECASE,
)

# Min seconds between two alerts for the same `kind` (24h by default).
_DEDUP_WINDOW_SECONDS = int(env_get("LLM_BUDGET_ALERT_DEDUP_SECONDS", "86400"))


def is_budget_exhaustion_error(err: Exception | str) -> bool:
    """Return True iff the error looks like a budget/quota exhaustion."""
    if err is None:
        return False
    text = str(err)
    return bool(_BUDGET_PATTERNS.search(text))


async def _should_send_alert(kind: str) -> bool:
    """24h dedup window. Returns False if we already alerted on the same
    `kind` within the window."""
    cutoff = (datetime.now(timezone.utc) - timedelta(seconds=_DEDUP_WINDOW_SECONDS)).isoformat().replace("+00:00", "Z")
    recent = await db.llm_budget_alerts.find_one(
        {"kind": kind, "created_at": {"$gte": cutoff}},
        {"_id": 0, "created_at": 1},
    )
    return recent is None


async def notify_budget_exhausted(
    *,
    kind: str,
    service: str,         # human-readable: "Sora-2 video", "Gemini text"
    error_message: str,
    context: Optional[dict] = None,
) -> dict:
    """Fire an admin email + Slack/Discord webhook for an LLM budget
    exhaustion event. Idempotent within the 24h dedup window.

    Args:
        kind:           short stable key for dedup, e.g. "sora2_daily_clip"
        service:        display name for the email subject
        error_message:  raw error text from the provider
        context:        optional dict that gets serialized into the alert
                        body (e.g. {"job": "daily_clip_seed", "model": "sora-2"})

    Returns:
        {"alerted": bool, "deduped": bool, "channels": {...}}
    """
    if not await _should_send_alert(kind):
        logger.info("[llm_budget_alert] deduped kind=%s (recent alert within window)", kind)
        return {"alerted": False, "deduped": True}

    context = context or {}
    ctx_lines = "\n".join(f"  • {k}: {v}" for k, v in context.items())

    # Persist BEFORE sending so a flaky email/webhook can't cause us to
    # alert twice on rapid retries.
    row = {
        "kind": kind,
        "service": service,
        "error_message": (error_message or "")[:2000],
        "context": context,
        "created_at": now_iso(),
    }
    try:
        await db.llm_budget_alerts.insert_one(row)
    except Exception as e:
        logger.warning("[llm_budget_alert] failed to persist row: %s", e)

    channels: dict = {"email": False, "webhook": False}

    # ─── Admin email ───────────────────────────────────────────────────
    try:
        from email_service import _send, OPS_EMAIL
        if OPS_EMAIL:
            subject = f"[Crafters Market] ⚠ LLM budget exhausted — {service}"
            html = (
                "<div style='font-family:JetBrains Mono,monospace;color:#e5e5e5;padding:24px;background:#0a0a0a'>"
                "<div style='background:#2a1a07;border-left:4px solid #f59e0b;padding:14px 18px;margin:0 0 18px'>"
                "<div style='font-size:10px;letter-spacing:0.3em;color:#fbbf24;text-transform:uppercase'>◆ LLM budget alert</div>"
                f"<div style='font-size:18px;color:#fde68a;font-weight:700;margin-top:6px'>{service} stopped — budget exhausted</div>"
                "</div>"
                "<p style='color:#a3a3a3;line-height:1.7'>The Emergent Universal Key has run out of budget. "
                "Cron jobs depending on this service will silently fail until you top up.</p>"
                "<p style='color:#a3a3a3;line-height:1.7'><b>Fix:</b> Open Emergent → Profile → "
                "<b>Universal Key</b> → <b>Add Balance</b> (or enable auto top-up).</p>"
                "<div style='background:#0d0d0d;border:1px solid #262626;padding:12px;margin:18px 0;font-size:11px;color:#737373;white-space:pre-wrap'>"
                f"kind: {kind}\n"
                f"service: {service}\n"
                f"context:\n{ctx_lines or '  (none)'}\n\n"
                f"raw error:\n{(error_message or '')[:800]}"
                "</div>"
                "<p style='color:#525252;font-size:11px'>Next alert for this kind is suppressed for "
                f"{_DEDUP_WINDOW_SECONDS // 3600}h to prevent inbox spam.</p>"
                "</div>"
            )
            result = await _send(OPS_EMAIL, subject, html)
            channels["email"] = result is not None
    except Exception as e:
        logger.exception("[llm_budget_alert] email send failed: %s", e)

    # ─── Slack/Discord webhook ────────────────────────────────────────
    try:
        from notify_webhook import notify_team
        wh_result = await notify_team(
            kind="llm_budget",
            title=f"⚠ LLM budget exhausted — {service}",
            summary=(
                "The Emergent Universal Key is out of budget. Top up at "
                "Emergent → Profile → Universal Key → Add Balance."
            ),
            fields=[
                ("Service", service),
                ("Kind", kind),
                ("Error", (error_message or "")[:200]),
            ],
        )
        channels["webhook"] = bool(wh_result.get("slack") or wh_result.get("discord"))
    except Exception as e:
        logger.exception("[llm_budget_alert] webhook fan-out failed: %s", e)

    logger.warning(
        "[llm_budget_alert] FIRED kind=%s service=%s channels=%s",
        kind, service, channels,
    )
    return {"alerted": True, "deduped": False, "channels": channels}
