"""Tests for startup_seo.run_startup_seo_submit (iter274).

Covers:
  1. Kill-switch via SCHEDULER_STARTUP_SEO=false
  2. Restart-storm guard (skip if last submit < 6h ago)
  3. Fires both IndexNow + GSC when neither has been called recently
  4. Persists `last_submitted_at` in system_state after a successful run
  5. Survives a failing GSC half (IndexNow still pings + still stamps)
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest

from core import db
import startup_seo


async def _clear():
    await db.system_state.delete_many({"_id": startup_seo.STATE_KEY})


# ───────────────── 1. Kill-switch ─────────────────
@pytest.mark.asyncio
async def test_disabled_via_env(monkeypatch):
    await _clear()
    monkeypatch.setenv("SCHEDULER_STARTUP_SEO", "false")
    r = await startup_seo.run_startup_seo_submit()
    assert r == {"ran": False, "reason": "disabled"}


# ───────────────── 2. Restart-storm guard ─────────────────
@pytest.mark.asyncio
async def test_throttled_when_last_submit_recent(monkeypatch):
    await _clear()
    monkeypatch.setenv("SCHEDULER_STARTUP_SEO", "true")
    monkeypatch.setenv("STARTUP_SEO_MIN_HOURS", "6")
    # Stamp a "1 hour ago" submit → throttled
    recent = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    await db.system_state.update_one(
        {"_id": startup_seo.STATE_KEY},
        {"$set": {"last_submitted_at": recent}}, upsert=True,
    )
    r = await startup_seo.run_startup_seo_submit()
    assert r["ran"] is False
    assert r["reason"] == "throttled"
    assert r["last_submitted_at"] == recent
    await _clear()


@pytest.mark.asyncio
async def test_runs_when_last_submit_outside_window(monkeypatch):
    await _clear()
    monkeypatch.setenv("SCHEDULER_STARTUP_SEO", "true")
    monkeypatch.setenv("STARTUP_SEO_MIN_HOURS", "6")
    old = (datetime.now(timezone.utc) - timedelta(hours=8)).isoformat()
    await db.system_state.update_one(
        {"_id": startup_seo.STATE_KEY},
        {"$set": {"last_submitted_at": old}}, upsert=True,
    )
    with patch("seo_indexnow.ping", new_callable=AsyncMock) as p_indexnow, \
         patch("gsc_client.is_gsc_enabled", return_value=False):
        p_indexnow.return_value = {"ok": True, "count": 7}
        r = await startup_seo.run_startup_seo_submit()
    assert r["ran"] is True
    p_indexnow.assert_awaited_once()
    await _clear()


# ───────────────── 3. Cold-boot fires both halves ─────────────────
@pytest.mark.asyncio
async def test_cold_boot_fires_indexnow_and_gsc(monkeypatch):
    await _clear()
    monkeypatch.setenv("SCHEDULER_STARTUP_SEO", "true")
    with patch("seo_indexnow.ping", new_callable=AsyncMock) as p_indexnow, \
         patch("gsc_client.is_gsc_enabled", return_value=True), \
         patch("gsc_client.submit_sitemap", new_callable=AsyncMock) as p_gsc:
        p_indexnow.return_value = {"ok": True, "count": 3}
        p_gsc.return_value = {"ok": True, "sitemap": "https://x/sitemap.xml"}
        r = await startup_seo.run_startup_seo_submit()

    assert r["ran"] is True
    assert r["payload"]["indexnow"]["ok"] is True
    assert r["payload"]["indexnow"]["submitted"] == 3
    assert r["payload"]["gsc"]["ok"] is True
    p_indexnow.assert_awaited_once()
    p_gsc.assert_awaited_once()

    # Verify the state stamp landed so a subsequent boot will throttle
    doc = await db.system_state.find_one({"_id": startup_seo.STATE_KEY}, {"_id": 0})
    assert doc and doc.get("last_submitted_at")
    await _clear()


# ───────────────── 4. GSC failure doesn't break IndexNow ─────────────────
@pytest.mark.asyncio
async def test_gsc_failure_still_stamps_state(monkeypatch):
    await _clear()
    monkeypatch.setenv("SCHEDULER_STARTUP_SEO", "true")
    with patch("seo_indexnow.ping", new_callable=AsyncMock) as p_indexnow, \
         patch("gsc_client.is_gsc_enabled", return_value=True), \
         patch("gsc_client.submit_sitemap",
               side_effect=RuntimeError("boom"), new_callable=AsyncMock):
        p_indexnow.return_value = {"ok": True, "count": 5}
        r = await startup_seo.run_startup_seo_submit()
    assert r["ran"] is True
    assert r["payload"]["indexnow"]["ok"] is True
    assert r["payload"]["gsc"]["ok"] is False
    assert "boom" in (r["payload"]["gsc"].get("error") or "")
    doc = await db.system_state.find_one(
        {"_id": startup_seo.STATE_KEY}, {"_id": 0})
    assert doc and doc.get("last_submitted_at")
    await _clear()


# ───────────────── 5. GSC not configured → soft-skip ─────────────────
@pytest.mark.asyncio
async def test_gsc_not_configured_soft_skip(monkeypatch):
    await _clear()
    monkeypatch.setenv("SCHEDULER_STARTUP_SEO", "true")
    with patch("seo_indexnow.ping", new_callable=AsyncMock) as p_indexnow, \
         patch("gsc_client.is_gsc_enabled", return_value=False):
        p_indexnow.return_value = {"ok": True, "count": 12}
        r = await startup_seo.run_startup_seo_submit()
    assert r["ran"] is True
    assert r["payload"]["gsc"] == {"ok": False, "reason": "not_configured"}
    await _clear()
