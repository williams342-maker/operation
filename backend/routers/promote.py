"""iter335 — Unified Promotion Engine endpoints.

Public API mounted under `/api/promote/*`.

Routes:
    GET  /promote/wallet                       — balance + recent txns
    POST /promote/wallet/topup                 — Stripe Checkout session
    POST /promote/wallet/subscribe             — Stripe subscription session
    GET  /promote/campaign                     — current plan + allocations
    POST /promote/campaign                     — upsert plan
    POST /promote/campaign/pause
    POST /promote/campaign/resume
    POST /promote/campaign/apply               — trigger allocator now
    POST /promote/campaign/preview             — dry-run allocator (no spend)
    GET  /promote/analytics                    — spend / clicks / orders / ROAS

All endpoints require a valid maker JWT. Wallet credits land via the
Stripe webhook in `routers/checkout.py` which now dispatches
`promote_topup` and `promote_subscription` metadata to the wallet
service.
"""
from __future__ import annotations

import logging
import os
import secrets
from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from core import STRIPE_API_KEY, db, now_iso, public_host
from maker_auth import current_maker_slug
from services import promote_wallet, promote_allocator, promote_recommend
from services.ads_gateway import (
    get_gateway, GatewayNotEligible, GatewayNotImplemented, GatewayError,
    CreateCampaignSpec,
)

router = APIRouter()
log = logging.getLogger("crafters.promote")

PROMOTE_TOPUP_MIN_CENTS = 1000   # $10 floor — keeps Stripe fees < 4% of credit
PROMOTE_TOPUP_MAX_CENTS = 100000 # $1000 cap — fraud guard
PROMOTE_GOALS = {"sales", "traffic", "reach"}


# ── Pydantic models ────────────────────────────────────────────────────
class TopupRequest(BaseModel):
    amount_cents: int = Field(..., ge=PROMOTE_TOPUP_MIN_CENTS,
                              le=PROMOTE_TOPUP_MAX_CENTS)


class SubscribeRequest(BaseModel):
    monthly_cents: int = Field(..., ge=PROMOTE_TOPUP_MIN_CENTS,
                               le=PROMOTE_TOPUP_MAX_CENTS)


class CampaignUpsert(BaseModel):
    budget_cents: int = Field(..., ge=0, le=PROMOTE_TOPUP_MAX_CENTS)
    goal: str = "sales"
    channels: list[str] = ["internal"]  # phase 1 = internal only
    auto_allocate: bool = True
    explicit_listing_slugs: Optional[list[str]] = None


# ── Wallet ─────────────────────────────────────────────────────────────
@router.get("/promote/wallet")
async def get_wallet(maker_slug: str = Depends(current_maker_slug)):
    """Wallet balance + last 25 ledger entries. Idempotent — creates the
    wallet doc on first read so the UI never has to handle a 404."""
    w = await promote_wallet.ensure_wallet(maker_slug)
    txns = await promote_wallet.recent_transactions(maker_slug, limit=25)
    return {
        "maker_slug": maker_slug,
        "balance_cents": int(w.get("balance_cents") or 0),
        "lifetime_funded_cents": int(w.get("lifetime_funded_cents") or 0),
        "lifetime_spent_cents": int(w.get("lifetime_spent_cents") or 0),
        "transactions": txns,
        "subscription": w.get("subscription"),  # {status, monthly_cents, next_renew_at}
    }


@router.post("/promote/wallet/topup")
async def topup(req: TopupRequest, request: Request,
                maker_slug: str = Depends(current_maker_slug)):
    """One-time wallet top-up via Stripe Checkout.

    Returns `{checkout_url, session_id}`. The webhook handler in
    `checkout.py` watches for `metadata.promote_kind == "topup"` and
    calls `promote_wallet.credit()` when the session is paid. We tag
    each session with an `idempotency_key` so re-fired webhooks don't
    double-credit.
    """
    import stripe as stripe_sdk
    stripe_sdk.api_key = STRIPE_API_KEY

    host = public_host(request)
    # Land back on the Promote tab with a flag the FE uses to refetch
    # the wallet balance + show a success toast.
    success_url = f"{host}/maker/dashboard?tab=promote&topup=success&session_id={{CHECKOUT_SESSION_ID}}"
    cancel_url = f"{host}/maker/dashboard?tab=promote&topup=cancelled"

    idem_key = secrets.token_urlsafe(20)
    dollars = req.amount_cents / 100.0
    try:
        sess = stripe_sdk.checkout.Session.create(
            mode="payment",
            payment_method_types=["card"],
            line_items=[{
                "price_data": {
                    "currency": "usd",
                    "unit_amount": int(req.amount_cents),
                    "product_data": {
                        "name": f"Crafters Market — Promote Wallet · ${dollars:.0f}",
                        "description": "Top-up credit applied to your promotion wallet. Used to boost listings on Crafters Market homepage + featured rails.",
                    },
                },
                "quantity": 1,
            }],
            success_url=success_url,
            cancel_url=cancel_url,
            metadata={
                "promote_kind": "topup",
                "maker_slug": maker_slug,
                "amount_cents": str(req.amount_cents),
                "idempotency_key": idem_key,
            },
        )
    except Exception as e:
        log.exception("[promote] topup checkout failed: %s", e)
        raise HTTPException(502, f"Stripe error: {e}")

    # Persist a pending row so the maker can see the in-flight top-up
    # in their ledger even before the webhook fires.
    await db.promote_pending_topups.insert_one({
        "_id": sess.id,
        "session_id": sess.id,
        "maker_slug": maker_slug,
        "amount_cents": int(req.amount_cents),
        "idempotency_key": idem_key,
        "status": "pending",
        "created_at": now_iso(),
    })
    return {"checkout_url": sess.url, "session_id": sess.id}


@router.post("/promote/wallet/subscribe")
async def subscribe(req: SubscribeRequest, request: Request,
                    maker_slug: str = Depends(current_maker_slug)):
    """Recurring monthly wallet refill via Stripe Subscription.

    Stripe creates a $X/month subscription; on every successful invoice,
    the webhook credits the wallet by the same amount. The maker can
    cancel from the Promote page (DELETE /promote/wallet/subscribe).
    """
    import stripe as stripe_sdk
    stripe_sdk.api_key = STRIPE_API_KEY

    host = public_host(request)
    success_url = f"{host}/maker/dashboard?tab=promote&subscribe=success"
    cancel_url = f"{host}/maker/dashboard?tab=promote&subscribe=cancelled"

    dollars = req.monthly_cents / 100.0
    try:
        # Inline price — created on the fly so we don't have to manage
        # a Price catalog in Stripe for every possible $/mo tier.
        sess = stripe_sdk.checkout.Session.create(
            mode="subscription",
            payment_method_types=["card"],
            line_items=[{
                "price_data": {
                    "currency": "usd",
                    "unit_amount": int(req.monthly_cents),
                    "recurring": {"interval": "month"},
                    "product_data": {
                        "name": f"Crafters Market — Promote Plan · ${dollars:.0f}/mo",
                    },
                },
                "quantity": 1,
            }],
            success_url=success_url,
            cancel_url=cancel_url,
            metadata={
                "promote_kind": "subscription",
                "maker_slug": maker_slug,
                "monthly_cents": str(req.monthly_cents),
            },
            subscription_data={
                "metadata": {
                    "promote_kind": "subscription",
                    "maker_slug": maker_slug,
                    "monthly_cents": str(req.monthly_cents),
                },
            },
        )
    except Exception as e:
        log.exception("[promote] subscribe checkout failed: %s", e)
        raise HTTPException(502, f"Stripe error: {e}")
    return {"checkout_url": sess.url, "session_id": sess.id}


@router.delete("/promote/wallet/subscribe")
async def cancel_subscription(maker_slug: str = Depends(current_maker_slug)):
    w = await promote_wallet.ensure_wallet(maker_slug)
    sub = (w or {}).get("subscription") or {}
    sub_id = sub.get("stripe_subscription_id")
    if not sub_id:
        raise HTTPException(404, "No active subscription")
    import stripe as stripe_sdk
    stripe_sdk.api_key = STRIPE_API_KEY
    try:
        stripe_sdk.Subscription.delete(sub_id)
    except Exception as e:
        log.exception("[promote] cancel sub failed: %s", e)
        raise HTTPException(502, f"Stripe error: {e}")
    await db.promotion_wallets.update_one(
        {"_id": maker_slug},
        {"$set": {"subscription.status": "cancelled",
                  "subscription.cancelled_at": now_iso(),
                  "updated_at": now_iso()}}
    )
    return {"status": "cancelled"}


# ── Campaign group ─────────────────────────────────────────────────────
@router.get("/promote/campaign")
async def get_campaign(maker_slug: str = Depends(current_maker_slug)):
    """Returns the maker's single active campaign group + its current
    listing_allocations. Phase 1 supports one plan per maker (Phase 2
    will allow multiple goal-specific campaigns)."""
    doc = await db.campaign_groups.find_one(
        {"maker_slug": maker_slug, "deleted_at": None}
    )
    if not doc:
        return {"campaign": None, "allocations": []}
    doc.pop("_id", None)
    allocations_cur = db.listing_allocations.find(
        {"campaign_id": doc["campaign_id"], "maker_slug": maker_slug}
    ).sort("allocated_cents", -1)
    allocations = []
    async for a in allocations_cur:
        a.pop("_id", None)
        allocations.append(a)
    return {"campaign": doc, "allocations": allocations}


@router.post("/promote/campaign")
async def upsert_campaign(body: CampaignUpsert,
                          maker_slug: str = Depends(current_maker_slug)):
    if body.goal not in PROMOTE_GOALS:
        raise HTTPException(400, f"goal must be one of {sorted(PROMOTE_GOALS)}")
    existing = await db.campaign_groups.find_one(
        {"maker_slug": maker_slug, "deleted_at": None}
    )
    if existing:
        campaign_id = existing["campaign_id"]
        await db.campaign_groups.update_one(
            {"campaign_id": campaign_id},
            {"$set": {
                "budget_cents": int(body.budget_cents),
                "goal": body.goal,
                "channels": body.channels,
                "auto_allocate": bool(body.auto_allocate),
                "explicit_listing_slugs": body.explicit_listing_slugs or [],
                "updated_at": now_iso(),
            }},
        )
    else:
        campaign_id = "camp_" + secrets.token_urlsafe(10)
        await db.campaign_groups.insert_one({
            "campaign_id": campaign_id,
            "maker_slug": maker_slug,
            "budget_cents": int(body.budget_cents),
            "goal": body.goal,
            "channels": body.channels,
            "auto_allocate": bool(body.auto_allocate),
            "explicit_listing_slugs": body.explicit_listing_slugs or [],
            "status": "active",
            "deleted_at": None,
            "created_at": now_iso(),
            "updated_at": now_iso(),
        })
    saved = await db.campaign_groups.find_one({"campaign_id": campaign_id})
    saved.pop("_id", None)
    return {"campaign": saved}


@router.post("/promote/campaign/pause")
async def pause_campaign(maker_slug: str = Depends(current_maker_slug)):
    r = await db.campaign_groups.update_one(
        {"maker_slug": maker_slug, "deleted_at": None},
        {"$set": {"status": "paused", "updated_at": now_iso()}},
    )
    if r.matched_count == 0:
        raise HTTPException(404, "No campaign found")
    return {"status": "paused"}


@router.post("/promote/campaign/resume")
async def resume_campaign(maker_slug: str = Depends(current_maker_slug)):
    r = await db.campaign_groups.update_one(
        {"maker_slug": maker_slug, "deleted_at": None},
        {"$set": {"status": "active", "updated_at": now_iso()}},
    )
    if r.matched_count == 0:
        raise HTTPException(404, "No campaign found")
    return {"status": "active"}


class RecommendBudgetRequest(BaseModel):
    goal: str = "sales"


@router.post("/promote/budget/recommend")
async def recommend_budget(body: RecommendBudgetRequest,
                           maker_slug: str = Depends(current_maker_slug)):
    """iter335.13 — AI Recommend Budget.
    Returns recommended monthly budget + projected reach/clicks/orders
    plus a human rationale paragraph. Used by the wizard Step 2 sparkle
    button and the main Promote tab's "✨ Recommend" CTA."""
    if body.goal not in PROMOTE_GOALS:
        raise HTTPException(400, f"goal must be one of {sorted(PROMOTE_GOALS)}")
    return await promote_recommend.recommend(maker_slug, body.goal)


@router.get("/promote/channel-split")
async def channel_split(maker_slug: str = Depends(current_maker_slug)):
    """iter335.16 — Maker-facing channel-split hint.

    Combines the persisted marketplace-wide attribution weights (Google
    / Meta / Microsoft, from `channel_weights` collection) with this
    maker's per-channel gateway eligibility, then re-normalizes weights
    over only the channels the maker can actually use.

    Returns:
        {
          channels: [{channel, weight, eligible, roas, orders_30d, note}],
          eligible_channels: int,
          cold_start: bool,
          basis: "marketplace" | "cold-start",
          computed_at: iso,
        }

    Used by the wizard Step 2 + PromoteTab as a non-committal nudge —
    the actual launch still happens per-listing via the existing
    `/promote/external/launch` flow, this just tells the maker "if
    you're going to split a $100 budget across paid channels, here's
    where marketplace data says the dollars should go."
    """
    from services import channel_attribution
    import asyncio
    weights = await channel_attribution.get_persisted()
    weights_by_ch = {c["channel"]: c for c in weights["channels"]}

    # iter335.17 — Run the 3 gateway eligibility checks in parallel so
    # the response time stays O(1) instead of O(N_channels) as we add
    # more ad platforms. Each is_eligible() may do a Mongo round-trip
    # to integration_credentials, so the speedup is real.
    channels = ("google", "meta", "microsoft")

    async def _eligibility(ch: str) -> tuple[bool, str | None]:
        try:
            gw = get_gateway(ch)
            ok, reason = await gw.is_eligible(maker_slug)
            return bool(ok), (None if ok else reason)
        except Exception as e:
            return False, f"adapter error: {str(e)[:80]}"

    elig_results = await asyncio.gather(*[_eligibility(ch) for ch in channels])

    eligible_set: list[dict] = []
    for ch, (ok, reason) in zip(channels, elig_results):
        w = weights_by_ch.get(ch) or {}
        eligible_set.append({
            "channel": ch,
            "eligible": ok,
            "eligibility_reason": reason,
            "raw_weight": w.get("weight", 0.0),
            "roas": w.get("roas", 0.0),
            "orders_30d": w.get("orders_30d", 0),
            "spend_cents_30d": w.get("spend_cents_30d", 0),
        })

    # Re-normalize weights across the eligible subset only.
    eligible_total = sum(c["raw_weight"] for c in eligible_set if c["eligible"])
    out: list[dict] = []
    for c in eligible_set:
        if c["eligible"]:
            if eligible_total > 0:
                norm = c["raw_weight"] / eligible_total
            else:
                # All eligible channels have zero weight → equal split.
                n_eligible = sum(1 for x in eligible_set if x["eligible"])
                norm = (1.0 / n_eligible) if n_eligible > 0 else 0.0
            note = None
            if c["roas"] >= 2:
                note = f"{c['roas']:.1f}× ROAS on marketplace — strong lift"
            elif c["roas"] >= 1:
                note = f"{c['roas']:.1f}× ROAS — solid"
            elif c["orders_30d"] > 0:
                note = f"{c['orders_30d']} orders in 30d — measurable"
        else:
            norm = 0.0
            note = c["eligibility_reason"] or "Connect this channel to unlock"
        out.append({
            "channel": c["channel"],
            "weight": round(norm, 4),
            "eligible": c["eligible"],
            "roas": c["roas"],
            "orders_30d": c["orders_30d"],
            "note": note,
        })

    return {
        "channels": out,
        "eligible_channels": sum(1 for c in out if c["eligible"]),
        "cold_start": bool(weights.get("cold_start")),
        "basis": "cold-start" if weights.get("cold_start") else "marketplace",
        "computed_at": weights.get("computed_at"),
    }


@router.get("/promote/themes/active")
async def active_themes_for_maker(maker_slug: str = Depends(current_maker_slug)):
    """iter335.13 — Maker-facing view of cross-maker theme campaigns
    currently subsidizing any of their published listings. Drives the
    "Active themes" pill section in the Promote tab so makers know
    when their boosts are being co-funded."""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    listings_cur = db.products.find(
        {"maker_slug": maker_slug, "deleted_at": None,
         "status": {"$ne": "draft"}},
        {"_id": 0, "slug": 1, "tags": 1, "categories": 1},
    )
    all_tags = set()
    listing_slugs: list[str] = []
    async for lst in listings_cur:
        listing_slugs.append(lst.get("slug"))
        all_tags |= set((lst.get("tags") or []) + (lst.get("categories") or []))

    themes_out: list[dict] = []
    async for t in db.theme_campaigns.find({
        "status": "active",
        "start_date": {"$lte": today},
        "end_date": {"$gte": today},
        "pool_remaining_cents": {"$gt": 0},
    }):
        cat = set(t.get("category_filter") or [])
        matches = (not cat) or bool(cat & all_tags)
        if not matches:
            continue
        # How much has this maker already claimed?
        per_maker_used = 0
        async for row in db.theme_contributions.find(
            {"theme_id": t["_id"], "maker_slug": maker_slug},
            {"amount_cents": 1},
        ):
            per_maker_used += int(row.get("amount_cents") or 0)
        cap = int(t.get("per_maker_cap_cents") or 0)
        t.pop("_id", None)
        themes_out.append({
            **t,
            "claimed_by_maker_cents": per_maker_used,
            "remaining_for_maker_cents": max(0, cap - per_maker_used),
        })
    return {"themes": themes_out, "listing_count": len(listing_slugs)}


@router.post("/promote/campaign/preview")
async def preview_campaign(body: CampaignUpsert,
                           maker_slug: str = Depends(current_maker_slug)):
    """Dry-run allocator — returns what the spend distribution WOULD look
    like for the given budget without debiting or extending anything.
    Used by the Promote page to show real-time "your budget is being
    distributed:" preview as the maker drags the budget slider."""
    allocations = await promote_allocator.compute_allocations(
        maker_slug, int(body.budget_cents),
        explicit_listing_slugs=body.explicit_listing_slugs,
    )
    return {"allocations": allocations, "budget_cents": int(body.budget_cents)}


@router.post("/promote/campaign/apply")
async def apply_campaign(maker_slug: str = Depends(current_maker_slug)):
    """Run the allocator now (instead of waiting for the daily cron).
    Debits the wallet by the per-listing boost cost and extends
    `promoted_until` so the listings show up boosted immediately."""
    camp = await db.campaign_groups.find_one(
        {"maker_slug": maker_slug, "deleted_at": None, "status": "active"}
    )
    if not camp:
        raise HTTPException(404, "No active campaign")
    result = await promote_allocator.apply_allocations(
        maker_slug, camp["campaign_id"], int(camp.get("budget_cents") or 0),
        explicit_listing_slugs=camp.get("explicit_listing_slugs") or None,
    )
    return result


# ── Analytics ──────────────────────────────────────────────────────────
@router.get("/promote/analytics")
async def analytics(maker_slug: str = Depends(current_maker_slug)):
    """Aggregate Phase 1 metrics: total wallet spend, boost count, plus
    a join against `orders` to compute ROAS for boosted listings.

    Phase 1 ROAS = revenue attributable to listings that were boosted
    during the order window. Phase 1.5 will switch to full
    impression/click/conversion attribution via the adsGateway.
    """
    w = await promote_wallet.ensure_wallet(maker_slug)
    total_spent_cents = int(w.get("lifetime_spent_cents") or 0)

    # Sum boost counts + spend per-listing from listing_allocations.
    per_listing = []
    cursor = db.listing_allocations.find(
        {"maker_slug": maker_slug}
    ).sort("total_spent_cents", -1)
    async for a in cursor:
        a.pop("_id", None)
        per_listing.append(a)

    # Revenue from orders on boosted listings (last 30 days).
    cutoff = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    boosted_slugs = [a["slug"] for a in per_listing if int(a.get("total_boosts") or 0) > 0]
    revenue_cents = 0
    order_count = 0
    if boosted_slugs:
        agg = db.orders.aggregate([
            {"$match": {
                "items.slug": {"$in": boosted_slugs},
                "status": {"$in": ["paid", "shipped", "delivered"]},
            }},
            {"$group": {
                "_id": None,
                "revenue": {"$sum": "$total_cents"},
                "count": {"$sum": 1},
            }},
        ])
        async for row in agg:
            revenue_cents = int(row.get("revenue") or 0)
            order_count = int(row.get("count") or 0)

    roas = (revenue_cents / total_spent_cents) if total_spent_cents > 0 else 0.0
    return {
        "spend_cents": total_spent_cents,
        "revenue_cents": revenue_cents,
        "order_count": order_count,
        "roas": round(roas, 2),
        "boosted_listing_count": len(boosted_slugs),
        "per_listing": per_listing,
        "as_of": cutoff,
    }


# ── External ad channels (iter335.5 — Phase 1.5) ───────────────────────
# Wallet + allocator stay channel-agnostic. External campaigns are
# OPT-IN per listing: maker explicitly clicks "Launch on Microsoft"
# from the Promote tab. Newly-launched campaigns ALWAYS land in
# `paused` state so nothing spends until the maker reviews + activates.
EXTERNAL_MIN_PER_LISTING_CENTS = 3500  # = $5/day Bing floor × 7-day window

SUPPORTED_CHANNELS = {"microsoft", "google", "meta"}


class ExternalLaunchRequest(BaseModel):
    channel: str
    listing_slug: str


@router.get("/promote/channels")
async def list_channels(maker_slug: str = Depends(current_maker_slug)):
    """Returns eligibility + status for each external channel so the
    Promote UI can render Connect / Coming-soon / Active states."""
    out = []
    for ch in ("microsoft", "google", "meta"):
        try:
            gw = get_gateway(ch)
            ok, reason = await gw.is_eligible(maker_slug)
        except Exception as e:  # defensive — never let a broken adapter crash the page
            ok, reason = False, f"adapter error: {str(e)[:80]}"
        active_count = await db.external_ad_campaigns.count_documents({
            "maker_slug": maker_slug, "channel": ch, "status": "active",
        })
        out.append({
            "channel": ch,
            "eligible": ok,
            "reason": reason,
            "active_count": active_count,
        })
    return {"channels": out}


@router.get("/promote/external")
async def list_external_campaigns(maker_slug: str = Depends(current_maker_slug)):
    cur = db.external_ad_campaigns.find(
        {"maker_slug": maker_slug}
    ).sort("created_at", -1)
    out = []
    async for d in cur:
        d.pop("_id", None)
        out.append(d)
    return {"campaigns": out}


@router.post("/promote/external/launch")
async def launch_external(body: ExternalLaunchRequest,
                          request: Request,
                          maker_slug: str = Depends(current_maker_slug)):
    """Create a paused external campaign for one listing on one channel.
    Idempotent — if a campaign already exists for the (maker, channel,
    slug) tuple, returns the existing handle without creating again."""
    if body.channel not in SUPPORTED_CHANNELS:
        raise HTTPException(400, f"channel must be one of {sorted(SUPPORTED_CHANNELS)}")

    camp = await db.campaign_groups.find_one(
        {"maker_slug": maker_slug, "deleted_at": None}
    )
    if not camp:
        raise HTTPException(404, "Create a Promote plan first.")

    allocs = await promote_allocator.compute_allocations(
        maker_slug, int(camp.get("budget_cents") or 0),
        explicit_listing_slugs=(camp.get("explicit_listing_slugs") or None),
    )
    alloc = next((a for a in allocs if a["slug"] == body.listing_slug), None)
    if not alloc:
        raise HTTPException(404, "Listing not eligible — check it's published.")
    if int(alloc["allocated_cents"]) < EXTERNAL_MIN_PER_LISTING_CENTS:
        raise HTTPException(
            400,
            f"Per-listing allocation (${alloc['allocated_cents']/100:.2f}) "
            f"below external-channel floor (${EXTERNAL_MIN_PER_LISTING_CENTS/100:.2f}). "
            "Increase your monthly budget or focus on fewer listings to qualify."
        )

    existing = await db.external_ad_campaigns.find_one({
        "maker_slug": maker_slug, "channel": body.channel,
        "listing_slug": body.listing_slug,
    })
    if existing:
        existing.pop("_id", None)
        return {"campaign": existing, "created": False}

    listing = await db.products.find_one(
        {"slug": body.listing_slug, "maker_slug": maker_slug,
         "deleted_at": None},
        {"_id": 0, "slug": 1, "title": 1, "description": 1, "short_description": 1, "images": 1},
    )
    if not listing:
        raise HTTPException(404, "Listing not found.")

    host = public_host(request)
    description = (listing.get("description")
                   or listing.get("short_description") or "")
    primary_image = None
    imgs = listing.get("images") or []
    if isinstance(imgs, list) and imgs:
        first = imgs[0]
        primary_image = first if isinstance(first, str) else (first or {}).get("url")

    spec = CreateCampaignSpec(
        maker_slug=maker_slug,
        listing_slug=body.listing_slug,
        listing_title=listing.get("title") or body.listing_slug,
        listing_description=description,
        listing_url=f"{host}/p/{body.listing_slug}",
        listing_image_url=primary_image,
        daily_budget_cents=int(alloc["allocated_cents"] // 7),
    )

    try:
        gw = get_gateway(body.channel)
        handle = await gw.create_campaign(spec)
    except GatewayNotEligible as e:
        raise HTTPException(409, str(e))
    except GatewayNotImplemented as e:
        raise HTTPException(501, str(e))
    except GatewayError as e:
        raise HTTPException(502, str(e))

    row = {
        "_id": f"{body.channel}:{handle.external_id}",
        "maker_slug": maker_slug,
        "campaign_id": camp["campaign_id"],
        "channel": body.channel,
        "listing_slug": body.listing_slug,
        "external_id": handle.external_id,
        "status": handle.status,
        "note": handle.note,
        "daily_budget_cents": spec.daily_budget_cents,
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }
    await db.external_ad_campaigns.insert_one(row)
    row.pop("_id", None)
    return {"campaign": row, "created": True}


@router.post("/promote/external/{channel}/{external_id}/pause")
async def pause_external(channel: str, external_id: str,
                         maker_slug: str = Depends(current_maker_slug)):
    row = await db.external_ad_campaigns.find_one({
        "channel": channel, "external_id": external_id, "maker_slug": maker_slug,
    })
    if not row:
        raise HTTPException(404, "Campaign not found.")
    try:
        await get_gateway(channel).pause_campaign(external_id)
    except GatewayError as e:
        raise HTTPException(502, str(e))
    await db.external_ad_campaigns.update_one(
        {"_id": row["_id"]},
        {"$set": {"status": "paused", "updated_at": now_iso()}},
    )
    return {"status": "paused"}


@router.post("/promote/external/{channel}/{external_id}/resume")
async def resume_external(channel: str, external_id: str,
                          maker_slug: str = Depends(current_maker_slug)):
    """Activate a paused external campaign. From this point on real
    money starts flowing through the channel — the maker has now
    explicitly consented to external ad spend on this listing."""
    row = await db.external_ad_campaigns.find_one({
        "channel": channel, "external_id": external_id, "maker_slug": maker_slug,
    })
    if not row:
        raise HTTPException(404, "Campaign not found.")
    try:
        await get_gateway(channel).resume_campaign(external_id)
    except GatewayError as e:
        raise HTTPException(502, str(e))
    await db.external_ad_campaigns.update_one(
        {"_id": row["_id"]},
        {"$set": {"status": "active", "activated_at": now_iso(),
                  "updated_at": now_iso()}},
    )
    return {"status": "active"}
