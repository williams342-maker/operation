"""Team-notification webhook fan-out — Slack + Discord.

One module, one entrypoint (`notify_team`), three call sites:
1. New beta feedback        → kind="feedback"
2. New contact message      → kind="contact"
3. Prod outage transition   → kind="outage"  (recovery uses kind="recovery")

Design notes:
- Auto-detects which providers are configured via env vars
  `SLACK_WEBHOOK_URL` and `DISCORD_WEBHOOK_URL`. Either, both, or neither.
  Neither configured → silent no-op (zero log noise, zero exceptions).
- Both providers fanned out concurrently with `asyncio.gather` so a slow
  Discord doesn't make Slack wait.
- Failures swallowed — webhook delivery is best-effort. Every failure
  logs at WARNING with the provider name + status.
- Per-process in-memory dedup: identical (kind, title) within the last
  60s gets dropped. Prevents accidental spam from a bug in a caller.
- Designed to be invoked via `bg.add_task(notify_team, ...)` so it never
  blocks the user-facing API response.
"""
from __future__ import annotations
from config import env_get

import asyncio
import hashlib
import os
import time
from typing import Optional

import httpx

from core import logger

# (kind, title) → last-fired epoch. Capped at 256 entries via simple eviction.
_DEDUP_WINDOW_SEC = 60
_dedup_cache: dict[str, float] = {}

# Visual taxonomy — keep this lookup tight; if it grows past ~6 keys,
# extract to a config.
_KIND_META = {
    "feedback":  {"emoji": "💬", "color": 0x3B82F6, "label": "Founding Access Feedback"},
    "contact":   {"emoji": "📨", "color": 0x10B981, "label": "Contact Message"},
    "outage":    {"emoji": "🚨", "color": 0xEF4444, "label": "Prod Outage"},
    "recovery":  {"emoji": "✅", "color": 0x22C55E, "label": "Prod Recovered"},
    "test":      {"emoji": "🧪", "color": 0x8B5CF6, "label": "Webhook Test"},
}


def _slack_url() -> Optional[str]:
    return (env_get("SLACK_WEBHOOK_URL") or "").strip() or None


def _discord_url() -> Optional[str]:
    return (env_get("DISCORD_WEBHOOK_URL") or "").strip() or None


def is_configured() -> dict:
    """Used by /admin/webhooks/diag to surface which providers are armed."""
    return {
        "slack": bool(_slack_url()),
        "discord": bool(_discord_url()),
    }


def _dedup_key(kind: str, title: str) -> str:
    return hashlib.sha1(f"{kind}::{title}".encode("utf-8", "ignore")).hexdigest()


def _is_duplicate(kind: str, title: str) -> bool:
    """True if we fired this same (kind, title) within the dedup window.
    Records the new fire on miss. Best-effort eviction at 256 entries."""
    key = _dedup_key(kind, title)
    now = time.time()
    last = _dedup_cache.get(key, 0.0)
    if now - last < _DEDUP_WINDOW_SEC:
        return True
    _dedup_cache[key] = now
    if len(_dedup_cache) > 256:
        # Drop the oldest 32 entries — cheap, doesn't matter if imprecise.
        for k, _ in sorted(_dedup_cache.items(), key=lambda kv: kv[1])[:32]:
            _dedup_cache.pop(k, None)
    return False


def _build_slack_payload(kind: str, title: str, summary: str,
                        fields: Optional[list[tuple[str, str]]],
                        link: Optional[str]) -> dict:
    meta = _KIND_META.get(kind, _KIND_META["test"])
    blocks: list[dict] = [
        {
            "type": "header",
            "text": {"type": "plain_text",
                     "text": f"{meta['emoji']} {meta['label']}: {title}"[:150]},
        },
        {"type": "section", "text": {"type": "mrkdwn", "text": summary[:3000] or "_(no body)_"}},
    ]
    if fields:
        blocks.append({
            "type": "section",
            "fields": [
                {"type": "mrkdwn", "text": f"*{k}*\n{v}"[:2000]} for k, v in fields[:8]
            ],
        })
    if link:
        blocks.append({
            "type": "actions",
            "elements": [{
                "type": "button",
                "text": {"type": "plain_text", "text": "Open in Admin →"},
                "url": link,
                "style": "primary",
            }],
        })
    return {"text": f"{meta['label']}: {title}", "blocks": blocks}


def _build_discord_payload(kind: str, title: str, summary: str,
                           fields: Optional[list[tuple[str, str]]],
                           link: Optional[str]) -> dict:
    meta = _KIND_META.get(kind, _KIND_META["test"])
    embed: dict = {
        "title": f"{meta['emoji']} {meta['label']}: {title}"[:256],
        "description": (summary or "")[:4000],
        "color": meta["color"],
    }
    if fields:
        embed["fields"] = [
            {"name": k[:256], "value": v[:1024] or "—", "inline": False}
            for k, v in fields[:8]
        ]
    if link:
        embed["url"] = link
    return {"embeds": [embed]}


async def _post(client: httpx.AsyncClient, provider: str, url: str, payload: dict) -> None:
    """Best-effort POST. Logs and swallows everything."""
    try:
        r = await client.post(url, json=payload, timeout=8.0)
        if r.status_code >= 300:
            logger.warning(
                "[notify_webhook] %s returned %s body=%s",
                provider, r.status_code, (r.text or "")[:200],
            )
        else:
            logger.info("[notify_webhook] %s ok status=%s", provider, r.status_code)
    except httpx.TimeoutException:
        logger.warning("[notify_webhook] %s timeout", provider)
    except Exception as e:
        logger.warning("[notify_webhook] %s send failed: %s", provider, e)


async def notify_team(
    *,
    kind: str,
    title: str,
    summary: str = "",
    fields: Optional[list[tuple[str, str]]] = None,
    link: Optional[str] = None,
) -> dict:
    """Fan-out to every configured provider. Safe to call always —
    no-ops cleanly when nothing is configured. Returns a small audit dict
    `{slack: bool, discord: bool, deduped: bool}` (mostly for tests)."""
    slack = _slack_url()
    discord = _discord_url()
    if not slack and not discord:
        return {"slack": False, "discord": False, "deduped": False, "skipped": "unconfigured"}

    # Outages and recoveries should always go through (operational).
    # Feedback/contact/test honor the dedup window.
    if kind not in ("outage", "recovery") and _is_duplicate(kind, title):
        logger.info("[notify_webhook] deduped kind=%s title=%s", kind, title)
        return {"slack": False, "discord": False, "deduped": True}

    sent = {"slack": False, "discord": False, "deduped": False}
    async with httpx.AsyncClient() as client:
        coros = []
        if slack:
            payload = _build_slack_payload(kind, title, summary, fields, link)
            coros.append(_post(client, "slack", slack, payload))
            sent["slack"] = True
        if discord:
            payload = _build_discord_payload(kind, title, summary, fields, link)
            coros.append(_post(client, "discord", discord, payload))
            sent["discord"] = True
        if coros:
            await asyncio.gather(*coros, return_exceptions=True)
    return sent
