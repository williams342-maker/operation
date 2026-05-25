"""
AI-powered discovery endpoint.

Accepts a free-text query like "rustic mountain-themed metal sign" and
returns the 6 best-matching listings from the catalog, each annotated
with a one-sentence "why this matches" reason. Uses Gemini Flash as
the matching engine — Gemini sees the user query + a compact catalog
snippet and returns ranked slugs as strict JSON.

We intentionally keep the catalog blob small (slug + title + category
+ technique + materials + first 200 chars of description) so a single
Gemini Flash call stays well under the context window. At the current
34-product scale, the prompt is ~10KB and returns in <2s.

Results are cached in memory by normalized-query hash for 1 hour to
keep repeat searches snappy and the LLM bill near zero.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import re
import time
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core import db

router = APIRouter()
logger = logging.getLogger("crafters.ai_discovery")

# In-process cache. Maps `q_hash -> (expires_epoch, response_payload)`.
# Tiny by design — at 34 products and ~1KB per cached response, even
# 5000 distinct queries would fit in a few MB. Auto-evicts on read.
_CACHE: dict[str, tuple[float, dict]] = {}
_CACHE_TTL_SECONDS = 3600  # 1 hour


def _cache_get(key: str):
    entry = _CACHE.get(key)
    if not entry:
        return None
    expires, payload = entry
    if expires < time.time():
        _CACHE.pop(key, None)
        return None
    return payload


def _cache_set(key: str, payload: dict):
    _CACHE[key] = (time.time() + _CACHE_TTL_SECONDS, payload)


class DiscoveryQuery(BaseModel):
    q: str


def _normalize_query(q: str) -> str:
    """Lowercase + collapse whitespace + strip punctuation for cache
    hits across cosmetic variations of the same query."""
    q = q.lower().strip()
    q = re.sub(r"[^a-z0-9\s]", " ", q)
    q = re.sub(r"\s+", " ", q)
    return q[:200]  # hard cap so a giant query can't blow up the cache key


async def _load_catalog_snippet():
    """Compact view of the catalog for the LLM prompt — only the fields
    that actually drive relevance. Sorted by created_at desc so the model
    sees the freshest items first in case it has any positional bias."""
    cursor = db.products.find(
        {"deleted_at": None, "status": "published"},
        {
            "_id": 0,
            "slug": 1, "title": 1, "category": 1, "technique": 1,
            "materials": 1, "description": 1, "seo_tags": 1, "price": 1,
            "colors": 1, "maker_slug": 1, "images": 1,
            "featured_example": 1,
        },
    ).sort("created_at", -1)
    return await cursor.to_list(500)


def _build_catalog_blob(items: list) -> str:
    """Render the catalog as a compact numbered list. Capping description
    keeps the prompt small without losing the semantic signal."""
    lines = []
    for i, p in enumerate(items):
        desc = (p.get("description") or "").replace("\n", " ")[:200]
        mats = ", ".join(p.get("materials") or [])
        tags = ", ".join(p.get("seo_tags") or [])
        colors = ", ".join(p.get("colors") or [])
        lines.append(
            f"{i+1}. SLUG={p['slug']} | {p['title']} | category={p['category']} | "
            f"tech={p['technique']} | materials={mats} | colors={colors} | "
            f"tags={tags} | desc={desc}"
        )
    return "\n".join(lines)


async def _llm_match(q: str, catalog_blob: str) -> Optional[list]:
    """Ask Gemini Flash for the top 6 matching slugs with a per-result
    reason. Returns None on any failure so the caller can fall back to
    a substring search."""
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
    except Exception:
        return None
    api_key = os.getenv("EMERGENT_LLM_KEY")
    if not api_key:
        return None

    prompt = f"""You are a search assistant for an artisan CNC/maker marketplace. The buyer described what they want; rank the catalog by how well each listing matches their description.

BUYER QUERY: {q}

CATALOG (one listing per line — use the SLUG to identify each):
{catalog_blob}

RULES:
- Return ONLY listings whose materials, technique, or description plausibly fit the query. If nothing fits, return an empty list.
- Up to 6 results, ordered best-first. Drop any that aren't a genuinely good match — don't pad.
- For each match, write a SHORT one-sentence reason (max 18 words) that names the specific match signal (material/technique/style/use case).
- NO marketing voice. Plain, factual reasoning a working maker would write.

Return ONLY valid JSON, no markdown fencing. Schema:
{{"results": [{{"slug": "...", "reason": "..."}}, ...]}}"""

    chat = (
        __import__("emergentintegrations.llm.chat", fromlist=["LlmChat"]).LlmChat(
            api_key=api_key,
            session_id=f"discovery-{hashlib.md5(q.encode()).hexdigest()[:8]}",
            system_message="You rank artisan-marketplace listings by buyer intent. Output strict JSON only.",
        ).with_model("gemini", "gemini-3-flash-preview")
    )

    try:
        text = await asyncio.wait_for(
            chat.send_message(UserMessage(text=prompt)), timeout=20,
        )
    except Exception as e:
        logger.warning("discovery LLM call failed: %s", e)
        return None

    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip(), flags=re.MULTILINE)
    try:
        data = json.loads(cleaned)
    except Exception:
        m = re.search(r"\{.*\}", cleaned, re.DOTALL)
        if not m:
            return None
        try:
            data = json.loads(m.group(0))
        except Exception:
            return None

    results = data.get("results", []) or []
    return [r for r in results if r.get("slug")][:6]


@router.post("/ai/discovery/search")
async def ai_discovery_search(body: DiscoveryQuery):
    """Natural-language product search. Public endpoint — anyone can
    type "rustic mountain metal sign" and get a ranked list back."""
    q = (body.q or "").strip()
    if len(q) < 3:
        raise HTTPException(400, "Query must be at least 3 characters.")
    if len(q) > 300:
        raise HTTPException(400, "Query is too long (max 300 chars).")

    cache_key = hashlib.md5(_normalize_query(q).encode()).hexdigest()
    cached = _cache_get(cache_key)
    if cached:
        return {**cached, "cached": True}

    catalog = await _load_catalog_snippet()
    if not catalog:
        return {"query": q, "results": [], "fallback": "empty_catalog"}

    catalog_blob = _build_catalog_blob(catalog)
    matches = await _llm_match(q, catalog_blob)

    # Fall back to a very simple title/description/tag substring filter
    # if the LLM is unreachable or returned junk — better than a blank
    # results screen.
    if matches is None:
        ql = q.lower()
        scored = []
        for p in catalog:
            hay = " ".join([
                p.get("title", ""),
                p.get("description", ""),
                " ".join(p.get("seo_tags") or []),
                " ".join(p.get("materials") or []),
                p.get("category", ""),
            ]).lower()
            if any(tok in hay for tok in ql.split() if len(tok) > 2):
                scored.append(p["slug"])
            if len(scored) >= 6:
                break
        matches = [{"slug": s, "reason": "Matched on text search (AI fell back)."} for s in scored]

    # Hydrate the matched slugs back to full product cards.
    by_slug = {p["slug"]: p for p in catalog}
    hydrated = []
    for m in matches:
        p = by_slug.get(m["slug"])
        if not p:
            continue
        hydrated.append({**p, "match_reason": m.get("reason", "")})

    payload = {"query": q, "results": hydrated, "count": len(hydrated)}
    _cache_set(cache_key, payload)
    return payload
