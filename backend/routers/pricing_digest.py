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
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core import db, logger, now_iso
from email_service import send_maker_pricing_digest
from maker_auth import current_admin

router = APIRouter()


def _iso_week_key(dt: datetime) -> str:
    iso_year, iso_week, _ = dt.isocalendar()
    return f"{iso_year}-W{iso_week:02d}"


def _over_pct() -> float:
    raw = (os.environ.get("PRICING_DIGEST_OVER_PCT") or "").strip()
    try:
        v = float(raw) if raw else 20.0
        return max(5.0, min(200.0, v))  # bound to a sensible range
    except ValueError:
        return 20.0


async def run_weekly_pricing_digest(
    *,
    dry_run: bool = False,
    only_maker: Optional[str] = None,
    comparison_max_age_days: int = 60,
) -> dict:
    """Find flagged listings per maker and send (or simulate) a digest.

    Returns a stats dict for logging / admin debug rendering. Safe to
    call multiple times in a week — idempotent via `pricing_digest_log`.
    """
    now = datetime.now(timezone.utc)
    week_key = _iso_week_key(now)
    threshold_pct = _over_pct()
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

    # 2) Group by maker → list of flagged listings.
    by_maker: dict[str, list[dict]] = {}
    for r in rows:
        median = float(r.get("price_median") or 0)
        listed = float(r.get("listed_price") or 0)
        if median <= 0 or listed <= 0:
            continue
        delta_pct = ((listed - median) / median) * 100.0
        if delta_pct < threshold_pct:
            continue
        slug = r.get("listing_slug") or ""
        maker = r.get("maker_slug") or ""
        if not slug or not maker:
            continue
        by_maker.setdefault(maker, []).append({
            "slug": slug,
            "listed_price": listed,
            "market_median": median,
            "delta_pct": delta_pct,
        })

    if not by_maker:
        return {"status": "skipped", "reason": "no_flagged_listings",
                "week_key": week_key, "comparisons_scanned": len(rows),
                "threshold_pct": threshold_pct}

    # 3) Hydrate titles + maker email/name + run idempotency check.
    sent_to = []
    skipped_already_sent = 0
    skipped_opted_out = 0
    skipped_no_email = 0
    errors = 0

    for maker_slug, flagged in by_maker.items():
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

        # Hydrate titles from the products collection.
        slugs = [f["slug"] for f in flagged]
        products = await db.products.find(
            {"slug": {"$in": slugs}, "maker_slug": maker_slug},
            {"_id": 0, "slug": 1, "title": 1, "status": 1, "price": 1},
        ).to_list(len(slugs))
        prod_by_slug = {p["slug"]: p for p in products}

        # Drop listings that are no longer published or whose CURRENT
        # price has been dropped to within threshold (maker may have
        # already adjusted since the comparison was generated).
        live_flagged = []
        for f in flagged:
            p = prod_by_slug.get(f["slug"])
            if not p:
                continue
            if p.get("status") and p["status"] != "published":
                continue
            current_price = float(p.get("price") or 0)
            if current_price <= 0:
                continue
            current_delta = ((current_price - f["market_median"]) / f["market_median"]) * 100.0
            if current_delta < threshold_pct:
                continue
            live_flagged.append({
                **f,
                "listed_price": current_price,  # use *current* price for the email
                "delta_pct": current_delta,
                "title": p.get("title") or f["slug"],
            })

        if not live_flagged:
            continue

        # Idempotency — has this maker already gotten a digest this week?
        log_id = f"{week_key}:{maker_slug}"
        existing = await db.pricing_digest_log.find_one({"_id": log_id}, {"_id": 1})
        if existing:
            skipped_already_sent += 1
            continue

        live_flagged.sort(key=lambda x: x["delta_pct"], reverse=True)

        if dry_run:
            sent_to.append({"maker": maker_slug, "flagged_count": len(live_flagged),
                            "would_send_to": email})
            continue

        try:
            await send_maker_pricing_digest(
                maker_email=email,
                maker_name=maker.get("name") or maker_slug,
                flagged=live_flagged,
            )
            await db.pricing_digest_log.update_one(
                {"_id": log_id},
                {"$set": {
                    "sent_at": now_iso(),
                    "status": "sent",
                    "maker_slug": maker_slug,
                    "flagged_count": len(live_flagged),
                    "flagged_slugs": [f["slug"] for f in live_flagged],
                    "threshold_pct": threshold_pct,
                }},
                upsert=True,
            )
            sent_to.append({"maker": maker_slug, "flagged_count": len(live_flagged)})
        except Exception as e:
            errors += 1
            logger.exception("[pricing_digest] send failed maker=%s: %s", maker_slug, e)

    return {
        "status": "ok",
        "week_key": week_key,
        "threshold_pct": threshold_pct,
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
