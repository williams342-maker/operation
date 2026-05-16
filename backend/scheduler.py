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


async def _job_auto_renew_promotions() -> None:
    """Hourly: extend any auto-renew-flagged promotion that lapses in the
    next 6 hours. Plus members renew free; everyone else gets the standard
    $5/wk fee accrued."""
    from revenue import auto_renew_due_promotions
    try:
        r = await auto_renew_due_promotions(window_hours=6)
        if r["renewed"]:
            logger.info("[scheduler] promotion auto-renew: %s", r)
    except Exception as e:
        logger.exception("[scheduler] promotion auto-renew failed: %s", e)


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




async def _job_abandoned_cart_push() -> None:
    """Hourly: push the buyers who walked away from their cart >6h ago.
    See `routers/abandoned_cart.py:fire_abandoned_cart_pushes`."""
    from routers.abandoned_cart import fire_abandoned_cart_pushes
    try:
        r = await fire_abandoned_cart_pushes(idle_hours=6)
        if r.get("sent"):
            logger.info("[scheduler] abandoned-cart push: %s", r)
    except Exception as e:
        logger.exception("[scheduler] abandoned-cart push failed: %s", e)



async def _job_secrets_rotation_nudge() -> None:
    """Weekly sweep over tracked credentials: for every overdue secret,
    email OPS_EMAIL once per week and write an admin_audit_log row.

    Idempotency: don't re-nudge the same `secret_id` if a nudge row was
    already written within the last 7 days. Prevents the weekly cron
    from spam-pinging the same admin every Monday.
    """
    import os as _os
    from datetime import datetime, timezone, timedelta
    from core import db
    try:
        from routers.admin_secrets import TRACKED_SECRETS

        now = datetime.now(timezone.utc)
        rows: dict[str, dict] = {}
        async for r in db.secret_rotations.find(
            {}, {"_id": 0}, sort=[("created_at", -1)],
        ):
            sid = r.get("secret_id")
            if sid and sid not in rows:
                rows[sid] = r

        overdue: list[dict] = []
        for spec in TRACKED_SECRETS:
            is_set = any(bool(_os.environ.get(k)) for k in spec["env_keys"])
            if not is_set:
                continue
            last = rows.get(spec["id"])
            if not last:
                overdue.append({"id": spec["id"], "label": spec["label"],
                                "category": spec["category"], "days_overdue": "unknown",
                                "rotation_url": spec["rotation_url"]})
                continue
            try:
                rotated_dt = datetime.fromisoformat(last["created_at"])
            except Exception:
                continue
            next_due = rotated_dt + timedelta(days=spec["cadence_days"])
            if next_due < now:
                overdue.append({
                    "id": spec["id"], "label": spec["label"],
                    "category": spec["category"],
                    "days_overdue": (now - next_due).days,
                    "rotation_url": spec["rotation_url"],
                })

        if not overdue:
            return

        cutoff_iso = (now - timedelta(days=7)).isoformat()
        recent_nudges = await db.admin_audit_log.find(
            {"kind": "secret_rotation_nudge", "created_at": {"$gte": cutoff_iso}},
            {"_id": 0, "secret_id": 1},
        ).to_list(500)
        already = {r.get("secret_id") for r in recent_nudges}
        fresh = [o for o in overdue if o["id"] not in already]
        if not fresh:
            return

        ops = (_os.environ.get("OPS_EMAIL") or "").strip()
        if ops:
            try:
                from email_service import _send
                lines = ["The following credentials are overdue for rotation:", ""]
                for o in fresh:
                    lines.append(f"  - {o['label']} ({o['category']}) -- overdue by {o['days_overdue']} days")
                    lines.append(f"    rotate at: {o['rotation_url']}")
                lines.append("")
                lines.append("After rotating each one, mark it complete in Admin -> Secrets.")
                html = (
                    "<pre style='font-family:ui-monospace,Menlo,Monaco,monospace;"
                    "background:#0a0a0a;color:#e5e5e5;padding:18px;line-height:1.55'>"
                    + "\n".join(lines).replace("<", "&lt;")
                    + "</pre>"
                )
                await _send(
                    ops,
                    f"[Crafters Market] {len(fresh)} credential(s) overdue for rotation",
                    html,
                )
            except Exception as e:
                logger.warning("[scheduler] secrets-nudge email failed: %s", e)

        for o in fresh:
            await db.admin_audit_log.insert_one({
                "kind": "secret_rotation_nudge",
                "secret_id": o["id"],
                "label": o["label"],
                "days_overdue": o["days_overdue"],
                "actor": "scheduler",
                "created_at": now.isoformat(),
            })
        logger.info("[scheduler] secrets nudge: emailed %d overdue items", len(fresh))
    except Exception as e:
        logger.exception("[scheduler] secrets rotation nudge failed: %s", e)



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


async def _job_updates_digest() -> None:
    """Daily 09:00 UTC — detect new CHANGELOG entries since the last
    dispatch and email every active subscriber on /updates. No-op when
    nothing is new. See /app/backend/updates_digest.py for full logic."""
    try:
        from updates_digest import run_digest_dispatch
        r = await run_digest_dispatch(trigger="cron")
        if r.get("new_entries"):
            logger.info(
                "[scheduler] updates_digest new=%d sent=%d failed=%d",
                r["new_entries"], r.get("sent", 0), r.get("failed", 0),
            )
    except Exception as e:
        logger.exception("[scheduler] updates_digest failed: %s", e)


async def _job_maker_restock_digest() -> None:
    """Sundays 09:00 UTC — one digest email per maker with an open
    waitlist queue. Idempotent per ISO week. See
    /app/backend/maker_restock_digest.py for full logic."""
    try:
        from maker_restock_digest import run_weekly_restock_digest
        r = await run_weekly_restock_digest(trigger="cron")
        if r.get("makers_notified"):
            logger.info(
                "[scheduler] maker_restock_digest week=%s notified=%d",
                r.get("week"), r["makers_notified"],
            )
    except Exception as e:
        logger.exception("[scheduler] maker_restock_digest failed: %s", e)


async def _job_auto_dormant_reengage() -> None:
    """Tuesdays 14:00 UTC — auto-discount blast to dormant buyers if the
    `auto_dormant_reengage_enabled` toggle is ON. The job itself
    early-returns when the toggle is OFF so flipping the switch in admin
    Settings is enough — no redeploy. Cap of 50 emails per run + a
    30-day per-buyer cool-off prevents fatigue. Tags the cohort in Kit
    as `dormant-buyer-reengaged-auto` (distinct from the manual blast
    tag) so ops can A/B the response curves."""
    try:
        from routers.retention import run_auto_dormant_reengage
        r = await run_auto_dormant_reengage()
        if r.get("ran") and r.get("sent"):
            logger.info(
                "[scheduler] auto_dormant_reengage sent=%d skipped=%d candidates=%d",
                r.get("sent", 0), r.get("skipped", 0), r.get("candidate_count", 0),
            )
    except Exception as e:
        logger.exception("[scheduler] auto_dormant_reengage failed: %s", e)


async def _job_offsite_backup() -> None:
    """Nightly 03:15 UTC — `mongodump --archive --gzip` → R2 with a
    retention sweep on the same job. Self-skips when the
    `auto_offsite_backup_enabled` toggle is OFF. Implementation lives
    in `/app/backend/offsite_backup.py`."""
    try:
        from offsite_backup import run_offsite_backup
        r = await run_offsite_backup()
        if r.get("ran") and r.get("ok"):
            logger.info(
                "[scheduler] offsite_backup ok size_mb=%s duration_s=%s deleted=%d",
                r.get("size_mb"), r.get("duration_s"), len(r.get("deleted_keys", [])),
            )
    except Exception as e:
        logger.exception("[scheduler] offsite_backup failed: %s", e)


async def _job_recovery_drill() -> None:
    """Quarterly DR drill — restores the latest R2 archive into a
    throwaway namespace, runs integrity probes, drops the namespace,
    posts the pass/fail to Slack. Self-skips when
    `auto_recovery_drill_enabled` toggle is OFF. See
    /app/backend/recovery_drill.py for the full implementation."""
    try:
        from recovery_drill import run_recovery_drill
        r = await run_recovery_drill()
        if r.get("ran"):
            logger.info(
                "[scheduler] recovery_drill ok=%s products=%s duration_s=%s",
                r.get("ok"),
                (r.get("counts") or {}).get("products"),
                r.get("duration_s"),
            )
    except Exception as e:
        logger.exception("[scheduler] recovery_drill failed: %s", e)


async def _job_charge_clearing() -> None:
    """Monthly 1st @ 15:00 UTC — sweep Plus makers' pending listing/promo
    fees and bill via Stripe Invoice. Free-tier makers are skipped (their
    fees keep draining sale-by-sale). See /app/backend/charge_clearing.py.
    Self-skips when `auto_charge_clearing_enabled` toggle is OFF (default
    on for Plus, since they explicitly opted into a card on file)."""
    try:
        from routers.settings import get_setting
        if not await get_setting("auto_charge_clearing_enabled", True):
            return
        from charge_clearing import clear_plus_ledger_balances
        r = await clear_plus_ledger_balances(apply=True)
        logger.info(
            "[scheduler] charge_clearing batch=%s invoiced=%d skipped=%d total_cents=%d",
            r["batch"], r["invoiced"], len(r["skipped"]), r["total_cents"],
        )
    except Exception as e:
        logger.exception("[scheduler] charge_clearing failed: %s", e)


async def _job_review_prompts() -> None:
    """Daily 16:00 UTC — sweep orders delivered 7-30 days ago that
    haven't received a review-prompt email yet, and send one. See
    /app/backend/review_prompts.py for the eligibility rules and
    idempotency guards. Self-skips when the
    `auto_review_prompt_enabled` toggle is OFF (default ON)."""
    try:
        from routers.settings import get_setting
        if not await get_setting("auto_review_prompt_enabled", True):
            return
        from review_prompts import run_review_prompts
        r = await run_review_prompts(apply=True)
        logger.info(
            "[scheduler] review_prompts candidates=%d sent=%d skipped=%d errors=%d",
            r["candidate_count"], r["sent"], len(r["skipped"]), len(r["errors"]),
        )
    except Exception as e:
        logger.exception("[scheduler] review_prompts failed: %s", e)


async def _job_google_ads_daily_sync() -> None:
    """Daily 03:30 UTC — pull yesterday's Google Ads campaign metrics
    into `ad_spend` so the admin Ads tab shows live ROAS data. Self-
    skips with a logged "not_connected"/"missing_env" reason when the
    integration isn't wired yet — keeps preview pods quiet."""
    try:
        from routers.google_ads import sync_metrics
        r = await sync_metrics()
        logger.info("[scheduler] google_ads_daily_sync: %s", r)
    except Exception as e:
        logger.exception("[scheduler] google_ads_daily_sync failed: %s", e)


async def _job_meta_ads_daily_sync() -> None:
    """Daily 04:00 UTC — same pattern as google_ads_daily_sync but for
    the Meta Marketing API. Offset 30 min from Google so we don't
    bottleneck the worker pool on the same minute."""
    try:
        from routers.meta_ads import sync_metrics
        r = await sync_metrics()
        logger.info("[scheduler] meta_ads_daily_sync: %s", r)
    except Exception as e:
        logger.exception("[scheduler] meta_ads_daily_sync failed: %s", e)


async def _job_maker_journal_digest() -> None:
    """Weekly Monday 14:00 UTC — for each maker who published one or
    more journal posts in the past 7 days, send a single digest email
    to every buyer who follows them. Idempotent: per (maker, follower)
    we record `journal_digest_sent_at` keyed by ISO week so re-running
    in the same week is a no-op. Re-engages buyers who bought once and
    forgot the maker exists, without polluting inboxes — capped to one
    email per maker per week regardless of post count."""
    try:
        from routers.journal_digest import run_weekly_digest
        r = await run_weekly_digest()
        logger.info("[scheduler] maker_journal_digest: %s", r)
    except Exception as e:
        logger.exception("[scheduler] maker_journal_digest failed: %s", e)




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
    # Auto-renew promoted listings — hourly. For products opted-in via
    # `auto_renew_promotion=true`, extends `promoted_until` by 7 days when
    # it falls inside the next 6-hour window. Plus subscribers comp the
    # week; everyone else accrues $5 to their pending balance.
    sched.add_job(_job_auto_renew_promotions, CronTrigger(minute=12),
                  id="auto_renew_promotions", replace_existing=True)
    # Abandoned-cart push — every hour at :42. Requires buyer to have
    # an email-bound push subscription, so it self-noops for
    # anonymous shoppers.
    sched.add_job(_job_abandoned_cart_push, CronTrigger(minute=42),
                  id="abandoned_cart_push", replace_existing=True)
    # Secrets rotation nudge — every Monday 09:30 UTC. Walks the
    # tracked credentials list, fires an email + audit-log row for
    # any overdue secret. Idempotent within a 7-day window.
    sched.add_job(_job_secrets_rotation_nudge,
                  CronTrigger(day_of_week="mon", hour=9, minute=30),
                  id="secrets_rotation_nudge", replace_existing=True)


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
    # Updates digest — once daily at 09:00 UTC. No-op when no new
    # CHANGELOG entries since last dispatch. Re-engagement nudge for
    # /updates subscribers; bumps DAU and re-surfaces shipped features.
    sched.add_job(_job_updates_digest,
                  CronTrigger(hour=9, minute=0),
                  id="updates_digest", replace_existing=True)
    # Maker restock weekly digest — Sundays 09:00 UTC. One email per
    # maker summarising open waitlist queues. Idempotent per ISO week.
    sched.add_job(_job_maker_restock_digest,
                  CronTrigger(day_of_week="sun", hour=9, minute=0),
                  id="maker_restock_digest", replace_existing=True)
    # Auto dormant-buyer re-engagement — Tuesdays 14:00 UTC (mid-week,
    # mid-afternoon ET = good open rate window). Self-skips when the
    # `auto_dormant_reengage_enabled` toggle is OFF so flipping the
    # switch in admin Settings is enough — no redeploy.
    sched.add_job(_job_auto_dormant_reengage,
                  CronTrigger(day_of_week="tue", hour=14, minute=0),
                  id="auto_dormant_reengage", replace_existing=True)
    # Offsite Mongo backup — nightly 03:15 UTC (low-traffic window).
    # Self-skips when `auto_offsite_backup_enabled` toggle is OFF.
    # Streams the gzipped archive to R2 + sweeps anything older than the
    # configured retention window in the same run.
    sched.add_job(_job_offsite_backup,
                  CronTrigger(hour=3, minute=15),
                  id="offsite_backup", replace_existing=True)
    # Quarterly DR drill — first day of Jan/Apr/Jul/Oct at 04:30 UTC
    # (after that day's offsite_backup has finished and the freshest
    # archive is in R2). Self-skips when toggle is OFF.
    sched.add_job(_job_recovery_drill,
                  CronTrigger(month="1,4,7,10", day=1, hour=4, minute=30),
                  id="recovery_drill", replace_existing=True)
    # Monthly Plus charge-clearing — 1st of month @ 15:00 UTC (an hour
    # after the Plus ROI digest). Bills accrued listing/promo fees to
    # subscribers' card on file via Stripe Invoice. See _job_charge_clearing
    # for details + the auto_charge_clearing_enabled toggle.
    sched.add_job(_job_charge_clearing,
                  CronTrigger(day=1, hour=15, minute=0),
                  id="charge_clearing", replace_existing=True)
    # Daily review-prompt sweep — 16:00 UTC. Sends one nudge per order
    # 7-30 days post-delivery; idempotent via review_prompt_sent_at.
    sched.add_job(_job_review_prompts,
                  CronTrigger(hour=16, minute=0),
                  id="review_prompts", replace_existing=True)
    # Google Ads daily metrics sync — 03:30 UTC. Pulls yesterday's
    # campaign-level spend/clicks/impressions/conversions and upserts
    # into `ad_spend`. Self-skips when not connected or env vars
    # incomplete (logs to `integration_sync_log` for admin visibility).
    sched.add_job(_job_google_ads_daily_sync,
                  CronTrigger(hour=3, minute=30),
                  id="google_ads_daily_sync", replace_existing=True)
    # Meta Ads daily metrics sync — 04:00 UTC. Same pattern as Google
    # Ads; offset 30 min so the two jobs don't squeeze the worker pool
    # together.
    sched.add_job(_job_meta_ads_daily_sync,
                  CronTrigger(hour=4, minute=0),
                  id="meta_ads_daily_sync", replace_existing=True)
    # Weekly maker-journal digest — Monday 14:00 UTC (≈ 9am ET / 6am PT
    # — buyers tend to read on the train/over coffee, not 2am). Sends
    # one email per (maker, follower) pair summarizing all of that
    # maker's posts from the trailing 7 days. Idempotent on ISO week.
    sched.add_job(_job_maker_journal_digest,
                  CronTrigger(day_of_week="mon", hour=14, minute=0),
                  id="maker_journal_digest", replace_existing=True)
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
