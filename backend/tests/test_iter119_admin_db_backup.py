"""iter119 — Admin MongoDB backup endpoint.

`GET /api/admin/db/backup` streams a `mongodump --archive --gzip` of the
whole database. Super-admin only. Audit-logged.

We don't actually invoke mongodump from the test (that's integration
territory and flakes in CI). Instead:
  • 401 without auth
  • 403 for non-super admins
  • 200 stream + audit log row for super admins (mocked subprocess)
"""

import os
import sys
from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

sys.path.insert(0, "/app/backend")
os.environ.setdefault("DB_NAME", "test_database")
os.environ.setdefault("ADMIN_EMAILS", "super@example.com")

# iter413an — `core.ADMIN_EMAILS` is computed at module-import time.
# If `core` was already imported by an earlier test in the smoke suite
# (e.g. via conftest.py's seed-restoration fixture), the os.environ
# setdefault above lands AFTER the set was frozen, so super@example.com
# isn't recognized as a super admin and these tests 403. Force-inject
# our super admin into the runtime set instead of relying on env timing.
from core import ADMIN_EMAILS as _CORE_ADMINS  # noqa: E402
_CORE_ADMINS.add("super@example.com")

from server import app  # noqa: E402
from maker_auth import issue_session_jwt  # noqa: E402


@pytest.fixture
def transport():
    return ASGITransport(app=app)


@pytest.mark.asyncio
async def test_backup_requires_auth(transport):
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        r = await c.get("/api/admin/db/backup/diag")
        assert r.status_code == 401


@pytest.mark.asyncio
async def test_backup_requires_super_admin(transport):
    # Non-super admin still gets 403 on backup.
    token = issue_session_jwt("mod-slug", "mod@example.com", role="admin")
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        r = await c.get(
            "/api/admin/db/backup/diag",
            headers={"Authorization": f"Bearer {token}"},
        )
    assert r.status_code == 403
    assert "super admin" in r.text.lower()


@pytest.mark.asyncio
async def test_diag_returns_sane_shape_for_super_admin(transport):
    token = issue_session_jwt("super-slug", "super@example.com", role="admin")
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        r = await c.get(
            "/api/admin/db/backup/diag",
            headers={"Authorization": f"Bearer {token}"},
        )
    assert r.status_code == 200
    body = r.json()
    assert "mongodump_present" in body
    assert "mongodump_path" in body
    assert "mongo_url_set" in body
    assert "db_name" in body
    assert isinstance(body["mongodump_present"], bool)


@pytest.mark.asyncio
async def test_backup_download_streams_bytes_and_audits(transport):
    """Mock the mongodump subprocess so the test doesn't require a live
    Mongo. Assert:
      • Content-Disposition names an `.archive.gz` file
      • Body contains the mocked bytes
      • An audit log row was written.
    """
    token = issue_session_jwt("super-slug", "super@example.com", role="admin")

    fake_bytes = b"FAKE_MONGODUMP_BYTES_" + (b"X" * 4096)

    async def fake_stream(_mongo, _db):
        # Simulate a mongodump stdout stream in two chunks.
        yield fake_bytes[:2048]
        yield fake_bytes[2048:]

    with patch("routers.admin_backup._stream_mongodump", new=fake_stream):
        # Also mock the audit log so we can assert without touching Mongo.
        with patch("routers.admin_backup.db") as mock_db:
            mock_db.admin_audit_log.insert_one = AsyncMock()
            async with AsyncClient(transport=transport, base_url="http://test") as c:
                r = await c.get(
                    "/api/admin/db/backup",
                    headers={"Authorization": f"Bearer {token}"},
                )

    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/gzip")
    disp = r.headers.get("content-disposition", "")
    assert "attachment" in disp
    assert ".archive.gz" in disp
    assert "crafters-backup-" in disp
    assert r.headers.get("x-accel-buffering") == "no"
    assert r.content == fake_bytes
    # Audit row must have been inserted before streaming started.
    mock_db.admin_audit_log.insert_one.assert_awaited_once()
    row = mock_db.admin_audit_log.insert_one.await_args.args[0]
    assert row["kind"] == "db_backup_download"
    assert row["admin_email"] == "super@example.com"
    assert row["filename"].endswith(".archive.gz")
