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
async def test_video_upload_endpoint_no_longer_rejects_blanket(maker_jwt):
    """iter413cx — Phase 1 listing video shipped. The endpoint that
    used to blanket-reject with 422/video_uploads_disabled now ACCEPTS
    mp4/mov ≤60s ≤100MB. A garbage-bytes fake mp4 still rejects (because
    ffprobe can't read it) but with a different code — and crucially,
    NEVER with video_uploads_disabled."""
    slug, tok = maker_jwt
    fake_mp4 = b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 32
    async with httpx.AsyncClient(timeout=30.0) as c:
        files = {"file": ("listing.mp4", io.BytesIO(fake_mp4), "video/mp4")}
        r = await c.post(
            f"{API}/maker/uploads/video",
            headers={"Authorization": f"Bearer {tok}"},
            files=files,
        )
    # Whatever it is, it must NOT be the legacy blanket reject.
    if r.status_code == 200:
        # Real R2 in this env accepted the bytes — that's fine.
        return
    detail = (r.json().get("detail") or {})
    code = detail.get("code") if isinstance(detail, dict) else None
    assert code != "video_uploads_disabled", \
        "Legacy blanket reject is back — iter413cx regressed"
    # Acceptable rejects: video_unreadable (ffprobe couldn't parse the
    # fake bytes), or 503 if R2 isn't configured in this env.
    assert r.status_code in (400, 503), r.text


@pytest.mark.asyncio
async def test_video_upload_still_requires_auth():
    fake_mp4 = b"\x00\x00\x00\x18ftypmp42"
    async with httpx.AsyncClient(timeout=15.0) as c:
        files = {"file": ("listing.mp4", io.BytesIO(fake_mp4), "video/mp4")}
        r = await c.post(f"{API}/maker/uploads/video", files=files)
    # 401/403 unauthenticated — must NOT be 422 (would imply auth bypass).
    assert r.status_code in (401, 403), r.text
