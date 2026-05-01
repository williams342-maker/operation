"""In-process scheduler for periodic Crafters Market jobs.

We deliberately keep this simple: a single AsyncIOScheduler that boots with
the FastAPI process and runs three jobs:

  1. **Listing expiry sweep** (daily, 03:10 UTC):
     auto-flips published listings past their expires_at to draft.
  2. **R2 orphan sweep** (weekly Sunday 04:00 UTC, dry-run):
     surfaces unreferenced R2 objects so a human can decide whether to purge.
  3. **Crafters Plus ROI digest** (monthly, 1st of month at 14:00 UTC):
     emails free-tier makers a "you left $X on the table" upsell.

To disable in test/dev, set `SCHEDULER_ENABLED=false` in env. To run a
specific job manually, hit the existing /api/admin/* endpoints.
"""
from __future__ import annotations

import os

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from core import logger

_scheduler: AsyncIOScheduler | None = None


async def _job_expire_listings() -> None:
    from revenue import expire_due_listings
    try:
        r = await expire_due_listings()
        logger.info("[scheduler] listing-expiry sweep: %s", r)
    except Exception as e:
        logger.exception("[scheduler] listing-expiry failed: %s", e)


async def _job_r2_orphan_sweep() -> None:
    from scripts.sweep_r2_orphans import sweep
    try:
        r = await sweep(apply=False)  # always dry-run from cron
        logger.info("[scheduler] r2 orphan sweep (dry-run): %s", r)
    except Exception as e:
        logger.exception("[scheduler] r2 orphan sweep failed: %s", e)


async def _job_plus_roi_digest() -> None:
    from digests import run_plus_roi_digest
    try:
        r = await run_plus_roi_digest(apply=True)
        logger.info("[scheduler] plus-roi digest: sent=%d skipped=%d candidates=%d",
                    r["sent"], r["skipped"], r["candidate_count"])
    except Exception as e:
        logger.exception("[scheduler] plus-roi digest failed: %s", e)


async def _job_clear_idle_chat() -> None:
    """Auto-purge messages from chat rooms that have been idle past the
    configured window. Skipped at runtime when the admin toggle is OFF."""
    from chat_cleanup import clear_idle_rooms
    from routers.settings import get_setting
    try:
        if not await get_setting("auto_clear_idle_rooms", False):
            return
        r = await clear_idle_rooms()
        if r["total_deleted"]:
            logger.info("[scheduler] idle-chat cleanup: %s", r)
    except Exception as e:
        logger.exception("[scheduler] idle-chat cleanup failed: %s", e)



async def _job_purge_deleted_makers() -> None:
    """Hard-delete makers whose 30-day grace window has elapsed.

    Runs daily. For each maker with `deletion_cancels_at <= now`:
      - Purge products (hard delete — the soft-delete flag doesn't matter
        once the whole shop is gone)
      - Purge maker_payouts, dms / threads, design_files, forum posts,
        reviews, maker_applications where email matches
      - Insert an audit row capturing what was purged
      - Remove the maker doc itself

    We deliberately DO NOT purge `payment_transactions` or `orders` — those
    are financial records and must survive for accounting/tax. Instead we
    anonymize the maker_slug on those rows to a tombstone.
    """
    from datetime import datetime, timezone
    from core import db, now_iso
    try:
        now = datetime.now(timezone.utc).isoformat()
        cutoff = await db.makers.find(
            {"deletion_cancels_at": {"$ne": None, "$lte": now}},
            {"_id": 0, "slug": 1, "email": 1, "name": 1},
        ).to_list(500)
        if not cutoff:
            return
        for m in cutoff:
            slug = m["slug"]
            # Child-collection purges.
            products_del = await db.products.delete_many({"maker": slug})
            payouts_del = await db.maker_payouts.delete_many({"maker_slug": slug})
            files_del = await db.design_files.delete_many({"maker_slug": slug})
            threads_del = await db.dm_threads.delete_many({"maker_slug": slug})
            reviews_del = await db.reviews.delete_many({"maker": slug})
            apps_del = await db.maker_applications.delete_many({"email": m.get("email")}) if m.get("email") else None
            # Financial rows — anonymize, don't delete.
            await db.payment_transactions.update_many(
                {"maker_slug": slug},
                {"$set": {"maker_slug": f"__deleted__{slug}"}},
            )
            # Finally, the maker doc itself.
            await db.makers.delete_one({"slug": slug})
            await db.admin_audit.insert_one({
                "id": __import__("uuid").uuid4().hex,
                "kind": "maker_purged",
                "actor": "scheduler",
                "slug": slug,
                "email": m.get("email"),
                "shop_name": m.get("name"),
                "products_deleted": products_del.deleted_count,
                "payouts_deleted": payouts_del.deleted_count,
                "design_files_deleted": files_del.deleted_count,
                "dm_threads_deleted": threads_del.deleted_count,
                "reviews_deleted": reviews_del.deleted_count,
                "applications_deleted": apps_del.deleted_count if apps_del else 0,
                "created_at": now_iso(),
            })
            logger.info("[scheduler] purged maker %s after 30-day grace", slug)
    except Exception as e:
        logger.exception("[scheduler] purge_deleted_makers failed: %s", e)




async def _job_auto_boost_best_sellers() -> None:
    """Auto-boost best-selling listings for opted-in makers.

    For each maker with `auto_boost_enabled=true`:
      1. Find their published listings with order count in the last 30
         days >= `auto_boost_min_orders_30d` (default 10) AND not currently
         promoted (`promoted_until <= now or null`).
      2. Sort by 30-day order count desc, take top `auto_boost_max_per_run`
         (default 3) and promote each for 1 week ($5).
      3. Increment `auto_boost_total_spent_usd` and stamp `auto_boost_last_run_at`.

    All-or-nothing: a per-maker exception is logged but never blocks
    other makers' runs. Boost charges go to the existing pending-balance
    flow (settled out of the maker's next payout).
    """
    from datetime import datetime, timezone, timedelta
    from core import db
    try:
        cutoff_iso = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        now_iso_v = datetime.now(timezone.utc).isoformat()
        opted_in = await db.makers.find(
            {"auto_boost_enabled": True},
            {"_id": 0, "slug": 1, "auto_boost_min_orders_30d": 1, "auto_boost_max_per_run": 1},
        ).to_list(500)
        if not opted_in:
            return
        promoted_total = 0
        for m in opted_in:
            slug = m["slug"]
            min_orders = m.get("auto_boost_min_orders_30d") or 10
            max_per = m.get("auto_boost_max_per_run") or 3
            try:
                # Aggregate 30d order counts per listing for this maker.
                pipe = [
                    {"$match": {
                        "maker_slug": slug,
                        "status": {"$in": ["succeeded", "succeeded-zero"]},
                        "created_at": {"$gte": cutoff_iso},
                    }},
                    {"$unwind": "$line_items"},
                    {"$group": {"_id": "$line_items.product_slug", "n": {"$sum": "$line_items.quantity"}}},
                    {"$match": {"n": {"$gte": min_orders}}},
                    {"$sort": {"n": -1}},
                    {"$limit": max_per},
                ]
                tops = [r async for r in db.maker_payouts.aggregate(pipe)]
                for row in tops:
                    p_slug = row["_id"]
                    if not p_slug:
                        continue
                    p = await db.products.find_one({"slug": p_slug, "maker": slug, "deleted_at": None}, {"_id": 0, "promoted_until": 1, "status": 1})
                    if not p or p.get("status") != "published":
                        continue
                    if p.get("promoted_until") and p["promoted_until"] > now_iso_v:
                        continue  # already promoted
                    # 1 week boost.
                    end = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
                    await db.products.update_one(
                        {"slug": p_slug, "maker": slug},
                        {"$set": {"promoted_until": end, "auto_boosted": True}},
                    )
                    # Charge to pending balance (mirrors the manual /promote endpoint).
                    await db.maker_pending_charges.insert_one({
                        "id": __import__("uuid").uuid4().hex,
                        "maker_slug": slug,
                        "product_slug": p_slug,
                        "amount_cents": 500,
                        "kind": "auto_boost",
                        "weeks": 1,
                        "created_at": now_iso_v,
                    })
                    await db.makers.update_one(
                        {"slug": slug},
                        {"$inc": {"auto_boost_total_spent_usd": 5}},
                    )
                    promoted_total += 1
                # Stamp last-run timestamp regardless of how many promoted.
                await db.makers.update_one(
                    {"slug": slug},
                    {"$set": {"auto_boost_last_run_at": now_iso_v}},
                )
            except Exception as e:
                logger.exception("[scheduler] auto_boost failed for maker %s: %s", slug, e)
        if promoted_total:
            logger.info("[scheduler] auto-boosted %d listings across %d makers", promoted_total, len(opted_in))
    except Exception as e:
        logger.exception("[scheduler] auto_boost_best_sellers failed: %s", e)

async def _job_apply_scheduled_toggles() -> None:
    """Honor admin-set scheduled flips for `maintenance_mode`. Runs every
    minute; cheap (single Mongo doc read). Once a scheduled time passes,
    we flip the flag and clear the schedule field so it doesn't re-fire."""
    from datetime import datetime, timezone
    from core import db, now_iso
    try:
        s = await db.site_settings.find_one({"_id": "global"})
        if not s:
            return
        now = datetime.now(timezone.utc)
        updates: dict = {}
        on_at = s.get("maintenance_scheduled_on")
        off_at = s.get("maintenance_scheduled_off")
        for field, target_state in (
            ("maintenance_scheduled_on", True),
            ("maintenance_scheduled_off", False),
        ):
            iso = s.get(field)
            if not iso:
                continue
            try:
                # Accept both "Z" and offset-aware strings.
                t = datetime.fromisoformat(iso.replace("Z", "+00:00"))
                if t.tzinfo is None:
                    t = t.replace(tzinfo=timezone.utc)
            except Exception:
                logger.warning("[scheduler] bad scheduled timestamp on %s: %r", field, iso)
                updates[field] = None
                continue
            if t <= now:
                updates["maintenance_mode"] = target_state
                updates[field] = None
                updates["updated_at"] = now_iso()
                updates["updated_by"] = "scheduler"
                logger.info(
                    "[scheduler] toggled maintenance_mode=%s "
                    "(scheduled by admin for %s)", target_state, iso,
                )
        if updates:
            await db.site_settings.update_one(
                {"_id": "global"}, {"$set": updates}, upsert=True,
            )
    except Exception as e:
        logger.exception("[scheduler] scheduled-toggles failed: %s", e)


async def _job_shipping_invoices_weekly() -> None:
    """Monday 10:00 UTC — roll up each maker's unbilled shipping ledger
    rows into a Stripe invoice. See shipping_invoicing.py for details."""
    try:
        from shipping_invoicing import run_weekly_shipping_invoices
        summary = await run_weekly_shipping_invoices(dry_run=False)
        logger.info(
            "[scheduler] shipping_invoices_weekly scanned=%d invoiced=%d cents=%d skipped=%d",
            summary["scanned_makers"], summary["invoiced_makers"],
            summary["invoiced_cents"], len(summary["skipped"]),
        )
    except Exception as e:
        logger.exception("[scheduler] shipping_invoices_weekly failed: %s", e)


async def _job_prod_health_watchdog() -> None:
    """Every 5 min — poll a short list of critical prod endpoints and
    fire one-shot email alerts when any crosses the failure threshold.
    Self-audit safe: skips itself when we're already on the prod host.
    See /app/backend/prod_health.py for full logic."""
    try:
        from prod_health import run_prod_health_checks
        r = await run_prod_health_checks()
        if not r.get("ran"):
            return
        if r.get("failing_count"):
            logger.warning("[scheduler] prod_health_watchdog · failing=%d target=%s",
                           r["failing_count"], r.get("target"))
    except Exception as e:
        logger.exception("[scheduler] prod_health_watchdog failed: %s", e)


def start_scheduler() -> AsyncIOScheduler | None:
    """Boot the scheduler if SCHEDULER_ENABLED isn't 'false'."""
    global _scheduler
    if os.environ.get("SCHEDULER_ENABLED", "true").lower() in ("false", "0", "no"):
        logger.info("[scheduler] disabled via SCHEDULER_ENABLED env")
        return None
    if _scheduler is not None:
        return _scheduler

    sched = AsyncIOScheduler(timezone="UTC")
    sched.add_job(_job_expire_listings, CronTrigger(hour=3, minute=10),
                  id="expire_listings", replace_existing=True)
    sched.add_job(_job_r2_orphan_sweep, CronTrigger(day_of_week="sun", hour=4, minute=0),
                  id="r2_orphan_sweep", replace_existing=True)
    sched.add_job(_job_plus_roi_digest, CronTrigger(day=1, hour=14, minute=0),
                  id="plus_roi_digest", replace_existing=True)
    # Idle-chat cleanup runs every 10 min; the job itself early-returns when
    # the auto_clear_idle_rooms toggle is OFF, so no need to redeploy to switch.
    sched.add_job(_job_clear_idle_chat, CronTrigger(minute="*/10"),
                  id="clear_idle_chat", replace_existing=True)
    # 30-day account-deletion purge — runs once per day. Finds any maker
    # with `deletion_cancels_at <= now` and hard-deletes the maker doc +
    # every orphaned child row (listings, payouts, messages, design files,
    # forum posts, reviews). See `_job_purge_deleted_makers` for details.
    sched.add_job(_job_purge_deleted_makers, CronTrigger(hour=3, minute=30),
                  id="purge_deleted_makers", replace_existing=True)
    # Auto-boost on best-sellers — runs daily at 04:00 UTC. For each maker
    # that opted in (`auto_boost_enabled=true`), promotes up to N listings
    # whose 30-day order count crosses the threshold and aren't currently
    # promoted. $5/wk per listing billed to pending balance.
    sched.add_job(_job_auto_boost_best_sellers, CronTrigger(hour=4, minute=0),
                  id="auto_boost_best_sellers", replace_existing=True)


    # Scheduled site-switches run every minute (1-min granularity is enough
    # for maintenance windows); job is dirt-cheap when nothing is scheduled.
    sched.add_job(_job_apply_scheduled_toggles, CronTrigger(minute="*"),
                  id="apply_scheduled_toggles", replace_existing=True)
    # Weekly shipping invoice — Mondays 10:00 UTC. Biweekly makers are
    # gated inside the job (even ISO week only).
    sched.add_job(_job_shipping_invoices_weekly,
                  CronTrigger(day_of_week="mon", hour=10, minute=0),
                  id="shipping_invoices_weekly", replace_existing=True)
    # Prod health watchdog — every 5 min. Pings a short list of critical
    # prod endpoints and emails OPS when any has 2+ consecutive failures.
    # Self-skips when running ON the prod host (would be circular).
    sched.add_job(_job_prod_health_watchdog, CronTrigger(minute="*/5"),
                  id="prod_health_watchdog", replace_existing=True)
    sched.start()
    _scheduler = sched
    logger.info(
        "[scheduler] started · jobs: %s",
        ", ".join(f"{j.id}@{j.trigger}" for j in sched.get_jobs()),
    )
    return sched


def shutdown_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
        logger.info("[scheduler] stopped")
