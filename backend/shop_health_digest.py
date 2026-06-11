"""Weekly "Shop health" digest — Sundays 09:00 UTC (iter367).

One bundled email per maker covering everything actionable in their
shop, replacing the narrower restock-only digest:

  1. Pending orders   — paid, unshipped orders containing their items
  2. Restock demand   — open waitlist entries per back-ordered listing
  3. Feed quality     — listings syncing to Google with fallback
                        attributes (underivable material / color)

Makers with nothing actionable get NO email (quiet weeks stay quiet).
Opt-out honored via the existing `restock_digest_opt_out` maker flag
(re-labelled "Shop Health digest" in Settings — existing opt-outs carry
over). Idempotent per ISO week: `system_state.shop_health_digest`.
"""
from __future__ import annotations

from datetime import datetime, timezone

from core import db, logger, now_iso

STATE_KEY = "shop_health_digest"


def _current_iso_week() -> str:
    iso_year, iso_week, _ = datetime.now(timezone.utc).isocalendar()
    return f"{iso_year}-W{iso_week:02d}"


async def _state() -> dict:
    return await db.system_state.find_one({"key": STATE_KEY}, {"_id": 0}) or {}


async def _set_state(iso_week: str) -> None:
    await db.system_state.update_one(
        {"key": STATE_KEY},
        {"$set": {"key": STATE_KEY, "last_dispatched_week": iso_week,
                  "last_dispatched_at": now_iso()}},
        upsert=True,
    )


async def build_summaries() -> list[dict]:
    """One pass over products / orders / waitlist, bucketed per maker.

    Returns only makers with ≥1 actionable item, an email address, and
    no digest opt-out.
    """
    from routers.pinterest_feed import _resolve_gpc
    from services.merchant_attributes import merchant_attributes

    products = await db.products.find(
        {"status": "published", "deleted_at": {"$in": [None, ""]}},
        {"_id": 0, "id": 1, "slug": 1, "title": 1, "description": 1,
         "category": 1, "technique": 1, "materials": 1, "gpc_path": 1,
         "maker_slug": 1, "listing_type": 1, "colors": 1, "merchant_color": 1},
    ).limit(5000).to_list(5000)

    # ---- Section 3: feed quality, grouped per maker ----
    feed_by_maker: dict[str, list[dict]] = {}
    product_to_maker: dict[str, str] = {}
    physical_ids: set[str] = set()
    for p in products:
        mslug = p.get("maker_slug") or ""
        if not mslug:
            continue
        for key in (p.get("id"), p.get("slug")):
            if key:
                product_to_maker[key] = mslug
        if (p.get("listing_type") or "physical") != "digital":
            for key in (p.get("id"), p.get("slug")):
                if key:
                    physical_ids.add(key)
        res = merchant_attributes(p, _resolve_gpc(p))
        if res["warnings"]:
            feed_by_maker.setdefault(mslug, []).append({
                "slug": p.get("slug"),
                "title": (p.get("title") or "")[:70],
                "warnings": res["warnings"],
            })

    # ---- Section 1: pending (paid, unshipped) orders ----
    # Digital-only orders never get "shipped" — only count txs holding at
    # least one PHYSICAL item from the maker.
    txs = await db.payment_transactions.find(
        {"payment_status": "paid",
         "$or": [{"shipped_at": None}, {"shipped_at": {"$exists": False}}]},
        {"_id": 0, "session_id": 1, "items": 1, "created_at": 1},
    ).sort("created_at", -1).limit(1000).to_list(1000)
    pending_by_maker: dict[str, list[dict]] = {}
    for tx in txs:
        makers_in_tx: set[str] = set()
        for ci in tx.get("items", []):
            pid = ci.get("product_id")
            if pid in physical_ids and pid in product_to_maker:
                makers_in_tx.add(product_to_maker[pid])
        for mslug in makers_in_tx:
            pending_by_maker.setdefault(mslug, []).append({
                "session_id": tx.get("session_id"),
                "created_at": tx.get("created_at"),
            })

    # ---- Section 2: restock demand (open waitlist) ----
    rows = await db.restock_waitlist.aggregate([
        {"$match": {"notified_at": None}},
        {"$group": {
            "_id": {"maker_slug": "$maker_slug",
                    "product_slug": "$product_slug",
                    "product_title": "$product_title"},
            "count": {"$sum": 1},
        }},
        {"$sort": {"count": -1}},
    ]).to_list(5000)
    restock_by_maker: dict[str, list[dict]] = {}
    for r in rows:
        mslug = r["_id"]["maker_slug"]
        restock_by_maker.setdefault(mslug, []).append({
            "product_slug": r["_id"]["product_slug"],
            "product_title": r["_id"]["product_title"],
            "count": int(r["count"]),
        })

    # ---- Assemble per maker, skipping the all-quiet ones ----
    all_slugs = set(feed_by_maker) | set(pending_by_maker) | set(restock_by_maker)
    summaries: list[dict] = []
    for slug in all_slugs:
        m = await db.makers.find_one(
            {"slug": slug, "deleted_at": {"$in": [None, ""]}},
            {"_id": 0, "email": 1, "name": 1, "restock_digest_opt_out": 1},
        )
        if not m or not m.get("email"):
            continue
        if m.get("restock_digest_opt_out"):
            logger.info("[shop_health_digest] skipping %s (opted out)", slug)
            continue
        pending = pending_by_maker.get(slug, [])
        restock = restock_by_maker.get(slug, [])
        feed = feed_by_maker.get(slug, [])
        if not (pending or restock or feed):
            continue
        summaries.append({
            "maker_slug": slug,
            "maker_name": m.get("name") or slug,
            "maker_email": m["email"],
            "pending_orders": pending,
            "restock": restock,
            "restock_total": sum(r["count"] for r in restock),
            "feed_quality": feed,
        })
    return summaries


async def run_weekly_shop_health_digest(*, force: bool = False, dry_run: bool = False,
                                        trigger: str = "cron") -> dict:
    """Send one Shop Health email per maker with actionable items.

    Idempotent per ISO week unless `force=True`. `dry_run` computes the
    summaries without sending or stamping state.
    """
    week = _current_iso_week()
    state = await _state()
    if not force and state.get("last_dispatched_week") == week:
        return {"ran": True, "skipped": "already_dispatched_this_week",
                "week": week, "makers_notified": 0}

    summaries = await build_summaries()
    if not summaries:
        if not dry_run:
            await _set_state(week)
        return {"ran": True, "week": week, "makers_notified": 0,
                "reason": "nothing_actionable"}

    notified = 0
    failed = 0
    if not dry_run:
        from email_service import send_maker_shop_health_digest
        for s in summaries:
            try:
                await send_maker_shop_health_digest(
                    email=s["maker_email"], name=s["maker_name"],
                    pending_orders=s["pending_orders"],
                    restock=s["restock"], restock_total=s["restock_total"],
                    feed_quality=s["feed_quality"],
                )
                notified += 1
            except Exception:
                failed += 1
                logger.exception("[shop_health_digest] send failed for %s", s["maker_email"])
        await _set_state(week)

    logger.info(
        "[shop_health_digest] week=%s makers=%d notified=%d failed=%d trigger=%s",
        week, len(summaries), notified, failed, trigger,
    )
    return {
        "ran": True, "week": week,
        "makers_eligible": len(summaries),
        "makers_notified": notified,
        "failed": failed, "dry_run": dry_run, "trigger": trigger,
        "preview": [
            {"maker_slug": s["maker_slug"],
             "pending_orders": len(s["pending_orders"]),
             "restock_total": s["restock_total"],
             "feed_flagged": len(s["feed_quality"])}
            for s in summaries[:20]
        ] if dry_run else None,
    }
