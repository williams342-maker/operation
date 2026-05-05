"""Iter 130 — Admin override on PATCH /community/files/{id}.

Iter126 shipped the public-facing PATCH endpoint with a strict ownership
check (uploader_id or maker_slug must match the JWT subject). For
moderation we need admins to bypass that check so they can fix typos /
clean up listings without taking ownership transfer steps.

Validates:
- Admin JWT can edit ANY file regardless of uploader_id/maker_slug.
- Buyer / maker JWTs still hit 403 on files they don't own (regression
  check — admin override must NOT widen the perms for non-admins).
- Tags + seo_description are still regenerated when the title or
  description change via an admin edit.
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

API = "http://localhost:8001/api"


def _hdrs(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_admin_can_patch_any_design_file():
    """Admin JWT bypasses ownership check; buyer JWT does not."""
    fid = str(uuid.uuid4())
    uploader = f"buyer-{uuid.uuid4().hex[:8]}"
    other_buyer = f"buyer-{uuid.uuid4().hex[:8]}"
    seed = {
        "id": fid,
        "maker_slug": None,
        "uploader_role": "buyer",
        "uploader_id": uploader,
        "maker_name": "Original Author",
        "title": "Original",
        "description": "Original description.",
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
        admin_token = issue_session_jwt(
            "williams342@gmail.com", "williams342@gmail.com", role="admin",
        )
        other_token = issue_session_jwt(
            other_buyer, f"{other_buyer}@t.com", role="buyer",
        )
        async with httpx.AsyncClient() as client:
            # Other buyer (not the uploader) → 403 still.
            r = await client.patch(
                f"{API}/community/files/{fid}",
                json={"title": "stolen by non-admin"},
                headers=_hdrs(other_token),
            )
            assert r.status_code == 403

            # Admin → 200, despite not being the uploader.
            r = await client.patch(
                f"{API}/community/files/{fid}",
                json={
                    "title": "Plasma Cut Mountain Wall Art",
                    "description": "Updated by admin moderation. Made from "
                    "1/8 inch mild steel; works well as rustic farmhouse decor.",
                },
                headers=_hdrs(admin_token),
            )
            assert r.status_code == 200, r.text
            data = r.json()
            assert data["title"] == "Plasma Cut Mountain Wall Art"
            assert data["description"].startswith("Updated by admin")
            # Tags should regenerate from the new content.
            assert "plasma-cut" in (data.get("seo_tags") or [])
            assert "wall-art" in (data.get("seo_tags") or [])
            assert "steel" in (data.get("seo_tags") or [])
            assert (data.get("seo_description") or "").startswith(
                "Updated by admin moderation."
            )
    finally:
        await db.design_files.delete_one({"id": fid})


if __name__ == "__main__":
    asyncio.run(test_admin_can_patch_any_design_file())
    print("OK")
