"""Post-delivery review prompt worker.

Logic:
- Find orders where `delivered_at` is between 7d ago and 30d ago AND
  `review_prompt_sent_at` is unset.
- For each, send `send_buyer_review_prompt()` with a per-maker CTA so
  multi-maker carts get one button per shop.
- Stamp `review_prompt_sent_at = now_iso()` so we never double-send.

Why 7–30d window?
- 7 days: gives the buyer time to use the piece, see it in their space,
  feel something. Sub-7d nudges read as pushy.
- 30 days: caps the window so we don't pester long-tail orders that
  somehow slipped through (e.g. backfill). Beyond 30 days, the recall
  signal-to-noise gets bad and the nudge feels stale.

Idempotency: `review_prompt_sent_at` is the source of truth. Even if
the cron runs twice in the same window (e.g. retry after a crash),
the Mongo filter excludes already-stamped orders so we never spam.

Settings toggle: `auto_review_prompt_enabled` in `site_settings` (default
ON). Mutes the entire job — useful during a domain change or email
deliverability investigation.
"""
from __future__ import annotations
from config import env_get

from datetime import datetime, timezone, timedelta
from typing import Any

from core import db, logger, now_iso

# How long after delivery to wait before sending the prompt. Configurable
# via env so we can A/B-test 5 vs 7 vs 10 days without a deploy.
import os as _os
DELAY_DAYS = int(env_get("REVIEW_PROMPT_DELAY_DAYS", "7"))
WINDOW_DAYS = int(env_get("REVIEW_PROMPT_WINDOW_DAYS", "30"))
PER_RUN_CAP = int(env_get("REVIEW_PROMPT_PER_RUN_CAP", "200"))


async def run_review_prompts(apply: bool = True) -> dict[str, Any]:
    """Sweep orders eligible for a post-delivery review prompt.

    Args:
        apply: when False, returns the candidate list without sending or
               stamping. Useful for ops dry-run / debugging.

    Returns:
        {
          "candidate_count": int,
          "sent": int,
          "skipped": [{"session_id": ..., "reason": ...}],
          "errors": [{"session_id": ..., "error": ...}],
          "applied": bool,
        }
    """
    now = datetime.now(timezone.utc)
    earliest_delivered = (now - timedelta(days=WINDOW_DAYS)).isoformat()
    latest_delivered = (now - timedelta(days=DELAY_DAYS)).isoformat()

    # We use ISO-string compares instead of pulling all docs and parsing
    # — `delivered_at` is stored as ISO via `now_iso()`, so lexical
    # ordering matches chronological ordering inside any given timezone
    # offset (Mongo BSON ordering is byte-wise on strings).
    cursor = db.payment_transactions.find(
        {
            "delivered_at": {"$gte": earliest_delivered, "$lte": latest_delivered},
            "review_prompt_sent_at": {"$exists": False},
            # Only physical-goods orders have a `delivered_at`; digital-only
            # orders skip this whole flow (no shipping/delivery to wait for).
            "items": {"$exists": True, "$ne": []},
        },
        {
            "_id": 0,
            "session_id": 1,
            "delivered_at": 1,
            "customer_email": 1,
            "customer_name": 1,
            "shipping_details": 1,
            "items": 1,
        },
    ).limit(PER_RUN_CAP)
    candidates = await cursor.to_list(PER_RUN_CAP)

    sent = 0
    skipped: list[dict] = []
    errors: list[dict] = []

    for tx in candidates:
        sid = tx.get("session_id")
        to = tx.get("customer_email") or (tx.get("shipping_details") or {}).get("email")
        if not to:
            skipped.append({"session_id": sid, "reason": "no-email"})
            continue
        items = tx.get("items") or []
        # Compute days-since-delivery so the email body can include the
        # right past-tense framing ("delivered 7 days ago").
        try:
            delivered_dt = datetime.fromisoformat(tx["delivered_at"].replace("Z", "+00:00"))
            days_ago = max(1, (now - delivered_dt).days)
        except Exception:
            days_ago = DELAY_DAYS

        if not apply:
            sent += 1
            continue
        try:
            from email_service import send_buyer_review_prompt
            await send_buyer_review_prompt(
                buyer_email=to,
                buyer_name=tx.get("customer_name") or (tx.get("shipping_details") or {}).get("name"),
                items=items,
                days_since_delivery=days_ago,
            )
            await db.payment_transactions.update_one(
                {"session_id": sid},
                {"$set": {"review_prompt_sent_at": now_iso()}},
            )
            sent += 1
            logger.info(
                "[review_prompt] sent session=%s to=%s days_ago=%s items=%d",
                sid, to, days_ago, len(items),
            )
        except Exception as e:
            logger.exception("[review_prompt] failed session=%s: %s", sid, e)
            errors.append({"session_id": sid, "error": str(e)[:240]})

    return {
        "candidate_count": len(candidates),
        "sent": sent,
        "skipped": skipped,
        "errors": errors,
        "applied": apply,
        "delay_days": DELAY_DAYS,
        "window_days": WINDOW_DAYS,
        "per_run_cap": PER_RUN_CAP,
    }
