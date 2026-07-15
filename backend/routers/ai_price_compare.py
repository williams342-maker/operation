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
from config import env_get
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

EMERGENT_LLM_KEY = env_get("EMERGENT_LLM_KEY", "")
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


# ───────────────────── batch endpoint (iter334j) ─────────────────────
BATCH_MAX_LISTINGS = 10  # per-call cap so a 50-listing shop doesn't burn $20 in tokens in one click


async def _run_one_for_batch(listing: dict, maker_slug: str) -> dict:
    """Run a single price-comparison cycle inside the batch worker.

    Mirrors the logic in the single endpoint but returns a status dict
    instead of raising. Honors the 24h cache + 5/day limit just like
    the single endpoint, so the batch is safe to invoke daily.
    """
    slug = listing.get("slug") or ""
    # Cache hit — skip the AI call entirely.
    cached = await _latest_cached(maker_slug, slug)
    if cached:
        return {"slug": slug, "status": "cached", "delta_pct": _delta_pct_from(cached)}

    # Daily-limit check (same window as single endpoint).
    used = await _count_today(maker_slug, slug)
    if used >= PRICE_COMPARE_DAILY_LIMIT:
        return {"slug": slug, "status": "rate_limited"}

    try:
        query = _build_search_query(listing)
        search_text = await _jina_reader_search(query)
        result = await _call_claude(listing, search_text)
    except HTTPException as e:
        return {"slug": slug, "status": "error", "error": str(e.detail)}
    except Exception as e:
        logger.exception("[price-compare-batch] unexpected error slug=%s: %s", slug, e)
        return {"slug": slug, "status": "error", "error": "unexpected"}

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
        "slug": slug, "status": "generated",
        "delta_pct": _delta_pct_from(doc),
    }


def _delta_pct_from(comp: dict) -> float | None:
    median = float(comp.get("price_median") or 0)
    listed = float(comp.get("listed_price") or 0)
    if median <= 0 or listed <= 0:
        return None
    return round(((listed - median) / median) * 100.0, 2)


async def _batch_worker(maker_slug: str, job_id: str) -> None:
    """Background task — sweeps the maker's published listings, runs a
    price-compare per listing (cache-aware), writes per-listing status
    into `price_compare_jobs.results[]` as it goes. The frontend can
    poll `/maker/price-compare/jobs/{job_id}` to render progress.

    Sequential, not parallel — keeps token spend predictable and
    respects the underlying Jina + Claude rate limits.
    """
    listings = await db.products.find(
        {"maker_slug": maker_slug, "status": "published",
         "deleted_at": {"$in": [None, False]}},
        {"_id": 0, "slug": 1, "title": 1, "category": 1, "technique": 1,
         "materials": 1, "price": 1, "length_in": 1, "width_in": 1, "height_in": 1},
    ).to_list(BATCH_MAX_LISTINGS)

    await db.price_compare_jobs.update_one(
        {"_id": job_id},
        {"$set": {"total": len(listings), "started_at": now_iso(), "status": "running"}},
    )

    for li in listings:
        res = await _run_one_for_batch(li, maker_slug)
        await db.price_compare_jobs.update_one(
            {"_id": job_id},
            {"$push": {"results": res}, "$inc": {"completed": 1}},
        )

    await db.price_compare_jobs.update_one(
        {"_id": job_id},
        {"$set": {"finished_at": now_iso(), "status": "done"}},
    )


class BatchReq(BaseModel):
    pass  # No params today — batch is "all my published listings, cache-aware."


@router.post("/maker/price-compare/batch")
async def price_compare_batch(
    body: BatchReq | None = None,
    maker_slug: str = Depends(current_maker_slug),
):
    """Kick off a background batch sweep over the maker's published
    listings. Returns a job id the frontend can poll. Skips listings
    with a fresh (≤24h) cache so re-running tomorrow is cheap.

    Why a background task instead of a sync loop? Each AI call takes
    5-15s; even a 10-listing batch could take 2+ minutes. The HTTP
    request would time out on most ingress configs. Background +
    polling is the standard pattern.
    """
    # Prevent two concurrent batches per maker (no point — they'd just
    # double-bill on tokens and hit the daily limit).
    existing = await db.price_compare_jobs.find_one(
        {"maker_slug": maker_slug, "status": "running"},
        {"_id": 1, "started_at": 1, "total": 1, "completed": 1},
    )
    if existing:
        return {
            "job_id": existing["_id"],
            "status": "already_running",
            "started_at": existing.get("started_at"),
            "total": existing.get("total", 0),
            "completed": existing.get("completed", 0),
        }

    import uuid as _uuid
    job_id = f"batch-{maker_slug}-{_uuid.uuid4().hex[:10]}"
    await db.price_compare_jobs.insert_one({
        "_id": job_id,
        "maker_slug": maker_slug,
        "status": "queued",
        "total": 0,
        "completed": 0,
        "results": [],
        "created_at": now_iso(),
    })

    # Fire-and-forget. asyncio.create_task is fine here — the FastAPI
    # event loop survives until shutdown so the background coroutine
    # finishes naturally.
    import asyncio
    asyncio.create_task(_batch_worker(maker_slug, job_id))

    return {"job_id": job_id, "status": "queued", "total": 0, "completed": 0}


@router.get("/maker/price-compare/jobs/{job_id}")
async def price_compare_job_status(
    job_id: str, maker_slug: str = Depends(current_maker_slug),
):
    """Poll endpoint for batch progress. Returns `null` if the job ID
    doesn't exist or belongs to a different maker (security: never
    leak other makers' jobs)."""
    job = await db.price_compare_jobs.find_one({"_id": job_id}, {"_id": 0})
    if not job:
        raise HTTPException(404, "Job not found.")
    if job.get("maker_slug") != maker_slug:
        raise HTTPException(404, "Job not found.")
    # Compress the `results` array — only return tail summaries so
    # polling doesn't bloat over long batches.
    return {
        "job_id": job_id,
        "status": job.get("status"),
        "total": job.get("total", 0),
        "completed": job.get("completed", 0),
        "results": (job.get("results") or [])[-30:],  # last 30 listings
        "started_at": job.get("started_at"),
        "finished_at": job.get("finished_at"),
    }

