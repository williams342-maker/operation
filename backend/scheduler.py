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


async def _job_listing_renewal_reminders() -> None:
    """Daily: email makers whose manual-renewal listings expire in 7 days."""
    from revenue import send_listing_expiry_reminders
    try:
        r = await send_listing_expiry_reminders(days_before=7)
        logger.info("[scheduler] listing-renewal reminders: %s", r)
    except Exception as e:
        logger.exception("[scheduler] listing-renewal reminders failed: %s", e)


async def _job_smart_pause_idle_listings() -> None:
    """Daily: auto-pause published listings with zero pageviews in the
    window for makers who opted into Smart Pause."""
    from revenue import smart_pause_idle_listings
    try:
        r = await smart_pause_idle_listings()
        logger.info("[scheduler] smart-pause sweep: %s", r)
    except Exception as e:
        logger.exception("[scheduler] smart-pause sweep failed: %s", e)


async def _job_refresh_gsc_indexing() -> None:
    """Daily: refresh GSC index-status data for stale published listings.
    No-ops gracefully when GSC isn't configured."""
    from revenue import refresh_gsc_indexing_status
    try:
        r = await refresh_gsc_indexing_status(limit=1500)
        logger.info("[scheduler] gsc-indexing refresh: %s", r)
    except Exception as e:
        logger.exception("[scheduler] gsc-indexing refresh failed: %s", e)


async def _job_founders_lifecycle() -> None:
    """Daily Founder maintenance — auto-roll expired Founders to Standard
    and revoke 14-day grace slots that never published a product."""
    from routers.founders import expire_due_founders, release_stale_grace_slots
    try:
        a = await expire_due_founders()
        b = await release_stale_grace_slots()
        logger.info("[scheduler] founders lifecycle: rolled=%s grace_released=%s",
                    a.get("rolled"), b.get("released"))
    except Exception as e:
        logger.exception("[scheduler] founders lifecycle failed: %s", e)


async def _job_veteran_boost_credit() -> None:
    """Monthly cron — top up every veteran-owned maker's $10 boost credit
    on the 1st of each month at 00:05 UTC. Unused credit does not carry
    over; this is a hard reset."""
    from revenue import replenish_veteran_boost_credits, replenish_plus_boost_credits
    try:
        r = await replenish_veteran_boost_credits()
        logger.info("[scheduler] veteran boost credit replenish: %s", r)
        # Same monthly window — top up Plus subscribers' $15 boost credit too.
        p = await replenish_plus_boost_credits()
        logger.info("[scheduler] plus boost credit replenish: %s", p)
    except Exception as e:
        logger.exception("[scheduler] boost credit replenish failed: %s", e)


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


async def _job_abandoned_cart_email() -> None:
    """iter264 — Two-tier email re-engagement (2h reminder, 24h discount).
    Runs hourly, idempotent via `email_attempt_count` on the cart row."""
    from routers.abandoned_cart import fire_abandoned_cart_emails
    try:
        r = await fire_abandoned_cart_emails(first_nudge_hours=2, discount_nudge_hours=24)
        if r.get("sent"):
            logger.info("[scheduler] abandoned-cart email: %s", r)
    except Exception as e:
        logger.exception("[scheduler] abandoned-cart email failed: %s", e)


async def _job_abandoned_cart_sms() -> None:
    """iter267 — Single-shot SMS fallback against carts that already
    received an abandoned-cart email ≥ 24h ago. Reuses the phone the
    buyer gave for receipts/shipping consent (no separate cart-nudge
    opt-in). No-op when Telnyx unconfigured. Runs at :55 hourly."""
    from routers.abandoned_cart import fire_abandoned_cart_sms
    try:
        r = await fire_abandoned_cart_sms(hours_after_email=24)
        if r.get("sent"):
            logger.info("[scheduler] abandoned-cart sms: %s", r)
    except Exception as e:
        logger.exception("[scheduler] abandoned-cart sms failed: %s", e)





async def _job_secrets_rotation_nudge() -> None:
    """Daily sweep over tracked credentials with two-tier nudges:

      • OVERDUE  → high-priority alert (Email + Slack + Discord), re-nudge
        once every 7 days until rotated.
      • DUE_SOON → 14-day pre-warning (Email + Slack), re-nudge once every
        14 days (less noisy than overdue).

    Each row is keyed by `(secret_id, status)` so a row that flips from
    `due_soon` → `overdue` triggers a fresh alert immediately even if the
    last "due_soon" nudge was 3 days ago.

    Idempotency relies on `db.admin_audit_log` rows of kind
    `secret_rotation_nudge` with a `status` field. We never mutate the
    secret itself — only inform the operator.
    """
    import os as _os
    from datetime import datetime, timezone, timedelta
    from core import db
    try:
        from routers.admin_secrets import TRACKED_SECRETS
        from notify_webhook import notify_team

        DUE_SOON_DAYS = 14
        OVERDUE_DEDUP_DAYS = 7
        DUE_SOON_DEDUP_DAYS = 14

        now = datetime.now(timezone.utc)
        rows: dict[str, dict] = {}
        async for r in db.secret_rotations.find(
            {}, {"_id": 0}, sort=[("created_at", -1)],
        ):
            sid = r.get("secret_id")
            if sid and sid not in rows:
                rows[sid] = r

        # Classify each tracked, configured secret by status
        candidates: list[dict] = []
        for spec in TRACKED_SECRETS:
            is_set = any(bool(_os.environ.get(k)) for k in spec["env_keys"])
            if not is_set:
                continue
            last = rows.get(spec["id"])
            if not last:
                candidates.append({
                    "id": spec["id"], "label": spec["label"],
                    "category": spec["category"], "rotation_url": spec["rotation_url"],
                    "status": "overdue",  # untracked secrets default to overdue
                    "days_overdue": "unknown", "days_until_due": None,
                })
                continue
            try:
                rotated_dt = datetime.fromisoformat(last["created_at"])
            except Exception:
                continue
            next_due = rotated_dt + timedelta(days=spec["cadence_days"])
            delta_days = (next_due - now).days
            if delta_days < 0:
                candidates.append({
                    "id": spec["id"], "label": spec["label"],
                    "category": spec["category"], "rotation_url": spec["rotation_url"],
                    "status": "overdue",
                    "days_overdue": abs(delta_days), "days_until_due": delta_days,
                })
            elif delta_days <= DUE_SOON_DAYS:
                candidates.append({
                    "id": spec["id"], "label": spec["label"],
                    "category": spec["category"], "rotation_url": spec["rotation_url"],
                    "status": "due_soon",
                    "days_overdue": None, "days_until_due": delta_days,
                })

        if not candidates:
            return

        # Per-(secret_id, status) dedup
        overdue_cutoff = (now - timedelta(days=OVERDUE_DEDUP_DAYS)).isoformat()
        soon_cutoff = (now - timedelta(days=DUE_SOON_DEDUP_DAYS)).isoformat()
        recent = await db.admin_audit_log.find(
            {"kind": "secret_rotation_nudge",
             "created_at": {"$gte": min(overdue_cutoff, soon_cutoff)}},
            {"_id": 0, "secret_id": 1, "status": 1, "created_at": 1},
        ).to_list(2000)
        already: set[tuple[str, str]] = set()
        for r in recent:
            sid = r.get("secret_id")
            st = r.get("status") or "overdue"  # legacy rows had no status
            ca = r.get("created_at") or ""
            cutoff = overdue_cutoff if st == "overdue" else soon_cutoff
            if sid and ca >= cutoff:
                already.add((sid, st))

        fresh = [c for c in candidates if (c["id"], c["status"]) not in already]
        if not fresh:
            return

        overdue_items = [f for f in fresh if f["status"] == "overdue"]
        soon_items = [f for f in fresh if f["status"] == "due_soon"]

        # ---- Email digest (ops) ----
        ops = (_os.environ.get("OPS_EMAIL") or "").strip()
        if ops:
            try:
                from email_service import _send
                lines: list[str] = []
                if overdue_items:
                    lines.append("OVERDUE — rotate ASAP:")
                    for o in overdue_items:
                        lines.append(f"  - {o['label']} ({o['category']}) — overdue by {o['days_overdue']} days")
                        lines.append(f"    rotate: {o['rotation_url']}")
                    lines.append("")
                if soon_items:
                    lines.append(f"Due within {DUE_SOON_DAYS} days:")
                    for s in soon_items:
                        lines.append(f"  - {s['label']} ({s['category']}) — due in {s['days_until_due']} days")
                        lines.append(f"    rotate: {s['rotation_url']}")
                    lines.append("")
                lines.append("After rotating each one, mark it complete in Admin → Secrets.")
                html = (
                    "<pre style='font-family:ui-monospace,Menlo,Monaco,monospace;"
                    "background:#0a0a0a;color:#e5e5e5;padding:18px;line-height:1.55'>"
                    + "\n".join(lines).replace("<", "&lt;")
                    + "</pre>"
                )
                subj_bits = []
                if overdue_items:
                    subj_bits.append(f"{len(overdue_items)} overdue")
                if soon_items:
                    subj_bits.append(f"{len(soon_items)} due soon")
                await _send(
                    ops,
                    f"[Crafters Market] Credentials: {' / '.join(subj_bits)}",
                    html,
                )
            except Exception as e:
                logger.warning("[scheduler] secrets-nudge email failed: %s", e)

        # ---- Slack/Discord alert (overdue only — high priority) ----
        if overdue_items:
            try:
                fields = [
                    (o["label"], f"{o['category']} · overdue {o['days_overdue']}d")
                    for o in overdue_items[:8]
                ]
                await notify_team(
                    kind="outage",  # bypasses dedup window
                    title=f"🔑 {len(overdue_items)} credential(s) overdue for rotation",
                    summary="Open Admin → Secrets to rotate and mark complete.",
                    fields=fields,
                    link=None,
                )
            except Exception as e:
                logger.warning("[scheduler] secrets-nudge slack/discord failed: %s", e)

        # ---- Audit rows (one per fresh item) ----
        for f in fresh:
            await db.admin_audit_log.insert_one({
                "kind": "secret_rotation_nudge",
                "secret_id": f["id"],
                "label": f["label"],
                "status": f["status"],
                "days_overdue": f["days_overdue"],
                "days_until_due": f["days_until_due"],
                "actor": "scheduler",
                "created_at": now.isoformat(),
            })
        logger.info(
            "[scheduler] secrets nudge: overdue=%d due_soon=%d (sent)",
            len(overdue_items), len(soon_items),
        )
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


async def _job_microsoft_ads_daily_sync() -> None:
    """Daily 04:30 UTC — Microsoft Ads (Bing) campaign metrics sync.
    iter334w. Offset another 30 min from Meta to keep the worker pool
    spread across the night. Skips silently when not connected."""
    try:
        from routers.microsoft_ads_sdk import sync_metrics
        r = await sync_metrics()
        logger.info("[scheduler] microsoft_ads_daily_sync: %s", r)
    except Exception as e:
        logger.exception("[scheduler] microsoft_ads_daily_sync failed: %s", e)


async def _job_weekly_roas_digest() -> None:
    """Mondays 13:00 UTC (~6am Pacific) — combined paid-channel ROAS
    digest emailed to OPS_EMAIL. iter334y. Idempotent on ISO week."""
    try:
        from routers.roas_digest import run_weekly_roas_digest
        r = await run_weekly_roas_digest()
        logger.info("[scheduler] weekly_roas_digest: %s", r)
    except Exception as e:
        logger.exception("[scheduler] weekly_roas_digest failed: %s", e)


async def _job_listing_budgets_renew() -> None:
    """iter315 — Daily 03:30 UTC. Resets MTD spend on the 1st of each
    month + auto-renews $5/wk boosts on listings whose maker-set
    budget still has headroom. Idempotent within the day (skips
    listings whose `promoted_until` is >24h out)."""
    try:
        from routers.listing_budgets import renew_listing_budgets_tick
        r = await renew_listing_budgets_tick()
        logger.info("[scheduler] listing_budgets_renew: %s", r)
    except Exception as e:
        logger.exception("[scheduler] listing_budgets_renew failed: %s", e)


async def _job_lead_magnet_drip() -> None:
    """iter316b — Daily 14:30 UTC. Walks `lead_magnet_subscribers` and
    sends day-3 / day-7 nurture emails to opted-in subscribers. See
    `lead_magnet_drip.py` for sequence + suppression rules."""
    try:
        from lead_magnet_drip import run_drip_tick
        r = await run_drip_tick(dry_run=False)
        logger.info("[scheduler] lead_magnet_drip: %s", r)
    except Exception as e:
        logger.exception("[scheduler] lead_magnet_drip failed: %s", e)



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


async def _job_maker_pricing_digest() -> None:
    """Weekly Monday 15:00 UTC — for each maker with one or more
    listings priced 20%+ above the AI-derived market median (from the
    `price_comparisons` collection populated by the AI Price Check
    tool), send a single digest email summarizing the flagged items.
    Idempotent on ISO week via `pricing_digest_log`. Maker can opt out
    via `maker.pricing_digest_opt_out: true`. Runs one hour after the
    journal digest so we don't clash on Mailgun send-rate."""
    try:
        from routers.pricing_digest import run_weekly_pricing_digest
        r = await run_weekly_pricing_digest()
        logger.info("[scheduler] maker_pricing_digest: %s", r)
    except Exception as e:
        logger.exception("[scheduler] maker_pricing_digest failed: %s", e)


async def _job_social_momentum_digest() -> None:
    """Weekly Monday 14:30 UTC — for each maker whose listings collected
    one or more public Share-button clicks in the past 7 days, send a
    single email summarising the activity + a CTA to keep the loop
    going. Honors `social_momentum_opt_out` on the maker doc. ISO-week
    deduped via `social_momentum_sent_at`. Quiet on zero (no email
    when total_shares=0 for that maker)."""
    try:
        from social_momentum import run_weekly_social_momentum_digest
        r = await run_weekly_social_momentum_digest()
        logger.info("[scheduler] social_momentum_digest: %s", r)
    except Exception as e:
        logger.exception("[scheduler] social_momentum_digest failed: %s", e)


async def _job_personalization_orphan_cleanup() -> None:
    """Daily 03:45 UTC — delete R2 personalization images uploaded by
    buyers who never checked out (orphans older than 7 days). Without
    this, every abandoned cart leaks a 5-MB file into R2 forever.
    Idempotent — safe to re-run within the same hour."""
    try:
        from personalization_cleanup import run_personalization_orphan_cleanup
        r = await run_personalization_orphan_cleanup()
        logger.info("[scheduler] personalization_orphan_cleanup: %s", r)
    except Exception as e:
        logger.exception("[scheduler] personalization_orphan_cleanup failed: %s", e)




async def _job_weekly_forum_thread():
    """Seeds 1 fresh forum thread + 1-2 starter replies every Tuesday.
    Slow drip (one new topic per week) keeps the forum looking
    actively cultivated without ever spamming the board. Topics pull
    long-tail organic SEO traffic over time. Idempotent — bails if
    the topic bank is exhausted or the LLM call fails."""
    try:
        from weekly_forum_seeder import seed_weekly_thread
        r = await seed_weekly_thread()
        logger.info("[scheduler] weekly_forum_thread: %s", r)
    except Exception as e:
        logger.exception("[scheduler] weekly_forum_thread failed: %s", e)


async def _job_daily_design_file():
    """Adds 1 fresh AI-generated community design file every morning.

    Round-robin picks the least-used parametric template (9 in the
    bank), has Gemini Flash fill in creative copy + params, then writes
    a real SVG + DXF + Nano Banana preview JPG and inserts into the
    `design_files` collection flagged `is_seed=true, ai_generated=true`.

    Slow daily drip means the public Community → Design files library
    keeps compounding without anyone clicking. Safe if Nano Banana is
    temporarily down — the design still lands (preview falls back to
    the SVG itself). Disable per env: SCHEDULER_DAILY_DESIGNS=false.
    """
    if os.environ.get("SCHEDULER_DAILY_DESIGNS", "true").lower() in ("false", "0", "no"):
        logger.info("[scheduler] daily_design_file disabled via env")
        return
    try:
        from design_file_seeder import generate_one_design
        r = await generate_one_design()
        logger.info("[scheduler] daily_design_file ok: %s · %s",
                    r["design"]["template_id"], r["design"]["slug"])
    except Exception as e:
        logger.exception("[scheduler] daily_design_file failed: %s", e)



async def _job_daily_ops_digest():
    """iter263 — Daily ops digest email at 06:00 UTC. Summarizes yesterday
    (GMV, makers, catalog, traffic, reliability, community) in one
    inbox-worthy email to OPS_EMAIL. Disable via OPS_DIGEST_ENABLED=false.
    """
    try:
        from ops_digest import send_daily_digest
        result = await send_daily_digest()
        logger.info("[scheduler] daily_ops_digest: %s", result)
    except Exception as e:
        logger.exception("[scheduler] daily_ops_digest failed: %s", e)



async def _job_daily_clip_seed():
    """Adds 1 fresh Sora-2 generated clip to the public clip feed.

    Mirrors `_job_daily_design_file` but for short-form video. Sora is
    meaningfully slower (~2-5 min per render) and burns more LLM
    budget, so this cron is OPT-IN — disabled by default. Flip
    `SCHEDULER_DAILY_CLIPS=true` to turn it on in production.

    Picks the least-used (category × prompt) combo across 6 categories,
    renders an 8-second vertical 1024×1792 clip, extracts a poster
    frame, then inserts a `clips` row flagged `is_seed=true,
    ai_generated=true`.
    """
    if os.environ.get("SCHEDULER_DAILY_CLIPS", "false").lower() not in ("true", "1", "yes"):
        logger.info("[scheduler] daily_clip_seed disabled (SCHEDULER_DAILY_CLIPS=true to opt in)")
        return
    try:
        from clip_seeder import generate_one_clip
        r = await generate_one_clip(model=os.environ.get("SCHEDULER_DAILY_CLIPS_MODEL", "sora-2"))
        if r.get("status") == "ok":
            logger.info("[scheduler] daily_clip_seed ok: %s · %s",
                        r["clip"]["category"], r["clip"]["slug"])
        else:
            logger.warning("[scheduler] daily_clip_seed soft-fail: %s", r)
    except Exception as e:
        logger.exception("[scheduler] daily_clip_seed failed: %s", e)


async def _job_weekly_seo_ping():
    """Submit the whole sitemap to IndexNow (Bing/Yandex/Naver) AND
    re-submit it to Google Search Console every Monday 06:00 UTC.

    Monday morning UTC is intentional: weekly content drops (forum
    threads, daily design seeds, new featured builds) have all landed
    over the weekend, so this is the highest-leverage moment to ping
    crawlers. Both calls are best-effort — failures log + move on.

    Kill-switch: `SCHEDULER_WEEKLY_SEO=false` (default ON). GSC half
    additionally requires `GSC_ENABLED=1` and an OAuth refresh token —
    if either is missing the function quietly skips that half.
    """
    if os.environ.get("SCHEDULER_WEEKLY_SEO", "true").lower() in ("false", "0", "no"):
        logger.info("[scheduler] weekly_seo_ping disabled via env")
        return
    # ── IndexNow (Bing / Yandex / Naver / Seznam) ─────────────────────
    try:
        from seo_indexnow import ping as indexnow_ping
        r = await indexnow_ping(urls=None, budget=200)
        logger.info("[scheduler] weekly_seo_ping · indexnow: ok=%s submitted=%s",
                    r.get("ok"), r.get("count") or r.get("submitted"))
    except Exception as e:
        logger.exception("[scheduler] weekly_seo_ping · indexnow failed: %s", e)
    # ── Google Search Console sitemap submission ──────────────────────
    try:
        from gsc_client import is_gsc_enabled, submit_sitemap
        if not is_gsc_enabled():
            logger.info("[scheduler] weekly_seo_ping · gsc skipped (GSC_ENABLED not set)")
        else:
            r = await submit_sitemap()
            logger.info("[scheduler] weekly_seo_ping · gsc: %s", r)
    except Exception as e:
        logger.exception("[scheduler] weekly_seo_ping · gsc failed: %s", e)



async def _job_hero_headlines_refresh():
    """Daily refresh of the rotating hero headline pool (iter220). Calls
    Gemini once via `hero_headlines.refresh_pool()` to draft 5 fresh
    variants, dedupes against the existing pool, auto-archives the
    oldest AI variants beyond the target size so the pool never balloons.

    Kill-switch: `SCHEDULER_HERO_HEADLINES=false` (default ON). Best-effort
    — any LLM failure logs and the pool stays unchanged so the hero never
    breaks.
    """
    if os.environ.get("SCHEDULER_HERO_HEADLINES", "true").lower() in ("false", "0", "no"):
        logger.info("[scheduler] hero_headlines_refresh disabled via env")
        return
    try:
        from hero_headlines import refresh_pool
        stats = await refresh_pool()
        logger.info("[scheduler] hero_headlines_refresh · %s", stats)
    except Exception as e:
        logger.exception("[scheduler] hero_headlines_refresh failed: %s", e)




async def _job_social_auto_publish() -> None:
    """Every 15 min — push pending `social_auto_post_queue` rows to
    Instagram / Facebook / Pinterest via `social_publisher`. Self-skips
    when `SOCIAL_AUTO_PUBLISH_ENABLED` env var isn't truthy (default OFF
    for safety — admin opts in once creds are tested via 'Publish now')."""
    try:
        from social_publisher import run_auto_publish_sweep
        r = await run_auto_publish_sweep(limit=25)
        if r.get("ran") and (r.get("published") or r.get("failed")):
            logger.info("[scheduler] social_auto_publish: %s", r)
    except Exception as e:
        logger.exception("[scheduler] social_auto_publish failed: %s", e)


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
    # Listing renewal reminders — runs 09:30 UTC daily, emails makers
    # whose manual-renewal listings expire in 7 days. Auto-renew listings
    # skip this nudge (they're handled silently by expire_listings).
    sched.add_job(_job_listing_renewal_reminders, CronTrigger(hour=9, minute=30),
                  id="listing_renewal_reminders", replace_existing=True)
    # Smart Pause — runs daily at 04:15 UTC (after listing expiry sweep).
    # Auto-flips listings with zero pageviews in the window to draft for
    # opted-in makers. No-op for makers with smart_pause_enabled=false.
    sched.add_job(_job_smart_pause_idle_listings, CronTrigger(hour=4, minute=15),
                  id="smart_pause_idle_listings", replace_existing=True)
    # GSC index-status refresh — daily 05:30 UTC. No-ops without GSC creds.
    sched.add_job(_job_refresh_gsc_indexing, CronTrigger(hour=5, minute=30),
                  id="refresh_gsc_indexing", replace_existing=True)
    # Founders lifecycle — runs at 03:15 UTC daily, right after listing expiry.
    # Auto-rolls regular Founders past 12-month window to Standard, and
    # revokes 14-day grace slots that never published anything.
    sched.add_job(_job_founders_lifecycle, CronTrigger(hour=3, minute=15),
                  id="founders_lifecycle", replace_existing=True)
    # Veteran-owned boost credit replenish — fires at 00:05 UTC on the 1st
    # of each month so the credit lands before any boost activations.
    sched.add_job(_job_veteran_boost_credit, CronTrigger(day=1, hour=0, minute=5),
                  id="veteran_boost_credit", replace_existing=True)
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
    # iter264 — Email arm runs 8 minutes after the push arm so we don't
    # spam buyers in the same minute. Same hourly cadence.
    sched.add_job(_job_abandoned_cart_email, CronTrigger(minute=50),
                  id="abandoned_cart_email", replace_existing=True)
    # iter265 — SMS arm runs at :55 (5 min after email arm). Telnyx
    # unconfigured → no-op.
    sched.add_job(_job_abandoned_cart_sms, CronTrigger(minute=55),
                  id="abandoned_cart_sms", replace_existing=True)
    # Weekly forum thread auto-seeder — Tuesdays 14:00 UTC. Picks one
    # topic from the curated bank, expands it via Gemini Flash into a
    # full thread + 1-2 starter replies. Keeps the forum looking
    # cultivated without spamming the board (1 new thread/week max).
    sched.add_job(_job_weekly_forum_thread, CronTrigger(day_of_week="tue", hour=14, minute=0),
                  id="weekly_forum_thread", replace_existing=True)
    # Daily community design — runs every day at 08:00 UTC. Adds 1 new
    # AI-generated SVG/DXF/JPG bundle to the public design files library
    # so it keeps compounding. Disable per-env via SCHEDULER_DAILY_DESIGNS=false.
    sched.add_job(_job_daily_design_file, CronTrigger(hour=8, minute=0),
                  id="daily_design_file", replace_existing=True)
    # Daily clip seed — opt-in (Sora is paid + slow). Set
    # SCHEDULER_DAILY_CLIPS=true to enable; runs every day at 09:00 UTC,
    # one render off-peak so it doesn't clash with the design cron.
    sched.add_job(_job_daily_clip_seed, CronTrigger(hour=9, minute=0),
                  id="daily_clip_seed", replace_existing=True)
    # Weekly SEO ping — every Monday 06:00 UTC fires IndexNow + GSC
    # sitemap submission. Kill-switch SCHEDULER_WEEKLY_SEO=false (defaults
    # to true). Bing/Yandex/Naver tend to crawl freshly-pinged URLs within
    # hours, so this is the highest-leverage cron we run.
    sched.add_job(_job_weekly_seo_ping, CronTrigger(day_of_week="mon", hour=6, minute=0),
                  id="weekly_seo_ping", replace_existing=True)
    # iter220 — Daily hero headline pool refresh (Gemini drafts via universal LLM key).
    sched.add_job(_job_hero_headlines_refresh, CronTrigger(hour=9, minute=15),
                  id="hero_headlines_refresh", replace_existing=True)
    # iter263 — Daily ops digest email at 06:00 UTC. Single inbox-worthy
    # view of yesterday: GMV, makers, catalog, traffic, reliability,
    # community. Disable via OPS_DIGEST_ENABLED=false.
    sched.add_job(_job_daily_ops_digest, CronTrigger(hour=6, minute=0),
                  id="daily_ops_digest", replace_existing=True)
    # Secrets rotation nudge — daily at 09:30 UTC. Two-tier:
    #   • 14-day pre-warning (due_soon) → email + Slack
    #   • Overdue → email + Slack + Discord (high priority)
    # Dedup: 14d for due_soon, 7d for overdue, keyed per (secret, status).
    sched.add_job(_job_secrets_rotation_nudge,
                  CronTrigger(hour=9, minute=30),
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
    # Maker social-momentum digest — Mondays 14:30 UTC (30 min after the
    # journal digest so the two emails don't land in the same delivery
    # batch and overwhelm a maker's inbox on Monday afternoon). Quiet
    # on zero — makers with no shares get no email. Opt-out honored.
    sched.add_job(_job_social_momentum_digest,
                  CronTrigger(day_of_week="mon", hour=14, minute=30),
                  id="social_momentum_digest", replace_existing=True)
    # Daily personalization-image orphan cleanup — 03:45 UTC. Drops R2
    # keys + DB rows for buyer uploads that never made it onto an order
    # after 7 days. Cheap (single Mongo query + N small R2 deletes).
    sched.add_job(_job_personalization_orphan_cleanup,
                  CronTrigger(hour=3, minute=45),
                  id="personalization_orphan_cleanup", replace_existing=True)
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
    # Microsoft Ads daily metrics sync — 04:30 UTC. iter334w. Offset
    # another 30 min from Meta to space out the network calls.
    sched.add_job(_job_microsoft_ads_daily_sync,
                  CronTrigger(hour=4, minute=30),
                  id="microsoft_ads_daily_sync", replace_existing=True)
    # Weekly ROAS digest email — Mondays 13:00 UTC (~6am Pacific).
    # iter334y. Idempotent on ISO week so a process restart-on-Monday
    # doesn't double-send.
    sched.add_job(_job_weekly_roas_digest,
                  CronTrigger(day_of_week="mon", hour=13, minute=0),
                  id="weekly_roas_digest", replace_existing=True)
    # Weekly maker-journal digest — Monday 14:00 UTC (≈ 9am ET / 6am PT
    # — buyers tend to read on the train/over coffee, not 2am). Sends
    # one email per (maker, follower) pair summarizing all of that
    # maker's posts from the trailing 7 days. Idempotent on ISO week.
    sched.add_job(_job_maker_journal_digest,
                  CronTrigger(day_of_week="mon", hour=14, minute=0),
                  id="maker_journal_digest", replace_existing=True)

    # iter334c — Weekly AI pricing digest. Monday 15:00 UTC so it's a
    # safe 1h after the journal digest. One email per maker with any
    # listings priced 20%+ above AI-derived market median. Idempotent
    # on ISO week via `pricing_digest_log`. Maker opt-out via
    # `maker.pricing_digest_opt_out: true`.
    sched.add_job(_job_maker_pricing_digest,
                  CronTrigger(day_of_week="mon", hour=15, minute=0),
                  id="maker_pricing_digest", replace_existing=True)

    # iter251 — nightly Buffer auto-pick. REMOVED iter252 (Buffer replaced by EnrichLabs).
    # iter273 — Social auto-publish sweep every 15 min. Self-skips when
    # SOCIAL_AUTO_PUBLISH_ENABLED is not truthy. Admin must explicitly
    # opt in once Meta/Pinterest creds are wired + verified via
    # "Publish now" from the queue UI.
    sched.add_job(_job_social_auto_publish, CronTrigger(minute="*/15"),
                  id="social_auto_publish", replace_existing=True)
    # iter315 — per-listing marketing budgets: daily 03:30 UTC tick
    # rolls month-start counters AND auto-renews $5/wk boosts on
    # listings that still have budget for the calendar month.
    sched.add_job(_job_listing_budgets_renew, CronTrigger(hour=3, minute=30),
                  id="listing_budgets_renew", replace_existing=True)
    # iter316b — Lead-magnet drip nurture sequence (day-3, day-7).
    # 14:30 UTC = 10:30 ET / 07:30 PT — typical "afternoon coffee"
    # open window. Per-subscriber `drip_step` + RESEND_GUARD_HOURS
    # make a re-run within 24h a no-op for the same row.
    sched.add_job(_job_lead_magnet_drip, CronTrigger(hour=14, minute=30),
                  id="lead_magnet_drip", replace_existing=True)
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
