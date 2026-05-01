"""iter93 — Prod health watchdog.

Covers:
  - _should_run gating (env var, self-audit skip)
  - _apply_result state transitions (ok → fail × N → alert fires once → recover → recovery fires once)

Uses `loop_scope="module"` because Motor's AsyncIOMotorClient binds to
the first loop it's used on; per-test loops close the executor and
subsequent DB queries raise `Event loop is closed`.
"""
import os
from unittest.mock import patch, AsyncMock

import pytest


pytestmark = pytest.mark.asyncio(loop_scope="module")


# ---------------------------------------------------------------
# Unit tests on _apply_result alert state machine
# ---------------------------------------------------------------
@pytest.fixture
def prod_health_module():
    """Import inside fixture so patched env vars take effect per test."""
    import prod_health
    import importlib
    return importlib.reload(prod_health)


@pytest.mark.asyncio(loop_scope="module")
async def test_apply_result_fires_outage_after_threshold(prod_health_module):
    """First failure → no alert yet. Second failure → fires once. Third → no duplicate."""
    ph = prod_health_module
    # Clean DB row.
    from core import db
    await db.prod_health_checks.delete_many({"endpoint": "/test-outage"})

    fail = {
        "endpoint": "/test-outage",
        "url": "https://ex.com/test-outage",
        "status": 502,
        "ok": False,
        "reason": "HTTP 502",
        "latency_ms": 100,
        "checked_at": "2026-05-01T00:00:00+00:00",
    }

    with patch.object(ph, "_fire_outage_alert", new=AsyncMock()) as alert:
        await ph._apply_result(fail)
        assert alert.await_count == 0, "1st failure must not alert"

        await ph._apply_result(fail)
        assert alert.await_count == 1, "2nd failure must alert once"

        await ph._apply_result(fail)
        assert alert.await_count == 1, "3rd failure must NOT re-alert"

    row = await db.prod_health_checks.find_one({"endpoint": "/test-outage"}, {"_id": 0})
    assert row["consecutive_failures"] == 3
    assert row["alerted"] is True
    assert row["first_failure_at"] == "2026-05-01T00:00:00+00:00"


@pytest.mark.asyncio(loop_scope="module")
async def test_apply_result_recovery_fires_once_and_clears(prod_health_module):
    """After an alert, a successful probe fires the recovery mail and resets state."""
    ph = prod_health_module
    from core import db
    await db.prod_health_checks.delete_many({"endpoint": "/test-recovery"})

    fail = {
        "endpoint": "/test-recovery",
        "url": "https://ex.com/test-recovery",
        "status": 502, "ok": False, "reason": "HTTP 502",
        "latency_ms": 100, "checked_at": "2026-05-01T00:00:00+00:00",
    }
    ok = {**fail, "status": 200, "ok": True, "reason": "",
          "checked_at": "2026-05-01T00:15:00+00:00"}

    with patch.object(ph, "_fire_outage_alert", new=AsyncMock()), \
         patch.object(ph, "_fire_recovery_alert", new=AsyncMock()) as recover:
        # Push into alerted state.
        await ph._apply_result(fail)
        await ph._apply_result(fail)
        # First OK after alert → recovery mail fires exactly once.
        await ph._apply_result(ok)
        assert recover.await_count == 1
        # Second OK → no duplicate recovery mail.
        await ph._apply_result(ok)
        assert recover.await_count == 1

    row = await db.prod_health_checks.find_one({"endpoint": "/test-recovery"}, {"_id": 0})
    assert row["consecutive_failures"] == 0
    assert row["alerted"] is False
    assert row["first_failure_at"] is None


@pytest.mark.asyncio(loop_scope="module")
async def test_apply_result_4xx_is_not_an_outage(prod_health_module):
    """A 403/404 is reachable — we don't page ops for auth/method glitches."""
    ph = prod_health_module
    from core import db
    await db.prod_health_checks.delete_many({"endpoint": "/test-4xx"})

    r = {
        "endpoint": "/test-4xx",
        "url": "https://ex.com/test-4xx",
        "status": 403, "ok": True, "reason": "",
        "latency_ms": 50, "checked_at": "2026-05-01T00:00:00+00:00",
    }
    with patch.object(ph, "_fire_outage_alert", new=AsyncMock()) as alert:
        await ph._apply_result(r)
        await ph._apply_result(r)
        assert alert.await_count == 0


# ---------------------------------------------------------------
# Gate tests
# ---------------------------------------------------------------
def test_should_run_respects_disabled_flag(prod_health_module):
    ph = prod_health_module
    with patch.dict(os.environ, {"PROD_WATCHDOG_ENABLED": "false"}):
        assert ph._should_run() is False


def test_should_run_skips_when_on_prod_host():
    import importlib
    import prod_health as ph
    env = {
        "PROD_WATCHDOG_ENABLED": "true",
        "PROD_URL": "https://craftersmarket.org",
        "PUBLIC_BACKEND_URL": "https://craftersmarket.org",
    }
    with patch.dict(os.environ, env, clear=False):
        ph = importlib.reload(ph)
        assert ph._should_run() is False


def test_should_run_true_on_preview_pod():
    import importlib
    import prod_health as ph
    env = {
        "PROD_WATCHDOG_ENABLED": "true",
        "PROD_URL": "https://craftersmarket.org",
        "PUBLIC_BACKEND_URL": "https://active-project-4.preview.emergentagent.com",
    }
    with patch.dict(os.environ, env, clear=False):
        ph = importlib.reload(ph)
        assert ph._should_run() is True
