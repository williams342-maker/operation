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


# ── iter462b — Marketplace Facilitator Tax verification (P4 ops task) ───
# Queries Stripe Tax with the pod's effective key and reports whether
# marketplace-facilitator sales tax is actually being calculated,
# collected, and registered per state. Run this on PRODUCTION (real
# sk_live key) — the preview pod only has the Emergent placeholder.
@router.get("/admin/tax/verification")
async def admin_tax_verification(_: dict = Depends(current_admin)):
    import os
    import stripe as stripe_sdk
    from core import STRIPE_API_KEY

    key = STRIPE_API_KEY or ""
    mode = ("LIVE" if key.startswith("sk_live_")
            else "TEST" if key.startswith("sk_test_") else "MISSING")
    placeholder = "****" in key
    auto_tax_flag = os.environ.get("STRIPE_AUTOMATIC_TAX", "true").lower() == "true"

    out = {
        "stripe_key_mode": mode,
        "stripe_key_is_placeholder": placeholder,
        "automatic_tax_env_enabled": auto_tax_flag,
        "checkout_integration": (
            "checkout.py enables automatic_tax on every Stripe Checkout session "
            "and silently falls back to a tax-less session only if Stripe rejects "
            "the tax config (e.g. head office not set)."),
        "tax_settings": None,
        "registrations": [],
        "recent_sessions_with_tax": None,
        "recommendations": [],
    }

    if placeholder or mode == "MISSING":
        out["recommendations"].append(
            "This pod has no real Stripe key — run this check on production "
            "(craftersmarket.org) where the live key is injected.")
        return out

    stripe_sdk.api_key = key

    def _sv(obj, *path):
        for k in path:
            obj = getattr(obj, k, None)
            if obj is None:
                return None
        return obj

    try:
        s = stripe_sdk.tax.Settings.retrieve()
        ho = _sv(s, "head_office", "address")
        out["tax_settings"] = {
            "status": _sv(s, "status"),
            "head_office": {
                "line1": _sv(ho, "line1"), "city": _sv(ho, "city"),
                "state": _sv(ho, "state"), "postal_code": _sv(ho, "postal_code"),
                "country": _sv(ho, "country"),
            } if ho else None,
            "default_tax_behavior": _sv(s, "defaults", "tax_behavior"),
            "default_tax_code": _sv(s, "defaults", "tax_code"),
        }
        if _sv(s, "status") != "active":
            out["recommendations"].append(
                "Stripe Tax status is not 'active' — set the head-office address and "
                "defaults at dashboard.stripe.com/settings/tax to activate tax calculation.")
    except Exception as e:
        out["tax_settings"] = {"error": f"{type(e).__name__}: {e}"[:300]}
        out["recommendations"].append(
            "Couldn't read Stripe Tax settings — verify the key has tax scope and "
            "Stripe Tax is enabled on the account.")

    try:
        regs = stripe_sdk.tax.Registration.list(limit=100)
        for r in (getattr(regs, "data", None) or []):
            out["registrations"].append({
                "country": _sv(r, "country"),
                "state": _sv(r, "country_options", "us", "state"),
                "status": _sv(r, "status"), "active_from": _sv(r, "active_from"),
            })
        if not out["registrations"]:
            out["recommendations"].append(
                "No tax registrations on file — without state registrations Stripe Tax "
                "calculates $0 tax everywhere. Add registrations for states where you have "
                "nexus at dashboard.stripe.com/tax/registrations.")
    except Exception as e:
        out["registrations"] = [{"error": f"{type(e).__name__}: {e}"[:300]}]

    # Spot-check: did the most recent checkout sessions actually carry tax?
    try:
        sessions = stripe_sdk.checkout.Session.list(limit=10)
        rows = []
        for cs in (getattr(sessions, "data", None) or []):
            rows.append({
                "id": _sv(cs, "id"), "status": _sv(cs, "payment_status"),
                "automatic_tax_enabled": _sv(cs, "automatic_tax", "enabled"),
                "automatic_tax_status": _sv(cs, "automatic_tax", "status"),
                "amount_tax_cents": _sv(cs, "total_details", "amount_tax"),
                "amount_total_cents": _sv(cs, "amount_total"),
            })
        out["recent_sessions_with_tax"] = rows
        enabled = [r for r in rows if r["automatic_tax_enabled"]]
        if rows and not enabled:
            out["recommendations"].append(
                "Recent checkout sessions were created WITHOUT automatic_tax — the "
                "tax-less fallback is firing. Fix the Stripe Tax settings issue above.")
    except Exception as e:
        out["recent_sessions_with_tax"] = [{"error": f"{type(e).__name__}: {e}"[:300]}]

    if not out["recommendations"]:
        out["recommendations"].append(
            "All good — Stripe Tax is active, registrations are on file, and recent "
            "sessions carried automatic tax. Marketplace-facilitator remittance is "
            "handled by Stripe for registered states.")
    return out
