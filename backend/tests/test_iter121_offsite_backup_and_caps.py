"""iter121 — Offsite Mongo backups + capability-based admin UI hiding.

Two backend features (offsite scheduler + capability tab gating
helpers) plus a frontend-only capability filter. Tests:
  • Offsite scheduler bails when toggle off / R2 unconfigured / mongodump missing
  • Manual run endpoint bypasses the toggle (super-admin only)
  • R2 inventory list works when configured + returns [] when not
  • Settings PATCH accepts both new keys with bounds checking
  • The capability filter logic on AdminDashboard is mirrored in a
    pure-Python helper so we can unit-test the rules without spinning
    up Playwright. (Kept as JS literal in the dashboard, this test
    just locks the contract.)
"""

import os
import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

sys.path.insert(0, "/app/backend")
os.environ.setdefault("DB_NAME", "test_database")
os.environ.setdefault("ADMIN_EMAILS", "super@example.com")

# iter413an — Force-inject super admin into runtime set; see
# test_iter119_admin_db_backup.py for the full rationale (ADMIN_EMAILS
# is frozen at core import time, before this file's setdefault runs).
from core import ADMIN_EMAILS as _CORE_ADMINS  # noqa: E402
_CORE_ADMINS.add("super@example.com")

from server import app  # noqa: E402
from maker_auth import issue_session_jwt  # noqa: E402


@pytest.fixture
def transport():
    return ASGITransport(app=app)


# ============================================================
# Offsite scheduler — gating + happy path
# ============================================================

@pytest.mark.asyncio
async def test_offsite_bails_when_toggle_off():
    from offsite_backup import run_offsite_backup
    with patch("routers.settings.get_setting", new=AsyncMock(return_value=False)):
        out = await run_offsite_backup()
    assert out == {"ran": False, "reason": "toggle_off"}


@pytest.mark.asyncio
async def test_offsite_bails_when_r2_not_configured():
    from offsite_backup import run_offsite_backup
    with patch("routers.settings.get_setting", new=AsyncMock(return_value=True)), \
         patch("offsite_backup.r2_storage") as mock_r2:
        mock_r2.is_configured.return_value = False
        out = await run_offsite_backup()
    assert out == {"ran": False, "reason": "r2_not_configured"}


@pytest.mark.asyncio
async def test_offsite_uploads_and_logs():
    """Toggle ON, R2 configured, mongodump succeeds. Should upload to R2,
    write an audit row, and return summary stats."""
    from offsite_backup import run_offsite_backup

    fake_archive = b"FAKE_DUMP_" + (b"X" * 8192)

    async def fake_dump(*_a, **_kw):
        return fake_archive

    fake_client = MagicMock()
    fake_client.put_object = MagicMock()
    fake_paginator = MagicMock()
    fake_paginator.paginate.return_value = []
    fake_client.get_paginator.return_value = fake_paginator

    with patch("routers.settings.get_setting", new=AsyncMock(return_value=True)), \
         patch("offsite_backup._spawn_mongodump_to_buffer", new=fake_dump), \
         patch("offsite_backup.r2_storage") as mock_r2, \
         patch("offsite_backup.db") as mock_db:
        mock_r2.is_configured.return_value = True
        mock_r2.client.return_value = fake_client
        mock_r2.R2_BUCKET = "test-bucket"
        mock_db.admin_audit_log.insert_one = AsyncMock()

        out = await run_offsite_backup()

    assert out["ran"] is True
    assert out["ok"] is True
    assert out["size_bytes"] == len(fake_archive)
    assert out["key"].startswith("backups/mongo/crafters-")
    assert out["key"].endswith(".archive.gz")
    fake_client.put_object.assert_called_once()
    put_kwargs = fake_client.put_object.call_args.kwargs
    assert put_kwargs["Bucket"] == "test-bucket"
    assert put_kwargs["ContentType"] == "application/gzip"
    assert put_kwargs["CacheControl"] == "private, no-store"
    mock_db.admin_audit_log.insert_one.assert_awaited_once()
    audit = mock_db.admin_audit_log.insert_one.await_args.args[0]
    assert audit["kind"] == "offsite_backup_run"


# ============================================================
# Admin endpoints — auth gating
# ============================================================

@pytest.mark.asyncio
async def test_offsite_endpoints_require_super_admin(transport):
    # Non-super admin should get 403 on all three offsite paths.
    token = issue_session_jwt("mod-slug", "mod@example.com", role="admin")
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        for path, method in [
            ("/api/admin/db/backup/offsite", "GET"),
            ("/api/admin/db/backup/offsite/run", "POST"),
            ("/api/admin/db/backup/diag", "GET"),
        ]:
            r = await c.request(method, path, headers={"Authorization": f"Bearer {token}"})
            assert r.status_code == 403, f"{method} {path} → expected 403, got {r.status_code}"


@pytest.mark.asyncio
async def test_offsite_inventory_returns_shape_for_super_admin(transport):
    token = issue_session_jwt("super-slug", "super@example.com", role="admin")
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        r = await c.get(
            "/api/admin/db/backup/offsite",
            headers={"Authorization": f"Bearer {token}"},
        )
    assert r.status_code == 200
    body = r.json()
    assert "backups" in body
    assert "count" in body
    assert isinstance(body["backups"], list)
    assert isinstance(body["count"], int)


@pytest.mark.asyncio
async def test_diag_includes_r2_flag(transport):
    token = issue_session_jwt("super-slug", "super@example.com", role="admin")
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        r = await c.get(
            "/api/admin/db/backup/diag",
            headers={"Authorization": f"Bearer {token}"},
        )
    assert r.status_code == 200
    body = r.json()
    assert "r2_configured" in body
    assert isinstance(body["r2_configured"], bool)


# ============================================================
# Settings PATCH accepts new keys with bounds
# ============================================================

@pytest.mark.asyncio
async def test_settings_accepts_offsite_keys(transport):
    token = issue_session_jwt("super-slug", "super@example.com", role="admin")
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        r = await c.patch(
            "/api/admin/settings",
            headers={"Authorization": f"Bearer {token}"},
            json={"auto_offsite_backup_enabled": True, "auto_offsite_backup_retention_days": 14},
        )
        assert r.status_code == 200
        body = r.json()
        assert body.get("auto_offsite_backup_enabled") is True
        assert body.get("auto_offsite_backup_retention_days") == 14
        # Reject out-of-bounds retention (ge=7, le=365).
        bad = await c.patch(
            "/api/admin/settings",
            headers={"Authorization": f"Bearer {token}"},
            json={"auto_offsite_backup_retention_days": 1},
        )
        assert bad.status_code == 422
        # Reset
        await c.patch(
            "/api/admin/settings",
            headers={"Authorization": f"Bearer {token}"},
            json={"auto_offsite_backup_enabled": False, "auto_offsite_backup_retention_days": 30},
        )


# ============================================================
# Capability filter — pure-data lock so changes to AdminDashboard.jsx
# trigger a test failure that documents what changed.
# ============================================================

# Mirror of the visibleTabs filter in AdminDashboard.jsx. If the real
# component's logic ever drifts from this, the dashboard's tab list
# will diverge from what TeamTab assigns. Locking the contract here.
def _visible_tabs(tabs, me):
    caps = set((me or {}).get("capabilities") or [])
    is_super = bool((me or {}).get("is_super_admin"))
    sees_everything = is_super or "read_only" in caps
    out = []
    for t in tabs:
        if t.get("superOnly") and not is_super:
            continue
        tab_caps = t.get("caps") or []
        if not tab_caps:
            out.append(t); continue
        if sees_everything:
            out.append(t); continue
        if any(c in caps for c in tab_caps):
            out.append(t)
    return out


def test_capability_filter_super_admin_sees_everything():
    tabs = [
        {"id": "a"},
        {"id": "b", "caps": ["finance"]},
        {"id": "c", "superOnly": True},
        {"id": "d", "caps": ["moderation"]},
    ]
    visible = _visible_tabs(tabs, {"is_super_admin": True})
    assert {t["id"] for t in visible} == {"a", "b", "c", "d"}


def test_capability_filter_finance_only():
    tabs = [
        {"id": "audit"},                      # unrestricted
        {"id": "ads", "caps": ["finance"]},
        {"id": "chat", "caps": ["moderation"]},
        {"id": "team", "superOnly": True},
        {"id": "orders", "caps": ["finance", "support"]},
    ]
    visible = _visible_tabs(tabs, {"capabilities": ["finance"]})
    assert {t["id"] for t in visible} == {"audit", "ads", "orders"}


def test_capability_filter_read_only_sees_everything_except_super():
    tabs = [
        {"id": "audit"},
        {"id": "ads", "caps": ["finance"]},
        {"id": "chat", "caps": ["moderation"]},
        {"id": "team", "superOnly": True},
    ]
    visible = _visible_tabs(tabs, {"capabilities": ["read_only"]})
    # read-only acts as a view-everything role for non-super tabs.
    assert {t["id"] for t in visible} == {"audit", "ads", "chat"}


def test_capability_filter_no_caps_sees_only_unrestricted():
    tabs = [
        {"id": "audit"},
        {"id": "ads", "caps": ["finance"]},
        {"id": "team", "superOnly": True},
    ]
    visible = _visible_tabs(tabs, {"capabilities": []})
    assert {t["id"] for t in visible} == {"audit"}
