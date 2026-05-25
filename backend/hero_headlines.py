"""Rotating hero headline pool (iter220).

Daily APScheduler cron drafts 3-5 new hero headline variants via Gemini
(through the Emergent universal LLM key) and inserts them into the
`hero_headlines` Mongo collection. The frontend reads the live pool via
GET /api/hero/headlines (public, cached) and cycles through them on the
homepage hero.

Schema (`hero_headlines`):
  id            str   uuid
  statement     str   ≤ 28 chars, top line, no terminal period
  accent        str   ≤ 12 chars, first word of bottom line, gets orange
  closer        str   ≤ 16 chars, rest of bottom line, no terminal period
  source        str   "seed" | "ai" | "manual"
  status        str   "live" | "archived"
  pinned        bool  when True, this single headline overrides rotation
  ai_model      str?  only set when source="ai"
  created_at    str   iso8601 utc

The Hero renders:  "{statement}." over "{accent} {closer}." with the
accent word painted orange (#ff4500). The format is enforced by
`_normalize_variant()` so a malformed AI response can't ever ship.

Mounted as the daily `hero_headlines_refresh` cron in scheduler.py
(default 09:00 UTC, kill-switch SCHEDULER_HERO_HEADLINES=false).
"""
from __future__ import annotations

import logging
import os
import re
import uuid
from datetime import datetime, timezone

from core import db

logger = logging.getLogger("crafters")

# Hard caps the AI is told to obey and the validator enforces.
MAX_STATEMENT = 28
MAX_ACCENT = 12
MAX_CLOSER = 16
TARGET_POOL_SIZE = 12  # how many "live" headlines we want in the pool at any time
DAILY_NEW_COUNT = 5    # how many fresh variants to draft per cron run

# User-curated seed variants from the iter220 brief — these always live in
# the pool and never get archived by the auto-trim. They are the baseline
# voice the AI extends.
SEED_VARIANTS: list[dict] = [
    # User's 4 explicit examples (verbatim) — broken into the
    # statement/accent/closer shape. The accent word is the most
    # punchy/branded noun in each closer phrase.
    {"statement": "Built by Real Makers",      "accent": "American",  "closer": "Workshops"},
    {"statement": "Custom Work",               "accent": "Independent","closer": "Workshops"},
    {"statement": "Precision Craftsmanship",   "accent": "Modern",     "closer": "Marketplace"},
    {"statement": "Fabricators · Artists",     "accent": "Makers",     "closer": "Sell Here"},
    # On-brand companions
    {"statement": "Raw Materials",             "accent": "Radical",    "closer": "Craft"},
    {"statement": "Steel · Wood · Light",      "accent": "Forged",     "closer": "in America"},
    {"statement": "No Drop-shipping",          "accent": "Real",       "closer": "Workshops Only"},
    {"statement": "Hands · Tools · Sparks",    "accent": "Built",      "closer": "to Order"},
]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ─────────────────────────────────────────────────────────────────────────────
# Validation
# ─────────────────────────────────────────────────────────────────────────────

_BANNED_CHARS = re.compile(r"[\"\\<>{}\[\]\n\r\t]")


def _clean(s: str) -> str:
    """Trim, strip outer quotes/periods, collapse internal whitespace, drop
    any character that would break the giant CSS layout."""
    if not isinstance(s, str):
        return ""
    s = s.strip().strip(".").strip(",").strip("\"'·-—–")
    s = _BANNED_CHARS.sub("", s)
    s = re.sub(r"\s+", " ", s)
    return s.strip()


def _normalize_variant(raw: dict) -> dict | None:
    """Coerce one LLM dict into our canonical schema. Returns None when
    the variant breaks any structural rule — caller logs + discards."""
    statement = _clean(raw.get("statement", ""))
    accent = _clean(raw.get("accent", ""))
    closer = _clean(raw.get("closer", ""))

    if not (statement and accent and closer):
        return None
    if len(statement) > MAX_STATEMENT:
        return None
    if len(accent) > MAX_ACCENT or " " in accent:
        return None  # accent MUST be a single word — it's the painted highlight
    if len(closer) > MAX_CLOSER:
        return None
    return {"statement": statement, "accent": accent, "closer": closer}


# ─────────────────────────────────────────────────────────────────────────────
# AI generation
# ─────────────────────────────────────────────────────────────────────────────

async def generate_ai_variants(count: int = DAILY_NEW_COUNT) -> list[dict]:
    """Call Gemini once for `count` headline drafts. Returns the
    post-validation list (could be fewer than `count` if some rows were
    rejected). Returns [] on any LLM error so the cron can no-op
    gracefully."""
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
    except Exception as e:
        logger.warning("[hero_headlines] emergentintegrations unavailable: %s", e)
        return []

    api_key = os.getenv("EMERGENT_LLM_KEY")
    if not api_key:
        logger.warning("[hero_headlines] EMERGENT_LLM_KEY missing — skipping")
        return []

    # Build the few-shot examples in-prompt from the seed pool so the AI
    # mirrors the exact voice + length rather than inventing a new one.
    examples = "\n".join(
        f'  - statement="{v["statement"]}" · accent="{v["accent"]}" · closer="{v["closer"]}"'
        for v in SEED_VARIANTS[:6]
    )

    prompt = f"""You write giant-display marketing headlines for Crafters Market — a premium American marketplace for CNC, plasma, welding, woodworking and laser-engraving makers.

Each headline is rendered as TWO MASSIVE LINES on the homepage hero:
  LINE 1 (white):  "{{statement}}."
  LINE 2 (orange + outline): "{{accent}} {{closer}}."

STRUCTURE RULES (enforced by validator — break any and your variant is discarded):
- statement: 1-3 short words, ≤ {MAX_STATEMENT} chars, NO trailing period
- accent:    EXACTLY ONE WORD, ≤ {MAX_ACCENT} chars (this word becomes the painted orange highlight)
- closer:    1-3 words, ≤ {MAX_CLOSER} chars, NO trailing period

VOICE: industrial · craft · maker · workshop · American · real · built · forged · precision · raw · independent · custom · fabrication
AVOID: "amazing", "premium", "luxury", "exclusive", "discover", "explore", emojis, generic SaaS-speak, anything that sounds like Etsy or Amazon ad copy.

EXAMPLES (do NOT copy these — generate fresh variants in this exact format & voice):
{examples}

Generate {count} fresh distinct variants. Return ONLY a valid JSON array — no markdown fences, no commentary.

Schema:
[{{"statement": "...", "accent": "...", "closer": "..."}}, ...]"""

    chat = (
        LlmChat(
            api_key=api_key,
            session_id=f"hero-headlines-{uuid.uuid4().hex[:8]}",
            system_message="You write punchy 2-line marketing headlines for an industrial maker marketplace. Output strict JSON only.",
        )
        .with_model("gemini", "gemini-3-flash-preview")
    )

    try:
        text = await chat.send_message(UserMessage(text=prompt))
    except Exception as e:
        logger.warning("[hero_headlines] LLM call failed: %s", e)
        return []

    return _parse_and_validate(text, count)


def _parse_and_validate(raw: str, expected: int) -> list[dict]:
    import json
    s = raw.strip()
    # Strip ``` fences if the model ignored "no markdown" instruction
    if s.startswith("```"):
        s = re.sub(r"^```(?:json)?\s*", "", s)
        s = re.sub(r"\s*```$", "", s)
    try:
        rows = json.loads(s)
    except Exception as e:
        logger.warning("[hero_headlines] JSON parse failed: %s — raw=%r", e, s[:200])
        return []
    if not isinstance(rows, list):
        return []

    out: list[dict] = []
    for raw_row in rows:
        if not isinstance(raw_row, dict):
            continue
        norm = _normalize_variant(raw_row)
        if norm:
            out.append(norm)
    logger.info("[hero_headlines] parsed %d/%d variants (validator-pass)", len(out), expected)
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Pool management
# ─────────────────────────────────────────────────────────────────────────────

async def ensure_seed_pool() -> int:
    """Idempotent seed: inserts SEED_VARIANTS once on first boot.
    Returns the count actually inserted."""
    inserted = 0
    for v in SEED_VARIANTS:
        exists = await db.hero_headlines.find_one(
            {"statement": v["statement"], "accent": v["accent"], "closer": v["closer"]},
            {"_id": 0, "id": 1},
        )
        if exists:
            continue
        doc = {
            "id": str(uuid.uuid4()),
            "statement": v["statement"],
            "accent": v["accent"],
            "closer": v["closer"],
            "source": "seed",
            "status": "live",
            "pinned": False,
            "ai_model": None,
            "created_at": now_iso(),
        }
        await db.hero_headlines.insert_one(doc)
        inserted += 1
    if inserted:
        logger.info("[hero_headlines] seeded %d baseline headlines", inserted)
    return inserted


async def refresh_pool(count: int = DAILY_NEW_COUNT) -> dict:
    """One full refresh cycle:
      1. Ensure seed pool is in place (idempotent).
      2. Call Gemini for `count` fresh variants.
      3. Insert variants that aren't already in the pool (dedupe by
         statement+accent+closer key).
      4. Auto-archive the oldest AI variants beyond TARGET_POOL_SIZE so
         the pool never balloons.
    Returns a stats dict the cron + admin endpoint surface."""
    await ensure_seed_pool()

    variants = await generate_ai_variants(count)
    inserted = 0
    skipped_dup = 0
    for v in variants:
        existing = await db.hero_headlines.find_one(
            {"statement": v["statement"], "accent": v["accent"], "closer": v["closer"]},
            {"_id": 0, "id": 1},
        )
        if existing:
            skipped_dup += 1
            continue
        await db.hero_headlines.insert_one({
            "id": str(uuid.uuid4()),
            "statement": v["statement"],
            "accent": v["accent"],
            "closer": v["closer"],
            "source": "ai",
            "status": "live",
            "pinned": False,
            "ai_model": "gemini-3-flash-preview",
            "created_at": now_iso(),
        })
        inserted += 1

    # Auto-archive the oldest AI variants beyond pool size (seeds always stay)
    live_ai = await db.hero_headlines.count_documents({"source": "ai", "status": "live"})
    archived = 0
    overflow = live_ai - (TARGET_POOL_SIZE - len(SEED_VARIANTS))
    if overflow > 0:
        async for doc in db.hero_headlines.find(
            {"source": "ai", "status": "live", "pinned": False},
            {"_id": 0, "id": 1},
        ).sort("created_at", 1).limit(overflow):
            await db.hero_headlines.update_one({"id": doc["id"]}, {"$set": {"status": "archived"}})
            archived += 1

    stats = {
        "drafted_by_ai": len(variants),
        "inserted": inserted,
        "skipped_dup": skipped_dup,
        "archived_old": archived,
    }
    logger.info("[hero_headlines] refresh complete · %s", stats)
    return stats
