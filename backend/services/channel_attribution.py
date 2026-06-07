"""iter335.14 — Phase 4 Promotion Engine: per-channel attribution weights.

Reads paid order attribution from `payment_transactions` and ad spend
from `ad_spend` over a rolling N-day window, computes per-channel
conversion lift, and writes a normalized weight (sum=1.0) to
`channel_weights` collection.

The weights are surfaced two ways:
  • Admin observability:   GET /api/admin/ads/channel-weights — shows
    raw orders / spend / ROAS / lift / weight per channel.
  • Allocator hint:        when a maker launches paid campaigns the
    allocator can pull these weights to recommend a default split
    (e.g. Google=0.55 / Meta=0.30 / MS=0.15) instead of an even 1/3.

Math
----
For each channel c ∈ {google, meta, microsoft}:
  orders_c       = count(payment_transactions where {gclid|fbclid|msclkid}, paid, last N days)
  revenue_c      = sum(payment_transactions.amount_cents for those orders)
  spend_c        = sum(ad_spend.spend for that channel × last N days)
  roas_c         = revenue_c / spend_c   (or 0 if spend_c == 0)
  lift_c         = max(roas_c, 0.5)      (floor so a channel never disappears)

Normalize:
  weight_c = lift_c / sum(lift_all)

Tie-break: if NO channel has any paid attribution at all in the
window, we return EVEN weights (1/3 each). This avoids the cold-start
problem.

Storage
-------
`channel_weights` doc shape (one per channel):
  {
    _id: <channel>,
    channel: "google"|"meta"|"microsoft",
    weight: 0.0-1.0,
    orders_30d, revenue_cents_30d, spend_cents_30d,
    roas, lift,
    window_days: 30,
    computed_at: iso8601,
  }

Re-computed daily by the scheduler (`_job_recompute_channel_weights`)
at 04:30 UTC.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from core import db, now_iso

log = logging.getLogger("crafters.promote.channel_attr")

CHANNELS = ("google", "meta", "microsoft")
WINDOW_DAYS = 30
LIFT_FLOOR = 0.5  # min lift any channel keeps; prevents 0-weight starvation

# Map channel → tracking param name on payment_transactions.
_CLICK_ID_FIELD = {
    "google":    "gclid",
    "meta":      "fbclid",
    "microsoft": "msclkid",
}


async def _orders_and_revenue(channel: str, since_iso: str) -> tuple[int, int]:
    """Returns (order_count, revenue_cents) for paid txns in the window
    attributed to this channel by click-id."""
    field = _CLICK_ID_FIELD[channel]
    q = {
        field:       {"$exists": True, "$nin": [None, ""]},
        "status":    "paid",
        "paid_at":   {"$gte": since_iso},
    }
    orders = 0
    revenue = 0
    async for tx in db.payment_transactions.find(
        q, {"amount_cents": 1, "amount": 1},
    ):
        orders += 1
        # Some legacy txns store float dollars in `amount`; new ones
        # store integer cents in `amount_cents`. Tolerate both.
        cents = int(tx.get("amount_cents") or round(float(tx.get("amount") or 0) * 100))
        revenue += max(0, cents)
    return orders, revenue


async def _spend_cents(channel: str, since_date: str) -> int:
    """Sum of `ad_spend.spend` (cents) for this channel since the cutoff
    date. ad_spend rows store one doc per platform per day."""
    total = 0
    async for row in db.ad_spend.find({
        "platform": channel,
        "date": {"$gte": since_date},
    }, {"spend": 1, "spend_cents": 1}):
        # Tolerate both shapes (some adapters store dollars, others cents).
        if row.get("spend_cents") is not None:
            total += int(row.get("spend_cents") or 0)
        else:
            total += int(round(float(row.get("spend") or 0) * 100))
    return total


async def compute_weights(window_days: int = WINDOW_DAYS) -> dict:
    """Pure read — does NOT mutate channel_weights. Used by the admin
    diagnostic endpoint AND by the writer below.

    Returns {channels: [...], cold_start: bool, window_days, computed_at}.
    """
    now = datetime.now(timezone.utc)
    cutoff_iso = (now - timedelta(days=window_days)).isoformat()
    cutoff_date = (now - timedelta(days=window_days)).strftime("%Y-%m-%d")

    per_channel = []
    for ch in CHANNELS:
        orders, revenue = await _orders_and_revenue(ch, cutoff_iso)
        spend = await _spend_cents(ch, cutoff_date)
        roas = (revenue / spend) if spend > 0 else 0.0
        per_channel.append({
            "channel": ch,
            "orders_30d": orders,
            "revenue_cents_30d": revenue,
            "spend_cents_30d": spend,
            "roas": round(roas, 4),
        })

    # If every channel has 0 orders AND 0 spend → cold-start, equal weights.
    cold_start = all(c["orders_30d"] == 0 and c["spend_cents_30d"] == 0
                     for c in per_channel)
    if cold_start:
        for c in per_channel:
            c["lift"] = 1.0
            c["weight"] = round(1.0 / len(per_channel), 4)
    else:
        lifts = [max(LIFT_FLOOR, c["roas"]) for c in per_channel]
        total = sum(lifts)
        for c, lift in zip(per_channel, lifts):
            c["lift"] = round(lift, 4)
            c["weight"] = round(lift / total, 4) if total > 0 else round(1.0 / len(per_channel), 4)

    return {
        "channels": per_channel,
        "cold_start": cold_start,
        "window_days": window_days,
        "computed_at": now_iso(),
    }


async def recompute_and_persist(window_days: int = WINDOW_DAYS) -> dict:
    """Compute the weights and UPSERT into `channel_weights`.
    Called by the scheduler (and the admin manual-recompute endpoint).
    """
    result = await compute_weights(window_days)
    for c in result["channels"]:
        await db.channel_weights.update_one(
            {"_id": c["channel"]},
            {"$set": {
                **c,
                "_id": c["channel"],
                "window_days": result["window_days"],
                "computed_at": result["computed_at"],
            }},
            upsert=True,
        )
    log.info("[channel_attr] recomputed weights — cold_start=%s · %s",
             result["cold_start"],
             ", ".join(f"{c['channel']}={c['weight']:.3f}"
                       for c in result["channels"]))
    return result


async def get_persisted() -> dict:
    """Read the persisted weights doc — used by allocator hints / UI tiles.
    Returns equal weights if collection is empty (first deploy)."""
    out = []
    async for c in db.channel_weights.find({}, {"_id": 0}):
        out.append(c)
    if not out:
        # Cold default — never block downstream callers waiting for the cron.
        return {
            "channels": [{"channel": ch, "weight": round(1.0 / len(CHANNELS), 4),
                          "orders_30d": 0, "revenue_cents_30d": 0,
                          "spend_cents_30d": 0, "roas": 0.0, "lift": 1.0}
                         for ch in CHANNELS],
            "cold_start": True,
            "window_days": WINDOW_DAYS,
            "computed_at": None,
        }
    # Keep canonical channel order.
    out.sort(key=lambda c: CHANNELS.index(c["channel"]) if c["channel"] in CHANNELS else 999)
    return {
        "channels": out,
        "cold_start": all(c.get("orders_30d", 0) == 0 and c.get("spend_cents_30d", 0) == 0 for c in out),
        "window_days": out[0].get("window_days", WINDOW_DAYS),
        "computed_at": out[0].get("computed_at"),
    }
