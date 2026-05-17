"""Daily orphan-cleanup for buyer personalization uploads (iter151).

When a buyer uploads a reference image on a personalizable listing,
the file lands in R2 and a row is inserted into `personalization_uploads`
with `referenced: false`. The webhook flips `referenced: true` once an
order persists that URL.

Reality check: a meaningful chunk of buyers upload an image, then
either change their mind, hit a payment error, or get distracted —
and never check out. Those orphan R2 keys sit forever costing storage
+ egress. This cron runs every 24h and:

  • Finds rows where `referenced=false` AND `created_at < now - 7d`
  • Deletes the R2 key (best-effort — log on failure, don't crash)
  • Deletes the Mongo row

The 7-day grace window covers:
  • Bank holiday weekends + slow shipping decisions
  • Buyers who upload, save the URL, share with their partner for
    approval, then come back to check out

It's intentionally NOT aggressive (1h or 24h). We'd rather keep an
orphan file an extra few days than nuke a buyer's reference 30 min
before they hit pay.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from core import db, logger
from r2_storage import delete_key, key_from_public_url


ORPHAN_AGE_DAYS = 7


async def run_personalization_orphan_cleanup() -> dict:
    """Walk personalization_uploads, drop R2 keys for unreferenced rows
    older than ORPHAN_AGE_DAYS. Returns summary stats for the scheduler
    log + admin audit row.
    """
    cutoff = (datetime.now(timezone.utc) - timedelta(days=ORPHAN_AGE_DAYS)).isoformat()
    query = {"referenced": False, "created_at": {"$lt": cutoff}}

    candidates = await db.personalization_uploads.find(
        query, {"_id": 0, "url": 1, "created_at": 1},
    ).to_list(5000)

    deleted_r2 = 0
    deleted_db = 0
    failed = 0
    for row in candidates:
        url = (row.get("url") or "").strip()
        if not url:
            continue
        key = key_from_public_url(url)
        if key:
            try:
                # `delete_key` is best-effort — already logs on failure
                # but doesn't raise. We still wrap defensively in case
                # the R2 client itself raises a credential error.
                delete_key(key)
                deleted_r2 += 1
            except Exception as e:
                logger.warning("[orphan-cleanup] R2 delete failed url=%s: %s", url, e)
                failed += 1
                # Don't delete the Mongo row if R2 delete failed — we'll
                # retry next cycle. Otherwise we'd leak orphan storage
                # silently.
                continue
        # If the URL was unparseable (different CDN / external host),
        # we still drop the row so it doesn't keep re-listing forever.
        r = await db.personalization_uploads.delete_one({"url": url})
        if r.deleted_count:
            deleted_db += 1

    return {
        "candidates": len(candidates),
        "deleted_r2": deleted_r2,
        "deleted_db": deleted_db,
        "failed_r2": failed,
        "cutoff": cutoff,
    }
