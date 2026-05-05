"""Iter 131 — Admin edit on community design files emails the poster.

Validates via DB-state assertions (not via cross-process mocks):
- Admin edit on a poster's file with `email_poster_on_admin_edit=True`
  appends a `admin_edits[]` audit row with the field-level diff.
- The diff contains only user-facing fields (title/description/thumbnail),
  not regenerated cosmetic fields like seo_tags.
- When the setting is OFF, no audit row is appended.
- When the editor is the original owner (not an admin), no audit row.
"""
import asyncio
import sys
import uuid
import pytest
import httpx
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
sys.path.insert(0, "/app/backend")

from maker_auth import issue_session_jwt  # noqa: E402
from core import db  # noqa: E402

API = "http://localhost:8001/api"


def _hdrs(token):
    return {"Authorization": f"Bearer {token}"}


async def _seed_buyer_file(uploader_id: str, email: str):
    fid = str(uuid.uuid4())
    await db.design_files.insert_one({
        "id": fid,
        "maker_slug": None,
        "uploader_role": "buyer",
        "uploader_id": uploader_id,
        "maker_name": "Iter131 Tester",
        "title": "Original Title",
        "description": "Original description.",
        "file_type": "DXF",
        "download_url": "https://x/seed.dxf",
        "thumbnail_url": "https://x/seed.jpg",
        "variants": [],
        "downloads": 0,
        "size_bytes": 100,
        "created_at": "2026-01-01T00:00:00+00:00",
    })
    await db.community_users.update_one(
        {"user_id": uploader_id},
        {"$set": {"user_id": uploader_id, "email": email, "name": "Iter131 Buyer"}},
        upsert=True,
    )
    return fid


async def _ensure_setting(value: bool):
    await db.site_settings.update_one(
        {"_id": "global"},
        {"$set": {"email_poster_on_admin_edit": value}},
        upsert=True,
    )


@pytest.mark.asyncio
async def test_admin_edit_appends_audit_row_with_diff():
    uploader = f"buyer-{uuid.uuid4().hex[:8]}"
    email = f"{uploader}@iter131.test"
    fid = await _seed_buyer_file(uploader, email)
    await _ensure_setting(True)
    admin_token = issue_session_jwt(
        "williams342@gmail.com", "williams342@gmail.com", role="admin",
    )

    async with httpx.AsyncClient() as client:
        r = await client.patch(
            f"{API}/community/files/{fid}",
            json={
                "title": "Plasma Cut Mountain Wall Art",
                "description": "Updated by admin moderation. Plasma-cut mild steel.",
            },
            headers=_hdrs(admin_token),
        )
        assert r.status_code == 200, r.text

    fresh = await db.design_files.find_one({"id": fid}, {"_id": 0})
    edits = fresh.get("admin_edits") or []
    assert len(edits) == 1, f"Expected 1 audit row, got {edits}"
    diff = edits[0]["diff"]
    assert "title" in diff
    assert diff["title"]["before"] == "Original Title"
    assert diff["title"]["after"].startswith("Plasma Cut")
    assert "description" in diff
    assert "seo_tags" not in diff
    assert "updated_at" not in diff
    assert edits[0]["emailed"] is True
    assert edits[0]["by"] == "williams342@gmail.com"

    await db.design_files.delete_one({"id": fid})
    await db.community_users.delete_one({"user_id": uploader})


@pytest.mark.asyncio
async def test_admin_edit_skips_audit_when_setting_off():
    uploader = f"buyer-{uuid.uuid4().hex[:8]}"
    email = f"{uploader}@iter131.test"
    fid = await _seed_buyer_file(uploader, email)
    await _ensure_setting(False)
    admin_token = issue_session_jwt(
        "williams342@gmail.com", "williams342@gmail.com", role="admin",
    )

    async with httpx.AsyncClient() as client:
        r = await client.patch(
            f"{API}/community/files/{fid}",
            json={"title": "Quietly edited title"},
            headers=_hdrs(admin_token),
        )
        assert r.status_code == 200

    fresh = await db.design_files.find_one({"id": fid}, {"_id": 0})
    assert (fresh.get("admin_edits") or []) == []

    await _ensure_setting(True)
    await db.design_files.delete_one({"id": fid})
    await db.community_users.delete_one({"user_id": uploader})


@pytest.mark.asyncio
async def test_owner_edit_does_not_audit():
    """Non-admin owner edit isn't a moderation event."""
    uploader = f"buyer-{uuid.uuid4().hex[:8]}"
    email = f"{uploader}@iter131.test"
    fid = await _seed_buyer_file(uploader, email)
    await _ensure_setting(True)
    owner_token = issue_session_jwt(uploader, email, role="buyer")

    async with httpx.AsyncClient() as client:
        r = await client.patch(
            f"{API}/community/files/{fid}",
            json={"title": "I edited my own file"},
            headers=_hdrs(owner_token),
        )
        assert r.status_code == 200

    fresh = await db.design_files.find_one({"id": fid}, {"_id": 0})
    assert (fresh.get("admin_edits") or []) == []

    await db.design_files.delete_one({"id": fid})
    await db.community_users.delete_one({"user_id": uploader})


if __name__ == "__main__":
    asyncio.run(test_admin_edit_appends_audit_row_with_diff())
    print("admin_edit_appends_audit_row OK")
    asyncio.run(test_admin_edit_skips_audit_when_setting_off())
    print("setting_off_skips_audit OK")
    asyncio.run(test_owner_edit_does_not_audit())
    print("owner_edit_no_audit OK")
