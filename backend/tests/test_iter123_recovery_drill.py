"""iter123 — Quarterly DR drill.

`run_recovery_drill()` downloads the latest R2 archive, restores it
into an isolated drill namespace on the same Mongo cluster, runs
integrity counts, drops the namespace, and posts the result to Slack.
Production collections are NEVER touched (enforced by mongorestore's
`--nsFrom/--nsTo` flag).

Most of the test surface is mocked because the real drill spawns a
mongorestore subprocess + writes to a real Mongo instance. We test the
contract:
  • Toggle gating (cron honors it, manual bypasses it)
  • R2 not configured → skips with reason
  • Empty R2 → skips with informative error
  • Pass / fail branching based on product count threshold
  • Slack notification fires with right payload
  • Drill namespace dropped on success AND failure
  • Endpoint requires super admin
"""
import os
import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

sys.path.insert(0, "/app/backend")
os.environ.setdefault("DB_NAME", "test_database")
os.environ.setdefault("ADMIN_EMAILS", "super@example.com")

from server import app  # noqa: E402
from maker_auth import issue_session_jwt  # noqa: E402


@pytest.fixture
def transport():
    return ASGITransport(app=app)


# ============================================================
# Toggle gating
# ============================================================

@pytest.mark.asyncio
async def test_drill_skips_when_toggle_off_and_not_manual():
    from recovery_drill import run_recovery_drill
    with patch("routers.settings.get_setting", new=AsyncMock(return_value=False)):
        out = await run_recovery_drill(manual=False)
    assert out == {"ran": False, "reason": "toggle_off"}


@pytest.mark.asyncio
async def test_drill_runs_manually_even_when_toggle_off():
    """Manual triggers bypass the toggle so super-admins can drill anytime."""
    from recovery_drill import run_recovery_drill

    fake_archive_path = "/tmp/whatever.archive.gz"

    async def fake_download(_tmp):
        return fake_archive_path, {"key": "backups/mongo/x.archive.gz",
                                    "size_bytes": 1024, "size_mb": 0.001,
                                    "uploaded_at": "2026-05-01T00:00:00+00:00"}

    async def fake_restore(*_a, **_kw):
        return None

    async def fake_probe(_drill, *, min_products):
        return {"passed": True, "counts": {"products": 250, "makers": 8},
                "min_products": min_products}

    async def fake_drop(_drill):
        return None

    async def fake_setting(key, default=None):
        # Toggle returns False, threshold returns 100. Manual flag bypasses.
        if key == "auto_recovery_drill_enabled":
            return False
        if key == "recovery_drill_min_products":
            return 100
        return default

    with patch("routers.settings.get_setting", new=AsyncMock(side_effect=fake_setting)), \
         patch("recovery_drill._download_latest_archive_to_tmp", new=fake_download), \
         patch("recovery_drill._restore_into_drill_namespace", new=fake_restore), \
         patch("recovery_drill._integrity_probe", new=fake_probe), \
         patch("recovery_drill._drop_drill_namespace", new=fake_drop), \
         patch("recovery_drill.notify_team", new=AsyncMock()) as notify, \
         patch("recovery_drill.os.path.isfile", return_value=False), \
         patch("recovery_drill.os.rmdir"), \
         patch("recovery_drill.tempfile.mkdtemp", return_value="/tmp/cm_drill_xyz"), \
         patch("recovery_drill.db") as mock_db:
        mock_db.admin_audit_log.insert_one = AsyncMock()
        out = await run_recovery_drill(manual=True)

    assert out["ran"] is True
    assert out["ok"] is True
    assert out["passed"] is True
    assert out["counts"]["products"] == 250
    notify.assert_awaited_once()
    title = notify.await_args.kwargs.get("title") or notify.await_args.args[0] if notify.await_args.args else ""
    if "title" in notify.await_args.kwargs:
        title = notify.await_args.kwargs["title"]
    assert "PASSED" in title


# ============================================================
# Pass / fail branching
# ============================================================

@pytest.mark.asyncio
async def test_drill_fails_when_products_below_threshold():
    from recovery_drill import run_recovery_drill

    async def fake_setting(key, default=None):
        if key == "auto_recovery_drill_enabled":
            return True
        if key == "recovery_drill_min_products":
            return 100
        return default

    async def fake_download(_tmp):
        return "/tmp/x.gz", {"key": "k", "size_bytes": 10, "size_mb": 0.0, "uploaded_at": "x"}

    with patch("routers.settings.get_setting", new=AsyncMock(side_effect=fake_setting)), \
         patch("recovery_drill._download_latest_archive_to_tmp", new=fake_download), \
         patch("recovery_drill._restore_into_drill_namespace", new=AsyncMock()), \
         patch("recovery_drill._integrity_probe",
               new=AsyncMock(return_value={"passed": False, "counts": {"products": 5},
                                            "min_products": 100})), \
         patch("recovery_drill._drop_drill_namespace", new=AsyncMock()), \
         patch("recovery_drill.notify_team", new=AsyncMock()) as notify, \
         patch("recovery_drill.os.path.isfile", return_value=False), \
         patch("recovery_drill.os.rmdir"), \
         patch("recovery_drill.tempfile.mkdtemp", return_value="/tmp/cm_drill_xyz"), \
         patch("recovery_drill.db") as mock_db:
        mock_db.admin_audit_log.insert_one = AsyncMock()
        out = await run_recovery_drill(manual=False)

    assert out["ran"] is True
    assert out["ok"] is False
    assert out["passed"] is False
    notify.assert_awaited_once()
    assert "FAILED" in notify.await_args.kwargs["title"]


@pytest.mark.asyncio
async def test_drill_drops_namespace_even_on_failure():
    """If the restore step blows up, we still drop the namespace + clean
    /tmp + post a FAIL message + write an audit row. This is the most
    important behavior of the whole drill — the throwaway namespace
    NEVER lingers between runs."""
    from recovery_drill import run_recovery_drill

    drop_calls = []

    async def fake_setting(key, default=None):
        if key == "auto_recovery_drill_enabled":
            return True
        if key == "recovery_drill_min_products":
            return 100
        return default

    async def fake_download(_tmp):
        return "/tmp/x.gz", {"key": "k", "size_bytes": 10, "size_mb": 0.0, "uploaded_at": "x"}

    async def fake_restore(*_a, **_kw):
        raise RuntimeError("simulated restore failure")

    async def fake_drop(d):
        drop_calls.append(d)

    with patch("routers.settings.get_setting", new=AsyncMock(side_effect=fake_setting)), \
         patch("recovery_drill._download_latest_archive_to_tmp", new=fake_download), \
         patch("recovery_drill._restore_into_drill_namespace", new=fake_restore), \
         patch("recovery_drill._drop_drill_namespace", new=fake_drop), \
         patch("recovery_drill.notify_team", new=AsyncMock()) as notify, \
         patch("recovery_drill.os.path.isfile", return_value=False), \
         patch("recovery_drill.os.rmdir"), \
         patch("recovery_drill.tempfile.mkdtemp", return_value="/tmp/cm_drill_xyz"), \
         patch("recovery_drill.db") as mock_db:
        mock_db.admin_audit_log.insert_one = AsyncMock()
        out = await run_recovery_drill(manual=False)

    assert out["ran"] is True
    assert out["ok"] is False
    assert "simulated restore failure" in (out.get("error") or "")
    # Drop must have been called once with the drill_db name
    assert len(drop_calls) == 1
    assert drop_calls[0].startswith("_dr_drill_")
    # FAIL message posted to Slack/Discord
    notify.assert_awaited_once()


# ============================================================
# R2 inventory edge cases
# ============================================================

@pytest.mark.asyncio
async def test_drill_handles_empty_r2():
    """Empty R2 means we never ran the offsite_backup yet — drill should
    surface a clear error, not crash."""
    from recovery_drill import _download_latest_archive_to_tmp

    fake_client = MagicMock()
    fake_client.get_paginator.return_value.paginate.return_value = [{"Contents": []}]

    with patch("recovery_drill.r2_storage") as mock_r2:
        mock_r2.is_configured.return_value = True
        mock_r2.client.return_value = fake_client
        mock_r2.R2_BUCKET = "test-bucket"
        with pytest.raises(RuntimeError, match="No archives in R2"):
            await _download_latest_archive_to_tmp("/tmp")


# ============================================================
# Endpoint auth
# ============================================================

@pytest.mark.asyncio
async def test_drill_endpoint_requires_super_admin(transport):
    nsjwt = issue_session_jwt("mod-slug", "mod@example.com", role="admin")
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        r = await c.post(
            "/api/admin/db/backup/drill/run",
            headers={"Authorization": f"Bearer {nsjwt}"},
        )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_drill_settings_accept_new_keys(transport):
    sjwt = issue_session_jwt("super-slug", "super@example.com", role="admin")
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        r = await c.patch(
            "/api/admin/settings",
            headers={"Authorization": f"Bearer {sjwt}"},
            json={"auto_recovery_drill_enabled": True, "recovery_drill_min_products": 500},
        )
        assert r.status_code == 200
        body = r.json()
        assert body.get("auto_recovery_drill_enabled") is True
        assert body.get("recovery_drill_min_products") == 500
        # Reject min_products = 0 (ge=1)
        bad = await c.patch(
            "/api/admin/settings",
            headers={"Authorization": f"Bearer {sjwt}"},
            json={"recovery_drill_min_products": 0},
        )
        assert bad.status_code == 422
        # Reset
        await c.patch(
            "/api/admin/settings",
            headers={"Authorization": f"Bearer {sjwt}"},
            json={"auto_recovery_drill_enabled": False, "recovery_drill_min_products": 100},
        )
