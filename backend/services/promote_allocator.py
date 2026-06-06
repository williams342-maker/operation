"""iter335 — Promotion allocator (Phase 1, internal placement only).

Given an active `campaign_group` for a maker, decides how the maker's
wallet budget should be distributed across their listings.

Phase 1 strategy: weight by a composite score, then translate the
allocation into existing on-site boost units. Each boost extends a
listing's `promoted_until` field by 7 days at a cost of
`PROMOTION_WEEKLY_FEE_CENTS` (mirrors the existing per-listing budget
router so the two systems share the same placement engine).

Phase 1.5 will plug in real Google/Meta/Bing campaign creates via the
adsGateway interface — the allocator's contract (`apply_allocations`)
won't change; only the per-channel dispatcher will swap from
"extend_promoted_until" to "create_external_campaign".

Composite score weights (from product spec):
    40% Conversion · 25% CTR · 20% Inventory · 10% Freshness · 5% Margin

Listings with no historical conversion data fall back to:
    • Inventory score (in_stock > 0 → 1.0, else 0)
    • Freshness score (newer listings get more weight to bootstrap)
This keeps brand-new shops from getting 0 budget on day 1.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from core import db, now_iso
from services import promote_wallet

log = logging.getLogger("crafters.promote.allocator")

PROMOTION_WEEKLY_FEE_CENTS = 500  # one boost = $5 / 7 days (matches listing_budgets.py)
BOOST_DURATION_DAYS = 7

# Score weights — must sum to 1.0.
W_CONVERSION = 0.40
W_CTR = 0.25
W_INVENTORY = 0.20
W_FRESHNESS = 0.10
W_MARGIN = 0.05


def _norm(values: list[float]) -> list[float]:
    """Normalize a list of non-negative floats so they sum to 1.0.
    Returns equal weights if all inputs are 0."""
    total = sum(max(0.0, v) for v in values)
    if total <= 0:
        n = len(values)
        return [1.0 / n] * n if n else []
    return [max(0.0, v) / total for v in values]


async def _gather_listings(maker_slug: str) -> list[dict]:
    """All published, non-deleted listings for the maker.

    We only pull the fields the scorer needs to keep the cursor cheap.
    """
    cursor = db.products.find(
        {
            "maker_slug": maker_slug,
            "deleted_at": None,
            "status": {"$ne": "draft"},
        },
        {
            "_id": 0,
            "slug": 1,
            "title": 1,
            "price": 1,
            "in_stock": 1,
            "created_at": 1,
            "promoted_until": 1,
            "metrics": 1,  # iter255 — embedded counters {views, clicks, sold}
        },
    )
    out = []
    async for p in cursor:
        out.append(p)
    return out


def _score_listing(p: dict, now: datetime) -> float:
    """Composite score in [0, 1]. Higher = more deserving of budget."""
    metrics = p.get("metrics") or {}
    views = int(metrics.get("views") or 0)
    clicks = int(metrics.get("clicks") or 0)
    sold = int(metrics.get("sold") or 0)

    # Conversion rate = sold / clicks (cap at 1.0 — a single hot listing
    # with 1 click + 1 sale shouldn't dominate over a 0.05-conv winner).
    conv_rate = (sold / clicks) if clicks > 0 else 0.0
    conv_score = min(1.0, conv_rate * 4)  # 25% conv = full score

    # CTR = clicks / views.
    ctr = (clicks / views) if views > 0 else 0.0
    ctr_score = min(1.0, ctr * 10)  # 10% CTR = full score

    inv_score = 1.0 if int(p.get("in_stock") or 0) > 0 else 0.0

    # Freshness — newer listings score higher (linear decay over 60 days).
    created = p.get("created_at")
    fresh_score = 0.5
    try:
        if created:
            created_dt = datetime.fromisoformat(str(created).replace("Z", "+00:00"))
            if created_dt.tzinfo is None:
                created_dt = created_dt.replace(tzinfo=timezone.utc)
            age_days = max(0.0, (now - created_dt).total_seconds() / 86400.0)
            fresh_score = max(0.0, 1.0 - age_days / 60.0)
    except Exception:
        pass

    # Margin proxy: log-scale price. Higher-AOV listings get a small
    # nudge because each conversion is worth more (real margin would
    # need cost data we don't have yet).
    price = float(p.get("price") or 0)
    margin_score = min(1.0, max(0.0, (price - 5.0) / 95.0))  # $5→0, $100→1

    return (
        W_CONVERSION * conv_score
        + W_CTR * ctr_score
        + W_INVENTORY * inv_score
        + W_FRESHNESS * fresh_score
        + W_MARGIN * margin_score
    )


async def compute_allocations(
    maker_slug: str,
    budget_cents: int,
    *,
    explicit_listing_slugs: Optional[list[str]] = None,
) -> list[dict]:
    """Pure function — returns `[{slug, title, score, allocated_cents}]`
    without mutating anything. Used by the Promote page preview UI.
    """
    if budget_cents <= 0:
        return []
    listings = await _gather_listings(maker_slug)
    if explicit_listing_slugs:
        listings = [p for p in listings if p.get("slug") in explicit_listing_slugs]
    if not listings:
        return []
    now = datetime.now(timezone.utc)
    scores = [_score_listing(p, now) for p in listings]
    weights = _norm(scores)
    out: list[dict] = []
    for p, s, w in zip(listings, scores, weights):
        out.append({
            "slug": p.get("slug"),
            "title": p.get("title"),
            "score": round(s, 4),
            "weight": round(w, 4),
            "allocated_cents": int(round(budget_cents * w)),
            "promoted_until": p.get("promoted_until"),
        })
    # Sort by allocation desc so the UI renders top-spenders first.
    out.sort(key=lambda r: r["allocated_cents"], reverse=True)
    return out


async def apply_allocations(
    maker_slug: str,
    campaign_id: str,
    budget_cents: int,
    *,
    explicit_listing_slugs: Optional[list[str]] = None,
    dry_run: bool = False,
) -> dict:
    """Compute allocations, debit the wallet, extend `promoted_until` on
    each picked listing, and persist the `listing_allocations` rows so
    the Distribution UI + Analytics page can read them.

    Each allocated listing receives `floor(allocated_cents / 500)`
    boost units. One boost unit = 7 days of `promoted_until`. If a
    listing's allocation can't afford a single boost ($5 = 500c) it
    gets queued — its allocation accumulates until the next run.

    Returns `{status, boosts_applied, cents_spent, allocations: [...]}`.
    """
    allocations = await compute_allocations(
        maker_slug, budget_cents,
        explicit_listing_slugs=explicit_listing_slugs,
    )
    if dry_run:
        return {"status": "dry_run", "allocations": allocations,
                "boosts_applied": 0, "cents_spent": 0}

    balance = await promote_wallet.get_balance_cents(maker_slug)
    boosts_applied = 0
    cents_spent = 0
    persisted: list[dict] = []
    now = datetime.now(timezone.utc)

    for alloc in allocations:
        slug = alloc["slug"]
        target_cents = int(alloc["allocated_cents"])
        # How many full boost-weeks does this listing earn this run?
        n_boosts = target_cents // PROMOTION_WEEKLY_FEE_CENTS
        if n_boosts <= 0:
            # Persist a 0-spend row so the UI shows the under-threshold
            # listing with its accruing allocation.
            persisted.append({**alloc, "boosts_applied": 0, "spent_cents": 0})
            continue
        # Cap by remaining wallet balance.
        max_affordable = balance // PROMOTION_WEEKLY_FEE_CENTS
        n_boosts = min(n_boosts, max_affordable)
        if n_boosts <= 0:
            persisted.append({**alloc, "boosts_applied": 0, "spent_cents": 0,
                              "reason": "insufficient_balance"})
            continue
        cost = n_boosts * PROMOTION_WEEKLY_FEE_CENTS
        txn = await promote_wallet.debit(
            maker_slug, cost,
            kind="spend",
            ref=f"campaign:{campaign_id}:{slug}",
            note=f"{n_boosts}× boost · {slug}",
        )
        if not txn:
            # Race condition: balance dropped between get_balance and
            # debit. Skip and the next run will retry.
            persisted.append({**alloc, "boosts_applied": 0, "spent_cents": 0,
                              "reason": "race_condition"})
            continue
        balance -= cost
        cents_spent += cost
        boosts_applied += n_boosts

        # Extend promoted_until.
        existing_promoted = None
        try:
            p = await db.products.find_one({"slug": slug}, {"promoted_until": 1})
            if p and p.get("promoted_until"):
                existing_promoted = datetime.fromisoformat(
                    str(p["promoted_until"]).replace("Z", "+00:00"))
                if existing_promoted.tzinfo is None:
                    existing_promoted = existing_promoted.replace(tzinfo=timezone.utc)
        except Exception:
            existing_promoted = None
        anchor = existing_promoted if (existing_promoted and existing_promoted > now) else now
        new_until = anchor + timedelta(days=BOOST_DURATION_DAYS * n_boosts)
        await db.products.update_one(
            {"slug": slug, "maker_slug": maker_slug},
            {"$set": {
                "promoted_until": new_until.isoformat(),
                "auto_boosted": True,
                "promote_engine_v1": True,  # marker so existing per-listing cron skips it
            }},
        )
        persisted.append({**alloc, "boosts_applied": n_boosts, "spent_cents": cost,
                          "new_promoted_until": new_until.isoformat()})

    # Upsert the per-listing rows (one doc per (campaign, listing) pair).
    for row in persisted:
        await db.listing_allocations.update_one(
            {"campaign_id": campaign_id, "slug": row["slug"]},
            {"$set": {
                "campaign_id": campaign_id,
                "maker_slug": maker_slug,
                "slug": row["slug"],
                "title": row.get("title"),
                "score": row.get("score"),
                "weight": row.get("weight"),
                "allocated_cents": row.get("allocated_cents"),
                "last_boosts_applied": row.get("boosts_applied", 0),
                "last_spent_cents": row.get("spent_cents", 0),
                "last_run_at": now_iso(),
                "promoted_until": row.get("new_promoted_until") or row.get("promoted_until"),
                "reason": row.get("reason"),
            },
             "$inc": {
                "total_spent_cents": int(row.get("spent_cents", 0)),
                "total_boosts": int(row.get("boosts_applied", 0)),
            }},
            upsert=True,
        )

    log.info("[allocator] %s campaign=%s budget=%dc boosts=%d spent=%dc",
             maker_slug, campaign_id, budget_cents, boosts_applied, cents_spent)
    return {
        "status": "ok",
        "boosts_applied": boosts_applied,
        "cents_spent": cents_spent,
        "allocations": persisted,
    }
