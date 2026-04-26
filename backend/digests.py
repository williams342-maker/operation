"""Monthly Crafters Plus ROI digest job.

Computes each free-tier maker's "what Plus would have saved you" over the
last 30 days, and emails them a marketing digest if their gross sales cross
the configured threshold. Designed to be run by:

    POST /api/admin/digests/plus-roi          (admin-gated, dry-run by default)
    POST /api/admin/digests/plus-roi?apply=true

…or from a cron / scheduler hitting the same endpoint.
"""
from __future__ import annotations
from datetime import datetime, timedelta, timezone
from typing import List, Dict, Any

from core import db, logger
from email_service import send_maker_plus_roi_digest

# Only digest makers above this monthly gross — below this, the upsell pitch
# would actually show "negative net" and feel pushy.
DIGEST_GROSS_THRESHOLD_USD = 500.0
# Dedupe window — never send twice within 25 days even if cron fires more often.
DIGEST_COOLDOWN_DAYS = 25


def _frontend_origin() -> str:
    """Best-effort frontend URL for "Upgrade" CTA."""
    import os
    return (os.environ.get("FRONTEND_URL")
            or os.environ.get("PUBLIC_FRONTEND_URL")
            or "https://craftersmarket.org").rstrip("/")


async def run_plus_roi_digest(apply: bool = False) -> Dict[str, Any]:
    """Compute candidates and either preview them (dry-run) or send digests.

    Returns: { candidates: [...], sent: int, skipped: int, threshold: float }
    """
    from revenue import PLUS_PLATFORM_FEE_BPS
    from routers.stripe_connect import PLATFORM_FEE_BPS

    bps_delta = max(0, PLATFORM_FEE_BPS - PLUS_PLATFORM_FEE_BPS)  # 100 bps = 1%
    cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    cooldown_cutoff = (
        datetime.now(timezone.utc) - timedelta(days=DIGEST_COOLDOWN_DAYS)
    ).isoformat()

    # 1) Pull every free-tier maker (active/trialing Plus subs are ineligible).
    free_makers = await db.makers.find(
        {"$or": [{"subscription_status": {"$exists": False}},
                 {"subscription_status": {"$nin": ["active", "trialing"]}}]},
        {"_id": 0, "slug": 1, "email": 1, "name": 1,
         "last_plus_roi_digest_sent_at": 1},
    ).to_list(2000)

    # 2) Sum payouts in last 30d per maker (single query, fold in Python).
    payouts = await db.maker_payouts.find(
        {"updated_at": {"$gte": cutoff}},
        {"_id": 0, "maker_slug": 1, "amount": 1},
    ).to_list(5000)
    gross_by: Dict[str, float] = {}
    for p in payouts:
        try:
            gross_by[p["maker_slug"]] = gross_by.get(p["maker_slug"], 0.0) + float(p.get("amount") or 0)
        except (TypeError, ValueError):
            continue

    candidates: List[Dict[str, Any]] = []
    sent = 0
    skipped = 0
    upgrade_link = f"{_frontend_origin()}/maker/dashboard?tab=billing&utm_source=email&utm_campaign=plus-roi-digest"

    for m in free_makers:
        gross = gross_by.get(m["slug"], 0.0)
        if gross < DIGEST_GROSS_THRESHOLD_USD:
            continue
        last_sent = m.get("last_plus_roi_digest_sent_at") or ""
        if last_sent and last_sent > cooldown_cutoff:
            skipped += 1
            continue
        commission_savings = round(gross * (bps_delta / 10000.0), 2)
        net_benefit = round(commission_savings - 12.0, 2)
        row = {
            "slug": m["slug"],
            "email": m.get("email"),
            "name": m.get("name") or m["slug"],
            "gross_30d": round(gross, 2),
            "commission_savings": commission_savings,
            "net_benefit": net_benefit,
        }
        candidates.append(row)
        if not apply:
            continue

        # Send + stamp.
        try:
            r = await send_maker_plus_roi_digest(
                maker_email=row["email"],
                maker_name=row["name"],
                gross_30d=row["gross_30d"],
                commission_savings=row["commission_savings"],
                net_benefit=row["net_benefit"],
                upgrade_link=upgrade_link,
            )
            if r is not None:
                await db.makers.update_one(
                    {"slug": m["slug"]},
                    {"$set": {"last_plus_roi_digest_sent_at": datetime.now(timezone.utc).isoformat()}},
                )
                sent += 1
            else:
                skipped += 1
                logger.warning("plus-roi digest skipped for %s — email_service returned None", m["slug"])
        except Exception as e:
            skipped += 1
            logger.exception("plus-roi digest failed for %s: %s", m["slug"], e)

    return {
        "threshold_usd": DIGEST_GROSS_THRESHOLD_USD,
        "cooldown_days": DIGEST_COOLDOWN_DAYS,
        "candidates": candidates,
        "candidate_count": len(candidates),
        "sent": sent,
        "skipped": skipped,
        "mode": "applied" if apply else "dry-run",
    }
