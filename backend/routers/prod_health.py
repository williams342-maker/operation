"""Admin-facing endpoints for the prod health watchdog.

- GET  /api/admin/prod-health           → snapshot (state per endpoint)
- POST /api/admin/prod-health/check-now → trigger an immediate run

See /app/backend/prod_health.py for the core logic.

Also hosts the admin-only updates digest controls (iter97):
- GET  /api/admin/updates/preview         → who would receive what email now
- POST /api/admin/updates/dispatch        → fire digest immediately (or dry run)
- GET  /api/admin/updates/subscribers.csv → CSV download of subscriber list (iter98)
"""
import csv
import io

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse

from maker_auth import current_admin
from prod_health import get_prod_health_snapshot, run_prod_health_checks
from updates_digest import (
    run_digest_dispatch,
    _entries_since,
    _state as _digest_state,
    _current_latest_iter,
    staleness,
    CHANGELOG_PATH,
)
from core import db

router = APIRouter()


@router.get("/admin/prod-health")
async def admin_prod_health(_: dict = Depends(current_admin)):
    """Return the current state of every watched endpoint.

    Response shape:
      {
        "target": "https://craftersmarket.org",
        "enabled": true,
        "threshold": 2,
        "any_alerted": false,
        "endpoints": [
          {
            "endpoint": "/api/sitemap.xml",
            "url": "...",
            "last_status": 200, "last_ok": true,
            "last_reason": "", "last_latency_ms": 243,
            "last_checked_at": "2026-02-01T...",
            "consecutive_failures": 0, "alerted": false,
            "first_failure_at": null
          }, ...
        ]
      }
    """
    return await get_prod_health_snapshot()


@router.post("/admin/prod-health/check-now")
async def admin_prod_health_check_now(_: dict = Depends(current_admin)):
    """Run the watchdog immediately. Used by the "Check Now" UI button.

    Forces the run even when PROD_WATCHDOG_ENABLED=false so ops can
    validate the probe without unlocking the background cron.
    """
    return await run_prod_health_checks(force=True)


# ============================================================
# Updates digest admin controls (iter97)
# ============================================================
@router.get("/admin/updates/preview")
async def admin_updates_preview(_: dict = Depends(current_admin)):
    """Snapshot of what `dispatch` would do right now: which entries
    are queued (newer than the last-dispatched pointer), how many active
    subscribers there are, and the pointer state.
    Pure read — no emails sent."""
    state = await _digest_state()
    last_iter = state.get("last_dispatched_iter")
    latest_iter = await _current_latest_iter()
    raw = CHANGELOG_PATH.read_text(encoding="utf-8") if CHANGELOG_PATH.exists() else ""
    fresh = _entries_since(raw, last_iter) if raw else []
    active = await db.update_subscribers.count_documents({"unsubscribed_at": None})
    unsubscribed = await db.update_subscribers.count_documents({"unsubscribed_at": {"$ne": None}})
    return {
        "last_dispatched_iter": last_iter,
        "last_dispatched_at": state.get("last_dispatched_at"),
        "latest_changelog_iter": latest_iter,
        "queued_entries": fresh,
        "active_subscribers": active,
        "unsubscribed_count": unsubscribed,
        "would_send": active if fresh else 0,
        # iter98 — surface staleness so the UI can warn operator if
        # the digest hasn't fired in a long time.
        "stale": await staleness(),
    }


@router.post("/admin/updates/dispatch")
async def admin_updates_dispatch(
    dry_run: bool = Query(False, description="If true, return the would-send summary without emailing"),
    force: bool = Query(False, description="If true, ignore the last-dispatched pointer (rare; use for re-send)"),
    _: dict = Depends(current_admin),
):
    """Trigger the digest immediately. Same logic as the daily cron."""
    return await run_digest_dispatch(dry_run=dry_run, force=force, trigger="admin-button")


@router.get("/admin/updates/subscribers.csv")
async def admin_updates_subscribers_csv(_: dict = Depends(current_admin)):
    """CSV export of the full subscriber list — active + unsubscribed.
    Streamed so a 50k-row list doesn't OOM the pod."""
    cursor = db.update_subscribers.find(
        {}, {"_id": 0, "unsubscribe_token": 0},
    ).sort("subscribed_at", -1)
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["email", "name", "subscribed_at", "unsubscribed_at", "joined_at_iter", "status"])
    async for sub in cursor:
        writer.writerow([
            sub.get("email", ""),
            sub.get("name") or "",
            sub.get("subscribed_at", ""),
            sub.get("unsubscribed_at") or "",
            sub.get("joined_at_iter") or "",
            "unsubscribed" if sub.get("unsubscribed_at") else "active",
        ])
    buf.seek(0)
    today = _today_str()
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="subscribers-{today}.csv"'},
    )


def _today_str() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")
