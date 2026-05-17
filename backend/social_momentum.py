"""Weekly "social momentum" digest — Mondays at 14:30 UTC.

For each maker whose listings collected one or more share-button clicks
in the past 7 days, sends ONE email summarising:
  • Total shares across all listings
  • Top 3 listings ranked by share count
  • A CTA back to each listing's edit page (where they can grab a
    fresh story-card or copy the share link again to fuel another wave)

Re-engagement loop: every share that lands on a public product page
shows up as social proof to the next buyer (iter148 badge), and
this digest re-surfaces that signal to the maker who can act on it.

Idempotency:
  • One email per maker per ISO week. Storing `social_momentum_sent_at`
    keyed by ISO week on the maker doc; rerunning the same week is a
    no-op. The job re-fans-out without de-dup risk.
  • Makers who opted out (`social_momentum_opt_out=True`) are filtered
    BEFORE the email_service call, so opt-out is honored 100%.
  • Makers with 0 shares get no email (zero-noise rule — empty digests
    train people to ignore the channel).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from core import db, logger

# Soft cap on listings rendered in one email. Makers with 20+ active
# listings still get the digest, but only the top N show up — past
# this point the email becomes a wall of text nobody reads.
TOP_N_LISTINGS = 3


def _iso_week_key(dt: datetime) -> str:
    """ISO-8601 week label (e.g. `2026-W21`) used to dedup sends."""
    y, w, _ = dt.isocalendar()
    return f"{y}-W{w:02d}"


async def run_weekly_social_momentum_digest() -> dict:
    """Main entry. Returns summary stats for the scheduler log."""
    now = datetime.now(timezone.utc)
    iso_week = _iso_week_key(now)
    since = (now - timedelta(days=7)).isoformat()

    # Pull share events from the past 7 days, group by maker + listing.
    # The grouping happens server-side in Mongo so we don't pull a
    # blob of raw event docs into Python.
    cursor = db.share_events.aggregate([
        {"$match": {"created_at": {"$gte": since}, "kind": "product"}},
        {"$group": {"_id": "$slug", "count": {"$sum": 1}}},
    ])
    by_slug: dict[str, int] = {}
    async for r in cursor:
        by_slug[r["_id"]] = r["count"]
    if not by_slug:
        return {"week": iso_week, "makers_emailed": 0, "skipped_no_shares": True}

    # Resolve listings → maker. Listings live in `products`.
    listings = await db.products.find(
        {"slug": {"$in": list(by_slug.keys())}},
        {"_id": 0, "slug": 1, "maker_slug": 1, "title": 1},
    ).to_list(2000)
    by_maker: dict[str, list[dict]] = {}
    for li in listings:
        ms = li.get("maker_slug")
        if not ms:
            continue
        by_maker.setdefault(ms, []).append({
            "slug": li["slug"],
            "title": li.get("title") or li["slug"],
            "count": by_slug.get(li["slug"], 0),
        })

    emailed = 0
    skipped_opt_out = 0
    skipped_already_sent = 0
    for maker_slug, items in by_maker.items():
        maker = await db.makers.find_one(
            {"slug": maker_slug},
            {"_id": 0, "slug": 1, "name": 1, "email": 1,
             "social_momentum_opt_out": 1, "social_momentum_sent_at": 1},
        )
        if not maker or not maker.get("email"):
            continue
        if maker.get("social_momentum_opt_out"):
            skipped_opt_out += 1
            continue
        # ISO-week dedup — re-running mid-week is a no-op.
        last_sent = (maker.get("social_momentum_sent_at") or {})
        if last_sent.get("week") == iso_week:
            skipped_already_sent += 1
            continue

        # Rank desc + soft cap. Sum across listings for the headline.
        items.sort(key=lambda x: -x["count"])
        total = sum(it["count"] for it in items)
        try:
            from email_service import send_social_momentum_digest
            await send_social_momentum_digest(
                email=maker["email"],
                maker_name=maker.get("name") or maker_slug,
                maker_slug=maker_slug,
                total_shares=total,
                top_listings=items[:TOP_N_LISTINGS],
                week_label=iso_week,
            )
            await db.makers.update_one(
                {"slug": maker_slug},
                {"$set": {"social_momentum_sent_at": {
                    "week": iso_week,
                    "sent_at": now.isoformat(),
                    "total_shares": total,
                }}},
            )
            emailed += 1
            logger.info("[social-momentum] %s → %d shares, top=%s",
                        maker_slug, total, items[0]["slug"])
        except Exception as e:
            logger.exception("[social-momentum] send failed for %s: %s", maker_slug, e)

    return {
        "week": iso_week,
        "makers_with_shares": len(by_maker),
        "makers_emailed": emailed,
        "skipped_opt_out": skipped_opt_out,
        "skipped_already_sent": skipped_already_sent,
    }
