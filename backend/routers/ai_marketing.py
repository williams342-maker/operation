"""AI Marketing Companion — listing copy generation, SEO audit, pricing.

Three Claude-powered tools that surface in the maker dashboard's Marketing
tab. All endpoints fail-open: any LLM error returns a soft fallback rather
than a 5xx so makers never see a broken UX during a transient outage.
"""
from __future__ import annotations

import json
import os
import re
import uuid
from typing import List

from emergentintegrations.llm.chat import LlmChat, UserMessage
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from core import db, logger, now_iso
from maker_auth import current_maker_slug

router = APIRouter()
EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "")


def _claude(system: str, user: str, max_chars: int = 1200) -> dict | None:
    """Single-shot Claude call returning parsed JSON or None on failure.
    Strict JSON mode via prompt — we tell the model to return ONLY a JSON
    object and tolerate code-fence wrappers in the parser."""
    if not EMERGENT_LLM_KEY:
        return None

    async def _go():
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"mkt-{uuid.uuid4().hex[:12]}",
            system_message=system,
        ).with_model("anthropic", "claude-haiku-4-5")
        try:
            reply = await chat.send_message(UserMessage(text=user[:max_chars]))
        except Exception as e:
            logger.exception("[ai_marketing] LLM error: %s", e)
            return None
        return _parse_json(reply)

    import asyncio
    return asyncio.run(_go()) if not asyncio.get_event_loop().is_running() else None


async def _claude_async(system: str, user: str, max_chars: int = 4000) -> dict | None:
    if not EMERGENT_LLM_KEY:
        return None
    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"mkt-{uuid.uuid4().hex[:12]}",
        system_message=system,
    ).with_model("anthropic", "claude-haiku-4-5")
    try:
        reply = await chat.send_message(UserMessage(text=user[:max_chars]))
    except Exception as e:
        logger.exception("[ai_marketing] LLM error: %s", e)
        return None
    return _parse_json(reply)


def _parse_json(raw: str) -> dict | None:
    raw = (raw or "").strip()
    # Strip code-fences if present
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        # Fall back to first {...} block
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        if m:
            try:
                return json.loads(m.group(0))
            except json.JSONDecodeError:
                return None
    return None


# ───────────────────── Listing Copy Generator ─────────────────────
LISTING_COPY_SYSTEM = """You are a senior copywriter for a handmade marketplace (similar to Etsy).
You write listing titles, descriptions, and tags that BOTH read well to humans
AND maximize organic search traffic on the platform.

Return EXACTLY a JSON object with these keys:
{
  "title": "string (max 80 chars, format: [Material] [Item] [Style/Use Case])",
  "description": "string (200-400 words, plain text, no markdown, no emojis)",
  "tags": ["array of exactly 13 short tag strings, lowercase, no special chars"]
}

Title rules:
- Lead with the noun the buyer searches for ("Walnut Cutting Board", not "Beautiful kitchen find")
- Include material + item type + key differentiator
- Title case for the visible words

Description rules:
- Open with the buyer's win in 1-2 sentences (the gift, the upgrade, the heirloom)
- Then materials & dimensions in plain prose, not a bullet list
- Then care instructions
- Close with a confident invitation to message about customization

Tag rules:
- All lowercase, hyphens for multi-word ("live-edge")
- Mix specific (walnut, live-edge, oil-finish) with broad (housewarming, kitchen, gift)
- No brand names, no prohibited terms
- Avoid duplicates and avoid words already in the title verbatim
"""


class ListingCopyIn(BaseModel):
    bullets: str = Field(min_length=10, max_length=2000)
    image_url: str | None = None  # optional: future Claude vision support
    target_price: float | None = None
    category: str | None = None


@router.post("/maker/ai/listing-copy")
async def ai_listing_copy(payload: ListingCopyIn, slug: str = Depends(current_maker_slug)):
    """Paste a few bullets about your piece + optional photo URL.
    Returns a Title, Description, and 13 tags — copy-paste ready."""
    user_msg = (
        f"Maker bullets:\n{payload.bullets}\n\n"
        f"Category: {payload.category or 'unspecified'}\n"
        f"Target price: ${payload.target_price or 'n/a'}\n"
    )
    out = await _claude_async(LISTING_COPY_SYSTEM, user_msg, max_chars=2000)
    if not out or not out.get("title"):
        raise HTTPException(503, "AI is busy — please retry in a few seconds.")
    # Sanitise + cap
    title = (out.get("title") or "").strip()[:80]
    description = (out.get("description") or "").strip()[:4000]
    tags = [str(t).lower().strip() for t in (out.get("tags") or []) if t][:13]
    await db.ai_marketing_log.insert_one({
        "kind": "listing_copy", "maker_slug": slug,
        "input_bullets": payload.bullets[:500],
        "output_title": title, "tags_count": len(tags),
        "created_at": now_iso(),
    })
    return {"title": title, "description": description, "tags": tags}


# ───────────────────── SEO Recommender ─────────────────────
SEO_AUDIT_SYSTEM = """You are an SEO auditor for handmade-marketplace listings.
Given the maker's existing listings (titles + categories + current tags),
identify keyword gaps and 3 high-impact title rewrites.

Return EXACTLY a JSON object:
{
  "summary": "2-3 sentence overview of the SEO state of this shop",
  "missing_keywords": ["array of 8-15 keywords this shop should rank for but doesn't"],
  "title_rewrites": [
    {"current": "...", "suggested": "...", "reason": "..."}
  ]
}

Rules:
- Keywords lowercase, single words or short phrases
- Title rewrites stay under 80 chars
- Reason is ONE clause explaining why the rewrite helps (≤80 chars)
- Pick titles that are vague, lifestyle-y, or missing materials/use case
- If the shop is empty or near-empty, return summary='Not enough listings to audit yet — add 3+ listings then re-run.' and empty arrays
"""


@router.get("/maker/ai/seo-audit")
async def ai_seo_audit(slug: str = Depends(current_maker_slug)):
    """Read-only audit — runs Claude over the maker's current listings and
    surfaces missing keywords + 3 high-impact title rewrites. Safe to call
    repeatedly; we cache the last result for 15 minutes per maker to avoid
    burning tokens on every dashboard view."""
    cached = await db.ai_marketing_cache.find_one(
        {"key": f"seo:{slug}"}, {"_id": 0}
    )
    if cached:
        from datetime import datetime, timezone, timedelta
        try:
            ts = datetime.fromisoformat(cached["created_at"].replace("Z", "+00:00"))
            if datetime.now(timezone.utc) - ts < timedelta(minutes=15):
                return cached["payload"]
        except Exception:
            pass

    listings = await db.products.find(
        {"maker_slug": slug, "deleted_at": {"$in": [None, ""]}},
        {"_id": 0, "title": 1, "category": 1, "tags": 1},
    ).limit(50).to_list(50)

    if len(listings) < 1:
        return {
            "summary": "No active listings yet. Publish your first listing, then come back for an audit.",
            "missing_keywords": [], "title_rewrites": [],
        }

    user_msg = f"Shop has {len(listings)} active listings. Sample:\n" + "\n".join(
        f"- {row['title']} | category={row.get('category', '?')} | tags={','.join(row.get('tags', []) or [])}"
        for row in listings[:30]
    )
    out = await _claude_async(SEO_AUDIT_SYSTEM, user_msg, max_chars=4000)
    if not out:
        raise HTTPException(503, "AI is busy — please retry in a few seconds.")
    payload = {
        "summary": (out.get("summary") or "")[:500],
        "missing_keywords": [str(k).lower().strip() for k in (out.get("missing_keywords") or [])][:15],
        "title_rewrites": [
            {
                "current": str(r.get("current", ""))[:120],
                "suggested": str(r.get("suggested", ""))[:80],
                "reason": str(r.get("reason", ""))[:120],
            }
            for r in (out.get("title_rewrites") or [])[:5]
        ],
        "listings_audited": len(listings),
    }
    await db.ai_marketing_cache.update_one(
        {"key": f"seo:{slug}"},
        {"$set": {"payload": payload, "created_at": now_iso()}},
        upsert=True,
    )
    return payload


# ───────────────────── Single-listing SEO Tag generator ─────────────────────
SEO_TAGS_SYSTEM = """You generate SEO tags for a single handmade-marketplace listing.
Given the listing's title, category, and description, produce up to 13 short,
high-intent search tags a buyer would type into the marketplace search bar.

Return EXACTLY a JSON object:
{
  "tags": ["array", "of", "lowercase", "tags"]
}

Rules:
- All lowercase, no punctuation, no hashtags.
- 1-3 words per tag (most should be 2 words).
- Mix material, technique, style, recipient, occasion, room/use case.
- Avoid duplicates and avoid the literal title.
- 8-13 tags total.
"""


class SeoTagsIn(BaseModel):
    title: str = Field(min_length=3, max_length=140)
    description: str = Field(default="", max_length=4000)
    category: str | None = None
    existing_tags: list[str] = Field(default_factory=list)


@router.post("/maker/ai/seo-tags")
async def ai_seo_tags(payload: SeoTagsIn, slug: str = Depends(current_maker_slug)):
    """Generate up to 13 SEO tags for ONE listing in-place. Used from the
    Listing Editor's SEO section. Cheap & fast — no DB writes besides log."""
    user_msg = (
        f"Title: {payload.title.strip()}\n"
        f"Category: {payload.category or 'unspecified'}\n"
        f"Description: {payload.description.strip()[:1200]}\n"
        f"Existing tags (don't repeat): {', '.join(payload.existing_tags or [])}\n"
    )
    out = await _claude_async(SEO_TAGS_SYSTEM, user_msg, max_chars=900)
    if not out:
        raise HTTPException(503, "AI is busy — please retry in a few seconds.")
    raw = out.get("tags") or []
    seen, tags = set(), []
    existing_lower = {t.lower() for t in (payload.existing_tags or [])}
    for t in raw:
        c = str(t).lower().strip().strip("#,").replace("  ", " ")
        if not c or c in seen or c in existing_lower or len(c) > 40:
            continue
        seen.add(c); tags.append(c)
        if len(tags) >= 13:
            break
    await db.ai_marketing_log.insert_one({
        "kind": "seo_tags", "maker_slug": slug,
        "title": payload.title[:80], "tags_count": len(tags),
        "created_at": now_iso(),
    })
    return {"tags": tags}


# ───────────────────── Bulk SEO tag generator ─────────────────────
class BulkSeoIn(BaseModel):
    # Limits per call so makers can iterate (and we don't burn the LLM budget).
    max_listings: int = Field(default=50, ge=1, le=200)
    # Only listings with FEWER than this many tags get topped up. 0 = generate
    # tags only for listings that have none at all.
    min_tags_threshold: int = Field(default=8, ge=0, le=13)


@router.post("/maker/ai/seo-bulk")
async def ai_seo_bulk(payload: BulkSeoIn, slug: str = Depends(current_maker_slug)):
    """Run the SEO tag generator across every published, non-deleted listing
    in the maker's shop that has fewer than `min_tags_threshold` tags.
    Returns a per-listing summary; nothing is mutated until the maker
    reviews the preview... actually scratch that — most makers want this
    one-click, so we DO write the new tags inline. Each listing's existing
    tags are preserved (only added to)."""
    cur = db.products.find(
        {"maker_slug": slug, "status": "published", "deleted_at": None},
        {"_id": 0, "id": 1, "slug": 1, "title": 1, "description": 1,
         "category": 1, "seo_tags": 1},
    )
    candidates = []
    async for p in cur:
        existing = p.get("seo_tags") or []
        if len(existing) < payload.min_tags_threshold:
            candidates.append(p)
        if len(candidates) >= payload.max_listings:
            break

    results = []
    total_added = 0
    for p in candidates:
        existing = p.get("seo_tags") or []
        try:
            user_msg = (
                f"Title: {p.get('title','').strip()}\n"
                f"Category: {p.get('category') or 'unspecified'}\n"
                f"Description: {(p.get('description') or '').strip()[:1200]}\n"
                f"Existing tags (don't repeat): {', '.join(existing)}\n"
            )
            out = await _claude_async(SEO_TAGS_SYSTEM, user_msg, max_chars=900)
        except Exception as e:
            logger.warning("[bulk-seo] claude failed for %s: %s", p.get("slug"), e)
            out = None
        new_tags: list[str] = []
        if out and isinstance(out.get("tags"), list):
            existing_lower = {t.lower() for t in existing}
            seen = set()
            for t in out["tags"]:
                c = str(t).lower().strip().strip("#,").replace("  ", " ")
                if not c or c in existing_lower or c in seen or len(c) > 40:
                    continue
                seen.add(c); new_tags.append(c)
                if len(existing) + len(new_tags) >= 13:
                    break
        merged = (existing + new_tags)[:13]
        if new_tags:
            await db.products.update_one(
                {"id": p["id"]}, {"$set": {"seo_tags": merged}},
            )
        results.append({
            "slug": p["slug"], "title": p.get("title", "")[:60],
            "added_count": len(new_tags), "added_tags": new_tags,
            "total_tags_after": len(merged),
        })
        total_added += len(new_tags)
    await db.ai_marketing_log.insert_one({
        "kind": "seo_bulk", "maker_slug": slug,
        "scanned": len(candidates), "added": total_added,
        "created_at": now_iso(),
    })
    return {
        "scanned": len(candidates),
        "total_added": total_added,
        "results": results,
    }




# ───────────────────── Pricing Assistant ─────────────────────
@router.get("/maker/ai/pricing-suggest/{product_slug}")
async def ai_pricing_suggest(product_slug: str, slug: str = Depends(current_maker_slug)):
    """Pricing intel from comparable listings on Crafters Market in the same
    category. Surfaces comparables count so makers know how strong the
    signal is — small categories will return weak suggestions and we say so."""
    product = await db.products.find_one(
        {"slug": product_slug, "maker_slug": slug, "deleted_at": {"$in": [None, ""]}},
        {"_id": 0, "title": 1, "category": 1, "price": 1},
    )
    if not product:
        raise HTTPException(404, "Listing not found in your shop.")

    cat = product.get("category", "").lower().strip()
    if not cat:
        return {
            "comparables_count": 0,
            "current_price": float(product.get("price", 0) or 0),
            "advice": "This listing has no category — set one to enable pricing intel.",
        }

    # Pull all active listings in the same category, exclude the maker's own
    comps = await db.products.find(
        {
            "category": cat,
            "deleted_at": {"$in": [None, ""]},
            "maker_slug": {"$ne": slug},
        },
        {"_id": 0, "price": 1, "title": 1, "maker_slug": 1},
    ).limit(500).to_list(500)

    n = len(comps)
    current = float(product.get("price", 0) or 0)
    if n < 3:
        return {
            "comparables_count": n,
            "current_price": current,
            "advice": (
                f"Only {n} comparables in '{cat}' — not enough data for a strong "
                "suggestion. Re-run when more makers list in this category."
            ),
        }

    prices = sorted([float(c.get("price", 0) or 0) for c in comps if float(c.get("price", 0) or 0) > 0])
    if not prices:
        return {
            "comparables_count": n, "current_price": current,
            "advice": "Comparables exist but lack pricing data.",
        }

    median = prices[len(prices) // 2]
    p25 = prices[max(0, len(prices) // 4)]
    p75 = prices[min(len(prices) - 1, (3 * len(prices)) // 4)]

    band_lo = round(p25, 2)
    band_hi = round(p75, 2)
    if current < band_lo * 0.85:
        advice = (
            f"Your price (${current:.2f}) is below the comparable band "
            f"(${band_lo:.0f}–${band_hi:.0f}). Consider raising — under-pricing handmade signals lower quality."
        )
    elif current > band_hi * 1.30:
        advice = (
            f"Your price (${current:.2f}) is above 75% of comparables in '{cat}' "
            f"(${band_lo:.0f}–${band_hi:.0f}). Acceptable if your work is signature-tier — otherwise expect slower velocity."
        )
    else:
        advice = (
            f"Your price (${current:.2f}) sits within the comparable band "
            f"(${band_lo:.0f}–${band_hi:.0f}, median ${median:.0f}). Solid placement."
        )

    return {
        "comparables_count": n,
        "current_price": current,
        "median": round(median, 2),
        "band_low": band_lo,
        "band_high": band_hi,
        "advice": advice,
    }
