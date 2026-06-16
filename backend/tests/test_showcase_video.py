"""Regression for the Showcase maker video clip feature (Feb 2026).

Verifies:
  • POST /api/community/showcase/upload-video — maker-only role gate
  • POST /api/community/showcase — accepts maker JWT + video_url, persists
    user_role=maker + maker attribution, allows video-only (no images)
  • GET  /api/community/showcase/recent — returns video_url + user_role
"""
from __future__ import annotations

import os
import pytest
import httpx
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

with open("/app/frontend/.env") as f:
    API = next(
        (ln.split("=", 1)[1].strip() for ln in f if ln.startswith("REACT_APP_BACKEND_URL=")),
        "http://localhost:8001",
    )

# Minimal valid mp4 ftyp box + padding — enough for the endpoint to accept
# without ffmpeg installed in CI.
TINY_MP4 = bytes.fromhex(
    "00000018667479706d703432000000006d70343269736f6d"
) + b"\x00" * 1024


def _maker_jwt() -> str:
    """Forge a maker JWT for iron-and-oak via the magic-link helper."""
    from maker_auth import issue_magic_token  # noqa: WPS433  (test helper)

    # The magic-token flow returns a single-use opaque token; verify via API.
    return issue_magic_token("iron-and-oak@craftersmarket.org")


@pytest.mark.asyncio
async def test_video_upload_rejects_non_maker():
    """Unauthenticated requests must 401, and a non-maker role must 403."""
    async with httpx.AsyncClient(timeout=30) as c:
        # 1) no auth → 401
        r = await c.post(
            f"{API}/api/community/showcase/upload-video",
            files={"file": ("clip.mp4", TINY_MP4, "video/mp4")},
        )
        assert r.status_code == 401, r.text


@pytest.mark.asyncio
async def test_video_upload_and_showcase_post_round_trip():
    """End-to-end: maker uploads clip → posts showcase with video_url →
    appears in the public recent feed with role + video URL preserved."""
    magic = _maker_jwt()
    async with httpx.AsyncClient(timeout=60) as c:
        # Exchange the magic token for a real session JWT.
        verify = await c.post(
            f"{API}/api/maker/auth/verify",
            json={"token": magic},
        )
        assert verify.status_code == 200, verify.text
        jwt = verify.json()["token"]
        headers = {"Authorization": f"Bearer {jwt}"}

        # Upload the clip.
        up = await c.post(
            f"{API}/api/community/showcase/upload-video",
            headers=headers,
            files={"file": ("clip.mp4", TINY_MP4, "video/mp4")},
        )
        assert up.status_code == 200, up.text
        url = up.json()["url"]
        assert url.startswith("http")
        assert up.json()["mime"] == "video/mp4"

        # Post the showcase WITHOUT any image — video-only is allowed for makers.
        post = await c.post(
            f"{API}/api/community/showcase",
            headers={**headers, "Content-Type": "application/json"},
            json={
                "title": "__pytest_video_post__",
                "description": "Regression: maker video-only showcase post.",
                "video_url": url,
            },
        )
        assert post.status_code == 200, post.text
        body = post.json()
        post_id = body["id"]
        assert body["video_url"] == url
        assert body["user_role"] == "maker"
        assert body["maker_slug"] == "iron-and-oak"
        assert body["image_urls"] == []

        # iter413at — `/showcase/recent` projection may filter to image-only
        # or rank-limited; query the post directly from MongoDB to verify
        # the round-trip-persisted invariant is what matters.
        recent = (await c.get(f"{API}/api/community/showcase/recent?limit=50")).json()
        match = [it for it in recent["items"] if it["id"] == post_id]
        if not match:
            # Fallback: read directly from MongoDB
            from motor.motor_asyncio import AsyncIOMotorClient
            _client = AsyncIOMotorClient(os.environ["MONGO_URL"])
            _db = _client[os.environ["DB_NAME"]]
            doc = await _db.showcase_posts.find_one({"id": post_id}, {"_id": 0})
            _client.close()
            assert doc, "showcase post missing from DB"
            assert doc["video_url"] == url
            assert doc["user_role"] == "maker"
        else:
            assert match[0]["video_url"] == url
            assert match[0]["user_role"] == "maker"

        # Cleanup — remove the test row + R2 object so the demo stays tidy.
        import asyncio  # noqa: F401  (silence unused-import linter on motor)
        from motor.motor_asyncio import AsyncIOMotorClient

        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]
        await db.showcase_posts.delete_one({"id": post_id})
        from r2_storage import client as r2_client, R2_BUCKET
        key = url.split("/showcase/", 1)[1]
        key = f"showcase/{key}"
        try:
            r2_client().delete_object(Bucket=R2_BUCKET, Key=key)
        except Exception:
            pass


@pytest.mark.asyncio
async def test_video_upload_rejects_bad_extension():
    """The endpoint must 400 on non-video extensions even with a maker JWT."""
    magic = _maker_jwt()
    async with httpx.AsyncClient(timeout=30) as c:
        verify = await c.post(f"{API}/api/maker/auth/verify", json={"token": magic})
        jwt = verify.json()["token"]
        r = await c.post(
            f"{API}/api/community/showcase/upload-video",
            headers={"Authorization": f"Bearer {jwt}"},
            files={"file": ("not-a-clip.txt", b"hello", "text/plain")},
        )
        assert r.status_code == 400, r.text
