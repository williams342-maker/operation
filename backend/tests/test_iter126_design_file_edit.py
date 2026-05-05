"""Iter 126 — PATCH /community/files/{file_id} owner-only edit.

Validates:
- 401 without auth
- 403 when JWT subject doesn't match uploader
- 200 + persisted updates when owner edits title/description/thumbnail
- 400 for empty / oversized fields
- 404 for unknown file id
- File contents (file_type, download_url, variants) are NOT mutated by the
  PATCH endpoint — only the metadata fields the user can change.
"""
import os
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

API = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") + "/api" \
    if os.environ.get("REACT_APP_BACKEND_URL") \
    else "http://localhost:8001/api"


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_patch_design_file_owner_flow():
    file_id = str(uuid.uuid4())
    uploader_id = f"buyer-{uuid.uuid4().hex[:8]}"
    other_id = f"buyer-{uuid.uuid4().hex[:8]}"
    seed = {
        "id": file_id,
        "maker_slug": None,
        "uploader_role": "buyer",
        "uploader_id": uploader_id,
        "maker_name": "Test User",
        "title": "Original Title",
        "description": "Original description",
        "file_type": "DXF",
        "download_url": "https://x/seed.dxf",
        "thumbnail_url": "https://x/seed.jpg",
        "variants": [],
        "downloads": 0,
        "size_bytes": 100,
        "created_at": "2026-01-01T00:00:00+00:00",
    }
    await db.design_files.insert_one(seed)
    try:
        owner_token = issue_session_jwt(uploader_id, f"{uploader_id}@t.com", role="buyer")
        other_token = issue_session_jwt(other_id, f"{other_id}@t.com", role="buyer")

        async with httpx.AsyncClient() as client:
            # No auth → 401
            r = await client.patch(f"{API}/community/files/{file_id}",
                                   json={"title": "x"})
            assert r.status_code == 401

            # Wrong owner → 403
            r = await client.patch(f"{API}/community/files/{file_id}",
                                   json={"title": "stolen"},
                                   headers=_headers(other_token))
            assert r.status_code == 403

            # Unknown id → 404
            r = await client.patch(f"{API}/community/files/missing-id",
                                   json={"title": "x"},
                                   headers=_headers(owner_token))
            assert r.status_code == 404

            # Empty title → 400
            r = await client.patch(f"{API}/community/files/{file_id}",
                                   json={"title": ""},
                                   headers=_headers(owner_token))
            assert r.status_code == 400

            # Oversized description → 400
            r = await client.patch(f"{API}/community/files/{file_id}",
                                   json={"description": "x" * 1000},
                                   headers=_headers(owner_token))
            assert r.status_code == 400

            # Happy path — partial update (only description)
            r = await client.patch(f"{API}/community/files/{file_id}",
                                   json={"description": "Refreshed copy."},
                                   headers=_headers(owner_token))
            assert r.status_code == 200, r.text
            data = r.json()
            assert data["description"] == "Refreshed copy."
            assert data["title"] == "Original Title"  # unchanged
            assert data["file_type"] == "DXF"  # immutable
            assert data["download_url"] == seed["download_url"]  # immutable

            # Clearing thumbnail (empty string) → falls back to None
            r = await client.patch(f"{API}/community/files/{file_id}",
                                   json={"thumbnail_url": ""},
                                   headers=_headers(owner_token))
            assert r.status_code == 200, r.text
            assert r.json()["thumbnail_url"] is None
    finally:
        await db.design_files.delete_one({"id": file_id})


if __name__ == "__main__":
    asyncio.run(test_patch_design_file_owner_flow())
    print("OK")
