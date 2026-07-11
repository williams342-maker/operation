"""iter444 — Automated Payout Engine (Phase A).

Provider-agnostic orchestration: eligibility, hold periods, skip rules,
scheduling and reporting live HERE; the actual money movement is delegated
to the provider implementation (currently PayPal Payouts via
paypal_payouts._execute_run). Migrating to PayPal Commerce Platform later
only replaces that executor — maker settings, schedules, reports and UI
stay identical.

Safety: runs ONLY when BOTH are true:
  • env  PAYPAL_AUTOPAYOUT_ENABLED=true   (deploy-level approval)
  • admin setting paypal_autopayout_enabled (instant pause/resume toggle)
"""
import os
from datetime import datetime, timedelta, timezone

from core import db, logger, now_iso


def _hold_days() -> int:
    try:
        return int(os.environ.get("PAYPAL_PAYOUT_HOLD_DAYS") or 7)
    except ValueError:
        return 7


PLATFORM_MIN_CENTS = 2500  # $25 — makers may raise, never lower.
FREQUENCIES = ("daily", "weekly", "monthly", "manual")


async def automation_status() -> dict:
    from routers.settings import get_setting
    env_flag = (os.environ.get("PAYPAL_AUTOPAYOUT_ENABLED") or "false").strip().lower() == "true"
    admin_flag = bool(await get_setting("paypal_autopayout_enabled", False))
    return {
        "env_flag": env_flag,
        "admin_flag": admin_flag,
        "enabled": env_flag and admin_flag,
        "hold_days": _hold_days(),
        "platform_min_cents": PLATFORM_MIN_CENTS,
        "schedule": "Daily 3:00 AM Pacific (weekly=Fri, monthly=1st)",
    }


def _due_frequencies(now_pt: datetime) -> set:
    due = {"daily"}
    if now_pt.weekday() == 4:  # Friday
        due.add("weekly")
    if now_pt.day == 1:
        due.add("monthly")
    return due


def maker_payout_settings(m: dict) -> dict:
    method = m.get("payout_method") or ("paypal" if m.get("paypal_email") else "stripe")
    freq = m.get("payout_frequency") or "weekly"
    if freq not in FREQUENCIES:
        freq = "weekly"
    try:
        min_c = max(int(m.get("payout_min_cents") or PLATFORM_MIN_CENTS), PLATFORM_MIN_CENTS)
    except (TypeError, ValueError):
        min_c = PLATFORM_MIN_CENTS
    return {"payout_method": method, "payout_frequency": freq, "payout_min_cents": min_c}


def next_payout_date(freq: str, now: datetime | None = None) -> str | None:
    if freq == "manual":
        return None
    now = now or datetime.now(timezone.utc)
    if freq == "daily":
        nxt = now + timedelta(days=1)
    elif freq == "monthly":
        nxt = (now.replace(day=1) + timedelta(days=32)).replace(day=1)
    else:  # weekly → next Friday
        nxt = now + timedelta(days=((4 - now.weekday()) % 7) or 7)
    return nxt.date().isoformat()


def _past_hold(row: dict, now: datetime) -> bool:
    ts = row.get("earned_at") or row.get("updated_at") or ""
    try:
        earned = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return True  # unparseable → treat as old
    return (now - earned) >= timedelta(days=_hold_days())


async def compute_overview() -> dict:
    """Per-maker + total buckets for the automated engine & admin dashboard:
    eligible / waiting_hold / waiting_minimum / missing_paypal / disputed /
    refund_hold / processing / failed / paid_today / lifetime paid."""
    from routers.paypal_payouts import _ELIGIBLE_STATUSES
    now = datetime.now(timezone.utc)
    today = now.date().isoformat()
    rows = await db.maker_payouts.find({"provider": "paypal"}, {"_id": 0}).to_list(5000)
    slugs = sorted({r["maker_slug"] for r in rows})
    makers = {m["slug"]: m async for m in db.makers.find(
        {"slug": {"$in": slugs}}, {"_id": 0, "slug": 1, "name": 1, "email": 1,
                                   "paypal_email": 1, "payouts_on_hold": 1,
                                   "payout_method": 1, "payout_frequency": 1,
                                   "payout_min_cents": 1})}
    session_ids = list({r["session_id"] for r in rows})
    txs = {t["session_id"]: t async for t in db.payment_transactions.find(
        {"session_id": {"$in": session_ids}},
        {"_id": 0, "session_id": 1, "refund_status": 1, "dispute_id": 1, "dispute_status": 1})}

    out: dict[str, dict] = {}
    for r in rows:
        slug = r["maker_slug"]
        m = makers.get(slug, {})
        st = maker_payout_settings(m)
        e = out.setdefault(slug, {
            "maker_slug": slug, "maker_name": m.get("name") or slug,
            "paypal_email": m.get("paypal_email"),
            "payouts_on_hold": bool(m.get("payouts_on_hold")),
            **st,
            "next_payout_date": next_payout_date(st["payout_frequency"], now),
            "eligible_cents": 0, "waiting_hold_cents": 0, "missing_email_cents": 0,
            "disputed_cents": 0, "refund_hold_cents": 0, "processing_cents": 0,
            "failed_permanent_cents": 0, "paid_cents": 0, "paid_today_cents": 0,
            "eligible_sessions": [], "last_payout_at": None, "waiting_minimum": False,
        })
        cents = int(r.get("amount_cents") or 0)
        status = r.get("status")
        tx = txs.get(r["session_id"])
        if status == "processing":
            e["processing_cents"] += cents
        elif status == "paid":
            e["paid_cents"] += cents
            if (r.get("paid_at") or "").startswith(today):
                e["paid_today_cents"] += cents
            if not e["last_payout_at"] or (r.get("paid_at") or "") > e["last_payout_at"]:
                e["last_payout_at"] = r.get("paid_at")
        elif status in _ELIGIBLE_STATUSES:
            if status == "failed" and r.get("failure_permanent"):
                e["failed_permanent_cents"] += cents
            elif tx and tx.get("dispute_id") and (tx.get("dispute_status") or "").upper() not in (
                    "RESOLVED", "CLOSED", "CANCELLED"):
                e["disputed_cents"] += cents
            elif tx and tx.get("refund_status"):
                e["refund_hold_cents"] += cents
            elif not e["paypal_email"]:
                e["missing_email_cents"] += cents
            elif not _past_hold(r, now):
                e["waiting_hold_cents"] += cents
            else:
                e["eligible_cents"] += cents
                e["eligible_sessions"].append(r["session_id"])

    for e in out.values():
        min_c = max(e["payout_min_cents"], PLATFORM_MIN_CENTS)
        e["waiting_minimum"] = 0 < e["eligible_cents"] < min_c
    maker_list = sorted(out.values(), key=lambda x: -x["eligible_cents"])
    totals = {
        "eligible_today_cents": sum(e["eligible_cents"] for e in maker_list
                                    if not e["waiting_minimum"] and not e["payouts_on_hold"]
                                    and e["payout_method"] == "paypal"),
        "processing_cents": sum(e["processing_cents"] for e in maker_list),
        "paid_today_cents": sum(e["paid_today_cents"] for e in maker_list),
        "failed_cents": sum(e["failed_permanent_cents"] for e in maker_list),
        "waiting_hold_cents": sum(e["waiting_hold_cents"] for e in maker_list),
        "waiting_minimum_cents": sum(e["eligible_cents"] for e in maker_list if e["waiting_minimum"]),
        "missing_paypal_cents": sum(e["missing_email_cents"] for e in maker_list),
        "disputed_cents": sum(e["disputed_cents"] for e in maker_list),
        "refund_hold_cents": sum(e["refund_hold_cents"] for e in maker_list),
    }
    return {"makers": maker_list, "totals": totals, "automation": await automation_status()}


async def recover_stale_runs() -> int:
    """Restart safety: a run that claimed rows but died before reaching PayPal
    leaves rows stuck in `processing`. Roll them back after 1 hour."""
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    stale = await db.paypal_payout_runs.find(
        {"status": "created", "created_at": {"$lt": cutoff}}, {"_id": 0, "id": 1}).to_list(50)
    for run in stale:
        await db.maker_payouts.update_many(
            {"payout_run_id": run["id"], "status": "processing"},
            {"$set": {"status": "deferred", "updated_at": now_iso()},
             "$unset": {"payout_run_id": ""}})
        await db.paypal_payout_runs.update_one(
            {"id": run["id"]}, {"$set": {"status": "failed", "error": "stale run recovered"}})
        logger.warning("[payout-engine] recovered stale run %s", run["id"])
    return len(stale)


async def run_automated_payouts(trigger: str = "cron", dry_run: bool = False,
                                force: bool = False) -> dict:
    """One engine cycle. `force` (admin run-now) bypasses the enable flags and
    frequency-due check — but never the eligibility/skip rules."""
    status = await automation_status()
    if not status["enabled"] and not force:
        return {"ran": False, "reason": "automation_disabled", **status}
    await recover_stale_runs()

    try:
        from zoneinfo import ZoneInfo
        now_pt = datetime.now(ZoneInfo("America/Los_Angeles"))
    except Exception:
        now_pt = datetime.now(timezone.utc)
    due = {"daily", "weekly", "monthly"} if force else _due_frequencies(now_pt)

    ov = await compute_overview()
    items, skipped = [], []

    def skip(e, reason):
        skipped.append({"maker_slug": e["maker_slug"], "reason": reason,
                        "balance_cents": e["eligible_cents"] + e["waiting_hold_cents"]
                        + e["missing_email_cents"] + e["disputed_cents"]
                        + e["refund_hold_cents"]})

    for e in ov["makers"]:
        if e["payouts_on_hold"]:
            skip(e, "on_hold"); continue
        if not e["paypal_email"]:
            if e["missing_email_cents"] > 0:
                skip(e, "missing_paypal_email")
            continue
        if e["payout_method"] != "paypal":
            skip(e, "payout_method_not_paypal"); continue
        if e["payout_frequency"] == "manual":
            skip(e, "manual_schedule"); continue
        if e["payout_frequency"] not in due:
            skip(e, "not_due"); continue
        if e["disputed_cents"] > 0 and e["eligible_cents"] <= 0:
            skip(e, "open_dispute"); continue
        if e["refund_hold_cents"] > 0 and e["eligible_cents"] <= 0:
            skip(e, "pending_refund"); continue
        if e["eligible_cents"] <= 0:
            if e["waiting_hold_cents"] > 0:
                skip(e, "inside_hold_period")
            continue
        min_c = max(e["payout_min_cents"], PLATFORM_MIN_CENTS)
        if e["eligible_cents"] < min_c:
            skip(e, "below_minimum"); continue
        items.append({
            "maker_slug": e["maker_slug"], "maker_name": e["maker_name"],
            "paypal_email": e["paypal_email"], "amount_cents": e["eligible_cents"],
            "sessions": e["eligible_sessions"],
        })

    report = {
        "ran": True, "trigger": trigger, "dry_run": dry_run, "at": now_iso(),
        "due_frequencies": sorted(due),
        "paid_makers": len(items),
        "total_paid_cents": sum(i["amount_cents"] for i in items),
        "skipped": skipped, "failures": [],
        "items": [{k: i[k] for k in ("maker_slug", "paypal_email", "amount_cents")} for i in items],
    }
    if dry_run or not items:
        if not dry_run:
            await _finish_report(report)
        return report

    from routers.paypal_payouts import _execute_run
    import uuid as _uuid
    run_id = "auto-" + _uuid.uuid4().hex[:16]
    try:
        result = await _execute_run(items, run_id, created_by=f"autopayout:{trigger}", kind="auto")
        report["run_id"] = run_id
        report["payout_batch_id"] = result.get("payout_batch_id")
        report["total_paid_cents"] = result.get("total_cents", report["total_paid_cents"])
        report["paid_makers"] = result.get("makers", report["paid_makers"])
    except Exception as e:
        report["failures"].append({"run_id": run_id, "error": str(e)[:300]})
        report["paid_makers"] = 0
        report["total_paid_cents"] = 0
        logger.exception("[payout-engine] auto run failed · %s", e)
    await _finish_report(report)
    return report


async def _finish_report(report: dict) -> None:
    await db.payout_reports.insert_one(dict(report))
    try:
        import email_service
        await email_service.send_admin_payout_report(report)
    except Exception as e:
        logger.warning("[payout-engine] admin report email failed · %s", e)
