"""Iter26 — In-process scheduler boot/shutdown."""
from __future__ import annotations

import pytest


def test_scheduler_disabled_via_env(monkeypatch):
    """SCHEDULER_ENABLED=false must not start the scheduler."""
    import scheduler as sched_mod
    sched_mod._scheduler = None
    monkeypatch.setenv("SCHEDULER_ENABLED", "false")
    result = sched_mod.start_scheduler()
    assert result is None


@pytest.mark.asyncio
async def test_scheduler_registers_three_jobs(monkeypatch):
    """Default boot should register: expire_listings, r2_orphan_sweep, plus_roi_digest."""
    import scheduler as sched_mod
    sched_mod._scheduler = None
    monkeypatch.setenv("SCHEDULER_ENABLED", "true")
    s = sched_mod.start_scheduler()
    try:
        assert s is not None
        ids = {j.id for j in s.get_jobs()}
        assert ids == {"expire_listings", "r2_orphan_sweep", "plus_roi_digest"}
    finally:
        sched_mod.shutdown_scheduler()


@pytest.mark.asyncio
async def test_scheduler_idempotent_on_double_start(monkeypatch):
    """Calling start_scheduler twice should return the same instance, not crash."""
    import scheduler as sched_mod
    sched_mod._scheduler = None
    monkeypatch.setenv("SCHEDULER_ENABLED", "true")
    s1 = sched_mod.start_scheduler()
    s2 = sched_mod.start_scheduler()
    try:
        assert s1 is s2
    finally:
        sched_mod.shutdown_scheduler()
