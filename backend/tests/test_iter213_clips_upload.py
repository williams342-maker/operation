"""
iter213 — Native R2 upload for Clips feed + opt-in daily clip seed cron.

Covers:
  - POST /api/maker/clips/upload happy path (multipart) → source_type=r2,
    R2 public video_url, optional poster_url (best-effort ffmpeg).
  - Upload validation: bad category (422), oversize (422 from r2_storage),
    non-video mime (422).
  - Scheduler job `_job_daily_clip_seed` early-returns when
    SCHEDULER_DAILY_CLIPS=false (default).
  - Scheduler registers `daily_clip_seed` cron at hour=9, minute=0.
  - iter210/iter212 regression: /clips/categories + /clips/feed still 200.
"""
from __future__ import annotations

import asyncio
import os
import sys
import pathlib

import pytest
import requests
from dotenv import load_dotenv

# Repo path for importing backend internals
ROOT = pathlib.Path("/app/backend")
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT / ".env")

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") if os.environ.get("REACT_APP_BACKEND_URL") else None
if not BASE_URL:
    # fall back to frontend .env
    fe_env = pathlib.Path("/app/frontend/.env")
    for line in fe_env.read_text().splitlines():
        if line.startswith("REACT_APP_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
            break

API = f"{BASE_URL}/api"
MAKER_EMAIL = "iron-and-oak@craftersmarket.org"
TEST_CLIP_PATH = "/tmp/test_clip.mp4"


# iter413as — Auto-generate a tiny synthetic MP4 if the test file is missing.
# Avoids hard-fail on fresh CI environments where /tmp is empty.
def _ensure_test_clip():
    import os as _os
    if _os.path.exists(TEST_CLIP_PATH) and _os.path.getsize(TEST_CLIP_PATH) > 0:
        return
    # Smallest valid MP4 — 32 bytes of ftyp + 0-byte moov.
    blob = bytes.fromhex(
        "0000001866747970697336360000000069736f366d703431"
        "0000000866726565"
    )
    with open(TEST_CLIP_PATH, "wb") as _f:
        _f.write(blob)


_ensure_test_clip()


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
@pytest.fixture(scope="module")
def maker_token() -> str:
    """Mint a maker JWT via /api/maker/auth/verify."""
    from maker_auth import issue_magic_token
    token = issue_magic_token(MAKER_EMAIL)
    r = requests.post(f"{API}/maker/auth/verify", json={"token": token}, timeout=30)
    r.raise_for_status()
    return r.json()["token"]


@pytest.fixture(scope="module")
def maker_headers(maker_token):
    return {"Authorization": f"Bearer {maker_token}"}


@pytest.fixture(scope="module")
def created_clip_ids():
    """Track ids created in this run so we can purge them at teardown."""
    ids: list[str] = []
    yield ids
    # Cleanup — delete each clip we created.
    from maker_auth import issue_magic_token
    token = issue_magic_token(MAKER_EMAIL)
    r = requests.post(f"{API}/maker/auth/verify", json={"token": token}, timeout=30).json()
    h = {"Authorization": f"Bearer {r['token']}"}
    for cid in ids:
        try:
            requests.delete(f"{API}/maker/clips/{cid}", headers=h, timeout=20)
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Maker native upload
# ---------------------------------------------------------------------------
class TestMakerClipsUpload:
    def test_upload_happy_path_returns_r2_clip(self, maker_headers, created_clip_ids):
        with open(TEST_CLIP_PATH, "rb") as f:
            files = {"file": ("test_clip.mp4", f, "video/mp4")}
            data = {
                "title": "TEST_iter213 R2 native upload",
                "description": "synthetic 2s black mp4",
                "category": "workshop",
                "tags": "test,iter213",
                "product_slug": "",
            }
            r = requests.post(f"{API}/maker/clips/upload",
                              files=files, data=data,
                              headers=maker_headers, timeout=90)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True
        clip = body["clip"]
        assert clip["source_type"] == "r2"
        assert clip["video_url"].startswith("http")
        # Poster best-effort: should be set since ffmpeg is installed
        assert clip["poster_url"] is None or clip["poster_url"].startswith("http")
        assert clip["category"] == "workshop"
        assert clip["title"].startswith("TEST_iter213")
        assert "id" in clip and isinstance(clip["id"], str)
        created_clip_ids.append(clip["id"])

        # GET /api/clips/{slug} should return it
        g = requests.get(f"{API}/clips/{clip['slug']}", timeout=20)
        assert g.status_code == 200
        gj = g.json()
        assert gj["id"] == clip["id"]
        assert gj["source_type"] == "r2"
        assert gj["video_url"] == clip["video_url"]

    def test_upload_invalid_category_422(self, maker_headers):
        with open(TEST_CLIP_PATH, "rb") as f:
            files = {"file": ("test_clip.mp4", f, "video/mp4")}
            data = {"title": "TEST_iter213 bad cat", "category": "not-a-real-cat"}
            r = requests.post(f"{API}/maker/clips/upload",
                              files=files, data=data,
                              headers=maker_headers, timeout=60)
        assert r.status_code == 422, r.text

    def test_upload_non_video_mime_422(self, maker_headers):
        files = {"file": ("readme.txt", b"hello world", "text/plain")}
        data = {"title": "TEST_iter213 bad mime", "category": "workshop"}
        r = requests.post(f"{API}/maker/clips/upload",
                          files=files, data=data,
                          headers=maker_headers, timeout=60)
        assert r.status_code == 422, r.text

    def test_upload_oversize_422(self, maker_headers):
        # Build a >50MB blob in-memory. R2 cap is 50MB exactly.
        blob = b"\x00" * (50 * 1024 * 1024 + 1024)
        files = {"file": ("big.mp4", blob, "video/mp4")}
        data = {"title": "TEST_iter213 oversize", "category": "workshop"}
        r = requests.post(f"{API}/maker/clips/upload",
                          files=files, data=data,
                          headers=maker_headers, timeout=120)
        assert r.status_code == 422, r.text
        assert "too large" in r.text.lower() or "50" in r.text

    def test_upload_requires_maker_jwt_401(self):
        with open(TEST_CLIP_PATH, "rb") as f:
            files = {"file": ("test_clip.mp4", f, "video/mp4")}
            data = {"title": "TEST_iter213 noauth", "category": "workshop"}
            r = requests.post(f"{API}/maker/clips/upload",
                              files=files, data=data, timeout=60)
        assert r.status_code in (401, 403), r.text


# ---------------------------------------------------------------------------
# Scheduler: daily_clip_seed early-return + registration
# ---------------------------------------------------------------------------
class TestSchedulerDailyClipSeed:
    def test_disabled_by_default_early_returns(self, caplog):
        # Ensure env var is unset / false (default).
        os.environ.pop("SCHEDULER_DAILY_CLIPS", None)
        import importlib
        import scheduler as sched_mod
        importlib.reload(sched_mod)

        import logging
        caplog.set_level(logging.INFO, logger="server")
        caplog.set_level(logging.INFO)
        # Manually invoke the coroutine; should hit early-return path.
        asyncio.run(sched_mod._job_daily_clip_seed())
        joined = " ".join(rec.getMessage() for rec in caplog.records)
        assert "daily_clip_seed disabled" in joined, joined

    def test_registered_at_9_utc(self):
        """AsyncIOScheduler.start() needs a running event loop, so spin one."""
        import scheduler as sched_mod
        os.environ["SCHEDULER_ENABLED"] = "true"

        async def _boot_and_inspect():
            sched_mod._scheduler = None
            sched = sched_mod.start_scheduler()
            try:
                assert sched is not None
                job = sched.get_job("daily_clip_seed")
                assert job is not None, "daily_clip_seed job not registered"
                trig = str(job.trigger)
                assert "hour='9'" in trig and "minute='0'" in trig, trig
            finally:
                sched_mod.shutdown_scheduler()

        asyncio.new_event_loop().run_until_complete(_boot_and_inspect())


# ---------------------------------------------------------------------------
# Regression: iter210/iter212 endpoints still answer
# ---------------------------------------------------------------------------
class TestRegression:
    def test_categories(self):
        r = requests.get(f"{API}/clips/categories", timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data["categories"], list) and len(data["categories"]) >= 6
        assert "total" in data

    def test_feed(self):
        r = requests.get(f"{API}/clips/feed?limit=5", timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert isinstance(body["items"], list)

    def test_feed_invalid_category_400(self):
        r = requests.get(f"{API}/clips/feed?category=bogus", timeout=15)
        assert r.status_code == 400, r.text
