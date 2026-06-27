"""iter413cp — Batch 2 contract: video upload rejection + configurable
Product Guides + Outdoor Mounting fix.

Loretta Alvarado seller feedback. Verifies:
  • POST /api/maker/uploads/video now returns 422 with code
    `video_uploads_disabled` regardless of file type / R2 state.
  • Endpoint still requires a valid maker JWT (no auth bypass).
"""
from __future__ import annotations

import asyncio
import io
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

import httpx
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://active-project-4.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture
def maker_jwt():
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    from motor.motor_asyncio import AsyncIOMotorClient
    from maker_auth import issue_session_jwt

    suffix = uuid.uuid4().hex[:8]
    slug = f"iter413cp-{suffix}"
    email = f"{slug}@example.com"

    async def _seed():
        c = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = c[os.environ["DB_NAME"]]
        await db.makers.insert_one({
            "id": str(uuid.uuid4()),
            "slug": slug, "name": "iter413cp test", "initials": "CP",
            "location": "X", "bio": "fx", "portrait": "", "cover": "",
            "email": email, "status": "approved",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        c.close()
    asyncio.run(_seed())

    yield slug, issue_session_jwt(slug, email, role="maker")

    async def _cleanup():
        c = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = c[os.environ["DB_NAME"]]
        await db.makers.delete_many({"slug": slug})
        c.close()
    asyncio.run(_cleanup())


@pytest.mark.asyncio
async def test_video_upload_rejected_for_authed_maker(maker_jwt):
    slug, tok = maker_jwt
    # Mint a tiny fake mp4 — bytes don't matter, the endpoint rejects
    # before ever reading the file.
    fake_mp4 = b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 32
    async with httpx.AsyncClient(timeout=15.0) as c:
        files = {"file": ("listing.mp4", io.BytesIO(fake_mp4), "video/mp4")}
        r = await c.post(
            f"{API}/maker/uploads/video",
            headers={"Authorization": f"Bearer {tok}"},
            files=files,
        )
    assert r.status_code == 422, r.text
    body = r.json()
    detail = body.get("detail") or {}
    assert detail.get("code") == "video_uploads_disabled"
    assert "not yet supported" in detail.get("message", "").lower()


@pytest.mark.asyncio
async def test_video_upload_still_requires_auth():
    fake_mp4 = b"\x00\x00\x00\x18ftypmp42"
    async with httpx.AsyncClient(timeout=15.0) as c:
        files = {"file": ("listing.mp4", io.BytesIO(fake_mp4), "video/mp4")}
        r = await c.post(f"{API}/maker/uploads/video", files=files)
    # 401/403 unauthenticated — must NOT be 422 (would imply auth bypass).
    assert r.status_code in (401, 403), r.text
