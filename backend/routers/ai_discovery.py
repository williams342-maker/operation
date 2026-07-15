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
from config import env_get

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
            f"{i+1}. SLUG={p['slug']} | {p.get('title', '')} | category={p.get('category', '')} | "
            f"tech={p.get('technique', '')} | materials={mats} | colors={colors} | "
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
    api_key = env_get("EMERGENT_LLM_KEY")
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


# ============================================================================
# AI Maker Matching — pairs a custom-order brief with the best-fit makers.
# ============================================================================

class MakerMatchQuery(BaseModel):
    description: str
    project_type: Optional[str] = None
    material: Optional[str] = None


async def _load_maker_snippet():
    """Compact makers view for the LLM. Tagging-friendly: name, slug,
    location, techniques, machinery, years_crafting, first 240 chars of
    bio. We omit subscription + finance fields — irrelevant for match
    quality and they'd inflate the prompt."""
    cursor = db.makers.find(
        {"deleted_at": {"$ne": True}},
        {
            "_id": 0,
            "slug": 1, "name": 1, "location": 1, "techniques": 1,
            "machinery": 1, "years_crafting": 1, "bio": 1, "rating": 1,
            "is_veteran_owned": 1, "featured_example": 1, "portrait": 1,
            "cover": 1,
        },
    )
    return await cursor.to_list(200)


def _build_maker_blob(items: list) -> str:
    """Render the maker directory as a numbered compact list for the LLM."""
    lines = []
    for i, m in enumerate(items):
        bio = (m.get("bio") or "").replace("\n", " ")[:240]
        techs = ", ".join(m.get("techniques") or [])
        machinery = ", ".join((m.get("machinery") or [])[:5])
        yc = m.get("years_crafting") or 0
        vet = " · VETERAN-OWNED" if m.get("is_veteran_owned") else ""
        lines.append(
            f"{i+1}. SLUG={m['slug']} | {m['name']} | location={m.get('location','')} | "
            f"techniques={techs} | machinery={machinery} | years={yc}{vet} | bio={bio}"
        )
    return "\n".join(lines)


@router.post("/ai/discovery/match-makers")
async def ai_match_makers(body: MakerMatchQuery):
    """Given a custom-order brief (description + optional project type
    and material), rank the top 3 makers most likely to deliver well.
    Used by the `/custom-order` form right after the visitor fills in
    the description — nudges briefs to the right person."""
    desc = (body.description or "").strip()
    if len(desc) < 20:
        raise HTTPException(400, "Description must be at least 20 characters.")
    if len(desc) > 4000:
        raise HTTPException(400, "Description too long (max 4000 chars).")

    cache_key = "match-makers:" + hashlib.md5(
        (_normalize_query(desc) + "|" + (body.project_type or "") + "|" + (body.material or "")).encode(),
    ).hexdigest()
    cached = _cache_get(cache_key)
    if cached:
        return {**cached, "cached": True}

    makers = await _load_maker_snippet()
    if not makers:
        return {"matches": [], "fallback": "empty_directory"}

    blob = _build_maker_blob(makers)
    payload_meta = f"\nProject type: {body.project_type or '(unspecified)'}\nMaterial preference: {body.material or '(unspecified)'}"

    prompt = f"""You're routing a custom-order brief to the best-fit maker on an artisan CNC/maker marketplace. Match by techniques + machinery + experience + bio signals — not by personality or location.

BUYER BRIEF:
{desc[:2000]}
{payload_meta}

MAKER DIRECTORY (use SLUG to identify each):
{blob}

RULES:
- Return up to 3 makers, ordered best-fit-first. Drop any that aren't a strong match — don't pad.
- For each pick, write a 1-sentence reason (max 22 words) naming the specific match signal (technique, machinery, years, bio detail).
- NO marketing language. Plain factual reasoning.

Return ONLY valid JSON. Schema:
{{"matches": [{{"slug": "...", "reason": "..."}}, ...]}}"""

    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
    except Exception:
        return {"matches": [], "fallback": "llm_unavailable"}

    api_key = env_get("EMERGENT_LLM_KEY")
    if not api_key:
        return {"matches": [], "fallback": "no_api_key"}

    chat = (
        LlmChat(
            api_key=api_key,
            session_id=f"match-makers-{hashlib.md5(desc.encode()).hexdigest()[:8]}",
            system_message="You match custom-order briefs to artisan makers. Output strict JSON only.",
        ).with_model("gemini", "gemini-3-flash-preview")
    )

    try:
        text = await asyncio.wait_for(chat.send_message(UserMessage(text=prompt)), timeout=20)
    except Exception as e:
        logger.warning("match-makers LLM failed: %s", e)
        return {"matches": [], "fallback": "llm_error"}

    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip(), flags=re.MULTILINE)
    try:
        data = json.loads(cleaned)
    except Exception:
        m = re.search(r"\{.*\}", cleaned, re.DOTALL)
        if not m:
            return {"matches": [], "fallback": "parse_error"}
        try:
            data = json.loads(m.group(0))
        except Exception:
            return {"matches": [], "fallback": "parse_error"}

    raw_matches = (data.get("matches") or [])[:3]
    by_slug = {m["slug"]: m for m in makers}
    hydrated = []
    for rm in raw_matches:
        m = by_slug.get(rm.get("slug"))
        if not m:
            continue
        hydrated.append({**m, "match_reason": rm.get("reason", "")})

    response = {"matches": hydrated, "count": len(hydrated)}
    _cache_set(cache_key, response)
    return response


# ============================================================================
# Similar Products — "More like this" on product detail pages.
# ============================================================================

@router.get("/ai/discovery/similar-products/{slug}")
async def ai_similar_products(slug: str):
    """Returns up to 4 products similar to the given product. Used by
    the ProductDetail page's "More like this" rail. The LLM gets the
    seed product's attributes + the full catalog blob, ranks by
    category/material/technique/aesthetic similarity, and returns 4
    slugs with a one-sentence reason each."""
    cache_key = f"similar:{slug}"
    cached = _cache_get(cache_key)
    if cached:
        return {**cached, "cached": True}

    seed = await db.products.find_one(
        {"slug": slug, "deleted_at": None},
        {
            "_id": 0, "slug": 1, "title": 1, "category": 1, "technique": 1,
            "materials": 1, "description": 1, "seo_tags": 1, "colors": 1,
        },
    )
    if not seed:
        raise HTTPException(404, "Product not found.")

    catalog = await _load_catalog_snippet()
    # Exclude the seed itself.
    catalog = [p for p in catalog if p["slug"] != slug]
    if not catalog:
        return {"similar": [], "count": 0}

    catalog_blob = _build_catalog_blob(catalog)
    seed_blob = (
        f"SEED PRODUCT: {seed['title']} | category={seed['category']} | "
        f"technique={seed['technique']} | materials={', '.join(seed.get('materials') or [])} | "
        f"tags={', '.join(seed.get('seo_tags') or [])} | "
        f"description={(seed.get('description') or '')[:250]}"
    )

    prompt = f"""You're surfacing "more like this" recommendations on an artisan marketplace product page.

{seed_blob}

CATALOG (use SLUG to identify each):
{catalog_blob}

RULES:
- Return up to 4 products that share material, technique, category, or aesthetic with the seed.
- Order by closest match first. Drop weak matches — don't pad.
- For each pick, 1-sentence reason (max 18 words) naming the shared signal.

Return ONLY valid JSON. Schema:
{{"similar": [{{"slug": "...", "reason": "..."}}, ...]}}"""

    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
    except Exception:
        return {"similar": [], "fallback": "llm_unavailable"}
    api_key = env_get("EMERGENT_LLM_KEY")
    if not api_key:
        return {"similar": [], "fallback": "no_api_key"}

    chat = (
        LlmChat(
            api_key=api_key,
            session_id=f"similar-{slug}",
            system_message="You rank artisan-marketplace listings by similarity. Output strict JSON only.",
        ).with_model("gemini", "gemini-3-flash-preview")
    )

    try:
        text = await asyncio.wait_for(chat.send_message(UserMessage(text=prompt)), timeout=20)
    except Exception as e:
        logger.warning("similar-products LLM failed for %s: %s", slug, e)
        return {"similar": [], "fallback": "llm_error"}

    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip(), flags=re.MULTILINE)
    try:
        data = json.loads(cleaned)
    except Exception:
        m = re.search(r"\{.*\}", cleaned, re.DOTALL)
        if not m:
            return {"similar": [], "fallback": "parse_error"}
        try:
            data = json.loads(m.group(0))
        except Exception:
            return {"similar": [], "fallback": "parse_error"}

    raw = (data.get("similar") or [])[:4]
    by_slug = {p["slug"]: p for p in catalog}
    hydrated = []
    for rs in raw:
        p = by_slug.get(rs.get("slug"))
        if not p:
            continue
        hydrated.append({**p, "match_reason": rs.get("reason", "")})

    payload = {"similar": hydrated, "count": len(hydrated)}
    _cache_set(cache_key, payload)
    return payload

