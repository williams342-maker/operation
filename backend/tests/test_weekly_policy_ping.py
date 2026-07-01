"""Regression: the weekly_policy_ping scheduler job calls
notify_policy_publish once, never raises on inner failures, and honors
the SCHEDULER_WEEKLY_POLICY_PING kill-switch.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))


@pytest.mark.asyncio
async def test_weekly_policy_ping_calls_notifier(monkeypatch):
    monkeypatch.delenv("SCHEDULER_WEEKLY_POLICY_PING", raising=False)
    from scheduler import _job_weekly_policy_ping

    stub = AsyncMock(return_value={
        "ok": True,
        "url_count": 17,
        "indexnow": {"ok": True, "status": 200},
        "gsc": {"ok": True, "status": 200, "skipped": False},
    })
    with patch("seo_policy_notify.notify_policy_publish", stub):
        await _job_weekly_policy_ping()
    stub.assert_awaited_once()


@pytest.mark.asyncio
async def test_weekly_policy_ping_disabled_via_env(monkeypatch):
    monkeypatch.setenv("SCHEDULER_WEEKLY_POLICY_PING", "false")
    from scheduler import _job_weekly_policy_ping

    stub = AsyncMock()
    with patch("seo_policy_notify.notify_policy_publish", stub):
        await _job_weekly_policy_ping()
    stub.assert_not_awaited()


@pytest.mark.asyncio
async def test_weekly_policy_ping_swallows_exceptions(monkeypatch):
    monkeypatch.delenv("SCHEDULER_WEEKLY_POLICY_PING", raising=False)
    from scheduler import _job_weekly_policy_ping

    stub = AsyncMock(side_effect=RuntimeError("simulated ping crash"))
    with patch("seo_policy_notify.notify_policy_publish", stub):
        # MUST NOT raise — cron ownership contract is best-effort
        await _job_weekly_policy_ping()
    stub.assert_awaited_once()


def test_scheduler_registers_weekly_policy_ping():
    """The scheduler bootstrap must register the weekly_policy_ping job
    with the expected Monday 06:15 UTC schedule."""
    import scheduler as sched_mod
    src = Path(sched_mod.__file__).read_text()
    # Job registration line + schedule sanity
    assert 'id="weekly_policy_ping"' in src
    assert 'day_of_week="mon"' in src
    # 06:15 UTC — parameters on the CronTrigger literal used for the job
    idx = src.find('id="weekly_policy_ping"')
    window = src[max(0, idx - 400): idx + 200]
    assert "hour=6" in window and "minute=15" in window, (
        "weekly_policy_ping cron should fire at 06:15 UTC "
        f"(15 min after weekly_seo_ping). Window:\n{window}"
    )
