"""iter330 — Backend tests for POST /api/maker/uploads/cover.

Verifies:
- Happy path: PNG upload → 200 {url,size}, URL is R2 CDN, makers.cover updated.
- Rejection paths: non-image content-type, empty file, oversized file (>10MB).
- Restores prior cover value after each test.
"""
import io
import os
import struct
import zlib
import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://active-project-4.preview.emergentagent.com").rstrip("/")
MAKER_EMAIL = "iron-and-oak@craftersmarket.org"
MAKER_SLUG = "iron-and-oak"


def _make_png(size_bytes: int = 0) -> bytes:
    """Create a minimal valid 1x1 PNG, optionally padded with tEXt chunk to reach size_bytes."""
    # Minimal 1x1 red PNG (no padding)
    sig = b"\x89PNG\r\n\x1a\n"

    def chunk(ctype: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + ctype
            + data
            + struct.pack(">I", zlib.crc32(ctype + data) & 0xFFFFFFFF)
        )

    ihdr = chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
    # 1 pixel red: filter byte + 3 bytes RGB
    raw = b"\x00\xff\x00\x00"
    idat = chunk(b"IDAT", zlib.compress(raw))
    iend = chunk(b"IEND", b"")
    png = sig + ihdr + idat + iend
    if size_bytes > len(png):
        # Insert a tEXt chunk with the required padding (inserted before IEND)
        padding = b"a" * (size_bytes - len(png) - 12 - 6)  # 12 = chunk overhead, 6 = "pad\0"
        if padding:
            text = chunk(b"tEXt", b"pad\x00" + padding)
            png = sig + ihdr + idat + text + iend
    return png


@pytest.fixture(scope="module")
def maker_token():
    """Mint a JWT for the iron-and-oak test maker via /maker/auth/verify."""
    import sys
    sys.path.insert(0, "/app/backend")
    from maker_auth import issue_magic_token
    tok = issue_magic_token(MAKER_EMAIL)
    r = requests.post(f"{BASE_URL}/api/maker/auth/verify", json={"token": tok}, timeout=15)
    assert r.status_code == 200, f"verify failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def prior_cover(maker_token):
    """Snapshot the maker's cover URL before tests so we can restore it after."""
    r = requests.get(
        f"{BASE_URL}/api/maker/me",
        headers={"Authorization": f"Bearer {maker_token}"},
        timeout=15,
    )
    assert r.status_code == 200, f"maker/me failed: {r.text}"
    cover = r.json().get("cover") or ""
    yield cover
    # Restore prior cover via PATCH /maker/profile
    requests.patch(
        f"{BASE_URL}/api/maker/profile",
        headers={"Authorization": f"Bearer {maker_token}"},
        json={"cover": cover},
        timeout=15,
    )


class TestCoverUpload:
    """POST /api/maker/uploads/cover — success + validation branches."""

    def test_happy_path_png_upload(self, maker_token, prior_cover):
        png_bytes = _make_png()
        files = {"file": ("test-cover.png", png_bytes, "image/png")}
        r = requests.post(
            f"{BASE_URL}/api/maker/uploads/cover",
            headers={"Authorization": f"Bearer {maker_token}"},
            files=files,
            timeout=30,
        )
        if r.status_code == 503:
            pytest.skip(f"R2 not configured in this env: {r.text}")
        assert r.status_code == 200, f"unexpected: {r.status_code} {r.text}"
        data = r.json()
        assert "url" in data and "size" in data
        assert isinstance(data["url"], str) and data["url"].startswith("http")
        # URL should be under R2 CDN prefix (contain 'covers/{slug}/')
        assert f"covers/{MAKER_SLUG}/" in data["url"], f"URL doesn't include expected prefix: {data['url']}"
        assert data["size"] == len(png_bytes)

        # Verify the DB was updated by GET /maker/me
        me = requests.get(
            f"{BASE_URL}/api/maker/me",
            headers={"Authorization": f"Bearer {maker_token}"},
            timeout=15,
        )
        assert me.status_code == 200
        assert me.json().get("cover") == data["url"]

    def test_rejects_non_image_content_type(self, maker_token):
        files = {"file": ("not-image.txt", b"hello world", "text/plain")}
        r = requests.post(
            f"{BASE_URL}/api/maker/uploads/cover",
            headers={"Authorization": f"Bearer {maker_token}"},
            files=files,
            timeout=15,
        )
        if r.status_code == 503:
            pytest.skip("R2 not configured")
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"
        body = r.json()
        detail = (body.get("detail") or "").lower()
        assert "png" in detail or "jpg" in detail or "webp" in detail or "image" in detail

    def test_rejects_empty_file(self, maker_token):
        files = {"file": ("empty.png", b"", "image/png")}
        r = requests.post(
            f"{BASE_URL}/api/maker/uploads/cover",
            headers={"Authorization": f"Bearer {maker_token}"},
            files=files,
            timeout=15,
        )
        if r.status_code == 503:
            pytest.skip("R2 not configured")
        assert r.status_code == 400
        assert "empty" in (r.json().get("detail") or "").lower()

    def test_rejects_oversized_file(self, maker_token):
        # ~10.1 MB PNG (over the 10 MB cap)
        big = _make_png(size_bytes=10 * 1024 * 1024 + 100 * 1024)
        assert len(big) > 10 * 1024 * 1024
        files = {"file": ("big.png", big, "image/png")}
        r = requests.post(
            f"{BASE_URL}/api/maker/uploads/cover",
            headers={"Authorization": f"Bearer {maker_token}"},
            files=files,
            timeout=30,
        )
        if r.status_code == 503:
            pytest.skip("R2 not configured")
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"
        detail = (r.json().get("detail") or "").lower()
        assert "10 mb" in detail or "smaller" in detail or "large" in detail

    def test_requires_auth(self):
        files = {"file": ("test.png", _make_png(), "image/png")}
        r = requests.post(f"{BASE_URL}/api/maker/uploads/cover", files=files, timeout=15)
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}"
