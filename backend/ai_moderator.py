"""AI chat moderator.

Lightweight wrapper around Emergent LLM key (Claude) that classifies a
chat message into one of three actions:

  ALLOW  → message passes through unchanged
  WARN   → message is delivered but the user gets a private system warning
  BLOCK  → message is dropped + the sender gets a private "removed" notice

Every classification is persisted to `db.ai_mod_log` so the admin can audit
false-positives and tune the prompt.

Designed to fail-OPEN: any LLM error returns ALLOW so a transient outage
doesn't silence the chat.
"""
from __future__ import annotations

import json
import os
import re
import uuid
from typing import Literal, Tuple

from emergentintegrations.llm.chat import LlmChat, UserMessage

from core import db, logger, now_iso

EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "")

Action = Literal["allow", "warn", "block"]

# Pre-LLM heuristics — catches the obvious so we don't burn tokens on every
# "hi everyone" message. Anything that DOESN'T match passes to the LLM.
_OBVIOUS_SLURS = re.compile(
    r"\b(?:nigger|nigga|faggot|kike|chink|spic|tranny|retard)\b",
    re.IGNORECASE,
)
_LINK_SPAM = re.compile(r"https?://\S+", re.IGNORECASE)

SYSTEM_PROMPT = """You are the moderation classifier for a small CNC + craft community chat.

Your job: classify ONE chat message into exactly one of three actions. Keep the
community welcoming for hobbyists AND professionals — be tolerant of crude
shop-talk and frustrated venting, strict about harassment/hate.

Return EXACTLY a JSON object: {"action": "allow"|"warn"|"block", "reason": "..."}

Decision matrix:
- BLOCK: slurs, threats of violence, hate speech, sexual content involving
  minors, doxxing (sharing private contact info), illegal-activity solicitation,
  malicious link spam, repeated harassment of a named member.
- WARN: low-effort spam, minor name-calling between users, attempts to take
  the conversation off-platform for payment ("DM me your CashApp"), unsolicited
  off-topic ads, mild incivility.
- ALLOW: everything else — questions, project shares, frustrated venting that
  isn't directed AT another user, mild profanity, technical disagreements,
  mentions of brand names or product links to legitimate craft suppliers.

Reasons should be ONE short clause (≤80 chars). Examples:
  {"action":"block","reason":"slur directed at another member"}
  {"action":"warn","reason":"asking to take payment off-platform"}
  {"action":"allow","reason":""}
"""


async def _moderator_enabled() -> bool:
    """Cheap helper — settings doc is tiny so we can re-read each call."""
    from routers.settings import get_setting
    return await get_setting("ai_moderator_enabled", False)


def _heuristic_check(text: str) -> Tuple[Action, str] | None:
    """Fast-path: catch the obvious WITHOUT an LLM call.
    Returns None if the message needs LLM judgment."""
    if _OBVIOUS_SLURS.search(text):
        return "block", "matched slur list (heuristic)"
    if len(_LINK_SPAM.findall(text)) >= 3:
        return "block", "3+ links in one message (heuristic spam)"
    if len(text) > 800:  # near the 1000 cap
        return "warn", "very long message — possible copy-paste spam"
    return None


def _parse_llm_response(raw: str) -> Tuple[Action, str]:
    """Tolerant parser — LLMs sometimes wrap JSON in code-fences or chatter."""
    raw = (raw or "").strip()
    # Try to extract first JSON object via regex.
    m = re.search(r"\{[^{}]*\"action\"[^{}]*\}", raw, re.DOTALL)
    if m:
        try:
            obj = json.loads(m.group(0))
            action = obj.get("action", "").lower()
            reason = (obj.get("reason") or "")[:140]
            if action in ("allow", "warn", "block"):
                return action, reason  # type: ignore[return-value]
        except json.JSONDecodeError:
            pass
    return "allow", "parse_error_fail_open"


async def moderate_message(
    *, channel: str, user_email: str, user_name: str, text: str,
) -> Tuple[Action, str]:
    """Classify a single chat message. Always returns (action, reason).
    Logs every non-allow decision to `ai_mod_log`."""
    if not await _moderator_enabled():
        return "allow", "moderator_disabled"

    # Heuristic pre-pass.
    pre = _heuristic_check(text)
    if pre and pre[0] in ("block",):
        await _record(channel, user_email, user_name, text, *pre, source="heuristic")
        return pre

    if not EMERGENT_LLM_KEY:
        # Fail-open if no LLM key is configured — never silence the room.
        return "allow", "no_llm_key"

    session = f"mod-{uuid.uuid4().hex[:12]}"
    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=session,
        system_message=SYSTEM_PROMPT,
    ).with_model("anthropic", "claude-haiku-4-5")
    try:
        reply = await chat.send_message(UserMessage(text=text[:1000]))
    except Exception as e:
        logger.exception("[ai_mod] LLM call failed, failing open: %s", e)
        return "allow", "llm_error_fail_open"

    action, reason = _parse_llm_response(str(reply))
    if action != "allow":
        await _record(channel, user_email, user_name, text, action, reason, source="llm")
    return action, reason


async def _record(
    channel: str, user_email: str, user_name: str, text: str,
    action: Action, reason: str, *, source: str,
) -> None:
    await db.ai_mod_log.insert_one({
        "id": str(uuid.uuid4()),
        "channel": channel,
        "user_email": user_email,
        "user_name": user_name,
        "text": text[:500],
        "action": action,
        "reason": reason,
        "source": source,  # "heuristic" | "llm"
        "created_at": now_iso(),
    })
    logger.info("[ai_mod] %s · %s · %s · %s", action, channel, user_email, reason)


async def list_recent(limit: int = 100) -> list[dict]:
    """Return the most recent moderation events for the admin Audit tab."""
    rows = await db.ai_mod_log.find(
        {}, {"_id": 0},
    ).sort("created_at", -1).to_list(max(1, min(limit, 500)))
    return rows
