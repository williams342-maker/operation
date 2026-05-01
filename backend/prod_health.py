"""Production health watchdog — runs on the preview pod (always-on).

Every 5 min we poll a short list of critical prod endpoints. State lives
in `prod_health_checks` (one doc per endpoint, keyed by `endpoint`). When
an endpoint crosses the `ALERT_THRESHOLD` consecutive-failure count we
fire a one-shot email to every address in `ADMIN_EMAILS`; when it
recovers we fire a one-shot "recovered" email and reset state.

Design notes:
  - Self-audit-safe: we refuse to watchdog the host we're running on
    (would be circular) — `site_root()` of the current request isn't
    available here, so we rely on the operator-provided `PROD_URL` env
    var (or `PUBLIC_SITE_URL` — which now, thanks to iter92, is always
    the canonical apex).
  - Idempotent: re-running the watchdog yields the same DB state. We
    upsert by `endpoint` so the collection stays small (one doc per path).
  - Non-blocking: httpx timeout is short (8s); total job budget is <1 min.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Optional

import httpx

from core import db, logger, now_iso

# Endpoints we care about. Short list — each check is a real HTTP GET so
# keep it tight to avoid noise on prod logs. Add more sparingly.
CRITICAL_ENDPOINTS: tuple[str, ...] = (
    "/api/sitemap.xml",
    "/api/products?limit=1",
    "/api/makers",
    "/robots.txt",
)
ALERT_THRESHOLD = 2  # fire email after this many consecutive failures
TIMEOUT_SEC = 8.0


def _prod_url() -> Optional[str]:
    """Origin to watchdog. Operator-override via PROD_URL; else fall back
    to PUBLIC_SITE_URL (which is always the canonical apex post-iter92)."""
    raw = (os.environ.get("PROD_URL") or os.environ.get("PUBLIC_SITE_URL") or "").rstrip("/")
    return raw or None


def _should_run() -> bool:
    """Skip if watchdog is disabled OR if we'd end up watchdog'ing ourself.
    Running on prod → we're already down when it matters, can't help."""
    if os.environ.get("PROD_WATCHDOG_ENABLED", "true").lower() in ("false", "0", "no"):
        return False
    target = _prod_url()
    if not target:
        return False
    me = (os.environ.get("PUBLIC_BACKEND_URL") or "").rstrip("/")
    # Only run when we are NOT on the prod host (i.e. we're on preview).
    # If the two happen to match (single-deploy stacks), the watchdog is
    # redundant and we skip — prod outages take the pod with them.
    if me and me == target:
        logger.info("[prod_health] skipped — preview pod == prod pod")
        return False
    return True


async def _fire_outage_alert(endpoint: str, status: int, reason: str):
    """Send a single outage email per transition; swallow failures."""
    try:
        from email_service import send_ops_prod_outage_alert
        await send_ops_prod_outage_alert(endpoint=endpoint, status=status, reason=reason)
    except Exception:
        logger.exception("[prod_health] outage alert email failed for %s", endpoint)
    # iter104 — also fan out to Slack/Discord.
    # iter105 — deep-link operator straight to the prod-health tab.
    try:
        from notify_webhook import notify_team
        site = (os.environ.get("PUBLIC_SITE_URL") or "https://craftersmarket.org").rstrip("/")
        await notify_team(
            kind="outage",
            title=endpoint,
            summary=f"Endpoint **{endpoint}** is failing — {reason or f'HTTP {status}'}",
            fields=[("Status", str(status) if status else "—"), ("Reason", reason or "—")],
            link=f"{site}/admin/dashboard?tab=prod-health",
        )
    except Exception:
        logger.exception("[prod_health] outage webhook fan-out failed for %s", endpoint)


async def _fire_recovery_alert(endpoint: str, downtime_minutes: int):
    try:
        from email_service import send_ops_prod_recovery
        await send_ops_prod_recovery(endpoint=endpoint, downtime_minutes=downtime_minutes)
    except Exception:
        logger.exception("[prod_health] recovery alert email failed for %s", endpoint)
    # iter104 — webhook fan-out for the all-clear.
    # iter105 — deep-link operator straight to the prod-health tab.
    try:
        from notify_webhook import notify_team
        site = (os.environ.get("PUBLIC_SITE_URL") or "https://craftersmarket.org").rstrip("/")
        await notify_team(
            kind="recovery",
            title=endpoint,
            summary=f"Endpoint **{endpoint}** recovered after ~{downtime_minutes} min.",
            fields=[("Downtime", f"~{downtime_minutes} min")],
            link=f"{site}/admin/dashboard?tab=prod-health",
        )
    except Exception:
        logger.exception("[prod_health] recovery webhook fan-out failed for %s", endpoint)


async def _probe(client: httpx.AsyncClient, base: str, path: str) -> dict:
    """Single probe — returns a normalized result row (no DB writes)."""
    url = f"{base}{path}"
    started = datetime.now(timezone.utc)
    status = 0
    reason = ""
    try:
        r = await client.get(url, headers={"Accept": "*/*"}, follow_redirects=True)
        status = r.status_code
        if status >= 500:
            reason = f"HTTP {status}"
    except httpx.TimeoutException:
        reason = "timeout"
    except httpx.RequestError as e:
        reason = f"request_error: {type(e).__name__}"
    except Exception as e:  # defensive
        reason = f"unexpected: {type(e).__name__}: {e}"
    latency_ms = int((datetime.now(timezone.utc) - started).total_seconds() * 1000)
    ok = 200 <= status < 500  # 4xx is "reachable" (auth/method/etc) — not a prod outage
    return {
        "endpoint": path,
        "url": url,
        "status": status,
        "ok": ok,
        "reason": reason,
        "latency_ms": latency_ms,
        "checked_at": started.isoformat(),
    }


async def _apply_result(result: dict) -> None:
    """Merge a single probe result into the state doc, firing alerts on
    threshold transitions. All writes are upserts keyed by endpoint."""
    existing = await db.prod_health_checks.find_one(
        {"endpoint": result["endpoint"]},
        {"_id": 0, "consecutive_failures": 1, "alerted": 1, "first_failure_at": 1},
    ) or {}
    prev_fails = int(existing.get("consecutive_failures") or 0)
    was_alerted = bool(existing.get("alerted"))

    if result["ok"]:
        new_fails = 0
        # Recovery transition — fire once, then clear state.
        if was_alerted:
            downtime_min = 0
            first_iso = existing.get("first_failure_at")
            if first_iso:
                try:
                    first_dt = datetime.fromisoformat(first_iso.replace("Z", "+00:00"))
                    downtime_min = max(
                        1,
                        int((datetime.now(timezone.utc) - first_dt).total_seconds() / 60),
                    )
                except Exception:
                    pass
            await _fire_recovery_alert(result["endpoint"], downtime_min)
        new_alerted = False
        first_failure_at = None
    else:
        new_fails = prev_fails + 1
        first_failure_at = existing.get("first_failure_at") or result["checked_at"]
        new_alerted = was_alerted or new_fails >= ALERT_THRESHOLD
        # Fire only on the transition into the alerted state.
        if not was_alerted and new_alerted:
            await _fire_outage_alert(
                endpoint=result["endpoint"],
                status=result["status"],
                reason=result["reason"] or f"HTTP {result['status']}",
            )

    await db.prod_health_checks.update_one(
        {"endpoint": result["endpoint"]},
        {
            "$set": {
                "endpoint": result["endpoint"],
                "url": result["url"],
                "last_status": result["status"],
                "last_ok": result["ok"],
                "last_reason": result["reason"],
                "last_latency_ms": result["latency_ms"],
                "last_checked_at": result["checked_at"],
                "consecutive_failures": new_fails,
                "alerted": new_alerted,
                "first_failure_at": first_failure_at,
            },
        },
        upsert=True,
    )


async def run_prod_health_checks(*, force: bool = False) -> dict:
    """Run one full round of probes against CRITICAL_ENDPOINTS.

    Returns a summary dict (used by the "Check Now" admin endpoint):
      {"ran": bool, "target": str|None, "results": [...], "fired": {...}}
    """
    if not force and not _should_run():
        return {"ran": False, "reason": "disabled_or_self"}

    target = _prod_url()
    if not target:
        return {"ran": False, "reason": "no_prod_url"}

    results = []
    async with httpx.AsyncClient(timeout=TIMEOUT_SEC) as client:
        for path in CRITICAL_ENDPOINTS:
            res = await _probe(client, target, path)
            await _apply_result(res)
            results.append(res)

    failing = [r for r in results if not r["ok"]]
    logger.info(
        "[prod_health] ran · target=%s · ok=%d fail=%d",
        target, len(results) - len(failing), len(failing),
    )
    return {
        "ran": True,
        "target": target,
        "checked_at": now_iso(),
        "results": results,
        "failing_count": len(failing),
    }


async def get_prod_health_snapshot() -> dict:
    """Admin-facing snapshot — every endpoint with its last known state."""
    rows = await db.prod_health_checks.find(
        {}, {"_id": 0},
    ).sort("endpoint", 1).to_list(100)
    any_alerted = any(r.get("alerted") for r in rows)
    return {
        "target": _prod_url(),
        "enabled": _should_run(),
        "threshold": ALERT_THRESHOLD,
        "any_alerted": any_alerted,
        "endpoints": rows,
    }
