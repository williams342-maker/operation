"""iter320 — Auto-generate SEO tags for design files + showcase posts.

Both surfaces currently lack proper SEO metadata, making them invisible
to crawlers even though the prerender + sitemap infrastructure is
already in place. This module fills the gap with an LLM-generated
title / description / tags / alt-text on every row.

Uses Claude Sonnet 4.5 via the Emergent LLM key. Per-call cost is
trivial (~$0.001 per row at current Sonnet pricing) so a full backfill
of the live catalog runs in under $1.

Output schema (written verbatim onto each row):
    seo_title        — ≤60 chars, keyword-rich, action-oriented
    seo_description  — ≤160 chars, scannable, ends with a CTA
    seo_tags         — 5-10 lowercase keyword tags (deduped)
    alt_text         — ≤120 chars, accessible image description

The LLM call is structured-output via JSON-mode so we get all four
fields in one round-trip without any post-parsing flake.
"""
from __future__ import annotations

import json
import logging
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from emergentintegrations.llm.chat import LlmChat, UserMessage

logger = logging.getLogger("crafters.auto_seo_tags")

EMERGENT_LLM_KEY = os.environ["EMERGENT_LLM_KEY"]
MODEL_PROVIDER = "anthropic"
MODEL_NAME = "claude-sonnet-4-5-20250929"


# ────────────────────────────────────────────────────────────────────
# Prompts
# ────────────────────────────────────────────────────────────────────

_DESIGN_FILE_SYSTEM = """You write SEO metadata for a marketplace of free CNC, plasma, laser, and wood design files (SVG, DXF, STL). Output JSON only.

Schema:
{
  "seo_title": string (max 60 chars, keyword-rich, no clickbait, no all-caps),
  "seo_description": string (max 160 chars, ends with a clear CTA like "Download free." or "Free SVG/DXF."),
  "seo_tags": [string, ...] (5 to 10 lowercase keyword tags, no hashtags, no duplicates),
  "alt_text": string (max 120 chars, describes what's in the design file image for a screen reader)
}

Brand voice: tactile, industrial, plainspoken. American-made craft, not Etsy-cute. Avoid "amazing," "stunning," "perfect." Speak to CNC operators, plasma cutters, laser engravers, and wood routers who download files to cut at home.

Always end seo_description with "Download free." or "Free SVG and DXF." or similar terminal CTA."""

_SHOWCASE_SYSTEM = """You write SEO metadata for individual maker showcase posts on a marketplace of vetted American CNC, plasma, laser, and wood makers. Each showcase is a real shop photo posted by a maker. Output JSON only.

Schema:
{
  "seo_title": string (max 60 chars, descriptive, includes maker craft if obvious),
  "seo_description": string (max 160 chars, talks about what's pictured, who made it, and the technique. Ends with a soft CTA like "See more from this maker." or "Browse the shop."),
  "seo_tags": [string, ...] (5 to 10 lowercase tags covering technique, material, category),
  "alt_text": string (max 120 chars, describes what's visible in the photo for a screen reader)
}

Brand voice: respectful of the craft, factual, no marketing puffery. The post is by a real person about their own work — describe it the way a fellow maker would, not the way a copywriter would."""


# ────────────────────────────────────────────────────────────────────
# Core
# ────────────────────────────────────────────────────────────────────


def _truncate(s: str, n: int) -> str:
    s = (s or "").strip()
    return s if len(s) <= n else s[: n - 1].rstrip() + "…"


def _normalize_tags(raw: Any) -> list[str]:
    if not isinstance(raw, list):
        return []
    seen: set[str] = set()
    out: list[str] = []
    for t in raw:
        if not isinstance(t, str):
            continue
        t2 = re.sub(r"[^a-z0-9 \-]", "", t.lower().strip()).strip()
        if not t2 or t2 in seen:
            continue
        seen.add(t2)
        out.append(t2)
        if len(out) >= 10:
            break
    return out


def _strip_code_fences(raw: str) -> str:
    """Claude sometimes wraps JSON in ```json ... ``` despite the JSON-
    only instruction. Strip those so json.loads succeeds."""
    s = raw.strip()
    if s.startswith("```"):
        s = re.sub(r"^```(?:json)?\s*", "", s)
        s = re.sub(r"\s*```$", "", s)
    return s


async def _llm_generate(system: str, user_prompt: str) -> Optional[dict]:
    """Single LLM round-trip, parsed JSON output. Returns None on
    network / parse errors — caller logs and skips the row."""
    session_id = f"auto-seo-{uuid.uuid4().hex[:12]}"
    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=session_id,
        system_message=system,
    ).with_model(MODEL_PROVIDER, MODEL_NAME)
    try:
        reply = await chat.send_message(UserMessage(text=user_prompt))
    except Exception as e:
        logger.warning("[auto_seo] LLM call failed: %s", e)
        return None
    try:
        data = json.loads(_strip_code_fences(str(reply)))
    except json.JSONDecodeError as e:
        logger.warning("[auto_seo] non-JSON reply (%s): %s", e, str(reply)[:200])
        return None
    return data


def _coerce(data: dict) -> dict:
    """Enforce length limits + tag normalization on the LLM output."""
    return {
        "seo_title": _truncate(data.get("seo_title") or "", 60),
        "seo_description": _truncate(data.get("seo_description") or "", 160),
        "seo_tags": _normalize_tags(data.get("seo_tags")),
        "alt_text": _truncate(data.get("alt_text") or "", 120),
    }


# ────────────────────────────────────────────────────────────────────
# Per-surface generators
# ────────────────────────────────────────────────────────────────────


async def generate_for_design_file(doc: dict) -> Optional[dict]:
    """Returns the four-field SEO dict for a design-file row, or None
    on LLM failure. Doesn't touch the DB."""
    user_prompt = json.dumps({
        "title": doc.get("title") or "",
        "description": doc.get("description") or "",
        "file_type": doc.get("file_type") or "",
        "maker_name": doc.get("maker_name") or "",
        "variant_formats": [
            (v.get("format") or "").upper()
            for v in (doc.get("variants") or [])
            if v.get("format")
        ],
    }, separators=(",", ":"))
    raw = await _llm_generate(_DESIGN_FILE_SYSTEM, user_prompt)
    return _coerce(raw) if raw else None


async def generate_for_showcase_post(doc: dict) -> Optional[dict]:
    """Returns the four-field SEO dict for a showcase-post row, or None
    on LLM failure."""
    user_prompt = json.dumps({
        "title": doc.get("title") or "",
        "description": doc.get("description") or doc.get("caption") or "",
        "maker_name": doc.get("maker_name") or doc.get("user_name") or "",
        "maker_slug": doc.get("maker_slug") or "",
        "product_slug": doc.get("product_slug") or "",
    }, separators=(",", ":"))
    raw = await _llm_generate(_SHOWCASE_SYSTEM, user_prompt)
    return _coerce(raw) if raw else None


# ────────────────────────────────────────────────────────────────────
# Bulk runners
# ────────────────────────────────────────────────────────────────────


async def bulk_tag_design_files(db, *, limit: int = 25, force: bool = False) -> dict:
    """Walks `design_files` looking for non-quarantined rows that are
    missing any of the SEO fields, generates tags, writes them back.

    Returns per-row outcome + counts for the admin dashboard.

    `force=True` re-tags every row regardless of whether it already
    has SEO fields — useful for one-shot quality upgrades.
    """
    query: dict[str, Any] = {"quarantined_at": None}
    if not force:
        query["$or"] = [
            {"seo_title": {"$in": [None, ""]}},
            {"seo_tags": {"$in": [None, []]}},
            {"alt_text": {"$in": [None, ""]}},
        ]
    rows = await db.design_files.find(query, {
        "_id": 0, "id": 1, "title": 1, "description": 1,
        "file_type": 1, "maker_name": 1, "variants": 1,
    }).limit(limit).to_list(limit)

    results = []
    succeeded = 0
    for doc in rows:
        seo = await generate_for_design_file(doc)
        if not seo:
            results.append({"id": doc["id"], "title": doc.get("title"),
                             "ok": False, "reason": "llm_failed"})
            continue
        await db.design_files.update_one(
            {"id": doc["id"]},
            {"$set": {
                "seo_title": seo["seo_title"],
                "seo_description": seo["seo_description"],
                "seo_tags": seo["seo_tags"],
                "alt_text": seo["alt_text"],
                "seo_auto_generated_at": datetime.now(timezone.utc).isoformat(),
            }},
        )
        succeeded += 1
        results.append({"id": doc["id"], "title": doc.get("title"),
                         "ok": True, "seo_title": seo["seo_title"]})
    return {
        "attempted": len(rows), "succeeded": succeeded,
        "failed": len(rows) - succeeded, "results": results,
    }


async def bulk_tag_showcase_posts(db, *, limit: int = 25, force: bool = False) -> dict:
    """Same shape as `bulk_tag_design_files` but for `showcase_posts`.
    Skips admin-hidden rows."""
    query: dict[str, Any] = {"admin_hidden": {"$ne": True}}
    if not force:
        query["$or"] = [
            {"seo_title": {"$in": [None, ""]}},
            {"seo_tags": {"$in": [None, []]}},
            {"alt_text": {"$in": [None, ""]}},
        ]
    rows = await db.showcase_posts.find(query, {
        "_id": 0, "id": 1, "title": 1, "description": 1, "caption": 1,
        "maker_slug": 1, "product_slug": 1, "user_name": 1,
    }).limit(limit).to_list(limit)

    results = []
    succeeded = 0
    for doc in rows:
        seo = await generate_for_showcase_post(doc)
        if not seo:
            results.append({"id": doc["id"], "title": doc.get("title"),
                             "ok": False, "reason": "llm_failed"})
            continue
        await db.showcase_posts.update_one(
            {"id": doc["id"]},
            {"$set": {
                "seo_title": seo["seo_title"],
                "seo_description": seo["seo_description"],
                "seo_tags": seo["seo_tags"],
                "alt_text": seo["alt_text"],
                "seo_auto_generated_at": datetime.now(timezone.utc).isoformat(),
            }},
        )
        succeeded += 1
        results.append({"id": doc["id"], "title": doc.get("title"),
                         "ok": True, "seo_title": seo["seo_title"]})
    return {
        "attempted": len(rows), "succeeded": succeeded,
        "failed": len(rows) - succeeded, "results": results,
    }
