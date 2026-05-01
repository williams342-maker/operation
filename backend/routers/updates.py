"""Public Updates feed — parses /app/memory/CHANGELOG.md at request time
and serves the latest 20 entries in plain English to the public
`/updates` page. Auto-refreshes on every redeploy because we read
the markdown file, not a frozen list.

The changelog is engineering-flavored (mentions iter numbers, file paths,
test counts). For the public page we strip those and present each
entry as: title (translated to plain English), date, short blurb.
"""
from __future__ import annotations

import os
import re
from datetime import datetime
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Body
from fastapi.responses import RedirectResponse, HTMLResponse
from pydantic import BaseModel, EmailStr

from core import logger

router = APIRouter()

CHANGELOG_PATH = Path("/app/memory/CHANGELOG.md")
DEFAULT_LIMIT = 20

# Heading regex — every entry starts with: "## YYYY-MM — iterNN — Title …"
_HEADING_RE = re.compile(
    r"^##\s+"
    r"(?P<date>\d{4}-\d{2})"
    r"\s+—\s+iter(?P<iter>[\w]+)"
    r"\s+—\s+(?P<title>.+?)\s*$",
    re.MULTILINE,
)

# Tokens that are noise to a non-engineer reader; strip from titles.
_NOISE_PATTERNS = (
    re.compile(r"\([^)]*TESTED[^)]*\)", re.IGNORECASE),  # (TESTED ✅ N/N)
    re.compile(r"\bTESTED\b[^·\n]*", re.IGNORECASE),     # TESTED ✅ 5/5
    re.compile(r"·?\s*HIGH-priority bug", re.IGNORECASE),
    re.compile(r"\s+✅"),                                  # trailing ✅
    re.compile(r"\s+🐛"),
    re.compile(r"\s+🚀"),
    re.compile(r"\s{2,}"),                                # collapse double spaces
)


def _humanize_title(raw: str) -> str:
    """Strip engineer-flavored noise from a heading title."""
    t = raw.strip()
    for p in _NOISE_PATTERNS:
        t = p.sub(" ", t)
    t = t.strip(" ·—-").strip()
    # Lowercase a leading "Bug fix" / "🐛 ..." to "Bug fix"
    return t


def _extract_blurb(body: str) -> str:
    """Pull a single sentence from the body. Prefer **Why:** / **Context:**
    sentences; fall back to the first non-empty narrative line.
    Returns max ~180 chars to keep cards uniform.
    """
    # Try "**Why:** ..." or "**Context:** ..." first — these are the
    # human-friendly framings I write for non-engineers.
    for label in ("Why", "Context", "What", "User report"):
        m = re.search(rf"\*\*{label}:?\*\*\s*(.+?)(?:\n\n|\n\*\*|$)", body, re.DOTALL)
        if m:
            text = m.group(1).strip()
            return _trim_sentence(text)
    # Fall back to first prose line (skip files/test paths/code).
    for line in body.splitlines():
        line = line.strip()
        if not line:
            continue
        if line.startswith(("**", "-", "#", "```", "/app/", "Files:", "Test")):
            continue
        if line.startswith("(") and "—" not in line:
            continue
        return _trim_sentence(line)
    return ""


def _trim_sentence(text: str) -> str:
    # Strip markdown emphasis + code backticks for the public surface.
    text = re.sub(r"`([^`]+)`", r"\1", text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"\1", text)
    text = text.replace("\n", " ").strip()
    # Strip iter references — "iter92", "Post-iter92", "(iter92)"
    text = re.sub(r"\(?Post-?iter\w+\)?\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\(?iter\w+\)?\s*", "", text, flags=re.IGNORECASE)
    # Strip parenthetical asides containing tech noise
    text = re.sub(r"\([^)]*\b(api|/api|cron|backend|frontend|admin|JWT|env|ms|http)\b[^)]*\)", "", text, flags=re.IGNORECASE)
    # Strip leading "(/" file paths "/app/backend/...":
    text = re.sub(r"`?/app/[^\s`]+`?\s*", "", text)
    # Collapse whitespace and trim
    text = re.sub(r"\s{2,}", " ", text).strip(" ,;:—-")
    # Capitalize the first letter for polish
    if text:
        text = text[0].upper() + text[1:]
    # Cap at ~180 chars on a sentence boundary.
    if len(text) <= 180:
        return text
    cut = text[:180]
    last_period = cut.rfind(". ")
    if last_period > 80:
        return cut[: last_period + 1]
    return cut.rstrip() + "…"


def _parse_changelog(raw: str, limit: int) -> List[dict]:
    """Walk the markdown and return up to `limit` entries newest-first.

    Each entry: {date, iter, title, blurb}.
    """
    matches = list(_HEADING_RE.finditer(raw))
    if not matches:
        return []
    entries: List[dict] = []
    for i, m in enumerate(matches[:limit]):
        body_start = m.end()
        body_end = matches[i + 1].start() if i + 1 < len(matches) else len(raw)
        body = raw[body_start:body_end]
        title = _humanize_title(m.group("title"))
        blurb = _extract_blurb(body)
        entries.append({
            "date": m.group("date"),
            "iter": m.group("iter"),
            "title": title,
            "blurb": blurb,
        })
    return entries


@router.get("/updates")
async def public_updates(limit: int = DEFAULT_LIMIT):
    """Public changelog feed — newest 20 entries by default.

    Reads the on-disk changelog at request time so every redeploy
    auto-refreshes the public list with whatever was added.
    """
    limit = max(1, min(limit, 100))
    if not CHANGELOG_PATH.exists():
        logger.warning("[updates] CHANGELOG.md not found at %s", CHANGELOG_PATH)
        return {"updated_at": datetime.utcnow().isoformat(), "count": 0, "entries": []}
    try:
        raw = CHANGELOG_PATH.read_text(encoding="utf-8")
    except Exception as e:
        logger.exception("[updates] failed to read changelog: %s", e)
        return {"updated_at": datetime.utcnow().isoformat(), "count": 0, "entries": []}
    entries = _parse_changelog(raw, limit)
    return {
        "updated_at": datetime.utcnow().isoformat(),
        "count": len(entries),
        "entries": entries,
    }


# ============================================================
# Subscription endpoints — capture emails on the /updates page
# and let users 1-click unsubscribe from any digest email.
# ============================================================
class _SubscribeBody(BaseModel):
    email: EmailStr
    name: Optional[str] = None


@router.post("/updates/subscribe")
async def subscribe_to_updates(body: _SubscribeBody):
    """Idempotent: same email twice = no-op. Returns ok=True either way
    so we don't leak whether an address is already on the list."""
    from updates_digest import subscribe
    res = await subscribe(str(body.email), body.name)
    if not res.get("ok"):
        return {"ok": False, "error": res.get("error", "unknown")}
    return {"ok": True}


@router.get("/updates/unsubscribe")
async def unsubscribe_from_updates(token: str = ""):
    """One-click unsubscribe link from digest emails. Always returns a
    friendly HTML page (not JSON) because email clients open the link
    directly in a browser."""
    from updates_digest import unsubscribe
    res = await unsubscribe(token)
    msg = "You're unsubscribed from Crafters Market updates." if res.get("ok") and res.get("found") \
        else "We couldn't find that subscription — it may have already been removed."
    site = (os.environ.get("PUBLIC_SITE_URL") or "https://craftersmarket.org").rstrip("/")
    if "preview." in site or site.endswith(".emergentagent.com"):
        site = "https://craftersmarket.org"
    html = (
        "<!doctype html><html><head><meta charset='utf-8'>"
        "<title>Unsubscribed · Crafters Market</title>"
        "<meta name='viewport' content='width=device-width,initial-scale=1'>"
        "<style>body{margin:0;background:#0a0a0a;color:#e5e5e5;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;}"
        ".wrap{max-width:560px;margin:0 auto;padding:120px 24px;text-align:center}"
        "h1{font-family:'Impact','Anton',sans-serif;font-size:64px;letter-spacing:-0.02em;line-height:0.95;margin:0 0 28px;text-transform:uppercase}"
        "h1 span{color:#ff4500}"
        "p{font-size:13px;color:#a3a3a3;line-height:1.7;margin:0 0 32px}"
        "a{display:inline-block;padding:14px 24px;background:#ff4500;color:#0a0a0a;text-decoration:none;font-weight:700;font-size:12px;letter-spacing:0.15em;text-transform:uppercase}"
        ".chip{font-size:10px;letter-spacing:0.32em;color:#ff4500;text-transform:uppercase;margin-bottom:18px}"
        "</style></head><body>"
        "<div class='wrap'>"
        "<div class='chip'>◆ Crafters Market</div>"
        f"<h1>Got it.<br/><span>You're out.</span></h1>"
        f"<p>{msg}</p>"
        f"<a href='{site}'>Back to the site →</a>"
        "</div></body></html>"
    )
    return HTMLResponse(content=html)
