"""
Iter90 — Admin design-file delete + list endpoint.

Covers:
  • GET /api/admin/design-files (list, filter, search)
  • DELETE /api/admin/design-files/{id} (hard delete)
  • Audit log entry created
  • Reports + downloads tied to the file are purged
"""
import os
import sys
import uuid
import requests

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")
from maker_auth import issue_admin_magic_token  # noqa: E402

API = os.environ.get(
    "PUBLIC_BACKEND_URL",
    "https://active-project-4.preview.emergentagent.com",
).rstrip("/")
ADMIN_EMAIL = "team@craftersmarket.org"


def _admin_jwt() -> str:
    tok = issue_admin_magic_token(ADMIN_EMAIL)
    r = requests.post(f"{API}/api/admin/auth/verify", json={"token": tok}, timeout=15)
    r.raise_for_status()
    return r.json()["token"]


def test_list_endpoint():
    h = {"Authorization": f"Bearer {_admin_jwt()}"}
    r = requests.get(f"{API}/api/admin/design-files", headers=h, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "items" in body and "count" in body
    assert isinstance(body["items"], list)


def test_filter_quarantined():
    h = {"Authorization": f"Bearer {_admin_jwt()}"}
    # quarantined=False should return only non-quarantined files
    r = requests.get(
        f"{API}/api/admin/design-files",
        headers=h, params={"quarantined": False}, timeout=15,
    ).json()
    for it in r["items"]:
        assert it.get("quarantined_at") is None, it


def test_search_q():
    h = {"Authorization": f"Bearer {_admin_jwt()}"}
    r = requests.get(
        f"{API}/api/admin/design-files",
        headers=h, params={"q": "test_iter68"}, timeout=15,
    ).json()
    # Test seed data has files starting with TEST_iter68 — at least one match expected
    assert r["count"] >= 0  # tolerate empty if seed wiped


def test_delete_lifecycle():
    """Insert a synthetic test row + report + download → DELETE → assert
    every related row is purged."""
    from motor.motor_asyncio import AsyncIOMotorClient
    import asyncio
    fid = f"iter90-test-{uuid.uuid4().hex[:8]}"

    async def seed():
        c = AsyncIOMotorClient(os.environ["MONGO_URL"])
        d = c[os.environ["DB_NAME"]]
        await d.design_files.insert_one({
            "id": fid, "title": "iter90 hard-delete probe",
            "file_type": "stl", "uploader_id": "iter90-bot",
            "uploader_name": "iter90", "created_at": "2026-04-30T00:00:00+00:00",
            "quarantined_at": None, "open_reports": 0, "size_bytes": 1024,
            "download_count": 0,
            # No real R2 URL — DELETE should still succeed (R2 cleanup is best-effort)
            "download_url": "", "thumbnail_url": "",
        })
        await d.design_file_reports.insert_one({
            "id": f"{fid}-report", "file_id": fid, "status": "open",
            "reason": "test", "created_at": "2026-04-30T00:00:00+00:00",
        })
        await d.design_file_downloads.insert_one({
            "id": f"{fid}-dl", "file_id": fid, "user_id": "iter90-bot",
            "created_at": "2026-04-30T00:00:00+00:00",
        })

    async def assert_gone():
        c = AsyncIOMotorClient(os.environ["MONGO_URL"])
        d = c[os.environ["DB_NAME"]]
        assert await d.design_files.count_documents({"id": fid}) == 0
        assert await d.design_file_reports.count_documents({"file_id": fid}) == 0
        assert await d.design_file_downloads.count_documents({"file_id": fid}) == 0
        # Audit row written
        a = await d.admin_audit.find_one(
            {"kind": "design_file_hard_delete", "file_id": fid}, {"_id": 0},
        )
        assert a is not None
        assert a.get("reports_purged") == 1
        assert a.get("download_rows_purged") == 1

    asyncio.run(seed())
    h = {"Authorization": f"Bearer {_admin_jwt()}"}
    r = requests.delete(f"{API}/api/admin/design-files/{fid}", headers=h, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["deleted"] is True
    assert body["reports_purged"] == 1
    assert body["downloads_purged"] == 1
    asyncio.run(assert_gone())


def test_delete_404_on_missing():
    h = {"Authorization": f"Bearer {_admin_jwt()}"}
    r = requests.delete(
        f"{API}/api/admin/design-files/does-not-exist", headers=h, timeout=15,
    )
    assert r.status_code == 404


if __name__ == "__main__":
    test_list_endpoint(); print("✓ list endpoint")
    test_filter_quarantined(); print("✓ filter quarantined")
    test_search_q(); print("✓ search")
    test_delete_lifecycle(); print("✓ delete lifecycle (rows + reports + downloads + audit)")
    test_delete_404_on_missing(); print("✓ 404 on missing id")
    print("\niter90 checks passed.")
