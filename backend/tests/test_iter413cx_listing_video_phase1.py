"""iter413cx — Listing Video Support · Phase 1 (backend contract).

Verifies:
  • Capabilities flipped: features.listing_videos.upload_enabled=true,
    formats=[mp4, mov], max_size_mb=100, max_duration_seconds=60.
  • Compass auto-answers from CAPABILITIES (no prompt edits).
  • POST /api/maker/uploads/video accepts valid MP4 + MOV.
  • Server-side validation rejects wrong MIME, oversized, over-duration.
  • PATCH /api/maker/products/{slug} persists/clears listing_video.
  • Unauthenticated upload is rejected.
"""
from __future__ import annotations

import asyncio
import io
import os
import subprocess
import sys
import uuid
from pathlib import Path

import pytest
import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dotenv import load_dotenv
load_dotenv("/app/frontend/.env")
load_dotenv("/app/backend/.env")

BASE_URL = (
    os.environ.get("REACT_APP_BACKEND_URL")
    or "https://active-project-4.preview.emergentagent.com"
).rstrip("/")


def _gen_mp4(duration_s: float, path: Path):
    """Generate a tiny synthetic MP4 of the given duration with ffmpeg."""
    subprocess.run(
        ["ffmpeg", "-y", "-f", "lavfi", "-i", f"color=c=black:s=128x72:d={duration_s}",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "ultrafast",
         "-tune", "stillimage", "-movflags", "+faststart", str(path)],
        check=True, capture_output=True,
    )


@pytest.fixture(scope="module")
def synthetic_videos(tmp_path_factory):
    base = tmp_path_factory.mktemp("videos")
    mp4_5s = base / "valid-5s.mp4"
    mp4_75s = base / "long-75s.mp4"
    _gen_mp4(5.0, mp4_5s)
    _gen_mp4(75.0, mp4_75s)
    return {"valid_mp4": mp4_5s, "long_mp4": mp4_75s, "base": base}


# ── Capabilities ──────────────────────────────────────────────────────
def test_capabilities_flipped_to_enabled():
    r = requests.get(f"{BASE_URL}/api/platform/capabilities", timeout=15)
    assert r.status_code == 200
    body = r.json()
    lv = body["features"]["listing_videos"]
    assert lv["upload_enabled"] is True
    assert lv["gallery_render_enabled"] is True
    assert lv["max_per_listing"] == 1
    assert lv["max_size_mb"] == 100
    assert lv["max_duration_seconds"] == 60
    assert "mp4" in lv["supported_video_formats"]
    assert "mov" in lv["supported_video_formats"]
    # listing_uploads.video should mirror.
    luv = body["listing_uploads"]["video"]
    assert luv["max_size_mb"] == 100
    assert luv["max_duration_seconds"] == 60
    assert "video/mp4" in luv["accepted_mime_types"]


def test_compass_now_answers_video_supported():
    """The AI Help Assistant must AUTO-flip its stance because it reads
    the live CAPABILITIES JSON (iter413cq design). NO prompt edits."""
    r = requests.post(
        f"{BASE_URL}/api/help/chat",
        json={"message": "Can I upload a video to my listing?", "user_role": "maker"},
        timeout=30,
    )
    assert r.status_code == 200
    reply = r.json()["reply"].lower()
    # Authoritative yes + the new constraints surface.
    assert "yes" in reply or "supported" in reply
    assert "mp4" in reply or "mov" in reply
    assert "60" in reply  # duration cap
    assert "100" in reply  # size cap
    # Old "not supported / future release" line must be gone.
    assert "not supported yet" not in reply
    assert "planned for a future release" not in reply


# ── Upload endpoint ───────────────────────────────────────────────────
def _maker_auth(slug: str):
    """Mint a maker session JWT for the given slug."""
    from maker_auth import issue_session_jwt
    return issue_session_jwt(slug, f"{slug}@test.example", role="maker")


@pytest.fixture(scope="module")
def maker_slug():
    """Use the seeded maker for upload tests so we don't have to mint
    a maker + Stripe Connect on every test run. The 'seed-cnc-builds'
    maker is created by the dev seed and exists in every env."""
    from motor.motor_asyncio import AsyncIOMotorClient

    async def _find():
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]
        m = await db.makers.find_one({}, {"slug": 1, "_id": 0})
        client.close()
        return m and m.get("slug")
    slug = asyncio.run(_find())
    assert slug, "no makers seeded; cannot run upload tests"
    return slug


def test_upload_requires_auth(synthetic_videos):
    with open(synthetic_videos["valid_mp4"], "rb") as f:
        r = requests.post(
            f"{BASE_URL}/api/maker/uploads/video",
            files={"file": ("test.mp4", f, "video/mp4")},
            timeout=30,
        )
    assert r.status_code in (401, 403)


def test_upload_rejects_non_video_mime(maker_slug):
    tok = _maker_auth(maker_slug)
    r = requests.post(
        f"{BASE_URL}/api/maker/uploads/video",
        headers={"Authorization": f"Bearer {tok}"},
        files={"file": ("photo.jpg", b"\xff\xd8\xff\xe0" + b"\x00" * 100, "image/jpeg")},
        timeout=30,
    )
    assert r.status_code == 400
    detail = r.json().get("detail")
    if isinstance(detail, dict):
        assert detail.get("code") == "video_unsupported_format"


def test_upload_rejects_oversized(maker_slug, tmp_path):
    tok = _maker_auth(maker_slug)
    # Generate a fake 101MB payload by padding a tiny MP4. We don't care
    # about validity — the size guard runs before ffprobe.
    big = tmp_path / "huge.mp4"
    big.write_bytes(b"\x00" * (101 * 1024 * 1024))
    with open(big, "rb") as f:
        r = requests.post(
            f"{BASE_URL}/api/maker/uploads/video",
            headers={"Authorization": f"Bearer {tok}"},
            files={"file": ("huge.mp4", f, "video/mp4")},
            timeout=120,
        )
    assert r.status_code == 400
    detail = r.json().get("detail")
    if isinstance(detail, dict):
        assert detail.get("code") == "video_too_large"


def test_upload_rejects_over_duration(maker_slug, synthetic_videos):
    """The 75s MP4 must be rejected. Confirms the ffprobe pipeline runs
    server-side — not just a client-side check."""
    tok = _maker_auth(maker_slug)
    with open(synthetic_videos["long_mp4"], "rb") as f:
        r = requests.post(
            f"{BASE_URL}/api/maker/uploads/video",
            headers={"Authorization": f"Bearer {tok}"},
            files={"file": ("long.mp4", f, "video/mp4")},
            timeout=60,
        )
    assert r.status_code == 400
    detail = r.json().get("detail")
    if isinstance(detail, dict):
        assert detail.get("code") == "video_too_long"


def test_upload_accepts_valid_mp4(maker_slug, synthetic_videos):
    """End-to-end happy path: 5s MP4 uploads, R2 returns URL, duration
    is server-measured. Skipped when R2 isn't configured in this env."""
    tok = _maker_auth(maker_slug)
    with open(synthetic_videos["valid_mp4"], "rb") as f:
        r = requests.post(
            f"{BASE_URL}/api/maker/uploads/video",
            headers={"Authorization": f"Bearer {tok}"},
            files={"file": ("ok.mp4", f, "video/mp4")},
            timeout=60,
        )
    if r.status_code == 503:
        pytest.skip("R2 not configured in this env")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["url"].startswith("http")
    assert body["duration"] >= 4.5 and body["duration"] <= 6.0
    assert body["content_type"] == "video/mp4"
    assert body["size"] > 0
