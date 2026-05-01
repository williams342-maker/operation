"""Admin-facing endpoints for the prod health watchdog.

- GET  /api/admin/prod-health           → snapshot (state per endpoint)
- POST /api/admin/prod-health/check-now → trigger an immediate run

See /app/backend/prod_health.py for the core logic.
"""
from fastapi import APIRouter, Depends

from maker_auth import current_admin
from prod_health import get_prod_health_snapshot, run_prod_health_checks

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
