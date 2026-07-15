"""iter334c — Weekly AI pricing digest.

Scans the `price_comparisons` collection (populated by the AI Price Check
maker tool) and emails each maker once per ISO week if any of their
listings are priced ≥20% above the AI-derived market median.

Idempotency
-----------
`pricing_digest_log` shape (compound _id):
    { _id: f"{iso_year}-W{iso_week:02d}:{maker_slug}",
      sent_at, status, flagged_count, flagged_slugs }
Running twice in the same ISO week sends zero extra emails.

Opt-out
-------
`maker.pricing_digest_opt_out: true` skips the maker. Default behaviour
is to send. Surfaced in the Maker Profile settings.

Threshold
---------
`PRICING_DIGEST_OVER_PCT` env var (default 20.0). A listing is flagged
when `listed_price >= median * (1 + threshold/100)`. Stale comparisons
(older than 60 days) are ignored — the AI Price Check feature is
expected to be re-run periodically by the maker.
"""
from __future__ import annotations
from config import env_get
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core import db, logger, now_iso
from email_service import send_maker_pricing_digest
from maker_auth import current_admin, current_maker_slug

router = APIRouter()


def _iso_week_key(dt: datetime) -> str:
    iso_year, iso_week, _ = dt.isocalendar()
    return f"{iso_year}-W{iso_week:02d}"


def _over_pct() -> float:
    raw = (env_get("PRICING_DIGEST_OVER_PCT") or "").strip()
    try:
        v = float(raw) if raw else 20.0
        return max(5.0, min(200.0, v))  # bound to a sensible range
    except ValueError:
        return 20.0


# iter334g — Underpriced threshold. Symmetrical to _over_pct by default,
# but separately tunable so ops can dial down "too low" alerts without
# affecting "too high" alerts (e.g. for makers selling premium goods who
# might genuinely undercut general market median for strategic reasons).
def _under_pct() -> float:
    raw = (env_get("PRICING_DIGEST_UNDER_PCT") or "").strip()
    try:
        v = float(raw) if raw else 20.0
        return max(5.0, min(80.0, v))  # bounded — can't be "100% below"
    except ValueError:
        return 20.0


async def run_weekly_pricing_digest(
    *,
    dry_run: bool = False,
    only_maker: Optional[str] = None,
    comparison_max_age_days: int = 60,
) -> dict:
    """Find flagged listings per maker and send (or simulate) a digest.

    iter334g — Now collects BOTH above-market (default 20%+ over median)
    AND below-market (default 20%+ under median) listings. Both kinds
    are sent in a single weekly Monday email so the maker has one
    "pricing pulse" inbox footprint, not two. The opt-out flag still
    governs the whole email.

    Returns a stats dict for logging / admin debug rendering. Safe to
    call multiple times in a week — idempotent via `pricing_digest_log`.
    """
    now = datetime.now(timezone.utc)
    week_key = _iso_week_key(now)
    over_pct = _over_pct()
    under_pct = _under_pct()
    cutoff = (now - timedelta(days=comparison_max_age_days)).isoformat()

    # 1) Pull the most recent comparison per (maker, listing) within the
    #    age window. Mongo doesn't have a clean "latest per group" so we
    #    aggregate.
    pipeline = [
        {"$match": {"created_at": {"$gte": cutoff}}},
        {"$sort": {"created_at": -1}},
        {"$group": {
            "_id": {"maker": "$maker_slug", "listing": "$listing_slug"},
            "doc": {"$first": "$$ROOT"},
        }},
        {"$replaceRoot": {"newRoot": "$doc"}},
    ]
    if only_maker:
        pipeline.insert(0, {"$match": {"maker_slug": only_maker}})

    rows = await db.price_comparisons.aggregate(pipeline).to_list(5000)
    if not rows:
        return {"status": "skipped", "reason": "no_recent_comparisons",
                "week_key": week_key}

    # 2) Group by maker → two lists: above + below. A single listing can
    #    only land in one bucket (never both — it's strictly priced
    #    either over or under median).
    by_maker: dict[str, dict] = {}
    for r in rows:
        median = float(r.get("price_median") or 0)
        listed = float(r.get("listed_price") or 0)
        if median <= 0 or listed <= 0:
            continue
        delta_pct = ((listed - median) / median) * 100.0
        slug = r.get("listing_slug") or ""
        maker = r.get("maker_slug") or ""
        if not slug or not maker:
            continue
        entry = {
            "slug": slug,
            "listed_price": listed,
            "market_median": median,
            "delta_pct": delta_pct,
        }
        if delta_pct >= over_pct:
            by_maker.setdefault(maker, {"above": [], "below": []})["above"].append(entry)
        elif delta_pct <= -under_pct:
            by_maker.setdefault(maker, {"above": [], "below": []})["below"].append(entry)

    if not by_maker:
        return {"status": "skipped", "reason": "no_flagged_listings",
                "week_key": week_key, "comparisons_scanned": len(rows),
                "over_pct": over_pct, "under_pct": under_pct}

    # 3) Hydrate titles + maker email/name + run idempotency check.
    sent_to = []
    skipped_already_sent = 0
    skipped_opted_out = 0
    skipped_no_email = 0
    errors = 0

    for maker_slug, buckets in by_maker.items():
        maker = await db.makers.find_one(
            {"slug": maker_slug},
            {"_id": 0, "email": 1, "name": 1, "pricing_digest_opt_out": 1},
        )
        if not maker:
            continue
        if maker.get("pricing_digest_opt_out") is True:
            skipped_opted_out += 1
            continue
        email = (maker.get("email") or "").strip()
        if not email:
            skipped_no_email += 1
            continue

        # Hydrate titles from the products collection (one query for
        # both buckets combined).
        all_slugs = [f["slug"] for f in buckets["above"]] + [f["slug"] for f in buckets["below"]]
        products = await db.products.find(
            {"slug": {"$in": all_slugs}, "maker_slug": maker_slug},
            {"_id": 0, "slug": 1, "title": 1, "status": 1, "price": 1},
        ).to_list(len(all_slugs))
        prod_by_slug = {p["slug"]: p for p in products}

        # Drop listings that are no longer published or whose CURRENT
        # price has drifted back to within the relevant threshold (maker
        # may have already adjusted since the comparison was generated).
        live_above: list[dict] = []
        live_below: list[dict] = []
        for f in buckets["above"]:
            p = prod_by_slug.get(f["slug"])
            if not p or (p.get("status") and p["status"] != "published"):
                continue
            current_price = float(p.get("price") or 0)
            if current_price <= 0:
                continue
            current_delta = ((current_price - f["market_median"]) / f["market_median"]) * 100.0
            if current_delta < over_pct:
                continue
            live_above.append({
                **f,
                "listed_price": current_price,
                "delta_pct": current_delta,
                "title": p.get("title") or f["slug"],
            })
        for f in buckets["below"]:
            p = prod_by_slug.get(f["slug"])
            if not p or (p.get("status") and p["status"] != "published"):
                continue
            current_price = float(p.get("price") or 0)
            if current_price <= 0:
                continue
            current_delta = ((current_price - f["market_median"]) / f["market_median"]) * 100.0
            if current_delta > -under_pct:
                continue
            live_below.append({
                **f,
                "listed_price": current_price,
                "delta_pct": current_delta,
                "title": p.get("title") or f["slug"],
            })

        if not live_above and not live_below:
            continue

        # Idempotency — has this maker already gotten a digest this week?
        log_id = f"{week_key}:{maker_slug}"
        existing = await db.pricing_digest_log.find_one({"_id": log_id}, {"_id": 1})
        if existing:
            skipped_already_sent += 1
            continue

        live_above.sort(key=lambda x: x["delta_pct"], reverse=True)
        # For below, biggest absolute discount first (most negative).
        live_below.sort(key=lambda x: x["delta_pct"])

        if dry_run:
            sent_to.append({
                "maker": maker_slug,
                "flagged_count": len(live_above) + len(live_below),
                "above_count": len(live_above),
                "below_count": len(live_below),
                "would_send_to": email,
            })
            continue

        try:
            await send_maker_pricing_digest(
                maker_email=email,
                maker_name=maker.get("name") or maker_slug,
                flagged=live_above,
                underpriced=live_below,
            )
            await db.pricing_digest_log.update_one(
                {"_id": log_id},
                {"$set": {
                    "sent_at": now_iso(),
                    "status": "sent",
                    "maker_slug": maker_slug,
                    "flagged_count": len(live_above) + len(live_below),
                    "flagged_slugs": [f["slug"] for f in live_above],
                    "underpriced_slugs": [f["slug"] for f in live_below],
                    "over_pct": over_pct,
                    "under_pct": under_pct,
                }},
                upsert=True,
            )
            sent_to.append({
                "maker": maker_slug,
                "flagged_count": len(live_above) + len(live_below),
                "above_count": len(live_above),
                "below_count": len(live_below),
            })
        except Exception as e:
            errors += 1
            logger.exception("[pricing_digest] send failed maker=%s: %s", maker_slug, e)

    return {
        "status": "ok",
        "week_key": week_key,
        "over_pct": over_pct,
        "under_pct": under_pct,
        "comparisons_scanned": len(rows),
        "makers_eligible": len(by_maker),
        "sent": len([s for s in sent_to if "would_send_to" not in s]),
        "would_send": len([s for s in sent_to if "would_send_to" in s]) if dry_run else 0,
        "skipped_already_sent": skipped_already_sent,
        "skipped_opted_out": skipped_opted_out,
        "skipped_no_email": skipped_no_email,
        "errors": errors,
        "details": sent_to[:20],
    }


# ── admin manual trigger ───────────────────────────────────────────────
class _AdminPricingDigestReq(BaseModel):
    dry_run: bool = False
    only_maker: Optional[str] = None


@router.post("/admin/pricing-digest/run")
async def admin_run_pricing_digest(
    body: _AdminPricingDigestReq,
    _admin: dict = Depends(current_admin),
):
    """Manual trigger for ops debugging. Honors `dry_run` + `only_maker`."""
    try:
        return await run_weekly_pricing_digest(
            dry_run=body.dry_run,
            only_maker=body.only_maker,
        )
    except Exception as e:
        logger.exception("[pricing_digest] admin trigger failed: %s", e)
        raise HTTPException(500, f"Pricing digest failed: {e}")


# iter334h — Admin week-over-week health view for the pricing digest.
# Aggregates `pricing_digest_log` rows into a per-ISO-week summary so
# ops can see whether the digest is reaching anyone, how the
# above/below split is trending, and which makers received the most
# flagged items in any given week.
@router.get("/admin/pricing-digest/history")
async def admin_pricing_digest_history(
    weeks: int = 8, _admin: dict = Depends(current_admin),
):
    """Return the last `weeks` ISO-week buckets (default 8) with aggregate
    counts of sent digests + above/below-market flagged listings, plus
    the top 5 makers by total flagged items per week. Read-only — never
    mutates the log."""
    weeks = max(1, min(52, int(weeks)))
    # `pricing_digest_log._id` is shape `{iso_year}-W{iso_week:02d}:{maker_slug}`
    # so we can pull the week-key out by splitting the doc id. Cheaper
    # than a $dateFromString + $isoWeek over `sent_at`.
    cursor = db.pricing_digest_log.find(
        {}, {"_id": 1, "maker_slug": 1, "flagged_count": 1,
             "flagged_slugs": 1, "underpriced_slugs": 1, "sent_at": 1},
    ).sort([("_id", -1)]).limit(2000)

    by_week: dict[str, dict] = {}
    async for r in cursor:
        rid = r.get("_id") or ""
        if ":" not in rid:
            continue
        week_key, maker_slug = rid.split(":", 1)
        bucket = by_week.setdefault(week_key, {
            "week_key": week_key,
            "sent": 0,
            "above_flagged": 0,
            "below_flagged": 0,
            "total_flagged": 0,
            "by_maker": {},
        })
        above = len(r.get("flagged_slugs") or [])
        below = len(r.get("underpriced_slugs") or [])
        bucket["sent"] += 1
        bucket["above_flagged"] += above
        bucket["below_flagged"] += below
        bucket["total_flagged"] += int(r.get("flagged_count") or above + below)
        bucket["by_maker"][maker_slug] = above + below

    # Sort weeks newest-first and cap to the requested window.
    weeks_sorted = sorted(by_week.values(), key=lambda b: b["week_key"], reverse=True)[:weeks]
    # Convert per-maker dict → top 5 list per week for compact UI rendering.
    for b in weeks_sorted:
        top = sorted(b["by_maker"].items(), key=lambda x: x[1], reverse=True)[:5]
        b["top_makers"] = [{"maker_slug": s, "flagged": n} for s, n in top]
        del b["by_maker"]
    return {"weeks": weeks_sorted, "total_weeks_returned": len(weeks_sorted)}


# ── maker-facing opt-out toggle (iter334f) ─────────────────────────────
class _OptOutReq(BaseModel):
    opt_out: bool


@router.get("/maker/pricing-digest/preference")
async def maker_get_pricing_digest_preference(slug: str = Depends(current_maker_slug)):
    """Return the maker's current pricing-digest opt-out state. Used by
    the Settings → Notifications panel to render the toggle's initial
    checked state."""
    m = await db.makers.find_one(
        {"slug": slug}, {"_id": 0, "pricing_digest_opt_out": 1},
    ) or {}
    return {"opt_out": bool(m.get("pricing_digest_opt_out"))}


@router.post("/maker/pricing-digest/preference")
async def maker_set_pricing_digest_preference(
    body: _OptOutReq, slug: str = Depends(current_maker_slug),
):
    """Update the maker's pricing-digest opt-out flag. When set to True
    the weekly cron skips this maker. Mirrors the `push_on_ship_optout`
    pattern in `routers/push.py` for consistency."""
    await db.makers.update_one(
        {"slug": slug},
        {"$set": {"pricing_digest_opt_out": bool(body.opt_out)}},
    )
    return {"ok": True, "opt_out": bool(body.opt_out)}



# iter334i — Maker-facing inline pricing verdicts. Returns the latest
# `price_comparisons` row per listing-slug for the requesting maker,
# capped at a sensible window so old AI runs don't litter the dashboard.
@router.get("/maker/pricing-comparisons/latest")
async def maker_latest_comparisons(
    max_age_days: int = 60, slug: str = Depends(current_maker_slug),
):
    """Bulk fetch the latest comparison per listing for the dashboard
    inline-verdict badges. Returns a dict keyed by listing_slug for
    O(1) lookup client-side. Empty `comparisons` is the happy path
    when the maker hasn't run any AI Price Checks yet.

    Each entry includes:
        { delta_pct, price_median, listed_price_at_check, generated_at }
    The frontend mixes this with the maker's current `product.price` so
    a stale row can still surface a fresh verdict — the badge math runs
    against today's price + the cached median, not yesterday's.
    """
    max_age_days = max(1, min(180, int(max_age_days)))
    cutoff = (datetime.now(timezone.utc) - timedelta(days=max_age_days)).isoformat()
    pipeline = [
        {"$match": {"maker_slug": slug, "created_at": {"$gte": cutoff}}},
        {"$sort": {"created_at": -1}},
        {"$group": {"_id": "$listing_slug", "doc": {"$first": "$$ROOT"}}},
        {"$replaceRoot": {"newRoot": "$doc"}},
    ]
    out: dict[str, dict] = {}
    async for r in db.price_comparisons.aggregate(pipeline):
        listing_slug = r.get("listing_slug")
        if not listing_slug:
            continue
        median = float(r.get("price_median") or 0)
        listed = float(r.get("listed_price") or 0)
        delta_pct = None
        if median > 0 and listed > 0:
            delta_pct = ((listed - median) / median) * 100.0
        out[listing_slug] = {
            "delta_pct": delta_pct,
            "price_median": median,
            "listed_price_at_check": listed,
            "generated_at": r.get("generated_at") or r.get("created_at"),
        }
    return {"comparisons": out, "count": len(out)}

