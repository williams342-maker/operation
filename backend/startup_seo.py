"""On-startup sitemap submission (iter274).

Every backend boot doubles as a "deploy hook": we re-submit the sitemap
to Google Search Console + ping IndexNow (Bing / Yandex / Naver / Seznam)
so freshly-shipped content reaches the crawlers within minutes instead of
waiting for the Monday `weekly_seo_ping` cron.

Restart-storm guard:
  • A `system_state/{_id: "startup_seo"}` doc tracks `last_submitted_at`.
  • We skip if the previous startup ping fired < STARTUP_SEO_MIN_HOURS
    ago (default 6h). Protects against supervisor restart loops, hot
    reloads, and rapid back-to-back deploys hammering the crawlers.

Kill-switch:
  • `SCHEDULER_STARTUP_SEO=false` disables this entirely. Default ON.

Best-effort by design — every failure logs + moves on. Never blocks
backend startup.
"""
from __future__ import annotations
from config import env_get

import os
from datetime import datetime, timedelta, timezone

from core import db, logger, now_iso


STATE_KEY = "startup_seo"
DEFAULT_MIN_HOURS = 6


def _min_hours() -> float:
    try:
        return float(env_get("STARTUP_SEO_MIN_HOURS",
                                    str(DEFAULT_MIN_HOURS)))
    except (TypeError, ValueError):
        return DEFAULT_MIN_HOURS


async def _within_guard_window() -> tuple[bool, str | None]:
    """True when the last successful startup-ping was inside the guard
    window. Returns `(throttled, last_iso)`."""
    doc = await db.system_state.find_one(
        {"_id": STATE_KEY}, {"_id": 0, "last_submitted_at": 1})
    last_iso = (doc or {}).get("last_submitted_at")
    if not last_iso:
        return False, None
    try:
        last_dt = datetime.fromisoformat(last_iso.replace("Z", "+00:00"))
        if last_dt.tzinfo is None:
            last_dt = last_dt.replace(tzinfo=timezone.utc)
    except Exception:
        return False, last_iso  # corrupt timestamp → re-submit & overwrite
    cutoff = datetime.now(timezone.utc) - timedelta(hours=_min_hours())
    return last_dt > cutoff, last_iso


async def _stamp_last_submitted(payload: dict) -> None:
    await db.system_state.update_one(
        {"_id": STATE_KEY},
        {"$set": {"last_submitted_at": now_iso(),
                  "last_payload": payload}},
        upsert=True,
    )


async def run_startup_seo_submit() -> dict:
    """One-shot on-deploy submission. Mirrors the body of the weekly
    `_job_weekly_seo_ping` cron but with the restart-storm guard."""
    if (env_get("SCHEDULER_STARTUP_SEO") or "true").lower() in (
        "false", "0", "no",
    ):
        logger.info("[startup_seo] disabled via SCHEDULER_STARTUP_SEO env")
        return {"ran": False, "reason": "disabled"}

    throttled, last_iso = await _within_guard_window()
    if throttled:
        logger.info(
            "[startup_seo] throttled — last submit %s (window=%sh)",
            last_iso, _min_hours(),
        )
        return {"ran": False, "reason": "throttled", "last_submitted_at": last_iso}

    payload: dict = {}

    # ── IndexNow (Bing / Yandex / Naver / Seznam) ──────────────────
    try:
        from seo_indexnow import ping as indexnow_ping
        r = await indexnow_ping(urls=None, budget=200)
        payload["indexnow"] = {"ok": r.get("ok"),
                               "submitted": r.get("count") or r.get("submitted")}
        logger.info("[startup_seo] indexnow: ok=%s submitted=%s",
                    r.get("ok"), payload["indexnow"]["submitted"])
    except Exception as e:
        payload["indexnow"] = {"ok": False, "error": str(e)[:200]}
        logger.exception("[startup_seo] indexnow failed: %s", e)

    # ── Google Search Console sitemap submission ──────────────────
    try:
        from gsc_client import is_gsc_enabled, submit_sitemap
        if not is_gsc_enabled():
            payload["gsc"] = {"ok": False, "reason": "not_configured"}
            logger.info("[startup_seo] gsc skipped (not configured)")
        else:
            r = await submit_sitemap()
            payload["gsc"] = r
            logger.info("[startup_seo] gsc: %s", r)
    except Exception as e:
        payload["gsc"] = {"ok": False, "error": str(e)[:200]}
        logger.exception("[startup_seo] gsc failed: %s", e)

    await _stamp_last_submitted(payload)
    return {"ran": True, "payload": payload}
