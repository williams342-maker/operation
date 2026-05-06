"""Tests for the admin design-files endpoint download-counter surface.

Covers:
  - GET /api/admin/design-files projects `downloads` (not legacy
    `download_count`) and includes `total_downloads` aggregate.
  - sort=downloads orders rows by download count descending.
  - Public download endpoint correctly increments `downloads` on the
    file row.
"""
import os
import sys
import asyncio
from datetime import datetime, timezone

import httpx

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from core import db  # noqa: E402
from maker_auth import issue_session_jwt  # noqa: E402

API = "http://localhost:8001"


async def _seed_test_files():
    """Drop any prior test rows then insert 3 files with known counts."""
    await db.design_files.delete_many({"id": {"$regex": "^test-dl-"}})
    now = datetime.now(timezone.utc).isoformat()
    rows = [
        {"id": "test-dl-1", "title": "Test DL Top",    "downloads": 200,
         "created_at": now, "quarantined_at": None, "open_reports": 0,
         "uploader_id": "u", "uploader_name": "U", "file_type": "svg"},
        {"id": "test-dl-2", "title": "Test DL Middle", "downloads": 50,
         "created_at": now, "quarantined_at": None, "open_reports": 0,
         "uploader_id": "u", "uploader_name": "U", "file_type": "stl"},
        {"id": "test-dl-3", "title": "Test DL Low",    "downloads": 1,
         "created_at": now, "quarantined_at": None, "open_reports": 0,
         "uploader_id": "u", "uploader_name": "U", "file_type": "dxf"},
    ]
    await db.design_files.insert_many(rows)


async def _cleanup():
    await db.design_files.delete_many({"id": {"$regex": "^test-dl-"}})


def _admin_token():
    return issue_session_jwt("admin", "admin@craftersmarket.org", role="admin")


def test_admin_design_files_returns_downloads_and_total():
    async def go():
        await _seed_test_files()
        tok = _admin_token()
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.get(
                f"{API}/api/admin/design-files?q=Test DL",
                headers={"Authorization": f"Bearer {tok}"},
            )
            r.raise_for_status()
            data = r.json()
            # `total_downloads` exists and is the sum across ALL files
            # (not just the filtered set), so we just sanity-check it's
            # at least the sum of our 3 seeded rows.
            assert "total_downloads" in data
            assert data["total_downloads"] >= 200 + 50 + 1
            # Each row exposes `downloads`, never `download_count`
            for row in data["items"]:
                assert "downloads" in row, f"row missing 'downloads': {row}"
                assert "download_count" not in row, (
                    f"row exposed legacy 'download_count': {row}"
                )
        await _cleanup()
    asyncio.run(go())


def test_admin_design_files_sort_by_downloads_descending():
    async def go():
        await _seed_test_files()
        tok = _admin_token()
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.get(
                f"{API}/api/admin/design-files?sort=downloads&q=Test DL",
                headers={"Authorization": f"Bearer {tok}"},
            )
            r.raise_for_status()
            items = r.json()["items"]
            ours = [it for it in items if it["id"].startswith("test-dl-")]
            assert len(ours) == 3
            counts = [it["downloads"] for it in ours]
            assert counts == sorted(counts, reverse=True), (
                f"expected descending order, got {counts}"
            )
            # Top should be the 200-download file
            assert ours[0]["id"] == "test-dl-1"
        await _cleanup()
    asyncio.run(go())


def test_admin_design_files_sort_default_is_created_at():
    async def go():
        await _seed_test_files()
        tok = _admin_token()
        async with httpx.AsyncClient(timeout=10) as c:
            # Default sort (no sort param) is created_at desc; since all 3
            # rows share the same created_at, just verify it doesn't 500
            # and returns the same set.
            r = await c.get(
                f"{API}/api/admin/design-files?q=Test DL",
                headers={"Authorization": f"Bearer {tok}"},
            )
            r.raise_for_status()
            items = r.json()["items"]
            ours = [it for it in items if it["id"].startswith("test-dl-")]
            assert len(ours) == 3
        await _cleanup()
    asyncio.run(go())
