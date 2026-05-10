"""iter139 — Maker journal image upload + per-maker blog feed.

Covers:
  POST /api/maker/journal/upload-image  (auth, allowlist, size, empty body)
  GET  /api/makers/{slug}/blog          (per-maker feed, capped 12, newest-first)
"""
import io
import os
import struct
import sys
import time
import zlib

import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
load_dotenv("/app/frontend/.env")
sys.path.insert(0, "/app/backend")

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
MAKER_SLUG = "iron-and-oak"
MAKER_EMAIL = "iron-and-oak@craftersmarket.org"


def _make_png_bytes(width: int = 8, height: int = 8) -> bytes:
    """Build a tiny valid PNG without depending on Pillow."""
    sig = b"\x89PNG\r\n\x1a\n"

    def chunk(tp, data):
        return (
            struct.pack(">I", len(data))
            + tp
            + data
            + struct.pack(">I", zlib.crc32(tp + data) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)  # RGB
    raw = b""
    for _ in range(height):
        raw += b"\x00" + b"\xff\x00\x00" * width  # filter byte + red row
    idat = zlib.compress(raw, 9)
    return sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


@pytest.fixture(scope="module")
def maker_jwt():
    from maker_auth import issue_session_jwt
    return issue_session_jwt(MAKER_SLUG, MAKER_EMAIL, role="maker")


@pytest.fixture(scope="module")
def auth_headers(maker_jwt):
    return {"Authorization": f"Bearer {maker_jwt}"}


# -----------------------------------------------------------------------------
# Upload endpoint
# -----------------------------------------------------------------------------
class TestJournalImageUpload:
    URL = f"{BASE_URL}/api/maker/journal/upload-image"

    def test_upload_png_success(self, auth_headers):
        png = _make_png_bytes()
        files = {"file": ("seed.png", png, "image/png")}
        r = requests.post(self.URL, headers=auth_headers, files=files, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "url" in data
        assert isinstance(data["url"], str) and data["url"].startswith("http")
        # Expect cdn.craftersmarket.org or an r2.cloudflarestorage.com host
        assert (
            "cdn.craftersmarket.org" in data["url"]
            or "r2.cloudflarestorage" in data["url"]
            or "r2.dev" in data["url"]
        ), f"unexpected host: {data['url']}"

    def test_upload_unauthenticated_returns_401(self):
        png = _make_png_bytes()
        files = {"file": ("a.png", png, "image/png")}
        r = requests.post(self.URL, files=files, timeout=15)
        assert r.status_code == 401, r.text

    def test_upload_text_content_type_returns_400(self, auth_headers):
        files = {"file": ("note.txt", b"hello world", "text/plain")}
        r = requests.post(self.URL, headers=auth_headers, files=files, timeout=15)
        assert r.status_code == 400, r.text

    def test_upload_empty_body_returns_400(self, auth_headers):
        files = {"file": ("empty.png", b"", "image/png")}
        r = requests.post(self.URL, headers=auth_headers, files=files, timeout=15)
        assert r.status_code == 400, r.text

    def test_upload_oversize_returns_413(self, auth_headers):
        big = b"\x00" * (9 * 1024 * 1024)  # 9MB
        files = {"file": ("huge.png", big, "image/png")}
        r = requests.post(self.URL, headers=auth_headers, files=files, timeout=60)
        assert r.status_code == 413, r.text


# -----------------------------------------------------------------------------
# Per-maker blog feed
# -----------------------------------------------------------------------------
class TestMakerBlogFeed:
    URL = f"{BASE_URL}/api/makers/{MAKER_SLUG}/blog"

    def test_returns_only_makers_posts_newest_first(self):
        r = requests.get(self.URL, timeout=15)
        assert r.status_code == 200, r.text
        posts = r.json()
        assert isinstance(posts, list)
        assert len(posts) >= 1
        # All posts must be created_by the maker
        for p in posts:
            assert p.get("created_by_maker") == MAKER_SLUG, p
        # Newest-first ordering
        ts = [p.get("created_at") for p in posts]
        assert ts == sorted(ts, reverse=True), f"not sorted desc: {ts}"
        # Patina post is present
        slugs = [p.get("slug") for p in posts]
        assert "how-we-pick-a-patina-that-ages-with-the-house" in slugs

    def test_capped_at_12(self, auth_headers):
        # Try requesting more than the cap; backend should cap at 12.
        r = requests.get(self.URL + "?limit=100", timeout=15)
        assert r.status_code == 200, r.text
        posts = r.json()
        assert len(posts) <= 12

    def test_unknown_maker_returns_empty(self):
        r = requests.get(f"{BASE_URL}/api/makers/no-such-maker-xyz/blog", timeout=15)
        assert r.status_code == 200, r.text
        assert r.json() == []
