"""Backend tests for iter48: community design file direct upload.

Covers POST /api/community/files/upload — multipart endpoint that accepts
any signed-in community user (buyer or maker) and rejects:
  - missing/invalid auth (401)
  - unsupported file types (400 - 'Unsupported file type')
  - empty body (400)
  - oversized files (>25MB) (400)

Also verifies the URL-paste endpoint POST /api/community/files still exists
for makers and that the listing endpoint returns the new docs (persistence).
"""

import os
import io
import sys
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://active-project-4.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

# Mint JWTs locally to avoid email round-trip.
sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv  # noqa: E402
load_dotenv("/app/backend/.env")
from maker_auth import issue_session_jwt  # noqa: E402


@pytest.fixture(scope="module")
def maker_jwt():
    return issue_session_jwt("iron-and-oak", "iron-and-oak@craftersmarket.org", role="maker")


@pytest.fixture(scope="module")
def buyer_jwt():
    return issue_session_jwt("test-buyer-iter48", "buyer-iter48@test.com", role="buyer")


@pytest.fixture(scope="module")
def small_svg_bytes():
    return (
        b'<?xml version="1.0"?>'
        b'<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50">'
        b'<rect width="50" height="50" fill="#ff4500"/></svg>'
    )


# ---------- Auth gating ----------
class TestAuthGating:
    def test_no_auth_rejected_401(self, small_svg_bytes):
        r = requests.post(
            f"{API}/community/files/upload",
            files=[("files", ("test.svg", small_svg_bytes, "image/svg+xml"))],
            data={"title": "T", "description": "D"}, timeout=15,
        )
        assert r.status_code == 401, f"expected 401, got {r.status_code}: {r.text[:200]}"

    def test_invalid_token_rejected(self, small_svg_bytes):
        r = requests.post(
            f"{API}/community/files/upload",
            headers={"Authorization": "Bearer not-a-real-jwt"},
            files=[("files", ("test.svg", small_svg_bytes, "image/svg+xml"))],
            data={"title": "T", "description": "D"}, timeout=15,
        )
        assert r.status_code in (401, 403), f"got {r.status_code}: {r.text[:200]}"


# ---------- Maker upload flow ----------
class TestMakerUpload:
    def test_maker_upload_svg_success(self, maker_jwt, small_svg_bytes):
        r = requests.post(
            f"{API}/community/files/upload",
            headers={"Authorization": f"Bearer {maker_jwt}"},
            files=[("files", ("iter48-maker.svg", small_svg_bytes, "image/svg+xml"))],
            data={
                "title": "TEST_iter48_maker_upload",
                "description": "Iter48 maker upload smoke test",
            }, timeout=15,
        )
        assert r.status_code == 200, f"expected 200, got {r.status_code}: {r.text[:300]}"
        body = r.json()
        # Field-level data assertions
        assert body["title"] == "TEST_iter48_maker_upload"
        assert body["file_type"] == "SVG"
        assert body["uploader_role"] == "maker"
        assert body["maker_slug"] == "iron-and-oak"
        assert body["maker_name"], "maker_name should not be empty"
        assert body["download_url"].startswith("http"), body["download_url"]
        assert body["size_bytes"] == len(small_svg_bytes)
        assert "id" in body
        # Persistence — should appear in the listing
        listing = requests.get(f"{API}/community/files", timeout=15).json()
        assert any(f.get("id") == body["id"] for f in listing), "uploaded file missing from listing"

    def test_reject_unsupported_extension(self, maker_jwt):
        r = requests.post(
            f"{API}/community/files/upload",
            headers={"Authorization": f"Bearer {maker_jwt}"},
            files=[("files", ("notes.txt", b"hello world", "text/plain"))],
            data={
                "title": "TEST_iter48_bad_type",
                "description": "should be rejected",
            }, timeout=15,
        )
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text[:200]}"
        assert "Unsupported" in r.text or "unsupported" in r.text.lower()

    def test_reject_empty_file(self, maker_jwt):
        r = requests.post(
            f"{API}/community/files/upload",
            headers={"Authorization": f"Bearer {maker_jwt}"},
            files=[("files", ("empty.svg", b"", "image/svg+xml"))],
            data={
                "title": "TEST_iter48_empty",
                "description": "empty body",
            }, timeout=15,
        )
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text[:200]}"

    def test_reject_missing_title(self, maker_jwt, small_svg_bytes):
        r = requests.post(
            f"{API}/community/files/upload",
            headers={"Authorization": f"Bearer {maker_jwt}"},
            files=[("files", ("t.svg", small_svg_bytes, "image/svg+xml"))],
            data={"title": "", "description": "no title"}, timeout=15,
        )
        assert r.status_code in (400, 422), f"got {r.status_code}: {r.text[:200]}"

    def test_reject_oversized_file(self, maker_jwt):
        # Build a 26 MB DXF blob — exceeds the 25 MB cap.
        big = b"0123456789" * (26 * 1024 * 1024 // 10 + 1)
        assert len(big) > 25 * 1024 * 1024
        r = requests.post(
            f"{API}/community/files/upload",
            headers={"Authorization": f"Bearer {maker_jwt}"},
            files=[("files", ("huge.svg", big, "image/svg+xml"))],
            data={"title": "TEST_iter48_oversize", "description": "too big"},
            timeout=120,
        )
        # Backend may return 400 (size check) or 413 (gateway). Both are acceptable rejections.
        assert r.status_code in (400, 413), f"expected 400/413, got {r.status_code}: {r.text[:200]}"


# ---------- Buyer upload flow ----------
class TestBuyerUpload:
    def test_buyer_upload_svg_success(self, buyer_jwt, small_svg_bytes):
        r = requests.post(
            f"{API}/community/files/upload",
            headers={"Authorization": f"Bearer {buyer_jwt}"},
            files=[("files", ("iter48-buyer.svg", small_svg_bytes, "image/svg+xml"))],
            data={
                "title": "TEST_iter48_buyer_upload",
                "description": "Iter48 buyer upload smoke test",
                "thumbnail_url": "https://example.com/thumb.jpg",
            }, timeout=15,
        )
        assert r.status_code == 200, f"expected 200, got {r.status_code}: {r.text[:300]}"
        body = r.json()
        assert body["uploader_role"] == "buyer"
        assert body["maker_slug"] is None, "buyer uploads must NOT carry a maker_slug"
        assert body["uploader_id"] == "test-buyer-iter48"
        assert body["thumbnail_url"] == "https://example.com/thumb.jpg"
        assert body["title"] == "TEST_iter48_buyer_upload"
        assert body["file_type"] == "SVG"


# ---------- URL-paste endpoint (legacy maker path, must still work) ----------
class TestLegacyUrlPaste:
    def test_maker_url_paste_still_works(self, maker_jwt):
        r = requests.post(
            f"{API}/community/files",
            headers={"Authorization": f"Bearer {maker_jwt}"},
            json={
                "title": "TEST_iter48_legacy_url",
                "description": "External URL paste",
                "file_type": "DXF",
                "download_url": "https://dropbox.example.com/file.dxf",
            }, timeout=15,
        )
        assert r.status_code == 200, f"expected 200, got {r.status_code}: {r.text[:200]}"
        body = r.json()
        assert body["title"] == "TEST_iter48_legacy_url"
        assert body["file_type"] == "DXF"
        assert body["download_url"] == "https://dropbox.example.com/file.dxf"

    def test_buyer_cannot_use_url_paste_endpoint(self, buyer_jwt):
        # The legacy endpoint still uses current_maker_slug, so buyer should be 401/403.
        r = requests.post(
            f"{API}/community/files",
            headers={"Authorization": f"Bearer {buyer_jwt}"},
            json={
                "title": "TEST_iter48_buyer_legacy",
                "description": "buyer trying maker-only endpoint",
                "file_type": "DXF",
                "download_url": "https://dropbox.example.com/file.dxf",
            }, timeout=15,
        )
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code}: {r.text[:200]}"


# ---------- Cleanup ----------
@pytest.fixture(scope="module", autouse=True)
def cleanup():
    yield
    # Remove all TEST_iter48_ rows we created via direct mongo access.
    try:
        from motor.motor_asyncio import AsyncIOMotorClient
        import asyncio
        mongo_url = os.environ.get("MONGO_URL")
        db_name = os.environ.get("DB_NAME")
        if not mongo_url or not db_name:
            return
        client = AsyncIOMotorClient(mongo_url)
        db = client[db_name]
        async def _cleanup():
            await db.design_files.delete_many({"title": {"$regex": "^TEST_iter48_"}})
        asyncio.run(_cleanup())
    except Exception as e:
        print(f"cleanup skipped: {e}")
