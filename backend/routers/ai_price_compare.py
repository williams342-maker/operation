"""AI Price Comparison — maker-facing companion (iter334).

What it does
============
Maker clicks "◆ AI Price Check" in the Listing Editor → backend:
  1. Pulls the listing's title + category + technique + materials.
  2. Hits Jina Reader's search endpoint (https://s.jina.ai/?q=…) for
     comparable items on Etsy + Amazon + the open web. Free, no API
     key needed — Reader handles the search + scraping + extraction.
  3. Sends the cleaned-up Reader output to Claude Sonnet 4.5 (via the
     Emergent LLM Key) with a strict JSON schema for the response.
  4. Returns: price range (low / median / high), 3–5 comparable
     listings with titles + prices + links, and a sharp 1–2-sentence
     recommendation on whether the maker's current price is high / on
     target / low vs the market.

Rate limit: 5 comparisons per listing per maker per day. Cached results
are returned if a comparison ran in the last 24h so repeat clicks are
free.

Endpoints
---------
POST /api/maker/listings/{slug}/price-compare
  Body: {} (no params — uses listing data on file)
  Returns: { price_range, comparables, recommendation, generated_at,
             from_cache: bool, remaining_today: int }
"""
from __future__ import annotations
import json
import os
import re
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from core import db, logger, now_iso
from maker_auth import current_maker_slug

router = APIRouter()

EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "")
JINA_SEARCH_URL = "https://s.jina.ai/"
PRICE_COMPARE_DAILY_LIMIT = 5  # per maker per listing per UTC day
CACHE_TTL_HOURS = 24

# Tight JSON schema — Claude is good at honoring this verbatim.
RESPONSE_SCHEMA_NOTE = """
You MUST return ONLY a valid JSON object — no prose, no markdown fences.
Schema:
{
  "price_low": <number, USD>,
  "price_median": <number, USD>,
  "price_high": <number, USD>,
  "currency": "USD",
  "comparables": [
    {"title": "...", "source": "Etsy" | "Amazon" | "Other", "price": <number>, "url": "..."},
    ... (3-5 entries)
  ],
  "recommendation": "1-2 short sentences. Sharp, direct. Tell them if their price is high, on target, or low vs market, and by roughly how much."
}
Use the maker's listed price as the reference for the recommendation.
If you can't find solid comparables, return empty `comparables` and a
recommendation explaining what the maker should research themselves.
""".strip()


# ───────────────────── helpers ─────────────────────
async def _get_listing(slug: str, maker_slug: str) -> dict:
    """Fetch & ownership-check the listing."""
    p = await db.products.find_one(
        {"slug": slug, "maker_slug": maker_slug}, {"_id": 0}
    )
    if not p:
        raise HTTPException(404, "Listing not found or not yours.")
    return p


def _build_search_query(listing: dict) -> str:
    """Craft a focused search query from the listing's metadata."""
    title = (listing.get("title") or "").strip()
    cat = (listing.get("category") or "").strip()
    tech = (listing.get("technique") or "").strip()
    materials = listing.get("materials") or []
    mat_str = " ".join(materials[:2]) if isinstance(materials, list) else ""
    # "Site bias" — encourage marketplace results without restricting
    # too hard. Etsy + handmade dominate this niche.
    pieces = [title, cat, tech, mat_str, "price handmade"]
    query = " ".join(p for p in pieces if p)
    # Cap at ~120 chars — Jina handles long queries fine but shorter is
    # snappier and avoids token bloat downstream.
    return query[:120]


async def _jina_reader_search(query: str) -> str:
    """Call Jina Reader search mode. Free, no API key for moderate use.

    Returns the raw text response (markdown-ish) the LLM will parse.
    Returns empty string on failure — caller handles fallback.
    """
    try:
        headers = {"Accept": "application/json"}
        # Jina Reader honors X-Engine: direct for HTML-rich pages, but the
        # default is fine for search aggregation.
        async with httpx.AsyncClient(timeout=20.0) as client:
            r = await client.get(JINA_SEARCH_URL, params={"q": query}, headers=headers)
        if r.status_code != 200:
            logger.warning("[price-compare] jina search returned %s for q=%r", r.status_code, query)
            return ""
        # Reader returns either JSON (with .data array) or markdown. Handle both.
        try:
            data = r.json()
            if isinstance(data, dict) and isinstance(data.get("data"), list):
                lines = []
                for entry in data["data"][:5]:
                    if not isinstance(entry, dict):
                        continue
                    lines.append(f"### {entry.get('title','')}")
                    lines.append(f"URL: {entry.get('url','')}")
                    content = entry.get("content") or entry.get("description") or ""
                    lines.append(content[:1500])
                    lines.append("")
                return "\n".join(lines)
        except (ValueError, json.JSONDecodeError):
            pass
        return r.text[:12000]  # cap at ~12kb to keep LLM input bounded
    except Exception as e:
        logger.warning("[price-compare] jina search failed: %s", e)
        return ""


async def _call_claude(listing: dict, search_text: str) -> dict:
    """Send the search content to Claude and parse the structured JSON."""
    if not EMERGENT_LLM_KEY:
        raise HTTPException(503, "AI is not configured on this deployment.")

    from emergentintegrations.llm.chat import LlmChat, UserMessage

    listed_price = float(listing.get("price") or 0)
    listing_summary = (
        f"MAKER'S LISTING:\n"
        f"Title: {listing.get('title','')}\n"
        f"Category: {listing.get('category','')}\n"
        f"Technique: {listing.get('technique','')}\n"
        f"Materials: {', '.join(listing.get('materials', []) or [])}\n"
        f"Listed price: ${listed_price:.2f}\n"
        f"Dimensions: {listing.get('length_in','?')} × {listing.get('width_in','?')} × {listing.get('height_in','?')} in\n"
    )

    user_msg = (
        f"{listing_summary}\n"
        f"WEB SEARCH RESULTS (raw, from Jina Reader):\n"
        f"{search_text or '(no results — use your knowledge of similar handmade marketplaces)'}\n\n"
        f"{RESPONSE_SCHEMA_NOTE}"
    )

    sys_msg = (
        "You are a pricing analyst for a handmade marketplace. Given a maker's listing and "
        "raw web search content about comparable items, you produce a JSON object summarizing "
        "the market range and a recommendation. Be honest — if the maker is overpriced, say so. "
        "If comparables look low quality or irrelevant, prefer to return fewer comparables than "
        "to pad. Only consider truly comparable items (same category + similar size + handmade)."
    )

    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"price-compare-{listing.get('slug','')}",
        system_message=sys_msg,
    ).with_model("anthropic", "claude-sonnet-4-5-20250929")

    try:
        reply = await chat.send_message(UserMessage(text=user_msg))
    except Exception as e:
        logger.exception("[price-compare] claude call failed: %s", e)
        raise HTTPException(502, "AI is temporarily unavailable. Try again in a moment.")

    # Pull the first JSON object out of the response. Claude usually
    # returns clean JSON when asked but sometimes wraps in ```json fences.
    text = (reply or "").strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.MULTILINE).strip()
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        # Last-ditch: find the first { ... } block.
        m = re.search(r"\{[\s\S]*\}", text)
        if not m:
            logger.warning("[price-compare] claude returned non-JSON: %r", text[:400])
            raise HTTPException(502, "AI returned an unparseable response. Try again.")
        try:
            data = json.loads(m.group(0))
        except json.JSONDecodeError:
            raise HTTPException(502, "AI returned an unparseable response. Try again.")

    # Sanity-bound the numbers — Claude has been known to hallucinate
    # absurd ranges. Coerce non-numeric values to 0.0 so the UI doesn't
    # blow up.
    def _f(x) -> float:
        try:
            return max(0.0, float(x))
        except (TypeError, ValueError):
            return 0.0

    low = _f(data.get("price_low"))
    median = _f(data.get("price_median"))
    high = _f(data.get("price_high"))
    if high < low:
        low, high = high, low
    if median < low or median > high:
        median = round((low + high) / 2, 2)

    comparables = []
    for c in (data.get("comparables") or [])[:5]:
        if not isinstance(c, dict):
            continue
        comparables.append({
            "title": (c.get("title") or "")[:160],
            "source": (c.get("source") or "Other")[:32],
            "price": _f(c.get("price")),
            "url": (c.get("url") or "")[:500],
        })

    return {
        "price_low": round(low, 2),
        "price_median": round(median, 2),
        "price_high": round(high, 2),
        "currency": "USD",
        "comparables": comparables,
        "recommendation": (data.get("recommendation") or "").strip()[:600],
    }


async def _count_today(maker_slug: str, listing_slug: str) -> int:
    start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    n = await db.price_comparisons.count_documents({
        "maker_slug": maker_slug,
        "listing_slug": listing_slug,
        "created_at": {"$gte": start},
        "from_cache": {"$ne": True},
    })
    return int(n)


async def _latest_cached(maker_slug: str, listing_slug: str) -> Optional[dict]:
    """Return the most recent comparison run within CACHE_TTL_HOURS, if any."""
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=CACHE_TTL_HOURS)).isoformat()
    return await db.price_comparisons.find_one(
        {"maker_slug": maker_slug, "listing_slug": listing_slug, "created_at": {"$gte": cutoff}},
        {"_id": 0},
        sort=[("created_at", -1)],
    )


# ───────────────────── endpoint ─────────────────────
class PriceCompareReq(BaseModel):
    force_refresh: bool = Field(False, description="Skip the 24h cache (still counts toward daily limit).")


@router.post("/maker/listings/{slug}/price-compare")
async def price_compare(slug: str, body: PriceCompareReq | None = None, maker_slug: str = Depends(current_maker_slug)):
    listing = await _get_listing(slug, maker_slug)
    force = bool(body and body.force_refresh)

    # Cache hit — return immediately unless explicit refresh.
    if not force:
        cached = await _latest_cached(maker_slug, slug)
        if cached:
            return {
                **{k: cached.get(k) for k in
                   ("price_low", "price_median", "price_high", "currency",
                    "comparables", "recommendation", "generated_at")},
                "from_cache": True,
                "remaining_today": max(0, PRICE_COMPARE_DAILY_LIMIT - await _count_today(maker_slug, slug)),
            }

    # Enforce daily limit on actual generation.
    used = await _count_today(maker_slug, slug)
    if used >= PRICE_COMPARE_DAILY_LIMIT:
        raise HTTPException(429, f"Daily limit reached ({PRICE_COMPARE_DAILY_LIMIT} fresh comparisons per listing). Try again tomorrow.")

    query = _build_search_query(listing)
    search_text = await _jina_reader_search(query)
    result = await _call_claude(listing, search_text)

    doc = {
        **result,
        "maker_slug": maker_slug,
        "listing_slug": slug,
        "listed_price": float(listing.get("price") or 0),
        "search_query": query,
        "had_search_results": bool(search_text),
        "generated_at": now_iso(),
        "created_at": now_iso(),
        "from_cache": False,
    }
    await db.price_comparisons.insert_one(dict(doc))

    return {
        **{k: doc[k] for k in
           ("price_low", "price_median", "price_high", "currency",
            "comparables", "recommendation", "generated_at")},
        "from_cache": False,
        "had_search_results": doc["had_search_results"],
        "remaining_today": max(0, PRICE_COMPARE_DAILY_LIMIT - (used + 1)),
    }
