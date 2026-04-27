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
    # Scheduled site-switches run every minute (1-min granularity is enough
    # for maintenance windows); job is dirt-cheap when nothing is scheduled.
    sched.add_job(_job_apply_scheduled_toggles, CronTrigger(minute="*"),
                  id="apply_scheduled_toggles", replace_existing=True)
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
