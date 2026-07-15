"""iter335.13 — AI Budget Recommender (Promote Engine · Phase 2).

Given a maker's catalog + historical metrics, recommends a monthly
budget plus expected reach/clicks/orders for the chosen goal.

Math is fully deterministic — the LLM is used ONLY to write the
rationale paragraph the maker sees in the wizard. This means:
  • Predictions are stable + auditable.
  • LLM outage / cost spikes never break the feature (rationale just
    falls back to a hand-written sentence).
  • Tests assert exact numbers, no model drift.

Heuristic, in plain English
---------------------------
1. Pull every published listing for the maker. Score each (re-uses
   the same composite scorer the allocator uses — keeps the wizard's
   preview consistent with what the maker will actually see at boost
   time).
2. Compute per-listing baseline rates:
       CTR  = clicks / views  (fallback: marketplace 5%)
       CVR  = sold   / clicks (fallback: marketplace 2%)
3. Each $5 boost = 7 days of `promoted_until`. Promoted listings get
   ~3.5× the impressions of unpromoted ones (observed marketplace
   lift on the featured rails — see `catalog.py::featured_query`).
4. Saturation: budget recommendations are clamped to
       $5 × min(listings, ceil) where ceil depends on goal.
   This stops us from suggesting $250/mo to a maker with 3 listings.
5. The 3 KPI predictions (reach / clicks / orders) are derived from
   the recommended budget × per-listing rates × saturation.

Returned dict mirrors the wizard contract:
    {
      recommended_cents, low_cents, high_cents,
      expected_reach, expected_clicks, expected_orders,
      basis: "your-data" | "marketplace-default",
      rationale: <human paragraph, may be LLM-generated>,
      breakdown: [{slug, title, weight, expected_clicks, expected_orders}, ...]
    }
"""
from __future__ import annotations
from config import env_get

import logging
import math
import os
import uuid
from datetime import datetime, timezone
from typing import Optional

from core import db

log = logging.getLogger("crafters.promote.recommend")

# Marketplace fallback rates — calibrated against current activity.
# Used when a maker has zero history (brand-new shop).
MARKETPLACE_CTR = 0.05      # 5% click-through on a homepage rail impression
MARKETPLACE_CVR = 0.02      # 2% checkout completion on a click
BOOST_IMPRESSIONS_PER_WEEK = 800   # rough volume one boost-week buys
PROMOTION_WEEKLY_FEE_CENTS = 500

# Saturation ceilings (in listing-count multiples of the $5 boost).
GOAL_CEILING = {
    "sales":   6,   # cap at 6 listings — top performers carry the ROI
    "traffic": 10,  # spread wider to grow volume
    "reach":   4,   # focus newer SKUs — fewer but heavier boosts
}

# Hard floor & cap on the recommendation (in cents).
REC_FLOOR_CENTS = 2500    # $25 — below this, Stripe fees > 5% of credit
REC_CEILING_CENTS = 50000 # $500 — anything above belongs to enterprise


async def _gather_listings(maker_slug: str) -> list[dict]:
    cursor = db.products.find(
        {"maker_slug": maker_slug, "deleted_at": None,
         "status": {"$ne": "draft"}},
        {"_id": 0, "slug": 1, "title": 1, "price": 1, "in_stock": 1,
         "metrics": 1, "created_at": 1},
    )
    out = []
    async for p in cursor:
        out.append(p)
    return out


def _maker_rates(listings: list[dict]) -> tuple[float, float, bool]:
    """Returns (ctr, cvr, has_history).

    Aggregates across the maker's catalog rather than per-listing so a
    single hot listing doesn't blow up the average — same logic the
    allocator uses for scoring.
    """
    total_views = sum(int((p.get("metrics") or {}).get("views") or 0) for p in listings)
    total_clicks = sum(int((p.get("metrics") or {}).get("clicks") or 0) for p in listings)
    total_sold = sum(int((p.get("metrics") or {}).get("sold") or 0) for p in listings)
    if total_views >= 50 and total_clicks >= 5:
        ctr = total_clicks / total_views
        cvr = (total_sold / total_clicks) if total_clicks > 0 else MARKETPLACE_CVR
        return min(ctr, 0.30), min(cvr, 0.20), True
    return MARKETPLACE_CTR, MARKETPLACE_CVR, False


def _recommended_budget_cents(n_listings: int, goal: str) -> int:
    """Apply the saturation ceiling. Returns an integer cents value."""
    if n_listings == 0:
        return REC_FLOOR_CENTS  # bootstrap for brand-new shops
    ceiling = GOAL_CEILING.get(goal, GOAL_CEILING["sales"])
    target_boost_units = min(n_listings, ceiling) * 4  # ~4 weeks/month per listing
    rec = target_boost_units * PROMOTION_WEEKLY_FEE_CENTS
    return max(REC_FLOOR_CENTS, min(REC_CEILING_CENTS, rec))


def _expected_metrics(budget_cents: int, ctr: float, cvr: float,
                      avg_price: float) -> tuple[int, int, int]:
    """How many impressions, clicks, and orders does `budget_cents/mo`
    deliver at the given rates? Returns ints (rounded)."""
    boost_units = budget_cents / PROMOTION_WEEKLY_FEE_CENTS  # weeks/month
    impressions = int(round(boost_units * BOOST_IMPRESSIONS_PER_WEEK))
    clicks = int(round(impressions * ctr))
    orders = int(round(clicks * cvr))
    return impressions, clicks, orders


async def _claude_rationale(goal: str, budget_cents: int, listings: int,
                            ctr: float, cvr: float, has_history: bool,
                            expected_orders: int, expected_clicks: int,
                            avg_price: float) -> Optional[str]:
    """Optional — write 2-3 sentence rationale via Claude Haiku.
    Falls back to a hand-written version when LLM is unavailable.
    """
    EMERGENT_LLM_KEY = env_get("EMERGENT_LLM_KEY", "")
    if not EMERGENT_LLM_KEY:
        return None
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"promote-rec-{uuid.uuid4().hex[:10]}",
            system_message=(
                "You write short, confident marketing budget rationales "
                "for handmade-goods makers. 2 sentences max. No emojis. "
                "Be specific and reference the numbers given."
            ),
        ).with_model("anthropic", "claude-haiku-4-5")
        prompt = (
            f"Maker goal: {goal}. Catalog size: {listings} listings. "
            f"Historical CTR: {ctr*100:.1f}% · CVR: {cvr*100:.1f}% "
            f"({'real data' if has_history else 'marketplace default'}). "
            f"Recommended budget: ${budget_cents/100:.0f}/mo. "
            f"Expected: {expected_clicks} clicks, {expected_orders} orders, avg price ${avg_price:.0f}. "
            "Write a 2-sentence rationale a maker would trust."
        )
        reply = await chat.send_message(UserMessage(text=prompt))
        text = (reply or "").strip()
        # Strip surrounding quotes if the model returned a quoted line.
        if text.startswith(('"', "'")) and text.endswith(('"', "'")):
            text = text[1:-1].strip()
        return text or None
    except Exception as e:
        log.info("[recommend] Claude rationale failed (%s) — using fallback", e)
        return None


def _fallback_rationale(goal: str, budget_cents: int, n_listings: int,
                        expected_orders: int, has_history: bool) -> str:
    goal_phrases = {
        "sales":   "weighted toward your top-converting listings",
        "traffic": "spread across your catalog to grow clicks",
        "reach":   "focused on newer SKUs that need bootstrap visibility",
    }
    phrase = goal_phrases.get(goal, goal_phrases["sales"])
    if not has_history or n_listings == 0:
        return (
            f"With limited history, we're starting at ${budget_cents/100:.0f}/mo — "
            f"{phrase}. Check back after 2-3 weeks to recalibrate."
        )
    return (
        f"${budget_cents/100:.0f}/mo lands in the saturation sweet-spot for "
        f"{n_listings} listings, {phrase}. Projected ≈ {expected_orders} extra "
        "order(s) per month from boosted placement."
    )


async def recommend(maker_slug: str, goal: str = "sales") -> dict:
    listings = await _gather_listings(maker_slug)
    n = len(listings)
    ctr, cvr, has_history = _maker_rates(listings)
    prices = [float(p.get("price") or 0) for p in listings if (p.get("price") or 0) > 0]
    avg_price = (sum(prices) / len(prices)) if prices else 35.0

    rec_cents = _recommended_budget_cents(n, goal)
    low_cents = max(REC_FLOOR_CENTS, int(rec_cents * 0.5))
    high_cents = min(REC_CEILING_CENTS, int(rec_cents * 1.8))

    reach, clicks, orders = _expected_metrics(rec_cents, ctr, cvr, avg_price)

    rationale = await _claude_rationale(
        goal, rec_cents, n, ctr, cvr, has_history,
        orders, clicks, avg_price,
    )
    if not rationale:
        rationale = _fallback_rationale(goal, rec_cents, n, orders, has_history)

    # Per-listing top-4 breakdown (re-uses allocator weight math so the
    # wizard preview lines up).
    breakdown: list[dict] = []
    if listings:
        from services.promote_allocator import compute_allocations
        allocs = await compute_allocations(maker_slug, rec_cents)
        for a in allocs[:4]:
            listing_clicks = int(round(reach * (a.get("weight") or 0) * ctr))
            listing_orders = int(round(listing_clicks * cvr))
            breakdown.append({
                "slug": a["slug"], "title": a.get("title"),
                "weight": a.get("weight"),
                "expected_clicks": listing_clicks,
                "expected_orders": listing_orders,
            })

    return {
        "recommended_cents": int(rec_cents),
        "low_cents": int(low_cents),
        "high_cents": int(high_cents),
        "expected_reach": int(reach),
        "expected_clicks": int(clicks),
        "expected_orders": int(orders),
        "ctr": round(ctr, 4),
        "cvr": round(cvr, 4),
        "avg_price": round(avg_price, 2),
        "listing_count": n,
        "basis": "your-data" if has_history else "marketplace-default",
        "rationale": rationale,
        "breakdown": breakdown,
        "goal": goal,
        "computed_at": datetime.now(timezone.utc).isoformat(),
    }
